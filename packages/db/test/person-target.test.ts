/**
 * RELEASE-BLOCKING (CLAUDE.md §9; Track M D-M1, Day 1). A run on a person
 * target type (a TOPIC: free text that may name a person) rests on person data
 * whatever collects it. The run records that once, when it is created; the
 * database keeps the record true: the application cannot change it, a run that
 * chose a person target type cannot be recorded without it, and no job on a
 * person target type can sit in a run that lacks it. Each database rule is
 * checked against every target type, so it cannot drift from
 * PERSON_TARGET_TYPES in @repo/access.
 */
import { randomUUID } from "node:crypto";
import { PERSON_TARGET_TYPES } from "@repo/access";
import { TARGET_TYPES, type TargetType } from "@repo/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database.ts";
import { PersonTargetOutsidePersonRunError, ReferenceNotFoundError } from "../src/errors.ts";
import { TEST_DATABASE } from "./config.ts";
import {
  asTenant,
  createTenantFixture,
  openDatabase,
  rawClient,
  sqlStateOf,
  type TenantFixture,
} from "./support.ts";

let db: Database;
let tenant: TenantFixture;

beforeAll(async () => {
  db = openDatabase();
  tenant = await createTenantFixture(db, "person-target");
});

afterAll(async () => {
  await db.close();
});

const isPersonTargetType = (type: TargetType) => PERSON_TARGET_TYPES.includes(type);

/** A run on a new investigation of this target, created through the repository. */
async function createRun(target: string, requestedTargetType: TargetType | null) {
  return db.withTenant(tenant.tenantId, async ({ repos }) => {
    const investigation = await repos.investigations.create({
      title: "[person target run]",
      target,
      createdByUserId: tenant.userId,
    });
    return repos.runs.create({
      investigationId: investigation.id,
      status: "QUEUED",
      requestedByUserId: tenant.userId,
      requestedTargetType,
    });
  });
}

/** Runs one statement as the application role in the tenant; its SQLSTATE, or null. */
async function attemptAsApplication(statement: string, params: unknown[]): Promise<string | null> {
  const runtime = await rawClient(TEST_DATABASE.runtimeUrl);
  try {
    return await asTenant(runtime, tenant.tenantId, () =>
      sqlStateOf(() => runtime.query(statement, params)),
    );
  } finally {
    await runtime.end();
  }
}

describe("a run records whether it rests on a person target when it is created", () => {
  it("from the chosen type, or else detection's first answer, never from an alternate", async () => {
    const recorded = {
      chosenTopic: (await createRun("[a subject]", "TOPIC")).personBearing,
      hashtag: (await createRun("#elections", null)).personBearing,
      quotedPhrase: (await createRun('"a quoted phrase"', null)).personBearing,
      // Detection offers TOPIC as an alternate here; it is never planned, so the run is not one.
      wordsWithAlternate: (await createRun("[two words]", null)).personBearing,
      domain: (await createRun("example.com", null)).personBearing,
      chosenOtherType: (await createRun("#elections", "USERNAME")).personBearing,
    };
    expect(recorded).toEqual({
      chosenTopic: true,
      hashtag: true,
      quotedPhrase: true,
      wordsWithAlternate: false,
      domain: false,
      chosenOtherType: false,
    });
  });
});

describe("a run on an investigation this tenant does not hold", () => {
  it("fails on its foreign key, whatever type it chose, never on the record's check", async () => {
    for (const requestedTargetType of [null, "DOMAIN", "TOPIC"] as const) {
      const refused = db.withTenant(tenant.tenantId, ({ repos }) =>
        repos.runs.create({
          investigationId: randomUUID(),
          status: "QUEUED",
          requestedByUserId: tenant.userId,
          requestedTargetType,
        }),
      );
      await expect(refused, String(requestedTargetType)).rejects.toBeInstanceOf(
        ReferenceNotFoundError,
      );
      await expect(refused).rejects.toMatchObject({ constraint: "runs_investigation_fk" });
    }
  });
});

describe("the database keeps the record true (RELEASE-BLOCKING)", () => {
  it("the application role cannot change it, either way", async () => {
    const topicRun = await createRun("[a subject]", "TOPIC");
    const plainRun = await createRun("example.com", null);
    expect(
      await attemptAsApplication("update public.runs set person_bearing = false where id = $1", [
        topicRun.id,
      ]),
    ).toBe("42501");
    expect(
      await attemptAsApplication("update public.runs set person_bearing = true where id = $1", [
        plainRun.id,
      ]),
    ).toBe("42501");
  });

  it("refuses a run that chose a person target type without the record, for exactly those types", async () => {
    const runtime = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      const states = await asTenant(runtime, tenant.tenantId, async () => {
        const result: Record<string, string | null> = {};
        for (const type of TARGET_TYPES) {
          result[type] = await sqlStateOf(async () => {
            await runtime.query("savepoint s");
            try {
              await runtime.query(
                `insert into public.runs (tenant_id, investigation_id, status, requested_target_type, person_bearing)
                 values ($1, $2, 'QUEUED', $3, false)`,
                [tenant.tenantId, tenant.investigationId, type],
              );
            } finally {
              await runtime.query("rollback to savepoint s");
            }
          });
        }
        return result;
      });
      expect(states).toEqual(
        Object.fromEntries(
          TARGET_TYPES.map((type) => [type, isPersonTargetType(type) ? "23514" : null]),
        ),
      );
    } finally {
      await runtime.end();
    }
  });

  it("refuses a job on a person target type in a run without the record, for exactly those types", async () => {
    const plainRun = await createRun("example.com", null);
    const topicRun = await createRun("[a subject]", "TOPIC");
    const runtime = await rawClient(TEST_DATABASE.runtimeUrl);
    try {
      const statesIn = (runId: string) =>
        asTenant(runtime, tenant.tenantId, async () => {
          const result: Record<string, string | null> = {};
          for (const type of TARGET_TYPES) {
            result[type] = await sqlStateOf(async () => {
              await runtime.query("savepoint s");
              try {
                await runtime.query(
                  `insert into public.jobs (tenant_id, run_id, collector_id, idempotency_key, status, target_type, target)
                   values ($1, $2, $3, $4, 'QUEUED', $5, '[target]')`,
                  [
                    tenant.tenantId,
                    runId,
                    tenant.collectorId,
                    `person-target:${randomUUID()}`,
                    type,
                  ],
                );
              } finally {
                await runtime.query("rollback to savepoint s");
              }
            });
          }
          return result;
        });
      expect(await statesIn(plainRun.id)).toEqual(
        Object.fromEntries(
          TARGET_TYPES.map((type) => [type, isPersonTargetType(type) ? "PTT01" : null]),
        ),
      );
      // In a person-bearing run, a job on any type is accepted.
      expect(await statesIn(topicRun.id)).toEqual(
        Object.fromEntries(TARGET_TYPES.map((type) => [type, null])),
      );
    } finally {
      await runtime.end();
    }
  });

  it("reaches the application as a typed, coded error, never a bare database failure", async () => {
    const plainRun = await createRun("example.com", null);
    const refused = db.withTenant(tenant.tenantId, ({ repos }) =>
      repos.jobs.create({
        runId: plainRun.id,
        collectorId: tenant.collectorId,
        idempotencyKey: `person-target:${randomUUID()}`,
        status: "QUEUED",
        targetType: "TOPIC",
        target: "[a subject]",
      }),
    );
    await expect(refused).rejects.toBeInstanceOf(PersonTargetOutsidePersonRunError);
    await expect(refused).rejects.toMatchObject({ code: "PERSON_TARGET_OUTSIDE_PERSON_RUN" });
  });
});
