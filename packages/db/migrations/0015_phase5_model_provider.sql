ALTER TABLE "usage_events" ADD COLUMN "model_calls" jsonb;--> statement-breakpoint
-- NOT VALID: model_calls was added above, so every existing row holds null and
-- satisfies the check; validating would only scan usage_events under lock. The
-- check is enforced for every row written from here on.
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_model_calls_with_report" CHECK ("usage_events"."model_calls" is null or ("usage_events"."report_id" is not null and jsonb_typeof("usage_events"."model_calls") = 'array' and jsonb_array_length("usage_events"."model_calls") >= 1)) NOT VALID;
