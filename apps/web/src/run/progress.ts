import { AppError } from "@repo/core";
import type { CollectorStatus } from "@repo/ui";
import { z } from "zod";
import type { components } from "../client/schema.gen.ts";

type Schemas = components["schemas"];
export type RunStreamEvent = Schemas["RunStreamEvent"];
export type RunData = Schemas["RunStreamRunEvent"]["data"];
export type JobData = Schemas["RunStreamJobEvent"]["data"];
export type LockedEventData = Schemas["RunStreamLockedEvent"]["data"];
export type RunStatus = RunData["status"];

/**
 * The API sends a comment line every 15 s while a stream is open. Three
 * missed in a row means the connection is gone even if the socket has not
 * said so: no wait is unbounded (CLAUDE.md §5).
 */
export const STREAM_STALL_MS = 45_000;

/** Why the progress stream stopped before the run ended. The run itself is unaffected. */
export class StreamDropped extends AppError {
  readonly code: "STREAM_FAILED" | "STREAM_STALLED" | "STREAM_PROTOCOL" | "STREAM_CLOSED";

  constructor(code: StreamDropped["code"], message: string) {
    super(message);
    this.name = "StreamDropped";
    this.code = code;
  }
}

/** One server-sent event, as written on the wire: its name and its raw data. */
export interface RawEvent {
  readonly event: string;
  readonly data: string;
}

/**
 * Parses server-sent events from text chunks, which may split anywhere.
 * Comment lines (the keep-alive) are ignored; a blank line ends an event.
 */
export function createEventParser(): { feed(chunk: string): RawEvent[] } {
  let buffer = "";
  let event = "message";
  let data: string[] = [];
  return {
    feed(chunk) {
      buffer += chunk;
      const events: RawEvent[] = [];
      const lines = buffer.split(/\r\n|\r|\n/);
      // The last piece has no line end yet; keep it for the next chunk.
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line === "") {
          if (data.length > 0) events.push({ event, data: data.join("\n") });
          event = "message";
          data = [];
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      return events;
    },
  };
}

const instant = z.string().nullable();
const JobCheck = z.looseObject({
  id: z.string(),
  sourceLabel: z.string(),
  status: z.string(),
  outcome: z.string().nullable(),
  attempts: z.number(),
  evidenceIds: z.array(z.string()),
  nextAttemptAt: instant,
  deadLetteredAt: instant,
});
const RunCheck = z.looseObject({
  id: z.string(),
  status: z.string(),
  settled: z.boolean(),
  createdAt: z.string(),
  startedAt: instant,
  finishedAt: instant,
});
const LockedCheck = z.looseObject({
  reason: z.string(),
  code: z.string(),
  detail: z.string(),
  locked: z.looseObject({ nextStep: z.string() }).nullable(),
});
const CHECKS: Readonly<Record<RunStreamEvent["event"], z.ZodType>> = {
  run: RunCheck,
  job: JobCheck,
  end: z.looseObject({ status: z.string().nullable() }),
  locked: LockedCheck,
  timeout: z.looseObject({ reconnect: z.literal(true) }),
  error: z.looseObject({ code: z.string() }),
};

/**
 * A raw event, checked at the boundary (CLAUDE.md §7): a known name, JSON
 * data, and the fields this page reads. Anything else is a protocol failure,
 * never shown as progress.
 */
export function decodeEvent(raw: RawEvent): RunStreamEvent {
  if (!Object.hasOwn(CHECKS, raw.event)) {
    throw new StreamDropped("STREAM_PROTOCOL", `The progress stream sent an unknown event.`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw.data);
  } catch {
    throw new StreamDropped("STREAM_PROTOCOL", "The progress stream sent data that is not JSON.");
  }
  const check = CHECKS[raw.event as RunStreamEvent["event"]];
  if (!check.safeParse(data).success) {
    throw new StreamDropped(
      "STREAM_PROTOCOL",
      `The progress stream sent a ${raw.event} event that is not in the expected form.`,
    );
  }
  // Checked above for every field this page reads; the API validates the rest on send.
  return { event: raw.event, data } as RunStreamEvent;
}

/** What the page knows of the run, built from the events received. */
export interface RunProgress {
  readonly run: RunData | null;
  /** In the order first seen; a later event for a job replaces it in place. */
  readonly jobs: readonly JobData[];
  /** Set by `end`: the settled status, or null when the run no longer exists. */
  readonly ended: { readonly status: RunStatus | null } | null;
  readonly locked: LockedEventData | null;
}

export const EMPTY_PROGRESS: RunProgress = { run: null, jobs: [], ended: null, locked: null };

export function applyEvent(progress: RunProgress, event: RunStreamEvent): RunProgress {
  switch (event.event) {
    case "run":
      return { ...progress, run: event.data };
    case "job": {
      const index = progress.jobs.findIndex((job) => job.id === event.data.id);
      const jobs =
        index === -1
          ? [...progress.jobs, event.data]
          : progress.jobs.map((job, at) => (at === index ? event.data : job));
      return { ...progress, jobs };
    }
    case "end":
      return { ...progress, ended: { status: event.data.status } };
    case "locked":
      return { ...progress, locked: event.data };
    case "timeout":
    case "error":
      return progress;
  }
}

/**
 * A job's §3 status, read the same way the run report reads it
 * (packages/osint-engine reports, coverageFromJob): a succeeded job ran,
 * whether it found something or nothing; a failed job needed a key, was
 * refused, or failed, by its outcome.
 */
export function jobStatus(job: JobData): CollectorStatus {
  switch (job.status) {
    case "SUCCEEDED":
      return "RAN";
    case "FAILED":
      if (job.outcome === "NEEDS_CREDENTIALS") return "NEEDS_KEY";
      if (job.outcome === "REFUSED") return "SKIPPED";
      return "FAILED";
    case "DEAD_LETTERED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
    case "RUNNING":
      return "RUNNING";
    case "QUEUED":
      return "QUEUED";
  }
}

/** A run status in words, with what it means for the analyst. */
export const RUN_STATUS_TEXT: Readonly<Record<RunStatus, string>> = {
  QUEUED: "Queued: waiting for a worker to start it.",
  RUNNING: "Running.",
  SUCCEEDED: "Finished: every source ran.",
  PARTIAL: "Partial: some sources failed. Each failure is listed with its reason.",
  FAILED: "Failed: no source succeeded. Each failure is listed with its reason.",
  CANCELLED: "Cancelled: nothing more will be collected.",
};

/** A measured duration in words: "0.9s", "14s", "1m 58s", "1h 2m". */
export function formatDuration(milliseconds: number): string {
  if (milliseconds < 10_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  const total = Math.round(milliseconds / 1000);
  if (total < 60) return `${String(total)}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(total % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

/** How long between two recorded instants; null unless both were recorded. */
export function durationBetween(from: string | null, to: string | null): number | null {
  if (from === null || to === null) return null;
  return Date.parse(to) - Date.parse(from);
}
