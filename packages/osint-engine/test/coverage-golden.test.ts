/**
 * Golden files for the run report's coverage (R1-a, owner ruling D-1): the
 * exact output of coverageOf, coverageFromJob, headline, COVERAGE_CAVEATS and
 * displayValue over a fixed set of fixtures, compared byte for byte with the
 * files under test/golden/. They were written from the code as it stood before
 * the coverage functions moved to @repo/case-engine, so the move was proven to
 * change nothing.
 *
 * Rewritten since only by the owner's rulings, each in a commit of its own
 * whose golden diff holds that change and nothing else:
 *   - R1-a rulings (2026-10-09): displayValue(undefined) shows null instead of
 *     throwing, a cut no longer splits a character, and a run with no
 *     collector planned no longer reads "all 0 planned collectors finished";
 *   - R1-b pre-flight: a run that planned no collector, complete or failed,
 *     reads "NOTHING PLANNED", and one planned collector is singular;
 *   - Track M Day 2 (2026-10-15): a job may end EMPTY_UNCONFIRMED, its own
 *     coverage state, counted apart from "found nothing" with its caveat.
 *     Its rows are added after the ones already written, which do not change;
 *     the large run gains its 60 jobs, and so its name and headline.
 * Any other change needs the same: a ruling, its own commit, and the
 * rewritten files in its diff.
 *
 * A golden file is rewritten only by running this file with WRITE_GOLDEN=1,
 * and that run always fails, so no passing run ever wrote what it compared.
 * A rewritten golden file shows in review as a diff of the output itself.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CollectorRegistry,
  defineCollector,
  type HeldCollector,
  type SourceDeclaration,
} from "@repo/collectors";
import {
  JOB_OUTCOMES,
  JOB_STATUSES,
  RUN_STATUSES,
  type CoverageEntry,
  type JobOutcome,
  type JobStatus,
  type RunStatus,
  type TargetType,
} from "@repo/core";
import type { Job } from "@repo/db";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  COVERAGE_CAVEATS,
  coverageFromJob,
  coverageOf,
  displayValue,
  headline,
} from "../src/reports/assemble.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AT = new Date("2026-10-01T00:00:00.000Z");

/**
 * The job outcomes as the golden files were first written (R1-a), with null
 * after them, and then each outcome added since, in order: EMPTY_UNCONFIRMED
 * (Track M Day 2). A fixture's numbers come from its place in these lists, so
 * a new outcome adds rows to the golden files and changes none already there.
 */
const OUTCOMES_WRITTEN = 6;
const WRITTEN_OUTCOMES: readonly (JobOutcome | null)[] = [
  ...JOB_OUTCOMES.slice(0, OUTCOMES_WRITTEN),
  null,
];
const ADDED_OUTCOMES: readonly JobOutcome[] = JOB_OUTCOMES.slice(OUTCOMES_WRITTEN);
/** What a job says came back empty: a NOT_FOUND, or an answer that is unconfirmed. */
const SAYS_EMPTY: ReadonlySet<JobOutcome | null> = new Set(["NOT_FOUND", "EMPTY_UNCONFIRMED"]);

const SOURCE: SourceDeclaration = {
  id: "golden",
  name: "[Source golden]",
  access: ["open"],
  licence: {
    commercialUse: "PERMITTED",
    reason: "[test]",
    check: {
      checkedOn: "2026-10-01",
      sourceUrl: "https://example.com/terms",
      recordedIn: "[test]",
    },
  },
  network: {
    protocol: "https",
    hosts: ["golden.example"],
    rateLimit: { requests: 1, intervalSeconds: 1, basis: "SELF_IMPOSED", note: "[test]" },
    operators: [{ name: "fake", hosts: ["golden.example"] }],
  },
  attribution: null,
};

const RESULT = z.object({ names: z.array(z.string()), derived: z.object({}) });
const collector = (
  collectorId: string,
  displayName: string,
  targetTypes: TargetType[],
  mode: "PASSIVE_API" | "ACTIVE" = "PASSIVE_API",
) =>
  defineCollector(
    {
      id: collectorId,
      version: "1.0.0",
      displayName,
      discipline: "TECHINT",
      targetTypes,
      collectionMode: mode,
      source: SOURCE.id,
      credentials: { vaultIds: [], runsWithout: true },
      claimStrength: "REPORTED",
      timeoutMs: 1_000,
      resultSchema: RESULT,
    },
    () => Promise.reject(new Error("a golden fixture never runs a collector")),
  );

const registry = new CollectorRegistry({
  sources: [SOURCE],
  collectors: [
    collector("golden.dns", "[fake golden.dns]", ["DOMAIN"]),
    collector("golden.crt", "[fake golden.crt]", ["DOMAIN"]),
    collector("golden.whois", "[fake golden.whois]", ["DOMAIN", "IP_ADDRESS"]),
    collector("golden.user", "[fake golden.user]", ["USERNAME"]),
    collector("golden.active", "[fake golden.active]", ["DOMAIN"], "ACTIVE"),
    collector("golden.unicode", "[fake golden.unicode Zoë 東京 🛰️ ﬁ]", ["DOMAIN", "USERNAME"]),
  ],
});

const HELD: readonly HeldCollector[] = [
  {
    collector: collector("golden.held", "[fake golden.held]", ["USERNAME", "DOMAIN"]),
    reason: "[test] Held off the platform until [condition].",
  },
  {
    collector: collector("golden.held.file", "[fake golden.held.file]", ["FILE"]),
    reason: "[test] Held, and never applies to a domain.",
  },
  {
    collector: collector("golden.held.unicode", "[fake golden.held.unicode Ωmega]", ["DOMAIN"]),
    reason: "[test] Gehalten — 保留中 🛑 until [condition].",
  },
];

function job(n: number, fields: Partial<Job> & Pick<Job, "collectorId" | "status">): Job {
  return {
    tenantId: id(9000),
    id: id(n),
    runId: id(8000),
    idempotencyKey: `sha256:${String(n).padStart(64, "0")}`,
    attempts: 1,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: AT,
    startedAt: AT,
    finishedAt: AT,
    targetType: "DOMAIN",
    target: "example.com",
    params: {},
    outcome: null,
    outcomeDetail: null,
    result: null,
    evidenceIds: null,
    nextAttemptAt: null,
    deadLetteredAt: null,
    fusedAt: null,
    ...fields,
  };
}

const found = (n: number, collectorId: string, evidence: number): Job =>
  job(n, {
    collectorId,
    status: "SUCCEEDED",
    outcome: "FOUND",
    evidenceIds: Array.from({ length: evidence }, (_, i) => id(n * 100 + i)),
  });

const PLAN_DOMAIN = {
  input: "example.com",
  targets: [{ type: "DOMAIN", value: "example.com" }],
  jobs: [],
  excluded: [],
};

interface CoverageFixture {
  readonly name: string;
  readonly status: RunStatus;
  readonly plan: unknown;
  readonly jobs: readonly Job[];
  readonly held: readonly HeldCollector[];
}

const large = (): CoverageFixture => {
  const ids = ["golden.dns", "golden.crt", "golden.whois", "golden.active", "golden.unicode"];
  // Two rounds of every collector, status and outcome: 420 jobs as first
  // written, then 60 more for the outcome added since, after them.
  const combinations = [WRITTEN_OUTCOMES, ADDED_OUTCOMES].flatMap((outcomes) =>
    [0, 1].flatMap((round) =>
      JOB_STATUSES.flatMap((status: JobStatus) =>
        outcomes.flatMap((outcome) =>
          ids.map((collectorId) => ({ round, status, outcome, collectorId })),
        ),
      ),
    ),
  );
  const jobs = combinations.map(({ round, status, outcome, collectorId }, i) =>
    job(10_000 + i, {
      collectorId,
      status,
      outcome,
      attempts: (i + round) % 4,
      evidenceIds:
        outcome === "FOUND"
          ? Array.from({ length: i % 3 }, (_, k) => id(20_000 + i * 3 + k))
          : null,
      outcomeDetail: SAYS_EMPTY.has(outcome) ? `[detail ${String(i)}]` : null,
      lastErrorCode: status === "FAILED" || status === "DEAD_LETTERED" ? `ERR_${String(i)}` : null,
      lastErrorMessage:
        status === "FAILED" || status === "DEAD_LETTERED" ? `[error ${String(i)}]` : null,
    }),
  );
  return {
    name: "large run: 480 jobs over every status and outcome, 60 exclusions, an active collector",
    status: "PARTIAL",
    plan: {
      ...PLAN_DOMAIN,
      excluded: Array.from({ length: 60 }, (_, i) => ({
        collectorId: i % 2 === 0 ? `golden.excluded-${String(i)}` : "golden.user",
        targetType: i % 3 === 0 ? null : "DOMAIN",
        reason:
          i % 5 === 0
            ? "TARGET_TYPE_NOT_ACCEPTED"
            : i % 5 === 1
              ? "MODULE_NOT_IN_PLAN"
              : "LICENCE_BLOCKED",
        message: `[exclusion ${String(i)}]`,
      })),
    },
    jobs,
    held: HELD,
  };
};

const COVERAGE_FIXTURES: readonly CoverageFixture[] = [
  {
    name: "empty run: planned, nothing ran, nothing excluded",
    status: "SUCCEEDED",
    plan: PLAN_DOMAIN,
    jobs: [],
    held: [],
  },
  {
    name: "empty run: no valid target, so no held collector applies",
    status: "FAILED",
    plan: { ...PLAN_DOMAIN, targets: [{ type: "DOMAIN", invalid: "[not a domain]" }] },
    jobs: [],
    held: HELD,
  },
  {
    name: "empty run: the plan was not recorded",
    status: "QUEUED",
    plan: null,
    jobs: [],
    held: HELD,
  },
  {
    name: "empty run: the plan recorded an error",
    status: "FAILED",
    plan: { error: { code: "PLAN_FAILED", message: "[test] the target could not be detected" } },
    jobs: [],
    held: HELD,
  },
  {
    name: "a plan holding both an error and targets: the error decides",
    status: "FAILED",
    plan: { ...PLAN_DOMAIN, error: { code: "PLAN_FAILED", message: "[test] both" } },
    jobs: [found(1, "golden.dns", 1)],
    held: HELD,
  },
  {
    name: "a plan with no excluded list is not a recorded plan",
    status: "SUCCEEDED",
    plan: { targets: PLAN_DOMAIN.targets },
    jobs: [found(1, "golden.dns", 2)],
    held: HELD,
  },
  {
    name: "partial run: found, nothing found, failed, excluded, not applicable, held",
    status: "PARTIAL",
    plan: {
      ...PLAN_DOMAIN,
      excluded: [
        {
          collectorId: "golden.user",
          targetType: null,
          reason: "TARGET_TYPE_NOT_ACCEPTED",
          message: "[test] It accepts USERNAME.",
        },
        {
          collectorId: "golden.active",
          targetType: "DOMAIN",
          reason: "SCOPE_AUTHORISATION_REQUIRED",
          message: "[test] needs a scope authorisation",
        },
        {
          collectorId: "golden.whois",
          targetType: "DOMAIN",
          reason: "MODULE_NOT_IN_PLAN",
          message: "[test] module not in plan",
        },
      ],
    },
    jobs: [
      found(1, "golden.dns", 3),
      job(2, {
        collectorId: "golden.crt",
        status: "SUCCEEDED",
        outcome: "NOT_FOUND",
        outcomeDetail: "[test] no certificates",
      }),
      job(3, {
        collectorId: "golden.unicode",
        status: "FAILED",
        outcome: "UNAVAILABLE",
        attempts: 3,
        lastErrorCode: "UPSTREAM_TIMEOUT",
        lastErrorMessage: "[test] timed out",
      }),
    ],
    held: HELD,
  },
  {
    name: "failed collectors: credentials, refusal, failure, dead letter",
    status: "FAILED",
    plan: PLAN_DOMAIN,
    jobs: [
      job(1, {
        collectorId: "golden.dns",
        status: "FAILED",
        outcome: "NEEDS_CREDENTIALS",
        lastErrorCode: "CREDENTIAL_MISSING",
        lastErrorMessage: "[test] no credential stored",
      }),
      job(2, {
        collectorId: "golden.crt",
        status: "FAILED",
        outcome: "REFUSED",
        lastErrorCode: "UPSTREAM_REFUSED",
        lastErrorMessage: "[test] refused",
      }),
      job(3, {
        collectorId: "golden.whois",
        status: "FAILED",
        outcome: "FAILED",
        attempts: 5,
        lastErrorCode: "UPSTREAM_RESPONSE_INVALID",
        lastErrorMessage: "[test] invalid response",
      }),
      job(4, {
        collectorId: "golden.unicode",
        status: "DEAD_LETTERED",
        outcome: "UNAVAILABLE",
        attempts: 7,
        lastErrorCode: "UPSTREAM_UNAVAILABLE",
        lastErrorMessage: "[test] retries ran out",
        deadLetteredAt: AT,
      }),
    ],
    held: [],
  },
  {
    name: "held collector: applies through its second target type, once each",
    status: "SUCCEEDED",
    plan: {
      ...PLAN_DOMAIN,
      targets: [
        { type: "USERNAME", value: "[handle]" },
        { type: "DOMAIN", value: "example.com" },
      ],
    },
    jobs: [found(1, "golden.user", 1)],
    held: HELD,
  },
  {
    name: "nulls: every nullable field null, unfinished and cancelled jobs, an unregistered collector",
    status: "RUNNING",
    plan: {
      ...PLAN_DOMAIN,
      excluded: [
        {
          collectorId: "golden.gone",
          targetType: null,
          reason: "NOT_IMPLEMENTED",
          message: "[test] not implemented",
        },
      ],
    },
    jobs: [
      job(1, {
        collectorId: "golden.dns",
        status: "SUCCEEDED",
        outcome: null,
        targetType: null,
        target: null,
        startedAt: null,
        finishedAt: null,
        attempts: 0,
      }),
      job(2, { collectorId: "golden.crt", status: "QUEUED", attempts: 0, targetType: null }),
      job(3, { collectorId: "golden.whois", status: "RUNNING" }),
      job(4, { collectorId: "golden.unicode", status: "CANCELLED", outcome: "FOUND" }),
      job(5, { collectorId: "golden.gone", status: "FAILED", outcome: null }),
      job(6, {
        collectorId: "golden.removed",
        status: "SUCCEEDED",
        outcome: "FOUND",
        evidenceIds: [],
      }),
    ],
    held: HELD,
  },
  {
    name: "unicode: labels, details, messages and target values",
    status: "PARTIAL",
    plan: {
      ...PLAN_DOMAIN,
      targets: [{ type: "DOMAIN", value: "xn--bcher-kva.example" }],
      excluded: [
        {
          collectorId: "golden.active",
          targetType: "DOMAIN",
          reason: "SCOPE_AUTHORISATION_REQUIRED",
          message: "[test] Für «aktive» Sammlung — 需要授权 🔒",
        },
      ],
    },
    jobs: [
      found(1, "golden.unicode", 2),
      job(2, {
        collectorId: "golden.dns",
        status: "SUCCEEDED",
        outcome: "NOT_FOUND",
        outcomeDetail: "[test] Keine Einträge für bücher — 記録なし 🙅",
      }),
      job(3, {
        collectorId: "golden.crt",
        status: "FAILED",
        outcome: "FAILED",
        lastErrorCode: "UPSTREAM_RESPONSE_INVALID",
        lastErrorMessage: "[test] réponse invalide ‮ reversed \u0000 nul",
      }),
    ],
    held: HELD,
  },
  {
    name: "an active collector ran: the active caveat",
    status: "SUCCEEDED",
    plan: PLAN_DOMAIN,
    jobs: [found(1, "golden.active", 1)],
    held: [],
  },
  ...RUN_STATUSES.map((status): CoverageFixture => ({
    name: `run status ${status}, one found and one failed`,
    status,
    plan: PLAN_DOMAIN,
    jobs: [
      found(1, "golden.dns", 1),
      job(2, { collectorId: "golden.crt", status: "FAILED", outcome: "FAILED" }),
    ],
    held: [],
  })),
  large(),
];

const HEADLINE_ENTRY = (state: CoverageEntry["state"], attempts: number | null): CoverageEntry => ({
  collectorId: `golden.${state.toLowerCase()}`,
  sourceLabel: `[${state}]`,
  state,
  targetType: "DOMAIN",
  reasonCode: null,
  detail: null,
  evidenceCount: 0,
  attempts,
});

const HEADLINE_FIXTURES: readonly {
  readonly name: string;
  readonly status: RunStatus;
  readonly entries: readonly CoverageEntry[];
  readonly planError: string | null;
}[] = [
  ...RUN_STATUSES.map((status) => ({
    name: `${status}, no entries`,
    status,
    entries: [],
    planError: null,
  })),
  ...RUN_STATUSES.map((status) => ({
    name: `${status}, every state once`,
    status,
    entries: [
      HEADLINE_ENTRY("COLLECTED", 1),
      HEADLINE_ENTRY("NOTHING_FOUND", 1),
      HEADLINE_ENTRY("FAILED", 3),
      HEADLINE_ENTRY("NEEDS_CREDENTIALS", 1),
      HEADLINE_ENTRY("REFUSED", 1),
      HEADLINE_ENTRY("NOT_FINISHED", 0),
      HEADLINE_ENTRY("EXCLUDED", null),
      HEADLINE_ENTRY("HELD", null),
    ],
    planError: null,
  })),
  {
    name: "a plan error decides, whatever the status",
    status: "SUCCEEDED",
    entries: [HEADLINE_ENTRY("COLLECTED", 1)],
    planError: "[test] Ünïcödé — 計画 failed",
  },
  {
    name: "an empty plan error is still a plan error",
    status: "SUCCEEDED",
    entries: [],
    planError: "",
  },
  {
    name: "one excluded collector only",
    status: "SUCCEEDED",
    entries: [HEADLINE_ENTRY("EXCLUDED", null)],
    planError: null,
  },
];

const DISPLAY_VALUES: readonly { readonly name: string; readonly value: unknown }[] = [
  { name: "null", value: null },
  { name: "undefined", value: undefined },
  { name: "true", value: true },
  { name: "false", value: false },
  { name: "zero", value: 0 },
  { name: "negative zero", value: -0 },
  { name: "NaN", value: Number.NaN },
  { name: "Infinity", value: Number.POSITIVE_INFINITY },
  { name: "large number", value: 1.5e21 },
  { name: "fraction", value: 0.1 + 0.2 },
  { name: "empty string", value: "" },
  { name: "plain string", value: "[value]" },
  { name: "unicode string", value: "Zoë – 東京 🛰️ 👩‍👩‍👧 ﬁ ‮ reversed" },
  { name: "surrogate pair at the cut", value: "abcd🛰️efg" },
  { name: "long string", value: "[long] ".repeat(150) },
  { name: "empty array", value: [] },
  { name: "array of scalars and null", value: [1, "a", true, null, "東京"] },
  { name: "array with undefined", value: [undefined, 1] },
  { name: "array holding an object", value: [{ a: 1 }] },
  { name: "nested array", value: [[1, 2], 3] },
  { name: "empty object", value: {} },
  { name: "flat object, a null skipped", value: { a: 1, b: null, c: "x", d: false } },
  { name: "object with undefined", value: { a: undefined } },
  { name: "nested object", value: { nested: { deep: [1, "二"] }, list: [1, 2] } },
  { name: "unicode keys", value: { 名前: "東京", ключ: "значение" } },
];
const DISPLAY_LIMITS = [0, 1, 5, 600];

// ── Golden comparison ─────────────────────────────────────────────────────

function golden(file: string, output: unknown): void {
  const path = fileURLToPath(new URL(`./golden/${file}`, import.meta.url));
  const actual = `${JSON.stringify(output, null, 2)}\n`;
  if (process.env.WRITE_GOLDEN === "1") {
    writeFileSync(path, actual, "utf8");
    expect.fail(`${file} was written; run again without WRITE_GOLDEN to compare it.`);
  }
  expect(actual).toBe(readFileSync(path, "utf8"));
}

const outcomeOf = <T>(compute: () => T): { readonly output: T } | { readonly throws: string } => {
  try {
    return { output: compute() };
  } catch (error) {
    return { throws: error instanceof Error ? error.name : typeof error };
  }
};

describe("the run report's coverage, byte for byte against its golden files", () => {
  it("coverageOf, over every fixture", () => {
    golden(
      "coverage-of.json",
      COVERAGE_FIXTURES.map((fixture) => ({
        fixture: fixture.name,
        ...outcomeOf(() =>
          coverageOf(registry, fixture.status, fixture.plan, fixture.jobs, fixture.held),
        ),
      })),
    );
  });

  it("coverageFromJob, for every job status and outcome", () => {
    const outcomes = [...WRITTEN_OUTCOMES, ...ADDED_OUTCOMES];
    golden(
      "coverage-from-job.json",
      JOB_STATUSES.flatMap((status, s) =>
        outcomes.map((outcome, o) => {
          const fixture = job(s * 10 + o, {
            collectorId: "golden.dns",
            status,
            outcome,
            attempts: o,
            evidenceIds: o % 2 === 0 ? null : [id(1), id(2)],
            outcomeDetail: o % 3 === 0 ? null : `[detail ${String(o)}]`,
            lastErrorCode: o % 2 === 0 ? `ERR_${String(o)}` : null,
            lastErrorMessage: o % 2 === 0 ? `[error ${String(o)}] — ünïcödé` : null,
            targetType: o === 6 ? null : "DOMAIN",
          });
          return {
            fixture: `${status} with ${outcome ?? "no outcome"}`,
            ...outcomeOf(() => coverageFromJob(fixture, `[label ${String(o)}] 東京`)),
          };
        }),
      ),
    );
  });

  it("headline, for every run status and a plan error", () => {
    golden(
      "headline.json",
      HEADLINE_FIXTURES.map((fixture) => ({
        fixture: fixture.name,
        ...outcomeOf(() => headline(fixture.status, fixture.entries, fixture.planError)),
      })),
    );
  });

  it("COVERAGE_CAVEATS", () => {
    golden("coverage-caveats.json", COVERAGE_CAVEATS);
  });

  it("displayValue, for every value at every limit", () => {
    golden(
      "display-value.json",
      DISPLAY_VALUES.flatMap(({ name, value }) =>
        DISPLAY_LIMITS.map((limit) => ({
          fixture: `${name}, at most ${String(limit)} characters`,
          ...outcomeOf(() => displayValue(value, limit)),
        })),
      ),
    );
  });
});
