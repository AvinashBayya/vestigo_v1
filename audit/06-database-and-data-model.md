# 06 — Database & Data Model

Scope: `packages/db` + `infra/postgres`. Postgres 17 + pgvector 0.8.6. Schema in Drizzle (`src/schema/*`), migrations hand-finished Drizzle-kit SQL (`migrations/0000`–`0027`). Evidence is `file:line`.

---

## 1. Roles & isolation model (the crown jewel)

Three login roles, **none superuser, none BYPASSRLS**, created once by `infra/postgres/init/01-bootstrap.sql`:
- **`app_owner`** — owns schema, runs migrations; subject to RLS too.
- **`app_runtime`** — the only role the API/worker use for tenant data; owns nothing; **no privilege on the `auth` schema**.
- **`app_auth`** — the identity provider; **`auth` schema only**; no tenant-data privilege.

The application refuses to start on a superuser/BYPASSRLS role (`UnsafeDatabaseRoleError`, `database.ts:76-86`); the migrator refuses likewise (`migrate.ts:44-48`); the API refuses to boot unless `authStore.verifyRole()` confirms the identity role cannot reach tenant data (`apps/api/src/server.ts:61-62`).

**Tenant isolation = three independent layers** (`migrations/0002`):
1. **RLS ENABLED + FORCED** on every public table, with one canonical policy created in a loop:
   ```sql
   CREATE POLICY tenant_isolation ON public.<t> AS PERMISSIVE FOR ALL TO PUBLIC
     USING (tenant_id = (SELECT app.current_tenant_id()))
     WITH CHECK (tenant_id = (SELECT app.current_tenant_id()));
   ```
   FORCE means it applies to the owner too.
2. **Composite foreign keys** `(tenant_id, x_id)` — a row can only reference its own tenant's rows regardless of policy.
3. **Least-privilege column grants** to `app_runtime`.

Tenant context is set per-transaction only via `set_config('app.tenant_id', $1, is_local=>true)` inside `withTenant()` (`database.ts:131`); `app.current_tenant_id()` **raises `TNT01` when unset** (`0000:28-33`) so a context-less query fails loudly, and it is transaction-local so it never leaks to the next pooled connection. Repositories add a **second** `tenant_id = <tenant>` filter on top of RLS and cannot be constructed without a live `TenantScope`.

**Evidence partitions** live in schema `evidence_partitions` on which `app_runtime` has no USAGE; each partition FORCEs RLS with no policy of its own, so evidence is reachable only through `public.evidence` and its parent policy.

---

## 2. Tables

### Public (app) schema — **every table carries `tenant_id NOT NULL uuid`**, composite PK `(tenant_id, id)` (exceptions noted)

| Table | Purpose | Notable columns / constraints |
|---|---|---|
| `tenants` | tenant root (PK `tenant_id`) | `plan` default `TECHINT`, `vetting_status` default `NOT_SUBMITTED`, `retention_days` (nullable, no default), `report_handling_marking` |
| `users` | tenant members' profile | UNIQUE `(tenant_id,email)`, email lowercased |
| `api_keys` | hashed API keys | `key_hash`, `permissions text[]`, rotation, expiry; UNIQUE `(tenant_id,key_prefix)` |
| `investigations` | an investigation | title/target as entered |
| `runs` | a run | `plan jsonb`, `requested_target_type`, `person_bearing bool`; CHECK a PERSON-target run must be person_bearing |
| `jobs` | collector jobs | `idempotency_key` UNIQUE `(tenant_id,…)`, `result jsonb`/`evidence_ids[]` only with FOUND, retry schedule, `fused_at` |
| `entities` | fused entities | partial UNIQUE `(tenant_id,kind,identifier) WHERE identifier NOT NULL`; CHECK PERSON/ORG only by namespaced external id, never bare name |
| `entity_relationships` | edges | UNIQUE per `(source,target,kind)`; target index (D-33) |
| `entity_merges` | reversible merges | partial UNIQUE one-active-per-merged; CHECK no name-only auto-merge of PERSON/ORG |
| `claims` | cited claims | `evidence_id` FK, one subject (entity xor relationship), strength |
| `evidence` | **partitioned, append-only** | `id` UUIDv7, `content_hash sha256:…`, `payload_ref`, `source_url` (http(s)/null), `observed_at`/`collected_at` both nullable & never clock-filled; `created_at` generated from id |
| `collectors_registry` | per-tenant catalogue copy (PK `(tenant_id,collector_id)`) | source_label, discipline, mode, licence, `enabled`; CHECK blocked-never-enabled |
| `scope_authorisations` | active-scan clearances | target type+value, authoriser, validity window |
| `cases` | cases | archive one-way |
| `case_pins` | pinned items | exactly one of evidence/entity/claim/relationship |
| `monitors` | saved monitors | `schedule_cron`, `enabled` — **nothing sweeps these yet** |
| `alerts` | monitor alerts | acknowledgement columns |
| `credentials` | envelope-encrypted secrets | `ciphertext bytea`, `encrypted_data_key bytea`, `master_key_version` — no plaintext column |
| `usage_events` | append-only metering | unit, quantity, attempt, `model_calls jsonb`; partial UNIQUE one-per-attempt (no double-charge) |
| `tenant_quotas` | per-tenant limits | app role has SELECT only |
| `reports` | report records | `document jsonb` present iff SUCCEEDED |
| `report_pdfs` | rendered PDFs (PK `(tenant_id,report_id)`) | content_hash, byte_length; file iff READY |
| `case_analyses` | case-analysis requests | `input_hash`, `engine_version`, `basis_evidence_ids[]`/`basis_run_ids[]` |
| `case_analysis_events` | event-sourced results | one PENDING / one finish / one document enforced by partial uniques |

### `auth` schema — the identity exception: **no `tenant_id`, no RLS**
`user, account, session, verification, two_factor, organization (id = tenant id), member, invitation, rate_limit`. Isolation rests purely on grants (`GRANT … TO app_auth` only; app_runtime has no reach, proven layer-by-layer in `isolation.auth-schema.test.ts`). Passwords stored scrypt-hashed (better-auth `account.password`); MFA secrets + backup codes in `two_factor`.

**The enforcing schema test** (`identity.test.ts:52-66`, release-blocking): queries `pg_class` across all non-system schemas and asserts the only tables lacking `tenant_id` are exactly the migration journal + the 9 named auth tables. `schema.test.ts:33-42` separately pins that every public table has a NOT NULL uuid `tenant_id`.

---

## 3. Migrations (28, forward-only, expand-then-contract)

`0000` foundation (`app` schema, `uuid_generate_v7`, `current_tenant_id`, pgvector) · `0001` tables · **`0002` the RLS + grants + append-only migration** · `0003` drop legacy RBAC (contract) · `0004–0006` identity/auth schema + id defaults · `0007–0008` collectors + scope auth + enabled-collector trigger · `0009–0011` jobs/quotas/retry + write-once trigger · `0012` MFA enrolment token · `0013–0017` reports + PDFs + model-provider usage · `0018–0019` retention column · `0020` relationship pins · `0021–0023` case analyses (event-sourced) + basis · `0024` graph-walk indexes (D-33) · `0025–0026` TOPIC target + person-bearing trigger (PTT01) · `0027` EMPTY_UNCONFIRMED outcome.

Applied by `scripts/migrate.ts` as the schema owner (never superuser), which then ensures 13 months of evidence partitions ahead. Several ALTERs are intentionally `NOT VALID` because forced RLS refuses a validating full-table scan with no tenant set (documented inline). Each migration has a `meta/*_snapshot.json`.

---

## 4. Evidence & provenance (as persisted)

Evidence stores **source URL**, **two timestamps** (`observed_at` = source's time, `collected_at` = fetch time) both nullable and never filled from each other or the clock (forced explicit null by `EvidenceRepository`, proven in `append-only.test.ts`), **content hash** (`sha256:<64hex>`), **provenance** via `collector_id`+`collector_version` FK to `collectors_registry` (label from the registry, not a collector string), the producing `job_id`, and first-class `claim_strength`. **Raw bytes are not in the DB** — only `payload_ref` (content-store key). An AFTER-INSERT trigger forbids evidence from a disabled collector (COL01).

**Content store** (`content-store.ts`): `FileSystemContentStore`, keys `tenants/<id>/sha256/<ab>/<cd>/<hash>` (per-tenant, so deletion is per-tenant), **re-hashes and refuses on mismatch** on every get/put (`ContentIntegrityError`). Production S3 backend **not built**. The on-disk stores hold real data: DoH/RDAP JSON sidecars for `example.com`, ~844 KB generated report PDFs, fetched HTML payloads, and honestly-placeholdered seed payloads (bracketed text + RFC-5737 IPs).

---

## 5. Append-only / write-once enforcement

Two layers, both active against the owner:
1. **Grants** — append-only tables (`audit_log`, `evidence`, `claims`, `entity_relationships`, `usage_events`, `case_analyses`, `case_analysis_events`) get only INSERT+SELECT; no UPDATE on `tenant_id`/`id` anywhere (pinned `schema.test.ts:135-165`).
2. **Triggers** — `app.forbid_modification()` raises `APP01` on UPDATE/DELETE/TRUNCATE of `audit_log` and evidence; write-once triggers `jobs_record_once` (JOB01), `reports_record_once`/`report_pdfs_record_once` (REP01), `case_analyses_record_once` (CAN01, allows DELETE for future retention), and entity-merge guards (MRG01-03).

Audit rows carry no FK to actor/target so an entry outlives what it describes. No code anywhere edits/deletes audit rows.

---

## 6. Seed

`seedDevelopmentTenants()` creates two fixed-UUID placeholder tenants through the **application role and repositories** (exactly like app code), each with one user, a `dev-seed` collector, an investigation, a SUCCEEDED run + FOUND job, one evidence row (**observed/collected both null**), entities/relationship/claims, a case + pin, a disabled monitor, and a SYSTEM audit row. All values are bracketed placeholders / RFC-2606 / RFC-5737. **No PERSON entities, no plan/vetting bypass, no decoy record.**

---

## 7. Indexes & governance gaps

Every unique index is tenant-first (so a conflict can't reveal another tenant's row — pinned). Graph-walk indexes `entity_relationships_target_idx` + `claims_relationship_idx` added for the 3-hop walk. Present: `jobs_run_idx`, `reports_run_idx`, `case_analyses_case_idx`, `evidence_content_hash_idx`, scope-auth target index.

**Likely performance gaps (code-level; actual impact UNKNOWN — requires runtime/EXPLAIN):**
- `jobs`: no index on `(tenant_id,status)` / `next_attempt_at` / `dead_lettered_at` — retry/DLQ sweeps would seq-scan within a tenant (mitigated: the live queue is in Redis, so the table may be record-only).
- `monitors`: no index on `enabled`/`schedule_cron` for a future scheduler sweep.
- `alerts`: no index on `monitor_id` / unacknowledged.
- Evidence `created_at` is a generated column; time-range queries rely on partition pruning by UUIDv7 id range, not a `created_at` index.

**Data-governance gaps:**
- **Retention deletion-on-expiry not built** — `retention_days` is recorded only (`settings.ts` asserts `enforced:false`); `case_analyses` already allows DELETE for when it lands. See [07](07-security-privacy-audit.md).
- **No tenant-level "delete everything" job** verified in code (CLAUDE.md §9 requires genuine removal of evidence/media/derived data on deletion) — **UNKNOWN / not found**; per-tenant content-store layout and per-tenant rows make it feasible but no implementation was located.
- `pgvector` installed but unused.
- Legacy `PASSIVE` collection-mode enum value awaits a future contract migration.

JSONB document columns (`runs.plan`, `jobs.params/result`, `reports.document`, `case_analysis_events.document/wording`, `usage_events.model_calls`) are intentional and validated in `@repo/core`, not by the DB beyond type/array CHECKs. No normalization anomalies; all FKs composite-tenant-keyed.

---

## 8. Tests (release-blocking isolation/schema invariants)

22 test files. `schema.test.ts` (RLS enabled+forced, canonical policy, tenant-first indexes, composite FKs, role safety, append-only grants, partition isolation, pgvector present, 6 claim strengths); `identity.test.ts` (tenant_id exemption = exactly auth + journal; auth = exactly 9 tables; app_auth disjoint; plan/vetting never app-writable); `isolation.rls.test.ts` (raw SQL as app_runtime: own-tenant only; cross-tenant insert refused by RLS; no-context → TNT01; txn-local; partitions unreachable); `isolation.repositories.test.ts`; `append-only.test.ts`; `tenant-context.test.ts`; `person-target.test.ts` (PTT01); `entity-merges.test.ts`; `collectors.test.ts`; `jobs.test.ts`; `reports.test.ts`; `case-analyses.test.ts`; `exploration.test.ts`/`person-probe-depth.test.ts` (the person-data probe across merges/hops); `content-store.test.ts`; `seed.test.ts`. The RLS suite is catalog-driven, so a new table lacking RLS/policy/repository fails automatically. (These need a live Postgres; end-to-end pass status **UNKNOWN — requires runtime access**.)
