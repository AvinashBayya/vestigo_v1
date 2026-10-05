import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createEventParser,
  decodeEvent,
  EMPTY_PROGRESS,
  jobStatus,
  StreamDropped,
  type JobData,
} from "./progress.ts";

const job = (overrides: Partial<JobData> = {}): JobData => ({
  id: "55555555-5555-4555-8555-555555555555",
  collectorId: "[collector]",
  sourceLabel: "[Source]",
  status: "QUEUED",
  outcome: null,
  outcomeDetail: null,
  error: null,
  attempts: 0,
  nextAttemptAt: null,
  deadLetteredAt: null,
  startedAt: null,
  finishedAt: null,
  fusedAt: null,
  evidenceIds: [],
  ...overrides,
});

describe("the server-sent event parser", () => {
  it("reassembles events split anywhere across chunks, and skips the keep-alive comment", () => {
    const parser = createEventParser();
    expect(parser.feed("event: jo")).toEqual([]);
    expect(parser.feed('b\ndata: {"a"')).toEqual([]);
    expect(parser.feed(":1}\n")).toEqual([]);
    expect(parser.feed("\n: keep-alive\n\nevent: end\r\ndata: {}\r\n\r\n")).toEqual([
      { event: "job", data: '{"a":1}' },
      { event: "end", data: "{}" },
    ]);
  });

  it("joins multi-line data, and ignores an event with no data", () => {
    const parser = createEventParser();
    expect(parser.feed("event: run\n\nevent: run\ndata: [1,\ndata: 2]\n\n")).toEqual([
      { event: "run", data: "[1,\n2]" },
    ]);
  });
});

describe("decoding an event at the boundary", () => {
  /** The code the event is refused with; null when it is accepted. */
  const refusalOf = (event: string, data: string): string | null => {
    try {
      decodeEvent({ event, data });
      return null;
    } catch (error) {
      if (error instanceof StreamDropped) return error.code;
      throw error;
    }
  };
  const codeOf = refusalOf;

  it("accepts a documented event with the fields this page reads", () => {
    expect(decodeEvent({ event: "job", data: JSON.stringify(job()) }).event).toBe("job");
    expect(decodeEvent({ event: "end", data: JSON.stringify({ status: null }) }).data).toEqual({
      status: null,
    });
  });

  it("refuses an unknown event, data that is not JSON, and a missing field", () => {
    expect(codeOf("surprise", "{}")).toBe("STREAM_PROTOCOL");
    expect(codeOf("job", "{not json")).toBe("STREAM_PROTOCOL");
    expect(codeOf("job", JSON.stringify({ ...job(), status: undefined }))).toBe("STREAM_PROTOCOL");
  });
});

describe("a job's §3 status", () => {
  it("is read the way the run report reads it", () => {
    expect(jobStatus(job({ status: "SUCCEEDED", outcome: "FOUND" }))).toBe("RAN");
    expect(jobStatus(job({ status: "SUCCEEDED", outcome: "NOT_FOUND" }))).toBe("RAN");
    expect(jobStatus(job({ status: "FAILED", outcome: "NEEDS_CREDENTIALS" }))).toBe("NEEDS_KEY");
    expect(jobStatus(job({ status: "FAILED", outcome: "REFUSED" }))).toBe("SKIPPED");
    expect(jobStatus(job({ status: "FAILED", outcome: "UNAVAILABLE" }))).toBe("FAILED");
    expect(jobStatus(job({ status: "FAILED", outcome: "FAILED" }))).toBe("FAILED");
    expect(jobStatus(job({ status: "DEAD_LETTERED", outcome: "FAILED" }))).toBe("FAILED");
    expect(jobStatus(job({ status: "CANCELLED" }))).toBe("CANCELLED");
    expect(jobStatus(job({ status: "RUNNING" }))).toBe("RUNNING");
    expect(jobStatus(job({ status: "QUEUED" }))).toBe("QUEUED");
  });
});

describe("progress from events", () => {
  it("keeps jobs in the order first seen, replacing each in place when it changes", () => {
    const first = job({ id: "a", sourceLabel: "[A]" });
    const second = job({ id: "b", sourceLabel: "[B]" });
    let progress = applyEvent(EMPTY_PROGRESS, { event: "job", data: first });
    progress = applyEvent(progress, { event: "job", data: second });
    progress = applyEvent(progress, {
      event: "job",
      data: { ...first, status: "SUCCEEDED", outcome: "FOUND" },
    });
    expect(progress.jobs.map((entry) => [entry.id, entry.status])).toEqual([
      ["a", "SUCCEEDED"],
      ["b", "QUEUED"],
    ]);
  });
});
