CREATE TYPE "public"."job_outcome" AS ENUM('FOUND', 'NOT_FOUND', 'FAILED', 'UNAVAILABLE', 'NEEDS_CREDENTIALS', 'REFUSED');--> statement-breakpoint
CREATE TYPE "public"."quota_period" AS ENUM('DAY', 'MONTH');--> statement-breakpoint
ALTER TYPE "public"."usage_unit" ADD VALUE 'UPSTREAM_REQUEST';--> statement-breakpoint
CREATE TABLE "tenant_quotas" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"unit" "usage_unit" NOT NULL,
	"period" "quota_period" NOT NULL,
	"max_quantity" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_quotas_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "tenant_quotas_one_per_unit_period" UNIQUE("tenant_id","unit","period"),
	CONSTRAINT "tenant_quotas_max_quantity_non_negative" CHECK ("tenant_quotas"."max_quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "identifier" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "target_type" "target_type";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "target" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "params" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "outcome" "job_outcome";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "evidence_ids" uuid[];--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "fused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "requested_target_type" "target_type";--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "attempt" integer;--> statement-breakpoint
ALTER TABLE "tenant_quotas" ADD CONSTRAINT "tenant_quotas_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entities_one_per_identifier" ON "entities" USING btree ("tenant_id","kind","identifier") WHERE "entities"."identifier" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_one_per_attempt" ON "usage_events" USING btree ("tenant_id","job_id","attempt","unit") WHERE "usage_events"."job_id" is not null;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_identifier_not_blank" CHECK ("entities"."identifier" is null or length(btrim("entities"."identifier")) > 0);--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_named_kinds_external_identifier_only" CHECK ("entities"."identifier" is null or "entities"."kind" not in ('PERSON', 'ORGANIZATION') or "entities"."identifier" ~ '^[a-z][a-z0-9_.-]*:[^ ]+$');--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_result_only_found" CHECK ("jobs"."result" is null or "jobs"."outcome" = 'FOUND');--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_evidence_only_found" CHECK ("jobs"."evidence_ids" is null or "jobs"."outcome" = 'FOUND');--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_fused_only_found" CHECK ("jobs"."fused_at" is null or "jobs"."outcome" = 'FOUND');--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_target_complete" CHECK (("jobs"."target_type" is null) = ("jobs"."target" is null));--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_attempt_positive" CHECK ("usage_events"."attempt" is null or "usage_events"."attempt" >= 1);--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_attempt_with_job" CHECK ("usage_events"."attempt" is null or "usage_events"."job_id" is not null);