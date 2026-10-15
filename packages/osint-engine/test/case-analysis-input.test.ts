/**
 * RELEASE-BLOCKING. A case analysis's input, read from what is stored, and its
 * hash (owner ruling D-3): canonical whatever the order of the data, changed by
 * any one element of what the analysis reads, null kept apart from absent; and,
 * against the database, changed by an unpin, by a new claim on a pinned entity
 * and by an undone merge, and unchanged by a second read of the same state.
 */
import { caseCoverage, type CaseInput } from "@repo/case-engine";
import { CASE_WORDING, ENTITY_KINDS } from "@repo/core";
import { createDatabase, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canonicalJson,
  CanonicalFormError,
  caseInputHash,
  CURRENT_HASH_BASIS,
  readCaseAnalysisInput,
  type CaseAnalysisInput,
} from "../src/index.ts";
import { createCaseFixture, FIXTURE_COLLECTORS, type CaseFixture } from "./case-fixture.ts";
import { TEST_ENGINE } from "./config.ts";

// ── The canonical form, without a database ─────────────────────────────────

describe("canonical form (RELEASE-BLOCKING)", () => {
  it("does not depend on key order or list order", () => {
    expect(canonicalJson({ b: [3, 1, 2], a: { y: "y", x: "x" } })).toBe(
      canonicalJson({ a: { x: "x", y: "y" }, b: [2, 3, 1] }),
    );
  });

  it("keeps null distinct from absent, and from an empty string or zero", () => {
    const forms = [{ a: null }, {}, { a: "" }, { a: 0 }, { a: [] }].map(canonicalJson);
    expect(new Set(forms).size).toBe(forms.length);
    // An undefined value is absent, exactly as an omitted key is.
    expect(canonicalJson({ a: undefined })).toBe(canonicalJson({}));
  });

  it("refuses what has no canonical form, rather than serialising it as something else", () => {
    for (const value of [
      new Date(0),
      Number.NaN,
      Number.POSITIVE_INFINITY,
      [undefined],
      10n,
      () => 1,
      new Map(),
      undefined,
    ]) {
      expect(() => canonicalJson(value)).toThrow(CanonicalFormError);
    }
  });
});

// ── The hash over a case's input, without a database ───────────────────────

const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const BASE: CaseAnalysisInput = {
  input: {
    caseId: ID(1),
    evidence: [
      {
        id: ID(10),
        collectorId: "fixture-dns",
        jobId: ID(30),
        collectedAt: "2026-10-09T09:00:00.000Z",
        observedAt: null,
        strength: "REPORTED",
      },
      {
        id: ID(11),
        collectorId: "fixture-dns",
        jobId: null,
        collectedAt: null,
        observedAt: "2026-01-01T00:00:00.000Z",
        strength: "DERIVED",
      },
    ],
    claims: [
      {
        id: ID(20),
        evidenceId: ID(10),
        entityId: ID(40),
        relationshipId: null,
        strength: "REPORTED",
      },
      {
        id: ID(21),
        evidenceId: ID(11),
        entityId: ID(41),
        relationshipId: null,
        strength: "DERIVED",
      },
    ],
    entities: [{ id: ID(40) }, { id: ID(41) }],
    relationships: [],
    jobs: [
      {
        id: ID(30),
        runId: ID(50),
        collectorId: "fixture-dns",
        status: "SUCCEEDED",
        outcome: "FOUND",
        outcomeDetail: null,
        targetType: "DOMAIN",
        attempts: 1,
        evidenceIds: [ID(10)],
        lastErrorCode: null,
        lastErrorMessage: null,
      },
      {
        id: ID(31),
        runId: ID(50),
        collectorId: "fixture-person",
        status: "SUCCEEDED",
        outcome: "NOT_FOUND",
        outcomeDetail: "[nothing found]",
        targetType: "DOMAIN",
        attempts: 1,
        evidenceIds: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    ],
    runs: [
      {
        id: ID(50),
        investigationId: ID(60),
        investigationTitle: "[Investigation]",
        status: "SUCCEEDED",
        plan: {
          kind: "PLANNED",
          targetTypes: ["DOMAIN", "USERNAME"],
          excluded: [
            {
              collectorId: "a",
              targetType: null,
              reason: "TARGET_TYPE_NOT_ACCEPTED",
              message: "[a]",
            },
            { collectorId: "b", targetType: "DOMAIN", reason: "LICENCE_BLOCKED", message: "[b]" },
          ],
        },
        startedAt: "2026-10-09T08:59:00.000Z",
        finishedAt: "2026-10-09T09:01:00.000Z",
      },
    ],
    registry: FIXTURE_COLLECTORS.registry,
    held: [
      {
        id: "held",
        displayName: "[held]",
        targetTypes: ["DOMAIN", "USERNAME"],
        reason: "[held reason]",
        discipline: "MEDIAINT",
        collectionMode: "PASSIVE_API",
      },
    ],
  },
  activeMergeIds: [ID(70), ID(71)],
};

const reversed = <T>(list: readonly T[]): T[] => [...list].reverse();

/** The same input with every list, the lists inside records included, in another order. */
function reorder(read: CaseAnalysisInput): CaseAnalysisInput {
  const input = read.input;
  return {
    activeMergeIds: reversed(read.activeMergeIds),
    input: {
      ...input,
      evidence: reversed(input.evidence),
      claims: reversed(input.claims),
      entities: reversed(input.entities),
      relationships: reversed(input.relationships),
      jobs: reversed(input.jobs).map((job) => ({
        ...job,
        evidenceIds: job.evidenceIds === null ? null : reversed(job.evidenceIds),
      })),
      runs: reversed(input.runs).map((run) => ({
        ...run,
        plan:
          run.plan.kind === "PLANNED"
            ? {
                ...run.plan,
                targetTypes: reversed(run.plan.targetTypes),
                excluded: reversed(run.plan.excluded),
              }
            : run.plan,
      })),
      registry: reversed(input.registry),
      held: reversed(input.held).map((held) => ({
        ...held,
        targetTypes: reversed(held.targetTypes),
      })),
    },
  };
}

const withInput = (change: (input: CaseInput) => CaseInput): CaseAnalysisInput => ({
  ...BASE,
  input: change(BASE.input),
});
const first = <T>(list: readonly T[]): T => {
  const [item] = list;
  if (item === undefined) return expect.fail("[test] an empty list");
  return item;
};
const replaceFirst = <T>(list: readonly T[], change: (item: T) => T): T[] => [
  change(first(list)),
  ...list.slice(1),
];

describe("the case input hash (RELEASE-BLOCKING)", () => {
  const hash = caseInputHash(BASE);

  it("is sha256 hex, and the same for the same input in any order", () => {
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(caseInputHash(reorder(BASE))).toBe(hash);
    expect(caseInputHash(structuredClone(BASE))).toBe(hash);
  });

  it("changes when any one element of what the analysis reads changes", () => {
    const changes: Record<string, CaseAnalysisInput> = {
      "an evidence id": withInput((i) => ({
        ...i,
        evidence: replaceFirst(i.evidence, (e) => ({ ...e, id: ID(12) })),
      })),
      "an evidence item added": withInput((i) => ({
        ...i,
        evidence: [...i.evidence, { ...first(i.evidence), id: ID(13) }],
      })),
      "an evidence item's job": withInput((i) => ({
        ...i,
        evidence: replaceFirst(i.evidence, (e) => ({ ...e, jobId: null })),
      })),
      "an evidence item's collection time": withInput((i) => ({
        ...i,
        evidence: replaceFirst(i.evidence, (e) => ({
          ...e,
          collectedAt: "2026-10-09T09:00:00.001Z",
        })),
      })),
      "an evidence item's strength": withInput((i) => ({
        ...i,
        evidence: replaceFirst(i.evidence, (e) => ({ ...e, strength: "OBSERVED" })),
      })),
      "a claim id": withInput((i) => ({
        ...i,
        claims: replaceFirst(i.claims, (c) => ({ ...c, id: ID(22) })),
      })),
      "a claim removed": withInput((i) => ({ ...i, claims: i.claims.slice(1) })),
      "a claim's strength": withInput((i) => ({
        ...i,
        claims: replaceFirst(i.claims, (c) => ({ ...c, strength: "HYPOTHESIS" })),
      })),
      "a claim's subject": withInput((i) => ({
        ...i,
        claims: replaceFirst(i.claims, (c) => ({ ...c, entityId: ID(41) })),
      })),
      "an entity": withInput((i) => ({ ...i, entities: [...i.entities, { id: ID(42) }] })),
      "a relationship": withInput((i) => ({ ...i, relationships: [{ id: ID(43) }] })),
      "a job's status": withInput((i) => ({
        ...i,
        jobs: replaceFirst(i.jobs, (j) => ({ ...j, status: "FAILED" })),
      })),
      "a job's outcome": withInput((i) => ({
        ...i,
        jobs: replaceFirst(i.jobs, (j) => ({ ...j, outcome: "NOT_FOUND" })),
      })),
      "a job's attempts": withInput((i) => ({
        ...i,
        jobs: replaceFirst(i.jobs, (j) => ({ ...j, attempts: 2 })),
      })),
      "a job's recorded evidence": withInput((i) => ({
        ...i,
        jobs: replaceFirst(i.jobs, (j) => ({ ...j, evidenceIds: [] })),
      })),
      "a job's error": withInput((i) => ({
        ...i,
        jobs: replaceFirst(i.jobs, (j) => ({ ...j, lastErrorCode: "X" })),
      })),
      "a run's status": withInput((i) => ({
        ...i,
        runs: replaceFirst(i.runs, (r) => ({ ...r, status: "PARTIAL" })),
      })),
      "a run's plan": withInput((i) => ({
        ...i,
        runs: replaceFirst(i.runs, (r) => ({ ...r, plan: { kind: "NOT_RECORDED" } })),
      })),
      "a run's investigation title": withInput((i) => ({
        ...i,
        runs: replaceFirst(i.runs, (r) => ({ ...r, investigationTitle: "[Renamed]" })),
      })),
      "a registry label": withInput((i) => ({
        ...i,
        registry: replaceFirst(i.registry, (e) => ({ ...e, label: "[relabelled]" })),
      })),
      "a registry discipline": withInput((i) => ({
        ...i,
        registry: replaceFirst(i.registry, (e) => ({ ...e, discipline: "SOCMINT" })),
      })),
      // A source's licence verdict turning BLOCKED, or a collector losing its
      // implementation, changes what the analysis says (owner ruling, 2026-10-13).
      "a registry entry's licence turning BLOCKED": withInput((i) => ({
        ...i,
        registry: replaceFirst(i.registry, (e) => ({ ...e, cannotRun: "BLOCKED" })),
      })),
      "a registry entry losing its implementation": withInput((i) => ({
        ...i,
        registry: replaceFirst(i.registry, (e) => ({ ...e, cannotRun: "NOT_IMPLEMENTED" })),
      })),
      "a held collector": withInput((i) => ({ ...i, held: [] })),
      "a held collector's reason": withInput((i) => ({
        ...i,
        held: replaceFirst(i.held, (h) => ({ ...h, reason: "[other reason]" })),
      })),
      "the case": withInput((i) => ({ ...i, caseId: ID(2) })),
      "an active merge": { ...BASE, activeMergeIds: BASE.activeMergeIds.slice(1) },
    };
    const seen = new Map<string, string>([[hash, "the base input"]]);
    for (const [name, changed] of Object.entries(changes)) {
      const changedHash = caseInputHash(changed);
      expect(seen.get(changedHash), `${name} changed nothing`).toBeUndefined();
      seen.set(changedHash, name);
    }
  });

  it("keeps null apart from absent inside the input", () => {
    const absent = withInput((i) => ({
      ...i,
      // The same job with lastErrorCode absent instead of null.
      jobs: replaceFirst(
        i.jobs,
        (j) => ({ ...j, lastErrorCode: undefined }) as unknown as typeof j,
      ),
    }));
    expect(caseInputHash(absent)).not.toBe(hash);
  });

  it("changes with the engine version and with the wording", () => {
    expect(caseInputHash(BASE, { ...CURRENT_HASH_BASIS, engineVersion: 999 })).not.toBe(hash);
    expect(
      caseInputHash(BASE, {
        ...CURRENT_HASH_BASIS,
        wording: { ...CASE_WORDING, coverageCaveats: { NO_NEW_COLLECTION: "[changed]" } },
      }),
    ).not.toBe(hash);
  });
});

// ── Against the database ───────────────────────────────────────────────────

let db: Database;
let fixture: CaseFixture;

beforeAll(async () => {
  db = createDatabase({
    connectionString: TEST_ENGINE.databaseUrl,
    onConnectionError: () => undefined,
  });
  fixture = await createCaseFixture(db, "case-input");
});

afterAll(async () => {
  await db.close();
});

const readNow = (f: CaseFixture = fixture): Promise<CaseAnalysisInput> =>
  db.withTenant(f.tenantId, ({ reads }) =>
    readCaseAnalysisInput(reads, f.caseId, FIXTURE_COLLECTORS),
  );

describe("the input read from a case's pins (RELEASE-BLOCKING)", () => {
  it("brings in what the pins stand on, which case-engine accepts whole", async () => {
    const read = await readNow();
    const ids = (list: readonly { readonly id: string }[]) => list.map((item) => item.id).sort();
    expect(ids(read.input.evidence)).toEqual([fixture.evidenceId]);
    // Every claim about the pinned entity. The relationship's claim cites the same
    // evidence, but that evidence is not pinned, so the claim is not in the case.
    expect(ids(read.input.claims)).toEqual([fixture.claimId]);
    expect(ids(read.input.entities)).toEqual([fixture.entityId]);
    expect(ids(read.input.relationships)).toEqual([]);
    // The run, and every job of it: the PERSON job that found nothing included.
    expect(ids(read.input.runs)).toEqual([fixture.runId]);
    expect(ids(read.input.jobs)).toEqual([fixture.techJobId, fixture.personJobId].sort());
    expect(caseCoverage(read.input).kind).toBe("CASE_COVERAGE");
    expect(ENTITY_KINDS).toContain("DOMAIN");
  });

  it("pinning evidence brings every claim citing it, and every claim's subject", async () => {
    const f = await createCaseFixture(db, "case-input-evidence-pin");
    await db.withTenant(f.tenantId, ({ repos }) =>
      repos.casePins.pin({
        caseId: f.caseId,
        target: { evidenceId: f.evidenceId },
        pinnedByUserId: f.userId,
        note: null,
      }),
    );
    const read = await readNow(f);
    const ids = (list: readonly { readonly id: string }[]) => list.map((item) => item.id).sort();
    expect(ids(read.input.claims)).toEqual([f.claimId, f.relationshipClaimId].sort());
    // The relationship and both its ends, so CLAIM_SUBJECT_MISSING cannot fire.
    expect(ids(read.input.relationships)).toEqual([f.relationshipId]);
    expect(ids(read.input.entities)).toEqual([f.entityId, f.otherEntityId].sort());
    expect(caseCoverage(read.input).kind).toBe("CASE_COVERAGE");
  });

  it("hashes the same state the same way twice", async () => {
    expect(caseInputHash(await readNow())).toBe(caseInputHash(await readNow()));
  });

  it("reads and hashes a case id spelled in capitals as the stored id", async () => {
    const upper = await db.withTenant(fixture.tenantId, ({ reads }) =>
      readCaseAnalysisInput(reads, fixture.caseId.toUpperCase(), FIXTURE_COLLECTORS),
    );
    expect(upper.input.caseId).toBe(fixture.caseId);
    expect(caseInputHash(upper)).toBe(caseInputHash(await readNow()));
  });

  it("changes with an unpin, and with a new claim on a pinned entity", async () => {
    const f = await createCaseFixture(db, "case-input-changes");
    const before = caseInputHash(await readNow(f));
    // A later run's fusion adds a claim on the pinned entity.
    await db.withTenant(f.tenantId, ({ repos }) =>
      repos.claims.create({
        evidenceId: f.evidenceId,
        subject: { entityId: f.entityId },
        attribute: "registrant_country",
        value: "[country]",
        strength: "REPORTED",
      }),
    );
    const afterClaim = caseInputHash(await readNow(f));
    expect(afterClaim).not.toBe(before);
    await db.withTenant(f.tenantId, ({ repos }) => repos.casePins.unpin(f.entityPinId));
    const afterUnpin = caseInputHash(await readNow(f));
    expect(afterUnpin).not.toBe(afterClaim);
    expect((await readNow(f)).input.evidence).toEqual([]);
  });

  it("changes with a merge, and again when the merge is undone", async () => {
    const f = await createCaseFixture(db, "case-input-merge");
    const before = caseInputHash(await readNow(f));
    const merge = await db.withTenant(f.tenantId, ({ repos }) =>
      repos.entityMerges.merge({
        survivingEntityId: f.entityId,
        mergedEntityId: f.otherEntityId,
        reason: "[analyst reason]",
        confidence: 1,
        matchSignals: ["ANALYST_REVIEW"],
        decidedBy: { kind: "USER", userId: f.userId },
      }),
    );
    const merged = await readNow(f);
    expect(merged.activeMergeIds).toEqual([merge.id]);
    expect(caseInputHash(merged)).not.toBe(before);
    await db.withTenant(f.tenantId, ({ repos }) =>
      repos.entityMerges.undo(merge.id, {
        decidedBy: { kind: "USER", userId: f.userId },
        reason: "[analyst undo]",
      }),
    );
    const undone = await readNow(f);
    expect(undone.activeMergeIds).toEqual([]);
    expect(caseInputHash(undone)).not.toBe(caseInputHash(merged));
  });

  it("reads an empty case as empty, which case-engine answers with EMPTY_CASE", async () => {
    const f = await createCaseFixture(db, "case-input-empty");
    await db.withTenant(f.tenantId, ({ repos }) => repos.casePins.unpin(f.entityPinId));
    const read = await readNow(f);
    expect(read.input).toMatchObject({
      evidence: [],
      claims: [],
      entities: [],
      relationships: [],
      jobs: [],
      runs: [],
    });
    expect(caseCoverage(read.input).kind).toBe("EMPTY_CASE");
  });
});
