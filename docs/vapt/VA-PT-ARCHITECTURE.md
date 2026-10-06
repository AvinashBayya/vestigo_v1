# VA/PT Architecture Decision

Status: agreed, October 2026. This extends `docs/ARCHITECTURE-DECISIONS.md` for the Vulnerability Assessment (VA) and Penetration Testing (PT) capability. Read that document first; this one does not repeat it.

VA and PT are **active** capabilities: they probe, scan and (for PT) exploit a target's systems. Everything built through Phase 6 is **passive** OSINT, which never touches the target. This is a new class of capability, not a new collector, and it carries its own legal regime.

---

## 1. The governing rule

**Active work against a target is structurally impossible without a scope authorisation that names the exact target and the allowed activity.** This is enforced the way source labels are: not by a check a developer must remember, but by a design where the unauthorised path does not exist. No scan engine, no exploit engine, and no tool container may accept a target that does not resolve to an in-force `scope_authorisations` row for the calling tenant.

Unauthorised active scanning is a criminal offence (India: IT Act 2000 ss. 43, 66; equivalents elsewhere). The platform's liability position is: the customer was vetted, asserted authorisation naming the target, accepted terms placing misuse liability on themselves, and every action is recorded in an append-only audit log. The authorisation check is one link; the immutable record is the rest. Both are mandatory.

---

## 2. Three tiers, one engine

The scan and exploit engine is built **once**. The tiers differ only in what proof is required before a `scope_authorisations` row is created, and whether a human approves it.

| Tier | Who | Target | Proof required | Human approval |
|---|---|---|---|---|
| **VA — self-owned** | A company assessing its own assets | Domain or IP the customer controls | Automated ownership verification (DNS record / file token for domains; RDAP + route-object for IP ranges) | No — self-serve to vetted tenants |
| **PT — self-owned** | A company testing its own systems | Assets the customer owns | Signed internal authorisation naming targets, window and allowed activities | Yes — human approval before any exploit; per-exploit-class consent |
| **PT — third-party** | A security firm testing a client's systems | The client's assets | Tri-party signed scope (tester, asset owner, asset) + proof the customer is a licensed firm | Yes — as above, plus stronger vetting |

All three write the same primitive. The engine never knows or cares which tier authorised a row — it only checks that an in-force row exists for the exact target.

---

## 3. VA before PT

VA is built first, because PT depends on it: you cannot exploit what you have not found. PT consumes VA findings. This also lets the safe, automatable, self-serve capability ship and earn while the higher-friction PT capability is built behind its stronger gate.

---

## 4. What makes PT structurally harder than VA

PT is not "VA with the safety off". It carries four properties VA does not, and each is a design constraint:

- **It can break the target.** An exploit can crash a service or corrupt data. The engine needs blast-radius controls, a safe/aggressive distinction, and per-exploit-class consent. An exploit with no declared blast radius does not run.
- **It keeps a human in the loop.** Automated *exploitation* triggered from a web form is the dangerous product. A human approves before any exploit runs. This is a deliberate speed bump, not a limitation to be optimised away.
- **Its legal exposure is higher.** Unauthorised PT adds the damage/disruption offences on top of unauthorised-access. The scope proof is correspondingly stronger (signed, not automated).
- **It narrows the market.** PT's capability is dual-use. Vetting for PT is stricter than for VA.

---

## 5. The platform is the attack source

When the platform scans or exploits, the traffic originates from the platform's own infrastructure — to the target, the platform is the attacker. Consequences: the platform's IPs can be blocklisted; the cloud provider can terminate the account for abuse; the platform is named in any complaint. Therefore:

- Active traffic egresses from a dedicated, isolated pool, never shared with the OSINT collectors' egress.
- A future option (not built now) is customer-supplied egress for PT — the customer runs a lightweight runner in their own infrastructure, so the exploit traffic originates from them, not from the platform. The engine is designed so the egress point is pluggable, to keep this option open.

---

## 6. Reuse from the legacy codebase

The legacy repo already contains the spine of the tool-orchestration layer, as passive wrappers that become the VA/PT tool-runner pattern:

- `src/utils/collectors/external/`: `spiderfoot.ts`, `theharvester.ts`, `ivre.ts`, `searxng.ts`, `sherlock.ts`, `jina-reader.ts` — container-tool integration wrappers.
- `src/utils/scan-authorization.ts` — the original scope-authorisation logic (predecessor of the `scope_authorisations` table).
- `src/utils/rate-limit*.ts`, `src/utils/validation.ts` — pure utilities.

These are ported under the same three-verdict discipline as Phase 3 (KEEP / REWRITE / DROP), through the fabrication gate, never copied wholesale. The parser/payload-builder/utility functions across the 85 legacy modules are harvested by the automated classification pass described in the legacy-reuse plan.

---

## 7. What reuses what already exists

- **`scope_authorisations` table** (Phase 3) — the authorisation primitive. Extended with: authorising tier, proof reference, blast-radius class, approval record, and validity window.
- **ACTIVE collection mode** (Phase 3) — already requires a scope row; VA/PT extend the same gate.
- **The one fetcher / SSRF protection** (Phase 3) — active tools egress through a controlled path, extended for the dedicated active-egress pool.
- **Per-tenant vault** (Phase 2) — tool credentials and customer egress-runner keys.
- **Append-only audit log** (Phase 2) — every scan and exploit action recorded immutably.
- **The person-data gate pattern** (Phase 6) — the model for how authorisation is enforced on both action and the reading of results.
- **Jobs and fault isolation** (Phase 4) — scans and exploits run as background jobs with bulkheads, timeouts and circuit breakers.
- **The evidence path** (Phase 3) — findings are evidence, with the same no-fabrication and provenance rules.

---

## 8. Hard limits

- A commercial SaaS tenant may **never** run active work against a third-party system on the strength of interest, intent, or a future relationship. Only a verified scope row authorises it.
- No tier may be collapsed into a weaker one by configuration. PT's human-approval step is not a feature flag.
- Findings are evidence and follow every no-fabrication rule. A scan that failed is reported as failed; a vulnerability not confirmed is labelled as unconfirmed; severity is never invented.
- Exploit code and payloads are handled as untrusted, dangerous artefacts: never executed in the platform's own origin, never run outside a scope row, always logged.
