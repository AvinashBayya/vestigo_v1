/**
 * A case's discipline breakdown: what the case holds from each discipline's
 * collectors (evidence, claims, entities, relationships, by recorded
 * strength), and what each of those collectors did in the runs the case's
 * evidence came from: ran, found something, found nothing, failed, did not
 * finish, was locked or excluded by the plan, was held, or did not apply.
 *
 * Each collector has the one discipline its registry entry states (a held
 * collector, the one it declares). A discipline no collector is built for is
 * NOT_BUILT, and one whose only collectors are held and ran in none of the
 * case's runs is HELD: in both nothing could have been collected, so their
 * counts are null with that reason, never 0. The previous codebase's further
 * per-discipline figures (contradictions, media claims and conflicts, location
 * hypotheses) are listed as not built, null with the input each needs.
 *
 * Ported from the previous codebase's cases/case-intelligence-breakdown.ts,
 * whose input was optional where it mattered (an omitted GEOINT count became a
 * measured 0, an omitted media flag defaulted to "in the case") and which filed
 * a discipline no collector declares as "not case-scoped". Here every input is
 * required, nothing missing becomes a number, and records are attributed
 * through their evidence (see case-view.ts). Its one-line headline is not
 * ported yet: its wording waits for the owner with the caveats'.
 *
 * Its caveats are codes; their wording waits for the owner, as for coverage.
 * Under a person lock the whole breakdown is refused by the read that serves
 * it (CLAUDE.md §9): nothing here hides a section or lowers a total.
 */
import {
  CLAIM_STRENGTHS,
  COLLECTOR_DISCIPLINES,
  LOCK_REASONS,
  type CollectorDiscipline,
} from "@repo/core";
import { ENGINE_VERSION } from "../version.ts";
import { type CaseInput } from "./case-input.ts";
import {
  byStrength,
  caseView,
  counted,
  type ByStrength,
  type CaseCollector,
  type CaseCollectorRun,
  type Counted,
  type EmptyCase,
  type NotMeasured,
} from "./case-view.ts";

export const DISCIPLINE_STATUSES = [
  /** The case holds evidence from this discipline's collectors. */
  "PRESENT",
  /** Collectors are registered for it and the case holds nothing of theirs: a measured zero. */
  "ZERO",
  /** Its only collectors are held off the platform, and the case holds nothing of theirs. */
  "HELD",
  /** No collector is built for it. */
  "NOT_BUILT",
] as const;
export type DisciplineStatus = (typeof DISCIPLINE_STATUSES)[number];

/** Why a discipline's counts are null. */
export type DisciplineNotMeasured = "NO_COLLECTOR_BUILT" | "ONLY_HELD_COLLECTORS";

/** A count, or null with the reason it could not be measured. */
export type DisciplineCount = Counted | NotMeasured<DisciplineNotMeasured>;

/**
 * A discipline's figures beyond its records, from the previous codebase's
 * breakdown. None is built yet; each is null with the input it needs, never 0.
 */
export const DISCIPLINE_METRICS = {
  TECHINT: ["CONTRADICTIONS"],
  SOCMINT: [],
  MEDIAINT: ["MEDIA_CLAIMS", "MEDIA_CONFLICTS"],
  GEOINT: ["LOCATION_HYPOTHESES"],
  PERSON: [],
} as const satisfies Readonly<Record<CollectorDiscipline, readonly string[]>>;
export type DisciplineMetricName = (typeof DISCIPLINE_METRICS)[CollectorDiscipline][number];

/** Why a discipline metric is null: the input it needs is not built. */
export const METRIC_NOT_BUILT = {
  /** Contradiction detection across collectors (R1-d). */
  CONTRADICTIONS: "CONTRADICTION_DETECTION_NOT_BUILT",
  /** Claims extracted from media evidence (R3, owner ruling D-18). */
  MEDIA_CLAIMS: "MEDIA_CLAIM_EXTRACTION_NOT_BUILT",
  MEDIA_CONFLICTS: "MEDIA_CLAIM_EXTRACTION_NOT_BUILT",
  /** GEOINT collection and location hypotheses (R3, owner ruling D-18). */
  LOCATION_HYPOTHESES: "LOCATION_HYPOTHESES_NOT_BUILT",
} as const satisfies Readonly<Record<DisciplineMetricName, string>>;
export type MetricNotBuilt = (typeof METRIC_NOT_BUILT)[DisciplineMetricName];

export interface DisciplineMetric {
  readonly metric: DisciplineMetricName;
  readonly value: Counted | NotMeasured<MetricNotBuilt>;
}

/** Standing limits of a breakdown, stated every time. */
export const CASE_BREAKDOWN_CAVEATS = [
  /** These are counts of stored records, not an assessment of coverage. A high count is not thorough collection. */
  "COUNTS_ARE_NOT_COVERAGE",
  /** A collector's discipline is its registry entry's, never inferred from its name or its output. */
  "DISCIPLINE_FROM_REGISTRY",
  /** Evidence and claims split cleanly by discipline. An entity or relationship counts under every discipline whose evidence its claims cite, so those do not sum to the case's total. */
  "ENTITY_AND_RELATIONSHIP_COUNTS_OVERLAP",
  /** A count that could not be measured is absent with its reason, which is not zero. */
  "UNMEASURED_IS_NOT_ZERO",
] as const;
export type CaseBreakdownCaveat = (typeof CASE_BREAKDOWN_CAVEATS)[number];

/**
 * Whether a recorded reason says the tenant's plan or vetting does not allow
 * the collector's module: core's LOCK_REASONS, as a run's plan recorded them for
 * an exclusion, or a job for a refusal at dispatch.
 */
const isLockReason = (code: string): boolean => (LOCK_REASONS as readonly string[]).includes(code);

export interface CollectorRef {
  readonly collectorId: string;
  readonly sourceLabel: string;
}

/** A collector and the runs in which it is in this group, each with its state. */
export interface CollectorRuns extends CollectorRef {
  readonly runs: readonly CaseCollectorRun[];
}

export interface HeldRef extends CollectorRef {
  readonly reason: string;
}

/**
 * A discipline's collectors, grouped by what each did in the case's runs. A
 * collector is in every group it reached in some run, so groups can overlap:
 * one run may have found something where another failed.
 */
export interface DisciplineCollectors {
  readonly registered: readonly CollectorRef[];
  /** Its code ran: it found something, found nothing, or failed. */
  readonly ran: readonly CollectorRuns[];
  readonly foundSomething: readonly CollectorRuns[];
  readonly foundNothing: readonly CollectorRuns[];
  /** Did not complete: it failed, needed a credential, or was refused for a reason other than a lock. */
  readonly failed: readonly CollectorRuns[];
  readonly notFinished: readonly CollectorRuns[];
  /** Not run because the tenant's plan or vetting does not allow its module: excluded at planning, or refused at dispatch. */
  readonly locked: readonly CollectorRuns[];
  /** Excluded at planning for any other recorded reason. */
  readonly excluded: readonly CollectorRuns[];
  readonly notApplicable: readonly CollectorRuns[];
  readonly held: readonly HeldRef[];
  /** Registered, and named by none of the case's runs: registered since, or in a run whose plan was not recorded. */
  readonly notInAnyRun: readonly CollectorRef[];
}

export interface DisciplineSection {
  readonly discipline: CollectorDiscipline;
  readonly status: DisciplineStatus;
  readonly evidence: DisciplineCount;
  readonly claims: DisciplineCount;
  readonly entities: DisciplineCount;
  readonly relationships: DisciplineCount;
  /** Null when the counts are. */
  readonly evidenceByStrength: ByStrength | null;
  readonly claimsByStrength: ByStrength | null;
  /** Its further figures, each null with the input it needs while not built. */
  readonly metrics: readonly DisciplineMetric[];
  readonly collectors: DisciplineCollectors;
}

export interface CaseBreakdown {
  readonly kind: "CASE_BREAKDOWN";
  readonly engineVersion: number;
  readonly caseId: string;
  /** One per discipline, in core's order. */
  readonly sections: readonly DisciplineSection[];
  /** Collectors in the case that are neither registered nor held, so have no discipline. */
  readonly notRegistered: {
    readonly collectors: readonly CollectorRef[];
    readonly evidence: Counted;
    readonly claims: Counted;
    readonly entities: Counted;
    readonly relationships: Counted;
  };
  readonly totals: {
    readonly evidence: Counted;
    readonly claims: Counted;
    readonly entities: Counted;
    readonly relationships: Counted;
    readonly evidenceByStrength: ByStrength;
    readonly claimsByStrength: ByStrength;
  };
  /** Entities and relationships in the case that no claim in the case is about. */
  readonly entitiesWithNoClaim: Counted;
  readonly relationshipsWithNoClaim: Counted;
  readonly caveats: readonly CaseBreakdownCaveat[];
}

const ref = (collector: CaseCollector): CollectorRef => ({
  collectorId: collector.collectorId,
  sourceLabel: collector.sourceLabel,
});

function inGroup(
  collectors: readonly CaseCollector[],
  belongs: (run: CaseCollectorRun) => boolean,
): CollectorRuns[] {
  return collectors.flatMap((collector) => {
    const runs = collector.runs.filter(belongs);
    return runs.length === 0 ? [] : [{ ...ref(collector), runs }];
  });
}

const union = (collectors: readonly CaseCollector[], ids: (c: CaseCollector) => Counted): Counted =>
  counted(collectors.flatMap((collector) => ids(collector).ids));

function unionByStrength(
  collectors: readonly CaseCollector[],
  of: "evidence" | "claims",
): ByStrength {
  const records = collectors.flatMap((collector) => {
    const groups = of === "evidence" ? collector.evidenceByStrength : collector.claimsByStrength;
    return CLAIM_STRENGTHS.flatMap((strength) =>
      groups[strength].ids.map((id) => ({ id, strength })),
    );
  });
  return byStrength(records);
}

function section(
  discipline: CollectorDiscipline,
  all: readonly CaseCollector[],
): DisciplineSection {
  const collectors = all.filter((collector) => collector.discipline === discipline);
  const registered = collectors.filter((collector) => collector.registration === "REGISTERED");
  const held = collectors.flatMap((collector) =>
    collector.registration === "HELD" ? [{ ...ref(collector), reason: collector.heldReason }] : [],
  );
  const evidence = union(collectors, (collector) => collector.evidence);
  // A held collector whose job completed in one of the case's runs could have
  // collected: its zero is measured. A refused, failed or unfinished job could not.
  const completedInCase = collectors.some((collector) =>
    collector.runs.some(
      (run) =>
        run.jobId !== null &&
        (run.state === "COLLECTED" ||
          run.state === "COLLECTED_NOT_PINNED" ||
          run.state === "NOTHING_FOUND"),
    ),
  );
  const status: DisciplineStatus =
    registered.length === 0 && held.length === 0
      ? "NOT_BUILT"
      : evidence.count > 0
        ? "PRESENT"
        : registered.length > 0 || completedInCase
          ? "ZERO"
          : "HELD";
  const reason: DisciplineNotMeasured | null =
    status === "NOT_BUILT"
      ? "NO_COLLECTOR_BUILT"
      : status === "HELD"
        ? "ONLY_HELD_COLLECTORS"
        : null;
  const count = (measured: Counted): DisciplineCount =>
    reason === null ? measured : { count: null, ids: null, reason };
  const isLock = (run: CaseCollectorRun): boolean =>
    (run.state === "EXCLUDED" || run.state === "REFUSED") &&
    run.reasonCode !== null &&
    isLockReason(run.reasonCode);

  return {
    discipline,
    status,
    evidence: count(evidence),
    claims: count(union(collectors, (collector) => collector.claims)),
    entities: count(union(collectors, (collector) => collector.entities)),
    relationships: count(union(collectors, (collector) => collector.relationships)),
    evidenceByStrength: reason === null ? unionByStrength(collectors, "evidence") : null,
    claimsByStrength: reason === null ? unionByStrength(collectors, "claims") : null,
    metrics: DISCIPLINE_METRICS[discipline].map((metric) => ({
      metric,
      value: { count: null, ids: null, reason: METRIC_NOT_BUILT[metric] },
    })),
    collectors: {
      registered: registered.map(ref),
      ran: inGroup(
        collectors,
        (run) =>
          run.jobId !== null &&
          (run.state === "COLLECTED" ||
            run.state === "COLLECTED_NOT_PINNED" ||
            run.state === "NOTHING_FOUND" ||
            run.state === "FAILED"),
      ),
      foundSomething: inGroup(
        collectors,
        (run) => run.state === "COLLECTED" || run.state === "COLLECTED_NOT_PINNED",
      ),
      foundNothing: inGroup(collectors, (run) => run.state === "NOTHING_FOUND"),
      failed: inGroup(
        collectors,
        (run) =>
          run.state === "FAILED" ||
          run.state === "NEEDS_CREDENTIALS" ||
          (run.state === "REFUSED" && !isLock(run)),
      ),
      notFinished: inGroup(collectors, (run) => run.state === "NOT_FINISHED"),
      locked: inGroup(collectors, isLock),
      excluded: inGroup(collectors, (run) => run.state === "EXCLUDED" && !isLock(run)),
      notApplicable: inGroup(collectors, (run) => run.state === "NOT_APPLICABLE"),
      held,
      notInAnyRun: registered.filter((collector) => collector.runs.length === 0).map(ref),
    },
  };
}

/** A case's discipline breakdown, or EmptyCase when it holds nothing. */
export function caseBreakdown(input: CaseInput): CaseBreakdown | EmptyCase {
  const view = caseView(input);
  if ("kind" in view) return view;

  const notRegistered = view.collectors.filter((collector) => collector.discipline === null);
  const about = new Set(
    input.claims.flatMap((claim) => [
      ...(claim.entityId === null ? [] : [claim.entityId]),
      ...(claim.relationshipId === null ? [] : [claim.relationshipId]),
    ]),
  );
  return {
    kind: "CASE_BREAKDOWN",
    engineVersion: ENGINE_VERSION,
    caseId: view.caseId,
    sections: COLLECTOR_DISCIPLINES.map((discipline) => section(discipline, view.collectors)),
    notRegistered: {
      collectors: notRegistered.map(ref),
      evidence: union(notRegistered, (collector) => collector.evidence),
      claims: union(notRegistered, (collector) => collector.claims),
      entities: union(notRegistered, (collector) => collector.entities),
      relationships: union(notRegistered, (collector) => collector.relationships),
    },
    totals: {
      evidence: counted(input.evidence.map((evidence) => evidence.id)),
      claims: counted(input.claims.map((claim) => claim.id)),
      entities: counted(input.entities.map((entity) => entity.id)),
      relationships: counted(input.relationships.map((relationship) => relationship.id)),
      evidenceByStrength: byStrength(input.evidence),
      claimsByStrength: byStrength(input.claims),
    },
    entitiesWithNoClaim: counted(
      input.entities.filter((entity) => !about.has(entity.id)).map((entity) => entity.id),
    ),
    relationshipsWithNoClaim: counted(
      input.relationships
        .filter((relationship) => !about.has(relationship.id))
        .map((relationship) => relationship.id),
    ),
    caveats: [...CASE_BREAKDOWN_CAVEATS],
  };
}
