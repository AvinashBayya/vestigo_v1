/**
 * The DEV Community profile collector (KEEP of the previous codebase's Dev.to
 * presence check), run offline through the platform harness against DEV's
 * recorded answers for its staff account and a nonexistent username, with
 * synthetic fixtures only for conditions that cannot be provoked on demand.
 * The legacy check's tests asserted presence from a status code; these assert
 * the defects it had are gone.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  evidenceDrafts,
  InvalidTargetError,
  tenantRegistration,
  type CollectionOutcome,
} from "../../src/index.ts";
import { DEVTO_RESULT, devtoCollector } from "../../src/platform/devto.ts";
import { loadFixture, startHarness, type Fixture } from "./harness.ts";

const HOST = "dev.to";
const LABEL = "DEV Community profile";
const FOUND = loadFixture("devto", "user-thepracticaldev");

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

async function run(fixtures: readonly Fixture[], username: string) {
  const harness = await startHarness({ collectors: [devtoCollector], fixtures });
  try {
    const outcome = await harness.run("devto", { type: "USERNAME", value: username });
    return { outcome, harness };
  } finally {
    await harness.close();
  }
}

const RECORDED = z.object({
  id: z.number(),
  username: z.string(),
  name: z.string(),
  summary: z.string(),
  location: z.string(),
  website_url: z.string(),
  twitter_username: z.string(),
  github_username: z.null(),
  joined_at: z.string(),
});

describe("registration", () => {
  it("is labelled by the registry and reads only dev.to", async () => {
    const harness = await startHarness({ collectors: [devtoCollector], fixtures: [] });
    await harness.close();
    const entry = harness.runtime.registry.entry("devto");
    expect(entry.label).toBe(LABEL);
    expect(tenantRegistration(entry).sourceLabel).toBe(LABEL);
    expect(entry.source.network?.hosts).toEqual([HOST]);
    expect(entry.source.network?.rateLimit).not.toBeNull();
    expect(entry.commercialUse).toBe("UNVERIFIED");
    expect(entry).toMatchObject({
      discipline: "SOCMINT",
      targetTypes: ["USERNAME"],
      collectionMode: "PASSIVE_API",
      claimStrength: "REPORTED",
      credentials: { vaultIds: [], runsWithout: true },
    });
  });
});

describe("FOUND: the profile DEV returns for the exact username", () => {
  it("makes one V1 request for the username exactly as given", async () => {
    const { harness } = await run([FOUND], "thepracticaldev");
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests.map((r) => [r.host, r.path])).toEqual([[HOST, FOUND.request.path]]);
    expect(harness.requests[0]?.headers.accept).toBe("application/vnd.forem.api-v1+json");
  });

  it("reports the profile as DEV gave it, with empty strings as null", async () => {
    const { outcome } = await run([FOUND], "thepracticaldev");
    const result = DEVTO_RESULT.parse(expectStatus(outcome, "FOUND").result);
    const recorded = RECORDED.parse(JSON.parse(FOUND.response.body));
    expect(result.account).toMatchObject({
      username: recorded.username,
      devId: recorded.id,
      name: recorded.name,
      summary: recorded.summary,
      websiteUrl: recorded.website_url,
      twitterUsernameAsEntered: recorded.twitter_username,
      githubUsernameAsEntered: null,
    });
    // DEV sent location "": not measured as anything, so null, never "".
    expect(recorded.location).toBe("");
    expect(result.account.location).toBeNull();
  });

  it("keeps DEV's join date as its display text, never a parsed or invented timestamp", async () => {
    const { outcome } = await run([FOUND], "thepracticaldev");
    const result = DEVTO_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.account.joinedAsStated).toBe(
      RECORDED.parse(JSON.parse(FOUND.response.body)).joined_at,
    );
    expect(JSON.stringify(result)).not.toMatch(/joinedAt"|T\d\d:\d\d/);
  });

  it("cites the response byte for byte, dated by nothing DEV did not state", async () => {
    const { outcome, harness } = await run([FOUND], "thepracticaldev");
    const drafts = evidenceDrafts(
      harness.runtime.registry.entry("devto"),
      expectStatus(outcome, "FOUND"),
    );
    expect(drafts.map((d) => [d.sourceUrl, d.observedAt])).toEqual([
      [`https://${HOST}${FOUND.request.path}`, null],
    ]);
    expect(new TextDecoder().decode(drafts[0]?.payload)).toBe(FOUND.response.body);
  });

  it("a differently cased username still resolves to the same account", async () => {
    const upper: Fixture = {
      ...FOUND,
      request: { ...FOUND.request, path: "/api/users/by_username?url=ThePracticalDev" },
    };
    const { outcome } = await run([upper], "ThePracticalDev");
    expect(DEVTO_RESULT.parse(expectStatus(outcome, "FOUND").result).account.username).toBe(
      "thepracticaldev",
    );
  });
});

describe("regressions for the legacy check's defects", () => {
  it("never rewrites the handle: a username with whitespace is refused before any request", async () => {
    const harness = await startHarness({ collectors: [devtoCollector], fixtures: [] });
    try {
      await expect(
        (async () => harness.run("devto", { type: "USERNAME", value: "the practical dev" }))(),
      ).rejects.toBeInstanceOf(InvalidTargetError);
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("asks exactly one question: the handle, with no variations", async () => {
    const { harness } = await run(
      [loadFixture("devto", "user-nonexistent")],
      "qzxwv-placeholder-nonexistent-user",
    );
    expect(harness.requests.map((r) => r.path)).toEqual([
      "/api/users/by_username?url=qzxwv-placeholder-nonexistent-user",
    ]);
  });

  it("an answer for a different username is FAILED, never presented as the profile", async () => {
    const { outcome } = await run([loadFixture("devto", "user-other-username")], "thepracticaldev");
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it.each(["user-429", "user-503"])("%s is UNAVAILABLE, never read as no account", async (name) => {
    const { outcome } = await run([loadFixture("devto", name)], "thepracticaldev");
    expectStatus(outcome, "UNAVAILABLE");
  });
});

describe("statuses", () => {
  it("NOT_FOUND: DEV's recorded 404", async () => {
    const fixture = loadFixture("devto", "user-nonexistent");
    const { outcome } = await run([fixture], "qzxwv-placeholder-nonexistent-user");
    const notFound = expectStatus(outcome, "NOT_FOUND");
    expect(notFound.response.kind === "NETWORK" && notFound.response.status).toBe(404);
  });

  it("UNAVAILABLE: a 429 honours Retry-After", async () => {
    const { outcome } = await run([loadFixture("devto", "user-429")], "thepracticaldev");
    expect(expectStatus(outcome, "UNAVAILABLE").retryAfterMs).toBe(30_000);
  });

  it.each([
    ["user-403", "UPSTREAM_REFUSED"],
    ["user-wrong-shape", "UPSTREAM_RESPONSE_INVALID"],
    ["user-html", "UPSTREAM_RESPONSE_INVALID"],
  ] as const)("FAILED: %s", async (name, code) => {
    const { outcome } = await run([loadFixture("devto", name)], "thepracticaldev");
    expect(expectStatus(outcome, "FAILED").error.code).toBe(code);
  });

  it("REFUSED: a target type other than USERNAME never runs", async () => {
    const harness = await startHarness({ collectors: [devtoCollector], fixtures: [] });
    try {
      const outcome = await harness.run("devto", { type: "DOMAIN", value: "dev.to" });
      expect(expectStatus(outcome, "REFUSED").reason).toBe("TARGET_TYPE_NOT_ACCEPTED");
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});
