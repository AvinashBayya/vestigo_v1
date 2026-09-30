/**
 * Entity identifiers and the rules for resolving by them.
 *
 * Ported from the previous codebase's entity resolution (legacy
 * src/utils/osint/entity-resolution.ts, INVENTORY verdict KEEP): the
 * normalisation rules, and its central rule, "do not infer identity merely
 * from a matching name": a person or an organisation is never resolved by
 * value. Three things differ, each with a regression test in
 * test/fusion.test.ts:
 *
 *   - No invented confidence. Legacy scored a merge as 0.5 + 0.15 per extra
 *     source, a formula no measurement supports (CLAUDE.md §1: never invent
 *     statistics). Here an identifier either matches exactly after
 *     normalisation or it does not; corroboration is the list of claims
 *     citing each piece of evidence, never a number.
 *   - Usernames keep their case. Legacy lower-cased them, which merges two
 *     accounts on a platform where handles are case-sensitive (Hacker News:
 *     "PG" and "pg" are different people; the Phase 3B fixture records it).
 *   - An unparseable URL has no identifier. Legacy fell back to the
 *     lower-cased raw string, merging on text that is not a URL at all.
 *
 * Resolution happens as fusion writes: one entity per kind and normalised
 * identifier (entities_one_per_identifier), so there is no after-the-fact
 * merge to score.
 */
import type { EntityKind } from "@repo/core";

export function normaliseDomain(value: string): string {
  // Lower case, no trailing dot. "www." is kept: www.example.com and
  // example.com are different DNS names.
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** Trimmed, a leading "@" dropped, and the case kept: never merge two handles that differ in case. */
export function normaliseUsername(value: string): string {
  return value.trim().replace(/^@/, "");
}

/**
 * Scheme and host lower-cased, fragment dropped, one trailing slash dropped;
 * the query is kept. Null when the value is not a URL: it then has no
 * identifier, and nothing merges on it.
 */
export function normaliseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  const path = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${path}${url.search}`;
}

/**
 * The platform-scoped identifier of an account. Each platform's own rule for
 * handles decides the case: GitHub and DEV treat them case-insensitively;
 * Hacker News does not.
 */
export function socialAccountIdentifier(
  platform: "github" | "devto" | "hackernews",
  handle: string,
): string {
  const normalised = normaliseUsername(handle);
  return `${platform}:${platform === "hackernews" ? normalised : normalised.toLowerCase()}`;
}

/** An external registry's identifier for a person or organisation, e.g. "wikidata:Q42". */
export function externalIdentifier(namespace: "wikidata", id: string): string {
  return `${namespace}:${id}`;
}

/**
 * Kinds never resolved by value. They get an identifier only from an
 * external registry (a namespaced id); the database enforces the same rule
 * (entities_named_kinds_external_identifier_only).
 */
export const NEVER_RESOLVED_BY_VALUE: ReadonlySet<EntityKind> = new Set(["PERSON", "ORGANIZATION"]);
