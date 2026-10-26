# M2 — article evidence persistence and analyst workflow: verification report

Date: 2026-10-22. Branch `milestone/vestigo-days-1-3-osint-addendum`; **nothing committed, pushed, reset, or cleaned**. No source verdict changed, no source enabled, **no real publisher contacted**. All proof is offline, against synthetic fixtures on the reserved `example.com` documentation domain.

## Objective and outcome

M1 built the exact-article path and proved it through the FOUND evidence boundary; the one gap it named was a **pipeline-level database-persistence test**. M2 closes that gap and verifies the analyst-facing workflow.

**Outcome:** the local fixture now proves the **complete collector → database → API/UI workflow**. An authorised fixture URL is admitted, fetched over the SSRF-hardened path, extracted, and persisted as canonical evidence through the real executor into real Postgres; a tenant-scoped read returns it with correct provenance and ownership; duplicate delivery does not duplicate it; and a refused or failed retrieval writes no evidence. The analyst API and UI already surface it correctly with **no changes required**, because they are collector-agnostic.

## Step 2 — the real pipeline persistence test

Added one `describe` block, **8 tests**, to the RELEASE-BLOCKING end-to-end suite: `packages/osint-engine/test/pipeline.test.ts` (`"the exact-article path persists retrievable, tenant-scoped evidence (exact-article M2)"`). It runs the **real** registered `article` collector through the **real** engine (real Postgres as the application role, real Redis/BullMQ worker pools, the real `CollectionExecutor.persistEvidence`, the real `RunFusion`) — the same harness every other collector's e2e uses. **No mock of `persistEvidence` or of the database**; the content store is the suite's `FileSystemContentStore`, and the article bytes come from the recorded fixture, never the network.

The actual database path exercised, per the objective's seven points:

1. **Authorised fixture URL is admitted.** A tenant records an in-force **DOMAIN** scope authorisation for the publisher host (`repos.scopeAuthorisations.create`, as an authorised member would — not an owner SQL bypass). The planner detects the pasted URL as a URL target and admits the ACTIVE `article` collector because the shared `resolveScopeClearance` clears the URL by that DOMAIN authorisation. The test asserts the planned job is exactly `article` on the URL and the run `SUCCEEDED`.
2. **Fetches through the existing secure path.** The UNVERIFIED source runs only because the harness replays recorded answers; the fetch is bound to the one authorised host, and the loopback fixture server answers it. `harness.unmatched` is empty (no unexpected request).
3. **Extraction produces the expected status and evidence.** The job is `SUCCEEDED/FOUND` with one evidence id; the fused flag is set.
4. **The executor's canonical persistence actually stores the evidence.** `repos.evidence.findById` returns a row with `collectorId: "article"`, `collectorVersion: "1.0.0"`, `sourceUrl` = the exact article URL, `claimStrength: "REPORTED"`, `contentHash` = `sha256:` of the fixture bytes (recomputed independently in the test), `observedAt` = the page's stated publish time, and `collectedAt` measured and strictly later. The raw bytes are read back from the content store and re-hashed (`contentStore.get`, the same read the payload-download API makes) and equal the fixture body.
5. **A subsequent read retrieves the record with correct tenant ownership and provenance.** The read-back is the identical call the evidence API makes (`repos.evidence.findById` + `repos.claims.listForEvidence` + the registry label). A second tenant sees no evidence at all (RLS tenant isolation). Fusion persisted the article URL as the subject entity, the publisher host as a `published_by` DOMAIN entity, and the fields as `article_*` claims each citing the evidence.
6. **Duplicate submission follows the existing dedup policy.** Re-delivering the finished job to the processor returns `SKIPPED` and adds no evidence — dedup is by job idempotency, exactly as the existing replay/concurrency tests assert for every collector.
7. **Failed or refused retrieval creates no false evidence.** A URL whose host has no authorisation is excluded at planning (`SCOPE_AUTHORISATION_REQUIRED`), never fetched, no job, no evidence. An authorised URL whose response is not HTML fails the job (`UPSTREAM_RESPONSE_INVALID`) and still writes no evidence.

Command and result: `pnpm --filter @repo/osint-engine exec vitest run test/pipeline.test.ts` → **37 passed** (29 existing + 8 new).

## Step 3 — evidence semantics and provenance (verified, now DB-pinned)

Each required property was reviewed against the evidence model, the `article` collector, and the `article` fusion extractor, and is now pinned at the database level by the M2 test (in addition to the M1 collector/fusion unit tests). **No semantic defect was found; no correction was needed.**

- **Verbatim vs parser-derived.** The one value quoted verbatim from the bytes — the raw `<title>` (`article_headline`) — persists at the source's `REPORTED` strength; everything `extractArticle` produced (title, author, language, publish time, canonical URL, outlet, dedup key, extraction status) persists as `DERIVED`. The test asserts the stated set is exactly `["article_headline"]` and every parsed field is `DERIVED` — the same `stated`/`derived` split the evidence API returns.
- **Publication time ≠ retrieval time.** `observedAt` is the page's stated publish time (`2026-10-20T09:30:00.000Z`); `collectedAt` is measured and strictly greater. Separate columns, asserted distinct.
- **Exact article URL distinguishable from GDELT.** The evidence carries collector id `article` and the registry source label **"Direct article fetch"** (never a publisher string, never GDELT's label), and its claims use the `article_*` namespace, disjoint from GDELT's `news_*`. A shared URL entity keeps each source's claims separate by strength and evidence.
- **Every derived claim/entity is traceable.** Every persisted claim cites the one evidence row (asserted). The publisher DOMAIN entity and the `published_by` edge derive from `derived.outletDomain`.
- **Nothing invented when absent.** No `PERSON`/`ORGANIZATION` entity is made from a headline or author name (asserted). `extractArticle` leaves an absent field null.
- **Failures and partial extraction are honest.** The extraction status is recorded as a claim (`FULL_TEXT` for this fixture); a non-article response fails the job; a page with no readable article is reported not found (M1 collector tests) — never a false FOUND.

## Step 4 — the analyst-facing workflow (verified; no changes required)

The run, evidence, and timeline APIs and the Evidence workspace are **collector-agnostic**, so article evidence already flows through them with nothing article-specific to add. Traced and confirmed:

- **Collection state** — `GET /api/v1/runs/{id}` and its `/events` stream (`apps/api/src/routes/runs.ts`) report the run status (QUEUED/RUNNING/PARTIAL/SUCCEEDED/FAILED) and, per job, `status`, `outcome`, `outcomeDetail`, and a typed `error {code, message}`. The message is the collector's typed error (e.g. `UPSTREAM_RESPONSE_INVALID`, "…not an HTML article") — **no stack traces, no secrets**; an unknown error is reported as a generic message. The plan's `excluded` list carries machine-readable reasons (e.g. `SCOPE_AUTHORISATION_REQUIRED`), so an analyst sees *why* an article was not collected.
- **Open the exact article evidence** — `GET /api/v1/evidence/{id}` (`apps/api/src/routes/evidence.ts`) returns `sourceLabel` (the registry's — "Direct article fetch"), `sourceUrl`, `observedAt` and `collectedAt` (separate, each nullable), `contentHash`, `strength`, and the claims split into `stated` (verbatim) and `derived` (parsed — where the extraction status appears). The raw payload is a separate `application/octet-stream` attachment, re-hashed on every read and refused on mismatch.
- **Distinguish from GDELT** — the Evidence grid (`apps/web/src/workspace/EvidenceTab.tsx`) shows a **Source** column from `sourceLabel` and offers a **Source filter**, so "Direct article fetch" rows are distinct from "GDELT news coverage" rows; Observed and Collected are separate columns; Source URL is shown.
- Verified green: `apps/api/test/runs.test.ts` (**8**) and `apps/api/test/exploration-api.test.ts` (**32**, covering `getEvidence`, the payload download, and the timeline).

An honest run is never marked a false success: a run whose only job fails settles `FAILED` (asserted), and a failed/refused retrieval writes no evidence.

## Step 5 — tests and results (exact commands)

| Command | Result |
|---|---|
| `pnpm --filter @repo/osint-engine exec vitest run test/pipeline.test.ts -t "exact-article"` | **8 passed** (the new DB persistence block) |
| `pnpm --filter @repo/osint-engine exec vitest run test/pipeline.test.ts` | **37 passed** (29 existing + 8 new; no regression) |
| `pnpm --filter @repo/osint-engine test` | **13 files, 208 passed** |
| `pnpm --filter @repo/osint-engine build` / `lint`; prettier on the test file | typecheck exit 0; ESLint clean; prettier clean |
| `pnpm --filter @repo/collectors test` | **26 files, 622 passed** (unchanged by M2) |
| `pnpm --filter @repo/api exec vitest run test/runs.test.ts test/exploration-api.test.ts` | **40 passed** (run status + evidence/payload/timeline) |

Real Postgres + Redis are provided by the osint-engine suite's own test infrastructure (its vitest `globalSetup` recreates the database and applies every migration).

## Evidence semantics and provenance (summary)

A persisted article evidence row: collector `article` v1.0.0, source label "Direct article fetch", `sourceUrl` the exact article URL, `contentHash` the sha256 of the retrieved bytes (payload stored and re-hashed on read), `observedAt` the page's stated publish time (null when none), `collectedAt` the retrieval time, `claimStrength` REPORTED. Its claims: one REPORTED `article_headline` (the verbatim `<title>`), the rest DERIVED (`article_*`), plus a DERIVED `published_by` edge to the publisher DOMAIN entity. Tenant-isolated by RLS; append-only.

## Remaining source approvals and limitations (unchanged from M1)

- **No real publisher is enabled.** The `direct-article` source is UNVERIFIED and default-deny; no deployment runs it. Before any real article is collected: (1) the owner records a per-publisher **PERMITTED** verdict in `catalogue.ts` with an `audited()` reference; (2) a tenant records an in-force DOMAIN scope authorisation for that exact host; (3) legal reviews robots/paywall/terms handling (fetches respect these as typed failures; none is bypassed).
- Client-rendered articles yield METADATA_ONLY/NO_CONTENT honestly; the extractor never fabricates text.
- A pipeline run against a live publisher has not been performed and must not be until the approvals above are in place.

## Boundaries honored

No source verdict changed. No real publisher contacted. SSRF, authorisation, tenant isolation, and person gates unchanged and unweakened (the M2 change is a test only; it exercises the existing gates rather than altering them). No paid service or third-party extraction API introduced. Nothing committed, pushed, reset, or cleaned; all M1 work preserved.

## Conclusion

**Yes — the local fixture now proves the complete collector-to-database-to-API/UI workflow.** An authorised article URL is admitted, fetched over the secure path, extracted, and persisted as canonical evidence in the real database through the real executor; a tenant-scoped read (the same the API makes) returns it with correct ownership and provenance; duplicates do not duplicate; and refused or failed retrieval writes no false evidence. The analyst API and UI surface it correctly with no changes, because they are collector-agnostic. What remains before a **real** article can be collected is human approval (owner per-publisher verdict, tenant authorisation, legal review), not further engineering — the path is complete and fail-closed.
