CREATE TYPE "public"."audit_actor_kind" AS ENUM('USER', 'API_KEY', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."claim_strength" AS ENUM('OBSERVED', 'REPORTED', 'DERIVED', 'CORRELATED', 'INFERRED', 'HYPOTHESIS');--> statement-breakpoint
CREATE TYPE "public"."collection_mode" AS ENUM('PASSIVE', 'ACTIVE');--> statement-breakpoint
CREATE TYPE "public"."collector_discipline" AS ENUM('TECHINT', 'SOCMINT', 'MEDIAINT', 'GEOINT', 'PERSON');--> statement-breakpoint
CREATE TYPE "public"."commercial_use_verdict" AS ENUM('PERMITTED', 'NOT_PERMITTED', 'UNVERIFIED');--> statement-breakpoint
CREATE TYPE "public"."decision_actor_kind" AS ENUM('USER', 'RULE');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('PERSON', 'ORGANIZATION', 'DOMAIN', 'IP_ADDRESS', 'EMAIL_ADDRESS', 'USERNAME', 'PHONE_NUMBER', 'URL', 'SOCIAL_ACCOUNT', 'LOCATION');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTERED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."merge_signal" AS ENUM('NAME', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'DOMAIN', 'USERNAME', 'EXTERNAL_IDENTIFIER', 'ANALYST_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."tenant_region" AS ENUM('IN');--> statement-breakpoint
CREATE TYPE "public"."usage_unit" AS ENUM('API_CREDIT', 'SEARCH_QUERY', 'LLM_INPUT_TOKEN', 'LLM_OUTPUT_TOKEN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'DISABLED');--> statement-breakpoint
CREATE TABLE "alerts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" uuid NOT NULL,
	"title" text NOT NULL,
	"evidence_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" uuid,
	CONSTRAINT "alerts_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "alerts_title_not_blank" CHECK (length(btrim("alerts"."title")) > 0),
	CONSTRAINT "alerts_acknowledgement_consistent" CHECK (("alerts"."acknowledged_at" is null) = ("alerts"."acknowledged_by_user_id" is null))
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "api_keys_prefix_key" UNIQUE("tenant_id","key_prefix"),
	CONSTRAINT "api_keys_prefix_format" CHECK ("api_keys"."key_prefix" ~ '^[A-Za-z0-9_-]{6,32}$'),
	CONSTRAINT "api_keys_hash_present" CHECK (length("api_keys"."key_hash") >= 32)
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "audit_actor_kind" NOT NULL,
	"actor_user_id" uuid,
	"actor_api_key_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"details" jsonb,
	CONSTRAINT "audit_log_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "audit_log_action_format" CHECK ("audit_log"."action" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
	CONSTRAINT "audit_log_actor_consistent" CHECK (("audit_log"."actor_kind" = 'USER' and "audit_log"."actor_user_id" is not null and "audit_log"."actor_api_key_id" is null)
        or ("audit_log"."actor_kind" = 'API_KEY' and "audit_log"."actor_api_key_id" is not null and "audit_log"."actor_user_id" is null)
        or ("audit_log"."actor_kind" = 'SYSTEM' and "audit_log"."actor_user_id" is null and "audit_log"."actor_api_key_id" is null)),
	CONSTRAINT "audit_log_target_consistent" CHECK (("audit_log"."target_type" is null) = ("audit_log"."target_id" is null))
);
--> statement-breakpoint
CREATE TABLE "case_pins" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"evidence_id" uuid,
	"entity_id" uuid,
	"claim_id" uuid,
	"pinned_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "case_pins_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "case_pins_one_target" CHECK (num_nonnulls("case_pins"."evidence_id", "case_pins"."entity_id", "case_pins"."claim_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "cases_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "cases_title_not_blank" CHECK (length(btrim("cases"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"evidence_id" uuid NOT NULL,
	"entity_id" uuid,
	"relationship_id" uuid,
	"attribute" text NOT NULL,
	"value" jsonb,
	"strength" "claim_strength" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "claims_one_subject" CHECK (num_nonnulls("claims"."entity_id", "claims"."relationship_id") = 1),
	CONSTRAINT "claims_attribute_format" CHECK ("claims"."attribute" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "collectors_registry" (
	"tenant_id" uuid NOT NULL,
	"collector_id" text NOT NULL,
	"source_label" text NOT NULL,
	"discipline" "collector_discipline" NOT NULL,
	"collection_mode" "collection_mode" NOT NULL,
	"data_licence" text NOT NULL,
	"commercial_use" "commercial_use_verdict" NOT NULL,
	"enabled" boolean NOT NULL,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collectors_registry_pk" PRIMARY KEY("tenant_id","collector_id"),
	CONSTRAINT "collectors_registry_id_format" CHECK ("collectors_registry"."collector_id" ~ '^[a-z0-9][a-z0-9._-]*$'),
	CONSTRAINT "collectors_registry_label_not_blank" CHECK (length(btrim("collectors_registry"."source_label")) > 0),
	CONSTRAINT "collectors_registry_licence_not_blank" CHECK (length(btrim("collectors_registry"."data_licence")) > 0),
	CONSTRAINT "collectors_registry_enabled_requires_permitted" CHECK (not "collectors_registry"."enabled" or "collectors_registry"."commercial_use" = 'PERMITTED'),
	CONSTRAINT "collectors_registry_disabled_has_reason" CHECK ("collectors_registry"."enabled" or length(btrim(coalesce("collectors_registry"."disabled_reason", ''))) > 0)
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"encrypted_data_key" "bytea" NOT NULL,
	"master_key_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "credentials_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "credentials_provider_format" CHECK ("credentials"."provider" ~ '^[a-z0-9][a-z0-9._-]*$'),
	CONSTRAINT "credentials_label_not_blank" CHECK (length(btrim("credentials"."label")) > 0),
	CONSTRAINT "credentials_ciphertext_present" CHECK (octet_length("credentials"."ciphertext") > 0),
	CONSTRAINT "credentials_data_key_present" CHECK (octet_length("credentials"."encrypted_data_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" "entity_kind" NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "entities_id_kind_key" UNIQUE("tenant_id","id","kind"),
	CONSTRAINT "entities_display_name_not_blank" CHECK (length(btrim("entities"."display_name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "entity_merges" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity_kind" "entity_kind" NOT NULL,
	"surviving_entity_id" uuid NOT NULL,
	"merged_entity_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"match_signals" "merge_signal"[] NOT NULL,
	"merged_by_kind" "decision_actor_kind" NOT NULL,
	"merged_by_user_id" uuid,
	"merged_by_rule" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone,
	"reverted_by_kind" "decision_actor_kind",
	"reverted_by_user_id" uuid,
	"reverted_by_rule" text,
	"revert_reason" text,
	CONSTRAINT "entity_merges_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "entity_merges_not_self" CHECK ("entity_merges"."surviving_entity_id" <> "entity_merges"."merged_entity_id"),
	CONSTRAINT "entity_merges_confidence_range" CHECK ("entity_merges"."confidence" >= 0 and "entity_merges"."confidence" <= 1),
	CONSTRAINT "entity_merges_reason_not_blank" CHECK (length(btrim("entity_merges"."reason")) > 0),
	CONSTRAINT "entity_merges_has_signals" CHECK (cardinality("entity_merges"."match_signals") > 0),
	CONSTRAINT "entity_merges_no_name_only_automerge" CHECK (not ("entity_merges"."merged_by_kind" = 'RULE'
        and "entity_merges"."entity_kind" in ('PERSON', 'ORGANIZATION')
        and "entity_merges"."match_signals" <@ array['NAME']::merge_signal[])),
	CONSTRAINT "entity_merges_merged_by_consistent" CHECK (("entity_merges"."merged_by_kind" = 'USER' and "entity_merges"."merged_by_user_id" is not null and "entity_merges"."merged_by_rule" is null)
        or ("entity_merges"."merged_by_kind" = 'RULE' and "entity_merges"."merged_by_rule" is not null and "entity_merges"."merged_by_user_id" is null)),
	CONSTRAINT "entity_merges_revert_consistent" CHECK (("entity_merges"."reverted_at" is null and "entity_merges"."reverted_by_kind" is null and "entity_merges"."reverted_by_user_id" is null
          and "entity_merges"."reverted_by_rule" is null and "entity_merges"."revert_reason" is null)
        or ("entity_merges"."reverted_at" is not null and length(btrim(coalesce("entity_merges"."revert_reason", ''))) > 0 and (
          ("entity_merges"."reverted_by_kind" = 'USER' and "entity_merges"."reverted_by_user_id" is not null and "entity_merges"."reverted_by_rule" is null)
          or ("entity_merges"."reverted_by_kind" = 'RULE' and "entity_merges"."reverted_by_rule" is not null and "entity_merges"."reverted_by_user_id" is null))))
);
--> statement-breakpoint
CREATE TABLE "entity_relationships" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_relationships_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "entity_relationships_not_self" CHECK ("entity_relationships"."source_entity_id" <> "entity_relationships"."target_entity_id"),
	CONSTRAINT "entity_relationships_kind_format" CHECK ("entity_relationships"."kind" ~ '^[a-z][a-z_]*$')
);
--> statement-breakpoint
-- Hand edit (Drizzle cannot express partitioning): evidence is range-partitioned
-- by month on its UUIDv7 id. Partitions are created in 0002_security.sql.
CREATE TABLE "evidence" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT app.uuid_generate_v7() NOT NULL,
	"collector_id" text NOT NULL,
	"collector_version" text NOT NULL,
	"job_id" uuid,
	"source_url" text,
	"content_hash" text NOT NULL,
	"payload_ref" text NOT NULL,
	"observed_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"claim_strength" "claim_strength" NOT NULL,
	"created_at" timestamp with time zone GENERATED ALWAYS AS (app.uuid_v7_timestamp(id)) STORED NOT NULL,
	CONSTRAINT "evidence_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "evidence_id_is_uuid_v7" CHECK (substr("evidence"."id"::text, 15, 1) = '7'),
	CONSTRAINT "evidence_content_hash_format" CHECK ("evidence"."content_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "evidence_payload_ref_not_blank" CHECK (length(btrim("evidence"."payload_ref")) > 0),
	CONSTRAINT "evidence_collector_version_not_blank" CHECK (length(btrim("evidence"."collector_version")) > 0),
	CONSTRAINT "evidence_source_url_scheme" CHECK ("evidence"."source_url" is null or "evidence"."source_url" ~ '^https?://')
) PARTITION BY RANGE ("id");
--> statement-breakpoint
CREATE TABLE "investigations" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"target" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "investigations_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "investigations_title_not_blank" CHECK (length(btrim("investigations"."title")) > 0),
	CONSTRAINT "investigations_target_not_blank" CHECK (length(btrim("investigations"."target")) > 0)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"collector_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "job_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "jobs_idempotency_key" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "jobs_attempts_non_negative" CHECK ("jobs"."attempts" >= 0),
	CONSTRAINT "jobs_idempotency_key_not_blank" CHECK (length(btrim("jobs"."idempotency_key")) > 0),
	CONSTRAINT "jobs_error_consistent" CHECK (("jobs"."last_error_code" is null) = ("jobs"."last_error_message" is null)),
	CONSTRAINT "jobs_finished_after_started" CHECK ("jobs"."finished_at" is null or "jobs"."started_at" is null or "jobs"."finished_at" >= "jobs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "memberships_user_role_key" UNIQUE("tenant_id","user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"target" text NOT NULL,
	"schedule_cron" text NOT NULL,
	"enabled" boolean NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitors_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "monitors_name_not_blank" CHECK (length(btrim("monitors"."name")) > 0),
	CONSTRAINT "monitors_target_not_blank" CHECK (length(btrim("monitors"."target")) > 0),
	CONSTRAINT "monitors_schedule_not_blank" CHECK (length(btrim("monitors"."schedule_cron")) > 0)
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"tenant_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_pk" PRIMARY KEY("tenant_id","role_id","permission"),
	CONSTRAINT "permissions_key_format" CHECK ("permissions"."permission" ~ '^[a-z][a-z_]*:[a-z][a-z_]*$')
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "roles_name_key" UNIQUE("tenant_id","name"),
	CONSTRAINT "roles_name_not_blank" CHECK (length(btrim("roles"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"investigation_id" uuid NOT NULL,
	"status" "run_status" NOT NULL,
	"requested_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "runs_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "runs_finished_after_started" CHECK ("runs"."finished_at" is null or "runs"."started_at" is null or "runs"."finished_at" >= "runs"."started_at")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" "tenant_region" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_name_not_blank" CHECK (length(btrim("tenants"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"unit" "usage_unit" NOT NULL,
	"quantity" bigint NOT NULL,
	"collector_id" text,
	"job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "usage_events_quantity_non_negative" CHECK ("usage_events"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"status" "user_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "users_email_key" UNIQUE("tenant_id","email"),
	CONSTRAINT "users_email_normalised" CHECK ("users"."email" = lower("users"."email") and "users"."email" like '_%@_%')
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_monitor_fk" FOREIGN KEY ("tenant_id","monitor_id") REFERENCES "public"."monitors"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_evidence_fk" FOREIGN KEY ("tenant_id","evidence_id") REFERENCES "public"."evidence"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_fk" FOREIGN KEY ("tenant_id","acknowledged_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_pins" ADD CONSTRAINT "case_pins_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_pins" ADD CONSTRAINT "case_pins_case_fk" FOREIGN KEY ("tenant_id","case_id") REFERENCES "public"."cases"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_pins" ADD CONSTRAINT "case_pins_evidence_fk" FOREIGN KEY ("tenant_id","evidence_id") REFERENCES "public"."evidence"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_pins" ADD CONSTRAINT "case_pins_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_pins" ADD CONSTRAINT "case_pins_claim_fk" FOREIGN KEY ("tenant_id","claim_id") REFERENCES "public"."claims"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_pins" ADD CONSTRAINT "case_pins_pinned_by_fk" FOREIGN KEY ("tenant_id","pinned_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_evidence_fk" FOREIGN KEY ("tenant_id","evidence_id") REFERENCES "public"."evidence"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_entity_fk" FOREIGN KEY ("tenant_id","entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_relationship_fk" FOREIGN KEY ("tenant_id","relationship_id") REFERENCES "public"."entity_relationships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collectors_registry" ADD CONSTRAINT "collectors_registry_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_merges" ADD CONSTRAINT "entity_merges_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_merges" ADD CONSTRAINT "entity_merges_surviving_fk" FOREIGN KEY ("tenant_id","surviving_entity_id","entity_kind") REFERENCES "public"."entities"("tenant_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_merges" ADD CONSTRAINT "entity_merges_merged_fk" FOREIGN KEY ("tenant_id","merged_entity_id","entity_kind") REFERENCES "public"."entities"("tenant_id","id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_merges" ADD CONSTRAINT "entity_merges_merged_by_user_fk" FOREIGN KEY ("tenant_id","merged_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_merges" ADD CONSTRAINT "entity_merges_reverted_by_user_fk" FOREIGN KEY ("tenant_id","reverted_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_source_fk" FOREIGN KEY ("tenant_id","source_entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_target_fk" FOREIGN KEY ("tenant_id","target_entity_id") REFERENCES "public"."entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_collector_fk" FOREIGN KEY ("tenant_id","collector_id") REFERENCES "public"."collectors_registry"("tenant_id","collector_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_collector_fk" FOREIGN KEY ("tenant_id","collector_id") REFERENCES "public"."collectors_registry"("tenant_id","collector_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_investigation_fk" FOREIGN KEY ("tenant_id","investigation_id") REFERENCES "public"."investigations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_collector_fk" FOREIGN KEY ("tenant_id","collector_id") REFERENCES "public"."collectors_registry"("tenant_id","collector_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_job_fk" FOREIGN KEY ("tenant_id","job_id") REFERENCES "public"."jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "case_pins_evidence_key" ON "case_pins" USING btree ("tenant_id","case_id","evidence_id") WHERE "case_pins"."evidence_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "case_pins_entity_key" ON "case_pins" USING btree ("tenant_id","case_id","entity_id") WHERE "case_pins"."entity_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "case_pins_claim_key" ON "case_pins" USING btree ("tenant_id","case_id","claim_id") WHERE "case_pins"."claim_id" is not null;--> statement-breakpoint
CREATE INDEX "claims_entity_idx" ON "claims" USING btree ("tenant_id","entity_id");--> statement-breakpoint
CREATE INDEX "claims_evidence_idx" ON "claims" USING btree ("tenant_id","evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_merges_one_active_per_merged" ON "entity_merges" USING btree ("tenant_id","merged_entity_id") WHERE "entity_merges"."reverted_at" is null;--> statement-breakpoint
CREATE INDEX "entity_merges_surviving_idx" ON "entity_merges" USING btree ("tenant_id","surviving_entity_id");--> statement-breakpoint
CREATE INDEX "evidence_content_hash_idx" ON "evidence" USING btree ("tenant_id","content_hash");