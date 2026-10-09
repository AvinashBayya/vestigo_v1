import { describe, expect, it } from "vitest";
import { PLANS, VETTING_STATUSES, type TenantEntitlement } from "./entitlements.ts";
import { personGate } from "./person-gate.ts";

/** A probe that records whether it was asked. */
function probe(answer: boolean) {
  const calls = { count: 0 };
  return {
    calls,
    restsOnPersonData: () => {
      calls.count += 1;
      return Promise.resolve(answer);
    },
  };
}

const ALLOWED: TenantEntitlement = { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" };

describe("personGate, the one person-access decision for the API and the workers (RELEASE-BLOCKING)", () => {
  it("lets an allowed tenant through without asking the probe", async () => {
    const asked = probe(true);
    expect(await personGate(ALLOWED, asked.restsOnPersonData)).toBeNull();
    expect(asked.calls.count).toBe(0);
  });

  it("lets a read with no person data through for every locked tenant", async () => {
    for (const plan of PLANS) {
      for (const vettingStatus of VETTING_STATUSES) {
        if (plan === "TECHINT_AND_PERSON" && vettingStatus === "APPROVED") continue;
        const asked = probe(false);
        expect(await personGate({ plan, vettingStatus }, asked.restsOnPersonData)).toBeNull();
        expect(asked.calls.count).toBe(1);
      }
    }
  });

  it("refuses a read resting on person data with the reason, and says why and what next", async () => {
    for (const plan of PLANS) {
      for (const vettingStatus of VETTING_STATUSES) {
        if (plan === "TECHINT_AND_PERSON" && vettingStatus === "APPROVED") continue;
        const lock = await personGate({ plan, vettingStatus }, probe(true).restsOnPersonData);
        expect(lock).toMatchObject({
          module: "PERSON_INVESTIGATION",
          reason: plan === "TECHINT" ? "MODULE_NOT_IN_PLAN" : "VETTING_NOT_APPROVED",
          plan,
          vettingStatus,
        });
        expect(lock?.moduleSummary).toMatch(/.{11,}/);
        expect(lock?.nextStep).toMatch(/.{11,}/);
      }
    }
  });
});
