import { AppError } from "@repo/core";
import type { CollectorRowItem, CollectorStatus, MetricRow } from "@repo/ui";
import { z } from "zod";
import type { components } from "../client/schema.gen.ts";
import { TYPE_LABEL, type TargetType } from "../search/plan.ts";

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

/**
 * A job's status as its row and the summary's count chips show it (§3, D7,
 * D9): jobStatus, except that a job that succeeded and found nothing is
 * FOUND_NOTHING, a measured zero, never confused with one that found
 * something; and one whose source answered with nothing it cannot be trusted
 * on (EMPTY_UNCONFIRMED) is UNCONFIRMED, never a found nothing and never a
 * zero. jobStatus keeps the run report's reading (RAN) for the report.
 */
export function jobRowStatus(job: JobData): CollectorStatus {
  if (job.status === "SUCCEEDED" && job.outcome === "NOT_FOUND") return "FOUND_NOTHING";
  if (job.status === "SUCCEEDED" && job.outcome === "EMPTY_UNCONFIRMED") return "UNCONFIRMED";
  return jobStatus(job);
}

/** A count and its noun: "1 attempt", "3 attempts". */
export const plural = (count: number, word: string): string =>
  `${String(count)} ${word}${count === 1 ? "" : "s"}`;

/**
 * An instant in the reader's local time with its zone visible, as text (a
 * row's meta line is text). The same form wherever this page shows a time.
 */
export function formatInstant(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { timeZoneName: "short" });
}

const joinParts = (parts: readonly string[]): string => parts.join(" · ");

/**
 * One job as a collector row: its registry label (never a collector-supplied
 * string), its row status, and in words what it found or why not. A failed
 * job states its code, the API's message, the attempts and any dead-lettering;
 * a failed job with no recorded error says so, and no code is made up for it.
 * `discipline` is the collector list's word for it, or null when the list
 * does not have it (then it is left out, never guessed).
 */
export function jobRowItem(job: JobData, discipline: string | null): CollectorRowItem {
  const status = jobRowStatus(job);
  const parts: string[] = discipline === null ? [] : [discipline];
  const attempts = plural(job.attempts, "attempt");
  const reason = job.error === null ? null : `${job.error.code}: ${job.error.message}`;
  const took = durationBetween(job.startedAt, job.finishedAt);
  const base = { id: job.id, label: job.sourceLabel, status };
  switch (status) {
    case "RAN":
      parts.push(plural(job.evidenceIds.length, "evidence record"));
      if (job.fusedAt === null) parts.push("merging into the results");
      if (took !== null) parts.push(formatDuration(took));
      if (job.attempts > 1) parts.push(`recovered on attempt ${String(job.attempts)}`);
      break;
    case "FOUND_NOTHING":
      parts.push(job.outcomeDetail ?? "the source had nothing for this target");
      if (took !== null) parts.push(formatDuration(took));
      if (job.attempts > 1) parts.push(`recovered on attempt ${String(job.attempts)}`);
      break;
    case "UNCONFIRMED":
      // The collector's own words say what came back empty and why that is not "nothing".
      parts.push(
        job.outcomeDetail ??
          "returned nothing, unconfirmed: this source's empty answers are unreliable",
      );
      if (took !== null) parts.push(formatDuration(took));
      if (job.attempts > 1) parts.push(`recovered on attempt ${String(job.attempts)}`);
      break;
    case "NEEDS_KEY":
      parts.push(reason ?? "needs a key that is not set for your organisation");
      break;
    case "SKIPPED":
      parts.push(reason ?? "refused before it ran");
      break;
    case "FAILED": {
      const ending =
        job.deadLetteredAt === null
          ? [`stopped after ${attempts}`]
          : [
              `gave up after ${attempts}`,
              `dead-lettered ${formatInstant(job.deadLetteredAt)}, kept for review`,
            ];
      if (job.error === null) {
        return {
          ...base,
          meta: joinParts([...parts, "failed, and no reason was recorded", ...ending]),
        };
      }
      return {
        ...base,
        meta: joinParts(parts),
        failure: { code: job.error.code, message: joinParts([job.error.message, ...ending]) },
      };
    }
    case "QUEUED":
      if (job.nextAttemptAt === null) {
        parts.push("waiting for a worker");
      } else {
        if (reason !== null) parts.push(reason);
        parts.push(`next attempt ${formatInstant(job.nextAttemptAt)} (after ${attempts})`);
      }
      break;
    case "RUNNING":
      // No endpoint reports a job's progress, so the row has no bar: a guessed width is fabricated.
      parts.push(job.attempts > 1 ? `collecting: attempt ${String(job.attempts)}` : "collecting");
      break;
    case "CANCELLED":
      parts.push("cancelled before it finished");
      break;
    case "PARTIAL":
    case "HELD":
    case "READY":
    case "UNAVAILABLE":
    case "LOCKED":
      // Not a job status: jobRowStatus never returns these.
      break;
  }
  return { ...base, meta: joinParts(parts) };
}

/** A collector the plan left out, as the run event lists it. */
export type ExcludedData = Extract<
  NonNullable<RunData["plan"]>,
  { readonly excluded: unknown }
>["excluded"][number];

/**
 * A collector the plan left out, as a row: labelled from the collector list
 * when it has it (else its id), with its §3 status and the API's reason. An
 * admission failure is FAILED, with the API's reason as its code.
 */
export function excludedRowItem(
  row: ExcludedData,
  index: number,
  status: CollectorStatus,
  collector: { readonly label: string; readonly discipline: string } | undefined,
): CollectorRowItem {
  const parts = collector === undefined ? [] : [collector.discipline];
  const base = {
    id: `excluded:${String(index)}:${row.collectorId}:${row.targetType ?? "any"}`,
    label: collector?.label ?? row.collectorId,
    status,
  };
  if (status === "FAILED") {
    return {
      ...base,
      ...(parts.length === 0 ? {} : { meta: joinParts(parts) }),
      failure: { code: row.reason, message: row.message },
    };
  }
  return { ...base, meta: joinParts([...parts, row.message]) };
}

/** A target type in words, inside a sentence, with its article: "a domain", "an IP address". */
export function typeInWords(type: TargetType): string {
  const label = TYPE_LABEL[type];
  // Lower-case a word ("Domain"), never an initialism ("IP address", "URL").
  const word = /^[A-Z][a-z]/.test(label) ? label.charAt(0).toLowerCase() + label.slice(1) : label;
  // "an" before a vowel sound: email, IP, organisation; "a" before URL and username.
  return `${/^[aeioAEIO]/.test(word) ? "an" : "a"} ${word}`;
}

/**
 * Why a collector does not apply to this run, in words, from the types the
 * plan read the target as and, when the collector list has it, the types the
 * collector takes. Nothing is added that the plan and the list do not state.
 */
export function notApplicableMessage(
  targetTypes: readonly TargetType[],
  accepts: readonly TargetType[] | null,
): string {
  const target =
    targetTypes.length === 0
      ? "Does not apply to this target"
      : `Does not apply to ${targetTypes.map(typeInWords).join(" or ")} target`;
  if (accepts === null || accepts.length === 0) return `${target}.`;
  return `${target}: it takes ${accepts.map(typeInWords).join(" or ")}.`;
}

/** How each row status is counted in the summary: the word stays the status's own. */
export const COUNT_WORD: Readonly<Record<CollectorStatus, string>> = {
  RAN: "ran",
  FOUND_NOTHING: "found nothing",
  UNCONFIRMED: "returned nothing, unconfirmed",
  RUNNING: "running",
  QUEUED: "queued",
  FAILED: "failed",
  NEEDS_KEY: "need a key",
  SKIPPED: "skipped",
  CANCELLED: "cancelled",
  LOCKED: "locked",
  PARTIAL: "partial",
  HELD: "held",
  READY: "ready",
  UNAVAILABLE: "unavailable",
};

/** The row statuses a job can have, in the order the summary counts them. */
const COUNT_ORDER: readonly CollectorStatus[] = [
  "RAN",
  "FOUND_NOTHING",
  "UNCONFIRMED",
  "RUNNING",
  "QUEUED",
  "FAILED",
  "NEEDS_KEY",
  "SKIPPED",
  "CANCELLED",
];

export interface CountChip {
  readonly status: CollectorStatus;
  readonly text: string;
}

/**
 * The summary's count chips: one per row status some job has, in a fixed
 * order, then the plan's exclusions as "n not run". A status no job has gets
 * no chip: an absent status is never shown as "0".
 */
export function countChips(
  statuses: readonly CollectorStatus[],
  excludedCount: number,
): CountChip[] {
  const chips: CountChip[] = [];
  for (const status of COUNT_ORDER) {
    const count = statuses.filter((entry) => entry === status).length;
    if (count > 0) chips.push({ status, text: `${String(count)} ${COUNT_WORD[status]}` });
  }
  if (excludedCount > 0)
    chips.push({ status: "SKIPPED", text: `${String(excludedCount)} not run` });
  return chips;
}

const INCOMPLETE: ReadonlySet<CollectorStatus> = new Set([
  "FAILED",
  "NEEDS_KEY",
  "SKIPPED",
  "CANCELLED",
]);

/**
 * "Arriving now", counted from the run's own job events: evidence records,
 * collectors that found something and that found nothing (a measured 0 is a
 * true zero), the claims the stream does not count, and for each collector
 * that did not complete an unmeasured row naming it (failure ink for a
 * failure, muted otherwise).
 */
export function arrivingRows(jobs: readonly JobData[]): MetricRow[] {
  const count = (value: number): MetricRow["value"] => ({ kind: "value", value: String(value) });
  const rows: MetricRow[] = [
    {
      label: "Evidence records",
      value: count(jobs.reduce((sum, job) => sum + job.evidenceIds.length, 0)),
    },
    {
      label: "Collectors that found something",
      value: count(
        jobs.filter((job) => job.status === "SUCCEEDED" && job.outcome === "FOUND").length,
      ),
    },
    {
      label: "Collectors that found nothing",
      value: count(jobs.filter((job) => jobRowStatus(job) === "FOUND_NOTHING").length),
    },
    // Never added to "found nothing": an unconfirmed empty answer is not a zero.
    // Listed when some collector gave one, as a count chip is.
    ...(jobs.some((job) => jobRowStatus(job) === "UNCONFIRMED")
      ? [
          {
            label: "Collectors that returned nothing, unconfirmed",
            value: count(jobs.filter((job) => jobRowStatus(job) === "UNCONFIRMED").length),
          },
        ]
      : []),
    {
      label: "Claims",
      value: {
        kind: "unavailable",
        reason: "the progress stream does not count claims",
        cause: "not-recorded",
      },
    },
  ];
  for (const job of jobs) {
    const status = jobRowStatus(job);
    if (!INCOMPLETE.has(status)) continue;
    rows.push({
      id: job.id,
      label: `From ${job.sourceLabel}`,
      value: {
        kind: "unavailable",
        reason: `${job.sourceLabel} did not complete`,
        cause: status === "FAILED" ? "failed" : "not-recorded",
      },
    });
  }
  return rows;
}
