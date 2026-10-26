/**
 * What a stored case analysis holds, and its schema (R1-b): case-engine's
 * three documents for one input, with the records the analysis read.
 *
 * The schema mirrors case-engine's types exactly (each `satisfies` the type it
 * mirrors) and is checked at both ends: the job validates a document before
 * recording it, and the API validates it again on the way out and generates
 * its OpenAPI entries from it (CLAUDE.md §7).
 */
import {
  CASE_BREAKDOWN_CAVEATS,
  CASE_COVERAGE_CAVEATS,
  CASE_COVERAGE_STATES,
  CASE_PARTIAL_REASONS,
  DISCIPLINE_NOT_MEASURED,
  DISCIPLINE_STATUSES,
  METRIC_NOT_BUILT,
  REGISTRATIONS,
  type CaseBreakdown,
  type CaseCollectors,
  type CaseContradictions,
  type CaseCoverage,
  type Contradiction,
  type ContradictionPosition,
  type DisciplineMetricName,
  type EmptyCase,
} from "@repo/case-engine";
import {
  CLAIM_STRENGTHS,
  COLLECTOR_DISCIPLINES,
  COVERAGE_STATES,
  RUN_STATUSES,
  TARGET_TYPES,
  type CaseWording,
} from "@repo/core";
import { z } from "zod";

/**
 * The format of the stored document; a change to its shape is a new version.
 * A value added to one of its code lists is not: every stored document still
 * parses (ENGINE_VERSION 5 added BLOCKED and NOT_IMPLEMENTED that way). Every
 * read re-parses a stored document with this schema, so a value is never
 * removed or renamed.
 */
export const CASE_ANALYSIS_FORMAT_VERSION = 1;

/** What a stored case analysis holds: case-engine's three documents for one input. */
export interface CaseAnalysisDocument {
  readonly formatVersion: typeof CASE_ANALYSIS_FORMAT_VERSION;
  readonly engineVersion: number;
  readonly caseId: string;
  readonly inputHash: string;
  /**
   * The records the analysis read and rests on, by id, as they were when it
   * ran. A read of the document probes these for person data as well as the
   * case as it is now (CLAUDE.md §9: the gate applies however old the data is).
   */
  readonly basis: {
    readonly evidenceIds: readonly string[];
    readonly runIds: readonly string[];
  };
  readonly coverage: CaseCoverage | EmptyCase;
  readonly collectors: CaseCollectors | EmptyCase;
  readonly breakdown: CaseBreakdown | EmptyCase;
  /**
   * The reviewable contradictions in the case's claims (ENGINE_VERSION 8).
   * Optional and additive: a document stored before version 8 does not carry
   * it, and still parses; every version-8 document sets it. The `| undefined`
   * mirrors Zod's `.optional()` output under exactOptionalPropertyTypes.
   */
  readonly contradictions?: CaseContradictions | undefined;
}

const count = z.number().int().min(0);
const Counted = z.object({ count, ids: z.array(z.string()) });
const Strength = z.enum(CLAIM_STRENGTHS);
const ByStrength = z.record(Strength, Counted);
const instant = z.iso.datetime().nullable();
const header = { engineVersion: z.number().int().min(1), caseId: z.uuid() };

const EmptyCaseSchema = z.object({
  kind: z.literal("EMPTY_CASE"),
  ...header,
  reason: z.literal("NO_RECORDS_IN_CASE"),
}) satisfies z.ZodType<EmptyCase>;

const CollectorRun = z.object({
  runId: z.uuid(),
  jobId: z.uuid().nullable(),
  state: z.enum(CASE_COVERAGE_STATES),
  reasonCode: z.string().nullable(),
  detail: z.string().nullable(),
});

const RunCoverage = z.object({
  runId: z.uuid(),
  investigation: z.object({ id: z.uuid(), title: z.string() }),
  startedAt: instant,
  finishedAt: instant,
  coverage: z.object({
    runStatus: z.enum(RUN_STATUSES),
    partial: z.boolean(),
    headline: z.string(),
    entries: z.array(
      z.object({
        collectorId: z.string(),
        sourceLabel: z.string(),
        state: z.enum(COVERAGE_STATES),
        targetType: z.enum(TARGET_TYPES).nullable(),
        reasonCode: z.string().nullable(),
        detail: z.string().nullable(),
        evidenceCount: count,
        attempts: count.nullable(),
      }),
    ),
    notApplicable: z.array(z.object({ collectorId: z.string(), sourceLabel: z.string() })),
    caveats: z.array(z.string()),
  }),
  jobs: z.array(
    z.object({
      jobId: z.uuid(),
      collectorId: z.string(),
      sourceLabel: z.string(),
      state: z.enum(CASE_COVERAGE_STATES),
      collected: Counted,
      inCase: Counted,
      notInCase: Counted,
    }),
  ),
  evidenceInCase: Counted,
});

const TimeSpan = z.object({
  earliest: instant,
  latest: instant,
  reason: z.enum(["NOT_RECORDED_ON_ANY_EVIDENCE", "NO_EVIDENCE_IN_CASE"]).nullable(),
  recorded: Counted,
  notRecorded: Counted,
});

const CaseCoverageSchema = z.object({
  kind: z.literal("CASE_COVERAGE"),
  ...header,
  partial: z.boolean(),
  partialBecause: z.array(z.enum(CASE_PARTIAL_REASONS)),
  partialRuns: Counted,
  runs: z.array(RunCoverage),
  evidence: Counted,
  evidenceWithNoRecordedJob: z.object({
    evidence: Counted,
    byCollector: z.array(
      z.object({ collectorId: z.string(), sourceLabel: z.string(), evidence: Counted }),
    ),
  }),
  collectedAt: TimeSpan,
  observedAt: TimeSpan,
  caveats: z.array(z.enum(CASE_COVERAGE_CAVEATS)),
}) satisfies z.ZodType<CaseCoverage>;

const CollectorRecords = z.object({
  collectorId: z.string(),
  sourceLabel: z.string(),
  discipline: z.enum(COLLECTOR_DISCIPLINES).nullable(),
  evidence: Counted,
  evidenceByStrength: ByStrength,
  evidenceWithNoRecordedJob: Counted,
  claims: Counted,
  claimsByStrength: ByStrength,
  entities: Counted,
  relationships: Counted,
  runs: z.array(CollectorRun),
});
// Every registration but HELD, which alone carries a reason: named by value,
// never by position, so a value added to REGISTRATIONS is read here too.
const NOT_HELD = REGISTRATIONS.filter(
  (registration): registration is Exclude<(typeof REGISTRATIONS)[number], "HELD"> =>
    registration !== "HELD",
);
const [FIRST_NOT_HELD, ...OTHERS_NOT_HELD] = NOT_HELD;
// An invariant of the vocabulary, checked once when the module loads.
if (FIRST_NOT_HELD === undefined) throw new TypeError("REGISTRATIONS lists nothing but HELD");

const CaseCollectorsSchema = z.object({
  kind: z.literal("CASE_COLLECTORS"),
  ...header,
  collectors: z.array(
    z.union([
      CollectorRecords.extend({
        registration: z.enum([FIRST_NOT_HELD, ...OTHERS_NOT_HELD]),
        heldReason: z.null(),
      }),
      CollectorRecords.extend({ registration: z.literal("HELD"), heldReason: z.string() }),
    ]),
  ),
}) satisfies z.ZodType<CaseCollectors>;

const CollectorRef = z.object({ collectorId: z.string(), sourceLabel: z.string() });
const CollectorRuns = CollectorRef.extend({ runs: z.array(CollectorRun) });
const notMeasured = <Reason extends z.ZodType<string>>(reason: Reason) =>
  z.object({ count: z.null(), ids: z.null(), reason });
const DisciplineCount = z.union([Counted, notMeasured(z.enum(DISCIPLINE_NOT_MEASURED))]);
// Every metric name is a key of METRIC_NOT_BUILT (it satisfies a record over them).
const METRIC_NAMES = Object.keys(METRIC_NOT_BUILT) as DisciplineMetricName[];

const CaseBreakdownSchema = z.object({
  kind: z.literal("CASE_BREAKDOWN"),
  ...header,
  sections: z.array(
    z.object({
      discipline: z.enum(COLLECTOR_DISCIPLINES),
      status: z.enum(DISCIPLINE_STATUSES),
      evidence: DisciplineCount,
      claims: DisciplineCount,
      entities: DisciplineCount,
      relationships: DisciplineCount,
      evidenceByStrength: ByStrength.nullable(),
      claimsByStrength: ByStrength.nullable(),
      metrics: z.array(
        z.object({
          metric: z.literal(METRIC_NAMES),
          value: z.union([Counted, notMeasured(z.enum(METRIC_NOT_BUILT))]),
        }),
      ),
      collectors: z.object({
        registered: z.array(CollectorRef),
        ran: z.array(CollectorRuns),
        foundSomething: z.array(CollectorRuns),
        foundNothing: z.array(CollectorRuns),
        failed: z.array(CollectorRuns),
        notFinished: z.array(CollectorRuns),
        locked: z.array(CollectorRuns),
        excluded: z.array(CollectorRuns),
        notApplicable: z.array(CollectorRuns),
        held: z.array(CollectorRef.extend({ reason: z.string() })),
        notInAnyRun: z.array(CollectorRef),
      }),
    }),
  ),
  notRegistered: z.object({
    collectors: z.array(CollectorRef),
    evidence: Counted,
    claims: Counted,
    entities: Counted,
    relationships: Counted,
  }),
  totals: z.object({
    evidence: Counted,
    claims: Counted,
    entities: Counted,
    relationships: Counted,
    evidenceByStrength: ByStrength,
    claimsByStrength: ByStrength,
  }),
  entitiesWithNoClaim: Counted,
  relationshipsWithNoClaim: Counted,
  caveats: z.array(z.enum(CASE_BREAKDOWN_CAVEATS)),
}) satisfies z.ZodType<CaseBreakdown>;

// Mirrors case-engine's CaseContradictions exactly. A position's `value` is the
// stored claim value, any JSON, carried through unchanged.
const ContradictionPositionSchema = z.object({
  value: z.unknown(),
  evidenceIds: z.array(z.string()),
  strengths: z.array(Strength),
}) satisfies z.ZodType<ContradictionPosition>;

const ContradictionSchema = z.object({
  entityId: z.string(),
  attribute: z.string(),
  positions: z.array(ContradictionPositionSchema),
}) satisfies z.ZodType<Contradiction>;

const CaseContradictionsSchema = z.object({
  items: z.array(ContradictionSchema),
  caveat: z.string(),
}) satisfies z.ZodType<CaseContradictions>;

/** A stored case analysis document, validated whole. */
export const CaseAnalysisDocumentSchema = z.object({
  formatVersion: z.literal(CASE_ANALYSIS_FORMAT_VERSION),
  ...header,
  inputHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  basis: z.object({ evidenceIds: z.array(z.uuid()), runIds: z.array(z.uuid()) }),
  coverage: z.union([CaseCoverageSchema, EmptyCaseSchema]),
  collectors: z.union([CaseCollectorsSchema, EmptyCaseSchema]),
  breakdown: z.union([CaseBreakdownSchema, EmptyCaseSchema]),
  // Optional for backward compatibility: a document stored before ENGINE_VERSION
  // 8 has no contradictions field and still parses (it reads STALE, as its hash
  // differs). Every version-8 document sets it.
  contradictions: CaseContradictionsSchema.optional(),
}) satisfies z.ZodType<CaseAnalysisDocument>;

/** The wording a document was produced under (CASE_WORDING), as stored beside it. */
export const CaseWordingSchema = z.object({
  coverageCaveats: z.object({ NO_NEW_COLLECTION: z.string() }),
  breakdownCaveats: z.object({
    COUNTS_ARE_NOT_COVERAGE: z.string(),
    DISCIPLINE_FROM_REGISTRY: z.string(),
    ENTITY_AND_RELATIONSHIP_COUNTS_OVERLAP: z.string(),
    UNMEASURED_IS_NOT_ZERO: z.string(),
  }),
  breakdownHeadline: z.object({
    present: z.string(),
    onlyUnregistered: z.string(),
    noDiscipline: z.string(),
  }),
}) satisfies z.ZodType<CaseWording>;
