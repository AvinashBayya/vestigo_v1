CREATE TYPE "public"."report_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TABLE "reports" (
	"tenant_id" uuid NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"status" "report_status" NOT NULL,
	"include_synthesis" boolean NOT NULL,
	"requested_by_user_id" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"document" jsonb,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "reports_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "reports_attempts_non_negative" CHECK ("reports"."attempts" >= 0),
	CONSTRAINT "reports_document_only_succeeded" CHECK (("reports"."document" is not null) = ("reports"."status" = 'SUCCEEDED')),
	CONSTRAINT "reports_error_consistent" CHECK (("reports"."error_code" is null) = ("reports"."error_message" is null)),
	CONSTRAINT "reports_finished_after_started" CHECK ("reports"."finished_at" is null or "reports"."started_at" is null or "reports"."finished_at" >= "reports"."started_at")
);
--> statement-breakpoint
ALTER TABLE "usage_events" DROP CONSTRAINT "usage_events_attempt_with_job";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "report_handling_marking" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "report_id" uuid;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_requested_by_fk" FOREIGN KEY ("tenant_id","requested_by_user_id") REFERENCES "public"."users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_run_idx" ON "reports" USING btree ("tenant_id","run_id");--> statement-breakpoint
-- NOT VALID: report_id was added above, so every existing row holds null and
-- there is nothing to validate. Validating would scan usage_events, whose
-- forced row-level security refuses a scan with no tenant set. The key is
-- enforced for every row written from here on.
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."reports"("tenant_id","id") ON DELETE no action ON UPDATE no action NOT VALID;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_one_per_report_attempt" ON "usage_events" USING btree ("tenant_id","report_id","attempt","unit") WHERE "usage_events"."report_id" is not null;--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_report_handling_marking_format" CHECK ("tenants"."report_handling_marking" is null or ("tenants"."report_handling_marking" = btrim("tenants"."report_handling_marking") and length("tenants"."report_handling_marking") between 1 and 80 and "tenants"."report_handling_marking" !~ '[[:cntrl:]]'));--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_attempt_with_work" CHECK ("usage_events"."attempt" is null or "usage_events"."job_id" is not null or "usage_events"."report_id" is not null);--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_one_work_item" CHECK (num_nonnulls("usage_events"."job_id", "usage_events"."report_id") <= 1);