-- Phase 5 follow-up: a report's PDF, rendered once in the worker and stored.
-- Tenant isolation as for every table, the lifecycle columns the application
-- may move, and the database's own guarantee that a stored PDF is written once.

-- ── 1. Report PDFs: the same tenant isolation as every table ──────────────
ALTER TABLE public.report_pdfs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.report_pdfs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.report_pdfs AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));
--> statement-breakpoint

-- The render lifecycle moves only these columns. report_id is written at creation.
GRANT SELECT, INSERT ON public.report_pdfs TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, attempts, content_hash, byte_length, error_code, error_message, started_at, finished_at)
  ON public.report_pdfs TO app_runtime;
--> statement-breakpoint

-- ── 2. A stored PDF is written once ───────────────────────────────────────
-- Every download of a report must be the same file. A retried or replayed
-- render must never replace a stored one (CLAUDE.md §5), and a finished
-- render (READY or FAILED) never changes state again.
CREATE FUNCTION app.report_pdfs_record_once() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.content_hash IS NOT NULL AND (
    NEW.content_hash IS DISTINCT FROM OLD.content_hash OR
    NEW.byte_length IS DISTINCT FROM OLD.byte_length
  ) THEN
    RAISE EXCEPTION 'a report''s stored PDF is written once' USING ERRCODE = 'REP01';
  END IF;
  IF OLD.status IN ('READY', 'FAILED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a finished PDF render keeps its status' USING ERRCODE = 'REP01';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.report_pdfs_record_once() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER report_pdfs_record_once BEFORE UPDATE ON public.report_pdfs
  FOR EACH ROW EXECUTE FUNCTION app.report_pdfs_record_once();
