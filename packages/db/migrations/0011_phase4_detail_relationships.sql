ALTER TABLE "jobs" ADD COLUMN "outcome_detail" text;--> statement-breakpoint
ALTER TABLE "entity_relationships" ADD CONSTRAINT "entity_relationships_one_per_kind" UNIQUE("tenant_id","source_entity_id","target_entity_id","kind");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_detail_only_not_found" CHECK ("jobs"."outcome_detail" is null or "jobs"."outcome" = 'NOT_FOUND');--> statement-breakpoint
-- The lifecycle records a NOT_FOUND's detail with its outcome.
GRANT UPDATE (outcome_detail) ON public.jobs TO app_runtime;
