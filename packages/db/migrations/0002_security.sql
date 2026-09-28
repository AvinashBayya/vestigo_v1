-- Tenant isolation, privileges, append-only guarantees and evidence partitions.
--
-- Isolation has three independent layers; each is tested on its own:
--   1. Row-level security, ENABLED and FORCED on every table, so it applies to
--      the application role and to the owner alike (only a superuser or a
--      BYPASSRLS role escapes it, and neither is used by the application).
--   2. Composite foreign keys (tenant_id, x_id): a row can only reference rows
--      of its own tenant, whatever the policies say.
--   3. Least-privilege grants: the application role gets exactly the verbs each
--      table needs. Append-only tables get SELECT and INSERT; updatable tables
--      get UPDATE on named columns only, so tenant_id and ids are immutable.

-- ── 1. Row-level security ──────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tenants', 'users', 'roles', 'permissions', 'memberships', 'api_keys',
    'audit_log', 'collectors_registry', 'investigations', 'runs', 'jobs',
    'evidence', 'entities', 'entity_relationships', 'entity_merges', 'claims',
    'cases', 'case_pins', 'monitors', 'alerts', 'credentials', 'usage_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I AS PERMISSIVE FOR ALL TO PUBLIC '
      'USING (tenant_id = (SELECT app.current_tenant_id())) '
      'WITH CHECK (tenant_id = (SELECT app.current_tenant_id()))',
      t
    );
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ── 2. Privileges for the application role ─────────────────────────────────
GRANT USAGE ON SCHEMA app TO app_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_tenant_id(), app.uuid_generate_v7(), app.uuid_v7_timestamp(uuid)
  TO app_runtime;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.tenants TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (name) ON public.tenants TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.users TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (email, display_name, status) ON public.users TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.roles TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (name, description) ON public.roles TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.permissions TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.memberships TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.api_keys TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (name, last_used_at, revoked_at) ON public.api_keys TO app_runtime;
--> statement-breakpoint
-- Insert-only at the grant level: no UPDATE, no DELETE, no TRUNCATE.
GRANT SELECT, INSERT ON public.audit_log TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.collectors_registry TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (source_label, discipline, collection_mode, data_licence, commercial_use, enabled, disabled_reason)
  ON public.collectors_registry TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.investigations TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (title, archived_at) ON public.investigations TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.runs TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, started_at, finished_at) ON public.runs TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.jobs TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (status, attempts, last_error_code, last_error_message, started_at, finished_at)
  ON public.jobs TO app_runtime;
--> statement-breakpoint
-- Append-only.
GRANT SELECT, INSERT ON public.evidence TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.entities TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (display_name) ON public.entities TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.entity_relationships TO app_runtime;
--> statement-breakpoint
-- A merge may only ever be reverted; nothing else about it can change.
GRANT SELECT, INSERT ON public.entity_merges TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (reverted_at, reverted_by_kind, reverted_by_user_id, reverted_by_rule, revert_reason)
  ON public.entity_merges TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.claims TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.cases TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (title, description, archived_at) ON public.cases TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.case_pins TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.monitors TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (name, target, schedule_cron, enabled) ON public.monitors TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.alerts TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (acknowledged_at, acknowledged_by_user_id) ON public.alerts TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.credentials TO app_runtime;
--> statement-breakpoint
GRANT UPDATE (label, last_used_at, revoked_at) ON public.credentials TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public.usage_events TO app_runtime;
--> statement-breakpoint

-- ── 3. Append-only guarantees, for every role ──────────────────────────────
CREATE FUNCTION app.forbid_modification() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'APP01';
END;
$$;
--> statement-breakpoint
-- Statement-level triggers fire even when no row matches; the row-level one is
-- cloned onto every evidence partition.
CREATE TRIGGER evidence_no_update_statement BEFORE UPDATE ON public.evidence
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_modification();
--> statement-breakpoint
CREATE TRIGGER evidence_no_update_row BEFORE UPDATE ON public.evidence
  FOR EACH ROW EXECUTE FUNCTION app.forbid_modification();
--> statement-breakpoint
CREATE TRIGGER evidence_no_truncate BEFORE TRUNCATE ON public.evidence
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_modification();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_modification();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_modification();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app.forbid_modification();
--> statement-breakpoint

-- ── 4. Entity merge rules ──────────────────────────────────────────────────
CREATE FUNCTION app.entity_merges_before_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Serialise merge decisions within a tenant. Without this, "A into B" and
  -- "B into A" committed concurrently would each pass the check below.
  PERFORM pg_advisory_xact_lock(hashtextextended('entity_merges:' || NEW.tenant_id::text, 0));

  -- The survivor must be canonical. Every active merge then points at an
  -- entity that was canonical when it was made, so merges can never cycle.
  IF EXISTS (
    SELECT 1 FROM public.entity_merges m
    WHERE m.tenant_id = NEW.tenant_id
      AND m.merged_entity_id = NEW.surviving_entity_id
      AND m.reverted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'the surviving entity has itself been merged into another entity'
      USING ERRCODE = 'MRG01';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entity_merges_rules BEFORE INSERT ON public.entity_merges
  FOR EACH ROW EXECUTE FUNCTION app.entity_merges_before_insert();
--> statement-breakpoint
CREATE FUNCTION app.entity_merges_before_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'this merge has already been reverted; a revert is final'
      USING ERRCODE = 'MRG02';
  END IF;
  IF NEW.reverted_at IS NULL
    OR (NEW.tenant_id, NEW.id, NEW.entity_kind, NEW.surviving_entity_id, NEW.merged_entity_id,
        NEW.reason, NEW.confidence, NEW.match_signals, NEW.merged_by_kind, NEW.merged_by_user_id,
        NEW.merged_by_rule, NEW.created_at)
      IS DISTINCT FROM
       (OLD.tenant_id, OLD.id, OLD.entity_kind, OLD.surviving_entity_id, OLD.merged_entity_id,
        OLD.reason, OLD.confidence, OLD.match_signals, OLD.merged_by_kind, OLD.merged_by_user_id,
        OLD.merged_by_rule, OLD.created_at)
  THEN
    RAISE EXCEPTION 'the only permitted change to a merge is reverting it'
      USING ERRCODE = 'MRG03';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entity_merges_revert_only BEFORE UPDATE ON public.entity_merges
  FOR EACH ROW EXECUTE FUNCTION app.entity_merges_before_update();
--> statement-breakpoint

-- ── 5. Evidence partitions ─────────────────────────────────────────────────
-- Partitions live in their own schema, on which the application role has no
-- privileges, so evidence is reachable only through public.evidence and its
-- policy. Each partition also forces row-level security with no policy, so
-- even the owner cannot read or write a partition directly.
CREATE SCHEMA evidence_partitions;
--> statement-breakpoint
REVOKE ALL ON SCHEMA evidence_partitions FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION app.ensure_evidence_partitions(first_month date, month_count integer) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  month_local timestamp;
  partition_name text;
  created integer := 0;
BEGIN
  IF month_count < 1 THEN
    RAISE EXCEPTION 'month_count must be at least 1' USING ERRCODE = '22023';
  END IF;
  FOR i IN 0 .. month_count - 1 LOOP
    -- Month arithmetic on a zone-less timestamp, then read as UTC, so the
    -- boundaries do not move with the session's TimeZone setting.
    month_local := date_trunc('month', first_month::timestamp) + make_interval(months => i);
    partition_name := 'evidence_' || to_char(month_local, 'YYYY_MM');
    IF to_regclass(format('evidence_partitions.%I', partition_name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE evidence_partitions.%I PARTITION OF public.evidence FOR VALUES FROM (%L) TO (%L)',
        partition_name,
        app.uuid_v7_lower_bound(month_local AT TIME ZONE 'UTC'),
        app.uuid_v7_lower_bound((month_local + interval '1 month') AT TIME ZONE 'UTC')
      );
      EXECUTE format('ALTER TABLE evidence_partitions.%I ENABLE ROW LEVEL SECURITY', partition_name);
      EXECUTE format('ALTER TABLE evidence_partitions.%I FORCE ROW LEVEL SECURITY', partition_name);
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.ensure_evidence_partitions(date, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.forbid_modification(), app.entity_merges_before_insert(), app.entity_merges_before_update() FROM PUBLIC;
--> statement-breakpoint
-- A fixed range so this migration is deterministic. scripts/migrate.ts also
-- ensures the current month and the next twelve on every run.
SELECT app.ensure_evidence_partitions('2026-09-01', 28);
