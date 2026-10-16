import { LOCK_REASONS, UNRUNNABLE_REASONS } from "@repo/core";
import { describe, expect, it } from "vitest";
import { exclusionStatus } from "./plan.ts";

describe("the status of a collector a plan leaves out (§3)", () => {
  it("reads Held for every reason a collector cannot run at all, no access method enabled included", () => {
    expect(UNRUNNABLE_REASONS).toContain("ACCESS_METHOD_NOT_ENABLED");
    for (const reason of UNRUNNABLE_REASONS) expect(exclusionStatus(reason), reason).toBe("HELD");
  });

  it("reads Skipped for the plan, vetting or a missing scope authorisation, and Failed for anything else", () => {
    for (const reason of [...LOCK_REASONS, "SCOPE_AUTHORISATION_REQUIRED"]) {
      expect(exclusionStatus(reason), reason).toBe("SKIPPED");
    }
    expect(exclusionStatus("[an admission check that failed]")).toBe("FAILED");
  });
});
