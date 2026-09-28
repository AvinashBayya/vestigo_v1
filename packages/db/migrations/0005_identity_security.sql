-- Identity separation, entitlement protection and entitlement auditing.
--
-- The auth schema is the one exception to "every table carries tenant_id"
-- (CLAUDE.md §2, amended in Phase 2B). Three roles, three disjoint reaches:
--   app_auth     the identity provider: the auth schema only, no tenant data;
--   app_runtime  the application: tenant data only, nothing in auth;
--   app_owner    migrations.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_auth') THEN
    RAISE EXCEPTION 'role app_auth is missing'
      USING HINT = 'It is created by platform provisioning; locally, by infra/postgres/init/01-bootstrap.sql.';
  END IF;
END;
$$;
--> statement-breakpoint

-- ── 1. The auth schema: app_auth only ──────────────────────────────────────
REVOKE ALL ON SCHEMA auth FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO app_auth;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO app_auth;
--> statement-breakpoint

-- ── 2. Plan and vetting: never writable by the application ─────────────────
-- A tenant may insert only its name and region, so plan and vetting always
-- start on their defaults; it already has UPDATE on name alone. Changing
-- either is an operator action, audited by the trigger below.
REVOKE INSERT ON public.tenants FROM app_runtime;
--> statement-breakpoint
GRANT INSERT (tenant_id, name, region) ON public.tenants TO app_runtime;
--> statement-breakpoint

-- API key rotation brings the old key's expiry forward.
GRANT UPDATE (expires_at) ON public.api_keys TO app_runtime;
--> statement-breakpoint

-- ── 3. Every entitlement change is audited, whoever makes it ───────────────
CREATE FUNCTION app.audit_tenant_entitlement_change() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.audit_log (tenant_id, actor_kind, action, target_type, target_id, details, auth_method)
  VALUES (
    NEW.tenant_id,
    'SYSTEM',
    'tenant.entitlement_change',
    'tenant',
    NEW.tenant_id::text,
    jsonb_build_object(
      'plan', jsonb_build_object('from', OLD.plan, 'to', NEW.plan),
      'vetting_status', jsonb_build_object('from', OLD.vetting_status, 'to', NEW.vetting_status),
      'database_role', current_user
    ),
    'SYSTEM'
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.audit_tenant_entitlement_change() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER tenants_entitlement_audit AFTER UPDATE OF plan, vetting_status ON public.tenants
  FOR EACH ROW
  WHEN (OLD.plan IS DISTINCT FROM NEW.plan OR OLD.vetting_status IS DISTINCT FROM NEW.vetting_status)
  EXECUTE FUNCTION app.audit_tenant_entitlement_change();
