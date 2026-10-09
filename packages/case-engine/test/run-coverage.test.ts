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
  it("no entries: counts of zero, each measured", () => {
    expect(coverageHeadline("SUCCEEDED", [], null)).toBe(
      "COMPLETE RUN: all 0 planned collectors finished (0 found something, 0 found nothing).",
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
});
