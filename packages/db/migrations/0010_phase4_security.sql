-- Phase 4: isolation and grants for tenant quotas, the new job and run
-- columns, and the database's own guarantees that a job's recorded result is
-- written once.

-- ── 1. Tenant quotas: the same tenant isolation as every table ─────────────
ALTER TABLE public.tenant_quotas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.tenant_quotas FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.tenant_quotas AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));
--> statement-breakpoint

-- Quotas are set by an operator. The application only reads them, so a tenant
-- can never raise its own limit through any application path.
GRANT SELECT ON public.tenant_quotas TO app_runtime;
--> statement-breakpoint

-- ── 2. Jobs and runs: the columns the job lifecycle moves ─────────────────
-- target_type, target and params are written at creation only (INSERT covers
-- them); the lifecycle updates only these.
GRANT UPDATE (outcome, result, evidence_ids, next_attempt_at, dead_lettered_at, fused_at)
  ON public.jobs TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (plan) ON public.runs TO app_runtime;
--> statement-breakpoint

-- ── 3. A job's result, its evidence and its fusion are written once ───────
-- A replayed job must never replace the result it already recorded, point at
-- other evidence, or be fused twice (CLAUDE.md §5). Once set, these columns
-- are fixed for every role.
CREATE FUNCTION app.jobs_record_once() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result THEN
    RAISE EXCEPTION 'a job''s recorded result is written once' USING ERRCODE = 'JOB01';
  END IF;
  IF OLD.evidence_ids IS NOT NULL AND NEW.evidence_ids IS DISTINCT FROM OLD.evidence_ids THEN
    RAISE EXCEPTION 'a job''s evidence is written once' USING ERRCODE = 'JOB01';
  END IF;
  IF OLD.fused_at IS NOT NULL AND NEW.fused_at IS DISTINCT FROM OLD.fused_at THEN
    RAISE EXCEPTION 'a job is fused once' USING ERRCODE = 'JOB01';
  END IF;
  IF OLD.outcome = 'FOUND' AND NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    RAISE EXCEPTION 'a job that found a result keeps that outcome' USING ERRCODE = 'JOB01';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.jobs_record_once() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER jobs_record_once BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION app.jobs_record_once();
