-- Foundation: extensions and the functions the tables depend on.
--
-- Migrations are forward-only and expand-then-contract (CLAUDE.md §8). They run
-- as the schema owner (app_owner), never as a superuser.

-- pgvector's control file is not marked trusted, so creating it needs a
-- superuser. Where the platform has already installed it (local compose does,
-- in infra/postgres/init/01-bootstrap.sql) this is a no-op: Postgres checks for
-- an existing extension before it checks privileges. Where the migration role
-- may create extensions, this creates it.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE SCHEMA app;
--> statement-breakpoint
REVOKE ALL ON SCHEMA app FROM PUBLIC;
--> statement-breakpoint

-- The tenant of the current transaction, set by the application's withTenant()
-- helper with set_config(..., is_local => true). Every row-level security
-- policy compares tenant_id against this. With no context it raises instead of
-- returning null, so a query that reaches a row without a tenant fails loudly.
CREATE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE plpgsql STABLE PARALLEL SAFE
AS $$
DECLARE
  raw text := current_setting('app.tenant_id', true);
BEGIN
  IF raw IS NULL OR raw = '' THEN
    RAISE EXCEPTION 'tenant context is not set'
      USING ERRCODE = 'TNT01', HINT = 'Run tenant-scoped queries inside withTenant().';
  END IF;
  RETURN raw::uuid;
END;
$$;
--> statement-breakpoint

-- RFC 9562 UUIDv7: 48-bit Unix-millisecond timestamp, version 7, then random
-- bits. Postgres compares uuids byte by byte, so v7 ids sort by creation time
-- and a calendar month is one contiguous id range, which is what the evidence
-- partitions use.
CREATE FUNCTION app.uuid_generate_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;
--> statement-breakpoint

-- The creation time encoded in a UUIDv7. Immutable, so it can define a
-- generated column.
CREATE FUNCTION app.uuid_v7_timestamp(id uuid) RETURNS timestamptz
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT to_timestamp(('x' || substr(replace(id::text, '-', ''), 1, 12))::bit(48)::bigint / 1000.0)
$$;
--> statement-breakpoint

-- The smallest UUIDv7 that can be generated at or after `ts`: a partition bound.
CREATE FUNCTION app.uuid_v7_lower_bound(ts timestamptz) RETURNS uuid
LANGUAGE sql STABLE STRICT PARALLEL SAFE
AS $$
  SELECT (lpad(to_hex(floor(extract(epoch FROM ts) * 1000)::bigint), 12, '0') || repeat('0', 20))::uuid
$$;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
