-- Track M D-M1 (Day 1): a run on a person target type (a TOPIC: free text that
-- may name a person) is person-bearing, and the database keeps that true for
-- every job collected in it.
--
-- 1. runs.person_bearing is set once, by the runs repository, when the run is
--    created (0025). The application role's UPDATE grants on runs (0002:
--    status, started_at, finished_at; 0010: plan) do not include it, so the
--    application can never clear it, nor set it afterwards. INSERT on runs is
--    granted table-wide, so nothing is granted here.
--
-- 2. A job on a person target type must sit in a person-bearing run. The
--    person-data probe reads the run's record, so such a job in a run without
--    it would leave what it collected outside the person gate. The planner
--    never makes one (plannedTargetTypes in @repo/access); this makes it
--    impossible. The types are PERSON_TARGET_TYPES in @repo/access, compared
--    as text because a new enum value cannot be used in the transaction that
--    adds it; packages/db/test/person-target.test.ts checks every target type
--    against that list. It runs after the insert, so row-level security
--    refuses another tenant's row first, before this could say anything about
--    that tenant's runs.
CREATE FUNCTION app.jobs_person_target_in_person_run() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.target_type IS NOT NULL AND NEW.target_type::text IN ('TOPIC') AND NOT EXISTS (
    SELECT 1 FROM public.runs r
     WHERE r.tenant_id = NEW.tenant_id AND r.id = NEW.run_id AND r.person_bearing
  ) THEN
    RAISE EXCEPTION 'a job on a % target must be in a person-bearing run', NEW.target_type
      USING ERRCODE = 'PTT01';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.jobs_person_target_in_person_run() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER jobs_person_target_in_person_run
  AFTER INSERT OR UPDATE OF target_type, run_id ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION app.jobs_person_target_in_person_run();
