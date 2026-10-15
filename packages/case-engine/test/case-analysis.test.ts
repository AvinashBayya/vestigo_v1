/**
 * Case coverage, the per-collector view and the discipline breakdown: every
 * function's honest empty and unavailable case, determinism over shuffled
 * input, strengths and times passed through as recorded, labels from the
 * registry alone, and a test for each defect the inventory records in the
 * previous codebase's version (R1-INVENTORY.md, cases/case-report.ts and
 * cases/case-intelligence-breakdown.ts).
 */
import { CASE_WORDING, CLAIM_STRENGTHS, COLLECTOR_DISCIPLINES } from "@repo/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  breakdownHeadline,
  CANNOT_RUN,
  CASE_BREAKDOWN_CAVEATS,
  CASE_COVERAGE_CAVEATS,
  caseBreakdown,
  caseCollectors,
  caseCoverage,
  CaseInputError,
  DISCIPLINE_NOT_MEASURED,
  DISCIPLINE_STATUSES,
  ENGINE_VERSION,
  isIsoInstant,
  REGISTRATIONS,
  runCoverage,
  type CaseBreakdown,
  type CaseCollectors,
  type CaseCoverage,
  type CaseInput,
  type CaseRegistryCollector,
  type CoverageExclusion,
  type DisciplineSection,
} from "../src/index.ts";
import {
  CASE,
  EMPTY,
  HELD,
  id,
  must,
  registered,
  REGISTRY,
  RUNS,
  shuffledCase,
} from "./fixtures.ts";

const coverage = (input: CaseInput = CASE): CaseCoverage => {
  const document = caseCoverage(input);
  if (document.kind !== "CASE_COVERAGE") return expect.fail("[test] expected a case coverage");
  return document;
};
const breakdown = (input: CaseInput = CASE): CaseBreakdown => {
  const document = caseBreakdown(input);
  if (document.kind !== "CASE_BREAKDOWN") return expect.fail("[test] expected a case breakdown");
  return document;
};
const collectors = (input: CaseInput = CASE): CaseCollectors => {
  const document = caseCollectors(input);
  if (document.kind !== "CASE_COLLECTORS") return expect.fail("[test] expected the collectors");
  return document;
};
const sectionOf = (document: CaseBreakdown, discipline: string): DisciplineSection =>
  must(
    document.sections.find((section) => section.discipline === discipline),
    `the ${discipline} section`,
  );
const collectorIds = (group: readonly { readonly collectorId: string }[]): string[] =>
  group.map((entry) => entry.collectorId);
const ids = (...names: string[]): string[] => names.map(id);

describe("an empty case", () => {
  it("gets an explicit empty-case document from every function, never a zeroed one", () => {
    const expected = {
      kind: "EMPTY_CASE",
      engineVersion: ENGINE_VERSION,
      caseId: id("empty case"),
      reason: "NO_RECORDS_IN_CASE",
    };
    expect(caseCoverage(EMPTY)).toEqual(expected);
    expect(caseBreakdown(EMPTY)).toEqual(expected);
    expect(caseCollectors(EMPTY)).toEqual(expected);
  });

  it("still refuses runs that no evidence came from", () => {
    expect(() => caseCoverage({ ...EMPTY, runs: RUNS })).toThrow(CaseInputError);
  });
});

describe("unavailable: nothing registered and nothing held", () => {
  const bare: CaseInput = { ...CASE, registry: [], held: [] };

  it("shows every discipline as NOT_BUILT, its counts null with the reason, never 0", () => {
    const document = breakdown(bare);
    for (const section of document.sections) {
      expect(section.status).toBe("NOT_BUILT");
      for (const count of [
        section.evidence,
        section.claims,
        section.entities,
        section.relationships,
      ]) {
        expect(count).toEqual({ count: null, ids: null, reason: "NO_COLLECTOR_BUILT" });
      }
      expect(section.evidenceByStrength).toBeNull();
      expect(section.claimsByStrength).toBeNull();
    }
    expect(document.notRegistered.evidence).toEqual({
      count: 5,
      ids: ids("ev1", "ev2", "ev4", "ev5", "ev6"),
    });
    expect(breakdownHeadline(document)).toBe(
      "5 evidence records are held, all from collectors no longer registered.",
    );
  });

  it("names every collector by its id, saying it is not registered", () => {
    const document = collectors(bare);
    for (const collector of document.collectors) {
      expect(collector.registration).toBe("NOT_REGISTERED");
      expect(collector.discipline).toBeNull();
      expect(collector.sourceLabel).toBe(`${collector.collectorId} (not in the current registry)`);
    }
  });
});

describe("case coverage", () => {
  it("names each run the case's evidence came from, with its investigation, by start time", () => {
    const document = coverage();
    expect(document.runs.map((run) => [run.runId, run.investigation])).toEqual([
      [id("run A"), { id: id("investigation one"), title: "[Investigation one]" }],
      [id("run B"), { id: id("investigation two"), title: "[Investigation two]" }],
    ]);
    expect(document.engineVersion).toBe(ENGINE_VERSION);
  });

  it("recomputes each run's coverage with the run report's own function", () => {
    const document = coverage();
    for (const run of document.runs) {
      const source = must(
        RUNS.find((candidate) => candidate.id === run.runId),
        "the run",
      );
      const report = runCoverage({
        registry: REGISTRY,
        status: source.status,
        plan: source.plan,
        jobs: CASE.jobs.filter((job) => job.runId === run.runId),
        held: HELD,
      });
      // The same statement as the run report; only the order of its lists is fixed.
      const byCollector = <T extends { readonly collectorId: string }>(list: readonly T[]) =>
        [...list].sort((a, b) => (a.collectorId < b.collectorId ? -1 : 1));
      expect({ ...run.coverage, entries: byCollector(run.coverage.entries) }).toEqual({
        ...report,
        entries: byCollector(report.entries),
        notApplicable: byCollector(report.notApplicable),
      });
    }
    expect(document.runs[0]?.coverage.headline).toBe(
      "PARTIAL RUN: 1 of 4 planned collectors did not complete, so this report does not cover what they would have collected (2 found something, 1 found nothing). 3 further collectors were excluded or held and did not run.",
    );
  });

  it("reports what of each job's evidence is in the case, and 'collected but not pinned'", () => {
    const runA = coverage().runs[0];
    expect(
      runA?.jobs.map((job) => [job.collectorId, job.state, job.inCase.ids, job.notInCase.ids]),
    ).toEqual([
      ["crt", "NOTHING_FOUND", [], []],
      ["dns", "COLLECTED", ids("ev1", "ev2"), []],
      ["rdap", "FAILED", [], []],
      ["wayback", "COLLECTED_NOT_PINNED", [], ids("ev3")],
    ]);
    expect(runA?.evidenceInCase).toEqual({ count: 2, ids: ids("ev1", "ev2") });
  });

  it("reports evidence with no recorded collection job: counted, by collector, never dropped", () => {
    const document = coverage();
    expect(document.evidenceWithNoRecordedJob.evidence).toEqual({
      count: 2,
      ids: ids("ev5", "ev6"),
    });
    expect(document.evidenceWithNoRecordedJob.byCollector).toEqual([
      { collectorId: "dns", sourceLabel: "[fake dns]", evidence: { count: 1, ids: ids("ev5") } },
      {
        collectorId: "gone",
        sourceLabel: "gone (not in the current registry)",
        evidence: { count: 1, ids: ids("ev6") },
      },
    ]);
    expect(document.evidence.count).toBe(5);
    expect(document.partial).toBe(true);
    expect(document.partialBecause).toEqual(["RUN_PARTIAL", "EVIDENCE_WITH_NO_RECORDED_JOB"]);
    expect(document.partialRuns).toEqual({ count: 1, ids: ids("run A") });
    expect(document.caveats).toEqual(["NO_NEW_COLLECTION"]);
  });

  it("is not partial when every run is complete and every item has its job", () => {
    const complete: CaseInput = {
      ...CASE,
      evidence: CASE.evidence.filter((evidence) => evidence.id === id("ev4")),
      claims: CASE.claims.filter((claim) => claim.evidenceId === id("ev4")),
      jobs: CASE.jobs.filter((job) => job.runId === id("run B")),
      runs: RUNS.filter((run) => run.id === id("run B")),
    };
    const document = coverage(complete);
    expect(document.partial).toBe(false);
    expect(document.partialBecause).toEqual([]);
    expect(document.partialRuns).toEqual({ count: 0, ids: [] });
  });

  it("with evidence that has no job only, names no run and says why it is partial", () => {
    const noJobs: CaseInput = {
      ...CASE,
      evidence: CASE.evidence.filter((evidence) => evidence.jobId === null),
      claims: CASE.claims.filter((claim) => ["[c5]", "[c6]"].includes(claim.id)),
      jobs: [],
      runs: [],
    };
    const document = coverage(noJobs);
    expect(document.runs).toEqual([]);
    expect(document.partialBecause).toEqual(["EVIDENCE_WITH_NO_RECORDED_JOB"]);
  });

  it("with records but no evidence, says no collection can be named", () => {
    const document = coverage({ ...EMPTY, entities: [{ id: id("e9") }] });
    expect(document.partialBecause).toEqual(["NO_EVIDENCE_IN_CASE"]);
    expect(document.collectedAt).toEqual({
      earliest: null,
      latest: null,
      reason: "NO_EVIDENCE_IN_CASE",
      recorded: { count: 0, ids: [] },
      notRecorded: { count: 0, ids: [] },
    });
  });
});

describe("times are passed through as recorded", () => {
  it("keeps collectedAt and observedAt apart, and a null observedAt stays null", () => {
    const document = coverage();
    expect(document.collectedAt).toEqual({
      earliest: "2026-06-01T00:00:00.000Z",
      latest: "2026-09-05T09:01:00.000Z",
      reason: null,
      recorded: { count: 4, ids: ids("ev1", "ev2", "ev4", "ev6") },
      notRecorded: { count: 1, ids: ids("ev5") },
    });
    // ev1 and ev6 record no observedAt: they are listed as not recorded, and
    // their collection time never stands in for it.
    expect(document.observedAt).toEqual({
      earliest: "2026-01-02T03:04:05.006Z",
      latest: "2026-08-30T00:00:00.000Z",
      reason: null,
      recorded: { count: 3, ids: ids("ev2", "ev4", "ev5") },
      notRecorded: { count: 2, ids: ids("ev1", "ev6") },
    });
  });

  it("says when no evidence records a time, rather than inventing one", () => {
    const undated: CaseInput = {
      ...CASE,
      evidence: CASE.evidence.map((evidence) => ({ ...evidence, observedAt: null })),
    };
    expect(coverage(undated).observedAt).toEqual({
      earliest: null,
      latest: null,
      reason: "NOT_RECORDED_ON_ANY_EVIDENCE",
      recorded: { count: 0, ids: [] },
      notRecorded: { count: 5, ids: ids("ev1", "ev2", "ev4", "ev5", "ev6") },
    });
  });

  it("keeps a run's null times null, and orders a run never started last", () => {
    const unstarted: CaseInput = {
      ...CASE,
      runs: RUNS.map((run) =>
        run.id === id("run A") ? { ...run, startedAt: null, finishedAt: null } : run,
      ),
    };
    const document = coverage(unstarted);
    expect(document.runs.map((run) => [run.runId, run.startedAt, run.finishedAt])).toEqual([
      [id("run B"), "2026-09-05T09:00:00.000Z", null],
      [id("run A"), null, null],
    ]);
  });
});

describe("the discipline breakdown", () => {
  it("counts each discipline's records, with the ids it counted", () => {
    const techint = sectionOf(breakdown(), "TECHINT");
    expect(techint.status).toBe("PRESENT");
    expect(techint.evidence).toEqual({ count: 3, ids: ids("ev1", "ev2", "ev5") });
    expect(techint.claims).toEqual({ count: 3, ids: ids("c1", "c2", "c5") });
    expect(techint.entities).toEqual({ count: 2, ids: ids("e1", "e2") });
    expect(techint.relationships).toEqual({ count: 0, ids: [] });
  });

  it("groups each discipline's collectors by what they did in the case's runs", () => {
    const groups = sectionOf(breakdown(), "TECHINT").collectors;
    expect(collectorIds(groups.registered)).toEqual(["active", "crt", "dns", "late", "rdap"]);
    expect(collectorIds(groups.ran)).toEqual(["crt", "dns", "rdap"]);
    expect(collectorIds(groups.foundSomething)).toEqual(["dns"]);
    expect(collectorIds(groups.foundNothing)).toEqual(["crt"]);
    expect(collectorIds(groups.failed)).toEqual(["rdap"]);
    expect(groups.failed[0]?.runs).toEqual([
      {
        runId: id("run A"),
        jobId: id("job A rdap"),
        state: "FAILED",
        reasonCode: "UPSTREAM_TIMEOUT",
        detail: "[test] timed out",
      },
    ]);
    expect(collectorIds(groups.excluded)).toEqual(["active"]);
    expect(collectorIds(groups.notApplicable)).toEqual(["active", "crt", "dns", "rdap"]);
    expect(collectorIds(groups.notInAnyRun)).toEqual(["late"]);
  });

  it("lists a collector the plan or vetting locked, with the recorded reason", () => {
    const person = sectionOf(breakdown(), "PERSON");
    // Its one collector was locked in both runs: nothing could have been
    // collected, so the counts are null with the reason, not a measured zero.
    expect(person.status).toBe("LOCKED");
    for (const count of [person.evidence, person.claims, person.entities, person.relationships]) {
      expect(count).toEqual({ count: null, ids: null, reason: "LOCKED" });
    }
    expect(person.evidenceByStrength).toBeNull();
    expect(person.collectors.locked).toEqual([
      {
        collectorId: "phone",
        sourceLabel: "[fake phone]",
        runs: [
          {
            runId: id("run A"),
            jobId: null,
            state: "EXCLUDED",
            reasonCode: "MODULE_NOT_IN_PLAN",
            detail: "[test] module not in plan",
          },
          {
            runId: id("run B"),
            jobId: null,
            state: "EXCLUDED",
            reasonCode: "VETTING_NOT_APPROVED",
            detail: "[test] vetting not approved",
          },
        ],
      },
    ]);
    expect(person.collectors.excluded).toEqual([]);
  });

  it("counts a measured zero when any of a discipline's collectors was not locked at a place where it could run", () => {
    // phone is locked in run A only; in run B it does not apply.
    const partlyLocked: CaseInput = {
      ...CASE,
      runs: RUNS.map((run) =>
        run.id === id("run B") && run.plan.kind === "PLANNED"
          ? {
              ...run,
              plan: {
                ...run.plan,
                excluded: run.plan.excluded.map((excluded) =>
                  excluded.collectorId === "phone"
                    ? {
                        ...excluded,
                        targetType: null,
                        reason: "TARGET_TYPE_NOT_ACCEPTED",
                        message: "[test] does not accept a username",
                      }
                    : excluded,
                ),
              },
            }
          : run,
      ),
    };
    const person = sectionOf(breakdown(partlyLocked), "PERSON");
    expect(person.status).toBe("ZERO");
    expect(person.evidence).toEqual({ count: 0, ids: [] });
  });

  it("lists held collectors with their reason, and what was collected but not pinned", () => {
    const mediaint = sectionOf(breakdown(), "MEDIAINT");
    expect(mediaint.status).toBe("ZERO");
    expect(mediaint.collectors.held).toEqual([
      { collectorId: "news", sourceLabel: "[fake news]", reason: "[test] Held until [condition]." },
    ]);
    expect(mediaint.collectors.foundSomething).toEqual([
      {
        collectorId: "wayback",
        sourceLabel: "[fake wayback]",
        runs: [
          {
            runId: id("run A"),
            jobId: id("job A wayback"),
            state: "COLLECTED_NOT_PINNED",
            reasonCode: null,
            detail: null,
          },
        ],
      },
    ]);
  });

  it("shows a discipline whose only collectors are held as HELD, its counts null with the reason", () => {
    const heldOnly: CaseInput = {
      ...CASE,
      registry: REGISTRY.filter((entry) => entry.id !== "wayback"),
    };
    const mediaint = sectionOf(breakdown(heldOnly), "MEDIAINT");
    expect(mediaint.status).toBe("HELD");
    expect(mediaint.evidence).toEqual({ count: null, ids: null, reason: "ONLY_HELD_COLLECTORS" });
  });

  it("never lists a collector as held in a run whose recorded plan ran it", () => {
    // news is held now. In run A it ran and found ev10, not pinned.
    const ranThen: CaseInput = {
      ...CASE,
      registry: REGISTRY.filter((entry) => entry.id !== "wayback"),
      jobs: [
        ...CASE.jobs.filter((job) => job.collectorId !== "wayback"),
        {
          ...must(CASE.jobs[0], "a job"),
          id: id("job A news"),
          collectorId: "news",
          evidenceIds: [id("ev10")],
        },
      ],
    };
    const runA = must(coverage(ranThen).runs[0], "run A");
    expect(
      runA.coverage.entries.filter((entry) => entry.collectorId === "news").map((e) => e.state),
    ).toEqual(["COLLECTED"]);
    // phone and active did not run; news is no longer counted among them.
    expect(runA.coverage.headline).toContain(" 2 further collectors were excluded or held");
    expect(runA.coverage.entries.filter((entry) => entry.state === "HELD")).toEqual([]);
    expect(runA.jobs.find((job) => job.collectorId === "news")?.state).toBe("COLLECTED_NOT_PINNED");
    // It could have collected, so the discipline's zero is measured.
    const mediaint = sectionOf(breakdown(ranThen), "MEDIAINT");
    expect(mediaint.status).toBe("ZERO");
    expect(mediaint.evidence).toEqual({ count: 0, ids: [] });
  });

  it("labels a held collector the same way everywhere in a case, its job included", () => {
    const withHeldJob: CaseInput = {
      ...CASE,
      jobs: [
        ...CASE.jobs,
        {
          ...must(CASE.jobs[1], "job A crt"),
          id: id("job A news"),
          collectorId: "news",
        },
      ],
    };
    const runA = must(coverage(withHeldJob).runs[0], "run A");
    expect(
      runA.coverage.entries
        .filter((entry) => entry.collectorId === "news")
        .map((e) => e.sourceLabel),
    ).toEqual(["[fake news]"]);
    expect(runA.jobs.find((job) => job.collectorId === "news")?.sourceLabel).toBe("[fake news]");
    expect(
      collectors(withHeldJob).collectors.find((collector) => collector.collectorId === "news")
        ?.sourceLabel,
    ).toBe("[fake news]");
  });

  it("calls a held-only discipline HELD while none of its collectors' jobs completed", () => {
    const heldOnly = (state: Partial<CaseInput["jobs"][number]>): CaseInput => ({
      ...CASE,
      registry: REGISTRY.filter((entry) => entry.id !== "wayback"),
      jobs: [
        ...CASE.jobs.filter((job) => job.collectorId !== "wayback"),
        { ...must(CASE.jobs[1], "job A crt"), id: id("job A news"), collectorId: "news", ...state },
      ],
    });
    const refused = heldOnly({
      status: "FAILED",
      outcome: "REFUSED",
      lastErrorCode: "LICENCE_BLOCKED",
    });
    const queued = heldOnly({ status: "QUEUED", outcome: null, attempts: 0 });
    const completed = heldOnly({ status: "SUCCEEDED", outcome: "NOT_FOUND" });
    expect(sectionOf(breakdown(refused), "MEDIAINT").status).toBe("HELD");
    expect(sectionOf(breakdown(queued), "MEDIAINT").status).toBe("HELD");
    expect(sectionOf(breakdown(completed), "MEDIAINT").status).toBe("ZERO");
  });

  it("files a collector refused at dispatch for a lock as locked, never as ran or failed", () => {
    const refused: CaseInput = {
      ...CASE,
      runs: RUNS.map((run) =>
        run.id === id("run A") && run.plan.kind === "PLANNED"
          ? {
              ...run,
              plan: {
                ...run.plan,
                excluded: run.plan.excluded.filter((excluded) => excluded.collectorId !== "phone"),
              },
            }
          : run,
      ),
      jobs: [
        ...CASE.jobs,
        {
          ...must(CASE.jobs[0], "a job"),
          id: id("job A phone"),
          collectorId: "phone",
          status: "FAILED",
          outcome: "REFUSED",
          evidenceIds: null,
          lastErrorCode: "MODULE_NOT_IN_PLAN",
          lastErrorMessage: "[test] module not in plan",
        },
      ],
    };
    const person = sectionOf(breakdown(refused), "PERSON").collectors;
    expect(collectorIds(person.locked)).toEqual(["phone"]);
    expect(person.locked[0]?.runs.map((run) => [run.runId, run.state])).toEqual([
      [id("run A"), "REFUSED"],
      [id("run B"), "EXCLUDED"],
    ]);
    expect(person.ran).toEqual([]);
    expect(person.failed).toEqual([]);
  });

  it("counts an entity under every discipline whose evidence its claims cite, and says so", () => {
    const document = breakdown();
    expect(sectionOf(document, "TECHINT").entities.ids).toContain(id("e1"));
    expect(sectionOf(document, "SOCMINT").entities.ids).toContain(id("e1"));
    expect(document.totals.entities).toEqual({ count: 4, ids: ids("e1", "e2", "e3", "e4") });
    expect(document.caveats).toContain("ENTITY_AND_RELATIONSHIP_COUNTS_OVERLAP");
  });

  it("counts records no claim is about, and records from collectors no longer registered", () => {
    const document = breakdown();
    expect(document.entitiesWithNoClaim).toEqual({ count: 1, ids: ids("e4") });
    expect(document.relationshipsWithNoClaim).toEqual({ count: 1, ids: ids("r2") });
    expect(document.notRegistered).toEqual({
      collectors: [{ collectorId: "gone", sourceLabel: "gone (not in the current registry)" }],
      evidence: { count: 1, ids: ids("ev6") },
      claims: { count: 1, ids: ids("c6") },
      entities: { count: 1, ids: ids("e3") },
      relationships: { count: 0, ids: [] },
    });
  });

  it("headline: the disciplines present and the case's totals, in the approved wording", () => {
    expect(breakdownHeadline(breakdown())).toBe(
      "TECHINT, SOCMINT present · 5 evidence, 4 entities, 2 relationships in this case.",
    );
    expect(breakdownHeadline(breakdown({ ...EMPTY, entities: [{ id: id("e9") }] }))).toBe(
      "No discipline in this case holds any stored record. 0 evidence records total.",
    );
  });

  it("has approved wording for every caveat code, and no wording without a code", () => {
    expect(Object.keys(CASE_WORDING.coverageCaveats)).toEqual([...CASE_COVERAGE_CAVEATS]);
    expect(Object.keys(CASE_WORDING.breakdownCaveats)).toEqual([...CASE_BREAKDOWN_CAVEATS]);
  });

  it("has one section per discipline, in core's order", () => {
    expect(breakdown().sections.map((section) => section.discipline)).toEqual([
      ...COLLECTOR_DISCIPLINES,
    ]);
  });
});

describe("a collector that cannot run: BLOCKED or NOT_IMPLEMENTED (owner ruling, 2026-10-13)", () => {
  // As a run's plan records one: the runtime refuses a BLOCKED source with
  // LICENCE_BLOCKED and a collector with no code with NOT_IMPLEMENTED; one
  // that does not accept the target is not applicable, whatever else it is.
  const exclusion = (
    collectorId: string,
    reason: string,
    targetType: CoverageExclusion["targetType"] = "DOMAIN",
  ): CoverageExclusion => ({
    collectorId,
    targetType,
    reason,
    message: `[test] ${collectorId}: ${reason}`,
  });
  const notApplicable = (collectorId: string): CoverageExclusion =>
    exclusion(collectorId, "TARGET_TYPE_NOT_ACCEPTED", null);
  /** The case with `added` appended to each named run's recorded plan. */
  const withExclusions = (
    input: CaseInput,
    added: Readonly<Record<string, readonly CoverageExclusion[]>>,
  ): CaseInput => ({
    ...input,
    runs: input.runs.map((run) => {
      const extra = added[run.id];
      return extra === undefined || run.plan.kind !== "PLANNED"
        ? run
        : { ...run, plan: { ...run.plan, excluded: [...run.plan.excluded, ...extra] } };
    }),
  });
  const withRegistry = (...entries: CaseRegistryCollector[]): CaseInput => ({
    ...CASE,
    registry: [...REGISTRY, ...entries],
  });

  const blockedTechint = withExclusions(
    withRegistry(
      registered("blocked.dns", "PASSIVE_API", "TECHINT", "BLOCKED"),
      registered("pending.dns", "PASSIVE_API", "TECHINT", "NOT_IMPLEMENTED"),
    ),
    {
      [id("run A")]: [
        exclusion("blocked.dns", "LICENCE_BLOCKED"),
        exclusion("pending.dns", "NOT_IMPLEMENTED"),
      ],
      [id("run B")]: [notApplicable("blocked.dns"), notApplicable("pending.dns")],
    },
  );

  it("labels a BLOCKED collector a run's plan skipped from the registry, never 'not in the current registry'", () => {
    const [runA, runB] = coverage(blockedTechint).runs;
    expect(runA?.coverage.entries.filter((entry) => entry.collectorId === "blocked.dns")).toEqual([
      {
        collectorId: "blocked.dns",
        sourceLabel: "[fake blocked.dns]",
        state: "EXCLUDED",
        targetType: "DOMAIN",
        reasonCode: "LICENCE_BLOCKED",
        detail: "[test] blocked.dns: LICENCE_BLOCKED",
        evidenceCount: 0,
        attempts: null,
      },
    ]);
    expect(runB?.coverage.notApplicable).toContainEqual({
      collectorId: "blocked.dns",
      sourceLabel: "[fake blocked.dns]",
    });
    for (const document of [
      coverage(blockedTechint),
      breakdown(blockedTechint),
      collectors(blockedTechint),
    ]) {
      const text = JSON.stringify(document);
      expect(text).not.toContain("blocked.dns (not in the current registry)");
      expect(text).not.toContain("pending.dns (not in the current registry)");
    }
  });

  it("lists it under its own registration, with its registry label and discipline", () => {
    const byId = Object.fromEntries(
      collectors(blockedTechint).collectors.map((collector) => [collector.collectorId, collector]),
    );
    expect(byId["blocked.dns"]).toMatchObject({
      registration: "BLOCKED",
      heldReason: null,
      sourceLabel: "[fake blocked.dns]",
      discipline: "TECHINT",
    });
    expect(byId["pending.dns"]).toMatchObject({
      registration: "NOT_IMPLEMENTED",
      heldReason: null,
      sourceLabel: "[fake pending.dns]",
      discipline: "TECHINT",
    });
    expect(byId.dns?.registration).toBe("REGISTERED");
  });

  it("never counts it among a discipline's registered collectors, or those in no run", () => {
    const techint = sectionOf(breakdown(blockedTechint), "TECHINT").collectors;
    expect(collectorIds(techint.registered)).toEqual(["active", "crt", "dns", "late", "rdap"]);
    expect(collectorIds(techint.notInAnyRun)).toEqual(["late"]);
    // What the runs recorded for it is still listed, as recorded.
    expect(collectorIds(techint.excluded)).toEqual(["active", "blocked.dns", "pending.dns"]);
    expect(collectorIds(techint.notApplicable)).toEqual([
      "active",
      "blocked.dns",
      "crt",
      "dns",
      "pending.dns",
      "rdap",
    ]);
    // Named by no run (registered since): still not counted.
    const unnamed = sectionOf(
      breakdown(withRegistry(registered("blocked.dns", "PASSIVE_API", "TECHINT", "BLOCKED"))),
      "TECHINT",
    ).collectors;
    expect(collectorIds(unnamed.registered)).toEqual(["active", "crt", "dns", "late", "rdap"]);
    expect(collectorIds(unnamed.notInAnyRun)).toEqual(["late"]);
  });

  it("shows a discipline none of whose collectors can run as BLOCKED or NOT_BUILT, never a measured zero", () => {
    const geoint = (...entries: CaseRegistryCollector[]): DisciplineSection =>
      sectionOf(breakdown(withRegistry(...entries)), "GEOINT");
    const blocked = registered("geo.blocked", "PASSIVE_API", "GEOINT", "BLOCKED");
    const pending = registered("geo.pending", "PASSIVE_API", "GEOINT", "NOT_IMPLEMENTED");

    const blockedOnly = geoint(blocked);
    expect(blockedOnly.status).toBe("BLOCKED");
    for (const count of [
      blockedOnly.evidence,
      blockedOnly.claims,
      blockedOnly.entities,
      blockedOnly.relationships,
    ]) {
      expect(count).toEqual({ count: null, ids: null, reason: "ONLY_BLOCKED_COLLECTORS" });
    }
    expect(blockedOnly.evidenceByStrength).toBeNull();
    expect(blockedOnly.claimsByStrength).toBeNull();
    expect(blockedOnly.collectors.registered).toEqual([]);
    expect(blockedOnly.collectors.notInAnyRun).toEqual([]);

    const pendingOnly = geoint(pending);
    expect(pendingOnly.status).toBe("NOT_BUILT");
    expect(pendingOnly.evidence).toEqual({ count: null, ids: null, reason: "NO_COLLECTOR_BUILT" });
    expect(geoint(blocked, pending).status).toBe("BLOCKED");
    // One that can run beside them: the case was checked, and holds none.
    const open = geoint(blocked, pending, registered("geo.open", "PASSIVE_API", "GEOINT"));
    expect(open.status).toBe("ZERO");
    expect(open.evidence).toEqual({ count: 0, ids: [] });
  });

  it("reads HELD when a held collector stands beside collectors that cannot run", () => {
    // wayback's source is BLOCKED now, and it has no job in the case's runs.
    const input: CaseInput = {
      ...CASE,
      registry: REGISTRY.map((entry) =>
        entry.id === "wayback" ? { ...entry, cannotRun: "BLOCKED" } : entry,
      ),
      jobs: CASE.jobs.filter((job) => job.collectorId !== "wayback"),
    };
    const mediaint = sectionOf(breakdown(input), "MEDIAINT");
    expect(mediaint.status).toBe("HELD");
    expect(mediaint.evidence).toEqual({ count: null, ids: null, reason: "ONLY_HELD_COLLECTORS" });
  });

  it("keeps a zero measured when a collector blocked since completed a job in the case's runs", () => {
    // wayback ran in run A (ev3, not pinned); its source is BLOCKED now.
    const input: CaseInput = {
      ...CASE,
      registry: REGISTRY.map((entry) =>
        entry.id === "wayback" ? { ...entry, cannotRun: "BLOCKED" } : entry,
      ),
    };
    const mediaint = sectionOf(breakdown(input), "MEDIAINT");
    expect(mediaint.status).toBe("ZERO");
    expect(mediaint.evidence).toEqual({ count: 0, ids: [] });
    expect(collectorIds(mediaint.collectors.registered)).toEqual([]);
    // The run that ran it still says what it did, under its registry label.
    expect(
      must(coverage(input).runs[0], "run A").jobs.find((job) => job.collectorId === "wayback"),
    ).toMatchObject({ sourceLabel: "[fake wayback]", state: "COLLECTED_NOT_PINNED" });
  });

  it("judges a lock over the places a collector could run: a LICENCE_BLOCKED or NOT_IMPLEMENTED place is left out", () => {
    const person = (input: CaseInput): DisciplineSection => sectionOf(breakdown(input), "PERSON");
    // phone is locked in both runs. Beside it, a PERSON collector whose source
    // is BLOCKED and one with no implementation, as the plans recorded them.
    const beside = withExclusions(
      withRegistry(
        registered("person.blocked", "PASSIVE_API", "PERSON", "BLOCKED"),
        registered("person.pending", "PASSIVE_API", "PERSON", "NOT_IMPLEMENTED"),
      ),
      {
        [id("run A")]: [
          exclusion("person.blocked", "LICENCE_BLOCKED"),
          exclusion("person.pending", "NOT_IMPLEMENTED"),
        ],
        [id("run B")]: [
          exclusion("person.blocked", "LICENCE_BLOCKED", "USERNAME"),
          exclusion("person.pending", "NOT_IMPLEMENTED", "USERNAME"),
        ],
      },
    );
    expect(person(beside).status).toBe("LOCKED");
    expect(person(beside).evidence).toEqual({ count: null, ids: null, reason: "LOCKED" });
    expect(collectorIds(person(beside).collectors.locked)).toEqual(["phone"]);
    expect(collectorIds(person(beside).collectors.excluded)).toEqual([
      "person.blocked",
      "person.pending",
    ]);

    // Refused at dispatch for its licence (its source was blocked after run B
    // was planned): not a place it could run either.
    const refusedAtDispatch: CaseInput = {
      ...beside,
      runs: beside.runs.map((run) =>
        run.id === id("run B") && run.plan.kind === "PLANNED"
          ? {
              ...run,
              plan: {
                ...run.plan,
                excluded: run.plan.excluded.filter((e) => e.collectorId !== "person.blocked"),
              },
            }
          : run,
      ),
      jobs: [
        ...beside.jobs,
        {
          ...must(CASE.jobs[4], "job B gh"),
          id: id("job B person.blocked"),
          collectorId: "person.blocked",
          status: "FAILED",
          outcome: "REFUSED",
          evidenceIds: null,
          lastErrorCode: "LICENCE_BLOCKED",
          lastErrorMessage: "[test] blocked",
        },
      ],
    };
    expect(person(refusedAtDispatch).status).toBe("LOCKED");
    expect(collectorIds(person(refusedAtDispatch).collectors.failed)).toEqual(["person.blocked"]);

    // The place's recorded reason decides, not today's registry: this one can
    // run now, but run A recorded its source as blocked then.
    const blockedThen = withExclusions(
      withRegistry(registered("person.later", "PASSIVE_API", "PERSON")),
      {
        [id("run A")]: [exclusion("person.later", "LICENCE_BLOCKED")],
        [id("run B")]: [exclusion("person.later", "VETTING_NOT_APPROVED", "USERNAME")],
      },
    );
    expect(person(blockedThen).status).toBe("LOCKED");

    // One the registry lists as BLOCKED or NOT_IMPLEMENTED, recorded with a
    // reason an earlier check decided: not applicable (the planner checks the
    // target type first), or an unverified source refused before the missing
    // implementation is reached. Neither is a place where it could run.
    const recordedOtherwise = withExclusions(
      withRegistry(
        registered("person.email", "PASSIVE_API", "PERSON", "BLOCKED"),
        registered("person.pending", "PASSIVE_API", "PERSON", "NOT_IMPLEMENTED"),
      ),
      {
        [id("run A")]: [
          notApplicable("person.email"),
          exclusion("person.pending", "UNVERIFIED_SOURCE_NOT_ALLOWED"),
        ],
        [id("run B")]: [
          notApplicable("person.email"),
          exclusion("person.pending", "UNVERIFIED_SOURCE_NOT_ALLOWED", "USERNAME"),
        ],
      },
    );
    expect(person(recordedOtherwise).status).toBe("LOCKED");
    expect(person(recordedOtherwise).evidence).toEqual({
      count: null,
      ids: null,
      reason: "LOCKED",
    });

    // A collector that may run, not applicable at a place, keeps the zero
    // measured there, as before (no collector of it was locked everywhere).
    const applicableNowhere = withExclusions(
      withRegistry(registered("person.email", "PASSIVE_API", "PERSON")),
      { [id("run A")]: [notApplicable("person.email")] },
    );
    expect(person(applicableNowhere).status).toBe("ZERO");

    // Any other place where one could run and was not locked keeps the zero measured.
    const notLocked = withExclusions(
      withRegistry(registered("person.open", "PASSIVE_API", "PERSON")),
      {
        [id("run A")]: [exclusion("person.open", "SCOPE_AUTHORISATION_REQUIRED")],
      },
    );
    expect(person(notLocked).status).toBe("ZERO");
  });

  it("counts the evidence of a discipline whose only collectors cannot run now: PRESENT, never null", () => {
    // gh found ev4 in run B; its source has been BLOCKED since (and wd's too),
    // or neither has an implementation now. The case still holds what it found.
    for (const cannotRun of ["BLOCKED", "NOT_IMPLEMENTED"] as const) {
      const input: CaseInput = {
        ...CASE,
        registry: REGISTRY.map((entry) =>
          entry.discipline === "SOCMINT" ? { ...entry, cannotRun } : entry,
        ),
      };
      const socmint = sectionOf(breakdown(input), "SOCMINT");
      expect(socmint.status).toBe("PRESENT");
      expect(socmint.evidence).toEqual({ count: 1, ids: ids("ev4") });
      expect(socmint.collectors.registered).toEqual([]);
      expect(breakdownHeadline(breakdown(input))).toBe(
        "TECHINT, SOCMINT present · 5 evidence, 4 entities, 2 relationships in this case.",
      );
    }
    // Evidence with no recorded job, from a collector blocked since: still PRESENT.
    const unrecorded: CaseInput = {
      ...CASE,
      evidence: [
        ...CASE.evidence,
        {
          id: id("ev9"),
          collectorId: "geo.blocked",
          jobId: null,
          collectedAt: "2026-08-01T00:00:00.000Z",
          observedAt: null,
          strength: "REPORTED",
        },
      ],
      registry: [...REGISTRY, registered("geo.blocked", "PASSIVE_API", "GEOINT", "BLOCKED")],
    };
    const geoint = sectionOf(breakdown(unrecorded), "GEOINT");
    expect(geoint.status).toBe("PRESENT");
    expect(geoint.evidence).toEqual({ count: 1, ids: ids("ev9") });
  });

  it("gives the same documents whatever the order of its input", () => {
    const serialise = (input: CaseInput): string =>
      JSON.stringify([caseCoverage(input), caseBreakdown(input), caseCollectors(input)]);
    const expected = serialise(blockedTechint);
    for (const seed of [3, 99, 4_096]) {
      expect(serialise(shuffledCase(blockedTechint, seed))).toBe(expected);
    }
  });
});

describe("the codes a stored analysis holds are additive only", () => {
  it("lists every status, null reason and registration, the earlier ones unchanged", () => {
    // Every read re-parses a stored analysis with a schema built from these
    // lists, so a value removed or renamed would make every analysis holding
    // it unreadable (osint-engine reads a document version 4 stored to prove it).
    expect(DISCIPLINE_STATUSES).toEqual([
      "PRESENT",
      "ZERO",
      "HELD",
      "LOCKED",
      "NOT_BUILT",
      "BLOCKED",
    ]);
    expect(DISCIPLINE_NOT_MEASURED).toEqual([
      "NO_COLLECTOR_BUILT",
      "ONLY_HELD_COLLECTORS",
      "LOCKED",
      "ONLY_BLOCKED_COLLECTORS",
    ]);
    expect(REGISTRATIONS).toEqual([
      "REGISTERED",
      "HELD",
      "NOT_REGISTERED",
      "BLOCKED",
      "NOT_IMPLEMENTED",
    ]);
    expect(CANNOT_RUN).toEqual(["BLOCKED", "NOT_IMPLEMENTED"]);
  });
});

describe("strengths are passed through as recorded", () => {
  it("lists every claim and evidence item under exactly the strength recorded on it", () => {
    const document = breakdown();
    for (const strength of CLAIM_STRENGTHS) {
      expect(document.totals.claimsByStrength[strength].ids).toEqual(
        CASE.claims
          .filter((claim) => claim.strength === strength)
          .map((claim) => claim.id)
          .sort(),
      );
      expect(document.totals.evidenceByStrength[strength].ids).toEqual(
        CASE.evidence
          .filter((evidence) => evidence.strength === strength)
          .map((evidence) => evidence.id)
          .sort(),
      );
    }
    // A model-reserved strength on a stored claim is reported as it was
    // recorded: never raised, lowered or relabelled.
    expect(document.totals.claimsByStrength.CORRELATED.ids).toEqual(ids("c4"));
    expect(document.totals.claimsByStrength.INFERRED.ids).toEqual(ids("c5"));
    expect(document.totals.claimsByStrength.HYPOTHESIS.ids).toEqual(ids("c3"));
    expect(sectionOf(document, "SOCMINT").claimsByStrength?.HYPOTHESIS.ids).toEqual(ids("c3"));
  });
});

describe("source labels come from the registry input alone", () => {
  it("ignores any label a record or job carries, and names an unregistered collector by its id", () => {
    const spoof = { sourceLabel: "[spoofed]", source: "[spoofed]", label: "[spoofed]" };
    const spoofed: CaseInput = {
      ...CASE,
      evidence: CASE.evidence.map((evidence) => ({ ...evidence, ...spoof })),
      claims: CASE.claims.map((claim) => ({ ...claim, ...spoof })),
      entities: CASE.entities.map((entity) => ({ ...entity, ...spoof })),
      relationships: CASE.relationships.map((relationship) => ({ ...relationship, ...spoof })),
      jobs: CASE.jobs.map((job) => ({ ...job, ...spoof })),
    };
    const documents = [coverage(spoofed), breakdown(spoofed), collectors(spoofed)];
    for (const document of documents) expect(JSON.stringify(document)).not.toContain("[spoofed]");
    expect(collectors(spoofed)).toEqual(collectors());
    const labels = Object.fromEntries(
      collectors(spoofed).collectors.map((collector) => [
        collector.collectorId,
        collector.sourceLabel,
      ]),
    );
    for (const entry of REGISTRY) expect(labels[entry.id]).toBe(entry.label);
    expect(labels.gone).toBe("gone (not in the current registry)");
    expect(labels.news).toBe("[fake news]");
  });
});

describe("determinism", () => {
  const serialise = (input: CaseInput): string =>
    JSON.stringify([caseCoverage(input), caseBreakdown(input), caseCollectors(input)]);

  it("gives the same output for the same input in any order", () => {
    const expected = serialise(CASE);
    for (const seed of [1, 7, 42, 1_000, 65_537]) {
      expect(serialise(shuffledCase(CASE, seed))).toBe(expected);
    }
    expect(serialise(CASE)).toBe(expected);
  });

  it("orders two exclusions of one collector that differ only in target type", () => {
    const twice = (types: readonly ("DOMAIN" | null)[]): CaseInput => ({
      ...CASE,
      runs: RUNS.map((run) =>
        run.id === id("run A") && run.plan.kind === "PLANNED"
          ? {
              ...run,
              plan: {
                ...run.plan,
                excluded: [
                  ...run.plan.excluded.filter((excluded) => excluded.collectorId !== "active"),
                  ...types.map((targetType) => ({
                    collectorId: "active",
                    targetType,
                    reason: "SCOPE_AUTHORISATION_REQUIRED",
                    message: "[test] needs a scope authorisation",
                  })),
                ],
              },
            }
          : run,
      ),
    });
    expect(JSON.stringify(caseCoverage(twice(["DOMAIN", null])))).toBe(
      JSON.stringify(caseCoverage(twice([null, "DOMAIN"]))),
    );
  });

  it("states a held collector's target type whatever order its types are listed in", () => {
    const both = (types: readonly ("DOMAIN" | "USERNAME")[]): CaseInput => ({
      ...CASE,
      runs: RUNS.map((run) =>
        run.id === id("run A") && run.plan.kind === "PLANNED"
          ? { ...run, plan: { ...run.plan, targetTypes: ["DOMAIN", "USERNAME"] } }
          : run,
      ),
      held: HELD.map((entry) => ({ ...entry, targetTypes: [...types] })),
    });
    const heldType = (input: CaseInput) =>
      coverage(input)
        .runs[0]?.coverage.entries.filter((entry) => entry.state === "HELD")
        .map((entry) => entry.targetType);
    expect(heldType(both(["DOMAIN", "USERNAME"]))).toEqual(["DOMAIN"]);
    expect(heldType(both(["USERNAME", "DOMAIN"]))).toEqual(["DOMAIN"]);
  });

  describe("never reads the clock or draws randomness", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("runs with Date and Math.random replaced by functions that throw", () => {
      const expected = serialise(CASE);
      vi.stubGlobal(
        "Date",
        new Proxy(Date, {
          construct: () => {
            throw new Error("[test] the clock was read");
          },
          get: () => {
            throw new Error("[test] the clock was read");
          },
        }),
      );
      vi.spyOn(Math, "random").mockImplementation(() => {
        throw new Error("[test] randomness was drawn");
      });
      expect(serialise(CASE)).toBe(expected);
    });
  });
});

describe("input that contradicts itself is refused whole, naming every problem", () => {
  const problems = (input: CaseInput): string[] => {
    try {
      caseCoverage(input);
    } catch (error) {
      if (error instanceof CaseInputError) {
        expect(error.code).toBe("CASE_INPUT_INVALID");
        return error.issues.map((issue) => `${issue.problem}: ${issue.detail}`);
      }
      throw error;
    }
    return expect.fail("[test] expected the input to be refused");
  };

  it("names each problem, in a fixed order whatever the input's order", () => {
    const ev1 = must(CASE.evidence[0], "ev1");
    const broken: CaseInput = {
      ...CASE,
      evidence: [
        ...CASE.evidence,
        { ...ev1, id: id("ev7"), jobId: id("job nowhere") },
        { ...ev1, id: id("ev8"), collectorId: "crt" },
        { ...ev1, id: id("ev9"), collectedAt: "2026-09-01 10:00" },
        { ...ev1 },
      ],
      claims: [
        ...CASE.claims,
        { ...must(CASE.claims[0], "c1"), id: id("c9"), evidenceId: id("ev nowhere") },
      ],
      jobs: [
        ...CASE.jobs,
        {
          ...must(CASE.jobs[0], "a job"),
          id: id("job orphan"),
          runId: id("run nowhere"),
          evidenceIds: [],
        },
      ],
      runs: [...RUNS, { ...must(RUNS[1], "run B"), id: id("run unused") }],
    };
    const expected = [
      "DUPLICATE_ID: evidence [ev1]",
      "TIME_NOT_ISO: evidence [ev9] collectedAt",
      "EVIDENCE_JOB_MISSING: evidence [ev7] names job [job nowhere]",
      "EVIDENCE_JOB_COLLECTOR_MISMATCH: evidence [ev8] records crt, its job [job A dns] records dns",
      "EVIDENCE_NOT_IN_JOB_RESULT: evidence [ev8] names job [job A dns]",
      "EVIDENCE_NOT_IN_JOB_RESULT: evidence [ev9] names job [job A dns]",
      "CLAIM_EVIDENCE_MISSING: claim [c9] cites evidence [ev nowhere]",
      "JOB_RUN_MISSING: job [job orphan] names run [run nowhere]",
      "RUN_NOT_FROM_CASE: run [run unused]",
    ];
    expect(problems(broken)).toEqual(expected);
    expect(problems(shuffledCase(broken, 3))).toEqual(expected);
  });

  it("refuses records that contradict one another, rather than reporting a misleading count", () => {
    const ev1 = must(CASE.evidence[0], "ev1");
    const dnsJob = must(CASE.jobs[0], "job A dns");
    const cases: [string, CaseInput][] = [
      [
        "HELD_AND_REGISTERED: collector news",
        {
          ...CASE,
          registry: [...REGISTRY, registered("news", "PASSIVE_API", "MEDIAINT")],
        },
      ],
      [
        "EVIDENCE_NOT_IN_JOB_RESULT: evidence [ev1] names job [job A dns]",
        {
          ...CASE,
          jobs: CASE.jobs.map((job) =>
            job.id === dnsJob.id ? { ...job, evidenceIds: [id("ev2")] } : job,
          ),
        },
      ],
      [
        "JOB_EVIDENCE_ELSEWHERE: job [job A dns] lists evidence [ev1]",
        {
          ...CASE,
          evidence: CASE.evidence.map((evidence) =>
            evidence.id === ev1.id ? { ...evidence, jobId: null } : evidence,
          ),
        },
      ],
      [
        "CLAIM_SUBJECT_MISSING: claim [c1] is about entity [e1]",
        {
          ...CASE,
          entities: CASE.entities.filter((entity) => entity.id !== id("e1")),
          // Only c1 is about e1 here, so the case names exactly one problem.
          claims: CASE.claims.filter((claim) => !["[c2]", "[c3]"].includes(claim.id)),
        },
      ],
      [
        "DUPLICATE_ID: job [job A dns] evidence [ev1]",
        {
          ...CASE,
          jobs: CASE.jobs.map((job) =>
            job.id === dnsJob.id ? { ...job, evidenceIds: [id("ev1"), id("ev1"), id("ev2")] } : job,
          ),
        },
      ],
      [
        "FOUND_RESULT_NOT_RECORDED: job [job A wayback]",
        {
          ...CASE,
          jobs: CASE.jobs.map((job) =>
            job.id === id("job A wayback") ? { ...job, evidenceIds: null } : job,
          ),
        },
      ],
      [
        "JOB_AND_EXCLUSION: run [run A] collector dns",
        {
          ...CASE,
          runs: RUNS.map((run) =>
            run.id === id("run A") && run.plan.kind === "PLANNED"
              ? {
                  ...run,
                  plan: {
                    ...run.plan,
                    excluded: [
                      ...run.plan.excluded,
                      {
                        collectorId: "dns",
                        targetType: "DOMAIN",
                        reason: "LICENCE_BLOCKED",
                        message: "[test] blocked",
                      },
                    ],
                  },
                }
              : run,
          ),
        },
      ],
    ];
    for (const [expected, input] of cases) expect(problems(input)).toEqual([expected]);
  });

  it("accepts only real instants written as toISOString writes them", () => {
    expect(isIsoInstant("2026-09-01T10:00:00.000Z")).toBe(true);
    expect(isIsoInstant("2024-02-29T23:59:59.999Z")).toBe(true);
    for (const time of [
      "2026-02-29T00:00:00.000Z",
      "2026-02-30T00:00:00.000Z",
      "9999-99-99T99:99:99.999Z",
      "2026-13-01T00:00:00.000Z",
      "2026-09-01T24:00:00.000Z",
      "2026-09-01T10:00:60.000Z",
      "2026-09-01T10:00:00Z",
      "2026-09-01T10:00:00.000+00:00",
    ]) {
      expect(isIsoInstant(time)).toBe(false);
    }
  });

  it("refuses an omitted list with its own code, never reading it as empty", () => {
    const { held, ...withoutHeld } = CASE;
    expect(held.length).toBe(1);
    expect(problems(withoutHeld as CaseInput)).toEqual(["INPUT_MISSING: held"]);
  });

  it("refuses a strength or discipline outside core's vocabulary rather than dropping it", () => {
    const unknown = JSON.parse(JSON.stringify(CASE)) as CaseInput;
    const odd = {
      ...unknown,
      claims: unknown.claims.map((claim, index) =>
        index === 0 ? { ...claim, strength: "CONFIRMED" } : claim,
      ),
      registry: unknown.registry.map((entry, index) =>
        index === 0 ? { ...entry, discipline: "HUMINT" } : entry,
      ),
    } as unknown as CaseInput;
    expect(problems(odd)).toEqual([
      "STRENGTH_UNKNOWN: claim [c1]",
      "DISCIPLINE_UNKNOWN: registry collector dns",
    ]);
  });
});

// ── The previous codebase's defects (R1-INVENTORY.md REWRITE register) ─────

describe("regressions: cases/case-report.ts", () => {
  it("assessCompleteness: needs-credentials comes from a recorded outcome, never a declaration", () => {
    // Legacy gave every planned collector that declares credentials a
    // CREDENTIALS_REQUIRED reason, even when it produced evidence. The input
    // here cannot carry a declaration; the state is the job's outcome.
    const withCredentialFailure: CaseInput = {
      ...CASE,
      jobs: CASE.jobs.map((job) =>
        job.id === id("job A rdap")
          ? { ...job, outcome: "NEEDS_CREDENTIALS", lastErrorCode: "CREDENTIAL_MISSING" }
          : job,
      ),
    };
    const runA = coverage(withCredentialFailure).runs[0];
    expect(runA?.jobs.find((job) => job.collectorId === "dns")?.state).toBe("COLLECTED");
    expect(runA?.jobs.find((job) => job.collectorId === "rdap")?.state).toBe("NEEDS_CREDENTIALS");
  });

  it("assessCompleteness: a collector declaring credentials is still COLLECTED when it found something", () => {
    // The declaration legacy read, carried on the registry input: it must change nothing.
    const declaring = {
      ...CASE,
      registry: REGISTRY.map((entry) =>
        entry.id === "dns"
          ? {
              ...entry,
              requiresCredentials: true,
              credentials: { vaultIds: ["[vault]"], runsWithout: false },
            }
          : entry,
      ),
    };
    expect(coverage(declaring)).toEqual(coverage());
    expect(breakdown(declaring)).toEqual(breakdown());
    expect(coverage(declaring).runs[0]?.jobs.find((job) => job.collectorId === "dns")?.state).toBe(
      "COLLECTED",
    );
  });

  it("assessCompleteness: found nothing and failed are told apart", () => {
    // Legacy listed both as "silent".
    const groups = sectionOf(breakdown(), "TECHINT").collectors;
    expect(collectorIds(groups.foundNothing)).toEqual(["crt"]);
    expect(collectorIds(groups.failed)).toEqual(["rdap"]);
  });

  it("assessCompleteness and completenessHeadline: the plan is the one the run recorded", () => {
    // Legacy recomputed the plan from today's registry, so a collector added
    // since counted as planned and missing. "late" is registered now and is in
    // neither run's coverage nor its headline's count.
    const document = coverage();
    for (const run of document.runs) {
      expect(run.coverage.entries.map((entry) => entry.collectorId)).not.toContain("late");
    }
    expect(document.runs[1]?.coverage.headline).toBe(
      "COMPLETE RUN: all 2 planned collectors finished (1 found something, 1 found nothing). 1 further collector was excluded or held and did not run.",
    );
    expect(collectorIds(sectionOf(breakdown(), "TECHINT").collectors.notInAnyRun)).toEqual([
      "late",
    ]);
  });
});

describe("regressions: cases/case-intelligence-breakdown.ts", () => {
  it("buildCaseIntelligenceBreakdown: a missing GEOINT count is null with a reason, never 0", () => {
    // Legacy line 410 fell back to a literal zero when the GEOINT hypothesis
    // count was absent, so an unmeasured count read as a measured one.
    const geoint = sectionOf(breakdown(), "GEOINT");
    expect(geoint.metrics).toEqual([
      {
        metric: "LOCATION_HYPOTHESES",
        value: { count: null, ids: null, reason: "LOCATION_HYPOTHESES_NOT_BUILT" },
      },
    ]);
    expect(geoint.status).toBe("NOT_BUILT");
    expect(geoint.evidence).toEqual({ count: null, ids: null, reason: "NO_COLLECTOR_BUILT" });
    expect(geoint.claims.count).toBeNull();
    expect(geoint.entities.count).toBeNull();
    expect(geoint.relationships.count).toBeNull();
  });

  it("buildCaseIntelligenceBreakdown: a discipline no collector declares is NOT_BUILT", () => {
    // Legacy lines 450-451 filed it as "not case-scoped", as though a
    // capability existed and its output was elsewhere.
    const geoint = sectionOf(breakdown(), "GEOINT");
    expect(geoint.status).toBe("NOT_BUILT");
    expect(geoint.evidence).toEqual({ count: null, ids: null, reason: "NO_COLLECTOR_BUILT" });
    expect(geoint.collectors).toEqual({
      registered: [],
      ran: [],
      foundSomething: [],
      foundNothing: [],
      failed: [],
      notFinished: [],
      locked: [],
      excluded: [],
      notApplicable: [],
      held: [],
      notInAnyRun: [],
    });
  });

  it("buildCaseIntelligenceBreakdown: the further figures are not built, each null with its input", () => {
    // Legacy defaulted an unread media snapshot to "in the case" and showed its
    // claims and conflicts as counts. None of these inputs exists yet.
    const metrics = Object.fromEntries(
      breakdown().sections.map((section) => [section.discipline, section.metrics]),
    );
    expect(metrics).toEqual({
      TECHINT: [
        {
          metric: "CONTRADICTIONS",
          value: { count: null, ids: null, reason: "CONTRADICTION_DETECTION_NOT_BUILT" },
        },
      ],
      SOCMINT: [],
      MEDIAINT: [
        {
          metric: "MEDIA_CLAIMS",
          value: { count: null, ids: null, reason: "MEDIA_CLAIM_EXTRACTION_NOT_BUILT" },
        },
        {
          metric: "MEDIA_CONFLICTS",
          value: { count: null, ids: null, reason: "MEDIA_CLAIM_EXTRACTION_NOT_BUILT" },
        },
      ],
      GEOINT: [
        {
          metric: "LOCATION_HYPOTHESES",
          value: { count: null, ids: null, reason: "LOCATION_HYPOTHESES_NOT_BUILT" },
        },
      ],
      PERSON: [],
    });
  });

  it("BreakdownInput: every input is required, so nothing omitted can default to 'in the case'", () => {
    // Legacy `mediaEvidenceScoped?: boolean` defaulted to true and
    // `geointHypotheses?: number` to 0.
    const withoutHeld = {
      caseId: CASE.caseId,
      evidence: CASE.evidence,
      claims: CASE.claims,
      entities: CASE.entities,
      relationships: CASE.relationships,
      jobs: CASE.jobs,
      runs: CASE.runs,
      registry: CASE.registry,
    };
    // @ts-expect-error held is required: an omitted input must never default to a value.
    const incomplete: CaseInput = withoutHeld;
    // And at run time an omitted input is refused with its code; it is never read as empty.
    expect(() => caseBreakdown(incomplete)).toThrow(CaseInputError);
  });

  it("entitiesByCollectorId and relationshipsByCollectorId: attributed through claims' evidence", () => {
    // Legacy keyed entities on their own `source` (overwritten by entity
    // resolution) and relationships on a self-supplied `source` string.
    const byId = Object.fromEntries(
      collectors().collectors.map((collector) => [collector.collectorId, collector]),
    );
    expect(byId.dns?.entities.ids).toEqual(ids("e1", "e2"));
    expect(byId.gh?.entities.ids).toEqual(ids("e1"));
    expect(byId.gh?.relationships.ids).toEqual(ids("r1"));
    expect(byId.crt?.entities.ids).toEqual([]);
  });
});
