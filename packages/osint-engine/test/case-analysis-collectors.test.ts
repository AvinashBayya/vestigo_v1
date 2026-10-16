/**
 * A collector the registry lists as BLOCKED or NOT_IMPLEMENTED, from the
 * registry to the stored document (owner ruling, 2026-10-13): the analysis
 * reads it from the real registry, the real planner records it, and the
 * documents keep its registry label and discipline, never count it as one
 * that could have run (however the planner recorded it), and pass the stored
 * document's schema, as a document version 4 stored still does. The run
 * report's coverage labels it from the registry too.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  caseBreakdown,
  caseCollectors,
  caseCoverage,
  ENGINE_VERSION,
  REGISTRATIONS,
  type CaseBreakdown,
  type CaseCollectors,
  type CaseCoverage,
  type CaseInput,
  type DisciplineSection,
} from "@repo/case-engine";
import {
  CollectorRegistry,
  CollectorRuntime,
  declareCollector,
  defineCollector,
  type CollectorDeclaration,
  type SourceDeclaration,
} from "@repo/collectors";
import { UNRUNNABLE_REASONS, type CollectorDiscipline, type TargetType } from "@repo/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CASE_ANALYSIS_FORMAT_VERSION,
  CaseAnalysisDocumentSchema,
  caseAnalysisCollectors,
  caseInputHash,
  CaseWordingSchema,
  planRun,
} from "../src/index.ts";
import { coverageOf } from "../src/reports/assemble.ts";
import { coveragePlan } from "../src/reports/stored-plan.ts";

const NOT_IN_REGISTRY = "(not in the current registry)";
const V4_FIXTURE = new URL("./fixtures/case-analysis-engine-v4.json", import.meta.url);
const V6_FIXTURE = new URL("./fixtures/case-analysis-engine-v6.json", import.meta.url);

function source(
  id: string,
  commercialUse: "PERMITTED" | "BLOCKED" | "UNVERIFIED",
): SourceDeclaration {
  return {
    id,
    name: `[Source ${id}]`,
    access: ["open"],
    licence: {
      commercialUse,
      reason: `[test: ${commercialUse.toLowerCase()} licence]`,
      check:
        commercialUse === "UNVERIFIED"
          ? null
          : {
              checkedOn: "2026-10-13",
              sourceUrl: "https://example.com/terms",
              recordedIn: "[test]",
            },
    },
    network: {
      protocol: "https",
      hosts: [`${id}.example`],
      rateLimit: { requests: 1, intervalSeconds: 1, basis: "SELF_IMPOSED", note: "[test]" },
      operators: [{ name: "fake", hosts: [`${id}.example`] }],
    },
    attribution: null,
  };
}

const NAMES = z.object({ names: z.array(z.string()), derived: z.object({}) });

const declaration = (
  id: string,
  sourceId: string,
  discipline: CollectorDiscipline,
  targetTypes: TargetType[] = ["DOMAIN"],
): CollectorDeclaration<typeof NAMES> => ({
  id,
  version: "1.0.0",
  displayName: `[fake ${id}]`,
  discipline,
  targetTypes,
  collectionMode: "PASSIVE_API",
  source: sourceId,
  credentials: { vaultIds: [], runsWithout: true },
  claimStrength: "REPORTED",
  timeoutMs: 1_000,
  resultSchema: NAMES,
});

const implemented = (
  id: string,
  sourceId: string,
  discipline: CollectorDiscipline,
  targetTypes?: TargetType[],
) =>
  defineCollector(declaration(id, sourceId, discipline, targetTypes), () =>
    Promise.reject(new Error("[test] planning never runs a collector")),
  );

const registry = new CollectorRegistry({
  sources: [
    source("open", "PERMITTED"),
    source("blocked", "BLOCKED"),
    source("unchecked", "UNVERIFIED"),
  ],
  collectors: [
    implemented("fake.dns", "open", "TECHINT"),
    implemented("fake.blocked", "blocked", "TECHINT"),
    declareCollector(declaration("fake.pending", "open", "TECHINT")),
    implemented("fake.unverified", "unchecked", "TECHINT"),
    implemented("fake.person", "open", "PERSON"),
    implemented("fake.person-blocked", "blocked", "PERSON"),
    // The planner records these two before it reaches LICENCE_BLOCKED or
    // NOT_IMPLEMENTED: not applicable (it takes no domain), and an unverified
    // source refused before the missing implementation is noticed.
    implemented("fake.person-email", "blocked", "PERSON", ["EMAIL_ADDRESS"]),
    declareCollector(declaration("fake.person-pending", "unchecked", "PERSON")),
    implemented("fake.geo-blocked", "blocked", "GEOINT"),
    // MEDIAINT's only collector reads an unverified source, which never runs.
    implemented("fake.media-unverified", "unchecked", "MEDIAINT"),
  ],
});

const runtime = new CollectorRuntime({
  registry,
  network: { rateLimiter: { acquire: () => Promise.resolve({ allowed: true }) } },
});

const collectors = caseAnalysisCollectors(registry, []);

const CASE_ID = randomUUID();
const RUN_ID = randomUUID();
const JOB_ID = randomUUID();
const EVIDENCE_ID = randomUUID();
const ENTITY_ID = randomUUID();

/** A case pinning what fake.dns found in one run, planned by the real planner. */
async function plannedCase(): Promise<{ readonly plan: unknown; readonly input: CaseInput }> {
  const planned = await planRun(runtime, {
    input: "example.com",
    requestedType: null,
    entitlement: { plan: "TECHINT", vettingStatus: "NOT_SUBMITTED" },
    scopeFor: () => Promise.resolve(null),
  });
  // Stored as JSON and read back as the analysis job reads it.
  const plan: unknown = JSON.parse(JSON.stringify(planned));
  const input: CaseInput = {
    caseId: CASE_ID,
    evidence: [
      {
        id: EVIDENCE_ID,
        collectorId: "fake.dns",
        jobId: JOB_ID,
        collectedAt: "2026-10-13T09:01:00.000Z",
        observedAt: null,
        strength: "REPORTED",
      },
    ],
    claims: [
      {
        id: randomUUID(),
        evidenceId: EVIDENCE_ID,
        entityId: ENTITY_ID,
        relationshipId: null,
        strength: "REPORTED",
      },
    ],
    entities: [{ id: ENTITY_ID }],
    relationships: [],
    jobs: [
      {
        id: JOB_ID,
        runId: RUN_ID,
        collectorId: "fake.dns",
        status: "SUCCEEDED",
        outcome: "FOUND",
        outcomeDetail: null,
        targetType: "DOMAIN",
        attempts: 1,
        evidenceIds: [EVIDENCE_ID],
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    ],
    runs: [
      {
        id: RUN_ID,
        investigationId: randomUUID(),
        investigationTitle: "[Investigation]",
        status: "SUCCEEDED",
        plan: coveragePlan(plan),
        startedAt: "2026-10-13T09:00:00.000Z",
        finishedAt: "2026-10-13T09:02:00.000Z",
      },
    ],
    registry: collectors.registry,
    held: collectors.held,
  };
  return { plan, input };
}

const documentsOf = (
  input: CaseInput,
): {
  readonly coverage: CaseCoverage;
  readonly collectors: CaseCollectors;
  readonly breakdown: CaseBreakdown;
} => {
  const coverage = caseCoverage(input);
  const listed = caseCollectors(input);
  const breakdown = caseBreakdown(input);
  if (
    coverage.kind !== "CASE_COVERAGE" ||
    listed.kind !== "CASE_COLLECTORS" ||
    breakdown.kind !== "CASE_BREAKDOWN"
  ) {
    return expect.fail("[test] expected the documents of a case that holds records");
  }
  return { coverage, collectors: listed, breakdown };
};

const sectionOf = (breakdown: CaseBreakdown, discipline: string): DisciplineSection => {
  const section = breakdown.sections.find((candidate) => candidate.discipline === discipline);
  if (section === undefined) return expect.fail(`[test] the ${discipline} section is missing`);
  return section;
};

describe("a collector that cannot run, from the registry to the stored document", () => {
  it("is read from the registry with its label and discipline, saying it cannot run", () => {
    expect(collectors.registry.map((entry) => entry.id)).toEqual(
      registry.list().map((entry) => entry.id),
    );
    for (const entry of registry.list()) {
      expect(collectors.registry.find((collector) => collector.id === entry.id)).toMatchObject({
        label: entry.label,
        discipline: entry.discipline,
        collectionMode: entry.collectionMode,
      });
    }
    expect(
      Object.fromEntries(collectors.registry.map((entry) => [entry.id, entry.cannotRun])),
    ).toEqual({
      "fake.dns": null,
      "fake.blocked": "BLOCKED",
      "fake.pending": "NOT_IMPLEMENTED",
      // An unverified source never runs, in any deployment (2026-10-16).
      "fake.unverified": "UNVERIFIED",
      "fake.person": null,
      "fake.person-blocked": "BLOCKED",
      "fake.person-email": "BLOCKED",
      "fake.person-pending": "NOT_IMPLEMENTED",
      "fake.geo-blocked": "BLOCKED",
      "fake.media-unverified": "UNVERIFIED",
    });
  });

  it("is recorded by the real planner, with a reason core lists as unable to run when it gets that far", async () => {
    const { input } = await plannedCase();
    const plan = input.runs[0]?.plan;
    if (plan?.kind !== "PLANNED") return expect.fail("[test] expected a recorded plan");
    const reasons = Object.fromEntries(plan.excluded.map((e) => [e.collectorId, e.reason]));
    expect(reasons).toEqual({
      "fake.blocked": "LICENCE_BLOCKED",
      "fake.pending": "NOT_IMPLEMENTED",
      "fake.unverified": "UNVERIFIED_SOURCE_NOT_ALLOWED",
      "fake.person": "MODULE_NOT_IN_PLAN",
      "fake.person-blocked": "LICENCE_BLOCKED",
      "fake.person-email": "TARGET_TYPE_NOT_ACCEPTED",
      "fake.person-pending": "UNVERIFIED_SOURCE_NOT_ALLOWED",
      "fake.geo-blocked": "LICENCE_BLOCKED",
      "fake.media-unverified": "UNVERIFIED_SOURCE_NOT_ALLOWED",
    });
    // An unverified source never runs now, so its refusal says the collector
    // could not run, as LICENCE_BLOCKED does (2026-10-16).
    for (const collectorId of [
      "fake.blocked",
      "fake.pending",
      "fake.unverified",
      "fake.person-blocked",
      "fake.person-pending",
      "fake.media-unverified",
    ]) {
      expect(UNRUNNABLE_REASONS).toContain(reasons[collectorId]);
    }
    // An earlier check decided this one, so its recorded reason does not say
    // it could not run: only its registration does.
    expect(UNRUNNABLE_REASONS).not.toContain(reasons["fake.person-email"]);
  });

  it("keeps its registry label in every document, and is never counted as one that could run", async () => {
    const { input } = await plannedCase();
    const documents = documentsOf(input);
    for (const document of Object.values(documents)) {
      expect(JSON.stringify(document)).not.toContain(NOT_IN_REGISTRY);
    }
    expect(
      documents.coverage.runs[0]?.coverage.entries.find(
        (entry) => entry.collectorId === "fake.blocked",
      ),
    ).toMatchObject({
      sourceLabel: "[fake fake.blocked]",
      state: "EXCLUDED",
      reasonCode: "LICENCE_BLOCKED",
      detail: "[Source blocked] is blocked: [test: blocked licence]",
    });
    expect(
      Object.fromEntries(
        documents.collectors.collectors.map((collector) => [
          collector.collectorId,
          [collector.registration, collector.discipline, collector.sourceLabel],
        ]),
      ),
    ).toEqual({
      "fake.blocked": ["BLOCKED", "TECHINT", "[fake fake.blocked]"],
      "fake.dns": ["REGISTERED", "TECHINT", "[fake fake.dns]"],
      "fake.geo-blocked": ["BLOCKED", "GEOINT", "[fake fake.geo-blocked]"],
      "fake.pending": ["NOT_IMPLEMENTED", "TECHINT", "[fake fake.pending]"],
      "fake.person": ["REGISTERED", "PERSON", "[fake fake.person]"],
      "fake.person-blocked": ["BLOCKED", "PERSON", "[fake fake.person-blocked]"],
      "fake.person-email": ["BLOCKED", "PERSON", "[fake fake.person-email]"],
      "fake.person-pending": ["NOT_IMPLEMENTED", "PERSON", "[fake fake.person-pending]"],
      "fake.unverified": ["UNVERIFIED", "TECHINT", "[fake fake.unverified]"],
      "fake.media-unverified": ["UNVERIFIED", "MEDIAINT", "[fake fake.media-unverified]"],
    });

    const techint = sectionOf(documents.breakdown, "TECHINT");
    expect(techint.status).toBe("PRESENT");
    expect(techint.collectors.registered.map((ref) => ref.collectorId)).toEqual(["fake.dns"]);
    // MEDIAINT's only collector reads an unverified source: it never runs, so
    // nothing could have been collected, and its counts are null, never 0
    // (access methods, acceptance c; D-39 closed for UNVERIFIED).
    const mediaint = sectionOf(documents.breakdown, "MEDIAINT");
    expect(mediaint.status).toBe("UNVERIFIED");
    for (const count of [
      mediaint.evidence,
      mediaint.claims,
      mediaint.entities,
      mediaint.relationships,
    ]) {
      expect(count).toEqual({ count: null, ids: null, reason: "ONLY_UNVERIFIED_COLLECTORS" });
    }
    expect([mediaint.evidenceByStrength, mediaint.claimsByStrength]).toEqual([null, null]);
    expect(mediaint.collectors.registered).toEqual([]);
    // The only place PERSON could run, it was locked. Its three collectors that
    // cannot run say nothing about a lock, however the plan recorded them:
    // LICENCE_BLOCKED, not applicable, or an unverified source refused.
    const person = sectionOf(documents.breakdown, "PERSON");
    expect(person.status).toBe("LOCKED");
    expect(person.evidence).toEqual({ count: null, ids: null, reason: "LOCKED" });
    expect(person.collectors.registered.map((ref) => ref.collectorId)).toEqual(["fake.person"]);
    // GEOINT's only collector is blocked: nothing could have been collected.
    const geoint = sectionOf(documents.breakdown, "GEOINT");
    expect(geoint.status).toBe("BLOCKED");
    expect(geoint.evidence).toEqual({ count: null, ids: null, reason: "ONLY_BLOCKED_COLLECTORS" });
  });

  it("passes the stored document's schema, every registration but HELD included", async () => {
    const { input } = await plannedCase();
    const documents = documentsOf(input);
    const document = {
      formatVersion: CASE_ANALYSIS_FORMAT_VERSION,
      engineVersion: ENGINE_VERSION,
      caseId: CASE_ID,
      inputHash: caseInputHash({ input, activeMergeIds: [] }),
      basis: { evidenceIds: [EVIDENCE_ID], runIds: [RUN_ID] },
      ...documents,
    };
    const checked = CaseAnalysisDocumentSchema.safeParse(document);
    expect(checked.error).toBeUndefined();
    // A registration the schema left out would fail only when a document used it.
    for (const registration of REGISTRATIONS.filter((value) => value !== "HELD")) {
      const relabelled = {
        ...document,
        collectors: {
          ...documents.collectors,
          collectors: documents.collectors.collectors.map((collector) => ({
            ...collector,
            registration,
          })),
        },
      };
      expect(CaseAnalysisDocumentSchema.safeParse(relabelled).error).toBeUndefined();
    }
  });

  it("still reads a document version 4 stored, with every status, reason and registration it wrote", () => {
    // Written by ENGINE_VERSION 4's own code (a546de9) and stored as the job
    // stores it, with the wording beside it. Every read re-parses a stored
    // document with today's schema, so removing or renaming a value a stored
    // document holds would make its read fail (CLAUDE.md §7: additive only).
    const stored = z
      .object({ document: z.record(z.string(), z.unknown()), wording: z.unknown() })
      .parse(JSON.parse(readFileSync(V4_FIXTURE, "utf8")));
    const document = CaseAnalysisDocumentSchema.parse(stored.document);
    expect(document.engineVersion).toBe(4);
    expect(CaseWordingSchema.safeParse(stored.wording).error).toBeUndefined();
    if (document.breakdown.kind !== "CASE_BREAKDOWN") return expect.fail("[test] a breakdown");
    if (document.collectors.kind !== "CASE_COLLECTORS") return expect.fail("[test] collectors");
    expect(new Set(document.breakdown.sections.map((section) => section.status))).toEqual(
      new Set(["PRESENT", "ZERO", "HELD", "LOCKED", "NOT_BUILT"]),
    );
    expect(
      new Set(
        document.breakdown.sections.flatMap((section) =>
          section.evidence.count === null ? [section.evidence.reason] : [],
        ),
      ),
    ).toEqual(new Set(["NO_COLLECTOR_BUILT", "ONLY_HELD_COLLECTORS", "LOCKED"]));
    expect(
      new Set(document.collectors.collectors.map((collector) => collector.registration)),
    ).toEqual(new Set(["REGISTERED", "HELD", "NOT_REGISTERED"]));
  });

  it("still reads a document version 6 stored, with every status, reason, registration and state it wrote", () => {
    // Written by ENGINE_VERSION 6's own code (6bf5fe3) and stored as the job
    // stores it, with the wording beside it, before version 7 added the
    // UNVERIFIED registration and status: a value it holds that today's schema
    // refused would make every read of it fail (CLAUDE.md §7: additive only).
    const stored = z
      .object({ document: z.record(z.string(), z.unknown()), wording: z.unknown() })
      .parse(JSON.parse(readFileSync(V6_FIXTURE, "utf8")));
    const document = CaseAnalysisDocumentSchema.parse(stored.document);
    expect(document.engineVersion).toBe(6);
    expect(CaseWordingSchema.safeParse(stored.wording).error).toBeUndefined();
    if (document.breakdown.kind !== "CASE_BREAKDOWN") return expect.fail("[test] a breakdown");
    if (document.collectors.kind !== "CASE_COLLECTORS") return expect.fail("[test] collectors");
    expect(new Set(document.breakdown.sections.map((section) => section.status))).toEqual(
      new Set(["PRESENT", "HELD", "NOT_BUILT", "BLOCKED", "LOCKED"]),
    );
    expect(
      new Set(document.collectors.collectors.map((collector) => collector.registration)),
    ).toEqual(new Set(["REGISTERED", "HELD", "BLOCKED", "NOT_IMPLEMENTED"]));
    expect(JSON.stringify(document.coverage)).toContain('"EMPTY_UNCONFIRMED"');
  });

  it("is labelled from the registry in the run report's coverage too", async () => {
    const { plan } = await plannedCase();
    const coverage = coverageOf(registry, "SUCCEEDED", plan, [], []);
    expect(JSON.stringify(coverage)).not.toContain(NOT_IN_REGISTRY);
    expect(coverage.entries.find((entry) => entry.collectorId === "fake.blocked")).toMatchObject({
      sourceLabel: "[fake fake.blocked]",
      state: "EXCLUDED",
      reasonCode: "LICENCE_BLOCKED",
    });
  });
});
