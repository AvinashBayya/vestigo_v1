/**
 * The citation validator. Each REGRESSION names the defect the audit found in
 * the previous codebase's validators (reports.ts validateCitations and
 * cases/case-analysis.ts validateGroundedAnswer).
 */
import { describe, expect, it } from "vitest";
import { assertsCertainty, validateCitations, type CitationContext } from "../src/index.ts";

const context: CitationContext = {
  refs: new Map([
    ["E1", { source: "crtsh" }],
    ["E2", { source: "crtsh" }],
    ["E3", { source: "rdap" }],
  ]),
};

const codes = (statements: Parameters<typeof validateCitations>[0]) =>
  validateCitations(statements, context).map((p) => `${String(p.statement)}:${p.code}`);

describe("the citation validator", () => {
  it("accepts statements that each cite known evidence", () => {
    expect(
      codes([
        { text: "[finding one]", strength: "INFERRED", refs: ["E1"] },
        { text: "[finding two]", strength: "CORRELATED", refs: ["E1", "E3"] },
      ]),
    ).toEqual([]);
  });

  // REGRESSION (case-analysis.ts): INFERRED and HYPOTHESIS findings could cite
  // nothing. Every claim maps to evidence, whatever its strength.
  it("rejects an uncited statement of every strength", () => {
    for (const strength of ["INFERRED", "HYPOTHESIS", "CORRELATED"]) {
      expect(codes([{ text: "[finding]", strength, refs: [] }]), strength).toContain(
        "0:CITATION_MISSING",
      );
    }
  });

  // REGRESSION (reports.ts): the bottom line carried no citation and was never
  // validated. Here a summary is just another statement: nothing is exempt.
  it("gives no statement an exemption, the summary included", () => {
    expect(
      codes([
        { text: "[bottom line]", strength: "INFERRED", refs: [] },
        { text: "[finding]", strength: "INFERRED", refs: ["E1"] },
      ]),
    ).toEqual(["0:CITATION_MISSING"]);
  });

  it("rejects an answer with no statements at all", () => {
    expect(codes([])).toEqual(["null:NO_STATEMENTS"]);
  });

  // REGRESSION (reports.ts): citations were document-local numbers, so any
  // number in range passed. References are checked against the supplied set.
  it("rejects a reference that was never supplied", () => {
    expect(codes([{ text: "[finding]", strength: "INFERRED", refs: ["E1", "E9"] }])).toEqual([
      "0:CITATION_UNKNOWN",
    ]);
  });

  // REGRESSION (reports.ts): corroboration counted cited numbers, so two items
  // from one source "corroborated" each other.
  it("does not count two items from one source as corroboration", () => {
    expect(
      codes([
        {
          text: "[claim] is corroborated by the records",
          strength: "INFERRED",
          refs: ["E1", "E2"],
        },
        { text: "[link]", strength: "CORRELATED", refs: ["E1", "E2"] },
      ]),
    ).toEqual(["0:CORROBORATION_SINGLE_SOURCE", "1:CORRELATION_SINGLE_SOURCE"]);
    expect(
      codes([{ text: "[claim] is corroborated", strength: "CORRELATED", refs: ["E1", "E3"] }]),
    ).toEqual([]);
  });

  it("rejects certainty the evidence cannot support, but allows its negation", () => {
    expect(codes([{ text: "[fact] is confirmed", strength: "INFERRED", refs: ["E1"] }])).toEqual([
      "0:CERTAINTY_ASSERTED",
    ]);
    expect(assertsCertainty("[fact] is not confirmed by the records")).toBe(false);
    expect(assertsCertainty("[fact] remains to be verified")).toBe(false);
    expect(assertsCertainty("[fact] has been verified")).toBe(true);
  });

  // REGRESSION (reports.ts, case-analysis.ts): problems quoted the model's own
  // words ("Key judgement 1 (\"...\")"), which went back into the retry prompt.
  it("never quotes the statement in its problem messages", () => {
    const planted = "[planted phrase from a source]";
    const problems = validateCitations(
      [{ text: `${planted} is confirmed`, strength: "CORRELATED", refs: [] }],
      context,
    );
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) expect(problem.message).not.toContain(planted);
  });
});
