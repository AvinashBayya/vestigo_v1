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
  it("no collector planned: says so, never 'all 0 planned collectors finished'", () => {
    expect(coverageHeadline("SUCCEEDED", [], null)).toBe(
      "COMPLETE RUN: no collector was planned to run.",
    );
    const excluded = {
      collectorId: "dns",
      sourceLabel: "[fake dns]",
      state: "EXCLUDED" as const,
      targetType: "DOMAIN" as const,
      reasonCode: "LICENCE_BLOCKED",
      detail: "[test] blocked",
      evidenceCount: 0,
      attempts: null,
    };
    expect(coverageHeadline("SUCCEEDED", [excluded], null)).toBe(
      "COMPLETE RUN: no collector was planned to run. 1 further collector(s) were excluded or held and did not run.",
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
