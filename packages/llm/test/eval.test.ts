/**
 * The evaluation harness, in CI. It scores the golden set's hand-written
 * reference answers (which must be perfect) and its probes (each written with
 * one known defect, which must be caught). This keeps the harness and the
 * validators honest; scoring a model is the live mode's job
 * (scripts/eval-live.ts), which needs a configured provider.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  meetsThresholds,
  scoreAnswer,
  summarise,
  type GoldenCase,
  type GoldenStatement,
} from "../src/index.ts";

interface GoldenFile {
  readonly cases: readonly (GoldenCase & {
    readonly reference: readonly GoldenStatement[];
    readonly probes: readonly {
      readonly label: string;
      readonly statements: readonly GoldenStatement[];
      readonly detects: "citation" | "hallucination";
    }[];
  })[];
}

const golden = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "eval", "golden.json"), "utf8"),
) as GoldenFile;

describe("the golden set", () => {
  it("holds several investigations, each with a reference answer and probes", () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(3);
    for (const c of golden.cases) {
      expect(c.reference.length, c.id).toBeGreaterThan(0);
      expect(c.probes.length, c.id).toBeGreaterThan(0);
    }
  });

  it("scores the reference answers at full citation validity and no hallucination", () => {
    const scores = golden.cases.map((c) => scoreAnswer(c, c.reference));
    for (const [index, score] of scores.entries()) {
      expect(score.problems, golden.cases[index]?.id).toEqual([]);
    }
    const summary = summarise(scores);
    expect(summary).toMatchObject({ citationValidity: 1, hallucinationRate: 0 });
    expect(meetsThresholds(summary)).toBe(true);
  });

  describe.each(
    golden.cases.flatMap((c) => c.probes.map((p) => [`${c.id}: ${p.label}`, c, p] as const)),
  )("%s", (_name, golden, probe) => {
    it(`is caught as a ${probe.detects} failure`, () => {
      const score = scoreAnswer(golden, probe.statements);
      if (probe.detects === "citation") {
        expect(score.citationValid).toBeLessThan(score.statements);
      } else {
        expect(score.hallucinated).toBeGreaterThan(0);
      }
      expect(meetsThresholds(summarise([score]))).toBe(false);
    });
  });

  it("reports nothing measured as null, never as a perfect score", () => {
    expect(summarise([])).toEqual({
      answers: 0,
      statements: 0,
      citationValidity: null,
      hallucinationRate: null,
    });
    expect(meetsThresholds(summarise([]))).toBe(false);
  });
});
