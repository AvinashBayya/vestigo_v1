/**
 * RELEASE-BLOCKING. The case analysis job (R1-b), against the database:
 *   - an attempt records one finish: COMPLETE with the documents, or FAILED
 *     with a coded reason and no document; a replayed or concurrent delivery
 *     writes nothing a second time;
 *   - each of the seven input refusals R1-a added refuses the whole analysis,
 *     with no document (never a partial one);
 *   - the person gate is re-checked when the job runs (D-28): an entitlement
 *     withdrawn after the request fails the attempt with the gate's code before
 *     anything is read, a case resting only on a person job that found nothing
 *     (D-19) included;
 *   - records that changed after the request fail it as CASE_INPUT_CHANGED, a
 *     case past the size bound as CASE_TOO_LARGE, a hung read as
 *     CASE_ANALYSIS_TIMEOUT;
 *   - a case with nothing pinned completes honestly as EMPTY_CASE.
 */
import { randomUUID } from "node:crypto";
import { CONTRADICTION_CAVEAT, ENGINE_VERSION } from "@repo/case-engine";
import { CASE_WORDING, type TenantId } from "@repo/core";
import { contentRef, createDatabase, hashContent, type Database } from "@repo/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CaseAnalysisDocumentSchema,
  CaseAnalysisNotFoundError,
  CaseAnalysisProcessor,
  caseInputHash,
  readCaseAnalysisInput,
  type CaseAnalysisCollectors,
  type CaseAnalysisInput,
  type CaseAnalysisProcessorOptions,
} from "../src/index.ts";
import {
  createCaseFixture,
  FIXTURE_COLLECTORS,
  PERSON_COLLECTOR,
  provisionTenant,
  TECH_COLLECTOR,
  type CaseFixture,
} from "./case-fixture.ts";
import { TEST_ENGINE } from "./config.ts";

let db: Database;
let owner: pg.Client;

const AT = new Date(Date.parse("2026-10-09T10:00:00.000Z"));

beforeAll(async () => {
  db = createDatabase({
    connectionString: TEST_ENGINE.databaseUrl,
    onConnectionError: () => undefined,
  });
  owner = new pg.Client({ connectionString: TEST_ENGINE.databaseOwnerUrl });
  await owner.connect();
});

afterAll(async () => {
  await owner.end();
  await db.close();
});

/** Changes a tenant's plan or vetting as an operator would: the application role cannot. */
async function setEntitlement(
  tenantId: TenantId,
  plan: string,
  vettingStatus: string,
): Promise<void> {
  await owner.query("begin");
  try {
    await owner.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await owner.query("update public.tenants set plan = $1, vetting_status = $2", [
      plan,
      vettingStatus,
    ]);
    await owner.query("commit");
  } catch (error) {
    await owner.query("rollback");
    throw error;
  }
}

type ReadInput = NonNullable<CaseAnalysisProcessorOptions["readInput"]>;

/** The stored read, changed as `change` says: records that contradict themselves. */
const changedRead =
  (change: (read: CaseAnalysisInput) => CaseAnalysisInput): ReadInput =>
  async (reads, caseId, collectors) =>
    change(await readCaseAnalysisInput(reads, caseId, collectors));

/**
 * Records a request for the case's analysis as the API does: the input read
 * and hashed, the analysis found or created for that hash, and its attempt 1.
 */
async function request(
  tenantId: TenantId,
  caseId: string,
  options: { readInput?: ReadInput; collectors?: CaseAnalysisCollectors } = {},
): Promise<{ readonly analysisId: string; readonly inputHash: string }> {
  const readInput = options.readInput ?? readCaseAnalysisInput;
  const collectors = options.collectors ?? FIXTURE_COLLECTORS;
  return db.withTenant(
    tenantId,
    async ({ repos, reads }) => {
      const read = await readInput(reads, caseId, collectors);
      const inputHash = caseInputHash(read);
      const { analysis } = await repos.caseAnalyses.findOrCreate({
        caseId,
        inputHash,
        engineVersion: ENGINE_VERSION,
        requestedByUserId: null,
        requestedAt: AT,
        basis: {
          evidenceIds: read.input.evidence.map((e) => e.id),
          runIds: read.input.runs.map((r) => r.id),
        },
      });
      await repos.caseAnalysisEvents.request({
        analysisId: analysis.id,
        attempt: 1,
        requestedByUserId: null,
        at: AT,
      });
      return { analysisId: analysis.id, inputHash };
    },
    { snapshot: true },
  );
}

const processor = (options: Partial<CaseAnalysisProcessorOptions> = {}): CaseAnalysisProcessor =>
  new CaseAnalysisProcessor({
    db,
    collectors: FIXTURE_COLLECTORS,
    timeoutMs: 10_000,
    now: () => AT,
    ...options,
  });

const eventsOf = async (tenantId: TenantId, analysisId: string) =>
  db.withTenant(tenantId, ({ repos }) => repos.caseAnalysisEvents.listForAnalysis(analysisId));

/** The fixture's case, its tenant allowed person data (the case has a person run). */
async function entitledCase(tag: string): Promise<CaseFixture> {
  const fixture = await createCaseFixture(db, tag);
  await setEntitlement(fixture.tenantId, "TECHINT_AND_PERSON", "APPROVED");
  return fixture;
}

/** Asserts the attempt failed whole: one FAILED finish with `code`, and no document anywhere. */
async function expectFailedWhole(
  tenantId: TenantId,
  analysisId: string,
  code: string,
): Promise<string> {
  const events = await eventsOf(tenantId, analysisId);
  expect(events.map((e) => e.status)).toEqual(["PENDING", "FAILED"]);
  expect(events.every((e) => e.document === null && e.wording === null)).toBe(true);
  const failed = events[1];
  expect(failed?.errorCode).toBe(code);
  return failed?.errorMessage ?? "";
}

describe("one attempt at a case analysis (RELEASE-BLOCKING)", () => {
  it("records the documents once, for exactly the input it was requested for", async () => {
    const fixture = await entitledCase("job-complete");
    const { analysisId, inputHash } = await request(fixture.tenantId, fixture.caseId);
    const disposition = await processor().process(fixture.tenantId, analysisId, 1);
    expect(disposition).toEqual({ kind: "COMPLETED", status: "COMPLETE", errorCode: null });

    const events = await eventsOf(fixture.tenantId, analysisId);
    expect(events.map((e) => e.status)).toEqual(["PENDING", "COMPLETE"]);
    const complete = events[1];
    expect(complete?.occurredAt).toEqual(AT);
    expect(complete?.wording).toEqual(CASE_WORDING);
    expect(complete?.document).toMatchObject({
      formatVersion: 1,
      caseId: fixture.caseId,
      inputHash,
      coverage: { caseId: fixture.caseId },
      collectors: { caseId: fixture.caseId },
      breakdown: { caseId: fixture.caseId },
      // What it read, so a later read can probe it (CLAUDE.md §9).
      basis: { evidenceIds: [fixture.evidenceId], runIds: [fixture.runId] },
    });
    expect(CaseAnalysisDocumentSchema.safeParse(complete?.document).success).toBe(true);
  });

  it("generates, persists and reflects a contradiction when stored claims disagree (M4-1)", async () => {
    const fixture = await entitledCase("job-contradiction");
    // A second TECHINT evidence reports the entity's registrar differently. Both
    // claims are on the pinned entity, so both are in the case; the stored claims
    // disagree on one attribute of one entity — a reviewable contradiction.
    const secondEvidenceId = await db.withTenant(fixture.tenantId, async ({ repos }) => {
      const hash = hashContent(new TextEncoder().encode("[payload job-contradiction:tech2]"));
      // No recorded job (jobId null), so it needs no job-result bookkeeping; it
      // is in the case because the pinned entity's claim below cites it.
      const evidence = await repos.evidence.record({
        collectorId: TECH_COLLECTOR,
        collectorVersion: "1.0.0",
        jobId: null,
        sourceUrl: "https://example.com/other",
        contentHash: hash,
        payloadRef: contentRef(fixture.tenantId, hash),
        observedAt: null,
        collectedAt: AT,
        claimStrength: "REPORTED",
      });
      await repos.claims.create({
        evidenceId: evidence.id,
        subject: { entityId: fixture.entityId },
        attribute: "registrar",
        value: "[a different registrar]",
        strength: "DERIVED",
      });
      return evidence.id;
    });

    const { analysisId } = await request(fixture.tenantId, fixture.caseId);
    expect(await processor().process(fixture.tenantId, analysisId, 1)).toEqual({
      kind: "COMPLETED",
      status: "COMPLETE",
      errorCode: null,
    });
    const events = await eventsOf(fixture.tenantId, analysisId);
    const document = CaseAnalysisDocumentSchema.parse(events[1]?.document);

    // Generated and persisted: the conflicting positions, each with its own
    // evidence and strength carried through exactly, and the standing caveat.
    // Positions sort by the stable key of their value ("[a..." before "[r...").
    expect(document.contradictions).toEqual({
      items: [
        {
          entityId: fixture.entityId,
          attribute: "registrar",
          positions: [
            {
              value: "[a different registrar]",
              evidenceIds: [secondEvidenceId],
              strengths: ["DERIVED"],
            },
            { value: "[registrar]", evidenceIds: [fixture.evidenceId], strengths: ["REPORTED"] },
          ],
        },
      ],
      caveat: CONTRADICTION_CAVEAT,
    });

    // Reflected in the breakdown: TECHINT reports the contradicted entity, a
    // measured count, never CONTRADICTION_DETECTION_NOT_BUILT.
    if (document.breakdown.kind !== "CASE_BREAKDOWN") throw new Error("expected a breakdown");
    const techint = document.breakdown.sections.find((section) => section.discipline === "TECHINT");
    expect(techint?.metrics).toEqual([
      { metric: "CONTRADICTIONS", value: { count: 1, ids: [fixture.entityId] } },
    ]);
  });

  it("surfaces a contradiction between two article fetches of one URL: article claims reach analysis (M4-2)", async () => {
    const fixture = await entitledCase("job-article-conflict");
    const urlValue = "https://news.example.com/world/story-1";
    const titles = ["[Headline as first fetched]", "[Headline after the publisher edited it]"];
    await db.withTenant(fixture.tenantId, async ({ repos }) => {
      const urlEntity = await repos.entities.create({ kind: "URL", displayName: urlValue });
      // Two fetches of the one article URL recorded a different title: a genuine
      // contradiction on (URL, article_title), the kind an article's own claims make.
      for (const [index, title] of titles.entries()) {
        const hash = hashContent(new TextEncoder().encode(`[article payload ${String(index)}]`));
        const evidence = await repos.evidence.record({
          collectorId: TECH_COLLECTOR,
          collectorVersion: "1.0.0",
          jobId: null,
          sourceUrl: urlValue,
          contentHash: hash,
          payloadRef: contentRef(fixture.tenantId, hash),
          observedAt: null,
          collectedAt: AT,
          claimStrength: "REPORTED",
        });
        await repos.claims.create({
          evidenceId: evidence.id,
          subject: { entityId: urlEntity.id },
          attribute: "article_title",
          value: title,
          strength: "REPORTED",
        });
      }
      await repos.casePins.pin({
        caseId: fixture.caseId,
        target: { entityId: urlEntity.id },
        pinnedByUserId: fixture.userId,
        note: null,
      });
    });

    const { analysisId } = await request(fixture.tenantId, fixture.caseId);
    expect((await processor().process(fixture.tenantId, analysisId, 1)).status).toBe("COMPLETE");
    const events = await eventsOf(fixture.tenantId, analysisId);
    const document = CaseAnalysisDocumentSchema.parse(events[1]?.document);
    const conflict = document.contradictions?.items.find(
      (item) => item.attribute === "article_title",
    );
    expect(conflict).toBeDefined();
    // Both stated titles are kept, neither resolved; agreement would not appear.
    expect(conflict?.positions.map((position) => position.value).sort()).toEqual(
      [...titles].sort(),
    );
  });

  it("writes nothing twice when the same attempt is delivered again, or twice at once", async () => {
    const fixture = await entitledCase("job-replay");
    const first = await request(fixture.tenantId, fixture.caseId);
    await processor().process(fixture.tenantId, first.analysisId, 1);
    const replay = await processor().process(fixture.tenantId, first.analysisId, 1);
    expect(replay).toEqual({ kind: "SKIPPED", status: "COMPLETE" });
    expect(await eventsOf(fixture.tenantId, first.analysisId)).toHaveLength(2);

    // A second request for the same input is the same analysis, never a second one.
    const again = await db.withTenant(fixture.tenantId, ({ repos }) =>
      repos.caseAnalyses.findOrCreate({
        caseId: fixture.caseId,
        inputHash: first.inputHash,
        engineVersion: ENGINE_VERSION,
        requestedByUserId: null,
        requestedAt: AT,
        basis: { evidenceIds: [], runIds: [] },
      }),
    );
    expect(again).toMatchObject({ created: false, analysis: { id: first.analysisId } });
    const analyses = await db.withTenant(fixture.tenantId, ({ repos }) =>
      repos.caseAnalyses.listForCase(fixture.caseId, { limit: 10 }),
    );
    expect(analyses.map((a) => a.id)).toEqual([first.analysisId]);

    // Two deliveries at once: one records, the other records nothing.
    await db.withTenant(fixture.tenantId, ({ repos }) =>
      repos.casePins.pin({
        caseId: fixture.caseId,
        target: { relationshipId: fixture.relationshipId },
        pinnedByUserId: fixture.userId,
        note: null,
      }),
    );
    const second = await request(fixture.tenantId, fixture.caseId);
    const both = await Promise.all([
      processor().process(fixture.tenantId, second.analysisId, 1),
      processor().process(fixture.tenantId, second.analysisId, 1),
    ]);
    expect(both.map((d) => d.kind).sort()).toEqual(["COMPLETED", "SKIPPED"]);
    const events = await eventsOf(fixture.tenantId, second.analysisId);
    expect(events.map((e) => e.status)).toEqual(["PENDING", "COMPLETE"]);
  });

  it("fails an analysis or attempt that is not recorded, and fails nothing for it", async () => {
    const fixture = await entitledCase("job-missing");
    await expect(processor().process(fixture.tenantId, randomUUID(), 1)).rejects.toBeInstanceOf(
      CaseAnalysisNotFoundError,
    );
    const { analysisId } = await request(fixture.tenantId, fixture.caseId);
    await expect(processor().process(fixture.tenantId, analysisId, 2)).rejects.toBeInstanceOf(
      CaseAnalysisNotFoundError,
    );
    // The dead-letter step on an analysis that was never recorded is a no-op.
    await processor().failUnrecorded(fixture.tenantId, randomUUID(), 1, {
      code: "WORKER_ERROR",
      message: "[test]",
    });
    expect(await eventsOf(fixture.tenantId, analysisId)).toHaveLength(1);
  });

  it("fails an attempt that crashed unrecorded once, and leaves a finished one alone", async () => {
    const fixture = await entitledCase("job-unrecorded");
    const { analysisId } = await request(fixture.tenantId, fixture.caseId);
    const error = { code: "WORKER_ERROR", message: "[crashed]" };
    await processor().failUnrecorded(fixture.tenantId, analysisId, 1, error);
    await processor().failUnrecorded(fixture.tenantId, analysisId, 1, error);
    await expectFailedWhole(fixture.tenantId, analysisId, "WORKER_ERROR");
  });
});

describe("the seven input refusals, each refusing the whole analysis (RELEASE-BLOCKING)", () => {
  const replaceJob = (
    read: CaseAnalysisInput,
    jobId: string,
    change: (job: CaseAnalysisInput["input"]["jobs"][number]) => object,
  ): CaseAnalysisInput => ({
    ...read,
    input: {
      ...read.input,
      jobs: read.input.jobs.map((job) => (job.id === jobId ? { ...job, ...change(job) } : job)),
    },
  });

  const cases: readonly {
    readonly problem: string;
    readonly options: (fixture: CaseFixture) => {
      readonly readInput?: ReadInput;
      readonly collectors?: CaseAnalysisCollectors;
    };
  }[] = [
    {
      problem: "INPUT_MISSING",
      options: () => ({
        readInput: changedRead((read) => {
          const input: Record<string, unknown> = { ...read.input };
          delete input.held;
          return { ...read, input: input as unknown as CaseAnalysisInput["input"] };
        }),
      }),
    },
    {
      problem: "HELD_AND_REGISTERED",
      options: () => ({
        collectors: {
          ...FIXTURE_COLLECTORS,
          held: [
            {
              id: TECH_COLLECTOR,
              displayName: "[held fixture dns]",
              targetTypes: ["DOMAIN"],
              reason: "[held]",
              discipline: "TECHINT",
              collectionMode: "PASSIVE_API",
            },
          ],
        },
      }),
    },
    {
      problem: "FOUND_RESULT_NOT_RECORDED",
      options: (fixture) => ({
        readInput: changedRead((read) =>
          replaceJob(read, fixture.techJobId, () => ({ evidenceIds: null })),
        ),
      }),
    },
    {
      problem: "JOB_EVIDENCE_ELSEWHERE",
      options: (fixture) => ({
        readInput: changedRead((read) =>
          replaceJob(read, fixture.personJobId, () => ({ evidenceIds: [fixture.evidenceId] })),
        ),
      }),
    },
    {
      problem: "CLAIM_SUBJECT_MISSING",
      options: (fixture) => ({
        readInput: changedRead((read) => ({
          ...read,
          input: {
            ...read.input,
            entities: read.input.entities.filter((e) => e.id !== fixture.entityId),
          },
        })),
      }),
    },
    {
      problem: "JOB_AND_EXCLUSION",
      options: () => ({
        readInput: changedRead((read) => ({
          ...read,
          input: {
            ...read.input,
            runs: read.input.runs.map((run) => ({
              ...run,
              plan: {
                kind: "PLANNED",
                targetTypes: ["DOMAIN"],
                excluded: [
                  {
                    collectorId: TECH_COLLECTOR,
                    targetType: "DOMAIN",
                    reason: "[excluded]",
                    message: "[excluded]",
                  },
                ],
              },
            })),
          },
        })),
      }),
    },
  ];

  for (const { problem, options } of cases) {
    it(`${problem}: FAILED as CASE_INPUT_INVALID, the problem named, no document`, async () => {
      const fixture = await entitledCase(`job-${problem.toLowerCase()}`);
      const chosen = options(fixture);
      const { analysisId } = await request(fixture.tenantId, fixture.caseId, chosen);
      const disposition = await processor(chosen).process(fixture.tenantId, analysisId, 1);
      expect(disposition).toEqual({
        kind: "COMPLETED",
        status: "FAILED",
        errorCode: "CASE_INPUT_INVALID",
      });
      const message = await expectFailedWhole(fixture.tenantId, analysisId, "CASE_INPUT_INVALID");
      expect(message).toContain(problem);
    });
  }

  it("EVIDENCE_NOT_IN_JOB_RESULT, from stored rows: evidence its job's result does not list", async () => {
    const fixture = await entitledCase("job-evidence-not-in-result");
    // Evidence written naming the job without the job's list being set (the
    // path R1-a found in CollectionExecutor.collect and the seed data), pinned.
    await db.withTenant(fixture.tenantId, async ({ repos }) => {
      const hash = hashContent(new TextEncoder().encode("[payload unlisted]"));
      const unlisted = await repos.evidence.record({
        collectorId: TECH_COLLECTOR,
        collectorVersion: "1.0.0",
        jobId: fixture.techJobId,
        sourceUrl: null,
        contentHash: hash,
        payloadRef: contentRef(fixture.tenantId, hash),
        observedAt: null,
        collectedAt: AT,
        claimStrength: "REPORTED",
      });
      await repos.casePins.pin({
        caseId: fixture.caseId,
        target: { evidenceId: unlisted.id },
        pinnedByUserId: fixture.userId,
        note: null,
      });
    });
    const { analysisId } = await request(fixture.tenantId, fixture.caseId);
    await processor().process(fixture.tenantId, analysisId, 1);
    const message = await expectFailedWhole(fixture.tenantId, analysisId, "CASE_INPUT_INVALID");
    expect(message).toContain("EVIDENCE_NOT_IN_JOB_RESULT");
  });
});

describe("the person gate, re-checked when the job runs (D-28, RELEASE-BLOCKING)", () => {
  for (const [plan, vetting, code] of [
    ["TECHINT_AND_PERSON", "SUSPENDED", "VETTING_NOT_APPROVED"],
    ["TECHINT", "APPROVED", "MODULE_NOT_IN_PLAN"],
  ] as const) {
    it(`withdrawn after the request (${code}): fails with the gate's code, reads nothing`, async () => {
      const fixture = await entitledCase(`job-gate-${code.toLowerCase()}`);
      const { analysisId } = await request(fixture.tenantId, fixture.caseId);
      await setEntitlement(fixture.tenantId, plan, vetting);
      let reads = 0;
      const counted: ReadInput = (r, caseId, collectors) => {
        reads += 1;
        return readCaseAnalysisInput(r, caseId, collectors);
      };
      const disposition = await processor({ readInput: counted }).process(
        fixture.tenantId,
        analysisId,
        1,
      );
      expect(disposition).toEqual({ kind: "COMPLETED", status: "FAILED", errorCode: code });
      expect(reads).toBe(0);
      const message = await expectFailedWhole(fixture.tenantId, analysisId, code);
      // The refusal names no record and no count.
      expect(message).not.toContain(fixture.caseId);
      expect(message).not.toMatch(/\d/);
    });
  }

  it("counts a run whose person collector found nothing as person data (D-19)", async () => {
    // The fixture's only person record is a PERSON job that found nothing: no
    // evidence, no claim, no entity of its own.
    const fixture = await entitledCase("job-gate-not-found");
    const { analysisId } = await request(fixture.tenantId, fixture.caseId);
    await setEntitlement(fixture.tenantId, "TECHINT", "APPROVED");
    await processor().process(fixture.tenantId, analysisId, 1);
    await expectFailedWhole(fixture.tenantId, analysisId, "MODULE_NOT_IN_PLAN");
    const personJob = await db.withTenant(fixture.tenantId, ({ repos }) =>
      repos.jobs.findById(fixture.personJobId),
    );
    expect(personJob).toMatchObject({ collectorId: PERSON_COLLECTOR, outcome: "NOT_FOUND" });
  });
});

describe("what fails an attempt besides its input (RELEASE-BLOCKING)", () => {
  it("records that changed after the request: CASE_INPUT_CHANGED, no document", async () => {
    const fixture = await entitledCase("job-changed");
    const { analysisId } = await request(fixture.tenantId, fixture.caseId);
    await db.withTenant(fixture.tenantId, ({ repos }) =>
      repos.claims.create({
        evidenceId: fixture.evidenceId,
        subject: { entityId: fixture.entityId },
        attribute: "registrant",
        value: "[late claim]",
        strength: "REPORTED",
      }),
    );
    await processor().process(fixture.tenantId, analysisId, 1);
    const message = await expectFailedWhole(fixture.tenantId, analysisId, "CASE_INPUT_CHANGED");
    // It says what was compared, never a cause it did not measure.
    expect(message).toContain(
      "the case's records, the analysis code, its wording or the collector registry",
    );
  });

  it("a case past the size bound: CASE_TOO_LARGE, no document, and nothing read", async () => {
    const fixture = await entitledCase("job-too-large");
    const { analysisId } = await request(fixture.tenantId, fixture.caseId);
    let reads = 0;
    const counted: ReadInput = (r, caseId, collectors) => {
      reads += 1;
      return readCaseAnalysisInput(r, caseId, collectors);
    };
    await processor({ maxRecords: 1, readInput: counted }).process(fixture.tenantId, analysisId, 1);
    const message = await expectFailedWhole(fixture.tenantId, analysisId, "CASE_TOO_LARGE");
    expect(message).toContain("at most 1.");
    // Counted in the database: the case was never loaded.
    expect(reads).toBe(0);
  });

  it("a read that hangs: CASE_ANALYSIS_TIMEOUT, and nothing written when it ends later", async () => {
    const fixture = await entitledCase("job-timeout");
    const { analysisId } = await request(fixture.tenantId, fixture.caseId);
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = { finished: false };
    const hung: ReadInput = async (reads, caseId, collectors) => {
      await released;
      const read = await readCaseAnalysisInput(reads, caseId, collectors);
      state.finished = true;
      return read;
    };
    try {
      const disposition = await processor({ readInput: hung, timeoutMs: 200 }).process(
        fixture.tenantId,
        analysisId,
        1,
      );
      expect(disposition).toEqual({
        kind: "COMPLETED",
        status: "FAILED",
        errorCode: "CASE_ANALYSIS_TIMEOUT",
      });
    } finally {
      release();
    }
    // The abandoned read runs to its end and is discarded: no second finish.
    const deadline = Date.now() + 5_000;
    while (!state.finished && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    expect(state.finished).toBe(true);
    await expectFailedWhole(fixture.tenantId, analysisId, "CASE_ANALYSIS_TIMEOUT");
  });

  it("a case with nothing pinned completes honestly as EMPTY_CASE", async () => {
    // Default entitlement: an empty case rests on no person data.
    const { tenantId, userId } = await provisionTenant(db, "job-empty");
    const caseId = await db.withTenant(tenantId, async ({ repos }) => {
      const created = await repos.cases.create({
        title: "[Empty case]",
        description: null,
        createdByUserId: userId,
      });
      return created.id;
    });
    const { analysisId } = await request(tenantId, caseId);
    await processor().process(tenantId, analysisId, 1);
    const events = await eventsOf(tenantId, analysisId);
    expect(events.map((e) => e.status)).toEqual(["PENDING", "COMPLETE"]);
    expect(events[1]?.document).toMatchObject({
      coverage: { kind: "EMPTY_CASE" },
      collectors: { kind: "EMPTY_CASE" },
      breakdown: { kind: "EMPTY_CASE" },
    });
  });
});
