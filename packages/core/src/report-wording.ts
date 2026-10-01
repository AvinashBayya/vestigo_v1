/**
 * Every fixed word a rendered report prints: the claim-strength glossary,
 * section headings, coverage labels, notices, footnote phrasing, table
 * headings, and the absence markers the tabular exports use.
 *
 * A report is an evidence artefact: downloading it later must produce the
 * same document. So this wording is SNAPSHOT into each report when it is
 * generated (ReportDocument.wording), and renderers print only the stored
 * copy. Changing the text here changes reports generated from then on, never
 * one already generated.
 *
 * Templates mark values as {name}; renderers fill them with fillWording().
 */
import type { CoverageState } from "./report.ts";
import { CLAIM_STRENGTHS, type ClaimStrength } from "./vocabulary.ts";

/** What each claim strength means. OBSERVED stays listed although no collector produces it yet. */
export const CLAIM_STRENGTH_DEFINITIONS: Readonly<Record<ClaimStrength, string>> = {
  OBSERVED: "Seen directly by the platform, not taken from anyone's statement.",
  REPORTED:
    "Stated by the cited source. The platform recorded the statement; it did not verify the fact.",
  DERIVED:
    "Computed by the platform from recorded values (a count, a parsed date, a split list). No source stated it.",
  CORRELATED: "A link drawn by the analysis model between two or more independent cited sources.",
  INFERRED:
    "An analytic inference drawn by the analysis model from the cited evidence. No source stated it.",
  HYPOTHESIS: "A possibility the cited evidence permits but does not establish.",
};

export interface ReportWording {
  /** The glossary, in the order it is printed. */
  readonly glossary: readonly { readonly strength: ClaimStrength; readonly definition: string }[];
  readonly headings: {
    readonly coverage: string;
    readonly notCollected: string;
    readonly collected: string;
    readonly standingLimits: string;
    readonly glossary: string;
    readonly synthesis: string;
    readonly findings: string;
    readonly relationships: string;
    readonly untrustedContent: string;
    readonly evidenceBasis: string;
    readonly attribution: string;
    readonly renderingNote: string;
  };
  readonly cover: {
    readonly target: string;
    readonly collectedAs: string;
    readonly run: string;
    /** {runId}, {status} */
    readonly runValue: string;
    readonly generated: string;
  };
  readonly marking: {
    /** {marking} */
    readonly set: string;
    readonly notSet: string;
  };
  readonly footer: {
    /** {reportId} */
    readonly report: string;
    /** {page}, {pages} */
    readonly page: string;
  };
  readonly states: Readonly<Record<CoverageState, string>>;
  readonly coverage: {
    readonly allCollected: string;
    readonly noneCollected: string;
    readonly notApplicable: string;
    /** {count} */
    readonly evidenceItems: string;
    /** {count} */
    readonly attempts: string;
    /** {count} */
    readonly omittedClaims: string;
  };
  readonly synthesis: {
    /** {id}, {licence}, {profile} */
    readonly model: string;
    readonly notRequested: string;
    /** {reason} */
    readonly none: string;
  };
  readonly findings: {
    readonly none: string;
    readonly emptyValue: string;
    readonly shortened: string;
  };
  readonly untrustedContent: {
    readonly intro: string;
    /** {number}, {patterns} */
    readonly line: string;
  };
  readonly evidence: {
    readonly intro: string;
    readonly none: string;
    readonly columns: {
      readonly number: string;
      readonly source: string;
      readonly collected: string;
      readonly strength: string;
      readonly claims: string;
    };
    readonly notRecorded: string;
    /** {evidenceId}, {contentHash}, {url} */
    readonly detail: string;
    readonly noUrl: string;
  };
  readonly footnote: {
    /** {number}, {label}, {collected}, {url}, {evidenceId} */
    readonly line: string;
    /** {at} */
    readonly collectedAt: string;
    readonly collectedUnknown: string;
    readonly noUrl: string;
    /** {number} */
    readonly missing: string;
  };
  readonly attribution: { readonly none: string };
  /** {count} */
  readonly renderingNote: string;
  /** Absence markers in the CSV and Maltego exports. */
  readonly tabular: { readonly markingNotSet: string; readonly notRecorded: string };
}

/** The wording reports are generated with from now on. Snapshot it; never render from it. */
export const REPORT_WORDING: ReportWording = {
  glossary: CLAIM_STRENGTHS.map((strength) => ({
    strength,
    definition: CLAIM_STRENGTH_DEFINITIONS[strength],
  })),
  headings: {
    coverage: "Coverage and limitations",
    notCollected: "What was not collected, and why",
    collected: "What was collected",
    standingLimits: "Standing limits of this report",
    glossary: "How to read the claim labels",
    synthesis: "Synthesis",
    findings: "Findings",
    relationships: "Relationships",
    untrustedContent: "Content that resembles instructions to an AI system",
    evidenceBasis: "Evidence basis",
    attribution: "Attribution",
    renderingNote: "Rendering note",
  },
  cover: {
    target: "Target: ",
    collectedAs: "Collected as: ",
    run: "Run: ",
    runValue: "{runId}, status {status}",
    generated: "Generated: ",
  },
  marking: {
    set: "HANDLING: {marking}",
    notSet: "NO HANDLING MARKING IS SET FOR THIS ORGANISATION",
  },
  footer: { report: "Report {reportId}", page: "Page {page} of {pages}" },
  states: {
    COLLECTED: "COLLECTED",
    NOTHING_FOUND: "NOTHING FOUND",
    FAILED: "FAILED",
    NEEDS_CREDENTIALS: "NEEDS CREDENTIALS",
    REFUSED: "REFUSED",
    NOT_FINISHED: "NOT FINISHED",
    EXCLUDED: "EXCLUDED",
    HELD: "HELD",
  },
  coverage: {
    allCollected: "Every collector planned for this target collected something.",
    noneCollected: "No collector found anything for this target.",
    notApplicable: "Not applicable to this target's type: ",
    evidenceItems: "{count} evidence item(s)",
    attempts: "{count} attempt(s)",
    omittedClaims:
      "{count} further claim(s) were left out of this report at its size limit; the run holds them.",
  },
  synthesis: {
    model: "Model: {id} ({licence}, {profile} profile).",
    notRequested:
      "No synthesis was requested for this report. Every finding below is as collected.",
    none: "No synthesis: {reason}",
  },
  findings: {
    none: "The run recorded no claims.",
    emptyValue: "(empty)",
    shortened: "[shortened; the JSON export holds the full value]",
  },
  untrustedContent: {
    intro:
      "These sources contain text addressed to AI systems, a common form of prompt injection. It was treated as data throughout: it is reported below as collected and was never followed.",
    line: "Source {number}: {patterns}",
  },
  evidence: {
    intro:
      "Every evidence item this report rests on. Numbers match the citations. The content hash identifies the stored raw response.",
    none: "The run recorded no evidence.",
    columns: {
      number: "No.",
      source: "Source",
      collected: "Collected",
      strength: "Strength",
      claims: "Claims",
    },
    notRecorded: "not recorded",
    detail: "Evidence {evidenceId}. {contentHash}. {url}",
    noUrl: "No URL recorded.",
  },
  footnote: {
    line: "{number}. {label}, {collected}. {url}. Evidence {evidenceId}.",
    collectedAt: "collected {at}",
    collectedUnknown: "collection time not recorded",
    noUrl: "no URL recorded",
    missing: "{number}. Source not found in this report.",
  },
  attribution: { none: "No source used in this report requires attribution." },
  renderingNote:
    '{count} character(s) in this report are outside the embedded font\'s coverage and are shown as "?". The JSON export holds the exact text.',
  tabular: { markingNotSet: "not set", notRecorded: "not recorded" },
};

/** Fills a wording template's {name} slots. A slot with no value is left visible, never blanked. */
export function fillWording(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (slot, name: string) => values[name] ?? slot);
}
