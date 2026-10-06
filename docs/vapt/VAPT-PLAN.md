# Vestigo VA/PT — Plan, Execution & Continuation

This is the controlling document for the VA/PT capability. It is written to be read cold in a fresh
session. If you are an AI agent (Claude Code or Antigravity) picking this up, read these three files
in order before doing anything:

1. `CLAUDE.md` (repo root) — the standing rules. They govern everything.
2. This file — what to build and in what order.
3. `VAPT-REFERENCES.md` — what to reuse from the legacy folder and external repos, and what never to.

Also read `docs/ARCHITECTURE-DECISIONS.md`, `docs/VA-PT-ARCHITECTURE.md` and
`docs/FUTURE-SCOPE-defence.md` once. Do not relitigate anything settled in them.

---

## 0. Where the project is

Vestigo's six core phases are complete and committed: scaffold, data+tenancy, auth, collector SDK,
collector ports, jobs/AI/reports, and the start of the frontend (Phase 6a done; 6b auth done, the
rest of 6b open). ~1,561 tests, gates green. The backend is ~90% complete; the frontend ~20%.

**VA/PT is new scope added after Phase 6.** It does not replace anything. It extends the existing
collector/evidence/jobs architecture with a new discipline.

---

## 1. The one rule that governs all of this

Everything built through Phase 6 is **passive** OSINT: it reads public records and never touches the
target. VA and PT are **active**: they probe, scan, and (for PT) exploit a target's own systems.

**Active work against a target is structurally impossible without an in-force `scope_authorisations`
row naming the exact target.** Enforced the way source labels are — the unauthorised path does not
exist, not merely a check a developer must remember. This includes light live requests (a TLS
handshake, an HTTP header fetch): any request to the target's own infrastructure, however small,
needs a scope row. This resolves the open question the earlier plan left (`tls-hygiene` /
`security-headers`): **they are gated, in V1.**

Unauthorised active scanning is a criminal offence (India: IT Act 2000 ss. 43, 66). The platform's
protection is the chain: vetted customer → asserted authorisation naming the target → accepted terms
placing liability on them → every action in the append-only audit log. The scope check is one link;
the immutable record is the rest.

---

## 2. Architecture in one picture

```
New package: packages/vuln-engine     (mirrors packages/osint-engine exactly)
New discipline: 'ASM'                  (added to TECHINT|SOCMINT|MEDIAINT|GEOINT|PERSON)
New tables: scope_authorisations extended; ownership_attestations (V2)
Tool containers: Nmap, Nuclei (V2); Metasploit-class (V3) — HTTP only, never linked
Active egress: a dedicated isolated pool, separate from OSINT collectors' egress
```

Findings are evidence. They follow every no-fabrication, provenance and claim-strength rule the OSINT
collectors already follow. A CVE matched from a version string is `CORRELATED` or `DERIVED`, never
`OBSERVED`. A scan that failed is reported as failed. A vulnerability not confirmed is labelled
unconfirmed. Severity is never invented.

---

## 3. The three tiers (one engine, different proof before a scope row is created)

| Tier | Who | Target | Proof before a scope row | Human approval |
|---|---|---|---|---|
| VA self-owned | A company assessing its own assets | Domain/IP it controls | Automated ownership verification | No — self-serve to vetted tenants |
| PT self-owned | A company testing its own systems | Assets it owns | Signed internal authorisation | Yes — before any exploit; per-exploit-class consent |
| PT third-party | A security firm testing a client | The client's assets | Tri-party signed scope + licensed-firm proof | Yes — plus stronger vetting |

VA is built first; PT depends on VA findings (you cannot exploit what you have not found).
Defence/government is **not** a tier here — see `FUTURE-SCOPE-defence.md`. It is frozen with a
do-not-build list, and nothing in VA/PT may drift toward it.

---

## 4. Build order

Each stage ends at a checkpoint you review before the next. Do NOT start the next stage on a red
build. One stage per agent session; split a stage across sessions by sub-task if it runs long.

### Stage A — `packages/vuln-engine` skeleton + ASM discipline (no collectors)
Mirror `packages/osint-engine`: the registry pattern, the evidence path, claim-strength labelling,
the fetcher-owns-every-connection rule. Add `'ASM'` to the discipline enum (additive change to
`packages/core`). No collector runs yet; a fake in-memory one in test code exercises the frame.
**Checkpoint:** full suite green; the ASM discipline is recognised end to end; a fake ASM collector's
evidence writes through the existing one evidence path.

### Stage B — the scope-authorisation extension
Extend `scope_authorisations` (Phase 3) with: authorising tier, proof reference, blast-radius class,
approval record, validity window. Add the gate that every ASM collector passes through it. Nothing
active runs yet.
**Checkpoint:** an ASM collector with no scope row is refused by every path, including direct
invocation; a test proves it. Cross-tenant isolation tests cover the new table.

### Stage C — V1 passive ASM collectors (buildable now, within existing licence tiers)
Four collectors, each a normal registry entry with its own licence verdict. All four are gated by a
scope row (see §1).

| Collector | What it does | Data sources (tier) | Claim strength |
|---|---|---|---|
| `cve-match` | Correlates software/versions already observed by TECHINT collectors against known CVEs | NVD + CISA KEV (Tier A, confirmed, already catalogued) | `CORRELATED` |
| `subdomain-takeover-detect` | Flags dangling CNAMEs pointing at unclaimed services | DNS (registered) + one HTTP fetch to the tenant's own target | `DERIVED` |
| `secrets-exposure` | Cross-references historical archives for exposed config/secret paths | Common Crawl CDX + GitHub code search (registered) | `DERIVED` |
| `tls-hygiene` / `security-headers` | Cert expiry, cipher strength, header hygiene | Direct TLS handshake / HTTP GET against the tenant's own declared target | `OBSERVED` |

**Checkpoint:** each collector has passing tests on recorded fixtures; `cve-match` never labels a
version-string match `OBSERVED`; a failed scan is a typed error, never an empty success; the scope
gate refuses an unauthorised target.

### Stage D — V1 OSINT breach/identity collectors (from the mosint service list)
Each backing service is its OWN registry entry, `PASSIVE_API`, vault-only credentials, independently
licence-vetted. Expect most to land `UNVERIFIED` pending a terms read (same bucket as HIBP).
Candidates: `hunter-io`, `emailrep`, `intelx`, `breachdirectory`, `psbdmp`. These are PERSON-adjacent
— they go through the entitlement + vetting gate.
**Checkpoint:** each registered with a verdict and a recorded terms URL (or `UNVERIFIED` with the
reason); none runs in production while `UNVERIFIED`.

### Stage E — V2 active scan (gated, next tier)
Nmap and Nuclei as separate containers over HTTP — identical pattern to the deferred
SpiderFoot/theHarvester containers; no GPL/AGPL code in the app process. Add the
`ownership_attestations` table (a real schema addition). Targets passed as arguments, never
shell-interpolated. Active traffic egresses from the dedicated isolated pool.
**Checkpoint:** a scan runs end to end against an authorised, ownership-attested target; the same scan
against an unattested target is refused; a scan result is `OBSERVED`, anything inferred `DERIVED`.

### Stage F — V3 assisted PT (human-in-the-loop, vetted tenants only)
Human-driven only. The tool surfaces findings and suggests next steps; a person decides and acts. No
step is automated end to end. Metasploit-class frameworks run as separate containers, same isolation
as V2. **Blocked until the legal surface exists:** ToS, AUP, a written vetting procedure, signed
per-engagement authorisation, and (recommended) cyber-liability insurance.
**Checkpoint:** an exploit cannot run without a scope row AND a human approval AND per-exploit-class
consent; a test proves each is independently required.

---

## 5. Hard anti-goal

**Never build "one-click autonomous pentest anyone can point at any target."** No tool may decide on
its own to exploit something and act on it. No tool may help hide who ran an action. If a design
starts to resemble this — autonomous exploitation, attribution-hiding, Tor-routed egress — stop and
flag it. This is the `ai-pentest-agent` pattern and it is incompatible with a KYC'd platform at every
tier. See `VAPT-REFERENCES.md` for why that repo is the one to design *against*.

---

## 6. What reuses what already exists

- `scope_authorisations` (Phase 3) — the authorisation primitive, extended in Stage B.
- ACTIVE collection mode (Phase 3) — already requires a scope row; ASM extends the same gate.
- The one fetcher / SSRF protection (Phase 3) — extended for the dedicated active-egress pool.
- Per-tenant vault (Phase 2) — tool credentials and (future) customer egress-runner keys.
- Append-only audit log (Phase 2) — every scan and exploit action, immutably.
- The person-data gate pattern (Phase 6) — the model for enforcing authorisation on action and on
  reading results.
- Jobs + fault isolation (Phase 4) — scans and exploits are background jobs with bulkheads, timeouts,
  circuit breakers, dead-letter queue, idempotency.
- The evidence path (Phase 3) — findings are evidence, same rules.
- `decideModuleAccess` (`packages/access`) — module gating by entitlement for the VA/PT tiers.
- Pre-dispatch usage metering (Phase 4) — per-tool `quota_cost` ties in here.

---

## 7. Continuation protocol (for every agent session)

1. Read `CLAUDE.md`, this file, and `VAPT-REFERENCES.md` first. Confirm which stage you are on from
   `docs/PLAN.md`.
2. One stage (or one sub-task of a large stage) per session. No parallel agent workflows — a parallel
   run in Phase 3B lost 21 of 26 agents to the session limit and produced nothing.
3. Targeted edits over rewrites. Reuse legacy functions per `VAPT-REFERENCES.md`; never copy a
   fabricating function across.
4. Report only with real command output. "Done" without a passing test command is not done.
5. At the checkpoint: run the full suite, confirm green, update `docs/PLAN.md` with what changed and
   the next sub-task, then stop for review.
6. If a task conflicts with a rule in `CLAUDE.md`, stop and ask. Do not silently pick an
   interpretation.
7. Never weaken a gate — fabrication, scope, person-data, isolation — to make something pass.

---

## 8. Still-open decisions (do not guess; ask the owner)

1. **Which active tools** beyond Nmap + Nuclei (V2) and a Metasploit-class framework (V3). Owner
   selects based on whether Customer A wants web-app, network, or both.
2. **Admin console / module registry** (per-tool `quota_cost`, JSON-schema-driven run forms) — build
   now as part of the frontend, or hold until the VA/PT UI stage.
3. **The V3 legal surface** — ToS, AUP, vetting procedure, insurance — is a non-engineering blocker
   on V3 and must be in place before it ships.

Everything else in this document is decided. Build it.
