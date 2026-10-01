/**
 * The report document: what a generated report says, independent of how it
 * is rendered (PDF, JSON, screen). Built once from a run's stored evidence,
 * claims and job outcomes, then stored; renderers only lay it out.
 *
 * Additive only (CLAUDE.md §7). A reader never has to guess at an absence:
 * every value that was not measured is null, and every collector that did not
 * contribute is named in `coverage` with its reason.
 */
import type { ClaimStrength, EntityKind, RunStatus, TargetType } from "./vocabulary.ts";

export const REPORT_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_FORMAT_VERSION = 1;

/** What each claim strength means, printed with every report that uses the labels. */
export const CLAIM_STRENGTH_DEFINITIONS: Readonly<Record<ClaimStrength, string>> = {
  OBSERVED: "Seen directly by the platform, not taken from anyone's statement.",
  REPORTED:
    "Stated by the cited source. The platform recorded the statement; it did not verify the fact.",
  DERIVED:
    "Computed by the platform from recorded values (a count, a parsed date, a split list). No source stated it.",
  CORRELATED: "A link drawn between two or more independent cited sources.",
  INFERRED: "An analytic inference from the cited evidence. No source stated it.",
  HYPOTHESIS: "A possibility the cited evidence permits but does not establish.",
};

/**
 * What happened to one collector, as the coverage section states it. Only
 * COLLECTED contributed evidence; every other state is something the report
 * did not cover, and says why.
 */
export const COVERAGE_STATES = [
  /** The collector found something; its evidence is cited below. */
  "COLLECTED",
  /** The collector ran and the source had nothing for this target. */
  "NOTHING_FOUND",
  /** The collector ran and did not complete: an error, or retries ran out. */
  "FAILED",
  /** The collector needs a credential the tenant has not stored. */
  "NEEDS_CREDENTIALS",
  /** The collector refused the job (a policy, an invalid target, a refusal by the source). */
  "REFUSED",
  /** The job had not finished when the report was generated. */
  "NOT_FINISHED",
  /** Planned out before the run: the plan, vetting, licence or scope did not allow it. */
  "EXCLUDED",
  /** Built but held off the platform, so it never runs (see its reason). */
  "HELD",
] as const;
export type CoverageState = (typeof COVERAGE_STATES)[number];

export interface CoverageEntry {
  readonly collectorId: string;
  readonly sourceLabel: string;
  readonly state: CoverageState;
  /** The target type it ran against, or was considered for; null when none applied. */
  readonly targetType: TargetType | null;
  /** Machine-readable: an error code or exclusion reason. Null for COLLECTED. */
  readonly reasonCode: string | null;
  /** In words: the error, the NOT_FOUND detail, or the exclusion's message. */
  readonly detail: string | null;
  /** Evidence items this collector contributed. */
  readonly evidenceCount: number;
  /** Attempts made; null when no job existed (excluded or held). */
  readonly attempts: number | null;
}

export interface ReportCoverage {
  readonly runStatus: RunStatus;
  /** True unless every planned collector completed. A partial report says so on its first page. */
  readonly partial: boolean;
  /** One sentence stating what the run covered, first thing in the section. */
  readonly headline: string;
  readonly entries: readonly CoverageEntry[];
  /** Collectors that do not accept this target's type: not a gap, listed for completeness. */
  readonly notApplicable: readonly { readonly collectorId: string; readonly sourceLabel: string }[];
  /** Standing limits of any report, stated every time. */
  readonly caveats: readonly string[];
}

/** One cited source: an evidence item, numbered in the order it is first cited. */
export interface ReportSource {
  readonly number: number;
  readonly evidenceId: string;
  readonly collectorId: string;
  /** The collector's registry label, never a string the collector supplied. */
  readonly sourceLabel: string;
  readonly sourceUrl: string | null;
  /** ISO 8601, or null when not known. */
  readonly collectedAt: string | null;
  readonly observedAt: string | null;
  readonly contentHash: string;
  /** The evidence's own strength. */
  readonly strength: ClaimStrength;
  /** Claims in this report resting on this evidence. */
  readonly claimCount: number;
}

export interface ReportClaim {
  readonly claimId: string;
  readonly attribute: string;
  /** The claim's value exactly as stored (JSON). */
  readonly value: unknown;
  /** The value as text for display; `display.truncated` says when it was shortened. */
  readonly display: { readonly text: string; readonly truncated: boolean };
  readonly strength: ClaimStrength;
  /** Source numbers. A stored claim cites exactly one evidence item. */
  readonly citations: readonly number[];
}

export interface ReportEntity {
  readonly entityId: string;
  readonly kind: EntityKind;
  readonly displayName: string;
  readonly identifier: string | null;
  readonly claims: readonly ReportClaim[];
}

/** One end of a relationship. */
export interface ReportEndpoint {
  readonly entityId: string;
  readonly kind: EntityKind;
  readonly displayName: string;
  readonly identifier: string | null;
}

export interface ReportRelationship {
  readonly relationshipId: string;
  readonly from: ReportEndpoint;
  readonly kind: string;
  readonly to: ReportEndpoint;
  readonly strength: ClaimStrength;
  readonly citations: readonly number[];
}

/** Strengths a model's statement may carry: never OBSERVED, REPORTED or DERIVED. */
export const SYNTHESIS_STRENGTHS = ["CORRELATED", "INFERRED", "HYPOTHESIS"] as const;
export type SynthesisStrength = (typeof SYNTHESIS_STRENGTHS)[number];

export interface SynthesisStatement {
  readonly text: string;
  readonly strength: SynthesisStrength;
  /** Source numbers; never empty. */
  readonly citations: readonly number[];
}

export type ReportSynthesis =
  | {
      readonly status: "GENERATED";
      readonly model: { readonly id: string; readonly licence: string; readonly profile: string };
      readonly statements: readonly SynthesisStatement[];
      readonly generatedAt: string;
      /** Attempts the model needed to pass validation: 1, or 2 after one retry. */
      readonly attempts: number;
      readonly notice: string;
    }
  | { readonly status: "NOT_REQUESTED" }
  /** Requested, but there was nothing to synthesise (the run produced no evidence). */
  | { readonly status: "SKIPPED"; readonly reason: string };

export interface ReportAttribution {
  readonly sourceId: string;
  readonly text: string;
  readonly url: string;
  readonly collectorIds: readonly string[];
}

/** Evidence whose content resembles instructions to an AI system. It was treated as data. */
export interface UntrustedContentWarning {
  readonly sourceNumber: number;
  readonly patterns: readonly string[];
}

export interface ReportDocument {
  readonly formatVersion: typeof REPORT_FORMAT_VERSION;
  readonly reportId: string;
  readonly title: string;
  readonly investigationId: string;
  readonly runId: string;
  /** The target as entered, and each type it was collected as. */
  readonly target: {
    readonly input: string;
    readonly types: readonly { readonly type: TargetType; readonly value: string }[];
  };
  readonly run: {
    readonly status: RunStatus;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
  };
  readonly generatedAt: string;
  /** The tenant's handling marking, or the platform's; null when neither is set. */
  readonly handlingMarking: string | null;
  readonly coverage: ReportCoverage;
  readonly findings: readonly ReportEntity[];
  readonly relationships: readonly ReportRelationship[];
  readonly sources: readonly ReportSource[];
  readonly synthesis: ReportSynthesis;
  readonly attributions: readonly ReportAttribution[];
  readonly untrustedContent: readonly UntrustedContentWarning[];
  /** Claims left out because the report reached its size limit. Zero: none were. */
  readonly omittedClaims: number;
}
