/**
 * Contradiction review: two or more stored claims that state different values
 * for the same attribute of the same entity are surfaced for review, never
 * resolved. These tests pin that behaviour and guard the legacy defects it
 * must not reintroduce (resolving a conflict, inferring from identity, reading
 * agreement as conflict).
 */
import type { ClaimStrength } from "@repo/core";
import { describe, expect, it } from "vitest";
import { caseContradictions, CONTRADICTION_CAVEAT } from "../src/analysis/case-contradictions.ts";
import type { CaseClaim, CaseInput } from "../src/analysis/case-input.ts";
import { EMPTY } from "./fixtures.ts";

let n = 0;
function claim(
  entityId: string | null,
  attribute: string | undefined,
  value: unknown,
  strength: ClaimStrength = "REPORTED",
  evidenceId = `ev${String((n += 1))}`,
): CaseClaim {
  return {
    id: `c${String(n)}`,
    evidenceId,
    entityId,
    relationshipId: null,
    strength,
    ...(attribute === undefined ? {} : { attribute }),
    ...(value === undefined ? {} : { value }),
  };
}

const inputWith = (claims: readonly CaseClaim[]): CaseInput => ({ ...EMPTY, claims });

describe("caseContradictions", () => {
  it("reports an attribute two sources disagree on as reviewable positions, resolving nothing", () => {
    const result = caseContradictions(
      inputWith([
        claim("org1", "founded_year", "1998", "REPORTED", "evA"),
        claim("org1", "founded_year", "2004", "REPORTED", "evB"),
      ]),
    );
    expect(result.items).toHaveLength(1);
    const [item] = result.items;
    expect(item?.entityId).toBe("org1");
    expect(item?.attribute).toBe("founded_year");
    expect(item?.positions.map((p) => p.value)).toEqual(["1998", "2004"]);
    // Nothing is resolved: a position carries only its value and its support —
    // no "winner"/"correct"/"chosen" field by which one could be settled.
    expect(new Set(item?.positions.flatMap((p) => Object.keys(p)))).toEqual(
      new Set(["value", "evidenceIds", "strengths"]),
    );
    expect(new Set(Object.keys(item ?? {}))).toEqual(
      new Set(["entityId", "attribute", "positions"]),
    );
    expect(result.caveat).toBe(CONTRADICTION_CAVEAT);
  });

  it("treats the same value from several sources as corroboration, not a contradiction", () => {
    const result = caseContradictions(
      inputWith([
        claim("org1", "headquarters", "Berlin", "REPORTED", "evA"),
        claim("org1", "headquarters", "Berlin", "OBSERVED", "evB"),
      ]),
    );
    expect(result.items).toEqual([]);
  });

  it("ignores relationship claims, value-less claims, and claims without an attribute", () => {
    const result = caseContradictions(
      inputWith([
        // A relationship claim (no entity subject): never a contradiction.
        {
          id: "cr",
          evidenceId: "evA",
          entityId: null,
          relationshipId: "rel1",
          strength: "REPORTED",
        },
        // A value-less claim about the same attribute: asserts nothing.
        claim("org1", "status", null, "REPORTED", "evB"),
        claim("org1", "status", "active", "REPORTED", "evC"),
        // No attribute carried (input did not supply it): not compared.
        {
          id: "cn",
          evidenceId: "evD",
          entityId: "org1",
          relationshipId: null,
          strength: "REPORTED",
          value: "x",
        },
      ]),
    );
    expect(result.items).toEqual([]);
  });

  it("preserves each position's evidence and strengths, de-duplicated and in strength order", () => {
    const result = caseContradictions(
      inputWith([
        claim("p1", "role", "ceo", "REPORTED", "ev2"),
        claim("p1", "role", "ceo", "OBSERVED", "ev1"),
        claim("p1", "role", "advisor", "INFERRED", "ev3"),
      ]),
    );
    expect(result.items).toHaveLength(1);
    const positions = result.items[0]?.positions ?? [];
    const ceo = positions.find((p) => p.value === "ceo");
    expect(ceo?.evidenceIds).toEqual(["ev1", "ev2"]); // sorted, de-duplicated
    expect(ceo?.strengths).toEqual(["OBSERVED", "REPORTED"]); // CLAIM_STRENGTHS order
    const advisor = positions.find((p) => p.value === "advisor");
    expect(advisor?.strengths).toEqual(["INFERRED"]);
  });

  it("is deterministic regardless of claim order", () => {
    const claims = [
      claim("b", "x", "1", "REPORTED", "e1"),
      claim("a", "y", "true", "REPORTED", "e2"),
      claim("a", "y", "false", "REPORTED", "e3"),
      claim("b", "x", "2", "REPORTED", "e4"),
    ];
    const forward = caseContradictions(inputWith(claims));
    const reversed = caseContradictions(inputWith([...claims].reverse()));
    expect(JSON.stringify(forward)).toBe(JSON.stringify(reversed));
    // Sorted by entity then attribute.
    expect(forward.items.map((i) => [i.entityId, i.attribute])).toEqual([
      ["a", "y"],
      ["b", "x"],
    ]);
  });

  it("distinguishes structurally equal object values from different ones", () => {
    const same = caseContradictions(
      inputWith([
        claim("e", "loc", { lat: 1, lon: 2 }, "REPORTED", "e1"),
        claim("e", "loc", { lon: 2, lat: 1 }, "REPORTED", "e2"), // same value, keys reordered
      ]),
    );
    expect(same.items).toEqual([]);
    const differ = caseContradictions(
      inputWith([
        claim("e", "loc", { lat: 1, lon: 2 }, "REPORTED", "e1"),
        claim("e", "loc", { lat: 9, lon: 2 }, "REPORTED", "e2"),
      ]),
    );
    expect(differ.items).toHaveLength(1);
  });
});
