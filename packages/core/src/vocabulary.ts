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

/**
 * Why a module is locked for a tenant: its plan does not include the module,
 * or its vetting is not approved. The same codes reach a Locked refusal, a run
 * plan's exclusion and a job's refusal at dispatch, so every layer reads one
 * list. Additive only.
 */
export const LOCK_REASONS = ["MODULE_NOT_IN_PLAN", "VETTING_NOT_APPROVED"] as const;
export type LockReason = (typeof LOCK_REASONS)[number];

/**
 * Why a collector could not run at all, for any tenant or target: its
 * source's licence verdict is BLOCKED, or it has no implementation. The
 * runtime refuses it with one of these codes when it reaches that check, and
 * a run's plan records the code as the exclusion's reason. A plan records
 * another reason for such a collector when an earlier check decides first:
 * TARGET_TYPE_NOT_ACCEPTED when it does not take the run's target type, or
 * UNVERIFIED_SOURCE_NOT_ALLOWED for one with no implementation on an
 * unverified source where those are refused. So a reason from this list says
 * the collector could not run; another reason does not say that it could.
 * Additive only.
 */
export const UNRUNNABLE_REASONS = ["LICENCE_BLOCKED", "NOT_IMPLEMENTED"] as const;
export type UnrunnableReason = (typeof UNRUNNABLE_REASONS)[number];

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

/**
 * How a collector gets its data. Every mode but ACTIVE reads a third party's
 * record, or analyses local input, and never contacts the target. ACTIVE sends
 * traffic to the target and needs a recorded scope authorisation (CLAUDE.md §3).
 */
export const COLLECTION_MODES = [
  "PASSIVE_API",
  "PASSIVE_DATASET",
  "PASSIVE_PUBLIC_WEB",
  "LOCAL_ANALYSIS",
  "ACTIVE",
] as const;
export type CollectionMode = (typeof COLLECTION_MODES)[number];

/**
 * Whether a source may be used in a commercial product. BLOCKED never runs.
 * UNVERIFIED runs only where configuration allows unverified sources.
 */
export const COMMERCIAL_USE_VERDICTS = ["PERMITTED", "BLOCKED", "UNVERIFIED"] as const;
export type CommercialUseVerdict = (typeof COMMERCIAL_USE_VERDICTS)[number];

/**
 * What a collector can be pointed at. Named like the matching entity kinds,
 * except TOPIC (Track M D-M1): a free-text subject, a phrase or a hashtag,
 * which has no entity kind. A topic may name a person, so a run on one is
 * person data whatever collects it (PERSON_TARGET_TYPES, @repo/access).
 * Additive only, appended: the order is read (a case analysis sorts by it).
 */
export const TARGET_TYPES = [
  "DOMAIN",
  "IP_ADDRESS",
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "USERNAME",
  "ORGANIZATION",
  "URL",
  "FILE",
  "TOPIC",
] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

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

/**
 * What a collector job's last attempt produced: the collectors runtime's
 * outcome, recorded on the job. Additive only, and the same set as the
 * runtime's CollectionOutcome status.
 */
export const JOB_OUTCOMES = [
  "FOUND",
  "NOT_FOUND",
  "FAILED",
  "UNAVAILABLE",
  "NEEDS_CREDENTIALS",
  "REFUSED",
  /**
   * The upstream answered with nothing, and its empty answers are unreliable,
   * so whether it holds anything is unconfirmed. Never NOT_FOUND, never zero
   * (Track M Day 2, owner ruling).
   */
  "EMPTY_UNCONFIRMED",
] as const;
export type JobOutcome = (typeof JOB_OUTCOMES)[number];

/** Units metered against a tenant for every external call. */
export const USAGE_UNITS = [
  "API_CREDIT",
  "SEARCH_QUERY",
  "LLM_INPUT_TOKEN",
  "LLM_OUTPUT_TOKEN",
  /** One request a collector sent to its upstream, whatever the answer. */
  "UPSTREAM_REQUEST",
] as const;
export type UsageUnit = (typeof USAGE_UNITS)[number];

/** The calendar period a quota counts over, in UTC. */
export const QUOTA_PERIODS = ["DAY", "MONTH"] as const;
export type QuotaPeriod = (typeof QUOTA_PERIODS)[number];

/** Data-residency regions. One today (ARCHITECTURE-DECISIONS §10: India). */
export const TENANT_REGIONS = ["IN"] as const;
export type TenantRegion = (typeof TENANT_REGIONS)[number];

/** How an audited request was authorised. */
export const AUTH_METHODS = ["SESSION", "API_KEY", "SYSTEM"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

/** Whether an audited action was allowed, denied, or allowed and then failed. */
export const AUDIT_OUTCOMES = ["ALLOWED", "DENIED", "FAILED"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];
