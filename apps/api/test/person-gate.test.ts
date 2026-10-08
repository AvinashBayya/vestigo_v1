/**
 * RELEASE-BLOCKING (CLAUDE.md §9). A read that holds person data is refused
 * whole, with the Locked detail, whenever the tenant's plan or vetting does
 * not allow person investigation. It is never thinned: no rows dropped, no
 * count lowered. Walked through the whole lifecycle: no plan, vetting
 * pending, approved, suspended.
 */
import { contentRef, ExplorationRepository, hashContent } from "@repo/db";
import type { TenantId } from "@repo/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createTestApi,
  openRunStream,
  provisionTestTenant,
  readyBrowser,
  setEntitlement,
  sseEvents,
  within,
  type Browser,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let tenantId: TenantId;
let browser: Browser;

interface Ids {
  personRun: string;
  mixedRun: string;
  cleanRun: string;
  notFoundRun: string;
  mixedCase: string;
  cleanCase: string;
  pinCase: string;
  personEntity: string;
  personTwin: string;
  mixedEntity: string;
  cleanEntity: string;
  cleanOther: string;
  personEvidence: string;
  personClaim: string;
  personRelationship: string;
  relationshipCase: string;
  cleanRelationship: string;
  personMerge: string;
  personMerged: string;
  personToMergeInto: string;
  personToMerge: string;
  cleanMerged: string;
  cleanToMergeInto: string;
  cleanToMerge: string;
  endCase: string;
  touchedCase: string;
  cleanWithPersonMerged: string;
  mergedIntoPersonRun: string;
  raceRun: string;
  cleanMergedAway: string;
  pairCleanSurvivor: string;
  pairPersonMerged: string;
  pairPersonSurvivor: string;
  pairCleanMerged: string;
  undoCleanSurvivorMerge: string;
  undoPersonSurvivorMerge: string;
  freshPersonSurvivor: string;
  freshPersonMerged: string;
  freshPersonMerge: string;
  lookaheadEntity: string;
  lookaheadPartner: string;
  pagedCase: string;
  endRelationship: string;
  bigCase: string;
  hubClean: string;
  hubPerson: string;
  raceEntity: string;
  raceRelationshipSource: string;
  raceRelationship: string;
}
let ids: Ids;

async function seed(tenant: TenantId, userId: string): Promise<Ids> {
  return api.db.withTenant(tenant, async ({ repos }) => {
    for (const [collectorId, discipline] of [
      ["fixture", "TECHINT"],
      ["fixture-person", "PERSON"],
    ] as const) {
      await repos.collectorsRegistry.register({
        collectorId,
        sourceLabel: `[${collectorId}]`,
        discipline,
        collectionMode: "LOCAL_ANALYSIS",
        dataLicence: "[not applicable: test fixture]",
        commercialUse: "UNVERIFIED",
        enabled: true,
        disabledReason: null,
      });
    }
    const makeRun = async (collectorId: string, tag: string) => {
      const investigation = await repos.investigations.create({
        title: `[${tag}]`,
        target: "example.com",
        createdByUserId: userId,
      });
      const run = await repos.runs.create({
        investigationId: investigation.id,
        status: "QUEUED",
        requestedByUserId: userId,
      });
      const job = await repos.jobs.create({
        runId: run.id,
        collectorId,
        idempotencyKey: `gate:${tag}:${run.id}`,
        status: "QUEUED",
      });
      const hash = hashContent(new TextEncoder().encode(`[payload ${tag} ${run.id}]`));
      const evidence = await repos.evidence.record({
        collectorId,
        collectorVersion: "0.0.0-test",
        jobId: job.id,
        sourceUrl: null,
        contentHash: hash,
        payloadRef: contentRef(tenant, hash),
        observedAt: null,
        collectedAt: new Date("2026-05-01T00:00:00Z"),
        claimStrength: "REPORTED",
      });
      return { runId: run.id, evidenceId: evidence.id };
    };
    const person = await makeRun("fixture-person", "person");
    const mixed = await makeRun("fixture", "mixed");
    const clean = await makeRun("fixture", "clean");

    // Person data: two entities with the same name, each claimed from person evidence.
    const personEntity = await repos.entities.create({ kind: "PERSON", displayName: "[Person A]" });
    const personTwin = await repos.entities.create({ kind: "PERSON", displayName: "[person a]" });
    const personClaim = await repos.claims.create({
      evidenceId: person.evidenceId,
      subject: { entityId: personEntity.id },
      attribute: "note",
      value: "[person claim]",
      strength: "REPORTED",
    });
    await repos.claims.create({
      evidenceId: person.evidenceId,
      subject: { entityId: personTwin.id },
      attribute: "note",
      value: "[person claim]",
      strength: "REPORTED",
    });

    // Mixed: collected by a non-person run, but also claimed from person evidence.
    const mixedEntity = await repos.entities.create({
      kind: "DOMAIN",
      displayName: "mixed.example.com",
    });
    await repos.claims.create({
      evidenceId: mixed.evidenceId,
      subject: { entityId: mixedEntity.id },
      attribute: "registrar",
      value: "[registrar]",
      strength: "REPORTED",
    });
    await repos.claims.create({
      evidenceId: person.evidenceId,
      subject: { entityId: mixedEntity.id },
      attribute: "note",
      value: "[from person evidence]",
      strength: "REPORTED",
    });

    // Clean: nothing here rests on person evidence.
    const cleanEntity = await repos.entities.create({
      kind: "DOMAIN",
      displayName: "clean.example.com",
    });
    const cleanOther = await repos.entities.create({
      kind: "DOMAIN",
      displayName: "www.clean.example.com",
    });
    const relationship = await repos.entityRelationships.create({
      sourceEntityId: cleanOther.id,
      targetEntityId: cleanEntity.id,
      kind: "subdomain_of",
    });
    await repos.claims.create({
      evidenceId: clean.evidenceId,
      subject: { entityId: cleanEntity.id },
      attribute: "registrar",
      value: "[registrar]",
      strength: "REPORTED",
    });
    await repos.claims.create({
      evidenceId: clean.evidenceId,
      subject: { relationshipId: relationship.id },
      attribute: "observed_in",
      value: "[dns]",
      strength: "REPORTED",
    });

    // A case that mixes person and non-person pins, and a case that is clean.
    const mixedCase = await repos.cases.create({
      title: "[mixed case]",
      description: null,
      createdByUserId: userId,
    });
    for (const target of [{ evidenceId: person.evidenceId }, { evidenceId: clean.evidenceId }]) {
      await repos.casePins.pin({
        caseId: mixedCase.id,
        target,
        pinnedByUserId: userId,
        note: null,
      });
    }
    const cleanCase = await repos.cases.create({
      title: "[clean case]",
      description: null,
      createdByUserId: userId,
    });
    for (const target of [{ evidenceId: clean.evidenceId }, { entityId: cleanEntity.id }]) {
      await repos.casePins.pin({
        caseId: cleanCase.id,
        target,
        pinnedByUserId: userId,
        note: null,
      });
    }
    // A settled run whose only job, a person collector's, found nothing: no
    // evidence was recorded, and the run is still person data.
    const notFoundInvestigation = await repos.investigations.create({
      title: "[not found]",
      target: "example.com",
      createdByUserId: userId,
    });
    const notFoundRun = await repos.runs.create({
      investigationId: notFoundInvestigation.id,
      status: "QUEUED",
      requestedByUserId: userId,
    });
    const notFoundJob = await repos.jobs.create({
      runId: notFoundRun.id,
      collectorId: "fixture-person",
      idempotencyKey: `gate:not-found:${notFoundRun.id}`,
      status: "QUEUED",
    });
    await repos.jobs.transition(notFoundJob.id, {
      status: "SUCCEEDED",
      outcome: "NOT_FOUND",
      outcomeDetail: "[the person source found nothing]",
      startedAt: new Date("2026-05-01T00:00:00Z"),
      finishedAt: new Date("2026-05-01T00:00:01Z"),
    });
    await repos.runs.transition(notFoundRun.id, {
      status: "SUCCEEDED",
      startedAt: new Date("2026-05-01T00:00:00Z"),
      finishedAt: new Date("2026-05-01T00:00:01Z"),
    });

    // A relationship between two technical entities, asserted only by person
    // evidence (from a run of its own, so the person run's scope is unchanged).
    const personRel = await makeRun("fixture-person", "person-relationship");
    const relSource = await repos.entities.create({
      kind: "DOMAIN",
      displayName: "rel.example.com",
    });
    const relTarget = await repos.entities.create({
      kind: "DOMAIN",
      displayName: "rel.example.net",
    });
    const personRelationship = await repos.entityRelationships.create({
      sourceEntityId: relSource.id,
      targetEntityId: relTarget.id,
      kind: "linked_to",
    });
    await repos.claims.create({
      evidenceId: personRel.evidenceId,
      subject: { relationshipId: personRelationship.id },
      attribute: "note",
      value: "[person claim]",
      strength: "REPORTED",
    });
    // A case whose only pin is that relationship: its ends and evidence are its content.
    const relationshipCase = await repos.cases.create({
      title: "[relationship case]",
      description: null,
      createdByUserId: userId,
    });
    await repos.casePins.pin({
      caseId: relationshipCase.id,
      target: { relationshipId: personRelationship.id },
      pinnedByUserId: userId,
      note: null,
    });
    // The clean case also pins the clean relationship.
    await repos.casePins.pin({
      caseId: cleanCase.id,
      target: { relationshipId: relationship.id },
      pinnedByUserId: userId,
      note: null,
    });

    // Merge decisions, each from a run of its own so no earlier scope changes. Person:
    // a pair already merged (listed, then undone) and a pair to merge. Clean: the same.
    const entityFrom = async (evidenceId: string, kind: "PERSON" | "DOMAIN", name: string) => {
      const entity = await repos.entities.create({ kind, displayName: name });
      await repos.claims.create({
        evidenceId,
        subject: { entityId: entity.id },
        attribute: "note",
        value: kind === "PERSON" ? "[person claim]" : "[technical claim]",
        strength: "REPORTED",
      });
      return entity.id;
    };
    const personMergeRun = await makeRun("fixture-person", "person-merge");
    const personSurvivor = await entityFrom(personMergeRun.evidenceId, "PERSON", "[Person M1]");
    const personMerged = await entityFrom(personMergeRun.evidenceId, "PERSON", "[Person M2]");
    const personToMergeInto = await entityFrom(personMergeRun.evidenceId, "PERSON", "[Person M3]");
    const personToMerge = await entityFrom(personMergeRun.evidenceId, "PERSON", "[Person M4]");
    const personMerge = await repos.entityMerges.merge({
      survivingEntityId: personSurvivor,
      mergedEntityId: personMerged,
      reason: "[analyst reason about Person M1 and Person M2]",
      confidence: 0.8,
      matchSignals: ["ANALYST_REVIEW"],
      decidedBy: { kind: "USER", userId },
    });
    const cleanMergeRun = await makeRun("fixture", "clean-merge");
    const cleanSurvivor = await entityFrom(cleanMergeRun.evidenceId, "DOMAIN", "m1.example.com");
    const cleanMerged = await entityFrom(cleanMergeRun.evidenceId, "DOMAIN", "m2.example.com");
    const cleanToMergeInto = await entityFrom(cleanMergeRun.evidenceId, "DOMAIN", "m3.example.com");
    const cleanToMerge = await entityFrom(cleanMergeRun.evidenceId, "DOMAIN", "m4.example.com");
    await repos.entityMerges.merge({
      survivingEntityId: cleanSurvivor,
      mergedEntityId: cleanMerged,
      reason: "[analyst reason about two hosts]",
      confidence: 0.8,
      matchSignals: ["ANALYST_REVIEW"],
      decidedBy: { kind: "USER", userId },
    });

    // A relationship whose own claims are technical, from a technical entity to a person
    // entity that rests only on person evidence; and a case pinning only that relationship.
    const endRun = await makeRun("fixture", "clean-end");
    const personEndRun = await makeRun("fixture-person", "person-end");
    const cleanEnd = await entityFrom(endRun.evidenceId, "DOMAIN", "end.example.com");
    const personEnd = await entityFrom(personEndRun.evidenceId, "PERSON", "[Person End]");
    const endRelationship = await repos.entityRelationships.create({
      sourceEntityId: cleanEnd,
      targetEntityId: personEnd,
      kind: "linked_to",
    });
    await repos.claims.create({
      evidenceId: endRun.evidenceId,
      subject: { relationshipId: endRelationship.id },
      attribute: "observed_in",
      value: "[technical claim]",
      strength: "REPORTED",
    });
    const pinOnly = async (
      title: string,
      target: { entityId: string } | { relationshipId: string },
    ) => {
      const created = await repos.cases.create({
        title,
        description: null,
        createdByUserId: userId,
      });
      await repos.casePins.pin({ caseId: created.id, target, pinnedByUserId: userId, note: null });
      return created.id;
    };
    const endCase = await pinOnly("[end case]", { relationshipId: endRelationship.id });
    // A case pinning an entity whose only provenance is a relationship claim from person evidence.
    const touchedCase = await pinOnly("[touched case]", { entityId: relSource.id });

    // Merges across the person line: a person-evidence entity merged into a technical one,
    // and a technical entity (from a run of its own) merged into a person-evidence one.
    const mergeCleanRun = await makeRun("fixture", "merge-clean");
    const mergePersonRun = await makeRun("fixture-person", "merge-person");
    const cleanWithPersonMerged = await entityFrom(
      mergeCleanRun.evidenceId,
      "DOMAIN",
      "w.example.com",
    );
    const personMergedIn = await entityFrom(mergePersonRun.evidenceId, "DOMAIN", "p.example.com");
    await repos.entityMerges.merge({
      survivingEntityId: cleanWithPersonMerged,
      mergedEntityId: personMergedIn,
      reason: "[analyst reason about w and p]",
      confidence: 0.6,
      matchSignals: ["ANALYST_REVIEW"],
      decidedBy: { kind: "USER", userId },
    });
    const mergedIntoPerson = await makeRun("fixture", "merged-into-person");
    const cleanMergedAway = await entityFrom(
      mergedIntoPerson.evidenceId,
      "DOMAIN",
      "w2.example.com",
    );
    const personSurvivor2 = await entityFrom(mergePersonRun.evidenceId, "DOMAIN", "p2.example.com");
    await repos.entityMerges.merge({
      survivingEntityId: personSurvivor2,
      mergedEntityId: cleanMergedAway,
      reason: "[analyst reason about w2 and p2]",
      confidence: 0.6,
      matchSignals: ["ANALYST_REVIEW"],
      decidedBy: { kind: "USER", userId },
    });

    // Merges with person evidence on one side only, in both directions: pairs to merge,
    // and merges to undo. A gate that probed one side of a merge would pass the others.
    const pairCleanRun = await makeRun("fixture", "pair-clean");
    const pairPersonRun = await makeRun("fixture-person", "pair-person");
    const pairClean = (name: string) => entityFrom(pairCleanRun.evidenceId, "DOMAIN", name);
    const pairPerson = (name: string) => entityFrom(pairPersonRun.evidenceId, "DOMAIN", name);
    const pairCleanSurvivor = await pairClean("pair-a.example.com");
    const pairPersonMerged = await pairPerson("pair-b.example.com");
    const pairPersonSurvivor = await pairPerson("pair-c.example.com");
    const pairCleanMerged = await pairClean("pair-d.example.com");
    const analystMerge = (survivingEntityId: string, mergedEntityId: string, reason: string) =>
      repos.entityMerges.merge({
        survivingEntityId,
        mergedEntityId,
        reason,
        confidence: 0.6,
        matchSignals: ["ANALYST_REVIEW"],
        decidedBy: { kind: "USER", userId },
      });
    const undoCleanSurvivorMerge = await analystMerge(
      await pairClean("undo-a.example.com"),
      await pairPerson("undo-b.example.com"),
      "[analyst reason about undo-a and undo-b]",
    );
    const undoPersonSurvivorMerge = await analystMerge(
      await pairPerson("undo-c.example.com"),
      await pairClean("undo-d.example.com"),
      "[analyst reason about undo-c and undo-d]",
    );
    // Fresh targets for the suspended stage only: a pair to merge and a merge to undo.
    const freshPersonSurvivor = await entityFrom(
      personMergeRun.evidenceId,
      "PERSON",
      "[Person M5]",
    );
    const freshPersonMerged = await entityFrom(personMergeRun.evidenceId, "PERSON", "[Person M6]");
    const freshPersonMerge = await analystMerge(
      await entityFrom(personMergeRun.evidenceId, "PERSON", "[Person M7]"),
      await entityFrom(personMergeRun.evidenceId, "PERSON", "[Person M8]"),
      "[analyst reason about Person M7 and Person M8]",
    );
    // A technical entity with a technical merge now, and (after the seed, so it sorts
    // later) one with a person-evidence entity: page one of its merges holds the first.
    const lookaheadEntity = await pairClean("ahead.example.com");
    await analystMerge(
      lookaheadEntity,
      await pairClean("ahead-1.example.com"),
      "[analyst reason about ahead and ahead-1]",
    );
    const lookaheadPartner = await pairPerson("ahead-2.example.com");
    // A case pinning a technical entity now; its relationship pin ending on person evidence
    // is added after the seed, so it sorts second.
    const pagedCase = await pinOnly("[paged case]", { entityId: cleanEntity.id });

    // A thousand claim-less entities: neighbours of two hubs, and pins of one case, so a
    // probe names more ids than one statement takes.
    const crowd: string[] = [];
    for (let index = 0; index < 1000; index += 1) {
      const entity = await repos.entities.create({
        kind: "DOMAIN",
        displayName: `crowd-${String(index)}.example.com`,
      });
      crowd.push(entity.id);
    }
    const hubClean = await pairClean("hub-clean.example.com");
    const hubPerson = await pairClean("hub-person.example.com");
    for (const neighbour of crowd) {
      for (const hub of [hubClean, hubPerson]) {
        await repos.entityRelationships.create({
          sourceEntityId: hub,
          targetEntityId: neighbour,
          kind: "linked_to",
        });
      }
    }
    // Merge ids follow the neighbours in the probe, so this one falls past the first thousand.
    await analystMerge(
      hubPerson,
      await pairPerson("hub-merged.example.com"),
      "[analyst reason about the hub]",
    );
    // The relationship pin first: the pinned entities' ids come first in the probe, so its
    // person-evidence end falls past the first thousand.
    const bigCase = await pinOnly("[big case]", { relationshipId: endRelationship.id });
    for (const entityId of crowd) {
      await repos.casePins.pin({
        caseId: bigCase,
        target: { entityId },
        pinnedByUserId: userId,
        note: null,
      });
    }

    // Technical, for the read-then-probe tests: a claim is added between probe and read.
    const raceEntity = await pairClean("race.example.com");
    // Its own two ends: the entity test leaves raceEntity holding person data.
    const raceRelationshipSource = await pairClean("race-source.example.com");
    const raceRelationship = await repos.entityRelationships.create({
      sourceEntityId: raceRelationshipSource,
      targetEntityId: await pairClean("race-target.example.com"),
      kind: "linked_to",
    });

    // An unplanned run with no jobs yet: unsettled, so its stream stays open and polls.
    const raceInvestigation = await repos.investigations.create({
      title: "[race]",
      target: "example.com",
      createdByUserId: userId,
    });
    const raceRun = await repos.runs.create({
      investigationId: raceInvestigation.id,
      status: "QUEUED",
      requestedByUserId: userId,
    });

    // Where pin attempts are aimed, so a pin that succeeds never pollutes the clean case.
    const pinCase = await repos.cases.create({
      title: "[pin attempts]",
      description: null,
      createdByUserId: userId,
    });
    return {
      pinCase: pinCase.id,
      personRun: person.runId,
      mixedRun: mixed.runId,
      cleanRun: clean.runId,
      notFoundRun: notFoundRun.id,
      mixedCase: mixedCase.id,
      cleanCase: cleanCase.id,
      personEntity: personEntity.id,
      personTwin: personTwin.id,
      mixedEntity: mixedEntity.id,
      cleanEntity: cleanEntity.id,
      cleanOther: cleanOther.id,
      personEvidence: person.evidenceId,
      personClaim: personClaim.id,
      personRelationship: personRelationship.id,
      relationshipCase: relationshipCase.id,
      cleanRelationship: relationship.id,
      personMerge: personMerge.id,
      personMerged,
      personToMergeInto,
      personToMerge,
      cleanMerged,
      cleanToMergeInto,
      cleanToMerge,
      endCase,
      touchedCase,
      cleanWithPersonMerged,
      mergedIntoPersonRun: mergedIntoPerson.runId,
      raceRun: raceRun.id,
      cleanMergedAway,
      pairCleanSurvivor,
      pairPersonMerged,
      pairPersonSurvivor,
      pairCleanMerged,
      undoCleanSurvivorMerge: undoCleanSurvivorMerge.id,
      undoPersonSurvivorMerge: undoPersonSurvivorMerge.id,
      freshPersonSurvivor,
      freshPersonMerged,
      freshPersonMerge: freshPersonMerge.id,
      lookaheadEntity,
      lookaheadPartner,
      pagedCase,
      endRelationship: endRelationship.id,
      bigCase,
      hubClean,
      hubPerson,
      raceEntity,
      raceRelationshipSource,
      raceRelationship: raceRelationship.id,
    };
  });
}

beforeAll(async () => {
  api = await createTestApi();
  const tenant = await provisionTestTenant(api, "gate");
  tenantId = tenant.tenantId;
  browser = await readyBrowser(api, tenant.owner, tenantId);
  ids = await seed(tenantId, tenant.ownerUserId);
  // Each in a transaction of its own, after the seed, so it sorts after what the seed made.
  await api.db.withTenant(tenantId, ({ repos }) =>
    repos.entityMerges.merge({
      survivingEntityId: ids.lookaheadEntity,
      mergedEntityId: ids.lookaheadPartner,
      reason: "[analyst reason about ahead and ahead-2]",
      confidence: 0.6,
      matchSignals: ["ANALYST_REVIEW"],
      decidedBy: { kind: "USER", userId: tenant.ownerUserId },
    }),
  );
  await api.db.withTenant(tenantId, ({ repos }) =>
    repos.casePins.pin({
      caseId: ids.pagedCase,
      target: { relationshipId: ids.endRelationship },
      pinnedByUserId: tenant.ownerUserId,
      note: null,
    }),
  );
});

afterAll(async () => {
  await api.close();
});

type Call = readonly [method: "GET" | "POST", path: () => string, body?: () => unknown];

/** Every gated read, aimed at something that rests on person data. */
const LOCKED_CALLS: Record<string, Call> = {
  "entities of a person run": ["GET", () => `/api/v1/entities?runId=${ids.personRun}`],
  "entities of a run whose entity also has person claims": [
    "GET",
    () => `/api/v1/entities?runId=${ids.mixedRun}`,
  ],
  "entities of a case mixing person and other pins": [
    "GET",
    () => `/api/v1/entities?caseId=${ids.mixedCase}`,
  ],
  "entity detail": ["GET", () => `/api/v1/entities/${ids.personEntity}`],
  "entity detail where only some claims are person": [
    "GET",
    () => `/api/v1/entities/${ids.mixedEntity}`,
  ],
  "merge candidates": ["GET", () => `/api/v1/entities/merge-candidates?runId=${ids.personRun}`],
  graph: ["GET", () => `/api/v1/graph?runId=${ids.personRun}`],
  "graph of a run whose entities have person claims": [
    "GET",
    () => `/api/v1/graph?runId=${ids.mixedRun}`,
  ],
  timeline: ["GET", () => `/api/v1/timeline?runId=${ids.personRun}`],
  "timeline of a case mixing person and other evidence": [
    "GET",
    () => `/api/v1/timeline?caseId=${ids.mixedCase}`,
  ],
  "pins of a case mixing person and other pins": [
    "GET",
    () => `/api/v1/cases/${ids.mixedCase}/pins`,
  ],
  "pinning person evidence": [
    "POST",
    () => `/api/v1/cases/${ids.pinCase}/pins`,
    () => ({ target: { type: "evidence", id: ids.personEvidence } }),
  ],
  "pinning a person claim": [
    "POST",
    () => `/api/v1/cases/${ids.pinCase}/pins`,
    () => ({ target: { type: "claim", id: ids.personClaim } }),
  ],
  "pinning a person entity": [
    "POST",
    () => `/api/v1/cases/${ids.pinCase}/pins`,
    () => ({ target: { type: "entity", id: ids.personEntity } }),
  ],
  "relationship asserted only by person evidence": [
    "GET",
    () => `/api/v1/relationships/${ids.personRelationship}`,
  ],
  "pinning a relationship asserted by person evidence": [
    "POST",
    () => `/api/v1/cases/${ids.pinCase}/pins`,
    () => ({ target: { type: "relationship", id: ids.personRelationship } }),
  ],
  "entities of a case whose pinned relationship rests on person evidence": [
    "GET",
    () => `/api/v1/entities?caseId=${ids.relationshipCase}`,
  ],
  "timeline of a case whose pinned relationship rests on person evidence": [
    "GET",
    () => `/api/v1/timeline?caseId=${ids.relationshipCase}`,
  ],
  "pins of a case whose pinned relationship rests on person evidence": [
    "GET",
    () => `/api/v1/cases/${ids.relationshipCase}/pins`,
  ],
  "graph of a case whose pinned relationship rests on person evidence": [
    "GET",
    () => `/api/v1/graph?caseId=${ids.relationshipCase}`,
  ],
  "run read of a person run": ["GET", () => `/api/v1/runs/${ids.personRun}`],
  "run read of a run whose person job found nothing": [
    "GET",
    () => `/api/v1/runs/${ids.notFoundRun}`,
  ],
  // Settled, so when allowed the stream ends by itself; refused here at connect.
  "progress stream of a run whose person job found nothing": [
    "GET",
    () => `/api/v1/runs/${ids.notFoundRun}/events`,
  ],
  "reports of a person run": ["GET", () => `/api/v1/runs/${ids.personRun}/reports`],
  "reports of a run whose person job found nothing": [
    "GET",
    () => `/api/v1/runs/${ids.notFoundRun}/reports`,
  ],
  // No evidence, so nothing person-derived to show; refused anyway, or an empty
  // answer here and a refusal for a run that found something would tell a
  // locked tenant what the person collector found.
  "entities of a run whose person job found nothing": [
    "GET",
    () => `/api/v1/entities?runId=${ids.notFoundRun}`,
  ],
  "timeline of a run whose person job found nothing": [
    "GET",
    () => `/api/v1/timeline?runId=${ids.notFoundRun}`,
  ],
  "graph of a run whose person job found nothing": [
    "GET",
    () => `/api/v1/graph?runId=${ids.notFoundRun}`,
  ],
  "merge candidates of a run whose person job found nothing": [
    "GET",
    () => `/api/v1/entities/merge-candidates?runId=${ids.notFoundRun}`,
  ],
  // REGRESSION (D-10): the three merge routes had no person gate.
  "merge decisions, when one involves person entities": ["GET", () => "/api/v1/entity-merges"],
  "merge decisions involving a person entity": [
    "GET",
    () => `/api/v1/entity-merges?entityId=${ids.personMerged}`,
  ],
  // It has no merges: "none" would still be an answer about a person entity.
  "merge decisions of a person entity that has none": [
    "GET",
    () => `/api/v1/entity-merges?entityId=${ids.personEntity}`,
  ],
  "merging two person entities": [
    "POST",
    () => "/api/v1/entity-merges",
    () => ({
      survivingEntityId: ids.personToMergeInto,
      mergedEntityId: ids.personToMerge,
      reason: "[analyst reason about Person M3 and Person M4]",
      confidence: 0.7,
      matchSignals: ["ANALYST_REVIEW"],
    }),
  ],
  // REGRESSION (D-10 audit): the case scope probe missed the entities a pin names.
  "pins of a case pinning a relationship whose end rests on person evidence": [
    "GET",
    () => `/api/v1/cases/${ids.endCase}/pins`,
  ],
  "pins of a case pinning an entity reached only by a person relationship": [
    "GET",
    () => `/api/v1/cases/${ids.touchedCase}/pins`,
  ],
  // REGRESSION (D-10 audit): merge partners were shown by id but never probed.
  "entity detail of a technical entity with a person-evidence entity merged into it": [
    "GET",
    () => `/api/v1/entities/${ids.cleanWithPersonMerged}`,
  ],
  "graph of a run whose entity is merged into a person-evidence entity": [
    "GET",
    () => `/api/v1/graph?runId=${ids.mergedIntoPersonRun}&hops=0`,
  ],
  "entities of a run whose entity is merged into a person-evidence entity": [
    "GET",
    () => `/api/v1/entities?runId=${ids.mergedIntoPersonRun}`,
  ],
  "entity detail of a technical entity merged into a person-evidence entity": [
    "GET",
    () => `/api/v1/entities/${ids.cleanMergedAway}`,
  ],
  // REGRESSION (D-10 review): a row past the page decides hasMore, and was never probed.
  "first page of a technical entity's merges, the next involving person evidence": [
    "GET",
    () => `/api/v1/entity-merges?entityId=${ids.lookaheadEntity}&limit=1`,
  ],
  // REGRESSION (D-10 review): every pin of the case is probed, not only this page's.
  "first page of a case's pins, the next ending on person evidence": [
    "GET",
    () => `/api/v1/cases/${ids.pagedCase}/pins?limit=1`,
  ],
  // REGRESSION (D-10 review): a probe naming over a thousand ids failed with a 500, and a
  // probe of the first thousand alone would miss what comes after.
  "pins of a case with over a thousand pins, one ending on person evidence": [
    "GET",
    () => `/api/v1/cases/${ids.bigCase}/pins`,
  ],
  "entity detail of an entity with over a thousand neighbours and a person-evidence entity merged into it":
    ["GET", () => `/api/v1/entities/${ids.hubPerson}`],
  // REGRESSION (D-10 review): each side of a merge is probed, whichever holds the person data.
  "merge decisions of a technical entity with a person-evidence entity merged into it": [
    "GET",
    () => `/api/v1/entity-merges?entityId=${ids.cleanWithPersonMerged}`,
  ],
  "merge decisions of a technical entity merged into a person-evidence entity": [
    "GET",
    () => `/api/v1/entity-merges?entityId=${ids.cleanMergedAway}`,
  ],
  "merging a person-evidence entity into a technical one": [
    "POST",
    () => "/api/v1/entity-merges",
    () => ({
      survivingEntityId: ids.pairCleanSurvivor,
      mergedEntityId: ids.pairPersonMerged,
      reason: "[analyst reason about pair-a and pair-b]",
      confidence: 0.7,
      matchSignals: ["ANALYST_REVIEW"],
    }),
  ],
  "merging a technical entity into a person-evidence one": [
    "POST",
    () => "/api/v1/entity-merges",
    () => ({
      survivingEntityId: ids.pairPersonSurvivor,
      mergedEntityId: ids.pairCleanMerged,
      reason: "[analyst reason about pair-c and pair-d]",
      confidence: 0.7,
      matchSignals: ["ANALYST_REVIEW"],
    }),
  ],
  "undoing a merge of a person-evidence entity into a technical one": [
    "POST",
    () => `/api/v1/entity-merges/${ids.undoCleanSurvivorMerge}/undo`,
    () => ({ reason: "[analyst reason for undoing]" }),
  ],
  "undoing a merge of a technical entity into a person-evidence one": [
    "POST",
    () => `/api/v1/entity-merges/${ids.undoPersonSurvivorMerge}/undo`,
    () => ({ reason: "[analyst reason for undoing]" }),
  ],
  "undoing a merge of person entities": [
    "POST",
    () => `/api/v1/entity-merges/${ids.personMerge}/undo`,
    () => ({ reason: "[analyst reason for undoing]" }),
  ],
};

/** Reads that rest on nothing but non-person evidence: never refused, never thinner. */
const CLEAN_CALLS: Record<string, Call> = {
  "entities of a clean run": ["GET", () => `/api/v1/entities?runId=${ids.cleanRun}`],
  "entities of a clean case": ["GET", () => `/api/v1/entities?caseId=${ids.cleanCase}`],
  "clean entity detail": ["GET", () => `/api/v1/entities/${ids.cleanEntity}`],
  "clean graph": ["GET", () => `/api/v1/graph?runId=${ids.cleanRun}&hops=1`],
  "clean timeline": ["GET", () => `/api/v1/timeline?runId=${ids.cleanRun}`],
  "clean merge candidates": [
    "GET",
    () => `/api/v1/entities/merge-candidates?runId=${ids.cleanRun}`,
  ],
  "pins of a clean case": ["GET", () => `/api/v1/cases/${ids.cleanCase}/pins`],
  "clean relationship detail": ["GET", () => `/api/v1/relationships/${ids.cleanRelationship}`],
  "graph of a clean case": ["GET", () => `/api/v1/graph?caseId=${ids.cleanCase}&hops=0`],
  "run read of a run with only technical jobs": ["GET", () => `/api/v1/runs/${ids.cleanRun}`],
  // Its entity has person claims from another run; the run's own jobs are technical.
  "run read of a run whose entity has person claims elsewhere": [
    "GET",
    () => `/api/v1/runs/${ids.mixedRun}`,
  ],
  "reports of a run with only technical jobs": [
    "GET",
    () => `/api/v1/runs/${ids.cleanRun}/reports`,
  ],
  "merge decisions involving a technical entity": [
    "GET",
    () => `/api/v1/entity-merges?entityId=${ids.cleanMerged}`,
  ],
  // REGRESSION (D-10 review): over a thousand ids in one probe answered 500 to a locked tenant.
  "entity detail of an entity with over a thousand technical neighbours": [
    "GET",
    () => `/api/v1/entities/${ids.hubClean}`,
  ],
};

const run = (call: Call) => browser.request(call[0], call[1](), call[2]?.());

/** What a clean read returns, to compare the same read in every state. */
async function cleanSnapshot(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, call] of Object.entries(CLEAN_CALLS)) {
    const response = await run(call);
    expect(response.status, name).toBe(200);
    out[name] = response.body;
  }
  return out;
}

/** The person merges' state: refused attempts must merge nothing and undo nothing. */
async function personMergeState(): Promise<{ merged: number; undone: boolean }> {
  return api.db.withTenant(tenantId, async ({ repos }) => ({
    merged: (await repos.entityMerges.listInvolving(ids.personToMerge, { limit: 10 })).length,
    undone: (await repos.entityMerges.findById(ids.personMerge))?.revertedAt !== null,
  }));
}

/** How many pins the pin-attempt case holds: refused attempts must add none. */
async function pinAttempts(): Promise<number> {
  const pins = await api.db.withTenant(tenantId, ({ repos }) =>
    repos.casePins.listForCase(ids.pinCase),
  );
  return pins.length;
}

function expectLocked(
  name: string,
  response: Awaited<ReturnType<typeof run>>,
  expected: { code: string; vettingStatus: string; plan: string },
) {
  expect(response.status, name).toBe(403);
  const problem = response.json<{
    code: string;
    detail: string;
    locked?: {
      module: string;
      moduleSummary: string;
      withheld: string;
      reason: string;
      plan: string;
      vettingStatus: string;
      nextStep: string;
    };
    items?: unknown;
    nodes?: unknown;
    entity?: unknown;
  }>();
  expect(problem.code, name).toBe(expected.code);
  expect(problem.locked, name).toMatchObject({
    module: "PERSON_INVESTIGATION",
    reason: expected.code,
    plan: expected.plan,
    vettingStatus: expected.vettingStatus,
  });
  // What is withheld, why, and the next step: each says something.
  expect(problem.locked?.withheld, name).toMatch(/.{11,}/);
  expect(problem.locked?.moduleSummary, name).toMatch(/.{11,}/);
  expect(problem.locked?.nextStep, name).toMatch(/.{11,}/);
  expect(problem.detail, name).toMatch(/nothing was returned/i);
  // Refused, not thinner: no result shape at all.
  expect(problem.items, name).toBeUndefined();
  expect(problem.nodes, name).toBeUndefined();
  expect(problem.entity, name).toBeUndefined();
  // And none of the person data leaks into the refusal.
  expect(response.body, name).not.toContain("[Person A]");
  expect(response.body, name).not.toContain("[person claim]");
  expect(response.body, name).not.toContain("[analyst reason");
  expect(response.body, name).not.toContain(ids.personMerge);
}

describe("the person-data gate across the lifecycle (RELEASE-BLOCKING)", () => {
  let approved: Record<string, string>;
  let approvedFull: Record<string, string>;
  let pinsWhenApproved = -1;

  it("no plan: every read that rests on person data is refused, Locked", async () => {
    // The tenant starts on the technical plan with vetting not submitted.
    for (const [name, call] of Object.entries(LOCKED_CALLS)) {
      expectLocked(name, await run(call), {
        code: "MODULE_NOT_IN_PLAN",
        vettingStatus: "NOT_SUBMITTED",
        plan: "TECHINT",
      });
    }
    expect(await pinAttempts()).toBe(0);
    expect(await personMergeState()).toEqual({ merged: 0, undone: false });
    approved = await cleanSnapshot();
  });

  it("plan includes the module, vetting pending: still refused, now for vetting", async () => {
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" });
    for (const [name, call] of Object.entries(LOCKED_CALLS)) {
      expectLocked(name, await run(call), {
        code: "VETTING_NOT_APPROVED",
        vettingStatus: "PENDING",
        plan: "TECHINT_AND_PERSON",
      });
    }
    expect(await pinAttempts()).toBe(0);
    expect(await personMergeState()).toEqual({ merged: 0, undone: false });
    expect(await cleanSnapshot()).toEqual(approved);
  });

  it("approved: the same reads return the whole result, person data included", async () => {
    await setEntitlement(tenantId, { vettingStatus: "APPROVED" });
    for (const [name, call] of Object.entries(LOCKED_CALLS)) {
      const response = await run(call);
      expect([200, 201], `${name}: ${response.body.slice(0, 200)}`).toContain(response.status);
    }
    const detail = await browser.request("GET", `/api/v1/entities/${ids.mixedEntity}`);
    expect(detail.json<{ entity: { claimCount: number } }>().entity.claimCount).toBe(2);
    const graph = await browser.request("GET", `/api/v1/graph?runId=${ids.personRun}&hops=0`);
    expect(graph.json<{ nodes: unknown[] }>().nodes).toHaveLength(3);
    expect(await cleanSnapshot()).toEqual(approved);
    approvedFull = {
      list: (await browser.request("GET", `/api/v1/entities?runId=${ids.mixedRun}`)).body,
      pins: (await browser.request("GET", `/api/v1/cases/${ids.mixedCase}/pins`)).body,
    };
    expect(approvedFull["pins"]).toContain('"type":"evidence"');
    pinsWhenApproved = await pinAttempts();
    // Evidence, a claim, an entity and a relationship.
    expect(pinsWhenApproved).toBe(4);
    // The merge routes, allowed, work as before: one merge made, the other undone.
    expect(await personMergeState()).toEqual({ merged: 1, undone: true });
    const merges = await browser.request("GET", "/api/v1/entity-merges");
    expect(merges.body).toContain("[analyst reason about Person M1 and Person M2]");
    expect(merges.body).toContain("[analyst reason about two hosts]");
  });

  it("suspended: the same reads are refused, never a thinner result", async () => {
    await setEntitlement(tenantId, { vettingStatus: "SUSPENDED" });
    for (const [name, call] of Object.entries(LOCKED_CALLS)) {
      expectLocked(name, await run(call), {
        code: "VETTING_NOT_APPROVED",
        vettingStatus: "SUSPENDED",
        plan: "TECHINT_AND_PERSON",
      });
    }
    // The repeated attempts were refused before the merge rules (403, not 409); the pins
    // they aimed at are unchanged.
    expect(await pinAttempts()).toBe(pinsWhenApproved);
    expect(await personMergeState()).toEqual({ merged: 1, undone: true });
    // Fresh targets show a refused merge and a refused undo change nothing.
    const locked = {
      code: "VETTING_NOT_APPROVED",
      vettingStatus: "SUSPENDED",
      plan: "TECHINT_AND_PERSON",
    } as const;
    expectLocked(
      "merging two fresh person entities",
      await browser.request("POST", "/api/v1/entity-merges", {
        survivingEntityId: ids.freshPersonSurvivor,
        mergedEntityId: ids.freshPersonMerged,
        reason: "[analyst reason about Person M5 and Person M6]",
        confidence: 0.7,
        matchSignals: ["ANALYST_REVIEW"],
      }),
      locked,
    );
    expectLocked(
      "undoing a fresh person merge",
      await browser.request("POST", `/api/v1/entity-merges/${ids.freshPersonMerge}/undo`, {
        reason: "[analyst reason for undoing]",
      }),
      locked,
    );
    const fresh = await api.db.withTenant(tenantId, async ({ repos }) => ({
      merged: (await repos.entityMerges.listInvolving(ids.freshPersonMerged, { limit: 10 })).length,
      revertedAt: (await repos.entityMerges.findById(ids.freshPersonMerge))?.revertedAt,
    }));
    expect(fresh).toEqual({ merged: 0, revertedAt: null });
    // An unsettled person run's stream is refused at connect: an ordinary 403, no stream.
    const stream = await browser.request("GET", `/api/v1/runs/${ids.personRun}/events`);
    expectLocked("progress stream of an unsettled person run", stream, {
      code: "VETTING_NOT_APPROVED",
      vettingStatus: "SUSPENDED",
      plan: "TECHINT_AND_PERSON",
    });
    expect(String(stream.headers["content-type"])).not.toMatch(/event-stream/);
  });

  it("suspended: reads that rest on no person data are unchanged, byte for byte", async () => {
    expect(await cleanSnapshot()).toEqual(approved);
  });

  it("suspended: nothing from the approved result is returned in part", async () => {
    // The mixed run held 2 claims about one entity; a suspended tenant gets a refusal,
    // not a list with a lower count or without the entity.
    const response = await browser.request("GET", `/api/v1/entities?runId=${ids.mixedRun}`);
    expect(response.status).toBe(403);
    expect(response.body).not.toContain("mixed.example.com");
    expect(response.body).not.toContain('"claimCount"');
    expect(approvedFull["list"]).toContain('"claimCount":2');
  });

  it("suspended: merging and undoing entities that rest on no person data still works", async () => {
    const made = await browser.request("POST", "/api/v1/entity-merges", {
      survivingEntityId: ids.cleanToMergeInto,
      mergedEntityId: ids.cleanToMerge,
      reason: "[analyst reason about two more hosts]",
      confidence: 0.7,
      matchSignals: ["ANALYST_REVIEW"],
    });
    expect(made.status, made.body).toBe(201);
    const undone = await browser.request(
      "POST",
      `/api/v1/entity-merges/${made.json<{ id: string }>().id}/undo`,
      { reason: "[checked again]" },
    );
    expect(undone.status, undone.body).toBe(200);
  });

  it("suspended: an API key still meets SESSION_REQUIRED on a merge, before the person gate", async () => {
    const issued = await browser.request("POST", "/api/v1/api-keys", {
      name: "[merge key]",
      permissions: ["case:write", "evidence:read"],
      expiresAt: null,
    });
    expect(issued.status).toBe(201);
    const { plaintext } = issued.json<{ plaintext: string }>();
    const call = (method: "GET" | "POST", url: string, body?: unknown) =>
      api.app.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${plaintext}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      });
    const made = await call("POST", "/api/v1/entity-merges", {
      survivingEntityId: ids.personToMergeInto,
      mergedEntityId: ids.personMerged,
      reason: "[a program's guess]",
      confidence: 0.9,
      matchSignals: ["ANALYST_REVIEW"],
    });
    expect(made.statusCode).toBe(403);
    expect(made.json<{ code: string }>().code).toBe("SESSION_REQUIRED");
    const undone = await call("POST", `/api/v1/entity-merges/${ids.personMerge}/undo`, {
      reason: "[a program's change of mind]",
    });
    expect(undone.statusCode).toBe(403);
    expect(undone.json<{ code: string }>().code).toBe("SESSION_REQUIRED");
    // Reading is not session-only: the key meets the person gate instead.
    const listed = await call("GET", "/api/v1/entity-merges");
    expect(listed.statusCode).toBe(403);
    expect(listed.json<{ code: string }>().code).toBe("VETTING_NOT_APPROVED");
    expect(listed.body).not.toContain("[analyst reason");
    expect(await personMergeState()).toEqual({ merged: 1, undone: true });
  });

  it("the refusals are audited as ALLOWED handler runs that failed, and name no data", async () => {
    const rows = await api.db.withTenant(tenantId, ({ repos }) =>
      repos.auditLog.recent({ limit: 500 }),
    );
    expect(rows.some((row) => row.action === "graph.read" && row.outcome === "FAILED")).toBe(true);
  });
});

describe("the run progress stream re-checks person-data access while open (RELEASE-BLOCKING)", () => {
  /** Opens the person run's stream while allowed, applies `change`, and returns its events. */
  async function streamThrough(change: () => Promise<void>) {
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" });
    // The person run is unsettled (QUEUED), so the stream stays open and keeps reading.
    const stream = await openRunStream(api, tenantId, ids.personRun, () =>
      browser.request("GET", `/api/v1/runs/${ids.personRun}/events`),
    );
    await change();
    const response = await within(stream.response, 10_000, "the stream closing after the change");
    expect(response.status).toBe(200);
    return sseEvents(response.body);
  }

  it("closes with a locked event, reason VETTING_NOT_APPROVED, when vetting is suspended mid-run", async () => {
    const events = await streamThrough(() =>
      setEntitlement(tenantId, { vettingStatus: "SUSPENDED" }),
    );
    // While allowed, it streamed the run and its person job.
    expect(events[0]?.event).toBe("run");
    expect(events.some((event) => event.event === "job")).toBe(true);
    // Then the re-check refused it, and it said so before closing: not an end, not a drop.
    const last = events.at(-1);
    expect(last?.event).toBe("locked");
    expect(events.some((event) => event.event === "end")).toBe(false);
    expect(last?.data).toMatchObject({
      reason: "VETTING_NOT_APPROVED",
      code: "VETTING_NOT_APPROVED",
      // The test API reads progress every 100 ms, and access is re-checked with every read.
      recheckIntervalMs: 100,
      locked: {
        module: "PERSON_INVESTIGATION",
        reason: "VETTING_NOT_APPROVED",
        plan: "TECHINT_AND_PERSON",
        vettingStatus: "SUSPENDED",
      },
    });
    expect(String(last?.data["detail"])).toMatch(/policy decision, not a dropped connection/);
    expect(Number.isNaN(Date.parse(String(last?.data["checkedAt"])))).toBe(false);
  });

  it("closes with a locked event, reason MODULE_NOT_IN_PLAN, when the plan loses the module mid-run", async () => {
    const events = await streamThrough(() => setEntitlement(tenantId, { plan: "TECHINT" }));
    const last = events.at(-1);
    expect(last?.event).toBe("locked");
    expect(last?.data).toMatchObject({
      reason: "MODULE_NOT_IN_PLAN",
      code: "MODULE_NOT_IN_PLAN",
      recheckIntervalMs: 100,
      locked: { reason: "MODULE_NOT_IN_PLAN", plan: "TECHINT", vettingStatus: "APPROVED" },
    });
    expect(String(last?.data["detail"])).toMatch(/policy decision, not a dropped connection/);
  });
});

describe("the run progress stream reads before it decides (RELEASE-BLOCKING)", () => {
  it("a person job committed between a poll's probe and its read never reaches a locked tenant", async () => {
    // REGRESSION (D-10 audit): each poll probed, then read. A person job the planner committed
    // between the two was streamed to a tenant whose access had just been withdrawn.
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with each instance as `this`
    const original = ExplorationRepository.prototype.touchesPersonData;
    let committed = false;
    const spy = vi
      .spyOn(ExplorationRepository.prototype, "touchesPersonData")
      .mockImplementation(async function (this: ExplorationRepository, probe) {
        const held = await original.call(this, probe);
        // Once, right after a locked poll's probe of the race run: the planner commits a job.
        if (!committed && probe.runJobs === ids.raceRun) {
          committed = true;
          await api.db.withTenant(tenantId, ({ repos }) =>
            repos.jobs.create({
              runId: ids.raceRun,
              collectorId: "fixture-person",
              idempotencyKey: `gate:race:${ids.raceRun}`,
              status: "QUEUED",
            }),
          );
        }
        return held;
      });
    try {
      const stream = await openRunStream(api, tenantId, ids.raceRun, () =>
        browser.request("GET", `/api/v1/runs/${ids.raceRun}/events`),
      );
      await setEntitlement(tenantId, { vettingStatus: "SUSPENDED" });
      const response = await within(stream.response, 10_000, "the stream closing after the change");
      expect(response.status).toBe(200);
      const events = sseEvents(response.body);
      expect(committed).toBe(true);
      // The person job was never streamed: the stream closed Locked instead.
      expect(events.filter((event) => event.event === "job")).toEqual([]);
      expect(response.body).not.toContain("fixture-person");
      expect(events.at(-1)?.event).toBe("locked");
    } finally {
      spy.mockRestore();
    }
  });

  /** Spies on the probe: right after a locked probe naming `id`, `commit` runs, once. */
  function commitAfterProbe(id: string, commit: () => Promise<unknown>) {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called below with each instance as `this`
    const original = ExplorationRepository.prototype.touchesPersonData;
    const state = { committed: false };
    const spy = vi
      .spyOn(ExplorationRepository.prototype, "touchesPersonData")
      .mockImplementation(async function (this: ExplorationRepository, probe) {
        const held = await original.call(this, probe);
        if (!state.committed && (probe.entityIds ?? []).includes(id)) {
          state.committed = true;
          await commit();
        }
        return held;
      });
    return { state, spy };
  }

  it("an entity read never returns a person claim committed between its read and its probe", async () => {
    // REGRESSION (D-10 review): the entity read probed, then read its claims.
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "SUSPENDED" });
    const { state, spy } = commitAfterProbe(ids.raceEntity, () =>
      api.db.withTenant(tenantId, ({ repos }) =>
        repos.claims.create({
          evidenceId: ids.personEvidence,
          subject: { entityId: ids.raceEntity },
          attribute: "note",
          value: "[late person claim]",
          strength: "REPORTED",
        }),
      ),
    );
    try {
      const response = await browser.request("GET", `/api/v1/entities/${ids.raceEntity}`);
      expect(state.committed).toBe(true);
      expect(response.body).not.toContain("[late person claim]");
    } finally {
      spy.mockRestore();
    }
    // Once committed, the claim is person data on the entity, and the next read is refused.
    const next = await browser.request("GET", `/api/v1/entities/${ids.raceEntity}`);
    expect(next.status).toBe(403);
  });

  it("a relationship read never returns a person claim committed between its read and its probe", async () => {
    // REGRESSION (D-10 review): the relationship read probed, then read its claims.
    await setEntitlement(tenantId, { plan: "TECHINT_AND_PERSON", vettingStatus: "SUSPENDED" });
    const { state, spy } = commitAfterProbe(ids.raceRelationshipSource, () =>
      api.db.withTenant(tenantId, ({ repos }) =>
        repos.claims.create({
          evidenceId: ids.personEvidence,
          subject: { relationshipId: ids.raceRelationship },
          attribute: "note",
          value: "[late person claim]",
          strength: "REPORTED",
        }),
      ),
    );
    try {
      const response = await browser.request(
        "GET",
        `/api/v1/relationships/${ids.raceRelationship}`,
      );
      expect(state.committed).toBe(true);
      expect(response.body).not.toContain("[late person claim]");
    } finally {
      spy.mockRestore();
    }
    const next = await browser.request("GET", `/api/v1/relationships/${ids.raceRelationship}`);
    expect(next.status).toBe(403);
  });
});
