/**
 * Stage 1 (exact-article work): a URL target is cleared by an in-force DOMAIN
 * read authorisation for its EXACT host — no parent/subdomain widening — while
 * exact (type, value) authorisations keep matching as before. The in-force
 * window, revocation, tenant isolation and authz are the existing
 * scope_authorisations behaviour (apps/api/test/scope-authorisations.test.ts);
 * here `findInForce` is faked so the host-matching logic is pinned
 * deterministically offline.
 */
import { PLATFORM_COLLECTORS } from "@repo/collectors";
import { startHarness } from "@repo/collectors/testing";
import type { TargetType } from "@repo/core";
import { describe, expect, it } from "vitest";
import { resolveScopeClearance, type ScopeAuthorisationLookup } from "../src/scope.ts";

interface Row {
  readonly id: string;
  readonly targetType: TargetType;
  readonly target: string;
}

const repoWith = (rows: readonly Row[]): ScopeAuthorisationLookup => ({
  findInForce: (targetType, target) =>
    Promise.resolve(
      rows.find((row) => row.targetType === targetType && row.target === target) ?? null,
    ),
});

describe("resolveScopeClearance", () => {
  it("clears an exact (type, value) authorisation", async () => {
    const repo = repoWith([{ id: "a", targetType: "DOMAIN", target: "example.com" }]);
    expect(await resolveScopeClearance(repo, { type: "DOMAIN", value: "example.com" })).toEqual({
      id: "a",
      targetType: "DOMAIN",
      target: "example.com",
    });
  });

  it("clears a URL target by a DOMAIN authorisation for its exact host, shaped to the URL", async () => {
    const repo = repoWith([{ id: "d", targetType: "DOMAIN", target: "www.example.com" }]);
    // The clearance is for the URL itself (so the runtime's exact-target gate
    // admits it), carrying the DOMAIN authorisation's id for the audit trail.
    expect(
      await resolveScopeClearance(repo, {
        type: "URL",
        value: "https://www.example.com/a/b?c=d#e",
      }),
    ).toEqual({ id: "d", targetType: "URL", target: "https://www.example.com/a/b?c=d#e" });
  });

  it("does not widen: a DOMAIN authorisation clears neither a subdomain nor a parent", async () => {
    const parent = repoWith([{ id: "d", targetType: "DOMAIN", target: "example.com" }]);
    expect(
      await resolveScopeClearance(parent, { type: "URL", value: "https://sub.example.com/x" }),
    ).toBeNull();
    const sub = repoWith([{ id: "d", targetType: "DOMAIN", target: "sub.example.com" }]);
    expect(
      await resolveScopeClearance(sub, { type: "URL", value: "https://example.com/x" }),
    ).toBeNull();
  });

  it("denies a URL whose host has no in-force authorisation", async () => {
    const repo = repoWith([{ id: "d", targetType: "DOMAIN", target: "other.com" }]);
    expect(
      await resolveScopeClearance(repo, { type: "URL", value: "https://example.com/x" }),
    ).toBeNull();
  });

  it("denies a malformed URL target: no host to authorise against", async () => {
    const repo = repoWith([{ id: "d", targetType: "DOMAIN", target: "example.com" }]);
    expect(await resolveScopeClearance(repo, { type: "URL", value: "not a url" })).toBeNull();
  });

  it("still clears a URL by an exact URL authorisation when one is in force", async () => {
    const repo = repoWith([{ id: "u", targetType: "URL", target: "https://example.com/exact" }]);
    expect(
      await resolveScopeClearance(repo, { type: "URL", value: "https://example.com/exact" }),
    ).toEqual({ id: "u", targetType: "URL", target: "https://example.com/exact" });
  });

  it("denies when there is no authorisation at all", async () => {
    const repo = repoWith([]);
    expect(
      await resolveScopeClearance(repo, { type: "URL", value: "https://example.com/x" }),
    ).toBeNull();
    expect(await resolveScopeClearance(repo, { type: "DOMAIN", value: "example.com" })).toBeNull();
  });
});

/**
 * The resolver feeds the collectors runtime's collection-mode gate: the
 * clearance it returns for a URL cleared by a DOMAIN authorisation must be one
 * the runtime admits for that exact URL target. A replaying harness lets the
 * UNVERIFIED article source pass the licence check so admission reaches the
 * scope gate; admit runs before the collector's code, so nothing is fetched.
 */
describe("resolveScopeClearance feeds the ACTIVE collection-mode gate", () => {
  const ENTITLED = { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" } as const;
  const ARTICLE = { type: "URL" as const, value: "https://news.example.com/world/story-1" };

  it("admits the ACTIVE URL article collector on a DOMAIN authorisation for its host, and refuses without one", async () => {
    const harness = await startHarness({
      collectors: PLATFORM_COLLECTORS.filter((collector) => collector.declaration.id === "article"),
      fixtures: [],
    });
    try {
      const authorised = await resolveScopeClearance(
        repoWith([{ id: "d", targetType: "DOMAIN", target: "news.example.com" }]),
        ARTICLE,
      );
      expect(
        harness.runtime.admit("article", {
          target: ARTICLE,
          entitlement: ENTITLED,
          scopeAuthorisation: authorised,
        }),
      ).toBeNull();

      const none = await resolveScopeClearance(repoWith([]), ARTICLE);
      expect(
        harness.runtime.admit("article", {
          target: ARTICLE,
          entitlement: ENTITLED,
          scopeAuthorisation: none,
        }),
      ).toMatchObject({ status: "REFUSED", reason: "SCOPE_AUTHORISATION_REQUIRED" });
    } finally {
      await harness.close();
    }
  });
});
