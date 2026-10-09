/**
 * Report assembly: everything a report says that does not come from a model.
 * It reads what one settled run stored (its plan, its jobs' outcomes, its
 * evidence and the claims fused from it) and states it: every claim with its
 * strength and its citation, every source, and what was NOT collected and why.
 *
 * Nothing here is estimated. Coverage is named facts, never a percentage
 * (there is no honest denominator for "every source that exists"). The
 * coverage model, and the display of a claim's value, live in
 * @repo/case-engine (owner ruling D-1), which a case's coverage shares; this
 * file reads the run's rows and hands them over as plain data.
 */
import {
  COVERAGE_CAVEATS,
  coverageFromJob,
  coverageHeadline,
  displayValue,
  runCoverage,
  sourceLabelOf,
  type CoverageCollector,
  type CoverageHeldCollector,
} from "@repo/case-engine";
import {
  HELD_PLATFORM_COLLECTORS,
  type CollectorRegistry,
  type HeldCollector,
} from "@repo/collectors";
import {
  AppError,
  REPORT_FORMAT_VERSION,
  REPORT_WORDING,
  type ClaimStrength,
  type ReportAttribution,
  type ReportClaim,
  type ReportCoverage,
  type ReportDocument,
  type ReportEntity,
  type ReportRelationship,
  type ReportSource,
  type RunStatus,
  type TargetType,
  type UntrustedContentWarning,
} from "@repo/core";
import type { Claim, Entity, Evidence, Job, Repositories } from "@repo/db";
import { scanText, stringsIn, type UntrustedRecord } from "@repo/llm";
import { readRunProgress } from "../progress.ts";
import { coveragePlan, StoredPlan } from "./stored-plan.ts";

export class ReportRunNotSettledError extends AppError {
  readonly code = "RUN_NOT_SETTLED";

  constructor() {
    super("The run has not finished, or not every found result is fused yet.");
    this.name = "ReportRunNotSettledError";
  }
}

export class ReportRunNotFoundError extends AppError {
  readonly code = "RUN_NOT_FOUND";

  constructor() {
    super("The run does not exist in this tenant.");
    this.name = "ReportRunNotFoundError";
  }
}

export interface AssemblyLimits {
  /** Claims included; the rest are counted in `omittedClaims`. */
  readonly maxClaims: number;
  /** Characters of a claim's value shown before it is marked truncated. */
  readonly maxDisplayChars: number;
}

export const DEFAULT_ASSEMBLY_LIMITS: AssemblyLimits = { maxClaims: 2000, maxDisplayChars: 600 };

export interface AssemblyInput {
  readonly reportId: string;
  readonly runId: string;
  readonly generatedAt: Date;
  readonly handlingMarking: string | null;
  /** The product generating the report, as configured: stored as its producer. */
  readonly producedBy: string;
}

/** A report without its synthesis, and the records a synthesis would be written from. */
export interface AssembledReport {
  readonly document: Omit<ReportDocument, "synthesis">;
  /** One record per cited source, referenced as E<number>. */
  readonly records: readonly UntrustedRecord[];
  /** Each record's source number and the source it came from (its independence key). */
  readonly refs: ReadonlyMap<string, { readonly number: number; readonly source: string }>;
}

const MAX_IDS_PER_QUERY = 1000;
/** Sources and claims per source given to a synthesis, so its prompt stays bounded. */
const MAX_SYNTHESIS_SOURCES = 40;
const MAX_SYNTHESIS_CLAIMS_PER_SOURCE = 25;
const SYNTHESIS_VALUE_CHARS = 300;

async function chunked<T>(
  ids: readonly string[],
  read: (chunk: readonly string[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_QUERY) {
    out.push(...(await read(ids.slice(i, i + MAX_IDS_PER_QUERY))));
  }
  return out;
}

// The coverage functions moved to @repo/case-engine (owner ruling D-1). They
// are re-exported here so the run report's golden test reads them where it
// always has; test/coverage-golden.test.ts proves the output unchanged.
export { COVERAGE_CAVEATS, coverageFromJob, coverageHeadline as headline, displayValue };

/** The registry, as coverage reads it: each collector's id, label and mode. */
function coverageCollectors(registry: CollectorRegistry): CoverageCollector[] {
  return registry.list().map((entry) => ({
    id: entry.id,
    label: entry.label,
    collectionMode: entry.collectionMode,
  }));
}

/** The held collectors, as coverage reads them. */
function coverageHeld(held: readonly HeldCollector[]): CoverageHeldCollector[] {
  return held.map((entry) => ({
    id: entry.collector.declaration.id,
    displayName: entry.collector.declaration.displayName,
    targetTypes: entry.collector.declaration.targetTypes,
    reason: entry.reason,
  }));
}

/** A run's coverage, from its stored plan, its jobs and the held collectors. */
export function coverageOf(
  registry: CollectorRegistry,
  status: RunStatus,
  plan: unknown,
  jobs: readonly Job[],
  held: readonly HeldCollector[],
): ReportCoverage {
  return runCoverage({
    registry: coverageCollectors(registry),
    status,
    plan: coveragePlan(plan),
    jobs,
    held: coverageHeld(held),
  });
}

const endpoint = (entity: Entity) => ({
  entityId: entity.id,
  kind: entity.kind,
  displayName: entity.displayName,
  identifier: entity.identifier,
});

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

/** Builds everything but the synthesis, from what the settled run stored. */
export async function assembleReport(
  repos: Repositories,
  registry: CollectorRegistry,
  input: AssemblyInput,
  limits: AssemblyLimits = DEFAULT_ASSEMBLY_LIMITS,
): Promise<AssembledReport> {
  const progress = await readRunProgress(repos, input.runId);
  if (progress === null) throw new ReportRunNotFoundError();
  if (!progress.settled) throw new ReportRunNotSettledError();
  const run = await repos.runs.findById(input.runId);
  const investigation =
    run === null ? null : await repos.investigations.findById(run.investigationId);
  if (run === null || investigation === null) throw new ReportRunNotFoundError();
  const jobs = await repos.jobs.listForRun(input.runId, { limit: 1000 });
  const collectors = coverageCollectors(registry);

  // Evidence, in the order the jobs cited it.
  const evidenceIds = jobs.flatMap((job) =>
    job.outcome === "FOUND" ? (job.evidenceIds ?? []) : [],
  );
  const evidenceRows = await chunked(evidenceIds, (ids) => repos.evidence.findByIds(ids));
  const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
  const claims = (
    await chunked(evidenceIds, (ids) =>
      repos.claims.listForEvidence(ids, { limit: Math.min(MAX_IDS_PER_QUERY, limits.maxClaims) }),
    )
  ).slice(0, limits.maxClaims);
  const claimTotal = (
    await chunked(evidenceIds, async (ids) => [await repos.claims.countForEvidence(ids)])
  ).reduce((sum, count) => sum + count, 0);

  const entityIds = [...new Set(claims.flatMap((c) => (c.entityId === null ? [] : [c.entityId])))];
  const relationshipIds = [
    ...new Set(claims.flatMap((c) => (c.relationshipId === null ? [] : [c.relationshipId]))),
  ];
  const relationships = await chunked(relationshipIds, (ids) =>
    repos.entityRelationships.findByIds(ids),
  );
  const endpointIds = relationships.flatMap((r) => [r.sourceEntityId, r.targetEntityId]);
  const entities = await chunked([...new Set([...entityIds, ...endpointIds])], (ids) =>
    repos.entities.findByIds(ids),
  );
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const relationshipById = new Map(relationships.map((r) => [r.id, r]));

  // Citation numbers: in order of first citation, then uncited evidence.
  const numberOf = new Map<string, number>();
  const cite = (evidenceId: string): number => {
    const existing = numberOf.get(evidenceId);
    if (existing !== undefined) return existing;
    const next = numberOf.size + 1;
    numberOf.set(evidenceId, next);
    return next;
  };

  const findings = new Map<string, { entity: Entity; claims: ReportClaim[] }>();
  const relationshipRows = new Map<string, ReportRelationship & { citations: number[] }>();
  for (const claim of claims) {
    const number = cite(claim.evidenceId);
    if (claim.entityId !== null) {
      const entity = entityById.get(claim.entityId);
      if (entity === undefined) continue;
      const finding = findings.get(entity.id) ?? { entity, claims: [] };
      finding.claims.push({
        claimId: claim.id,
        attribute: claim.attribute,
        value: claim.value,
        display: displayValue(claim.value, limits.maxDisplayChars),
        strength: claim.strength,
        citations: [number],
      });
      findings.set(entity.id, finding);
    } else if (claim.relationshipId !== null) {
      const relationship = relationshipById.get(claim.relationshipId);
      const from =
        relationship === undefined ? undefined : entityById.get(relationship.sourceEntityId);
      const to =
        relationship === undefined ? undefined : entityById.get(relationship.targetEntityId);
      if (relationship === undefined || from === undefined || to === undefined) continue;
      const key = `${relationship.id}|${claim.strength}`;
      const row = relationshipRows.get(key) ?? {
        relationshipId: relationship.id,
        from: endpoint(from),
        kind: relationship.kind,
        to: endpoint(to),
        strength: claim.strength,
        citations: [],
      };
      if (!row.citations.includes(number)) row.citations.push(number);
      relationshipRows.set(key, row);
    }
  }
  for (const id of evidenceIds) cite(id);

  const sources: ReportSource[] = [...numberOf.entries()]
    .map(([evidenceId, number]) => ({ evidenceId, number, row: evidenceById.get(evidenceId) }))
    .filter((s): s is { evidenceId: string; number: number; row: Evidence } => s.row !== undefined)
    .map(({ evidenceId, number, row }) => ({
      number,
      evidenceId,
      collectorId: row.collectorId,
      sourceLabel: sourceLabelOf(collectors, row.collectorId),
      sourceUrl: row.sourceUrl,
      collectedAt: iso(row.collectedAt),
      observedAt: iso(row.observedAt),
      contentHash: row.contentHash,
      strength: row.claimStrength,
      // Counted over the claims this report includes: a measured count, zero when none.
      claimCount: claims.filter((claim) => claim.evidenceId === evidenceId).length,
    }))
    .sort((a, b) => a.number - b.number);

  const findingList: ReportEntity[] = [...findings.values()].map(({ entity, claims: list }) => ({
    entityId: entity.id,
    kind: entity.kind,
    displayName: entity.displayName,
    identifier: entity.identifier,
    claims: list,
  }));

  // Attribution travels with the data: every contributing collector's source that requires it.
  const attributions = new Map<string, ReportAttribution & { collectorIds: string[] }>();
  for (const source of sources) {
    if (!registry.list().some((e) => e.id === source.collectorId)) continue;
    const entry = registry.entry(source.collectorId);
    if (entry.attribution === null) continue;
    const existing = attributions.get(entry.source.id) ?? {
      sourceId: entry.source.id,
      text: entry.attribution.text,
      url: entry.attribution.url,
      collectorIds: [],
    };
    if (!existing.collectorIds.includes(entry.id)) existing.collectorIds.push(entry.id);
    attributions.set(entry.source.id, existing);
  }

  const { records, refs, warnings } = synthesisRecords(sources, findingList, [
    ...relationshipRows.values(),
  ]);

  const plan = StoredPlan.safeParse(run.plan);
  const targetTypes = plan.success
    ? plan.data.targets
        .filter((t): t is { type: string; value: string } => "value" in t)
        .map((t) => ({ type: t.type as TargetType, value: t.value }))
    : [];

  return {
    document: {
      formatVersion: REPORT_FORMAT_VERSION,
      reportId: input.reportId,
      title: investigation.title,
      investigationId: investigation.id,
      runId: run.id,
      target: { input: investigation.target, types: targetTypes },
      run: { status: run.status, startedAt: iso(run.startedAt), finishedAt: iso(run.finishedAt) },
      generatedAt: input.generatedAt.toISOString(),
      handlingMarking: input.handlingMarking,
      coverage: coverageOf(registry, run.status, run.plan, jobs, HELD_PLATFORM_COLLECTORS),
      findings: findingList,
      relationships: [...relationshipRows.values()],
      sources,
      attributions: [...attributions.values()],
      untrustedContent: warnings,
      omittedClaims: Math.max(0, claimTotal - claims.length),
      // A copy, taken now: the report keeps this wording whatever the code says later.
      wording: structuredClone(REPORT_WORDING),
      producedBy: input.producedBy,
    },
    records,
    refs,
  };
}

/**
 * The records a synthesis is written from: one per cited source, holding that
 * source's claims as text. Every string in them is collected data, and is
 * passed to a model only through @repo/llm's untrusted framing. The same pass
 * marks sources whose content reads as instructions to an AI system.
 */
function synthesisRecords(
  sources: readonly ReportSource[],
  findings: readonly ReportEntity[],
  relationships: readonly ReportRelationship[],
): {
  records: UntrustedRecord[];
  refs: Map<string, { number: number; source: string }>;
  warnings: UntrustedContentWarning[];
} {
  const byNumber = new Map<number, { subject: string; attribute: string; value: string }[]>();
  const add = (number: number, item: { subject: string; attribute: string; value: string }) => {
    const list = byNumber.get(number) ?? [];
    list.push(item);
    byNumber.set(number, list);
  };
  for (const finding of findings) {
    for (const claim of finding.claims) {
      for (const number of claim.citations) {
        add(number, {
          subject: finding.displayName,
          attribute: claim.attribute,
          value: displayValue(claim.value, SYNTHESIS_VALUE_CHARS).text,
        });
      }
    }
  }
  for (const relationship of relationships) {
    for (const number of relationship.citations) {
      add(number, {
        subject: relationship.from.displayName,
        attribute: relationship.kind,
        value: relationship.to.displayName,
      });
    }
  }

  const records: UntrustedRecord[] = [];
  const refs = new Map<string, { number: number; source: string }>();
  const warnings: UntrustedContentWarning[] = [];
  for (const source of sources) {
    const items = byNumber.get(source.number) ?? [];
    const patterns = new Set(
      items.flatMap((item) =>
        stringsIn(item).flatMap((text) => scanText(text).map((f) => f.pattern)),
      ),
    );
    if (patterns.size > 0) warnings.push({ sourceNumber: source.number, patterns: [...patterns] });
    if (items.length === 0 || records.length >= MAX_SYNTHESIS_SOURCES) continue;
    const ref = `E${String(source.number)}`;
    records.push({
      ref,
      source: source.sourceLabel,
      content: { claims: items.slice(0, MAX_SYNTHESIS_CLAIMS_PER_SOURCE) },
    });
    refs.set(ref, { number: source.number, source: source.collectorId });
  }
  return { records, refs, warnings };
}

export type { Claim, ClaimStrength };
