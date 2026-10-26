/**
 * Claim contradiction review (pure; reclaims the legacy contradiction engine —
 * INVENTORY verdict KEEP for src/utils/osint/contradictions.ts and
 * cases/case-contradictions.ts). It reads the case's claims and reports, for
 * each attribute of each entity that two or more claims assert DIFFERENT values
 * for, the conflicting positions side by side, each with the evidence and
 * strength behind it.
 *
 * Epistemic rules it never breaks (the Addendum's standing rules; the legacy
 * defects these guard against):
 *   - It RESOLVES NOTHING. There is no "winner", "correct" or "true" field; a
 *     contradiction is presented for an analyst to review, never settled into a
 *     chosen narrative (CLAUDE.md §1).
 *   - It INFERS NOTHING. A contradiction is only two stated values that differ.
 *     Nothing is concluded about intent, guilt, ideology or credibility, and
 *     nothing is derived from a source's identity or affiliation.
 *   - Agreement is not a contradiction: the same value asserted by several
 *     sources is corroboration and is not reported here.
 *   - It invents no value and drops none. A claim with no value, or no entity
 *     subject, asserts nothing to contradict and is left out; evidence ids and
 *     strengths are carried through exactly.
 *
 * Deterministic: every list is sorted by a fixed key, so the same input always
 * produces byte-identical output.
 */
import { CLAIM_STRENGTHS, type ClaimStrength } from "@repo/core";
import { byCodeUnit, type CaseInput } from "./case-input.ts";

/** Fixed caveat carried with every contradiction set; the conflict is never resolved for the analyst. */
export const CONTRADICTION_CAVEAT =
  "A contradiction is two or more stored claims that state different values for the same attribute of the same entity. The conflicting positions are shown for review, with the evidence and strength behind each; none is marked correct, and nothing is inferred beyond what the claims state.";

/** One stated value in a contradiction, and the claims that assert it. */
export interface ContradictionPosition {
  /** The value as stored, carried through unchanged. */
  readonly value: unknown;
  /** The evidence ids asserting this value, sorted; at least one. */
  readonly evidenceIds: readonly string[];
  /** The strengths asserting this value, in CLAIM_STRENGTHS order (strongest first), de-duplicated. */
  readonly strengths: readonly ClaimStrength[];
}

/** One attribute of one entity that stored claims disagree on. */
export interface Contradiction {
  readonly entityId: string;
  readonly attribute: string;
  /** The distinct values asserted — two or more — each with its support. Sorted. */
  readonly positions: readonly ContradictionPosition[];
}

export interface CaseContradictions {
  /** Every reviewable contradiction, sorted by entity then attribute. */
  readonly items: readonly Contradiction[];
  readonly caveat: string;
}

/** Object keys sorted recursively, so two equal jsonb values produce the same string. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort(byCodeUnit)
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

/** A stable string for a stored value, for grouping equal values together. */
function stableKey(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

interface ValueSupport {
  readonly value: unknown;
  readonly evidenceIds: Set<string>;
  readonly strengths: Set<ClaimStrength>;
}

interface Group {
  readonly entityId: string;
  readonly attribute: string;
  readonly values: Map<string, ValueSupport>;
}

/**
 * The reviewable contradictions in a case's claims. Considers only claims about
 * an entity that carry a non-null value and an attribute; never relationship
 * claims, value-less claims, or claims the input did not carry a value for.
 */
export function caseContradictions(input: CaseInput): CaseContradictions {
  const groups = new Map<string, Group>();
  for (const claim of input.claims) {
    if (claim.entityId === null) continue;
    if (claim.attribute === undefined) continue;
    if (claim.value === undefined || claim.value === null) continue;
    const groupKey = `${claim.entityId}\u0000${claim.attribute}`;
    let group = groups.get(groupKey);
    if (group === undefined) {
      group = { entityId: claim.entityId, attribute: claim.attribute, values: new Map() };
      groups.set(groupKey, group);
    }
    const valueKey = stableKey(claim.value);
    let support = group.values.get(valueKey);
    if (support === undefined) {
      support = { value: claim.value, evidenceIds: new Set(), strengths: new Set() };
      group.values.set(valueKey, support);
    }
    support.evidenceIds.add(claim.evidenceId);
    support.strengths.add(claim.strength);
  }

  const items: Contradiction[] = [];
  for (const group of groups.values()) {
    // One value (however many sources) is agreement, not a contradiction.
    if (group.values.size < 2) continue;
    const positions: ContradictionPosition[] = [...group.values.entries()]
      .sort(([a], [b]) => byCodeUnit(a, b))
      .map(([, support]) => ({
        value: support.value,
        evidenceIds: [...support.evidenceIds].sort(byCodeUnit),
        strengths: CLAIM_STRENGTHS.filter((strength) => support.strengths.has(strength)),
      }));
    items.push({ entityId: group.entityId, attribute: group.attribute, positions });
  }
  items.sort((a, b) => byCodeUnit(a.entityId, b.entityId) || byCodeUnit(a.attribute, b.attribute));
  return { items, caveat: CONTRADICTION_CAVEAT };
}
