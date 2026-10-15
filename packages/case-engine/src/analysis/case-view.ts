/**
 * The shared per-collector view of a case: for every collector, what of the
 * case it contributed and what happened to it in every run the case's
 * evidence came from. Case coverage and the discipline breakdown are both
 * read from it, and so will correlation and contradictions (R1-c, R1-d).
 *
 * Rules every document here keeps:
 *   - a count carries the ids it counted, sorted; zero means measured and none;
 *   - what could not be measured is null with a reason, never a zero;
 *   - source labels and disciplines come from the registry input alone;
 *   - strengths are passed through as recorded, never raised or lowered;
 *   - observedAt and collectedAt stay apart, and a null stays null;
 *   - the output is the same for the same input, whatever its order: every
 *     list is sorted by a fixed key, compared by code unit.
 *
 * The previous codebase grouped records by a source string each record
 * carried (cases/case-intelligence-breakdown.ts): an entity's own `source`,
 * which entity resolution overwrote for every merged entity, and a
 * relationship's self-supplied `source`. Here every record is attributed
 * through evidence: an evidence item to its recorded collector, a claim to its
 * evidence's collector, and an entity or relationship to the collectors of
 * the evidence its claims in the case cite.
 */
import {
  CLAIM_STRENGTHS,
  COVERAGE_STATES,
  TARGET_TYPES,
  type ClaimStrength,
  type CollectorDiscipline,
  type ReportCoverage,
} from "@repo/core";
import { ENGINE_VERSION } from "../version.ts";
import {
  byCodeUnit,
  CANNOT_RUN,
  checkCaseInput,
  type CaseClaim,
  type CaseEvidence,
  type CaseInput,
  type CaseJob,
  type CaseRun,
} from "./case-input.ts";
import {
  coverageFromJob,
  runCoverage,
  sourceLabelOf,
  type CoverageCollector,
  type CoveragePlan,
} from "./run-coverage.ts";

/** A count and the ids it counted, sorted. Zero means measured and none. */
export interface Counted {
  readonly count: number;
  readonly ids: readonly string[];
}

/** What could not be measured, and why: never a zero standing in for it. */
export interface NotMeasured<Reason extends string> {
  readonly count: null;
  readonly ids: null;
  readonly reason: Reason;
}

/** The distinct ids, sorted, and how many. */
export function counted(ids: Iterable<string>): Counted {
  const sorted = [...new Set(ids)].sort(byCodeUnit);
  return { count: sorted.length, ids: sorted };
}

/** Records grouped by the strength recorded on them, every strength listed, strongest first. */
export type ByStrength = Readonly<Record<ClaimStrength, Counted>>;

export function byStrength(
  records: readonly { readonly id: string; readonly strength: ClaimStrength }[],
): ByStrength {
  return Object.fromEntries(
    CLAIM_STRENGTHS.map((strength) => [
      strength,
      counted(records.filter((record) => record.strength === strength).map((record) => record.id)),
    ]),
  ) as Record<ClaimStrength, Counted>;
}

/**
 * What happened to a collector in one run: the run report's state, or one of
 * two a case adds.
 */
export const CASE_COVERAGE_STATES = [
  ...COVERAGE_STATES,
  /** It collected, and nothing it collected is in the case. */
  "COLLECTED_NOT_PINNED",
  /** It does not accept the run's target type: not a gap, listed for completeness. */
  "NOT_APPLICABLE",
] as const;
export type CaseCoverageState = (typeof CASE_COVERAGE_STATES)[number];

/** A collector's place in one run: its job, or why it had none. */
export interface CaseCollectorRun {
  readonly runId: string;
  /** Null when it had no job in the run: excluded, held or not applicable. */
  readonly jobId: string | null;
  readonly state: CaseCoverageState;
  readonly reasonCode: string | null;
  readonly detail: string | null;
}

/**
 * Where a collector stands:
 *   REGISTERED       in the registry, and not listed as BLOCKED or
 *                    NOT_IMPLEMENTED (an UNVERIFIED one runs only where the
 *                    deployment allows unverified sources);
 *   HELD             built, held off the platform, not in the registry;
 *   NOT_REGISTERED   not in the registry, and not held;
 *   BLOCKED          in the registry, but its source's licence verdict is BLOCKED;
 *   NOT_IMPLEMENTED  in the registry, with no implementation to run.
 * A BLOCKED or NOT_IMPLEMENTED collector keeps its registry label and
 * discipline, and is never counted as one that could have run.
 */
export const REGISTRATIONS = ["REGISTERED", "HELD", "NOT_REGISTERED", ...CANNOT_RUN] as const;
export type Registration = (typeof REGISTRATIONS)[number];

/**
 * Whether a collector is registered, registered but unable to run (BLOCKED or
 * NOT_IMPLEMENTED), held (and why), or none of these.
 */
export type CollectorRegistration =
  | {
      readonly registration: Exclude<Registration, "HELD">;
      readonly heldReason: null;
    }
  | { readonly registration: "HELD"; readonly heldReason: string };

export type CaseCollector = CollectorRegistration & CaseCollectorRecords;

export interface CaseCollectorRecords {
  readonly collectorId: string;
  /** The registry's label; a held collector's declared name; or its id, saying it is not registered. */
  readonly sourceLabel: string;
  /** The registry's discipline for it (or the held declaration's); null when NOT_REGISTERED. */
  readonly discipline: CollectorDiscipline | null;
  /** Its evidence in the case. */
  readonly evidence: Counted;
  readonly evidenceByStrength: ByStrength;
  /** Its evidence in the case that has no recorded collection job (D-4). */
  readonly evidenceWithNoRecordedJob: Counted;
  /** Claims in the case citing its evidence. */
  readonly claims: Counted;
  readonly claimsByStrength: ByStrength;
  /** Entities and relationships in the case that its claims in the case are about. */
  readonly entities: Counted;
  readonly relationships: Counted;
  /** Its place in each of the case's runs that names it, in the runs' order. */
  readonly runs: readonly CaseCollectorRun[];
}

/** One job of a contributing run: what it collected, and how much of that is in the case. */
export interface CaseJobCoverage {
  readonly jobId: string;
  readonly collectorId: string;
  readonly sourceLabel: string;
  readonly state: CaseCoverageState;
  /** The evidence its result recorded. */
  readonly collected: Counted;
  /** Its evidence in the case. */
  readonly inCase: Counted;
  /** What it collected that is not in the case. */
  readonly notInCase: Counted;
}

/** A run the case's evidence came from, named with its investigation. */
export interface CaseRunCoverage {
  readonly runId: string;
  readonly investigation: { readonly id: string; readonly title: string };
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /**
   * The run's coverage, computed by the run report's own function from the
   * run's recorded plan and jobs, against the current registry and held list,
   * so it can differ from a report stored earlier:
   *   - a collector the plan named (ran or excluded) is never also listed as
   *     held: the plan recorded what happened to it;
   *   - a held collector is labelled with its declared name throughout, as
   *     every label in a case document is (the run report names its jobs as
   *     not registered);
   *   - a held entry names the first target type the run accepted in core's
   *     order of target types, not in the order the collector lists them;
   *   - entries are in a fixed order (jobs and exclusions by collector, held
   *     collectors by id), where a stored report lists jobs as created.
   */
  readonly coverage: ReportCoverage;
  /** Each of its jobs, by collector. */
  readonly jobs: readonly CaseJobCoverage[];
  /** Its evidence in the case. */
  readonly evidenceInCase: Counted;
}

/** The answer for a case that holds nothing: nothing was there to measure. */
export interface EmptyCase {
  readonly kind: "EMPTY_CASE";
  readonly engineVersion: number;
  readonly caseId: string;
  /** No evidence, claim, entity or relationship is in the case. */
  readonly reason: "NO_RECORDS_IN_CASE";
}

/** Everything a case's documents are read from, computed once. */
export interface CaseView {
  readonly caseId: string;
  readonly runs: readonly CaseRunCoverage[];
  readonly collectors: readonly CaseCollector[];
  readonly input: CaseInput;
}

const isEmpty = (input: CaseInput): boolean =>
  input.evidence.length === 0 &&
  input.claims.length === 0 &&
  input.entities.length === 0 &&
  input.relationships.length === 0;

export const emptyCase = (caseId: string): EmptyCase => ({
  kind: "EMPTY_CASE",
  engineVersion: ENGINE_VERSION,
  caseId,
  reason: "NO_RECORDS_IN_CASE",
});

/** Runs by when they started, those never started last, then by id. */
function byRunOrder(a: CaseRun, b: CaseRun): number {
  if (a.startedAt !== b.startedAt) {
    if (a.startedAt === null) return 1;
    if (b.startedAt === null) return -1;
    return byCodeUnit(a.startedAt, b.startedAt);
  }
  return byCodeUnit(a.id, b.id);
}

function grouped<T>(records: readonly T[], key: (record: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const group = groups.get(key(record));
    if (group === undefined) groups.set(key(record), [record]);
    else group.push(record);
  }
  return groups;
}

/** A group's records; none when no record had the key (every record was grouped). */
function listIn<T>(groups: ReadonlyMap<string, readonly T[]>, key: string): readonly T[] {
  const list = groups.get(key);
  return list === undefined ? [] : list;
}

const idsIn = <T extends { readonly id: string }>(
  groups: ReadonlyMap<string, readonly T[]>,
  key: string,
): string[] => listIn(groups, key).map((record) => record.id);

/**
 * The collectors a case labels: the registry, and each held collector under
 * its declared name (checkCaseInput refuses one that is both). Every label in
 * a case document, the recomputed run coverage's included, comes from here:
 * one label per collector, never a string a record carries.
 */
function labelled(input: CaseInput): CoverageCollector[] {
  return [
    ...input.registry,
    ...input.held.map((entry) => ({
      id: entry.id,
      label: entry.displayName,
      collectionMode: entry.collectionMode,
    })),
  ];
}

const targetTypeOrder = (type: string): number => (TARGET_TYPES as readonly string[]).indexOf(type);

/** The plan with its exclusions in a fixed order, so input order cannot reach the output. */
function canonicalPlan(plan: CoveragePlan): CoveragePlan {
  if (plan.kind !== "PLANNED") return plan;
  return {
    ...plan,
    excluded: [...plan.excluded].sort(
      (a, b) =>
        byCodeUnit(a.collectorId, b.collectorId) ||
        byCodeUnit(a.reason, b.reason) ||
        byNullable(a.targetType, b.targetType) ||
        byCodeUnit(a.message, b.message),
    ),
  };
}

/** A collector's place in one run, with the run's position in the case's order of runs. */
type Appearance = readonly [collectorId: string, runIndex: number, appearance: CaseCollectorRun];

function runView(
  input: CaseInput,
  run: CaseRun,
  runIndex: number,
  jobs: readonly CaseJob[],
  evidenceByJob: ReadonlyMap<string, readonly CaseEvidence[]>,
  caseEvidence: ReadonlySet<string>,
  labels: readonly CoverageCollector[],
): { readonly coverage: CaseRunCoverage; readonly appearances: readonly Appearance[] } {
  const plan = canonicalPlan(run.plan);
  // The plan recorded what happened to every collector it names; today's held
  // list speaks only for the collectors it did not name.
  const named = new Set([
    ...jobs.map((job) => job.collectorId),
    ...(plan.kind === "PLANNED" ? plan.excluded.map((excluded) => excluded.collectorId) : []),
  ]);
  const held = input.held
    .filter((entry) => !named.has(entry.id))
    .sort((a, b) => byCodeUnit(a.id, b.id))
    .map((entry) => ({
      ...entry,
      targetTypes: [...entry.targetTypes].sort((a, b) => targetTypeOrder(a) - targetTypeOrder(b)),
    }));
  const coverage = runCoverage({ registry: labels, status: run.status, plan, jobs, held });
  const appearances: Appearance[] = [];
  const jobCoverage = jobs.map((job): CaseJobCoverage => {
    const sourceLabel = sourceLabelOf(labels, job.collectorId);
    const entry = coverageFromJob(job, sourceLabel);
    const collected = counted(job.evidenceIds === null ? [] : job.evidenceIds);
    const inCase = counted(idsIn(evidenceByJob, job.id));
    const state =
      entry.state === "COLLECTED" && inCase.count === 0 ? "COLLECTED_NOT_PINNED" : entry.state;
    appearances.push([
      job.collectorId,
      runIndex,
      { runId: run.id, jobId: job.id, state, reasonCode: entry.reasonCode, detail: entry.detail },
    ]);
    return {
      jobId: job.id,
      collectorId: job.collectorId,
      sourceLabel,
      state,
      collected,
      inCase,
      notInCase: counted(collected.ids.filter((id) => !caseEvidence.has(id))),
    };
  });
  // Exclusions and held collectors: the coverage entries no job made.
  for (const entry of coverage.entries) {
    if (entry.attempts !== null) continue;
    appearances.push([
      entry.collectorId,
      runIndex,
      {
        runId: run.id,
        jobId: null,
        state: entry.state,
        reasonCode: entry.reasonCode,
        detail: entry.detail,
      },
    ]);
  }
  if (plan.kind === "PLANNED") {
    for (const excluded of plan.excluded) {
      if (excluded.reason !== "TARGET_TYPE_NOT_ACCEPTED") continue;
      appearances.push([
        excluded.collectorId,
        runIndex,
        {
          runId: run.id,
          jobId: null,
          state: "NOT_APPLICABLE",
          reasonCode: excluded.reason,
          detail: excluded.message,
        },
      ]);
    }
  }
  return {
    coverage: {
      runId: run.id,
      investigation: { id: run.investigationId, title: run.investigationTitle },
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      coverage,
      jobs: jobCoverage,
      evidenceInCase: counted(jobs.flatMap((job) => idsIn(evidenceByJob, job.id))),
    },
    appearances,
  };
}

/** Code-unit order, with null before any string. */
function byNullable(a: string | null, b: string | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return byCodeUnit(a, b);
}

const byAppearance = (a: CaseCollectorRun, b: CaseCollectorRun): number =>
  byCodeUnit(a.state, b.state) ||
  byNullable(a.jobId, b.jobId) ||
  byNullable(a.reasonCode, b.reasonCode) ||
  byNullable(a.detail, b.detail);

/**
 * The view every case document is read from. Refuses input that contradicts
 * itself (CaseInputError); answers EmptyCase for a case that holds nothing.
 */
export function caseView(input: CaseInput): CaseView | EmptyCase {
  checkCaseInput(input);
  if (isEmpty(input)) return emptyCase(input.caseId);

  const evidenceByJob = new Map<string, CaseEvidence[]>();
  for (const evidence of input.evidence) {
    if (evidence.jobId === null) continue;
    const group = evidenceByJob.get(evidence.jobId);
    if (group === undefined) evidenceByJob.set(evidence.jobId, [evidence]);
    else group.push(evidence);
  }
  const jobsByRun = grouped(input.jobs, (job) => job.runId);
  const caseEvidence = new Set(input.evidence.map((evidence) => evidence.id));
  const labels = labelled(input);
  const runs = [...input.runs].sort(byRunOrder);
  const views = runs.map((run, runIndex) =>
    runView(
      input,
      run,
      runIndex,
      [...listIn(jobsByRun, run.id)].sort(
        (a, b) => byCodeUnit(a.collectorId, b.collectorId) || byCodeUnit(a.id, b.id),
      ),
      evidenceByJob,
      caseEvidence,
      labels,
    ),
  );
  const appearances = grouped(
    views.flatMap((view) => view.appearances),
    ([collectorId]) => collectorId,
  );

  // A claim belongs to the collector of the evidence it cites, which
  // checkCaseInput has confirmed is in the case.
  const evidenceByCollector = grouped(input.evidence, (evidence) => evidence.collectorId);
  const claimsByEvidence = grouped(input.claims, (claim) => claim.evidenceId);
  const claimsOf = (collectorId: string): CaseClaim[] =>
    listIn(evidenceByCollector, collectorId).flatMap((evidence) =>
      listIn(claimsByEvidence, evidence.id),
    );
  const entityIds = new Set(input.entities.map((entity) => entity.id));
  const relationshipIds = new Set(input.relationships.map((relationship) => relationship.id));
  const registry = new Map(input.registry.map((entry) => [entry.id, entry]));
  const held = new Map(input.held.map((entry) => [entry.id, entry]));

  const collectorIds = new Set<string>([
    ...registry.keys(),
    ...held.keys(),
    ...evidenceByCollector.keys(),
    ...appearances.keys(),
  ]);
  const collectors = [...collectorIds].sort(byCodeUnit).map((collectorId): CaseCollector => {
    const registered = registry.get(collectorId);
    const heldEntry = registered === undefined ? held.get(collectorId) : undefined;
    const evidence = listIn(evidenceByCollector, collectorId);
    const claims = claimsOf(collectorId);
    const registration: CollectorRegistration =
      registered !== undefined
        ? {
            registration: registered.cannotRun === null ? "REGISTERED" : registered.cannotRun,
            heldReason: null,
          }
        : heldEntry !== undefined
          ? { registration: "HELD", heldReason: heldEntry.reason }
          : { registration: "NOT_REGISTERED", heldReason: null };
    return {
      collectorId,
      sourceLabel: sourceLabelOf(labels, collectorId),
      ...registration,
      discipline:
        registered !== undefined
          ? registered.discipline
          : heldEntry !== undefined
            ? heldEntry.discipline
            : null,
      evidence: counted(evidence.map((record) => record.id)),
      evidenceByStrength: byStrength(evidence),
      evidenceWithNoRecordedJob: counted(
        evidence.filter((record) => record.jobId === null).map((record) => record.id),
      ),
      claims: counted(claims.map((claim) => claim.id)),
      claimsByStrength: byStrength(claims),
      entities: counted(
        claims.flatMap((claim) =>
          claim.entityId !== null && entityIds.has(claim.entityId) ? [claim.entityId] : [],
        ),
      ),
      relationships: counted(
        claims.flatMap((claim) =>
          claim.relationshipId !== null && relationshipIds.has(claim.relationshipId)
            ? [claim.relationshipId]
            : [],
        ),
      ),
      runs: [...listIn(appearances, collectorId)]
        .sort((a, b) => a[1] - b[1] || byAppearance(a[2], b[2]))
        .map(([, , appearance]) => appearance),
    };
  });

  return { caseId: input.caseId, runs: views.map((view) => view.coverage), collectors, input };
}

/** The shared per-collector view of a case, as a document. */
export interface CaseCollectors {
  readonly kind: "CASE_COLLECTORS";
  readonly engineVersion: number;
  readonly caseId: string;
  /**
   * Every collector the registry lists (BLOCKED and NOT_IMPLEMENTED ones
   * included), every held one, and any other found anywhere in the case, by id.
   */
  readonly collectors: readonly CaseCollector[];
}

export function caseCollectors(input: CaseInput): CaseCollectors | EmptyCase {
  const view = caseView(input);
  if ("kind" in view) return view;
  return {
    kind: "CASE_COLLECTORS",
    engineVersion: ENGINE_VERSION,
    caseId: view.caseId,
    collectors: view.collectors,
  };
}
