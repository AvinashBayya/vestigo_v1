import {
  AUDIT_ACTOR_KINDS,
  CLAIM_STRENGTHS,
  COLLECTION_MODES,
  COLLECTOR_DISCIPLINES,
  COMMERCIAL_USE_VERDICTS,
  DECISION_ACTOR_KINDS,
  ENTITY_KINDS,
  JOB_STATUSES,
  MERGE_SIGNALS,
  RUN_STATUSES,
  TENANT_REGIONS,
  USAGE_UNITS,
} from "@repo/core";
import { pgEnum } from "drizzle-orm/pg-core";

// Every enum is generated from the shared vocabulary in @repo/core, so the
// column type and the TypeScript union cannot drift apart.

/** First-class claim strength (CLAUDE.md §1). */
export const claimStrength = pgEnum("claim_strength", CLAIM_STRENGTHS);
export const entityKind = pgEnum("entity_kind", ENTITY_KINDS);
export const mergeSignal = pgEnum("merge_signal", MERGE_SIGNALS);
export const decisionActorKind = pgEnum("decision_actor_kind", DECISION_ACTOR_KINDS);
export const auditActorKind = pgEnum("audit_actor_kind", AUDIT_ACTOR_KINDS);
export const collectorDiscipline = pgEnum("collector_discipline", COLLECTOR_DISCIPLINES);
export const collectionMode = pgEnum("collection_mode", COLLECTION_MODES);
export const commercialUseVerdict = pgEnum("commercial_use_verdict", COMMERCIAL_USE_VERDICTS);
export const runStatus = pgEnum("run_status", RUN_STATUSES);
export const jobStatus = pgEnum("job_status", JOB_STATUSES);
export const usageUnit = pgEnum("usage_unit", USAGE_UNITS);
export const tenantRegion = pgEnum("tenant_region", TENANT_REGIONS);

export const USER_STATUSES = ["ACTIVE", "DISABLED"] as const;
export const userStatus = pgEnum("user_status", USER_STATUSES);
