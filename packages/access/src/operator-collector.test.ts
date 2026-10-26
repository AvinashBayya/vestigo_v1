import { COLLECTOR_DISCIPLINES } from "@repo/core";
import { describe, expect, it } from "vitest";
import { decideDisciplineAccess } from "./entitlements.ts";
import { disciplineFitsOperatorCollector } from "./operator-collector.ts";

describe("an operator's own collector counts as person data, whatever it reads (fail closed)", () => {
  it("fits only the disciplines whose module is the person investigation module", () => {
    const fitting = COLLECTOR_DISCIPLINES.filter(disciplineFitsOperatorCollector);
    expect(fitting).toEqual(["PERSON"]);
  });

  it("so running one needs the person module and approved vetting, as every person collector does", () => {
    for (const discipline of COLLECTOR_DISCIPLINES.filter(disciplineFitsOperatorCollector)) {
      expect(
        decideDisciplineAccess({ plan: "TECHINT", vettingStatus: "APPROVED" }, discipline),
      ).toEqual({ allowed: false, reason: "MODULE_NOT_IN_PLAN" });
      expect(
        decideDisciplineAccess(
          { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" },
          discipline,
        ),
      ).toEqual({ allowed: false, reason: "VETTING_NOT_APPROVED" });
    }
  });
});
