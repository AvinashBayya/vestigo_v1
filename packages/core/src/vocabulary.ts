/**
 * Domain vocabulary shared by every layer. The database enums are generated
 * from these lists, so the TypeScript union and the column type cannot drift.
 * Additive only (CLAUDE.md §7): add values, never rename or remove them.
 */

/** Strength of a claim, strongest first (CLAUDE.md §1). */
export const CLAIM_STRENGTHS = [
  "OBSERVED",
  "REPORTED",
  "DERIVED",
  "CORRELATED",
  "INFERRED",
  "HYPOTHESIS",
] as const;
export type ClaimStrength = (typeof CLAIM_STRENGTHS)[number];

export const ENTITY_KINDS = [
  "PERSON",
  "ORGANIZATION",
  "DOMAIN",
  "IP_ADDRESS",
  "EMAIL_ADDRESS",
  "USERNAME",
  "PHONE_NUMBER",
  "URL",
  "SOCIAL_ACCOUNT",
  "LOCATION",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Entity kinds that must never be merged automatically on a name match alone. */
export const NAME_ONLY_AUTOMERGE_FORBIDDEN: readonly EntityKind[] = ["PERSON", "ORGANIZATION"];

/** What a merge decision was based on. */
export const MERGE_SIGNALS = [
  "NAME",
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "DOMAIN",
  "USERNAME",
  "EXTERNAL_IDENTIFIER",
  "ANALYST_REVIEW",
] as const;
export type MergeSignal = (typeof MERGE_SIGNALS)[number];

/** Who made a decision: a person, or an automated rule. */
export const DECISION_ACTOR_KINDS = ["USER", "RULE"] as const;
export type DecisionActorKind = (typeof DECISION_ACTOR_KINDS)[number];

/** Who performed an audited action. */
export const AUDIT_ACTOR_KINDS = ["USER", "API_KEY", "SYSTEM"] as const;
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

export const COLLECTOR_DISCIPLINES = [
  "TECHINT",
  "SOCMINT",
  "MEDIAINT",
  "GEOINT",
  "PERSON",
] as const;
export type CollectorDiscipline = (typeof COLLECTOR_DISCIPLINES)[number];

/** Passive reads a third party's record; active sends traffic to the target. */
export const COLLECTION_MODES = ["PASSIVE", "ACTIVE"] as const;
export type CollectionMode = (typeof COLLECTION_MODES)[number];

/** Whether a source's licence permits commercial use. UNVERIFIED blocks enabling. */
export const COMMERCIAL_USE_VERDICTS = ["PERMITTED", "NOT_PERMITTED", "UNVERIFIED"] as const;
export type CommercialUseVerdict = (typeof COMMERCIAL_USE_VERDICTS)[number];

export const RUN_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const JOB_STATUSES = [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "DEAD_LETTERED",
  "CANCELLED",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Units metered against a tenant for every external call. */
export const USAGE_UNITS = [
  "API_CREDIT",
  "SEARCH_QUERY",
  "LLM_INPUT_TOKEN",
  "LLM_OUTPUT_TOKEN",
] as const;
export type UsageUnit = (typeof USAGE_UNITS)[number];

/** Data-residency regions. One today (ARCHITECTURE-DECISIONS §10: India). */
export const TENANT_REGIONS = ["IN"] as const;
export type TenantRegion = (typeof TENANT_REGIONS)[number];

/** How an audited request was authorised. */
export const AUTH_METHODS = ["SESSION", "API_KEY", "SYSTEM"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** Whether an audited action was allowed, denied, or allowed and then failed. */
export const AUDIT_OUTCOMES = ["ALLOWED", "DENIED", "FAILED"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
