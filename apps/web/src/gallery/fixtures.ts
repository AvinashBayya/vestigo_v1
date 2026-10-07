/**
 * Gallery fixtures. Every value is a bracketed placeholder (CLAUDE.md §1:
 * never invent a source name, count, date or identifier, fixtures included).
 * Nothing here is ever shown outside the dev-only gallery.
 */
import type { EvidenceCardProps, PaletteGroup, Provenance, RunLock, LockReason } from "@repo/ui";
import type { GraphEdge, GraphNode } from "../workspace/queries.ts";

/** A content hash's shape, so the short form (4…3) can be seen. Not a real hash of anything. */
export const HASH = "a41f" + "0".repeat(57) + "9c2";

export const PROVENANCE: Provenance = {
  sourceLabel: "[SOURCE LABEL]",
  collectorVersion: "[VERSION]",
  runId: "[RUN ID]",
  observedAt: "[OBSERVED AT]",
  collectedAt: "[COLLECTED AT]",
  contentHash: HASH,
  sourceUrl: "[SOURCE URL]",
  payloadHref: "#raw-payload",
};

/** The same item, where the source never said when, and no hash or payload was stored. */
export const PROVENANCE_GAPS: Provenance = {
  ...PROVENANCE,
  observedAt: null,
  contentHash: null,
  sourceUrl: null,
  payloadHref: null,
};

export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  {
    label: "Runs",
    items: [
      { id: "run-1", label: "[TARGET DOMAIN]", hint: "Run · [TIME]" },
      { id: "run-2", label: "[TARGET EMAIL]", hint: "Run · [TIME]" },
    ],
  },
  {
    label: "Cases",
    items: [{ id: "case-1", label: "[CASE NAME]", hint: "Case · pinned items only" }],
  },
  {
    label: "Pages",
    items: [
      { id: "search", label: "Search" },
      { id: "cases", label: "Cases" },
    ],
  },
];

export const EVIDENCE_CARDS: readonly EvidenceCardProps[] = [
  {
    id: "e-observed",
    kind: "found",
    strength: "OBSERVED",
    text: "[A CLAIM THE PLATFORM SAW DIRECTLY]",
    sourceLabel: "[SOURCE LABEL]",
    observedAt: "[OBSERVED AT]",
    collectedAt: "[COLLECTED AT]",
    contentHash: HASH,
  },
  {
    id: "e-reported",
    kind: "found",
    strength: "REPORTED",
    text: "[A CLAIM A SOURCE STATED]",
    sourceLabel: "[PUBLICATION]",
    observedAt: null,
    collectedAt: "[COLLECTED AT]",
    contentHash: null,
  },
  {
    id: "e-inferred",
    kind: "found",
    strength: "INFERRED",
    inferredFrom: "[THE ITEMS IT RESTS ON]",
    text: "[A LINK NO SOURCE STATED, INFERRED BY THE PLATFORM]",
    sourceLabel: "[FUSION]",
    observedAt: null,
    collectedAt: "[COLLECTED AT]",
    contentHash: null,
  },
];

export const NOTHING_FOUND_CARD: EvidenceCardProps = {
  id: "e-nothing",
  kind: "nothing-found",
  sourceLabel: "[SOURCE LABEL]",
  collectedAt: "[COLLECTED AT]",
  detail: "[THE COLLECTOR'S OWN WORDS, AS RECORDED]",
};

export const LOCKS: readonly RunLock[] = (
  [
    "CREDENTIAL_REVOKED",
    "MEMBERSHIP_REVOKED",
    "PERMISSION_LOST",
    "MODULE_NOT_IN_PLAN",
    "VETTING_NOT_APPROVED",
  ] satisfies LockReason[]
).map((reason) => ({
  reason,
  code: reason,
  detail: `[THE API'S DETAIL FOR ${reason}]`,
  // The API sends its Locked block only where person data is the reason.
  locked:
    reason === "MODULE_NOT_IN_PLAN" || reason === "VETTING_NOT_APPROVED"
      ? {
          moduleSummary: "[WHAT THE MODULE DOES]",
          withheld: "[WHAT THIS READ WOULD HAVE RETURNED]",
          nextStep: "[THE NEXT STEP]",
        }
      : null,
  recheckIntervalMs: 5_000,
  checkedAt: "[CHECKED AT]",
}));

/** A small graph with one node of several classes, so each colour and the selected outline show. */
export const GRAPH_NODES: readonly GraphNode[] = [
  {
    id: "n-org",
    kind: "ORGANIZATION",
    displayName: "[ORG]",
    identifier: null,
    hop: 0,
    claimCount: 1,
    mergedIntoEntityId: null,
  },
  {
    id: "n-domain",
    kind: "DOMAIN",
    displayName: "[DOMAIN]",
    identifier: null,
    hop: 1,
    claimCount: 1,
    mergedIntoEntityId: null,
  },
  {
    id: "n-ip",
    kind: "IP_ADDRESS",
    displayName: "[IP]",
    identifier: null,
    hop: 2,
    claimCount: 1,
    mergedIntoEntityId: null,
  },
  {
    id: "n-email",
    kind: "EMAIL_ADDRESS",
    displayName: "[EMAIL]",
    identifier: null,
    hop: 1,
    claimCount: 1,
    mergedIntoEntityId: null,
  },
  {
    id: "n-person",
    kind: "PERSON",
    displayName: "[PERSON]",
    identifier: null,
    hop: 2,
    claimCount: 1,
    mergedIntoEntityId: null,
  },
  {
    id: "n-account",
    kind: "SOCIAL_ACCOUNT",
    displayName: "[ACCOUNT]",
    identifier: null,
    hop: 1,
    claimCount: 1,
    mergedIntoEntityId: null,
  },
];

export const GRAPH_EDGES: readonly GraphEdge[] = [
  {
    id: "g1",
    sourceEntityId: "n-org",
    targetEntityId: "n-domain",
    kind: "[RELATION]",
    claimCount: 1,
    strengths: ["OBSERVED"],
  },
  {
    id: "g2",
    sourceEntityId: "n-domain",
    targetEntityId: "n-ip",
    kind: "[RELATION]",
    claimCount: 1,
    strengths: ["OBSERVED"],
  },
  {
    id: "g3",
    sourceEntityId: "n-org",
    targetEntityId: "n-email",
    kind: "[RELATION]",
    claimCount: 1,
    strengths: ["REPORTED"],
  },
  {
    id: "g4",
    sourceEntityId: "n-email",
    targetEntityId: "n-person",
    kind: "[RELATION]",
    claimCount: 1,
    strengths: ["REPORTED"],
  },
  {
    id: "g5",
    sourceEntityId: "n-org",
    targetEntityId: "n-account",
    kind: "[RELATION]",
    claimCount: 1,
    strengths: ["DERIVED"],
  },
  {
    id: "g6",
    sourceEntityId: "n-person",
    targetEntityId: "n-account",
    kind: "[RELATION]",
    claimCount: 1,
    strengths: ["INFERRED"],
  },
];
