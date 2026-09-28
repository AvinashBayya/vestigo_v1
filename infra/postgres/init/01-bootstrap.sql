-- Local stand-in for managed-database provisioning. Runs once, as the
-- superuser, when the docker compose volume is first initialised. Nothing in
-- the application or its tooling connects as the superuser afterwards.
--
-- Roles:
--   app_owner    owns the schema and runs migrations. Not a superuser and no
--                BYPASSRLS; every table forces row-level security, so it is
--                subject to the tenant policies too. CREATEDB lets the test
--                suite recreate its database; production does not grant it.
--   app_runtime  the only role the API and worker use. No superuser, no
--                BYPASSRLS, owns nothing, so row-level security always applies.
--
-- Passwords are local development values; both roles are reachable only on
-- 127.0.0.1 (see docker-compose.yml).

create role app_owner login password 'app_owner'
  nosuperuser nobypassrls createdb nocreaterole noreplication;

create role app_runtime login password 'app_runtime'
  nosuperuser nobypassrls nocreatedb nocreaterole noreplication;

create database app owner app_owner;
revoke all on database app from public;
grant connect on database app to app_runtime;

-- pgvector's control file is not marked trusted, so only a superuser can
-- create it. Installing it here, in template1 as well, means the first
-- migration's `create extension if not exists vector` finds it present in
-- every database created from the template, including the test database.
\connect template1
create extension if not exists vector;

\connect app
create extension if not exists vector;
