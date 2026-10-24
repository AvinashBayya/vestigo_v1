/**
 * The direct article collector (exact-article Stage 3), run offline through the
 * platform harness against synthetic HTML fixtures — no real publisher is ever
 * contacted. It pins the whole secure exact-article path end to end: an ACTIVE,
 * open-host, UNVERIFIED collector reaches the one authorised host over the
 * SSRF-hardened fetch, the raw bytes become canonical evidence (the URL, the
 * stated publication time, the bytes whose hash is the content-addressed key,
 * the registry's own source label), and everything the extractor parsed is
 * derived, never quoted as the source's own.
 *
 * Fail-closed is pinned four ways: no scope authorisation refuses before any
 * request; a scope authorisation for a different URL refuses (the gate binds the
 * exact target); a redirect off the authorised host is refused without ever
 * connecting to it; and the UNVERIFIED source never runs in a deployment, even
 * with a scope authorisation in force. A non-HTML 200 is a failure, and a page
 * with nothing readable is reported not found — neither is ever a false FOUND.
 */
import { describe, expect, it } from "vitest";
import { evidenceDrafts, type CollectionOutcome, type ScopeClearance } from "../../src/index.ts";
import { ARTICLE_RESULT, articleCollector } from "../../src/platform/article.ts";
import { loadFixture, startHarness, type Fixture } from "./harness.ts";

const HOST = "news.example.com";
const LABEL = "Direct article fetch";

const urlTarget = (value: string) => ({ type: "URL" as const, value });
const clearanceFor = (value: string): ScopeClearance => ({
  id: `scope:${value}`,
  targetType: "URL",
  target: value,
});

const ARTICLE = urlTarget("https://news.example.com/world/story-1");

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

async function runFor(
  target: { readonly type: "URL"; readonly value: string },
  fixtures: readonly Fixture[],
  overrides: Parameters<Awaited<ReturnType<typeof startHarness>>["run"]>[2] = {},
) {
  const harness = await startHarness({ collectors: [articleCollector], fixtures });
  try {
    const outcome = await harness.run("article", target, overrides);
    return { outcome, harness };
  } finally {
    await harness.close();
  }
}

describe("the direct article collector, offline", () => {
  it("fetches the exact authorised article, extracts it, and cites the bytes as canonical evidence", async () => {
    const fixture = loadFixture("article", "found");
    const { outcome, harness } = await runFor(ARTICLE, [fixture], {
      scopeAuthorisation: clearanceFor(ARTICLE.value),
    });
    const found = expectStatus(outcome, "FOUND");
    const result = ARTICLE_RESULT.parse(found.result);

    // The one REPORTED value is the raw <title>, a verbatim fragment of the
    // bytes (its entity left undecoded); every parsed value is derived.
    expect(result.headline).toBe("Placeholder headline for an offline test &amp; nothing real");
    expect(result.derived).toEqual({
      url: ARTICLE.value,
      outletDomain: HOST,
      dedupKey: ARTICLE.value,
      canonicalUrl: "https://news.example.com/world/story-1",
      title: "Placeholder headline for an offline test & nothing real",
      author: "[Placeholder Byline]",
      language: "en",
      publishedAt: "2026-10-20T09:30:00.000Z",
      extractionStatus: "FULL_TEXT",
      // The readable body text is now retained (M4-2); this fixture's prose
      // states no identifier, so there are no mentions.
      bodyText:
        "Placeholder headline\nThis is the first placeholder paragraph of an article used only for an offline test. It contains no real reporting.\nA second placeholder paragraph, also invented for the test.",
      bodyTextTruncated: false,
      mentions: [],
    });

    // Canonical evidence: the article URL, the stated publication time, the
    // bytes (their hash the content-addressed key), labelled by the registry.
    const drafts = evidenceDrafts(harness.runtime.registry.entry("article"), found);
    expect(
      drafts.map((d) => [d.sourceUrl, d.observedAt?.toISOString() ?? null, d.claimStrength]),
    ).toEqual([[ARTICLE.value, "2026-10-20T09:30:00.000Z", "REPORTED"]]);
    expect(drafts.map((d) => new TextDecoder().decode(d.payload))).toEqual([fixture.response.body]);
    expect(harness.runtime.registry.entry("article").label).toBe(LABEL);
    expect(harness.unmatched).toEqual([]);
  });

  it("retains the body text and extracts the identifiers its prose states, with exact spans (M4-2)", async () => {
    const target = urlTarget("https://news.example.com/contact-story");
    const { outcome } = await runFor(target, [loadFixture("article", "with-mentions")], {
      scopeAuthorisation: clearanceFor(target.value),
    });
    const result = ARTICLE_RESULT.parse(expectStatus(outcome, "FOUND").result);
    const { bodyText, mentions } = result.derived;
    expect(result.derived.extractionStatus).toBe("FULL_TEXT");
    expect(result.derived.bodyTextTruncated).toBe(false);
    expect(bodyText).toContain("Reach the press desk");
    // Only the unambiguous identifiers, in text order; nothing else from the prose.
    expect(mentions.map((mention) => [mention.kind, mention.value])).toEqual([
      ["EMAIL_ADDRESS", "press@example.com"],
      ["URL", "https://report.example.org/doc-1"],
    ]);
    // Every span resolves back to its value in the retained text: grounded, not invented.
    for (const mention of mentions) {
      expect(bodyText.slice(mention.start, mention.end)).toBe(mention.value);
    }
  });

  it("retains an empty body and no mentions for a metadata-only page (M4-2)", async () => {
    const target = urlTarget("https://news.example.com/brief");
    const { outcome } = await runFor(target, [loadFixture("article", "metadata-only")], {
      scopeAuthorisation: clearanceFor(target.value),
    });
    const result = ARTICLE_RESULT.parse(expectStatus(outcome, "FOUND").result);
    expect(result.derived.extractionStatus).toBe("METADATA_ONLY");
    expect(result.derived.bodyText).toBe("");
    expect(result.derived.mentions).toEqual([]);
  });

  it("is fail-closed: with no scope authorisation it is refused before anything is fetched", async () => {
    const { outcome, harness } = await runFor(ARTICLE, [loadFixture("article", "found")]);
    expect(expectStatus(outcome, "REFUSED").reason).toBe("SCOPE_AUTHORISATION_REQUIRED");
    expect(harness.requests).toEqual([]);
  });

  it("binds to the exact target: a scope authorisation for a different URL is refused", async () => {
    const { outcome, harness } = await runFor(ARTICLE, [loadFixture("article", "found")], {
      scopeAuthorisation: clearanceFor("https://news.example.com/world/story-2"),
    });
    expect(expectStatus(outcome, "REFUSED").reason).toBe("SCOPE_AUTHORISATION_REQUIRED");
    expect(harness.requests).toEqual([]);
  });

  it("never runs in a deployment: an unverified source is refused even with a scope authorisation", async () => {
    const harness = await startHarness({
      collectors: [articleCollector],
      fixtures: [loadFixture("article", "found")],
      allowUnverifiedSources: false,
    });
    try {
      const outcome = await harness.run("article", ARTICLE, {
        scopeAuthorisation: clearanceFor(ARTICLE.value),
      });
      expect(expectStatus(outcome, "REFUSED").reason).toBe("UNVERIFIED_SOURCE_NOT_ALLOWED");
      expect(harness.requests).toEqual([]);
    } finally {
      await harness.close();
    }
  });

  it("refuses a redirect off the one authorised host, never connecting to it", async () => {
    const target = urlTarget("https://news.example.com/redirecting");
    const { outcome, harness } = await runFor(
      target,
      [loadFixture("article", "offsite-redirect")],
      {
        scopeAuthorisation: clearanceFor(target.value),
      },
    );
    const failed = expectStatus(outcome, "FAILED");
    expect(failed.error.code).toBe("DESTINATION_REFUSED");
    expect(harness.requests.map((request) => request.host)).not.toContain("evil.example");
  });

  it("does not treat a non-HTML 200 as an article", async () => {
    const target = urlTarget("https://news.example.com/data");
    const { outcome } = await runFor(target, [loadFixture("article", "not-html")], {
      scopeAuthorisation: clearanceFor(target.value),
    });
    const failed = expectStatus(outcome, "FAILED");
    expect(failed.error.code).toBe("UPSTREAM_RESPONSE_INVALID");
    expect(failed.error.message).toContain("not an HTML article");
  });

  it("reports not found when a fetched page is not readable as an article", async () => {
    const target = urlTarget("https://news.example.com/empty");
    const { outcome } = await runFor(target, [loadFixture("article", "no-article")], {
      scopeAuthorisation: clearanceFor(target.value),
    });
    expect(expectStatus(outcome, "NOT_FOUND").detail).toContain("no <title>");
  });
});
