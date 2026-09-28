CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('ALLOWED', 'DENIED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."auth_method" AS ENUM('SESSION', 'API_KEY', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."tenant_plan" AS ENUM('TECHINT', 'TECHINT_AND_PERSON');--> statement-breakpoint
CREATE TYPE "public"."vetting_status" AS ENUM('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TABLE "auth"."account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."invitation" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_status_known" CHECK ("auth"."invitation"."status" in ('pending', 'accepted', 'rejected', 'canceled')),
	CONSTRAINT "invitation_role_known" CHECK ("auth"."invitation"."role" ~ '^(owner|admin|analyst|viewer)(,(owner|admin|analyst|viewer))*$')
);
--> statement-breakpoint
CREATE TABLE "auth"."member" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_organization_user_key" UNIQUE("organization_id","user_id"),
	CONSTRAINT "member_role_known" CHECK ("auth"."member"."role" ~ '^(owner|admin|analyst|viewer)(,(owner|admin|analyst|viewer))*$')
);
--> statement-breakpoint
CREATE TABLE "auth"."organization" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "auth"."rate_limit" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth"."session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_key" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."two_factor" (
	"id" uuid PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth"."user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_key" UNIQUE("email"),
	CONSTRAINT "user_email_normalised" CHECK ("auth"."user"."email" = lower("auth"."user"."email"))
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "rotated_from_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "auth_method" "auth_method";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "permission" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "outcome" "audit_outcome";--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan" "tenant_plan" DEFAULT 'TECHINT' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "vetting_status" "vetting_status" DEFAULT 'NOT_SUBMITTED' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."invitation" ADD CONSTRAINT "invitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."invitation" ADD CONSTRAINT "invitation_inviter_id_user_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "auth"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "auth"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "auth"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitation_organization_idx" ON "auth"."invitation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "auth"."invitation" USING btree ("email");--> statement-breakpoint
CREATE INDEX "member_user_idx" ON "auth"."member" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "auth"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factor_user_idx" ON "auth"."two_factor" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "auth"."verification" USING btree ("identifier");--> statement-breakpoint
-- Hand edit: validating a new foreign key scans the table, and forced
-- row-level security would limit (here: refuse) that scan without a tenant.
-- FORCE is lifted for this one statement so validation sees every tenant's
-- rows; the migration is a single transaction, so no other session ever sees
-- the table unforced.
ALTER TABLE "api_keys" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_rotated_from_fk" FOREIGN KEY ("tenant_id","rotated_from_id") REFERENCES "public"."api_keys"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_permissions_format" CHECK (array_to_string("api_keys"."permissions", ',') ~ '^([a-z][a-z_]*:[a-z][a-z_]*(,[a-z][a-z_]*:[a-z][a-z_]*)*)?$');--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_not_rotated_from_self" CHECK ("api_keys"."rotated_from_id" is distinct from "api_keys"."id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_outcome_has_authorisation" CHECK ("audit_log"."outcome" is null or "audit_log"."auth_method" is not null);--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_permission_format" CHECK ("audit_log"."permission" is null or "audit_log"."permission" ~ '^[a-z][a-z_]*:[a-z][a-z_]*$');--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_session_matches_method" CHECK ("audit_log"."session_id" is null or "audit_log"."auth_method" = 'SESSION');