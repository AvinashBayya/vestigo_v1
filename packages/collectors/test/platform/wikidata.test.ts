/**
 * The Wikidata entity search collector (REWRITE, extracted from the previous
 * codebase's news route), run offline through the platform harness against
 * recorded Wikidata answers, with synthetic fixtures only for conditions that
 * cannot be provoked on demand. The legacy code had no tests of its own.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { evidenceDrafts, tenantRegistration, type CollectionOutcome } from "../../src/index.ts";
import {
  WIKIDATA_CANDIDATE_LIMIT,
  WIKIDATA_CANDIDATE_NOTE,
  WIKIDATA_RESULT,
  wikidataCollector,
} from "../../src/platform/wikidata.ts";
import { loadFixture, startHarness, type Fixture } from "./harness.ts";

const HOST = "www.wikidata.org";
const LABEL = "Wikidata entity search";
const IANA = "Internet Assigned Numbers Authority";
const NO_MATCH = "Qzxwv Placeholder Organisation Nonexistent";

const SEARCH = loadFixture("wikidata", "search-iana");
const ENTITIES = loadFixture("wikidata", "entities-iana");
const SEARCH_NO_MATCH = loadFixture("wikidata", "search-no-match");

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

async function run(fixtures: readonly Fixture[], name: string) {
  const harness = await startHarness({ collectors: [wikidataCollector], fixtures });
  try {
    const outcome = await harness.run("wikidata", { type: "ORGANIZATION", value: name });
    return { outcome, harness };
  } finally {
    await harness.close();
  }
}

async function found() {
  const { outcome, harness } = await run([SEARCH, ENTITIES], IANA);
  expect(harness.unmatched).toEqual([]);
  const outcomeFound = expectStatus(outcome, "FOUND");
  return { found: outcomeFound, result: WIKIDATA_RESULT.parse(outcomeFound.result), harness };
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  }
  return [];
}

/** Every string anywhere in a JSON value, with the key it sits under. */
function stringsOf(value: unknown, key = ""): { key: string; value: string }[] {
  if (typeof value === "string") return [{ key, value }];
  if (Array.isArray(value)) return value.flatMap((inner) => stringsOf(inner, key));
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([inner, v]) => stringsOf(v, inner));
  }
  return [];
}

const RECORDED_SEARCH = z.object({
  search: z.array(
    z.object({ id: z.string(), match: z.object({ type: z.string(), text: z.string() }) }),
  ),
});
const RECORDED_ENTITIES = z.object({
  entities: z.record(
    z.string(),
    z.object({
      modified: z.string(),
      labels: z.record(z.string(), z.object({ value: z.string() })),
      descriptions: z.record(z.string(), z.object({ value: z.string() })),
      claims: z.record(
        z.string(),
        z.array(z.object({ mainsnak: z.object({ snaktype: z.string() }) })),
      ),
    }),
  ),
});

describe("registration", () => {
  it("is labelled by the registry, reads only the wikidata source, and is PERMITTED on a recorded check", async () => {
    const harness = await startHarness({ collectors: [wikidataCollector], fixtures: [] });
    await harness.close();
    const entry = harness.runtime.registry.entry("wikidata");
    expect(entry.label).toBe(LABEL);
    expect(tenantRegistration(entry).sourceLabel).toBe(LABEL);
    expect(entry.source.id).toBe("wikidata");
    expect(entry.source.network?.hosts).toEqual([HOST]);
    expect(entry.commercialUse).toBe("PERMITTED");
    expect(entry.source.licence.check?.sourceUrl).toBe(
      "https://www.wikidata.org/wiki/Wikidata:Licensing",
    );
    expect(entry).toMatchObject({
      discipline: "SOCMINT",
      targetTypes: ["ORGANIZATION"],
      collectionMode: "PASSIVE_API",
      claimStrength: "REPORTED",
      credentials: { vaultIds: [], runsWithout: true },
    });
  });
});

describe("FOUND: the candidates Wikidata's search matched, as Wikidata states them", () => {
  it("runs one search for the exact name, then one read of exactly the candidates it returned", async () => {
    const { harness } = await found();
    expect(harness.requests.map((r) => [r.host, r.path])).toEqual([
      [HOST, SEARCH.request.path],
      [HOST, ENTITIES.request.path],
    ]);
    const search = new URLSearchParams(harness.requests[0]?.path.split("?")[1]);
    expect(search.get("search")).toBe(IANA);
    expect(search.get("limit")).toBe(String(WIKIDATA_CANDIDATE_LIMIT));
  });

  it("reports every candidate in the search's order, with its match, label, description, edit time and claims", async () => {
    const { result } = await found();
    const hits = RECORDED_SEARCH.parse(JSON.parse(SEARCH.response.body)).search;
    const entities = RECORDED_ENTITIES.parse(JSON.parse(ENTITIES.response.body)).entities;
    expect(result.candidates.map((c) => c.wikidataItemId)).toEqual(hits.map((h) => h.id));
    for (const [index, candidate] of result.candidates.entries()) {
      const hit = hits[index];
      const entity = entities[candidate.wikidataItemId];
      expect(candidate.matchedBy).toBe(hit?.match.type);
      expect(candidate.matchedText).toBe(hit?.match.text);
      expect(candidate.label).toBe(entity?.labels.en?.value);
      expect(candidate.description).toBe(entity?.descriptions.en?.value);
      expect(candidate.itemLastEditedAt).toBe(entity?.modified);
      expect(Object.keys(candidate.claims).sort()).toEqual(
        Object.keys(entity?.claims ?? {}).sort(),
      );
      for (const [property, statements] of Object.entries(candidate.claims)) {
        expect(statements).toHaveLength(entity?.claims[property]?.length ?? -1);
      }
    }
    expect(result.derived.search).toEqual({
      query: IANA,
      language: "en",
      limit: 5,
      moreMatchesExist: false,
    });
  });

  it("reports an unknown value as unknown, never filled in", async () => {
    const { result } = await found();
    const unknown = Object.values(result.candidates[0]?.claims ?? {})
      .flat()
      .filter((claim) => claim.snakType === "somevalue");
    expect(unknown.length).toBeGreaterThan(0);
    for (const claim of unknown) expect(claim.value).toBeNull();
  });

  it("cites both responses it read, byte for byte, dated by nothing Wikidata did not state", async () => {
    const { found: outcome, harness } = await found();
    const drafts = evidenceDrafts(harness.runtime.registry.entry("wikidata"), outcome);
    expect(drafts.map((d) => [d.sourceUrl, d.observedAt, d.claimStrength])).toEqual([
      [`https://${HOST}${SEARCH.request.path}`, null, "REPORTED"],
      [`https://${HOST}${ENTITIES.request.path}`, null, "REPORTED"],
    ]);
    expect(drafts.map((d) => new TextDecoder().decode(d.payload))).toEqual([
      SEARCH.response.body,
      ENTITIES.response.body,
    ]);
  });
});

describe("regressions: the legacy fabrications stay gone (docs/audit/REPORT.md)", () => {
  it("reports the QID as the Wikidata item id only, never as a registration or file number (news.tsx:1239)", async () => {
    const { result } = await found();
    const keys = keysOf(result).map((key) => key.toLowerCase());
    for (const forbidden of [
      "fileno",
      "file_no",
      "registration",
      "registrationnumber",
      "lei",
      "companynumber",
    ]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    // Outside Wikidata's own claims, a candidate's QID appears only as wikidataItemId.
    const withoutClaims = result.candidates.map((candidate) =>
      Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "claims")),
    );
    for (const candidate of result.candidates) {
      const holders = stringsOf(withoutClaims)
        .filter((entry) => entry.value === candidate.wikidataItemId)
        .map((entry) => entry.key);
      expect(new Set(holders)).toEqual(new Set(["wikidataItemId"]));
    }
    // Inside claims it appears only where Wikidata states a reference to that item.
    for (const claim of result.candidates.flatMap((c) => Object.values(c.claims).flat())) {
      const qids = stringsOf(claim.value).filter((entry) => /^Q\d+$/.test(entry.value));
      for (const qid of qids) {
        expect(qid.key).toBe("id");
        expect(claim.value?.type).toBe("wikibase-entityid");
      }
    }
  });

  it("asserts no status: nothing says Active, and there is no status field (news.tsx:1260-1265)", async () => {
    const { result } = await found();
    expect(keysOf(result).map((key) => key.toLowerCase())).not.toContain("status");
    expect(stringsOf(result).some((entry) => /^active$/i.test(entry.value))).toBe(false);
  });

  it("invents no headquarters: no address field, and a candidate without P159 has no such claim (news.tsx:1258)", async () => {
    const { result } = await found();
    const keys = keysOf(result).map((key) => key.toLowerCase());
    for (const forbidden of ["hq", "headquarters", "address", "jurisdiction"]) {
      expect(keys, forbidden).not.toContain(forbidden);
    }
    const organisation = result.candidates[0];
    expect(organisation?.claims.P159).toBeDefined();
    for (const document of result.candidates.slice(1)) expect(document.claims.P159).toBeUndefined();
    expect(stringsOf(result).some((entry) => /undisclosed/i.test(entry.value))).toBe(false);
  });

  it("presents matches as candidates, never as verified, and keeps every one (news.tsx:1451-1494)", async () => {
    const { result } = await found();
    expect(
      stringsOf(result).some((entry) => /verified/i.test(entry.value) && entry.key !== "value"),
    ).toBe(false);
    expect(result.derived.note).toBe(WIKIDATA_CANDIDATE_NOTE);
    // The organisation and four RFC documents that merely mention it: all five kept, none chosen.
    expect(result.candidates).toHaveLength(5);
    expect(result.candidates.map((c) => c.matchedBy)).toEqual([
      "label",
      "alias",
      "alias",
      "alias",
      "alias",
    ]);
    expect(keysOf(result)).not.toContain("profile");
  });

  it("searches only the exact name: no variations, no second search (news.tsx:1415-1505)", async () => {
    const { outcome, harness } = await run([SEARCH_NO_MATCH, SEARCH, ENTITIES], NO_MATCH);
    expectStatus(outcome, "NOT_FOUND");
    expect(harness.requests.map((r) => r.path)).toEqual([SEARCH_NO_MATCH.request.path]);
  });
});

describe("statuses", () => {
  it("NOT_FOUND: an empty search, recorded, cites that response", async () => {
    const { outcome, harness } = await run([SEARCH_NO_MATCH], NO_MATCH);
    expect(harness.unmatched).toEqual([]);
    const notFound = expectStatus(outcome, "NOT_FOUND");
    expect(notFound.response.kind === "NETWORK" && notFound.response.status).toBe(200);
    // Regression (Phase 3B review): the detail states the search language.
    expect(notFound.detail).toContain(`in language "en"`);
  });

  it.each([
    ["search-429", "UPSTREAM_UNAVAILABLE", 30_000],
    ["search-503", "UPSTREAM_UNAVAILABLE", null],
    ["search-maxlag", "UPSTREAM_UNAVAILABLE", 5_000],
  ] as const)(
    "UNAVAILABLE: %s is retryable, never 'no match'",
    async (name, code, retryAfterMs) => {
      const { outcome, harness } = await run([loadFixture("wikidata", name)], IANA);
      const unavailable = expectStatus(outcome, "UNAVAILABLE");
      expect(unavailable.error.code).toBe(code);
      expect(unavailable.retryAfterMs).toBe(retryAfterMs);
      expect(harness.requests).toHaveLength(1);
    },
  );

  it("UNAVAILABLE: the entity read failing after a good search is not a partial result", async () => {
    const { outcome } = await run([SEARCH, loadFixture("wikidata", "entities-503")], IANA);
    expect(expectStatus(outcome, "UNAVAILABLE").error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it.each([
    ["search-403", "UPSTREAM_REFUSED"],
    ["search-api-error", "UPSTREAM_RESPONSE_INVALID"],
    ["search-html", "UPSTREAM_RESPONSE_INVALID"],
    ["search-wrong-shape", "UPSTREAM_RESPONSE_INVALID"],
  ] as const)("FAILED: %s", async (name, code) => {
    const { outcome } = await run([loadFixture("wikidata", name)], IANA);
    expect(expectStatus(outcome, "FAILED").error.code).toBe(code);
  });

  it("FAILED: a searched item missing on read is reported, never guessed at or dropped", async () => {
    const { outcome } = await run([SEARCH, loadFixture("wikidata", "entities-missing")], IANA);
    expect(expectStatus(outcome, "FAILED").error.code).toBe("UPSTREAM_RESPONSE_INVALID");
  });

  it("REFUSED: a target type other than ORGANIZATION never runs", async () => {
    const harness = await startHarness({ collectors: [wikidataCollector], fixtures: [] });
    try {
      const outcome = await harness.run("wikidata", { type: "DOMAIN", value: "iana.org" });
      expect(expectStatus(outcome, "REFUSED").reason).toBe("TARGET_TYPE_NOT_ACCEPTED");
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});
