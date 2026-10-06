# Vestigo VA/PT — Agent Operations & Everything Else

The third document: how the coding agents (Claude Code and Antigravity in VS Code) should run this
work, which models to use for which task, and the items not covered elsewhere that would otherwise be
forgotten.

---

## 1. Model selection by task

The right model depends on the work. Use the strongest available for architecture and security-
critical code; drop to a faster one for mechanical work. Model names move; the *principle* is what to
follow. Check the model picker for the current best in each class before a session.

| Task | Model class | Effort / thinking | Why |
|---|---|---|---|
| Architecture, schema design, the scope-authorisation gate, anything touching tenancy or auth | The most capable model available (highest "Opus"/"Max" tier) | **Maximum / extended thinking** | These are the load-bearing, security-critical decisions. A wrong tenancy or scope gate is a breach. Pay for the best reasoning. |
| Writing a new collector, a tool-container runner, a parser | A strong mid/high model | **High** | Real logic, real correctness requirements, but a known shape to follow. |
| Porting a pure utility from `legacy/`, mechanical edits, test scaffolding | A fast model | **Medium** | Deterministic, low-risk, high-volume. Speed matters more than depth. |
| The automated legacy-classification pass (Part 1d of REFERENCES) | A fast model running a script | **Low** | It runs a script and tabulates; it is not reasoning about design. |
| Reviewing a finished stage adversarially before the checkpoint | The most capable model, a FRESH session | **Maximum** | A reviewer must not be the author. Switch model or at least session, and tell it to assume defects exist. |

**Rules for model use:**
- **Never let a fast model design the scope gate, the ownership-attestation flow, or anything in
  `CLAUDE.md` §2 (tenancy) or §9 (privacy).** If a session drifts into that on a fast model, stop and
  switch up.
- **One stage per session**, whatever the model. When context fills, write a handover into
  `docs/PLAN.md` and start fresh. A long session on a cheap model produces worse code than a fresh
  session on the same model.
- **Reviews use a fresh session**, ideally a different model from the author, always at maximum
  effort. The adversarial reviews in earlier phases (which refuted 23 of 24 findings and kept the one
  that held) only worked because the reviewer was not defending its own work.
- **No parallel agent workflows.** A parallel run in Phase 3B lost 21 of 26 agents to the session
  limit and produced nothing. Sequential only.

---

## 2. Claude Code vs Antigravity — division of labour

Both are capable; use each where it is strongest.

- **Claude Code** — the primary builder. It has the full repo context, runs the gates, and is where
  every stage's implementation happens. All the `CLAUDE.md` rules are written for it.
- **Antigravity (VS Code agent)** — use for: the automated legacy-classification pass (a contained
  scripting job), bulk mechanical edits across many files, and as the *fresh-session reviewer* for a
  stage Claude Code built (so the reviewer is genuinely a different agent). Do not have both edit the
  same files in the same stage — one builds, the other reviews or scripts.

Whichever agent runs, it reads the same three VA/PT documents plus `CLAUDE.md` first. The rules are
the agent-independent source of truth.

---

## 3. Per-session checklist (paste-ready discipline)

At the start of every VA/PT session, the agent confirms in one line each:
1. Which stage (from `docs/PLAN.md`).
2. It has read `CLAUDE.md`, `VAPT-PLAN.md`, `VAPT-REFERENCES.md`.
3. The model and effort level chosen, and why, per §1.

At the end of every session:
1. Full suite run, with real output pasted.
2. `docs/PLAN.md` updated: what changed, what passed, the next sub-task.
3. Anything it was unsure about, flagged — not silently resolved.
4. Nothing committed until the owner says so (the owner commits).

---

## 4. The forgotten items — things not covered elsewhere

These are real and would otherwise be discovered late.

### 4a. Legal and commercial blockers (non-engineering, gate V3 and parts of V2)
- **Terms of Service, Acceptable-Use Policy, Privacy notice** — drafted by a lawyer who knows SaaS.
  The AUP is what lets you terminate a customer who misuses an active-scanning tool. V3 cannot ship
  without it; V2 is risky without it.
- **A written customer-vetting procedure** — not a vague intention. Who is approved for VA vs PT, what
  evidence they provide, who signs off.
- **DPDP obligations** — as a data fiduciary: consent basis, retention windows, real deletion,
  grievance officer, breach notification. VA/PT adds scan data to what must be retained and deleted.
- **Cyber-liability insurance** — strongly recommended before the first active-scanning customer.
- **The licence verdicts still open from the OSINT build** — HIBP (UNVERIFIED), the mosint services,
  NVD's commercial terms. Each needs a terms read and a recorded URL before production use.

### 4b. The platform-as-attacker problem (engineering, affects V2 deployment)
When the platform scans, the traffic comes from the platform's IPs — to the target, the platform is
the attacker. Consequences: IP blocklisting, cloud-provider abuse termination, being named in a
complaint. Decisions to make before V2 ships:
- Active traffic egresses from a **dedicated isolated pool**, never shared with OSINT collector
  egress.
- Design the egress point as **pluggable**, so a future "customer-supplied runner" option (the
  customer runs a lightweight agent in their own infra, so scan traffic originates from them) can be
  added without a rewrite. This is also the seam a defence deployment would use — but build only the
  interface now, nothing defence-specific (see `FUTURE-SCOPE-defence.md`).

### 4c. Operational items carried over from the core build (still open)
- **No run cancellation** — a runaway job currently cannot be stopped. This matters much more for an
  active scan than a passive one. Build cancellation before V2.
- **BullMQ failed-job set grows indefinitely** — needs a retention policy. More urgent once scans
  produce large failed payloads.
- **Monitors are not built** — scheduled re-scans (a weekly VA of an authorised asset) are a natural
  VA/PT feature and depend on the monitor capability deferred in Phase 4.
- **No CI pipeline, no OpenTelemetry** — Phase 8 was deferred for budget. Active scanning raises the
  cost of flying blind: you want traces and alerts before real scans run against real infrastructure.

### 4d. Product/UI items
- **The admin console / module registry** (per-tool `quota_cost`, JSON-schema run forms) is needed to
  expose VA/PT tools without hand-building a form per tool. Decide whether it lands in the remaining
  frontend work (6b) or a dedicated VA/PT UI stage.
- **Finish 6b first.** VA/PT is a large new capability; the core product still has no visible
  frontend beyond auth. A working, visible product is worth more than two half-built halves. Strong
  recommendation: complete 6b, then start VA/PT Stage A.

### 4e. Secrets hygiene (immediate, unrelated to VA/PT but outstanding)
An earlier upload included the live `.env`. If not already done: rotate `LLM_HOSTED_API_KEY`,
`AUTH_SECRET` and `VAULT_MASTER_KEY`, and clear them from any shell history. Never upload `.env`.

### 4f. Documentation drift to fix in one pass
- `README.md` still says collectors are ported "in Phase 3B" as if pending — they are done.
- `CLAUDE.md` §6 lists `packages/ui` (shadcn) and `services/vision` as if they exist — they are
  placeholders. Mark them so.
- Fold `vestigo-vapt-osint-plan.md` (the earlier loose plan) into these three documents and delete it,
  so there is one source of truth, not two overlapping ones.

---

## 5. The sequencing recommendation, stated plainly

1. **Rotate the leaked secrets** (4e) — now, before anything.
2. **Finish Phase 6b** — the frontend. Get a visible, demoable product.
3. **Fix the documentation drift** (4f) in one small pass.
4. **Run the automated legacy-classification pass** (REFERENCES Part 1d) — cheap, and it produces the
   harvest list VA/PT needs.
5. **VA/PT Stage A** — the `vuln-engine` skeleton.
6. Continue through Stages B–F, reviewing at each checkpoint, in fresh sessions, with the model
   discipline in §1.

Start the legal work (4a) in parallel with step 2, because it has the longest lead time and it gates
V3 regardless of how fast the engineering goes.
