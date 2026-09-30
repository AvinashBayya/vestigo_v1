ALTER TABLE "auth"."invitation" ADD COLUMN "enrolment_token_hash" text;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD COLUMN "mfa_enrolment_token_hash" text;--> statement-breakpoint
ALTER TABLE "auth"."user" ADD COLUMN "mfa_enrolment_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth"."invitation" ADD CONSTRAINT "invitation_enrolment_token_hashed" CHECK ("auth"."invitation"."enrolment_token_hash" is null or "auth"."invitation"."enrolment_token_hash" ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "auth"."user" ADD CONSTRAINT "user_mfa_enrolment_token_complete" CHECK (("auth"."user"."mfa_enrolment_token_hash" is null) = ("auth"."user"."mfa_enrolment_token_expires_at" is null));--> statement-breakpoint
ALTER TABLE "auth"."user" ADD CONSTRAINT "user_mfa_enrolment_token_hashed" CHECK ("auth"."user"."mfa_enrolment_token_hash" is null or "auth"."user"."mfa_enrolment_token_hash" ~ '^sha256:[0-9a-f]{64}$');