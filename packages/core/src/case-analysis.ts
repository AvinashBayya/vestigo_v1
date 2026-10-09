/**
 * A case analysis (R1-b): case-engine's documents for one case, computed from
 * exactly the input its hash names, stored once.
 *
 * Additive only (CLAUDE.md §7). The database enum is generated from this list.
 */

/**
 * Where an attempt at an analysis stands. PENDING: requested, not finished.
 * COMPLETE: finished, with its document. FAILED: finished without one, with a
 * coded reason. Each is a row of its own: a stored status is never rewritten.
 */
export const CASE_ANALYSIS_STATUSES = ["PENDING", "COMPLETE", "FAILED"] as const;
export type CaseAnalysisStatus = (typeof CASE_ANALYSIS_STATUSES)[number];
