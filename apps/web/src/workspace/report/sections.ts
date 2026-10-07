import type { ReportDocument } from "./queries.ts";

/** The stored report's sections, by the key its wording names their heading with. */
export type SectionKey =
  | "coverage"
  | "glossary"
  | "synthesis"
  | "findings"
  | "relationships"
  | "untrustedContent"
  | "evidenceBasis"
  | "attribution";

export type ReportSectionEntry = { readonly key: SectionKey; readonly label: string };

/** The in-page anchor of a section. */
export const sectionId = (key: SectionKey) => `report-section-${key}`;

/** The in-page anchor of the stored PDF's card. */
export const PDF_ANCHOR = "report-pdf";

/**
 * The stored document's sections in the order its PDF prints them
 * (packages/integrations/src/exports/pdf.ts), labelled with the stored
 * headings. Relationships and untrusted content are printed only when the
 * document holds any, so they are listed only then.
 */
export function sectionsOf(document: ReportDocument): readonly ReportSectionEntry[] {
  const headings = document.wording.headings;
  const keys: SectionKey[] = ["coverage", "glossary", "synthesis", "findings"];
  if (document.relationships.length > 0) keys.push("relationships");
  if (document.untrustedContent.length > 0) keys.push("untrustedContent");
  keys.push("evidenceBasis", "attribution");
  return keys.map((key) => ({ key, label: headings[key] }));
}

const distinctSorted = (numbers: Iterable<number>): readonly number[] =>
  [...new Set(numbers)].toSorted((a, b) => a - b);

/**
 * The distinct citation numbers a section cites, as the stored document
 * records them, sorted. A number no source matches is kept: the screen says
 * so in the stored wording rather than dropping it. The evidence basis lists
 * every source; coverage, the glossary and attribution cite nothing.
 */
export function citationsOf(document: ReportDocument, key: SectionKey): readonly number[] {
  switch (key) {
    case "synthesis":
      return document.synthesis.status === "GENERATED"
        ? distinctSorted(document.synthesis.statements.flatMap((statement) => statement.citations))
        : [];
    case "findings":
      return distinctSorted(
        document.findings.flatMap((finding) => finding.claims.flatMap((claim) => claim.citations)),
      );
    case "relationships":
      return distinctSorted(document.relationships.flatMap((entry) => entry.citations));
    case "untrustedContent":
      return distinctSorted(document.untrustedContent.map((entry) => entry.sourceNumber));
    case "evidenceBasis":
      return distinctSorted(document.sources.map((source) => source.number));
    case "coverage":
    case "glossary":
    case "attribution":
      return [];
  }
}
