/**
 * A case's discipline breakdown: what the case holds from each discipline's
 * collectors (evidence, claims, entities, relationships, by recorded
 * strength), and what each of those collectors did in the runs the case's
 * evidence came from: ran, found something, found nothing, failed, did not
 * finish, was locked or excluded by the plan, was held, or did not apply.
 *
 * Each collector has the one discipline its registry entry states (a held
 * collector, the one it declares). Where nothing in the case's runs could
 * have collected for a discipline, its counts are null with the reason, never
 * 0:
 *   - NOT_BUILT: no collector is built for it (the registry lists none, or
 *     only NOT_IMPLEMENTED ones, and none is held);
 *   - HELD: none of its collectors may run or completed a job in the case's
 *     runs, and one is held off the platform;
 *   - UNVERIFIED: the same, except that none is held and one is listed as
 *     UNVERIFIED (its source's licence is unverified, which never runs);
 *   - BLOCKED: the same, except that none is held or UNVERIFIED and one is
 *     listed as BLOCKED (its source's licence verdict);
 *   - LOCKED: at every place the case's runs name one of its collectors, it
 *     was locked by the plan or vetting, leaving out the places where it
 *     could not run at all (see the LOCKED status).
 * A collector the registry lists as BLOCKED, NOT_IMPLEMENTED or UNVERIFIED is
 * listed with its label and discipline and never counted as one that could
 * have run (owner ruling, 2026-10-13; UNVERIFIED since 2026-10-16): only a job
 * it completed in the case's runs makes its discipline's zero measured. The previous codebase's further
 * per-discipline figures (contradictions, media claims and conflicts, location
 * hypotheses) are listed as not built, null with the input each needs.
 *
 * Ported from the previous codebase's cases/case-intelligence-breakdown.ts,
 * whose input was optional where it mattered (an omitted GEOINT count became a
 * measured 0, an omitted media flag defaulted to "in the case") and which filed
 * a discipline no collector declares as "not case-scoped". Here every input is
 * required, nothing missing becomes a number, and records are attributed
 * through their evidence (see case-view.ts).
 *
 * Its caveats are codes. Their approved wording, and the headline's, is core's
 * CASE_WORDING, which a stored analysis copies (R1-b). Under a person lock the whole breakdown is refused by the read that serves
 * it (CLAUDE.md §9): nothing here hides a section or lowers a total.
 */
import {
  CASE_WORDING,
  CLAIM_STRENGTHS,
  COLLECTOR_DISCIPLINES,
  fillWording,
  LOCK_REASONS,
  UNRUNNABLE_REASONS,
  type CollectorDiscipline,
} from "@repo/core";
import { ENGINE_VERSION } from "../version.ts";
import { caseContradictions, type CaseContradictions } from "./case-contradictions.ts";
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
  /**
   * The case holds nothing of its collectors, and one of them is registered
   * and not listed as BLOCKED, NOT_IMPLEMENTED or UNVERIFIED, or completed a
   * job in the case's runs: a measured zero.
   */
  "ZERO",
  /**
   * The case holds nothing of its collectors; none of them may run (any the
   * registry lists is BLOCKED, NOT_IMPLEMENTED or UNVERIFIED) or completed a
   * job in the case's runs, and one is held off the platform.
   */
  "HELD",
  /**
   * The case holds nothing of its collectors, and at every place the case's
   * runs name one of them, it was locked there: the tenant's plan or vetting
   * did not allow its module (excluded at planning, or refused at dispatch).
   * The places where a collector could not run at all are left out: one a
   * run recorded with one of core's UNRUNNABLE_REASONS (LICENCE_BLOCKED,
   * NOT_IMPLEMENTED, UNVERIFIED_SOURCE_NOT_ALLOWED, ACCESS_METHOD_NOT_ENABLED),
   * and every place without a job of a collector the registry lists as
   * BLOCKED, NOT_IMPLEMENTED or UNVERIFIED.
   */
  "LOCKED",
  /**
   * No collector is built for it: the registry lists none for it, or only
   * NOT_IMPLEMENTED ones, and none is held. The case holds nothing of them.
   */
  "NOT_BUILT",
  /**
   * The case holds nothing of its collectors; none of them may run or
   * completed a job in the case's runs, none is held, and one is listed as
   * BLOCKED: its source's licence verdict (any other is NOT_IMPLEMENTED).
   */
  "BLOCKED",
  /**
   * The case holds nothing of its collectors; none of them may run or
   * completed a job in the case's runs, none is held, and one is listed as
   * UNVERIFIED: its source's licence is unverified, so it never runs until a
   * verdict is recorded. Ahead of BLOCKED when both are listed: recording a
   * verdict is what would let the discipline collect (2026-10-16).
   */
  "UNVERIFIED",
] as const;
export type DisciplineStatus = (typeof DISCIPLINE_STATUSES)[number];

/**
 * Why a discipline's counts are null: NO_COLLECTOR_BUILT for NOT_BUILT,
 * ONLY_HELD_COLLECTORS for HELD, LOCKED for LOCKED, ONLY_BLOCKED_COLLECTORS for
 * BLOCKED, ONLY_UNVERIFIED_COLLECTORS for UNVERIFIED. Additive only: a stored
 * analysis keeps the codes it was made with.
 */
export const DISCIPLINE_NOT_MEASURED = [
  "NO_COLLECTOR_BUILT",
  "ONLY_HELD_COLLECTORS",
  "LOCKED",
  "ONLY_BLOCKED_COLLECTORS",
  "ONLY_UNVERIFIED_COLLECTORS",
] as const;
export type DisciplineNotMeasured = (typeof DISCIPLINE_NOT_MEASURED)[number];

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

/**
 * Whether a recorded reason says the collector could not run at all, for any
 * tenant: core's UNRUNNABLE_REASONS (its source BLOCKED or UNVERIFIED, no
 * implementation, or no access method of it enabled in that deployment), as a
 * run's plan recorded them for an exclusion, or a job for a refusal at
 * dispatch.
 */
const isUnrunnableReason = (code: string): boolean =>
  (UNRUNNABLE_REASONS as readonly string[]).includes(code);

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
  /**
   * Registered (REGISTERED): in the registry, and not listed as BLOCKED,
   * NOT_IMPLEMENTED or UNVERIFIED. One listed as any of them is not here: the
   * collectors document lists it under that registration, with its label and
   * discipline.
   */
  readonly registered: readonly CollectorRef[];
  /**
   * Its code ran: it found something, found nothing, failed, or its source
   * answered with nothing that is unconfirmed (EMPTY_UNCONFIRMED, here only,
   * with that state on the run: never in foundNothing).
   */
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
  /** Registered (as above), and named by none of the case's runs: registered since, or in a run whose plan was not recorded. */
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
  /**
   * Collectors in the case that the registry does not list (in any
   * registration) and that are not held, so they have no discipline.
   */
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

/**
 * The CONTRADICTIONS metric for a discipline: the entities whose stored claims
 * disagree on an attribute, counted where at least one conflicting position is
 * supported by this discipline's evidence (so a contradiction counts under
 * every discipline whose evidence backs it — the ENTITY_AND_RELATIONSHIP_COUNTS_OVERLAP
 * caveat). The full positions, with their evidence and strengths, are the
 * analysis's `contradictions`; this is the per-discipline pointer to the
 * entities to inspect. Zero means detection ran and this discipline's claims
 * disagree on nothing — never that detection is not built.
 */
function contradictedEntities(
  contradictions: CaseContradictions,
  disciplineEvidence: ReadonlySet<string>,
): Counted {
  return counted(
    contradictions.items
      .filter((item) =>
        item.positions.some((position) =>
          position.evidenceIds.some((evidenceId) => disciplineEvidence.has(evidenceId)),
        ),
      )
      .map((item) => item.entityId),
  );
}

function section(
  discipline: CollectorDiscipline,
  all: readonly CaseCollector[],
  contradictions: CaseContradictions,
): DisciplineSection {
  const collectors = all.filter((collector) => collector.discipline === discipline);
  // Only collectors the registry does not list as BLOCKED, NOT_IMPLEMENTED or
  // UNVERIFIED count as registered here (owner ruling, 2026-10-13; UNVERIFIED
  // since 2026-10-16). One listed as any of them cannot collect now, so being
  // listed does not make the discipline's zero measured; only a job it
  // completed in the case's runs does (below).
  const registered = collectors.filter((collector) => collector.registration === "REGISTERED");
  const blocked = collectors.some((collector) => collector.registration === "BLOCKED");
  const unverified = collectors.some((collector) => collector.registration === "UNVERIFIED");
  const held = collectors.flatMap((collector) =>
    collector.registration === "HELD" ? [{ ...ref(collector), reason: collector.heldReason }] : [],
  );
  const evidence = union(collectors, (collector) => collector.evidence);
  // A collector whose job completed in one of the case's runs collected then,
  // so its zero is measured, whether or not it may run now (held, or listed as
  // BLOCKED, NOT_IMPLEMENTED or UNVERIFIED). A refused, failed or unfinished
  // job did not.
  // An unconfirmed empty answer completed too: the zero is of the records the
  // case holds, and the source's own answer is never read as zero.
  const completedInCase = collectors.some((collector) =>
    collector.runs.some(
      (run) =>
        run.jobId !== null &&
        (run.state === "COLLECTED" ||
          run.state === "COLLECTED_NOT_PINNED" ||
          run.state === "NOTHING_FOUND" ||
          run.state === "EMPTY_UNCONFIRMED"),
    ),
  );
  const isLock = (run: CaseCollectorRun): boolean =>
    (run.state === "EXCLUDED" || run.state === "REFUSED") &&
    run.reasonCode !== null &&
    isLockReason(run.reasonCode);
  const cannotRunNow = (collector: CaseCollector): boolean =>
    collector.registration === "BLOCKED" ||
    collector.registration === "NOT_IMPLEMENTED" ||
    collector.registration === "UNVERIFIED";
  // A place where a collector could not run at all says nothing about a lock:
  // one a run recorded with one of core's UNRUNNABLE_REASONS, whatever the
  // collector is now; and any place without a job of a collector the registry
  // lists as BLOCKED, NOT_IMPLEMENTED or UNVERIFIED, because the planner may
  // record such a collector as not applicable, before it reaches those reasons.
  const couldRun = (collector: CaseCollector, run: CaseCollectorRun): boolean =>
    !(
      ((run.state === "EXCLUDED" || run.state === "REFUSED") &&
        run.reasonCode !== null &&
        isUnrunnableReason(run.reasonCode)) ||
      (run.jobId === null && cannotRunNow(collector))
    );
  // At every place the case's runs name one of its collectors where it could run, it was locked.
  const named = collectors.flatMap((collector) =>
    collector.runs.filter((run) => couldRun(collector, run)),
  );
  const allLocked = named.length > 0 && named.every(isLock);
  // NOT_BUILT is what is left: no evidence, no lock, nothing that may run or
  // completed a job, nothing held or listed as BLOCKED. That is a discipline
  // with no collector at all, or only NOT_IMPLEMENTED ones.
  const status: DisciplineStatus =
    evidence.count > 0
      ? "PRESENT"
      : allLocked
        ? "LOCKED"
        : registered.length > 0 || completedInCase
          ? "ZERO"
          : held.length > 0
            ? "HELD"
            : unverified
              ? "UNVERIFIED"
              : blocked
                ? "BLOCKED"
                : "NOT_BUILT";
  const reason: DisciplineNotMeasured | null =
    status === "NOT_BUILT"
      ? "NO_COLLECTOR_BUILT"
      : status === "HELD"
        ? "ONLY_HELD_COLLECTORS"
        : status === "LOCKED"
          ? "LOCKED"
          : status === "BLOCKED"
            ? "ONLY_BLOCKED_COLLECTORS"
            : status === "UNVERIFIED"
              ? "ONLY_UNVERIFIED_COLLECTORS"
              : null;
  const count = (measured: Counted): DisciplineCount =>
    reason === null ? measured : { count: null, ids: null, reason };

  return {
    discipline,
    status,
    evidence: count(evidence),
    claims: count(union(collectors, (collector) => collector.claims)),
    entities: count(union(collectors, (collector) => collector.entities)),
    relationships: count(union(collectors, (collector) => collector.relationships)),
    evidenceByStrength: reason === null ? unionByStrength(collectors, "evidence") : null,
    claimsByStrength: reason === null ? unionByStrength(collectors, "claims") : null,
    metrics: DISCIPLINE_METRICS[discipline].map((metric) =>
      // CONTRADICTIONS is built (ENGINE_VERSION 8): a measured count of this
      // discipline's contradicted entities. The rest are not built yet.
      metric === "CONTRADICTIONS"
        ? { metric, value: contradictedEntities(contradictions, new Set(evidence.ids)) }
        : { metric, value: { count: null, ids: null, reason: METRIC_NOT_BUILT[metric] } },
    ),
    collectors: {
      registered: registered.map(ref),
      ran: inGroup(
        collectors,
        (run) =>
          run.jobId !== null &&
          (run.state === "COLLECTED" ||
            run.state === "COLLECTED_NOT_PINNED" ||
            run.state === "NOTHING_FOUND" ||
            run.state === "EMPTY_UNCONFIRMED" ||
            run.state === "FAILED"),
      ),
      foundSomething: inGroup(
        collectors,
        (run) => run.state === "COLLECTED" || run.state === "COLLECTED_NOT_PINNED",
      ),
      // Never an unconfirmed empty answer: that one is in `ran`, with its state.
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

  const contradictions = caseContradictions(input);
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
    sections: COLLECTOR_DISCIPLINES.map((discipline) =>
      section(discipline, view.collectors, contradictions),
    ),
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

/**
 * One line for a breakdown's header, in the approved wording: the disciplines
 * present and the case's totals. When every evidence record comes from
 * collectors no longer registered, it says so. Never a percentage: the counts
 * overlap.
 */
export function breakdownHeadline(breakdown: CaseBreakdown): string {
  const wording = CASE_WORDING.breakdownHeadline;
  const present = breakdown.sections
    .filter((section) => section.status === "PRESENT")
    .map((section) => section.discipline);
  const { evidence, entities, relationships } = breakdown.totals;
  if (present.length > 0) {
    return fillWording(wording.present, {
      disciplines: present.join(", "),
      evidence: String(evidence.count),
      entities: String(entities.count),
      relationships: String(relationships.count),
    });
  }
  if (evidence.count > 0 && breakdown.notRegistered.evidence.count === evidence.count) {
    return fillWording(wording.onlyUnregistered, { evidence: String(evidence.count) });
  }
  return fillWording(wording.noDiscipline, { evidence: String(evidence.count) });
}
