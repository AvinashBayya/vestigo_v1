# M4-4A — runtime verification of prose extraction

Date: 2026-10-23. Branch `milestone/vestigo-days-1-3-osint-addendum`, HEAD `156952f`. **Nothing committed, pushed, reset, cleaned, or reverted.** All pre-existing uncommitted work (M1–M4-4: 48 tracked-modified + 33 untracked paths) is intact. No live publisher was contacted, no LLM provider enabled, no source verdict changed, no security control weakened. No production code was modified — the review found no defect requiring a fix.

**Outcome: RUNTIME VERIFIED.** Docker was down at the start; I started Docker Desktop and the repository's services, and both M4-4 suites executed against the real Postgres — 14 tests, all passing, with per-test timings that prove the bodies ran (not a setup failure counted as success).

## 1. Environment at start

```
docker version --format {{.Server.Version}}   → failed to connect to the docker API at
  npipe:////./pipe/dockerDesktopLinuxEngine … The system cannot find the file specified.  (exit 1)
docker info    → same error (exit 1)
```

The Docker **client** was present (`/c/Program Files/Docker/Docker/resources/bin/docker`, v29.8.0) and Docker Desktop was installed (`C:\Program Files\Docker\Docker\Docker Desktop.exe`), but the **daemon** was not running. This is the exact environmental blocker that previously made the osint-engine suites fail at vitest `globalSetup` (which recreates the test database, so every osint-engine test needs Postgres) with `TestDatabaseUnreachableError` / `ECONNREFUSED 127.0.0.1:5432`.

## 2. Services started (the documented path, not a bypass)

I launched Docker Desktop and polled the daemon:

```
Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
# poll: DAEMON_UP after 10s: server 29.8.0
docker compose up -d --wait
# vestigo-postgres-1  Healthy
# vestigo-redis-1     Healthy   (exit 0)
docker compose ps
#   vestigo-postgres-1  postgres  Up (healthy)
#   vestigo-redis-1     redis     Up (healthy)
```

The tests ran against the real containerised Postgres (`…@127.0.0.1:5432/app_engine_test`, the repo's documented test DB). No mock, in-memory, or stub database was substituted.

## 3. Suites executed — actual results

```
pnpm --filter @repo/osint-engine exec vitest run test/article-extraction.test.ts
  Test Files  1 passed (1)   Tests  9 passed (9)   Duration 5.98s   (exit 0)

pnpm --filter @repo/osint-engine exec vitest run test/article-extraction-run.test.ts
  Test Files  1 passed (1)   Tests  5 passed (5)   Duration 21.34s  (exit 0)
```

Re-run together with `--reporter=verbose` to prove each body executed (exit 0, **14 passed, 0 failed, 0 skipped**):

**`article-extraction.test.ts` — capability, offline scripted model (9):**
- ✓ returns grounded statements with exact spans for a valid answer — 21ms
- ✓ rejects an answer whose quote is not in the article (no fabricated grounding) — 4ms
- ✓ rejects a hallucinated identifier in a value (output guard) — 2ms
- ✓ rejects output that echoes an injection instruction from the article — 1ms
- ✓ rejects malformed JSON — 1ms
- ✓ rejects more statements than the bound allows — 3ms
- ✓ is SKIPPED when no LLM is configured (off by default) — 0ms
- ✓ FAILS closed on a provider error — 1ms
- ✓ returns an empty extraction for empty body text, with no model call — 1ms

**`article-extraction-run.test.ts` — persistence, real database (5):**
- ✓ persists one grounded, DERIVED article_statements claim on the article's URL entity — 143ms
- ✓ is idempotent: a second delivery writes nothing and makes no model call — 62ms
- ✓ is SKIPPED with no configured LLM, writing no claim and leaving the evidence — 41ms
- ✓ FAILS closed on a rejected answer, writing no claim — 38ms
- ✓ writes nothing for a tenant that did not collect the article — 57ms

**Test failures vs setup failures:** no setup failure occurred — `globalSetup` reached Postgres and recreated the schema (the previous `TestDatabaseUnreachableError` is gone). The five DB-backed tests each spend 38–143ms doing real tenant provisioning, writes, and reads; a skipped or setup-failed suite would report 0 passing tests, not 14. Bodies genuinely executed.

## 4. Verified behaviour (code review, tasks 6)

I read [article-extraction.ts](../packages/osint-engine/src/extraction/article-extraction.ts) and [run.ts](../packages/osint-engine/src/extraction/run.ts) in full and traced the entity-identity assumption into fusion. Findings:

- **Quote grounding — correct.** `validateExtraction` rejects the whole answer unless every `quote` is a verbatim substring of the retained `bodyText` (`bodyText.includes(quote)`), and spans are computed only afterwards via `indexOf`, so `bodyText.slice(start, end) === quote` by construction — never a fabricated offset. The run test asserts exactly this round-trip against the stored body text. (Minor, immaterial: when a quote occurs more than once, the span points at the first occurrence; the text is identical, so grounding still holds.)
- **Tenant isolation — correct.** Every read and write goes through `db.withTenant(tenantId, …)` (Postgres RLS); the snapshot read uses `{ snapshot: true }`. The "writes nothing for a tenant that did not collect the article" test confirms a fresh tenant sees none of another tenant's claims, and a foreign/unknown job id is SKIPPED.
- **Idempotency — correct for sequential delivery.** It SKIPS in the snapshot read when the evidence already carries an `article_statements` claim (before any model call) **and** re-checks inside the write transaction before inserting. The idempotency test confirms a second delivery writes no duplicate and makes zero model calls. (See risk R1 on concurrency.)
- **Failure handling — fail-closed.** No configured LLM → SKIPPED; a rejected answer (`LlmOutputRejectedError`) or provider error → FAILED with the code; empty body / zero statements → `EXTRACTED` with `claimWritten: false` and no claim. None throws, none alters the already-committed evidence. The "no LLM" and "rejected answer" tests confirm no claim is written and the evidence row remains.
- **Evidence references — correct, and on the right entity.** The claim cites the article's own `evidenceId`, strength `DERIVED`, subject the article's URL entity. I verified the entity is the **same** one the normal pipeline builds: fusion's `article` extractor creates the URL entity via `targetEntity(target)` → `resolveByIdentifier({ kind:"URL", identifier: normaliseUrl(target), … })` ([extractors.ts:229](../packages/osint-engine/src/fusion/extractors.ts#L229), [:487-490](../packages/osint-engine/src/fusion/extractors.ts#L487)), and `runArticleExtraction` resolves `normaliseUrl(job.target)` for the same `kind:"URL"`. Same `(kind, identifier)` → same entity; the DERIVED claim lands on the pipeline's URL entity, not a duplicate or graph-detached one. URL is not in `NEVER_RESOLVED_BY_VALUE` (only PERSON/ORGANIZATION are), so resolving it by identifier is allowed.

No defect was found; no production change was made.

## 5. Outstanding risks

- **R1 — idempotency is check-then-act, not DB-enforced.** The in-transaction re-check closes the window for sequential delivery, but there is no unique constraint on `(evidence, attribute = article_statements)`. Two genuinely concurrent `runArticleExtraction` calls on the same job could, under READ COMMITTED, both observe "no existing claim" and both insert. This is **not reachable today** — the function has no caller and is not wired to a queue — but the future queue (§6) must deliver at most one extraction per job at a time, or a unique partial index should back the guard. Not fixed here (would broaden scope; no live path triggers it).
- **R2 — no live model was exercised.** Verification used a scripted provider only; `createLlmClient` is `{ unavailable }` by default (no `LLM_HOSTED_BASE_URL`). The grounding/injection/output guards are proven against the schema and scripted answers, not a real open-weight endpoint. The first real run should be a bounded, metered canary.
- **R3 — not auto-invoked.** `runArticleExtraction` is implemented and tested but nothing calls it after collection, so no article is extracted in a running system yet. The returned token meter is not recorded as a per-tenant usage event (no generic per-task usage writer exists today).
- **R4 — fine-grained contradiction gap (unchanged from M4-4).** Statements persist as one coarse DERIVED claim per article URL (contradiction-safe, no entities-by-name); cross-source contradiction on a shared subject still needs a grounded candidate-entity model.

## 6. Exact next step

Wire `runArticleExtraction` into a new optional post-fusion extraction queue, mirroring the `reports` processor: resolve the LLM once at worker startup, enqueue one extraction per FOUND `article` job after fusion **keyed by job id so delivery is at-most-once** (closing R1), and persist the returned meter's usage per tenant. Add its own DB-backed processor tests. Only then run a bounded metered canary against a configured open-weight endpoint (R2).

## Status

**RUNTIME VERIFIED — 14/14 tests passing against the real database.** Docker was started via the documented path and the repository's Postgres/Redis services are healthy. The extraction and persistence paths are correct on grounding, tenant isolation, sequential idempotency, fail-closed failure handling, and evidence/entity references; no defect was found and no production code changed. Outstanding risks R1–R4 are documented; the smallest next step is the at-most-once extraction queue. Repository left uncommitted with all prior changes preserved.
