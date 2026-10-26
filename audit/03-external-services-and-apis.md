# 03 — External Services, APIs & Integrations

Two parts: **(A)** external systems the code connects to, with the credential variables each needs; **(B)** the full internal HTTP API surface. Secret *values* are never printed.

---

## A. External systems

### A.1 Datastores (required, self-hosted via Docker Compose)

| Service | Image / version | Purpose | Env var(s) | Credentials status |
|---|---|---|---|---|
| **Postgres** | `pgvector/pgvector:0.8.6-pg17-trixie` (`docker-compose.yml:8-27`) | All tenant + identity data, RLS | `DATABASE_URL` (role `app_runtime`), `DATABASE_MIGRATION_URL` (role `app_owner`), `DATABASE_AUTH_URL` (role `app_auth`) | dev creds in `.env` match compose; expected from env in prod |
| **Redis** | `redis:8` (`docker-compose.yml:29-41`) | BullMQ queues, rate-limit counters, circuit breaker, LLM cache | `REDIS_URL` (must be `redis(s)://`) | dev local; URL never logged (`redis-client.ts:5`) |

Both bind to `127.0.0.1` only. `pgvector` is installed into `template1` + `app` (`01-bootstrap.sql:37-41`) but **no code uses vector columns/embeddings yet**.

### A.2 LLM endpoint (optional)

One outbound surface: `OpenAiCompatibleProvider.complete` → `POST ${baseUrl}/chat/completions` (`packages/llm/src/provider.ts:205-213`). Two profiles (`LLM_PROFILE`):
- **`vllm`** — self-hosted vLLM (`docker-compose.yml:43-66`, profile `llm-selfhosted`, GPU, image pinned by digest). Base `LLM_VLLM_BASE_URL` (default `http://127.0.0.1:8000/v1`), key `LLM_VLLM_API_KEY`.
- **`hosted`** (default) — any OpenAI-compatible endpoint, **https only**. Base `LLM_HOSTED_BASE_URL`, key `LLM_HOSTED_API_KEY`.

If no hosted base URL is set, config resolves to `NOT_CONFIGURED` and synthesis is unavailable (reports still generate). **Azure OpenAI hosts are refused** at config resolution; model must be on the open-weight allowlist. Detail in [04-ai-llm-agents-mcp-a2a.md](04-ai-llm-agents-mcp-a2a.md).

### A.3 Collection upstreams (external data sources)

Reached only through the one SSRF-checked fetcher; credentials only from the per-tenant vault, only for an enabled keyed method. **Only GDELT + Wikidata are both permitted and networked today** (`contact.phone` is local-only). The rest are code-complete but `UNVERIFIED` (frozen off).

| Upstream | Endpoint | Collector | Credential (vault id) | Rate limit / timeout |
|---|---|---|---|---|
| **GDELT DOC 2.0** | `api.gdeltproject.org/api/v2/doc/doc` | `news` (PERMITTED, runs) | none | 1 req/5s; fetch 30s, run 75s |
| **Wikidata** | `www.wikidata.org/w/api.php` | `wikidata` (PERMITTED, runs) | none | 20s/req, run 60s |
| crt.sh | `crt.sh/?q=…&output=json` | `crtsh` (UNVERIFIED) | none | 60s fetch/90s run |
| Cloudflare DoH | `cloudflare-dns.com/dns-query` | `dns` (UNVERIFIED) | none | 10s |
| RDAP | `rdap.org/domain/…` → IANA bootstrap hosts | `rdap` (UNVERIFIED) | none | 20s |
| Wayback CDX | `web.archive.org/cdx/search/cdx` | `wayback` (UNVERIFIED) | none | 50s/55s |
| Common Crawl | `index.commoncrawl.org` | `commoncrawl` (UNVERIFIED) | none | 60s, 1 req/2s |
| GitHub API | `api.github.com/users/…` | `github` (UNVERIFIED) | optional `github` → Bearer | 60 req/h unauth |
| Hacker News | `hacker-news.firebaseio.com` + `hn.algolia.com` | `hackernews` (UNVERIFIED) | none | 20s |
| dev.to | `dev.to/api/users/by_username` | `devto` (UNVERIFIED) | none | 20s/30s |
| Bluesky | `public.api.bsky.app` / `bsky.social` | `bluesky.search` (UNVERIFIED) | optional `bluesky` `{identifier,appPassword}` | — |
| Reddit | `reddit.com/search.json` / `oauth.reddit.com` | `reddit.search` (UNVERIFIED) | optional `reddit-api` `{clientId,clientSecret}` | — |
| 217 RSS publishers | each `publisher.feeds` URL | `rss.*` (UNVERIFIED) | none | 20s/feed |
| Direct article (ACTIVE) | one exact authorised URL | `article` (UNVERIFIED) | none | 25s/30s; needs scope auth |

Error handling is typed and uniform: `UpstreamUnavailableError` (retryable, optional `retryAfterMs`), `UpstreamRejectedError`/`UpstreamResponseError` (permanent). No in-collector retry (worker retries) and no in-collector caching. The only vault ids in code are `github`, `bluesky`, `reddit-api`. Full detail in [05-crawlers-scrapers-data-sources.md](05-crawlers-scrapers-data-sources.md).

### A.4 Cloud / managed services

**None wired.** No AWS/GCP/Azure/Supabase/Firebase/Vercel/Railway/Render SDK or endpoint in code. Content store is local filesystem (`FileSystemContentStore`); the S3 backend is explicitly **not built** (`content-store.ts:77-80`). No email/SMS/push/payment/analytics/monitoring provider is integrated (no SendGrid/Twilio/Stripe/Segment/Sentry/Datadog SDK found). Better-auth telemetry is explicitly disabled (`better-auth.ts:191`).

### A.5 Identity provider

**Better-Auth**, self-hosted, backed by the `auth` Postgres schema via the `app_auth` role (`apps/api/src/auth/better-auth.ts:185-196`). Email/password + mandatory TOTP two-factor + organization plugin. **No social/OAuth providers.** API keys are a bespoke mechanism (not the better-auth plugin). Detail in [07-security-privacy-audit.md](07-security-privacy-audit.md).

---

## B. Internal HTTP API (68 routes)

Fastify 5, OpenAPI 3.1 generated from the request/response Zod schemas (`apps/api/src/app.ts:83-107`); served at `GET /api/v1/openapi.json`; the web client is generated from it so the UI cannot exceed the public API. Contract version `0.4.0` (`app.ts:40`). All protected routes return RFC-9457 `application/problem+json` and declare both security schemes (`session` cookie, `apiKey` bearer). `snapshot` = REPEATABLE READ tx. The public route list is pinned by `apps/api/test/route-access.test.ts`.

Legend: **P** = person-gated; **S-only** = session principal required (API key refused); **SSE** = stream.

| Method | Path | Handler | Access / notes |
|---|---|---|---|
| GET | `/health` | `health.ts:13` | public, liveness only |
| GET | `/api/v1/openapi.json` | `openapi.ts:7` | public |
| POST | `/api/auth/sign-up/email` | `auth.ts:31` | public, anti-enumeration synthetic-user response |
| POST | `/api/auth/organization/accept-invitation` | `auth.ts:31` | public |
| GET | `/api/v1/session` | `session.ts:130` | public; returns `SessionState`, never a token |
| POST | `/api/v1/session/sign-in` | `session.ts:144` | public + trusted origin |
| POST | `/api/v1/session/mfa/verify` | `session.ts:180` | TOTP or backup code |
| POST | `/api/v1/session/mfa/enrolment` | `session.ts:211` | needs enrolment token |
| POST | `/api/v1/session/mfa/enrolment/confirm` | `session.ts:264` | |
| POST | `/api/v1/session/tenant` | `session.ts:292` | set active tenant |
| POST | `/api/v1/session/sign-out` | `session.ts:318` | |
| GET | `/api/v1/me` | `me.ts:27` | `profile:read` |
| POST | `/api/v1/investigations` | `investigations.ts:43` | `investigation:create` |
| GET | `/api/v1/investigations` | `investigations.ts:72` | `investigation:read` |
| GET | `/api/v1/investigations/:id` | `investigations.ts:96` | `investigation:read` |
| GET | `/api/v1/audit-log` | `audit-log.ts:54` | `audit:read` |
| POST | `/api/v1/api-keys` | `api-keys.ts:56` | `api_key:manage`; plaintext shown once |
| GET | `/api/v1/api-keys` | `api-keys.ts:90` | never returns hash |
| POST | `/api/v1/api-keys/:id/rotate` | `api-keys.ts:115` | overlap 0–86400s |
| POST | `/api/v1/api-keys/:id/revoke` | `api-keys.ts:153` | |
| POST | `/api/v1/credentials` | `credentials.ts:44` | `credential:write`; secret never returned |
| GET | `/api/v1/credentials` | `credentials.ts:70` | metadata only |
| POST | `/api/v1/credentials/:id/revoke` | `credentials.ts:95` | |
| POST | `/api/v1/person/search` | `person.ts:14` | `person:search`, plan+vetting; **throws 501** (no collector) |
| POST | `/api/v1/investigations/:id/runs` | `runs.ts:274` | **P**, `run:start`; 429 quota / 503 queue |
| GET | `/api/v1/investigations/:id/runs` | `runs.ts:333` | `run:read` |
| GET | `/api/v1/runs/:id` | `runs.ts:372` | **P**, snapshot |
| GET | `/api/v1/runs/:id/events` | `runs.ts:397` | **P**, snapshot, **SSE** — re-checks access every poll |
| POST | `/api/v1/jobs/:id/replay` | `runs.ts:486` | **P** (D-30), `job:replay` |
| GET | `/api/v1/usage` | `runs.ts:532` | `usage:read` |
| POST | `/api/v1/runs/:id/reports` | `reports.ts:315` | **P**, `report:create`; 409 not-settled/synthesis-unavailable |
| GET | `/api/v1/runs/:id/reports` | `reports.ts:383` | **P**, snapshot |
| GET | `/api/v1/reports/:id` | `reports.ts:421` | **P**, snapshot |
| GET | `/api/v1/reports/:id/export/:format` | `reports.ts:449` | **P**, snapshot; pdf/json/csv/maltego; PDF re-hashed |
| PUT | `/api/v1/settings/report-handling-marking` | `reports.ts:567` | `organization:update` |
| POST | `/api/v1/scope-authorisations` | `scope-authorisations.ts:54` | **S-only**; ≤366 days |
| GET | `/api/v1/scope-authorisations` | `scope-authorisations.ts:120` | |
| POST | `/api/v1/scope-authorisations/:id/revoke` | `scope-authorisations.ts:146` | 409 already-revoked |
| POST | `/api/v1/cases` | `cases.ts:144` | `case:write` |
| GET | `/api/v1/cases` | `cases.ts:173` | `case:read` |
| GET | `/api/v1/cases/:id` | `cases.ts:201` | |
| PATCH | `/api/v1/cases/:id` | `cases.ts:224` | rename/describe/archive (one-way) |
| POST | `/api/v1/cases/:id/pins` | `cases.ts:269` | **P** on subject; 409 archived |
| GET | `/api/v1/cases/:id/pins` | `cases.ts:337` | **P** on all pins, snapshot |
| DELETE | `/api/v1/cases/:id/pins/:pinId` | `cases.ts:388` | 204 |
| POST | `/api/v1/cases/:id/analyses` | `case-analyses.ts:145` | **P**, `case:analyse`; 409 archived/too-large |
| GET | `/api/v1/cases/:id/analyses` | `case-analyses.ts:226` | **P** (two probes) |
| GET | `/api/v1/case-analyses/:id` | `case-analyses.ts:268` | **P** (two probes) |
| GET | `/api/v1/entities` | `entities.ts:183` | **P**, `evidence:read`, snapshot |
| GET | `/api/v1/entities/merge-candidates` | `entities.ts:220` | **P** |
| GET | `/api/v1/entities/:id` | `entities.ts:278` | **P** |
| GET | `/api/v1/relationships/:id` | `entities.ts:344` | **P** both ends |
| GET | `/api/v1/entity-merges` | `entities.ts:402` | **P** |
| POST | `/api/v1/entity-merges` | `entities.ts:443` | **P**, **S-only**, `case:write`; 409 not-allowed |
| POST | `/api/v1/entity-merges/:id/undo` | `entities.ts:492` | **P**, **S-only** |
| GET | `/api/v1/evidence/:id` | `evidence.ts:76` | **P**, snapshot |
| GET | `/api/v1/evidence/:id/payload` | `evidence.ts:151` | **P**; octet-stream + nosniff + CSP sandbox + re-hash |
| GET | `/api/v1/graph` | `explore.ts:58` | **P**, snapshot; hops ≤3, nodes ≤500 |
| GET | `/api/v1/timeline` | `explore.ts:112` | **P**, snapshot |
| GET | `/api/v1/members` | `members.ts:61` | `member:read` |
| GET | `/api/v1/members/invitations` | `members.ts:100` | enrolment token never listed |
| POST | `/api/v1/members/invitations` | `members.ts:142` | **S-only**, `invitation:create` |
| PATCH | `/api/v1/members/:userId` | `members.ts:204` | **S-only**, `member:update` |
| DELETE | `/api/v1/members/:userId` | `members.ts:233` | **S-only**, 204 |
| GET | `/api/v1/settings/retention` | `settings.ts:18` | `enforced:false` (not auto-purged) |
| PUT | `/api/v1/settings/retention` | `settings.ts:36` | `organization:update` |
| POST | `/api/v1/estimates` | `estimates.ts:30` | `run:start`; costs always `null`+reason |
| GET | `/api/v1/collectors` | `collectors.ts:122` | `run:read`; registry + runnability |

### B.1 API-level security controls

- **Auth:** session cookie (`better-auth.session_token`, 12h expiry) requiring `twoFactorEnabled` + active tenant + verified membership; or `Bearer ak_<tenant>_<key>_<secret>` API key, rate-limited *before* verification, scope capped by the issuer's current role. (`apps/api/src/http/principal.ts`.)
- **CSRF:** non-safe methods with a session cookie require `Origin ∈ trustedOrigins` (`principal.ts:131-139`). **No `@fastify/cors`/helmet is registered** — browser CORS/header behaviour is **UNKNOWN — requires runtime access** (likely a reverse proxy).
- **Request hardening:** server-generated UUID request id (never client), 30s request timeout, Zod validation at every boundary, unknown errors never leak their message (500 `INTERNAL_ERROR`), validation errors expose field paths but never the submitted value.
- **Audit:** every protected request writes an append-only audit row (ALLOWED/DENIED/FAILED) in the tenant tx.
- **Raw payload serving:** `application/octet-stream` + `content-disposition: attachment` + `x-content-type-options: nosniff` + `content-security-policy: default-src 'none'; sandbox` + `no-store`, re-hashed on every read (`evidence.ts:186-220`).
- **Rate limiting:** better-auth DB limiter on auth routes; bespoke Redis fixed-window limiter on API keys. No general per-IP limit on v1 data routes in code.
