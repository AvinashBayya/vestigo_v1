/**
 * A case built to reach every state the engine reports. Ids and labels are
 * bracketed placeholders; times are fixed ISO 8601 instants.
 *
 *   run A, investigation one, a domain, PARTIAL:
 *     dns found ev1 and ev2 (both pinned); crt found nothing; rdap failed;
 *     wayback found ev3, which is not pinned; gh and wd do not apply;
 *     phone is locked (module not in plan); active is excluded (no scope);
 *     the held news collector applies.
 *   run B, investigation two, a username, SUCCEEDED:
 *     gh found ev4 (pinned); wd found nothing; the domain collectors do not
 *     apply; phone is locked (vetting not approved).
 *   ev5 (dns) and ev6 (a collector no longer registered) have no recorded job.
 *   GEOINT has no collector; "late" was registered after both runs.
 */
import { expect } from "vitest";
import type {
  CaseClaim,
  CaseEvidence,
  CaseHeldCollector,
  CaseInput,
  CaseJob,
  CaseRegistryCollector,
  CaseRun,
  CoverageExclusion,
} from "../src/index.ts";

export const id = (name: string): string => `[${name}]`;

/** The value, or a failed test naming what was missing. */
export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) return expect.fail(`[test] ${what} is missing`);
  return value;
}

export const REGISTRY: readonly CaseRegistryCollector[] = [
  { id: "dns", label: "[fake dns]", collectionMode: "PASSIVE_API", discipline: "TECHINT" },
  { id: "crt", label: "[fake crt]", collectionMode: "PASSIVE_DATASET", discipline: "TECHINT" },
  { id: "rdap", label: "[fake rdap]", collectionMode: "PASSIVE_API", discipline: "TECHINT" },
  { id: "active", label: "[fake active]", collectionMode: "ACTIVE", discipline: "TECHINT" },
  { id: "late", label: "[fake late]", collectionMode: "PASSIVE_API", discipline: "TECHINT" },
  { id: "gh", label: "[fake gh]", collectionMode: "PASSIVE_API", discipline: "SOCMINT" },
  { id: "wd", label: "[fake wd]", collectionMode: "PASSIVE_API", discipline: "SOCMINT" },
  { id: "wayback", label: "[fake wayback]", collectionMode: "PASSIVE_API", discipline: "MEDIAINT" },
  { id: "phone", label: "[fake phone]", collectionMode: "LOCAL_ANALYSIS", discipline: "PERSON" },
];

export const HELD: readonly CaseHeldCollector[] = [
  {
    id: "news",
    displayName: "[fake news]",
    targetTypes: ["DOMAIN"],
    reason: "[test] Held until [condition].",
    discipline: "MEDIAINT",
    collectionMode: "PASSIVE_PUBLIC_WEB",
  },
];

const notApplicable = (collectorId: string): CoverageExclusion => ({
  collectorId,
  targetType: null,
  reason: "TARGET_TYPE_NOT_ACCEPTED",
  message: `[test] ${collectorId} does not accept this target.`,
});

export const RUNS: readonly CaseRun[] = [
  {
    id: id("run A"),
    investigationId: id("investigation one"),
    investigationTitle: "[Investigation one]",
    status: "PARTIAL",
    plan: {
      kind: "PLANNED",
      targetTypes: ["DOMAIN"],
      excluded: [
        notApplicable("gh"),
        notApplicable("wd"),
        {
          collectorId: "phone",
          targetType: "DOMAIN",
          reason: "MODULE_NOT_IN_PLAN",
          message: "[test] module not in plan",
        },
        {
          collectorId: "active",
          targetType: "DOMAIN",
          reason: "SCOPE_AUTHORISATION_REQUIRED",
          message: "[test] needs a scope authorisation",
        },
      ],
    },
    startedAt: "2026-09-01T10:00:00.000Z",
    finishedAt: "2026-09-01T10:05:00.000Z",
  },
  {
    id: id("run B"),
    investigationId: id("investigation two"),
    investigationTitle: "[Investigation two]",
    status: "SUCCEEDED",
    plan: {
      kind: "PLANNED",
      targetTypes: ["USERNAME"],
      excluded: [
        ...["active", "crt", "dns", "rdap", "wayback"].map(notApplicable),
        {
          collectorId: "phone",
          targetType: "USERNAME",
          reason: "VETTING_NOT_APPROVED",
          message: "[test] vetting not approved",
        },
      ],
    },
    startedAt: "2026-09-05T09:00:00.000Z",
    finishedAt: null,
  },
];

const job = (
  name: string,
  runName: string,
  fields: Partial<CaseJob> & Pick<CaseJob, "collectorId" | "status">,
): CaseJob => ({
  id: id(name),
  runId: id(runName),
  outcome: null,
  outcomeDetail: null,
  targetType: "DOMAIN",
  attempts: 1,
  evidenceIds: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  ...fields,
});

export const JOBS: readonly CaseJob[] = [
  job("job A dns", "run A", {
    collectorId: "dns",
    status: "SUCCEEDED",
    outcome: "FOUND",
    evidenceIds: [id("ev1"), id("ev2")],
  }),
  job("job A crt", "run A", {
    collectorId: "crt",
    status: "SUCCEEDED",
    outcome: "NOT_FOUND",
    outcomeDetail: "[test] no certificates",
  }),
  job("job A rdap", "run A", {
    collectorId: "rdap",
    status: "FAILED",
    outcome: "UNAVAILABLE",
    attempts: 3,
    lastErrorCode: "UPSTREAM_TIMEOUT",
    lastErrorMessage: "[test] timed out",
  }),
  job("job A wayback", "run A", {
    collectorId: "wayback",
    status: "SUCCEEDED",
    outcome: "FOUND",
    evidenceIds: [id("ev3")],
  }),
  job("job B gh", "run B", {
    collectorId: "gh",
    status: "SUCCEEDED",
    outcome: "FOUND",
    targetType: "USERNAME",
    evidenceIds: [id("ev4")],
  }),
  job("job B wd", "run B", {
    collectorId: "wd",
    status: "SUCCEEDED",
    outcome: "NOT_FOUND",
    targetType: "USERNAME",
  }),
];

export const EVIDENCE: readonly CaseEvidence[] = [
  {
    id: id("ev1"),
    collectorId: "dns",
    jobId: id("job A dns"),
    collectedAt: "2026-09-01T10:01:00.000Z",
    observedAt: null,
    strength: "REPORTED",
  },
  {
    id: id("ev2"),
    collectorId: "dns",
    jobId: id("job A dns"),
    collectedAt: "2026-09-01T10:02:00.000Z",
    observedAt: "2026-08-30T00:00:00.000Z",
    strength: "OBSERVED",
  },
  {
    id: id("ev4"),
    collectorId: "gh",
    jobId: id("job B gh"),
    collectedAt: "2026-09-05T09:01:00.000Z",
    observedAt: "2026-01-02T03:04:05.006Z",
    strength: "REPORTED",
  },
  {
    id: id("ev5"),
    collectorId: "dns",
    jobId: null,
    collectedAt: null,
    observedAt: "2026-07-01T00:00:00.000Z",
    strength: "DERIVED",
  },
  {
    id: id("ev6"),
    collectorId: "gone",
    jobId: null,
    collectedAt: "2026-06-01T00:00:00.000Z",
    observedAt: null,
    strength: "REPORTED",
  },
];

const claim = (
  name: string,
  evidence: string,
  about: { readonly entity?: string; readonly relationship?: string },
  strength: CaseClaim["strength"],
): CaseClaim => ({
  id: id(name),
  evidenceId: id(evidence),
  entityId: about.entity === undefined ? null : id(about.entity),
  relationshipId: about.relationship === undefined ? null : id(about.relationship),
  strength,
});

export const CLAIMS: readonly CaseClaim[] = [
  claim("c1", "ev1", { entity: "e1" }, "REPORTED"),
  claim("c2", "ev2", { entity: "e1" }, "DERIVED"),
  claim("c3", "ev4", { entity: "e1" }, "HYPOTHESIS"),
  claim("c4", "ev4", { relationship: "r1" }, "CORRELATED"),
  claim("c5", "ev5", { entity: "e2" }, "INFERRED"),
  claim("c6", "ev6", { entity: "e3" }, "OBSERVED"),
];

export const CASE: CaseInput = {
  caseId: id("case"),
  evidence: EVIDENCE,
  claims: CLAIMS,
  entities: ["e1", "e2", "e3", "e4"].map((name) => ({ id: id(name) })),
  relationships: ["r1", "r2"].map((name) => ({ id: id(name) })),
  jobs: JOBS,
  runs: RUNS,
  registry: REGISTRY,
  held: HELD,
};

export const EMPTY: CaseInput = {
  caseId: id("empty case"),
  evidence: [],
  claims: [],
  entities: [],
  relationships: [],
  jobs: [],
  runs: [],
  registry: REGISTRY,
  held: HELD,
};

/** A fixed shuffle (a linear congruential generator), so a failure reproduces. */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const j = state % (i + 1);
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** The case with every list in a different order, the lists inside records too. */
export function shuffledCase(input: CaseInput, seed: number): CaseInput {
  return {
    caseId: input.caseId,
    evidence: shuffled(input.evidence, seed),
    claims: shuffled(input.claims, seed + 1),
    entities: shuffled(input.entities, seed + 2),
    relationships: shuffled(input.relationships, seed + 3),
    jobs: shuffled(input.jobs, seed + 4).map((job, index) => ({
      ...job,
      evidenceIds: job.evidenceIds === null ? null : shuffled(job.evidenceIds, seed + index),
    })),
    runs: shuffled(input.runs, seed + 5).map((run, index) => ({
      ...run,
      plan:
        run.plan.kind === "PLANNED"
          ? {
              ...run.plan,
              targetTypes: shuffled(run.plan.targetTypes, seed + index),
              excluded: shuffled(run.plan.excluded, seed + index + 1),
            }
          : run.plan,
    })),
    registry: shuffled(input.registry, seed + 6),
    held: shuffled(input.held, seed + 7).map((entry, index) => ({
      ...entry,
      targetTypes: shuffled(entry.targetTypes, seed + index),
    })),
  };
}
