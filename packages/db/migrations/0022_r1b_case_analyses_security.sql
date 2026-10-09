-- R1-b: isolation and grants for case analyses, and the database's own
-- guarantee that an analysis, and every record of where it stands, is written
-- once.

-- ── 1. The same tenant isolation as every table ───────────────────────────
ALTER TABLE public.case_analyses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.case_analyses FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.case_analyses AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));
--> statement-breakpoint
ALTER TABLE public.case_analysis_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.case_analysis_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.case_analysis_events AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));
--> statement-breakpoint

-- ── 2. Read and append only ───────────────────────────────────────────────
-- The application may read and add rows, and nothing else: no UPDATE and no
-- DELETE grant on either table. Where an analysis stands changes by adding an
-- event, never by rewriting one.
GRANT SELECT, INSERT ON public.case_analyses TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.case_analysis_events TO app_runtime;
--> statement-breakpoint

-- ── 3. Written once, even by the schema owner ─────────────────────────────
-- A stored analysis is a record of what the platform computed from one input.
-- No role may rewrite a row, including the owner, which the grants above do
-- not bind. DELETE is not refused here: when retention is enforced, removing
-- an analysis with the evidence it rests on is a delete (CLAUDE.md §9), and
-- nothing here may block it. TRUNCATE is refused: it would remove every
-- tenant's rows at once.
CREATE FUNCTION app.case_analyses_record_once() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'a case analysis is written once: % on % is not permitted', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'CAN01';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.case_analyses_record_once() FROM PUBLIC;
--> statement-breakpoint
-- Statement-level triggers fire even when no row matches.
CREATE TRIGGER case_analyses_no_update BEFORE UPDATE ON public.case_analyses
  FOR EACH STATEMENT EXECUTE FUNCTION app.case_analyses_record_once();
--> statement-breakpoint
CREATE TRIGGER case_analyses_no_truncate BEFORE TRUNCATE ON public.case_analyses
  FOR EACH STATEMENT EXECUTE FUNCTION app.case_analyses_record_once();
--> statement-breakpoint
CREATE TRIGGER case_analysis_events_no_update BEFORE UPDATE ON public.case_analysis_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.case_analyses_record_once();
--> statement-breakpoint
CREATE TRIGGER case_analysis_events_no_truncate BEFORE TRUNCATE ON public.case_analysis_events
  FOR EACH STATEMENT EXECUTE FUNCTION app.case_analyses_record_once();
--> statement-breakpoint

-- ── 4. Events in order ────────────────────────────────────────────────────
-- An analysis's events follow one order: attempt 1 is requested (PENDING) and
-- finishes once (COMPLETE or FAILED); a further attempt is requested only after
-- the latest one FAILED; nothing follows a COMPLETE. The unique indexes stop a
-- duplicate request, a second finish and a second document; this stops a
-- finish with no request, a retry before a failure, and anything after a
-- document. It runs after the insert, so row-level security refuses a row of
-- another tenant first, before this could say anything about that tenant.
CREATE FUNCTION app.case_analysis_events_in_order() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest integer;
  latest_status public.case_analysis_status;
BEGIN
  SELECT e.attempt, e.status INTO latest, latest_status
    FROM public.case_analysis_events e
   WHERE e.tenant_id = NEW.tenant_id AND e.analysis_id = NEW.analysis_id AND e.id <> NEW.id
   ORDER BY e.attempt DESC, (e.status <> 'PENDING') DESC
   LIMIT 1;
  IF NEW.status = 'PENDING' THEN
    IF latest IS NULL AND NEW.attempt = 1 THEN
      RETURN NULL;
    END IF;
    IF latest = NEW.attempt - 1 AND latest_status = 'FAILED' THEN
      RETURN NULL;
    END IF;
  ELSE
    IF latest = NEW.attempt AND latest_status = 'PENDING' THEN
      RETURN NULL;
    END IF;
  END IF;
  RAISE EXCEPTION 'case analysis events are out of order: % for attempt % after %',
    NEW.status, NEW.attempt, coalesce(latest_status::text || ' of attempt ' || latest::text, 'none')
    USING ERRCODE = 'CAN02';
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.case_analysis_events_in_order() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER case_analysis_events_in_order AFTER INSERT ON public.case_analysis_events
  FOR EACH ROW EXECUTE FUNCTION app.case_analysis_events_in_order();
