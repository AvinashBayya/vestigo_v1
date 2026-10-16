/**
 * What case analysis reads: plain data the caller maps from stored rows. A
 * case is its pins (owner ruling D-4): the caller resolves them to the
 * evidence, claims, entities and relationships they bring in, and passes the
 * jobs and runs that evidence came from. Nothing here is a database row, a
 * registry object or a model.
 *
 * Source labels and disciplines come only from `registry` and `held`. No
 * record carries a label: a collector never names itself here.
 *
 * Input that contradicts itself is refused whole with a CaseInputError naming
 * every problem. A record is never dropped to make the input consistent.
 */
import {
  AppError,
  CLAIM_STRENGTHS,
  COLLECTOR_DISCIPLINES,
  type ClaimStrength,
  type CollectionMode,
  type CollectorDiscipline,
  type RunStatus,
} from "@repo/core";
import type {
  CoverageCollector,
  CoverageHeldCollector,
  CoverageJob,
  CoveragePlan,
} from "./run-coverage.ts";

/**
 * Why a registered collector never runs, as the registry lists it: its
 * source's licence verdict is BLOCKED, it has no implementation, or its
 * source's licence is UNVERIFIED, which never runs (owner instruction,
 * 2026-10-16). Each is a fact of code, the same in every deployment. Whether
 * an access method is enabled is configuration, so it is not here: a run's
 * plan records it (ACCESS_METHOD_NOT_ENABLED). Additive only.
 */
export const CANNOT_RUN = ["BLOCKED", "NOT_IMPLEMENTED", "UNVERIFIED"] as const;
export type CannotRun = (typeof CANNOT_RUN)[number];

/**
 * A registered collector: its registry label, collection mode and single
 * discipline, and whether the registry lists it as unable to run. One that is
 * still listed, under its label and discipline, and is never counted as a
 * collector that could have run (owner ruling, 2026-10-13).
 */
export interface CaseRegistryCollector extends CoverageCollector {
  readonly discipline: CollectorDiscipline;
  /**
   * Why it never runs (BLOCKED, NOT_IMPLEMENTED, UNVERIFIED); null when the
   * registry lists none of them. A deployment can still refuse one whose
   * access methods it does not enable; the run's plan records that.
   */
  readonly cannotRun: CannotRun | null;
}

/** A collector built but held off the platform, with what it declares and why it is held. */
export interface CaseHeldCollector extends CoverageHeldCollector {
  readonly discipline: CollectorDiscipline;
  readonly collectionMode: CollectionMode;
}

export interface CaseEvidence {
  readonly id: string;
  readonly collectorId: string;
  /** The job that collected it; null when none was recorded (D-4). */
  readonly jobId: string | null;
  /** When it was collected, ISO 8601 as `toISOString` writes it; null when not recorded. */
  readonly collectedAt: string | null;
  /** When the source says the thing happened; null when not recorded. Never stands in for collectedAt. */
  readonly observedAt: string | null;
  /** As recorded on the evidence. */
  readonly strength: ClaimStrength;
}

export interface CaseClaim {
  readonly id: string;
  /** The one evidence item the claim cites; it must be in the case too. */
  readonly evidenceId: string;
  readonly entityId: string | null;
  readonly relationshipId: string | null;
  /** As recorded on the claim. */
  readonly strength: ClaimStrength;
}

export interface CaseEntity {
  readonly id: string;
}

export interface CaseRelationship {
  readonly id: string;
}

/** A collector job of a run the case's evidence came from. */
export interface CaseJob extends CoverageJob {
  readonly id: string;
  readonly runId: string;
}

/** A run the case's evidence came from, with its investigation: a case's runs can span several. */
export interface CaseRun {
  readonly id: string;
  readonly investigationId: string;
  readonly investigationTitle: string;
  readonly status: RunStatus;
  /** The plan the run recorded, never one recomputed now. */
  readonly plan: CoveragePlan;
  /** ISO 8601, or null when not recorded. */
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface CaseInput {
  readonly caseId: string;
  /** Everything the case's pins bring in, resolved by the caller. */
  readonly evidence: readonly CaseEvidence[];
  readonly claims: readonly CaseClaim[];
  readonly entities: readonly CaseEntity[];
  readonly relationships: readonly CaseRelationship[];
  /** Every job of every run the case's evidence came from, and no other job. */
  readonly jobs: readonly CaseJob[];
  /** Exactly the runs the case's evidence came from (D-4). */
  readonly runs: readonly CaseRun[];
  /** The registry as it stands: the only source of labels and disciplines. */
  readonly registry: readonly CaseRegistryCollector[];
  readonly held: readonly CaseHeldCollector[];
}

export const CASE_INPUT_PROBLEMS = [
  /** The case id or one of the lists is absent: nothing omitted is read as empty. */
  "INPUT_MISSING",
  /** Two records of one kind share an id, or a job lists one evidence item twice. */
  "DUPLICATE_ID",
  /** A time is neither null nor a real instant written as `toISOString` writes it. */
  "TIME_NOT_ISO",
  /** A strength that is not one of the six. */
  "STRENGTH_UNKNOWN",
  /** A registry or held collector's discipline that is not a known discipline. */
  "DISCIPLINE_UNKNOWN",
  /** A collector is both registered and held, so its label and discipline would be ambiguous. */
  "HELD_AND_REGISTERED",
  /** Evidence names a job that is not in the input. */
  "EVIDENCE_JOB_MISSING",
  /** Evidence and the job it names record different collectors. */
  "EVIDENCE_JOB_COLLECTOR_MISMATCH",
  /** A job that found something recorded no list of the evidence it found. */
  "FOUND_RESULT_NOT_RECORDED",
  /** Evidence names a job whose recorded result does not list it. */
  "EVIDENCE_NOT_IN_JOB_RESULT",
  /** A job's result lists evidence in the case that names another job, or none. */
  "JOB_EVIDENCE_ELSEWHERE",
  /** A claim cites evidence that is not in the case. */
  "CLAIM_EVIDENCE_MISSING",
  /** A claim is about an entity or relationship that is not in the case. */
  "CLAIM_SUBJECT_MISSING",
  /** A job names a run that is not in the input. */
  "JOB_RUN_MISSING",
  /** A run's plan both ran and excluded the same collector. */
  "JOB_AND_EXCLUSION",
  /** A run no evidence in the case came from (runs are derived from pins, D-4). */
  "RUN_NOT_FROM_CASE",
] as const;
export type CaseInputProblem = (typeof CASE_INPUT_PROBLEMS)[number];

export interface CaseInputIssue {
  readonly problem: CaseInputProblem;
  /** Which record, by kind and id. */
  readonly detail: string;
}

export class CaseInputError extends AppError {
  readonly code = "CASE_INPUT_INVALID";
  /** Every problem found, in a fixed order. */
  readonly issues: readonly CaseInputIssue[];

  constructor(issues: readonly CaseInputIssue[]) {
    super(
      `The case input contradicts itself: ${issues
        .map((issue) => `${issue.problem} (${issue.detail})`)
        .join("; ")}`,
    );
    this.name = "CaseInputError";
    this.issues = issues;
  }
}

/** Ordering by UTF-16 code unit: the same on every machine, unlike a locale's collation. */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/;

/** Whether a time is a real instant written exactly as `toISOString` writes it. */
export function isIsoInstant(value: string): boolean {
  const parts = ISO_INSTANT.exec(value);
  if (parts === null) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return false;
  }
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return (
    days !== undefined && day >= 1 && day <= days && hour <= 23 && minute <= 59 && second <= 59
  );
}

const LISTS = [
  "evidence",
  "claims",
  "entities",
  "relationships",
  "jobs",
  "runs",
  "registry",
  "held",
] as const;

const byProblem = (a: CaseInputIssue, b: CaseInputIssue): number =>
  CASE_INPUT_PROBLEMS.indexOf(a.problem) - CASE_INPUT_PROBLEMS.indexOf(b.problem) ||
  byCodeUnit(a.detail, b.detail);

/**
 * Refuses input that contradicts itself, naming every problem; returns the
 * ids of the runs the case's evidence came from.
 */
export function checkCaseInput(input: CaseInput): ReadonlySet<string> {
  // The types promise every field; a caller that skipped one must not have it
  // read as empty.
  const given = new Map<string, unknown>(Object.entries(input));
  const missing: CaseInputIssue[] = [
    ...(typeof given.get("caseId") === "string" ? [] : ["caseId"]),
    ...LISTS.filter((name) => !Array.isArray(given.get(name))),
  ].map((name) => ({ problem: "INPUT_MISSING", detail: name }));
  if (missing.length > 0) throw new CaseInputError(missing);

  const issues: CaseInputIssue[] = [];
  const add = (problem: CaseInputProblem, detail: string): void => {
    issues.push({ problem, detail });
  };

  const unique = (kind: string, ids: readonly string[]): void => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) add("DUPLICATE_ID", `${kind} ${id}`);
      seen.add(id);
    }
  };
  const idsOf = (records: readonly { readonly id: string }[]): string[] =>
    records.map((record) => record.id);
  unique("evidence", idsOf(input.evidence));
  unique("claim", idsOf(input.claims));
  unique("entity", idsOf(input.entities));
  unique("relationship", idsOf(input.relationships));
  unique("job", idsOf(input.jobs));
  unique("run", idsOf(input.runs));
  unique("registry collector", idsOf(input.registry));
  unique("held collector", idsOf(input.held));
  for (const job of input.jobs) {
    if (job.evidenceIds !== null) unique(`job ${job.id} evidence`, job.evidenceIds);
  }

  const iso = (kind: string, id: string, field: string, value: string | null): void => {
    if (value !== null && !isIsoInstant(value)) add("TIME_NOT_ISO", `${kind} ${id} ${field}`);
  };
  for (const evidence of input.evidence) {
    iso("evidence", evidence.id, "collectedAt", evidence.collectedAt);
    iso("evidence", evidence.id, "observedAt", evidence.observedAt);
  }
  for (const run of input.runs) {
    iso("run", run.id, "startedAt", run.startedAt);
    iso("run", run.id, "finishedAt", run.finishedAt);
  }

  const strengths: readonly string[] = CLAIM_STRENGTHS;
  for (const record of [
    ...input.evidence.map((evidence) => ({ kind: "evidence", ...evidence })),
    ...input.claims.map((claim) => ({ kind: "claim", ...claim })),
  ]) {
    if (!strengths.includes(record.strength)) {
      add("STRENGTH_UNKNOWN", `${record.kind} ${record.id}`);
    }
  }
  const disciplines: readonly string[] = COLLECTOR_DISCIPLINES;
  for (const entry of [
    ...input.registry.map((collector) => ({ kind: "registry collector", ...collector })),
    ...input.held.map((collector) => ({ kind: "held collector", ...collector })),
  ]) {
    if (!disciplines.includes(entry.discipline)) {
      add("DISCIPLINE_UNKNOWN", `${entry.kind} ${entry.id}`);
    }
  }
  const registered = new Set(idsOf(input.registry));
  for (const entry of input.held) {
    if (registered.has(entry.id)) add("HELD_AND_REGISTERED", `collector ${entry.id}`);
  }

  for (const job of input.jobs) {
    if (job.outcome === "FOUND" && job.evidenceIds === null) {
      add("FOUND_RESULT_NOT_RECORDED", `job ${job.id}`);
    }
  }

  const jobs = new Map(input.jobs.map((job) => [job.id, job]));
  const runs = new Set(idsOf(input.runs));
  const evidenceById = new Map(input.evidence.map((evidence) => [evidence.id, evidence]));
  const fromCase = new Set<string>();
  for (const evidence of input.evidence) {
    if (evidence.jobId === null) continue;
    const job = jobs.get(evidence.jobId);
    if (job === undefined) {
      add("EVIDENCE_JOB_MISSING", `evidence ${evidence.id} names job ${evidence.jobId}`);
      continue;
    }
    if (job.collectorId !== evidence.collectorId) {
      add(
        "EVIDENCE_JOB_COLLECTOR_MISMATCH",
        `evidence ${evidence.id} records ${evidence.collectorId}, its job ${job.id} records ${job.collectorId}`,
      );
    }
    if (job.evidenceIds === null || !job.evidenceIds.includes(evidence.id)) {
      add("EVIDENCE_NOT_IN_JOB_RESULT", `evidence ${evidence.id} names job ${job.id}`);
    }
    fromCase.add(job.runId);
  }
  for (const job of input.jobs) {
    for (const evidenceId of job.evidenceIds === null ? [] : job.evidenceIds) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence !== undefined && evidence.jobId !== job.id) {
        add("JOB_EVIDENCE_ELSEWHERE", `job ${job.id} lists evidence ${evidenceId}`);
      }
    }
  }
  const entities = new Set(idsOf(input.entities));
  const relationships = new Set(idsOf(input.relationships));
  for (const claim of input.claims) {
    if (!evidenceById.has(claim.evidenceId)) {
      add("CLAIM_EVIDENCE_MISSING", `claim ${claim.id} cites evidence ${claim.evidenceId}`);
    }
    if (claim.entityId !== null && !entities.has(claim.entityId)) {
      add("CLAIM_SUBJECT_MISSING", `claim ${claim.id} is about entity ${claim.entityId}`);
    }
    if (claim.relationshipId !== null && !relationships.has(claim.relationshipId)) {
      add(
        "CLAIM_SUBJECT_MISSING",
        `claim ${claim.id} is about relationship ${claim.relationshipId}`,
      );
    }
  }
  for (const job of input.jobs) {
    if (!runs.has(job.runId)) add("JOB_RUN_MISSING", `job ${job.id} names run ${job.runId}`);
  }
  for (const run of input.runs) {
    if (!fromCase.has(run.id)) add("RUN_NOT_FROM_CASE", `run ${run.id}`);
    if (run.plan.kind !== "PLANNED") continue;
    const ran = new Set(
      input.jobs.filter((job) => job.runId === run.id).map((job) => job.collectorId),
    );
    for (const excluded of run.plan.excluded) {
      if (ran.has(excluded.collectorId)) {
        add("JOB_AND_EXCLUSION", `run ${run.id} collector ${excluded.collectorId}`);
      }
    }
  }

  if (issues.length > 0) throw new CaseInputError(issues.sort(byProblem));
  return fromCase;
}
