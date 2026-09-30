/**
 * The GitHub public profile collector (KEEP of the previous codebase's public
 * REST usage), run offline through the platform harness against recorded
 * GitHub answers for its demo account, with synthetic fixtures only for
 * conditions that cannot be provoked on demand. The legacy route code had no
 * tests of its own.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { evidenceDrafts, tenantRegistration, type CollectionOutcome } from "../../src/index.ts";
import {
  GITHUB_COMMITS_PER_PAGE,
  GITHUB_REPOSITORIES_PER_PAGE,
  GITHUB_RESULT,
  githubCollector,
} from "../../src/platform/github.ts";
import { loadFixture, startHarness, type Fixture } from "./harness.ts";

const HOST = "api.github.com";
const LABEL = "GitHub public profile";

const USER = loadFixture("github", "user-octocat");
const REPOS = loadFixture("github", "repos-octocat");
const COMMITS = loadFixture("github", "commits-octocat");
const FOUND_FIXTURES = [USER, REPOS, COMMITS];

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

async function run(fixtures: readonly Fixture[], login: string, key: string | null = null) {
  const harness = await startHarness({ collectors: [githubCollector], fixtures });
  try {
    const credentials = key === null ? new Map() : new Map([["github", { expose: () => key }]]);
    const outcome = await harness.run(
      "github",
      { type: "USERNAME", value: login },
      { credentials },
    );
    return { outcome, harness };
  } finally {
    await harness.close();
  }
}

const RECORDED_USER = z.object({
  login: z.string(),
  id: z.number(),
  type: z.string(),
  public_repos: z.number(),
  followers: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
const RECORDED_COMMITS = z.object({
  total_count: z.number(),
  items: z.array(z.object({ sha: z.string(), commit: z.object({ message: z.string() }) })),
});

describe("registration", () => {
  it("is labelled by the registry, reads only github-api under GitHub's stated limit, and takes an optional vault key", async () => {
    const harness = await startHarness({ collectors: [githubCollector], fixtures: [] });
    await harness.close();
    const entry = harness.runtime.registry.entry("github");
    expect(entry.label).toBe(LABEL);
    expect(tenantRegistration(entry).sourceLabel).toBe(LABEL);
    expect(entry.source.network?.hosts).toEqual([HOST]);
    expect(entry.source.network?.rateLimit).toMatchObject({
      requests: 60,
      intervalSeconds: 3600,
      basis: "UPSTREAM_STATED",
    });
    expect(entry.commercialUse).toBe("UNVERIFIED");
    expect(entry).toMatchObject({
      discipline: "SOCMINT",
      targetTypes: ["USERNAME"],
      collectionMode: "PASSIVE_API",
      claimStrength: "REPORTED",
      credentials: { vaultIds: ["github"], runsWithout: true },
    });
  });
});

describe("FOUND: the account, its repositories and its public commits", () => {
  it("makes exactly three requests for the exact login, and nothing else", async () => {
    const { harness } = await run(FOUND_FIXTURES, "octocat");
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests.map((r) => r.path)).toEqual(FOUND_FIXTURES.map((f) => f.request.path));
    expect(harness.requests.every((r) => r.host === HOST)).toBe(true);
  });

  it("reports the account exactly as GitHub gave it", async () => {
    const { outcome } = await run(FOUND_FIXTURES, "octocat");
    const result = GITHUB_RESULT.parse(expectStatus(outcome, "FOUND").result);
    const recorded = RECORDED_USER.parse(JSON.parse(USER.response.body));
    expect(result.account).toMatchObject({
      login: recorded.login,
      githubId: recorded.id,
      type: recorded.type,
      publicRepositories: recorded.public_repos,
      followers: recorded.followers,
      createdAt: recorded.created_at,
      updatedAt: recorded.updated_at,
    });
  });

  it("reports every repository GitHub listed, in its order, and says whether the list is partial", async () => {
    const { outcome } = await run(FOUND_FIXTURES, "octocat");
    const result = GITHUB_RESULT.parse(expectStatus(outcome, "FOUND").result);
    const recorded = z
      .array(z.object({ full_name: z.string() }))
      .parse(JSON.parse(REPOS.response.body));
    expect(result.repositories.items.map((r) => r.fullName)).toEqual(
      recorded.map((r) => r.full_name),
    );
    expect(result.derived.repositories.requested).toBe(GITHUB_REPOSITORIES_PER_PAGE);
    expect(result.derived.repositories.partial).toBe(false);
  });

  it("reports GitHub's own commit count and flags, and each commit's message as written", async () => {
    const { outcome } = await run(FOUND_FIXTURES, "octocat");
    const result = GITHUB_RESULT.parse(expectStatus(outcome, "FOUND").result);
    const recorded = RECORDED_COMMITS.parse(JSON.parse(COMMITS.response.body));
    expect(result.commits.totalCount).toBe(recorded.total_count);
    expect(result.derived.commits.requested).toBe(GITHUB_COMMITS_PER_PAGE);
    expect(result.commits.items.map((c) => [c.sha, c.message])).toEqual(
      recorded.items.map((item) => [item.sha, item.commit.message]),
    );
  });

  it("cites all three responses byte for byte, dated by nothing GitHub did not state", async () => {
    const { outcome, harness } = await run(FOUND_FIXTURES, "octocat");
    const drafts = evidenceDrafts(
      harness.runtime.registry.entry("github"),
      expectStatus(outcome, "FOUND"),
    );
    expect(drafts.map((d) => [d.sourceUrl, d.observedAt])).toEqual(
      FOUND_FIXTURES.map((f) => [`https://${HOST}${f.request.path}`, null]),
    );
    expect(drafts.map((d) => new TextDecoder().decode(d.payload))).toEqual(
      FOUND_FIXTURES.map((f) => f.response.body),
    );
  });
});

describe("the tenant's key, from the vault only", () => {
  it("sends no Authorization header without a key, and says so", async () => {
    const { outcome, harness } = await run(FOUND_FIXTURES, "octocat");
    expect(harness.requests.map((r) => r.headers.authorization)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(
      GITHUB_RESULT.parse(expectStatus(outcome, "FOUND").result).derived.requestedWithTenantKey,
    ).toBe(false);
  });

  it("sends the tenant's key on every request, never records it, and says it was used", async () => {
    const key = "ghp_[tenant test key]";
    const { outcome, harness } = await run(FOUND_FIXTURES, "octocat", key);
    expect(harness.requests.map((r) => r.headers.authorization)).toEqual([
      `Bearer ${key}`,
      `Bearer ${key}`,
      `Bearer ${key}`,
    ]);
    const found = expectStatus(outcome, "FOUND");
    expect(GITHUB_RESULT.parse(found.result).derived.requestedWithTenantKey).toBe(true);
    const drafts = evidenceDrafts(harness.runtime.registry.entry("github"), found);
    expect(JSON.stringify(drafts.map((d) => d.sourceUrl))).not.toContain(key);
  });
});

describe("statuses", () => {
  it("NOT_FOUND: GitHub's recorded 404 for the login, after one request", async () => {
    const fixture = loadFixture("github", "user-nonexistent");
    const { outcome, harness } = await run([fixture], "qzxwv-placeholder-nonexistent-login");
    const notFound = expectStatus(outcome, "NOT_FOUND");
    expect(notFound.response.kind === "NETWORK" && notFound.response.status).toBe(404);
    expect(harness.requests).toHaveLength(1);
  });

  it("UNAVAILABLE: an exhausted rate limit (403, none remaining) waits until GitHub's reset", async () => {
    const { outcome } = await run([loadFixture("github", "user-rate-limited")], "octocat");
    const unavailable = expectStatus(outcome, "UNAVAILABLE");
    expect(unavailable.error.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(unavailable.retryAfterMs).toBeGreaterThan(0);
  });

  it("UNAVAILABLE: a 429 honours Retry-After", async () => {
    const { outcome } = await run([loadFixture("github", "user-429")], "octocat");
    expect(expectStatus(outcome, "UNAVAILABLE").retryAfterMs).toBe(60_000);
  });

  it("UNAVAILABLE: a later request failing fails the whole collection; no partial profile", async () => {
    const { outcome, harness } = await run([USER, loadFixture("github", "repos-503")], "octocat");
    expectStatus(outcome, "UNAVAILABLE");
    expect(harness.requests).toHaveLength(2);
  });

  it.each([
    ["user-401", "UPSTREAM_REFUSED"],
    ["user-403", "UPSTREAM_REFUSED"],
    ["user-malformed", "UPSTREAM_RESPONSE_INVALID"],
  ] as const)("FAILED: %s", async (name, code) => {
    const { outcome } = await run([loadFixture("github", name)], "octocat");
    expect(expectStatus(outcome, "FAILED").error.code).toBe(code);
  });

  it("REFUSED: a target type other than USERNAME never runs", async () => {
    const harness = await startHarness({ collectors: [githubCollector], fixtures: [] });
    try {
      const outcome = await harness.run("github", { type: "DOMAIN", value: "github.com" });
      expect(expectStatus(outcome, "REFUSED").reason).toBe("TARGET_TYPE_NOT_ACCEPTED");
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});

describe("regression (Phase 3B review): secondary rate limits are UNAVAILABLE, not rejected", () => {
  it("a 403 with Retry-After and the secondary-limit message waits and retries", async () => {
    const { outcome } = await run([loadFixture("github", "user-secondary-rate-limit")], "octocat");
    expect(expectStatus(outcome, "UNAVAILABLE").retryAfterMs).toBe(60_000);
  });

  it("a 403 with only the secondary-limit message is UNAVAILABLE, with no invented wait", async () => {
    const { outcome } = await run(
      [loadFixture("github", "user-secondary-no-retry-after")],
      "octocat",
    );
    expect(expectStatus(outcome, "UNAVAILABLE").retryAfterMs).toBeNull();
  });
});

describe("regression (Phase 3B review): a refusal is a credentials failure only when a key was sent", () => {
  it("a 401 without a key is UPSTREAM_REFUSED", async () => {
    const { outcome } = await run([loadFixture("github", "user-401")], "octocat");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_REFUSED");
  });

  it("a 401 when the tenant's key was sent is UPSTREAM_REJECTED_CREDENTIALS", async () => {
    const { outcome } = await run(
      [loadFixture("github", "user-401")],
      "octocat",
      "ghp_[tenant test key]",
    );
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_REJECTED_CREDENTIALS");
  });
});
