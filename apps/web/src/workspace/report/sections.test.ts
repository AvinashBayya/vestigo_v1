// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ReportDocument } from "./queries.ts";
import { citationsOf, sectionId, sectionsOf } from "./sections.ts";

const HEADINGS = {
  coverage: "[coverage heading]",
  notCollected: "[not collected heading]",
  collected: "[collected heading]",
  standingLimits: "[standing limits heading]",
  glossary: "[glossary heading]",
  synthesis: "[synthesis heading]",
  findings: "[findings heading]",
  relationships: "[relationships heading]",
  untrustedContent: "[untrusted content heading]",
  evidenceBasis: "[evidence basis heading]",
  attribution: "[attribution heading]",
  renderingNote: "[rendering note heading]",
};

/** Only the parts of a stored document the helpers read; the rest is not needed here. */
function documentWith(parts: {
  readonly synthesis?: unknown;
  readonly findingCitations?: readonly (readonly number[])[];
  readonly relationshipCitations?: readonly (readonly number[])[];
  readonly untrusted?: readonly number[];
  readonly sources?: readonly number[];
}): ReportDocument {
  return {
    wording: { headings: HEADINGS },
    synthesis: parts.synthesis ?? { status: "NOT_REQUESTED" },
    findings: [{ claims: (parts.findingCitations ?? []).map((citations) => ({ citations })) }],
    relationships: (parts.relationshipCitations ?? []).map((citations) => ({ citations })),
    untrustedContent: (parts.untrusted ?? []).map((sourceNumber) => ({
      sourceNumber,
      patterns: [],
    })),
    sources: (parts.sources ?? []).map((number) => ({ number })),
  } as unknown as ReportDocument;
}

describe("the stored report's sections", () => {
  it("are listed in the PDF's order with the stored headings, relationships and untrusted content only when present", () => {
    expect(sectionsOf(documentWith({})).map((section) => section.label)).toEqual([
      HEADINGS.coverage,
      HEADINGS.glossary,
      HEADINGS.synthesis,
      HEADINGS.findings,
      HEADINGS.evidenceBasis,
      HEADINGS.attribution,
    ]);
    expect(
      sectionsOf(documentWith({ relationshipCitations: [[1]], untrusted: [2] })).map(
        (section) => section.key,
      ),
    ).toEqual([
      "coverage",
      "glossary",
      "synthesis",
      "findings",
      "relationships",
      "untrustedContent",
      "evidenceBasis",
      "attribution",
    ]);
    expect(sectionId("findings")).toBe("report-section-findings");
  });

  it("cite the distinct numbers the stored document records, sorted, keeping a number no source matches", () => {
    const document = documentWith({
      synthesis: {
        status: "GENERATED",
        statements: [{ citations: [3, 1] }, { citations: [1] }],
      },
      findingCitations: [[2, 9], [2]],
      relationshipCitations: [[4]],
      untrusted: [5, 5],
      sources: [1, 2, 3],
    });
    expect(citationsOf(document, "synthesis")).toEqual([1, 3]);
    expect(citationsOf(document, "findings")).toEqual([2, 9]);
    expect(citationsOf(document, "relationships")).toEqual([4]);
    expect(citationsOf(document, "untrustedContent")).toEqual([5]);
    expect(citationsOf(document, "evidenceBasis")).toEqual([1, 2, 3]);
    expect(citationsOf(document, "coverage")).toEqual([]);
    expect(citationsOf(document, "glossary")).toEqual([]);
    expect(citationsOf(document, "attribution")).toEqual([]);
  });

  it("a synthesis that was not written cites nothing", () => {
    expect(
      citationsOf(documentWith({ synthesis: { status: "NOT_REQUESTED" } }), "synthesis"),
    ).toEqual([]);
    expect(
      citationsOf(
        documentWith({ synthesis: { status: "SKIPPED", reason: "[reason]" } }),
        "synthesis",
      ),
    ).toEqual([]);
  });
});
