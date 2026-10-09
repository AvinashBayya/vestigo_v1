import { describe, expect, it } from "vitest";
import { InvalidTenantIdError, parseTenantId } from "./tenant.ts";
import { CASE_ANALYSIS_STATUSES } from "./case-analysis.ts";
import { CLAIM_STRENGTHS, LOCK_REASONS } from "./vocabulary.ts";

describe("parseTenantId", () => {
  it("accepts a UUID and normalises it to lower case", () => {
    expect(parseTenantId("0F8FAD5B-D9CB-469F-A165-70867728950E")).toBe(
      "0f8fad5b-d9cb-469f-a165-70867728950e",
    );
  });

  it.each(["", "tenant-a", "0f8fad5b-d9cb-469f-a165", "0f8fad5b-d9cb-469f-a165-70867728950e'--"])(
    "rejects %j with a typed error",
    (value) => {
      expect(() => parseTenantId(value)).toThrow(InvalidTenantIdError);
    },
  );
});

describe("CASE_ANALYSIS_STATUSES", () => {
  it("is exactly an attempt's three states: requested, finished with a document, failed", () => {
    expect(CASE_ANALYSIS_STATUSES).toEqual(["PENDING", "COMPLETE", "FAILED"]);
  });
});

describe("LOCK_REASONS", () => {
  it("is exactly the two reasons a module is locked: the plan, and vetting", () => {
    expect(LOCK_REASONS).toEqual(["MODULE_NOT_IN_PLAN", "VETTING_NOT_APPROVED"]);
  });
});

describe("CLAIM_STRENGTHS", () => {
  it("is exactly the six labels of CLAUDE.md §1, strongest first", () => {
    expect(CLAIM_STRENGTHS).toEqual([
      "OBSERVED",
      "REPORTED",
      "DERIVED",
      "CORRELATED",
      "INFERRED",
      "HYPOTHESIS",
    ]);
  });
});
