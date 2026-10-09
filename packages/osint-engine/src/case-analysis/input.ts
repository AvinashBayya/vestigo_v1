/**
 * A case's analysis input, read from what is stored, and its hash (owner
 * ruling D-3: computed here, never in case-engine).
 *
 * The hash covers everything the analysis reads, not only the plan's list
 * (evidence ids, claim ids, active merges, jobs with status and outcome, held
 * collectors, registry disciplines and labels, engine version): every field of
 * the CaseInput case-engine computes from (a job's attempts and errors, a run's
 * plan and times, an investigation's title, evidence times and strength, each
 * claim's subject and strength), the active merges reachable from the case's
 * entities, case-engine's ENGINE_VERSION and the CASE_WORDING a document would
 * carry. A stored analysis whose hash differs from the case's now was computed
 * from different input, and a read says so.
 */
import { ENGINE_VERSION, type CaseInput } from "@repo/case-engine";
import { CASE_WORDING } from "@repo/core";
import type { Reads } from "@repo/db";
import { coveragePlan } from "../reports/stored-plan.ts";
import { canonicalJson, sha256Of } from "./canonical.ts";
import type { CaseAnalysisCollectors } from "./collectors.ts";

/** What one analysis reads: case-engine's input, and the active merges it is folded with (R1-c). */
export interface CaseAnalysisInput {
  readonly input: CaseInput;
  readonly activeMergeIds: readonly string[];
}

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

/**
 * The case's input as stored now. Read inside one repeatable-read transaction
 * (D-32) when the lists must agree with each other and with a person probe.
 */
export async function readCaseAnalysisInput(
  reads: Pick<Reads, "caseScope">,
  caseId: string,
  collectors: CaseAnalysisCollectors,
): Promise<CaseAnalysisInput> {
  // A uuid's text is lowercase, as Postgres returns it: the hash never depends
  // on how a caller spelled the case id.
  const id = caseId.toLowerCase();
  const records = await reads.caseScope.records(id);
  return {
    input: {
      caseId: id,
      evidence: records.evidence.map((row) => ({
        id: row.id,
        collectorId: row.collectorId,
        jobId: row.jobId,
        collectedAt: iso(row.collectedAt),
        observedAt: iso(row.observedAt),
        strength: row.claimStrength,
      })),
      claims: records.claims.map((row) => ({
        id: row.id,
        evidenceId: row.evidenceId,
        entityId: row.entityId,
        relationshipId: row.relationshipId,
        strength: row.strength,
      })),
      entities: records.entityIds.map((id) => ({ id })),
      relationships: records.relationshipIds.map((id) => ({ id })),
      jobs: records.jobs.map((row) => ({
        id: row.id,
        runId: row.runId,
        collectorId: row.collectorId,
        status: row.status,
        outcome: row.outcome,
        outcomeDetail: row.outcomeDetail,
        targetType: row.targetType,
        attempts: row.attempts,
        evidenceIds: row.evidenceIds,
        lastErrorCode: row.lastErrorCode,
        lastErrorMessage: row.lastErrorMessage,
      })),
      runs: records.runs.map((row) => ({
        id: row.id,
        investigationId: row.investigationId,
        investigationTitle: row.investigationTitle,
        status: row.status,
        plan: coveragePlan(row.plan),
        startedAt: iso(row.startedAt),
        finishedAt: iso(row.finishedAt),
      })),
      registry: collectors.registry,
      held: collectors.held,
    },
    activeMergeIds: records.activeMergeIds,
  };
}

/** What the hash covers, beside the input itself. */
export interface CaseInputHashBasis {
  readonly engineVersion: number;
  readonly wording: unknown;
}

/** The analysis code and wording in force now. */
export const CURRENT_HASH_BASIS: CaseInputHashBasis = {
  engineVersion: ENGINE_VERSION,
  wording: CASE_WORDING,
};

/** `sha256:<64 hex>` of the canonical input, its merges, the engine version and the wording. */
export function caseInputHash(
  read: CaseAnalysisInput,
  basis: CaseInputHashBasis = CURRENT_HASH_BASIS,
): string {
  return sha256Of(
    canonicalJson({
      engineVersion: basis.engineVersion,
      wording: basis.wording,
      input: read.input,
      activeMergeIds: read.activeMergeIds,
    }),
  );
}
