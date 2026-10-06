# Future Scope — Defence / Government Deployment

Status: **deferred, not being built.** This note exists so the possibility is recorded, the seams that keep it open are named, and — most importantly — the things that must NOT be built until it is a real, funded requirement are listed explicitly. A future session (human or AI) that reads this should treat the "do not build" list as binding.

---

## The possibility

A defence or government customer may later want VA/PT capability against systems they do not own in the ordinary commercial sense — for example infrastructure under their legal mandate. Their authorisation comes from a government mandate or statutory power, not from domain-ownership or a commercial contract.

This is **not** a harder tier of the commercial product. It is a different legal basis, a different deployment model, and a different sales relationship. Treating it as "a commercial tenant with broader scope" would turn the commercial SaaS into an attack platform — the single worst outcome for this project. (This mirrors the earlier pivot: the OSINT platform was built for the IAF under PS-18, and going commercial required stripping the defence assumptions out. The same separation applies here, more sharply.)

---

## The seams left open (so this stays possible without building it)

The commercial architecture is being built with these already in place, because they are good commercial design anyway — not because of defence:

1. **Pluggable authorisation.** Authorisation is an interface: a tier declares what proof creates a scope row. Commercial tiers implement ownership-verification and signed-scope. A future "government-mandate" authorisation type would be a new implementation of the same interface — added separately, under its own process.

2. **Tenancy that can collapse to single-tenant.** The multi-tenant design can be deployed as an isolated single-tenant instance without a rewrite. A defence customer would get a dedicated, isolated deployment in their own environment, never a tenant in the shared SaaS.

3. **Pluggable active egress.** The engine's egress point is an interface (see VA-PT-ARCHITECTURE §5). A defence deployment running in the customer's own environment would egress from there, which is also the commercial "customer-supplied runner" option.

4. **Open-weight LLM profile and on-prem model serving** (already built, currently disabled vLLM profile). A government deployment needing in-environment inference uses the same seam.

These seams cost nothing extra now and are justified commercially on their own. That is why they are built; nothing beyond them is.

---

## Do NOT build until it is a real, funded requirement

A future session must not, on the strength of this note or a customer's expression of interest:

- Build a "defence tier" or "government tier" in the commercial SaaS.
- Add any authorisation path that lets a shared-SaaS tenant run active work against third-party or non-owned systems.
- Add classification markings, air-gap assumptions, or clearance handling to the commercial product.
- Build any capability whose purpose is offensive action against systems the tenant has not proven authorisation for.
- Weaken, bypass or make-configurable the scope-authorisation gate, the human-approval step, or the vetting requirements, for any customer.

If a defence requirement becomes real, it starts as its own planning exercise — a separate deployment, a separate authorisation implementation, a separate legal review — resuming from this note. It does not start by relaxing the commercial product.

---

## When this unfreezes

Revisit this note only when there is: a named defence/government customer, a funded engagement, a defined legal authorisation basis, and a decision to deploy in an isolated environment. Until all four exist, the commercial VA/PT product (VA-PT-ARCHITECTURE.md) is the whole scope, and this note stays frozen.
