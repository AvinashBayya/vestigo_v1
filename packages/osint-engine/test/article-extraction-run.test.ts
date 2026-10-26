/**
 * runArticleExtraction against the real database (M4-4): a FOUND article job's
 * retained body text, extracted through a scripted model, is persisted as ONE
 * grounded, DERIVED `article_statements` claim on the article's URL entity,
 * citing the article evidence. It pins: the claim's shape and classification;
 * idempotency (a second delivery writes nothing and makes no model call); the
 * fail-closed paths (no LLM configured, a rejected answer) leaving the evidence
 * untouched; and tenant isolation.
 */
import { randomUUID } from "node:crypto";
import { parseTenantId, type TenantId } from "@repo/core";
import { contentRef, createDatabase, hashContent, type Database } from "@repo/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ARTICLE_STATEMENTS_ATTRIBUTE, runArticleExtraction } from "../src/index.ts";
import { TEST_ENGINE } from "./config.ts";
import { clientWith, extractionAnswer, ScriptedProvider } from "./llm-fake.ts";

let db: Database;

const AT = new Date(Date.parse("2026-10-23T09:00:00.000Z"));
const URL_VALUE = "https://news.example.com/world/story-9";
const BODY_TEXT = "Northwind Trading opened a branch in Harbour City in 2019.";

const ARTICLE_RESULT_VALUE = {
  headline: "Northwind opens a branch",
  derived: {
    url: URL_VALUE,
    outletDomain: "news.example.com",
    dedupKey: URL_VALUE,
    canonicalUrl: null,
    title: "Northwind opens a branch",
    author: null,
    language: "en",
    publishedAt: null,
    extractionStatus: "FULL_TEXT",
    bodyText: BODY_TEXT,
    bodyTextTruncated: false,
    mentions: [],
  },
};

const GROUNDED_ANSWER = extractionAnswer([
  {
    subjectType: "ORGANIZATION",
    subject: "Northwind Trading",
    attribute: "opened_branch_in",
    value: "Harbour City",
    quote: BODY_TEXT,
  },
]);

beforeAll(() => {
  db = createDatabase({
    connectionString: TEST_ENGINE.databaseUrl,
    onConnectionError: () => undefined,
  });
});
afterAll(async () => {
  await db.close();
});

/** A provisioned tenant with a FOUND article job, its evidence, and the stored result. */
async function articleCase(tag: string): Promise<{
  readonly tenantId: TenantId;
  readonly jobId: string;
  readonly evidenceId: string;
}> {
  const tenantId = parseTenantId(randomUUID());
  await db.provisionTenant({ tenantId, name: `[Tenant ${tag}]`, region: "IN" });
  return db.withTenant(tenantId, async ({ repos }) => {
    const user = await repos.users.create({
      email: `a-${tag}@example.com`,
      displayName: null,
      status: "ACTIVE",
    });
    await repos.collectorsRegistry.register({
      collectorId: "article",
      sourceLabel: "Direct article fetch",
      discipline: "MEDIAINT",
      collectionMode: "ACTIVE",
      dataLicence: "[not applicable: test fixture]",
      commercialUse: "UNVERIFIED",
      enabled: true,
      disabledReason: null,
    });
    const investigation = await repos.investigations.create({
      title: `[Investigation ${tag}]`,
      target: URL_VALUE,
      createdByUserId: user.id,
    });
    const run = await repos.runs.create({
      investigationId: investigation.id,
      status: "RUNNING",
      requestedByUserId: user.id,
    });
    const job = await repos.jobs.create({
      runId: run.id,
      collectorId: "article",
      idempotencyKey: `${tag}:article`,
      status: "QUEUED",
      targetType: "URL",
      target: URL_VALUE,
    });
    const hash = hashContent(new TextEncoder().encode(`[article bytes ${tag}]`));
    const evidence = await repos.evidence.record({
      collectorId: "article",
      collectorVersion: "1.0.0",
      jobId: job.id,
      sourceUrl: URL_VALUE,
      contentHash: hash,
      payloadRef: contentRef(tenantId, hash),
      observedAt: null,
      collectedAt: AT,
      claimStrength: "REPORTED",
    });
    await repos.jobs.transition(job.id, {
      status: "SUCCEEDED",
      attempts: 1,
      outcome: "FOUND",
      result: ARTICLE_RESULT_VALUE,
      evidenceIds: [evidence.id],
      finishedAt: AT,
    });
    return { tenantId, jobId: job.id, evidenceId: evidence.id };
  });
}

const statementClaims = (tenantId: TenantId, evidenceId: string) =>
  db.withTenant(tenantId, ({ repos }) =>
    repos.claims.listForEvidence([evidenceId], { limit: 100 }),
  );

describe("runArticleExtraction against the database", () => {
  it("persists one grounded, DERIVED article_statements claim on the article's URL entity", async () => {
    const { tenantId, jobId, evidenceId } = await articleCase("extract-ok");
    const provider = new ScriptedProvider([GROUNDED_ANSWER]);
    const disposition = await runArticleExtraction(
      { db, llm: clientWith(provider) },
      tenantId,
      jobId,
    );
    expect(disposition).toMatchObject({ kind: "EXTRACTED", claimWritten: true, statementCount: 1 });

    const claims = await statementClaims(tenantId, evidenceId);
    const statementClaim = claims.find((c) => c.attribute === ARTICLE_STATEMENTS_ATTRIBUTE);
    expect(statementClaim).toBeDefined();
    // The model output is a DERIVED extraction of the article evidence, never evidence itself.
    expect(statementClaim?.strength).toBe("DERIVED");
    expect(statementClaim?.evidenceId).toBe(evidenceId);
    // An entity claim (so it is contradiction-review input), on the article URL entity.
    expect(statementClaim?.entityId).not.toBeNull();
    expect(statementClaim?.relationshipId).toBeNull();
    const value = statementClaim?.value as {
      subject: string;
      quote: string;
      start: number;
      end: number;
    }[];
    expect(value).toHaveLength(1);
    expect(value[0]?.subject).toBe("Northwind Trading");
    // The span resolves back to the quote in the stored body text: grounded, not invented.
    expect(BODY_TEXT.slice(value[0]?.start, value[0]?.end)).toBe(value[0]?.quote);

    const entity = await db.withTenant(tenantId, ({ repos }) =>
      repos.entities.findById(statementClaim?.entityId ?? ""),
    );
    expect(entity?.kind).toBe("URL");
  });

  it("is idempotent: a second delivery writes nothing and makes no model call", async () => {
    const { tenantId, jobId, evidenceId } = await articleCase("extract-idem");
    await runArticleExtraction(
      { db, llm: clientWith(new ScriptedProvider([GROUNDED_ANSWER])) },
      tenantId,
      jobId,
    );
    const before = await statementClaims(tenantId, evidenceId);

    const provider = new ScriptedProvider([GROUNDED_ANSWER]);
    const again = await runArticleExtraction({ db, llm: clientWith(provider) }, tenantId, jobId);
    expect(again).toMatchObject({ kind: "SKIPPED" });
    // No second model call, and no duplicate claim.
    expect(provider.requests).toHaveLength(0);
    expect(await statementClaims(tenantId, evidenceId)).toHaveLength(before.length);
  });

  it("is SKIPPED with no configured LLM, writing no claim and leaving the evidence", async () => {
    const { tenantId, jobId, evidenceId } = await articleCase("extract-off");
    const disposition = await runArticleExtraction(
      { db, llm: { unavailable: "No hosted LLM provider is configured." } },
      tenantId,
      jobId,
    );
    expect(disposition).toMatchObject({ kind: "SKIPPED" });
    const claims = await statementClaims(tenantId, evidenceId);
    expect(claims.some((c) => c.attribute === ARTICLE_STATEMENTS_ATTRIBUTE)).toBe(false);
    // The collected evidence is untouched.
    const evidence = await db.withTenant(tenantId, ({ repos }) =>
      repos.evidence.findById(evidenceId),
    );
    expect(evidence).not.toBeNull();
  });

  it("FAILS closed on a rejected answer, writing no claim", async () => {
    const { tenantId, jobId, evidenceId } = await articleCase("extract-fail");
    const ungrounded = extractionAnswer([
      { subject: "x", attribute: "y", value: "z", quote: "A quote that is absent from the body." },
    ]);
    const disposition = await runArticleExtraction(
      { db, llm: clientWith(new ScriptedProvider([ungrounded, ungrounded])) },
      tenantId,
      jobId,
    );
    expect(disposition).toMatchObject({ kind: "FAILED", code: "EXTRACTION_REJECTED" });
    const claims = await statementClaims(tenantId, evidenceId);
    expect(claims.some((c) => c.attribute === ARTICLE_STATEMENTS_ATTRIBUTE)).toBe(false);
  });

  it("writes nothing for a tenant that did not collect the article", async () => {
    const a = await articleCase("extract-tenant-a");
    await runArticleExtraction(
      { db, llm: clientWith(new ScriptedProvider([GROUNDED_ANSWER])) },
      a.tenantId,
      a.jobId,
    );
    // A fresh tenant sees none of tenant A's claims.
    const other = parseTenantId(randomUUID());
    await db.provisionTenant({ tenantId: other, name: "[Tenant other]", region: "IN" });
    const claims = await db.withTenant(other, ({ repos }) => repos.claims.list({ limit: 100 }));
    expect(claims).toEqual([]);
    // And a non-article job id in tenant A is SKIPPED, not touched.
    const skipped = await runArticleExtraction(
      { db, llm: clientWith(new ScriptedProvider([])) },
      a.tenantId,
      randomUUID(),
    );
    expect(skipped).toMatchObject({ kind: "SKIPPED" });
  });
});
