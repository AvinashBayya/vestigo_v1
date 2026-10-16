/**
 * The platform registry as shipped: which collectors are registered, in what
 * order, under which licence status. The ten of Phase 3B, then news, held from
 * Phase 3B until Track M Day 2 (docs/PLAN.md).
 */
import { describe, expect, it } from "vitest";
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
] as const;

describe("the platform registry", () => {
  const registry = createPlatformRegistry();

  it("registers the ten Phase 3B collectors in the brief's order, then news, each under its licence status", () => {
    expect(registry.list().map((entry) => [entry.id, entry.commercialUse])).toEqual(REGISTERED);
    expect(PLATFORM_COLLECTORS.map((collector) => collector.declaration.id)).toEqual(
      REGISTERED.map(([id]) => id),
    );
  });

  it("runs each one only as its licence allows: PERMITTED is available, UNVERIFIED only where allowed", () => {
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
    // The one collector whose upstream's empty answers are unreliable.
    expect(
      registry
        .list()
        .filter((entry) => entry.emptyAnswersUnreliable)
        .map((entry) => entry.id),
    ).toEqual(["news"]);
  });

  it("labels every collector from its registry entry, each label distinct", () => {
    const labels = registry.list().map((entry) => entry.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });
});
