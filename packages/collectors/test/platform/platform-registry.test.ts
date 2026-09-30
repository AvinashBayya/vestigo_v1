/**
 * The platform registry as shipped at the end of Phase 3B: which collectors
 * are registered, in what order, under which licence status, and that news
 * is held back (docs/PLAN.md, Phase 3B).
 */
import { describe, expect, it } from "vitest";
import {
  createPlatformRegistry,
  PLATFORM_COLLECTORS,
  UnknownCollectorError,
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
] as const;

describe("the platform registry", () => {
  const registry = createPlatformRegistry();

  it("registers the ten Phase 3B collectors, in the brief's order, each under its licence status", () => {
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

  it("holds news back: its NOT_FOUND is unproven, so it is not registered", () => {
    expect(() => registry.entry("news")).toThrow(UnknownCollectorError);
    expect(registry.list().some((entry) => entry.source.id === "gdelt-doc")).toBe(false);
  });

  it("labels every collector from its registry entry, each label distinct", () => {
    const labels = registry.list().map((entry) => entry.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
  });
});
