/**
 * Report assembly: everything a report says that does not come from a model.
 * It reads what one settled run stored (its plan, its jobs' outcomes, its
 * evidence and the claims fused from it) and states it: every claim with its
 * strength and its citation, every source, and what was NOT collected and why.
 *
 * Nothing here is estimated. Coverage is named facts, never a percentage
 * (there is no honest denominator for "every source that exists"). This is
 * the previous codebase's completeness model (cases/case-report.ts,
 * INVENTORY: KEEP), with the two gaps its own caveats admitted closed, each
 * with a regression test:
 *   - it could not tell "ran and found nothing" from "failed": it read stored
 *     evidence only. Here each collector's recorded outcome decides its state;
 *   - it recomputed the plan at report time, so the plan could differ from the
 *     run. Here the run's own recorded plan is used.
 * A collector that needed credentials is reported from its recorded outcome,
 * not guessed from whether it declares any.
 */
import {
  HELD_PLATFORM_COLLECTORS,
  type CollectorRegistry,
  type HeldCollector,
} from "@repo/collectors";
import {
  AppError,
  REPORT_FORMAT_VERSION,
  type ClaimStrength,
  type CoverageEntry,
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
import { z } from "zod";
import { readRunProgress } from "../progress.ts";

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
}

/** A report without its synthesis, and the records a synthesis would be written from. */
export interface AssembledReport {
  readonly document: Omit<ReportDocument, "synthesis">;
  /** One record per cited source, referenced as E<number>. */
  readonly records: readonly UntrustedRecord[];
  /** Each record's source number and the source it came from (its independence key). */
  readonly refs: ReadonlyMap<string, { readonly number: number; readonly source: string }>;
}

/** The fixed caveats every report states. */
export const COVERAGE_CAVEATS: readonly string[] = [
  "This is not an exhaustive survey. It covers only the collectors named here, as they answered at the times shown.",
  "Nothing found means the source answered and held nothing for this target when asked. It is not evidence that nothing exists.",
  "A collector that was not run, failed, or was excluded contributed nothing. The absence of a finding from it means nothing.",
  "REPORTED claims are what the cited source stated; DERIVED claims were computed by the platform from recorded values. None has been independently verified.",
  "Sources can change after collection. Each source shows when it was collected.",
];

const PASSIVE_CAVEAT =
  "Collection was passive: every collector read a third party's record or analysed the input, and none contacted the target.";
const ACTIVE_CAVEAT =
  "At least one collector contacted the target directly under a recorded scope authorisation; see the coverage entries.";

const StoredPlan = z.looseObject({
  targets: z.array(
    z.union([
      z.object({ type: z.string(), value: z.string() }),
      z.object({ type: z.string(), invalid: z.string() }),
    ]),
  ),
  excluded: z.array(
    z.object({
      collectorId: z.string(),
      targetType: z.string().nullable(),
      reason: z.string(),
      message: z.string(),
    }),
  ),
});
const StoredPlanError = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

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

/** A value as readable text: scalars as they are, flat objects as `key: value`, the rest as JSON. */
export function displayValue(value: unknown, maxChars: number): ReportClaim["display"] {
  const scalar = (v: unknown): string =>
    typeof v === "string"
      ? v
      : typeof v === "number" || typeof v === "boolean"
        ? String(v)
        : JSON.stringify(v);
  let text: string;
  if (Array.isArray(value) && value.every((v) => typeof v !== "object" || v === null)) {
    text = value.map(scalar).join(", ");
  } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    text = Object.entries(value)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}: ${scalar(v)}`)
      .join("; ");
  } else {
    text = scalar(value);
  }
  return text.length > maxChars
    ? { text: text.slice(0, maxChars), truncated: true }
    : { text, truncated: false };
}

function labelOf(registry: CollectorRegistry, collectorId: string): string {
  // Labels come only from the registry. A collector no longer registered is
  // named by its id, and says so: nothing stands in for a label.
  return registry.list().some((entry) => entry.id === collectorId)
    ? registry.entry(collectorId).label
    : `${collectorId} (not in the current registry)`;
}

function coverageFromJob(job: Job, label: string): CoverageEntry {
  const base = {
    collectorId: job.collectorId,
    sourceLabel: label,
    targetType: job.targetType,
    attempts: job.attempts,
    // A job that found nothing recorded no evidence: a measured zero.
    evidenceCount: job.evidenceIds === null ? 0 : job.evidenceIds.length,
  };
  const error = { reasonCode: job.lastErrorCode, detail: job.lastErrorMessage };
  switch (job.status) {
    case "SUCCEEDED":
      return job.outcome === "FOUND"
        ? { ...base, state: "COLLECTED", reasonCode: null, detail: null }
        : { ...base, state: "NOTHING_FOUND", reasonCode: null, detail: job.outcomeDetail };
    case "FAILED":
      return {
        ...base,
        state:
          job.outcome === "NEEDS_CREDENTIALS"
            ? "NEEDS_CREDENTIALS"
            : job.outcome === "REFUSED"
              ? "REFUSED"
              : "FAILED",
        ...error,
      };
    case "DEAD_LETTERED":
      return { ...base, state: "FAILED", ...error };
    case "CANCELLED":
      return {
        ...base,
        state: "NOT_FINISHED",
        reasonCode: "CANCELLED",
        detail: "The job was cancelled.",
      };
    case "QUEUED":
    case "RUNNING":
      return { ...base, state: "NOT_FINISHED", reasonCode: job.status, detail: null };
  }
}

function headline(
  status: RunStatus,
  entries: readonly CoverageEntry[],
  planError: string | null,
): string {
  if (planError !== null) return `FAILED RUN: the run could not be planned (${planError}).`;
  const ran = entries.filter((e) => e.attempts !== null);
  const completed = ran.filter((e) => e.state === "COLLECTED" || e.state === "NOTHING_FOUND");
  const found = ran.filter((e) => e.state === "COLLECTED").length;
  const notRun = entries.filter((e) => e.attempts === null).length;
  const notRunNote =
    notRun === 0
      ? ""
      : ` ${String(notRun)} further collector(s) were excluded or held and did not run.`;
  const counts = `${String(found)} found something, ${String(completed.length - found)} found nothing`;
  switch (status) {
    case "SUCCEEDED":
      return `COMPLETE RUN: all ${String(ran.length)} planned collectors finished (${counts}).${notRunNote}`;
    case "PARTIAL":
      return `PARTIAL RUN: ${String(ran.length - completed.length)} of ${String(ran.length)} planned collectors did not complete, so this report does not cover what they would have collected (${counts}).${notRunNote}`;
    case "FAILED":
      return `FAILED RUN: none of the ${String(ran.length)} planned collectors completed.${notRunNote}`;
    default:
      return `The run's status is ${status}.`;
  }
}

function coverageOf(
  registry: CollectorRegistry,
  status: RunStatus,
  plan: unknown,
  jobs: readonly Job[],
  held: readonly HeldCollector[],
): ReportCoverage {
  const failed = StoredPlanError.safeParse(plan);
  const parsed = StoredPlan.safeParse(plan);
  const entries: CoverageEntry[] = jobs.map((job) =>
    coverageFromJob(job, labelOf(registry, job.collectorId)),
  );
  const notApplicable: { collectorId: string; sourceLabel: string }[] = [];
  let planError: string | null = null;
  let validTypes: TargetType[] = [];

  if (failed.success) {
    planError = failed.data.error.message;
  } else if (!parsed.success) {
    planError = "its plan was not recorded";
  } else {
    validTypes = parsed.data.targets
      .filter((t): t is { type: string; value: string } => "value" in t)
      .map((t) => t.type as TargetType);
    for (const excluded of parsed.data.excluded) {
      const label = labelOf(registry, excluded.collectorId);
      if (excluded.reason === "TARGET_TYPE_NOT_ACCEPTED") {
        notApplicable.push({ collectorId: excluded.collectorId, sourceLabel: label });
        continue;
      }
      entries.push({
        collectorId: excluded.collectorId,
        sourceLabel: label,
        state: "EXCLUDED",
        targetType: excluded.targetType as TargetType | null,
        reasonCode: excluded.reason,
        detail: excluded.message,
        evidenceCount: 0,
        attempts: null,
      });
    }
  }
  for (const entry of held) {
    const declaration = entry.collector.declaration;
    const applies = declaration.targetTypes.find((type) => validTypes.includes(type));
    if (applies === undefined) continue;
    entries.push({
      collectorId: declaration.id,
      sourceLabel: declaration.displayName,
      state: "HELD",
      targetType: applies,
      reasonCode: "COLLECTOR_HELD",
      detail: entry.reason,
      evidenceCount: 0,
      attempts: null,
    });
  }

  const active = jobs.some(
    (job) =>
      registry.list().some((e) => e.id === job.collectorId) &&
      registry.entry(job.collectorId).collectionMode === "ACTIVE",
  );
  return {
    runStatus: status,
    partial: status !== "SUCCEEDED" || planError !== null,
    headline: headline(status, entries, planError),
    entries,
    notApplicable,
    caveats: [active ? ACTIVE_CAVEAT : PASSIVE_CAVEAT, ...COVERAGE_CAVEATS],
  };
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
      sourceLabel: labelOf(registry, row.collectorId),
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
