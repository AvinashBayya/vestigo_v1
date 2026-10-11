/**
 * The run report's coverage, moved here unchanged (owner ruling D-1): each
 * function's honest empty and unavailable case. The golden files in
 * packages/osint-engine/test/golden prove the moved output identical to the
 * code it replaced; these state what each says when there is nothing to say.
 */
import { describe, expect, it } from "vitest";
import {
  COVERAGE_CAVEATS,
  coverageFromJob,
  coverageHeadline,
  displayValue,
  runCoverage,
  sourceLabelOf,
  type CoverageJob,
} from "../src/index.ts";

const QUEUED: CoverageJob = {
  collectorId: "dns",
  status: "QUEUED",
  outcome: null,
  outcomeDetail: null,
  targetType: null,
  attempts: 0,
  evidenceIds: null,
  lastErrorCode: null,
  lastErrorMessage: null,
};

describe("runCoverage", () => {
  it("a run whose plan was not recorded: partial, nothing listed, and the headline says why", () => {
    expect(
      runCoverage({
        registry: [],
        status: "FAILED",
        plan: { kind: "NOT_RECORDED" },
        jobs: [],
        held: [],
      }),
    ).toEqual({
      runStatus: "FAILED",
      partial: true,
      headline: "FAILED RUN: the run could not be planned (its plan was not recorded).",
      entries: [],
      notApplicable: [],
      caveats: [
        "Collection was passive: every collector read a third party's record or analysed the input, and none contacted the target.",
        ...COVERAGE_CAVEATS,
      ],
    });
  });

  it("a planned run with no jobs and no exclusions: complete, with zero collectors named", () => {
    const coverage = runCoverage({
      registry: [],
      status: "SUCCEEDED",
      plan: { kind: "PLANNED", targetTypes: ["DOMAIN"], excluded: [] },
      jobs: [],
      held: [],
    });
    expect(coverage.partial).toBe(false);
    expect(coverage.entries).toEqual([]);
  });
});

describe("coverageFromJob", () => {
  it("a job that has not run: not finished, with no evidence and its status as the reason", () => {
    expect(coverageFromJob(QUEUED, "[fake dns]")).toEqual({
      collectorId: "dns",
      sourceLabel: "[fake dns]",
      targetType: null,
      attempts: 0,
      evidenceCount: 0,
      state: "NOT_FINISHED",
      reasonCode: "QUEUED",
      detail: null,
    });
  });
});

describe("coverageHeadline", () => {
  const entry = (
    state: "COLLECTED" | "NOTHING_FOUND" | "FAILED" | "EXCLUDED",
  ): Parameters<typeof coverageHeadline>[1][number] => ({
    collectorId: `[${state}]`,
    sourceLabel: `[${state}]`,
    state,
    targetType: "DOMAIN",
    reasonCode: state === "EXCLUDED" ? "LICENCE_BLOCKED" : null,
    detail: null,
    evidenceCount: 0,
    attempts: state === "EXCLUDED" ? null : 1,
  });
  const NOTHING =
    "NOTHING PLANNED: no collector was planned to run, so there is nothing to report on.";

  it("no collector planned, complete, partial or failed: nothing to report on, never 'all 0', '0 of 0' or 'none of the 0'", () => {
    for (const status of ["SUCCEEDED", "PARTIAL", "FAILED"] as const) {
      expect(coverageHeadline(status, [], null)).toBe(NOTHING);
      expect(coverageHeadline(status, [entry("EXCLUDED")], null)).toBe(
        `${NOTHING} 1 further collector was excluded or held and did not run.`,
      );
    }
  });

  it("the note on collectors that did not run agrees in number", () => {
    expect(coverageHeadline("SUCCEEDED", [entry("COLLECTED"), entry("EXCLUDED")], null)).toBe(
      "COMPLETE RUN: all 1 planned collector finished (1 found something, 0 found nothing). 1 further collector was excluded or held and did not run.",
    );
    expect(
      coverageHeadline(
        "SUCCEEDED",
        [entry("COLLECTED"), entry("EXCLUDED"), entry("EXCLUDED")],
        null,
      ),
    ).toBe(
      "COMPLETE RUN: all 1 planned collector finished (1 found something, 0 found nothing). 2 further collectors were excluded or held and did not run.",
    );
    expect(coverageHeadline("SUCCEEDED", [entry("COLLECTED")], null)).not.toContain("further");
  });

  it("one planned collector is singular wherever the count is rendered", () => {
    expect(coverageHeadline("SUCCEEDED", [entry("COLLECTED")], null)).toBe(
      "COMPLETE RUN: all 1 planned collector finished (1 found something, 0 found nothing).",
    );
    expect(coverageHeadline("PARTIAL", [entry("FAILED")], null)).toBe(
      "PARTIAL RUN: 1 of 1 planned collector did not complete, so this report does not cover what they would have collected (0 found something, 0 found nothing).",
    );
    expect(coverageHeadline("FAILED", [entry("FAILED")], null)).toBe(
      "FAILED RUN: none of the 1 planned collector completed.",
    );
  });

  it("two or more planned collectors stay plural", () => {
    const two = [entry("COLLECTED"), entry("NOTHING_FOUND")];
    expect(coverageHeadline("SUCCEEDED", two, null)).toBe(
      "COMPLETE RUN: all 2 planned collectors finished (1 found something, 1 found nothing).",
    );
    expect(coverageHeadline("FAILED", [entry("FAILED"), entry("FAILED")], null)).toBe(
      "FAILED RUN: none of the 2 planned collectors completed.",
    );
  });
});

describe("sourceLabelOf", () => {
  it("an empty registry: the collector is named by its id, saying it is not registered", () => {
    expect(sourceLabelOf([], "dns")).toBe("dns (not in the current registry)");
  });
});

describe("displayValue", () => {
  it("an absent value is shown as null, and an empty one as empty, never as a stand-in", () => {
    expect(displayValue(null, 600)).toEqual({ text: "null", truncated: false });
    expect(displayValue("", 600)).toEqual({ text: "", truncated: false });
    expect(displayValue({ a: null }, 600)).toEqual({ text: "", truncated: false });
  });

  it("shows undefined as JSON carries it: null alone or in a list, left out of an object", () => {
    // Before the behaviour change: a TypeError, ", 1" and "a: undefined; b: 1".
    expect(displayValue(undefined, 600)).toEqual({ text: "null", truncated: false });
    expect(displayValue([undefined, 1], 600)).toEqual({ text: "null, 1", truncated: false });
    expect(displayValue({ a: undefined, b: 1 }, 600)).toEqual({ text: "b: 1", truncated: false });
  });

  // Each sample as the characters a reader sees. Before the behaviour change a
  // cut could fall inside any of them.
  const SAMPLES: readonly (readonly string[])[] = [
    ["a", "\u{1D11E}", "b"], // an astral character: a surrogate pair
    ["a", "b", "c", "d", "\u{1F6F0}️", "e", "f", "g"], // an emoji and its variation selector
    ["\u{1F469}‍\u{1F469}‍\u{1F467}", " ", "x"], // a zero-width-joined family
    ["\u{1F1E9}\u{1F1EA}", "\u{1F1EB}\u{1F1F7}", "\u{1F1EE}\u{1F1F9}"], // three flags
    ["\u{1F44D}\u{1F3FD}", "!"], // a skin tone
    ["1️⃣", "2"], // a keycap
    ["é", "x"], // a letter and its combining accent
    ["\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}", "!"], // a tag sequence
  ];

  it("cuts only between whole characters, keeping the longest part that fits", () => {
    for (const characters of SAMPLES) {
      const text = characters.join("");
      for (let max = 0; max <= text.length + 1; max += 1) {
        const shown = displayValue(text, max);
        if (text.length <= max) {
          expect(shown).toEqual({ text, truncated: false });
          continue;
        }
        let fits = "";
        for (const character of characters) {
          if (fits.length + character.length > max) break;
          fits += character;
        }
        expect(shown).toEqual({ text: fits, truncated: true });
      }
    }
  });
});
