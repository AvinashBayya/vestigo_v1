import { TARGET_TYPES } from "@repo/core";
import { describe, expect, it } from "vitest";
import { PLANS, VETTING_STATUSES } from "./entitlements.ts";
import {
  decideTargetAccess,
  PERSON_TARGET_TYPES,
  plannedTargetTypes,
  runRestsOnPersonTarget,
  targetRestsOnPersonData,
} from "./person-target.ts";

describe("person target types: person data by the target alone (RELEASE-BLOCKING)", () => {
  it("TOPIC is person data whatever collects it, and no other type is", () => {
    expect(PERSON_TARGET_TYPES).toEqual(["TOPIC"]);
    for (const type of TARGET_TYPES) {
      expect(targetRestsOnPersonData(type), type).toBe(type === "TOPIC");
    }
  });

  it("collecting on a TOPIC needs the person plan AND approved vetting, for every tenant", () => {
    for (const plan of PLANS) {
      for (const vettingStatus of VETTING_STATUSES) {
        const decision = decideTargetAccess({ plan, vettingStatus }, "TOPIC");
        if (plan === "TECHINT") {
          expect(decision).toEqual({ allowed: false, reason: "MODULE_NOT_IN_PLAN" });
        } else if (vettingStatus !== "APPROVED") {
          expect(decision).toEqual({ allowed: false, reason: "VETTING_NOT_APPROVED" });
        } else {
          expect(decision).toEqual({ allowed: true });
        }
      }
    }
  });

  it("any other target type adds no condition of its own", () => {
    for (const type of TARGET_TYPES.filter((candidate) => candidate !== "TOPIC")) {
      expect(decideTargetAccess({ plan: "TECHINT", vettingStatus: "NOT_SUBMITTED" }, type)).toEqual(
        { allowed: true },
      );
    }
  });
});

describe("which target types a run plans, and whether it rests on a person target (RELEASE-BLOCKING)", () => {
  it("a chosen TOPIC is planned, and the run rests on a person target", () => {
    expect(plannedTargetTypes("[a phrase]", "TOPIC")).toEqual(["TOPIC"]);
    expect(runRestsOnPersonTarget("[a phrase]", "TOPIC")).toBe(true);
  });

  it("a TOPIC detected first is planned: a hashtag or a quoted phrase", () => {
    for (const input of ["#elections", '"a quoted phrase"']) {
      expect(plannedTargetTypes(input, null)).toEqual(["TOPIC"]);
      expect(runRestsOnPersonTarget(input, null), input).toBe(true);
    }
  });

  it("a TOPIC that detection offers only as an alternate is never planned", () => {
    // Detection still reports it (packages/core); planning leaves it out, so an
    // ordinary search stays what it was.
    expect(plannedTargetTypes("[two words]", null)).toEqual(["ORGANIZATION"]);
    expect(runRestsOnPersonTarget("[two words]", null)).toBe(false);
  });

  it("a type chosen explicitly is the only type planned, and decides alone", () => {
    expect(plannedTargetTypes("#elections", "USERNAME")).toEqual(["USERNAME"]);
    expect(runRestsOnPersonTarget("#elections", "USERNAME")).toBe(false);
    expect(runRestsOnPersonTarget("example.com", null)).toBe(false);
  });

  it("an empty input plans nothing, so it rests on nothing", () => {
    expect(() => plannedTargetTypes("   ", null)).toThrow(/empty/);
    expect(runRestsOnPersonTarget("   ", null)).toBe(false);
  });
});
