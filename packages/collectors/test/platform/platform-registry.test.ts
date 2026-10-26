/**
 * The platform registry as shipped: which collectors are registered, in what
 * order, under which licence status. The ten of Phase 3B, then news, held from
 * Phase 3B until Track M Day 2, then the monitoring collectors of 2026-10-17:
 * Bluesky and Reddit search, and one RSS collector per publisher, then the
 * direct article fetch (2026-10-22, exact-article Stage 3), every one of these
 * last UNVERIFIED (docs/PLAN.md, docs/M1_DIRECT_ARTICLE_FETCH_REPORT.md).
 */
import { describe, expect, it } from "vitest";
import { RSS_PUBLISHERS } from "../../src/data/rss-feeds.ts";
import {
  createPlatformRegistry,
  HELD_PLATFORM_COLLECTORS,
  PLATFORM_COLLECTORS,
} from "../../src/index.ts";

const REGISTERED = [
  ["crtsh", "UNVERIFIED"],
  ["dns", "UNVERIFIED"],
  ["rdap", "UNVERIFIED"],
  ["wayback", "UNVERIFIED"],
  ["contact.phone", "PERMITTED"],
  ["wikidata", "PERMITTED"],
  ["github", "UNVERIFIED"],
  ["hackernews", "UNVERIFIED"],
  ["devto", "UNVERIFIED"],
  ["commoncrawl", "UNVERIFIED"],
  ["news", "PERMITTED"],
  ["bluesky.search", "UNVERIFIED"],
  ["reddit.search", "UNVERIFIED"],
  ...RSS_PUBLISHERS.map((publisher) => [publisher.id, "UNVERIFIED"] as const),
  ["article", "UNVERIFIED"],
];

describe("the platform registry", () => {
  const registry = createPlatformRegistry();

  it("registers the ten Phase 3B collectors in the brief's order, then news, then the monitoring collectors, each under its licence status", () => {
    expect(registry.list().map((entry) => [entry.id, entry.commercialUse])).toEqual(REGISTERED);
    expect(PLATFORM_COLLECTORS.map((collector) => collector.declaration.id)).toEqual(
      REGISTERED.map(([id]) => id),
    );
  });

  it("lists each one under its licence: PERMITTED is available, the rest UNVERIFIED, which never runs", () => {
    for (const entry of registry.list()) {
      expect(entry.availability, entry.id).toBe(
        entry.commercialUse === "PERMITTED" ? "AVAILABLE" : "UNVERIFIED",
      );
    }
  });

  it("holds nothing back since news was registered, and news alone reads gdelt-doc (Track M Day 2)", () => {
    expect(HELD_PLATFORM_COLLECTORS).toEqual([]);
    expect(
      registry
        .list()
        .filter((entry) => entry.source.id === "gdelt-doc")
        .map((entry) => entry.id),
    ).toEqual(["news"]);
    // The collectors whose upstream's empty answers are unreliable: GDELT's,
    // and every monitoring search and feed (a feed lists only its newest items).
    expect(
      registry
        .list()
        .filter((entry) => entry.emptyAnswersUnreliable)
        .map((entry) => entry.id),
    ).toEqual(["news", "bluesky.search", "reddit.search", ...RSS_PUBLISHERS.map((p) => p.id)]);
  });

  it("labels every collector from its registry entry, each label distinct", () => {
    const labels = registry.list().map((entry) => entry.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });
});
