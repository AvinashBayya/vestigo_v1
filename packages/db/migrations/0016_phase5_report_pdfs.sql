CREATE TYPE "public"."report_pdf_status" AS ENUM('PENDING', 'RENDERING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "report_pdfs" (
	"tenant_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"status" "report_pdf_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"content_hash" text,
	"byte_length" bigint,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "report_pdfs_pk" PRIMARY KEY("tenant_id","report_id"),
	CONSTRAINT "report_pdfs_attempts_non_negative" CHECK ("report_pdfs"."attempts" >= 0),
	CONSTRAINT "report_pdfs_file_only_ready" CHECK (("report_pdfs"."content_hash" is not null) = ("report_pdfs"."status" = 'READY') and ("report_pdfs"."byte_length" is not null) = ("report_pdfs"."status" = 'READY')),
	CONSTRAINT "report_pdfs_content_hash_format" CHECK ("report_pdfs"."content_hash" is null or "report_pdfs"."content_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "report_pdfs_byte_length_positive" CHECK ("report_pdfs"."byte_length" is null or "report_pdfs"."byte_length" > 0),
	CONSTRAINT "report_pdfs_error_only_failed" CHECK (("report_pdfs"."error_code" is not null) = ("report_pdfs"."status" = 'FAILED') and ("report_pdfs"."error_message" is not null) = ("report_pdfs"."status" = 'FAILED')),
	CONSTRAINT "report_pdfs_finished_after_started" CHECK ("report_pdfs"."finished_at" is null or "report_pdfs"."started_at" is null or "report_pdfs"."finished_at" >= "report_pdfs"."started_at")
);
--> statement-breakpoint
ALTER TABLE "report_pdfs" ADD CONSTRAINT "report_pdfs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_pdfs" ADD CONSTRAINT "report_pdfs_report_fk" FOREIGN KEY ("tenant_id","report_id") REFERENCES "public"."reports"("tenant_id","id") ON DELETE no action ON UPDATE no action;