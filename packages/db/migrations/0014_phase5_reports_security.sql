-- Phase 5: isolation and grants for reports, the tenant's report handling
-- marking, and the database's own guarantee that a report's document is
-- written once.

-- ── 1. Reports: the same tenant isolation as every table ──────────────────
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.reports AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));
--> statement-breakpoint

-- The generation lifecycle moves only these columns. run_id, include_synthesis
-- and requested_by_user_id are written at creation (INSERT covers them).
GRANT SELECT, INSERT ON public.reports TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, attempts, document, error_code, error_message, started_at, finished_at)
  ON public.reports TO app_runtime;
--> statement-breakpoint

-- ── 2. A report's document is written once ────────────────────────────────
-- A generated report is a record of what the platform said at that moment. A
-- retried or replayed generation must never replace it (CLAUDE.md §5), and a
-- finished report never changes state again.
CREATE FUNCTION app.reports_record_once() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.document IS NOT NULL AND NEW.document IS DISTINCT FROM OLD.document THEN
    RAISE EXCEPTION 'a report''s document is written once' USING ERRCODE = 'REP01';
  END IF;
  IF OLD.status IN ('SUCCEEDED', 'FAILED') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'a finished report keeps its status' USING ERRCODE = 'REP01';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.reports_record_once() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER reports_record_once BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION app.reports_record_once();
--> statement-breakpoint

-- ── 3. The tenant's handling marking ──────────────────────────────────────
-- Tenant administrators set it through the API; the column check bounds it.
GRANT UPDATE (report_handling_marking) ON public.tenants TO app_runtime;
