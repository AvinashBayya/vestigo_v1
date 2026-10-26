# Source-access policy and open-host security design (M0)

Date: 2026-10-21. This is the policy foundation for approving a source and for fetching an arbitrary publisher URL ("open host"), so exact-article intelligence ([EXACT_ARTICLE_INTELLIGENCE_PLAN.md](EXACT_ARTICLE_INTELLIGENCE_PLAN.md) M1–M5) can be built safely later. **M0 is policy + design + verification of the invariants it relies on. It starts no article retrieval, enables no source, changes no verdict, and makes no live request.** Nothing was committed.

Grounded in the current code (read, not assumed):
- **Global commercial-use verdict** lives in code: `packages/collectors/src/catalogue.ts` via `audited(row, url)`, verdict ∈ {PERMITTED, BLOCKED, UNVERIFIED} ([source.ts:25,191-203]); **PERMITTED must rest on terms someone read** (a check with a `sourceUrl`). UNVERIFIED and BLOCKED never run, in any environment — default-deny.
- **Per-tenant, time-bound, revocable, audited authorisation** already exists for ACTIVE scanning: `scope_authorisations` ([db/schema/collectors.ts]) — `tenant_id`, exact normalised `target`+`target_type`, `authorised_by_user_id`, `basis`, `valid_from`/`valid_until` (period > 0, ≤ 1 year), `revoked_at`; "in force" is a SQL predicate `valid_from <= now() AND valid_until > now() AND revoked_at IS NULL` ([repositories/work.ts:259-272]); gated by `scope_authorisation:read`/`:write` ([access/permissions.ts]); the runtime refuses an ACTIVE collector with no clearance ([collectors/runtime.ts:400-406]).
- **SSRF/network safety** is a separate, always-on layer: `checkDestination` (scheme, no URL credentials, host on the source's exact allowlist, default port, re-checked every redirect hop — [fetcher/destination.ts]) and `isPublicAddress` (refuses private/shared/loopback/link-local incl. 169.254.169.254, reserved/broadcast, and IPv4-mapped/NAT64/6to4 by their embedded IPv4 — [fetcher/address.ts]), with the connection **pinned to the checked address** (no second lookup → no DNS rebinding — [fetcher/fetcher.ts], proven by `fetcher.test.ts` "opens every connection itself, to the address it checked").

## 1. The three independent layers (all required; none overrides another)

A source read is allowed only when **all three** pass; any one missing is a refusal.

1. **Global verdict (code, owner).** May this source be used in the product at all, commercially? A PERMITTED verdict is a reviewed code change resting on read terms. Default-deny: UNVERIFIED/BLOCKED never run. This is the platform's decision, not a tenant's.
2. **Per-tenant source authorisation (data, tenant).** Is *this tenant* licensed to read *this publisher domain* right now, via *this method*? Recorded by an authorised tenant member against a stated `basis` (the licence/contract/engagement relied on), bounded in time, revocable, audited — the `scope_authorisations` model, extended for domain-scoped source reads in M1.
3. **Network safety (always on).** Even with (1) and (2), the SSRF layer independently validates the destination; it can never be relaxed by an approval. An authorised domain whose host resolves to a private/metadata address is still refused.

These map to the four distinct questions the task calls out, which are **never** conflated:
- *Technical reachability* (a host resolves and responds) — layer 3 cares, and it is **not** evidence that use is permitted.
- *Terms/licensing review* — part of layer 1 (global) and the `basis` of layer 2 (tenant).
- *Permitted purpose* — layer 2's `basis`, scoped to the tenant's engagement; person-data purposes additionally pass the existing person gate.
- *Commercial-use authorisation* — layer 1's verdict.

**Publicly reachable ≠ permitted.** Reachability (layer 3) grants nothing on its own.

## 2. Who approves, and scope

- **Global verdict:** the platform owner/operator, as a reviewed **code change** in `catalogue.ts` (there is deliberately no runtime endpoint to set a verdict — it is not configuration). Applies **globally** to every tenant.
- **Per-tenant authorisation:** a tenant member holding `source_authorisation:write` (a new permission in M1, mirroring `scope_authorisation:write`: owner/admin/analyst per the role map; **viewer read-only**). Recorded **by a person in a session — an API key cannot authorise** (as `scope_authorisations` already enforces). Applies **per tenant and per exact domain/host** — **default-deny for anything not exactly approved**; no implicit subdomain or publisher-wide widening, and no global allowlist.

## 3. Default-deny

Missing, expired, not-yet-valid, revoked, withdrawn, or ambiguous approval → **deny**, at every layer. There is no default approval and no silent fallback. A source with no global verdict is UNVERIFIED (never runs); a domain with no in-force tenant authorisation is not fetched; a destination the SSRF layer cannot clear is refused.

## 4. Approval record (per-tenant), reusing the proven model

Fields (the `scope_authorisations` shape, extended): `tenant_id`; `scope` (the exact registrable domain or host) and `method` (open / official / licensed — never operator by default); `authorised_by_user_id`; `basis` (non-blank: the licence/contract/engagement); `valid_from`/`valid_until` (bounded, ≤ 1 year, `valid_until > valid_from`); `revoked_at`; `created_at`. Composite PK/FKs on `tenant_id` (RLS + tenant-scoped like every table). "In force" = the same SQL predicate as `scope_authorisations`. Every field is auditable; every mutation writes an append-only audit row (actor, action, scope, basis, window, outcome), with **no secret or sensitive URL component in the log** (the fetcher already redacts credentials from recorded URLs — `fetcher.test.ts` "records the final URL with credential values redacted").

## 5. Suspension, revocation, and existing evidence

- **Revoke/suspend:** set `revoked_at`; effect is immediate — the in-force predicate stops matching, so no further fetch is authorised (as `scope_authorisations` already does: "the runtime no longer finds it"). A second revoke is a conflict. Audited.
- **Existing evidence:** evidence lawfully collected while an approval was in force is **retained** (evidence is append-only; revocation is forward-only and does not rewrite history). It remains subject to the tenant's retention windows and the real deletion path (CLAUDE.md §9); a tenant may delete it like any other evidence. Revocation stops new collection; it does not, by itself, purge past evidence.

## 6. Publisher-domain approval ≠ permission to retrieve a given item

Authorising a **domain** for reading does **not** grant permission to fetch any particular URL on it. A specific article may still be paywalled, behind authentication, or robots-disallowed. Those are enforced at fetch time as typed outcomes — `NEEDS_CREDENTIALS`, `REFUSED`, `UNAVAILABLE` — **never** an override and **never** fabricated content. Robots/access rules, paywalls, CAPTCHAs, rate limits, and explicit blocks are **respected**; there is **no proxy rotation, IP masking, or any evasion mechanism** anywhere in this design.

## 7. Interaction with tenant isolation and access control

Per-tenant authorisations are tenant-scoped rows under row-level security; only the owning tenant's authorised members can create, read, or revoke them, and they are invisible to and unrevocable by any other tenant (as `scope_authorisations` already proves: "invisible to another tenant, which cannot revoke it"). Approvals never cross tenants and never widen a tenant's permissions, plan, vetting, or the person gate.

## 8. Open-host fetching — security design (reuse, never weaken)

An exact-article fetch of an arbitrary publisher is the one case the current fetcher does not serve: it binds to a source's **static** declared host list ([source.ts] "Nothing outside `hosts` is ever contacted"; [source.ts:124-125] a host list "cannot see … a service that fetches any URL"). The minimal, safe extension — **designed here, implemented in M1** — is a network **kind** whose allowed host is the **validated target URL's host**, taken from an **in-force per-tenant authorisation (layer 2)**, with every other control unchanged:

- **HTTP(S) only**; no credentials in the URL; the scheme's default port only.
- **Resolve and validate every destination address** with `isPublicAddress` (refuse loopback/private/link-local/metadata/reserved and mapped/NAT64/6to4), then **pin the connection to the checked address** — validating the address the client actually connects to, not merely an earlier lookup, which is the DNS-rebinding defence already in `createUpstreamFetch`.
- **Re-validate every redirect hop** and keep it on the authorised host; a redirect to a different registrable domain or a non-public address is **refused, not followed**; strict redirect limit (the existing cap).
- **Timeout ≤ 60 s, response-size cap, content-type restriction** (HTML/plain text for article extraction), **per-host concurrency and rate limits** (the existing shared limiter), **credential/sensitive-URL redaction in logs** (existing behaviour).
- **The authorisation decides which host is allowed; it never relaxes the SSRF/public-address/redirect checks.** Approval is not an SSRF override. An authorised domain resolving to a private address is still refused.

**Can the current stack reliably enforce destination-address validation?** **Yes, today** — the fetcher resolves, checks `isPublicAddress` on the answers, and pins the connection to the checked address with no second lookup (`fetcher.test.ts` "opens every connection itself, to the address it checked"; `address.test.ts` covers the ranges). The open-host extension reuses this unchanged; the only new element is sourcing the allowed host from an in-force authorisation instead of a static catalogue list. **No destination-validation limitation needs a workaround.**

## 9. Auditable approval lifecycle (M1 implementation shape — not built in M0)

- **Create:** authenticated + authorised (`source_authorisation:write`, **session only, not an API key**) + validated (scope is a valid registrable domain/host; method in the allowlist; bounded window ≤ 1 year; non-blank basis) + tenant-scoped + audited.
- **Review/expiry:** a required `valid_until` bounds every approval; past it, not in force (fail closed). Policy may require periodic re-confirmation; the bounded window enforces it.
- **Suspend/revoke:** `revoked_at`, immediate effect, audited; a second revoke is a conflict.
- **No unauthenticated endpoint, no default approval, no silent fallback** grants access.
- **M1 additions (deferred):** a `source_read_authorisations` table (the `scope_authorisations` shape + `scope`/`method`), a `source_authorisation:*` permission, and routes mirroring `scope-authorisations.ts` — reusing the exact guards M0 verified below.

---

## M0 completion report

### Code changes
**None in production code.** The enforceable approval *pattern* already exists and is tested (`scope_authorisations`: per-tenant, time-bound, revocable, audited, SQL-in-force, permission-gated, session-only), the "in force" decision is intentionally SQL-based (so a parallel pure decision would diverge from the established shape), and **there is no open-host fetch consumer in M0** (building it is out of scope), so new enforcement code would have nothing to gate and could not be closed-loop tested. Adding an unused table/API/migration would be speculative surface the task rules out ("minimum DB/API changes only if the existing architecture requires them" — it does not here). M0 therefore delivers the policy + design that make M1 implementable, and verifies the invariants M0 depends on with existing tests.

### Tests run (exact commands and results)

| Command | Result |
|---|---|
| `pnpm --filter @repo/collectors exec vitest run test/address.test.ts test/fetcher.test.ts` | **97 passed** (2 files) |
| `pnpm --filter @repo/api exec vitest run test/scope-authorisations.test.ts` (Postgres+Redis up) | **6 passed** (1 file) |

Each Step-5 criterion → its existing proof:

| Criterion | Proven by (passing today) |
|---|---|
| Missing approval fails closed | `scope-authorisations.test.ts` (no in-force row → runtime does not find it); runtime ACTIVE gate `runtime.ts:400` |
| Approval scope is enforced | "records one for the exact normalised target"; "refuses a target that is not the stated type" |
| Revoked/expired fails closed | "revokes once … the runtime no longer finds it"; "validity that is backwards or over a year" refused |
| Unauthorized users cannot create/modify | "is recorded by a person: an API key cannot authorise"; "an analyst may read … but not record or revoke" |
| Tenant A cannot use/modify tenant B's approval | "is invisible to another tenant, which cannot revoke it" |
| Approval cannot bypass SSRF | SSRF is a separate layer, independent of any authorisation (`fetcher.test.ts`/`address.test.ts`: allowlist, redirect re-check, pinned address, public-address ranges) |
| Existing declared-host collectors unchanged | `fetcher.test.ts` "follows a redirect that stays within the allowlist", "opens every connection itself, to the address it checked" — untouched by M0 |
| No secrets/URL components in logs | `fetcher.test.ts` "records the final URL with credential values redacted" |

The last two rows for the **new per-tenant source-read-approval mutations** (authz, tenant isolation on create/revoke) land in M1 and will reuse the exact guards the `scope_authorisations` tests above already prove.

### Human decisions required before any source is approved (M0 → M1 gate)
1. **Owner — global verdict(s):** read the terms of each candidate retrieval mechanism and record a verdict in `catalogue.ts`: whether direct open-host publisher fetch is permitted in principle, and/or whether `jina-reader` (a third-party extraction SaaS — note the data-sharing implication) is permitted. PERMITTED only on read terms.
2. **Owner — model approval:** approve the open-host network kind (the D-M3-style decision) and the per-tenant/per-domain authorisation policy (scope = exact domain, bounded window, who may authorise).
3. **Tenant — licensing basis:** for each publisher domain a tenant wishes to read, an authorised member records the `basis` (licence/contract/engagement). The platform never records this on a tenant's behalf.
4. **Legal — robots/paywall/terms review** for the direct-fetch path before activation.

### Remaining security limitations
- Open-host enforcement is **designed, not built** (M1). Until built, **no code can fetch an arbitrary publisher** — safe by absence.
- The global verdict is an owner **code commit**, not a runtime action — intentional (a verdict is a reviewed decision resting on read terms, not configuration).
- Per-article paywall/robots handling is specified (typed failure, never bypass); its fetch-time enforcement is M1/M2.

### Verdict
**M0 is complete** as policy + open-host security design + auditable-lifecycle specification, with the relied-upon invariants verified by existing passing tests. **M1 cannot begin** until the four human decisions above are made — above all, an owner global verdict for a retrieval mechanism and approval of the open-host model and per-tenant authorisation policy. No source is approved, no verdict changed, no collector built, and no live publisher request made.
