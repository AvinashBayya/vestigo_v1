import { describe, expect, it } from "vitest";
import {
  applyEvent,
  createEventParser,
  decodeEvent,
  EMPTY_PROGRESS,
  arrivingRows,
  countChips,
  excludedRowItem,
  formatInstant,
  jobRowItem,
  jobRowStatus,
  jobStatus,
  notApplicableMessage,
  StreamDropped,
  typeInWords,
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

describe("a job's row (D7)", () => {
  it("is FOUND_NOTHING for a source that ran and found nothing, while jobStatus keeps the report's RAN", () => {
    const nothing = job({ status: "SUCCEEDED", outcome: "NOT_FOUND" });
    expect(jobRowStatus(nothing)).toBe("FOUND_NOTHING");
    expect(jobStatus(nothing)).toBe("RAN");
    expect(jobRowStatus(job({ status: "SUCCEEDED", outcome: "FOUND" }))).toBe("RAN");
    expect(jobRowStatus(job({ status: "DEAD_LETTERED", outcome: "FAILED" }))).toBe("FAILED");
  });

  it("says in words what it found, or why not, from measured values only", () => {
    expect(
      jobRowItem(
        job({
          status: "SUCCEEDED",
          outcome: "FOUND",
          evidenceIds: ["e1"],
          attempts: 2,
          startedAt: "2026-01-01T00:00:01.000Z",
          finishedAt: "2026-01-01T00:00:01.900Z",
        }),
        "TECHINT",
      ),
    ).toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      label: "[Source]",
      status: "RAN",
      meta: "TECHINT · 1 evidence record · merging into the results · 0.9s · recovered on attempt 2",
    });
    // Found nothing: the API's detail, never an evidence count; no duration unless both instants were recorded.
    expect(
      jobRowItem(
        job({ status: "SUCCEEDED", outcome: "NOT_FOUND", outcomeDetail: "[detail]" }),
        null,
      ),
    ).toMatchObject({ status: "FOUND_NOTHING", meta: "[detail]" });
    // Running: no progress is reported, so none is given (no bar).
    expect(jobRowItem(job({ status: "RUNNING", attempts: 1 }), null)).toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      label: "[Source]",
      status: "RUNNING",
      meta: "collecting",
    });
  });

  it("states a failure's code, message and attempts, dead-lettered or stopped, and invents no code", () => {
    const error = { code: "[CODE]", message: "[message]" };
    const dead = jobRowItem(
      job({
        status: "DEAD_LETTERED",
        outcome: "FAILED",
        attempts: 3,
        error,
        deadLetteredAt: "2026-01-01T00:00:09.000Z",
      }),
      "TECHINT",
    );
    expect(dead.status).toBe("FAILED");
    expect(dead.failure).toEqual({
      code: "[CODE]",
      message: `[message] · gave up after 3 attempts · dead-lettered ${formatInstant("2026-01-01T00:00:09.000Z")}, kept for review`,
    });
    expect(
      jobRowItem(job({ status: "FAILED", outcome: "FAILED", attempts: 1, error }), null).failure,
    ).toEqual({ code: "[CODE]", message: "[message] · stopped after 1 attempt" });
    const unexplained = jobRowItem(job({ status: "FAILED", outcome: "FAILED", attempts: 1 }), null);
    expect(unexplained.failure).toBeUndefined();
    expect(unexplained.meta).toBe("failed, and no reason was recorded · stopped after 1 attempt");
  });

  it("states a retry's next attempt and the attempts so far", () => {
    const item = jobRowItem(
      job({
        attempts: 1,
        error: { code: "[CODE]", message: "[message]" },
        nextAttemptAt: "2026-01-01T00:01:00.000Z",
      }),
      null,
    );
    expect(item.meta).toBe(
      `[CODE]: [message] · next attempt ${formatInstant("2026-01-01T00:01:00.000Z")} (after 1 attempt)`,
    );
  });

  it("shows an instant in local time with its zone", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(new Date(at))
      .find((part) => part.type === "timeZoneName")?.value;
    if (zone === undefined) throw new TypeError("no zone name");
    expect(formatInstant(at)).toContain(zone);
  });
});

describe("a job whose source's empty answer is unconfirmed (D9, Track M Day 2)", () => {
  const unconfirmed = job({
    status: "SUCCEEDED",
    outcome: "EMPTY_UNCONFIRMED",
    outcomeDetail: "[what came back empty, and why that is not nothing]",
    attempts: 1,
  });

  it("is UNCONFIRMED, never FOUND_NOTHING, and its row gives the collector's words, never a count", () => {
    expect(jobRowStatus(unconfirmed)).toBe("UNCONFIRMED");
    expect(jobStatus(unconfirmed)).toBe("RAN");
    const item = jobRowItem(unconfirmed, "MEDIAINT");
    expect(item).toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      label: "[Source]",
      status: "UNCONFIRMED",
      meta: "MEDIAINT · [what came back empty, and why that is not nothing]",
    });
    expect(item.meta).not.toMatch(/\b0\b|evidence record|found nothing/);
  });

  it("is counted apart in the chips and arriving now, never added to found nothing", () => {
    const nothing = job({ id: "n", status: "SUCCEEDED", outcome: "NOT_FOUND" });
    const statuses = [unconfirmed, nothing].map(jobRowStatus);
    expect(countChips(statuses, 0)).toEqual([
      { status: "FOUND_NOTHING", text: "1 found nothing" },
      { status: "UNCONFIRMED", text: "1 returned nothing, unconfirmed" },
    ]);
    const rows = arrivingRows([unconfirmed, nothing]);
    expect(rows.slice(0, 4).map((row) => [row.label, row.value])).toEqual([
      ["Evidence records", { kind: "value", value: "0" }],
      ["Collectors that found something", { kind: "value", value: "0" }],
      ["Collectors that found nothing", { kind: "value", value: "1" }],
      ["Collectors that returned nothing, unconfirmed", { kind: "value", value: "1" }],
    ]);
    // Without one, no row for it: an absent status is never shown as 0.
    expect(arrivingRows([nothing]).map((row) => row.label)).not.toContain(
      "Collectors that returned nothing, unconfirmed",
    );
  });
});

describe("a collector the plan left out", () => {
  const row = {
    collectorId: "[collector]",
    targetType: null,
    reason: "[REASON]",
    message: "[message]",
  };

  it("is labelled from the collector list, else by its id, with unique ids", () => {
    const listed = excludedRowItem(row, 0, "HELD", { label: "[Label]", discipline: "TECHINT" });
    expect(listed).toEqual({
      id: "excluded:0:[collector]:any",
      label: "[Label]",
      status: "HELD",
      meta: "TECHINT · [message]",
    });
    const unlisted = excludedRowItem(row, 1, "SKIPPED", undefined);
    expect(unlisted).toMatchObject({ label: "[collector]", meta: "[message]" });
    expect(unlisted.id).not.toBe(listed.id);
  });

  it("states an admission failure's reason as its code", () => {
    expect(excludedRowItem(row, 0, "FAILED", undefined).failure).toEqual({
      code: "[REASON]",
      message: "[message]",
    });
  });

  it("that does not take the target's type says so in type words, never type codes", () => {
    expect(typeInWords("DOMAIN")).toBe("a domain");
    expect(typeInWords("IP_ADDRESS")).toBe("an IP address");
    expect(typeInWords("EMAIL_ADDRESS")).toBe("an email address");
    expect(typeInWords("URL")).toBe("a URL");
    expect(typeInWords("USERNAME")).toBe("a username");
    expect(typeInWords("ORGANIZATION")).toBe("an organisation");
    expect(notApplicableMessage(["DOMAIN"], ["PHONE_NUMBER"])).toBe(
      "Does not apply to a domain target: it takes a phone number.",
    );
    expect(notApplicableMessage(["DOMAIN", "USERNAME"], ["EMAIL_ADDRESS", "URL"])).toBe(
      "Does not apply to a domain or a username target: it takes an email address or a URL.",
    );
    // What is not known is left out, never guessed.
    expect(notApplicableMessage(["DOMAIN"], null)).toBe("Does not apply to a domain target.");
    expect(notApplicableMessage([], null)).toBe("Does not apply to this target.");
  });
});

describe("the summary's count chips", () => {
  it("counts each row status in a fixed order, then the exclusions, and never shows a zero", () => {
    expect(countChips(["QUEUED", "FOUND_NOTHING", "RAN", "QUEUED"], 2)).toEqual([
      { status: "RAN", text: "1 ran" },
      { status: "FOUND_NOTHING", text: "1 found nothing" },
      { status: "QUEUED", text: "2 queued" },
      { status: "SKIPPED", text: "2 not run" },
    ]);
    expect(countChips([], 0)).toEqual([]);
  });
});

describe("arriving now", () => {
  it("counts from the run's jobs: a measured zero is 0; claims and incomplete sources are unmeasured", () => {
    const rows = arrivingRows([
      job({ id: "a", status: "RUNNING" }),
      job({ id: "b", sourceLabel: "[Failed]", status: "FAILED", outcome: "FAILED" }),
      job({ id: "c", sourceLabel: "[Keyed]", status: "FAILED", outcome: "NEEDS_CREDENTIALS" }),
    ]);
    expect(rows.slice(0, 3).map((row) => [row.label, row.value])).toEqual([
      ["Evidence records", { kind: "value", value: "0" }],
      ["Collectors that found something", { kind: "value", value: "0" }],
      ["Collectors that found nothing", { kind: "value", value: "0" }],
    ]);
    expect(rows[3]).toEqual({
      label: "Claims",
      value: {
        kind: "unavailable",
        reason: "the progress stream does not count claims",
        cause: "not-recorded",
      },
    });
    expect(rows.slice(4)).toEqual([
      {
        id: "b",
        label: "From [Failed]",
        value: { kind: "unavailable", reason: "[Failed] did not complete", cause: "failed" },
      },
      {
        id: "c",
        label: "From [Keyed]",
        value: { kind: "unavailable", reason: "[Keyed] did not complete", cause: "not-recorded" },
      },
    ]);
  });
});
