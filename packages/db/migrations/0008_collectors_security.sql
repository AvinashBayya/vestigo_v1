-- Phase 3A: isolation and grants for scope authorisations, and the database's
-- own refusal of evidence from a collector that is not enabled.

-- ── 1. Scope authorisations: the same tenant isolation as every table ──────
ALTER TABLE public.scope_authorisations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.scope_authorisations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public.scope_authorisations AS PERMISSIVE FOR ALL TO PUBLIC
  USING (tenant_id = (SELECT app.current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));
--> statement-breakpoint

-- Recorded, then only ever revoked: nothing else about an authorisation changes.
GRANT SELECT, INSERT ON public.scope_authorisations TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (revoked_at) ON public.scope_authorisations TO app_runtime;
--> statement-breakpoint

-- ── 2. Evidence only from an enabled collector ─────────────────────────────
-- The application writes evidence through one path that checks the platform
-- catalogue first. This is the second, independent layer: whatever path a row
-- takes, the database refuses it unless the tenant's registry row for its
-- collector is enabled, and a BLOCKED collector can never be enabled
-- (collectors_registry_blocked_never_enabled). Runs with the inserting role's
-- rights, so row-level security scopes the lookup to the row's own tenant.
--
-- AFTER, not BEFORE: row-level security, CHECK constraints and the foreign
-- keys (whose RI_ triggers sort ahead of this one) all refuse a bad row first.
-- A BEFORE trigger would answer every cross-tenant insert itself and hide
-- those layers from the tests that prove each one independently.
CREATE FUNCTION app.evidence_requires_enabled_collector() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.collectors_registry r
    WHERE r.tenant_id = NEW.tenant_id AND r.collector_id = NEW.collector_id AND r.enabled
  ) THEN
    RAISE EXCEPTION 'evidence refused: its collector is not enabled for this tenant'
      USING ERRCODE = 'COL01';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.evidence_requires_enabled_collector() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER evidence_requires_enabled_collector AFTER INSERT ON public.evidence
  FOR EACH ROW EXECUTE FUNCTION app.evidence_requires_enabled_collector();
