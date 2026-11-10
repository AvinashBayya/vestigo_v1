# Vestigo Development Guide
## For Claude Code and Antigravity (agent-agnostic)

## 1. Purpose

This guide tells any coding agent (Claude, Antigravity, or future agents) how to work on Vestigo.

It complements `CLAUDE.md` (which holds the hard rules) by defining:
- What to build
- In what order
- How to integrate external repositories
- How to escalate when blocked

## 2. Project identity

Vestigo is an authorized IAF-compliant OSINT, media-intelligence, cybersecurity, and investigation platform.

It supports:
1. SOCMINT
2. MEDIAINT
3. GEOINT
4. Media Forensics
5. TECHINT
6. CTI
7. FININT
8. Dark-web intelligence

## 3. Core principles

1. Never fabricate data.
2. Never silently remove planned capability.
3. Reuse existing code before writing new code.
4. Wire before build.
5. Gate before delete.
6. Work in small, testable increments.
7. Report exactly what changed, what passes, and what remains.

## 4. Repository map

| Repo | Role |
|---|---|
| Vestigo (main) | Core platform: auth, API, workers, evidence, UI |
| SOCMINT Kavach | SOCMINT collectors, workflows, normalization |
| Social Media AI Agents | Social platform adapters, agent workflows |
| Social Media AI Agents v2 | Improved/newer adapters and agent patterns |
| Agent-Reach | Public web/YouTube/GitHub/transcript access |
| SpiderFoot | Broad OSINT automation |
| theHarvester | Email/subdomain/host discovery (includes Shodan module) |
| Shodan Python | Internet exposure (defer; use via theHarvester) |
| Sherlock | Username presence |
| Mastodon | Public social API |
| LinkedIn Posts Scraper | Optional LinkedIn collector |
| Facebook Scraper | Optional Facebook collector |
| Ropcat | Optional unofficial-API adapter |
| Osiris | OSINT platform reference |
| mxcheck | Mail/DNS infrastructure checks |
| Heretic | Reference only, not integrated |
| Ego-Lite | Optional browser-agent runner |
| osint-toolbox-mcp | MCP wrapper / tool-runner |

## 5. Integration architecture

```text
Vestigo UI
→ Vestigo API
→ BullMQ job
→ Collector Runtime
→ Collector Adapter (API / CLI / container / scraper)
→ Normalizer
→ Evidence Store
→ Entity / Claim Extraction
→ Workspace / Graph / Report
```

Every external tool becomes a pluggable adapter in `packages/collectors/src/platform/`.

## 6. Integration recipe (universal)

For every external tool/source:

1. Declare source in `packages/collectors/src/catalogue.ts`
2. Write adapter in `packages/collectors/src/platform/<tool>.ts`
3. Register via `defineCollector` (contract.ts)
4. Export from `platform/index.ts` and `collectors/index.ts`
5. Worker picks it up automatically via existing `CollectionExecutor` / `CollectorJobProcessor`

Two adapter patterns:

| Pattern | When to use | Key API |
|---|---|---|
| NETWORK | API-based sources (Shodan, Mastodon, Reddit, GitHub) | `ctx.fetch()` |
| LOCAL_ANALYSIS | CLI/container tools (Sherlock, Maigret, theHarvester, SpiderFoot) | `ctx.record()` + subprocess/container call |

## 7. Source declaration rules

In `catalogue.ts`, every source needs:

```typescript
{
  id: string,
  name: string,
  access: "OPEN" | "OFFICIAL" | "OPEN_OR_OFFICIAL" | "LICENSED",
  licence: {
    commercialUse: "PERMITTED" | "UNVERIFIED" | "BLOCKED",
    reason: string,
    check: LicenceCheck | null
  },
  network: SourceNetwork | null,
  attribution: Attribution | null
}
```

Rules:
- New/unknown sources default to UNVERIFIED (listed, not run).
- Flipping UNVERIFIED → PERMITTED is a normal reviewed code change after licence review.
- BLOCKED is permanent only when the licence genuinely prohibits the use case.

## 8. Adapter template (NETWORK pattern)

```typescript
import { defineCollector } from "../contract.ts";
import { z } from "zod";

export const <tool>Collector = defineCollector(
  {
    id: "<tool>.<capability>",
    version: "1.0.0",
    displayName: "<Tool> <Capability>",
    discipline: "<DISCIPLINE>",
    targetTypes: ["<TARGET_TYPE>"],
    collectionMode: "NETWORK",
    source: "<source-id>",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 60000,
    resultSchema: ResultSchema,
  },
  async (ctx) => {
    const response = await ctx.fetch(`/api/...`, { method: "GET" });
    const data = await response.json();
    const result = normalize(data);
    return ctx.found(result, [{ response, observedAt: null }]);
  },
);
```

## 9. Adapter template (LOCAL_ANALYSIS pattern)

```typescript
import { defineCollector } from "../contract.ts";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);

export const <tool>Collector = defineCollector(
  {
    id: "<tool>.<capability>",
    version: "1.0.0",
    displayName: "<Tool> <Capability>",
    discipline: "<DISCIPLINE>",
    targetTypes: ["<TARGET_TYPE>"],
    collectionMode: "LOCAL_ANALYSIS",
    source: "<source-id>",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "DERIVED",
    timeoutMs: 180000,
    resultSchema: ResultSchema,
  },
  async (ctx) => {
    const { stdout } = await exec("<tool>", [ctx.target.value, "--json"]);
    const parsed = JSON.parse(stdout);
    const result = normalize(parsed);
    const record = ctx.record(result);
    return ctx.found(result, [{ response: record, observedAt: null }]);
  },
);
```

## 10. Shodan isolation rule

Shodan is integrated **through theHarvester**, not as a separate direct collector (for now).

```text
Vestigo
→ theHarvester adapter
→ theHarvester's Shodan module
→ Shodan API (key in theHarvester config)
→ normalized results back to Vestigo
```

- `shodan-internetdb` stays BLOCKED (free tier, non-commercial).
- No separate `shodan-api` source needed yet.
- Later, if direct Shodan control is needed, add `shodan-api` source with LICENSED access + API key vault.

## 11. Tools to integrate (priority order)

### Phase 1 — Licence reviews + easy flips
Flip UNVERIFIED → PERMITTED for:
- wayback-cdx
- github-api
- bluesky
- reddit-api
- brave-search
- crtsh
- cloudflare-doh

### Phase 2 — CLI tool adapters
- Sherlock
- Maigret
- theHarvester
- SpiderFoot

### Phase 3 — API adapters
- Shodan (via theHarvester)
- Mastodon
- Agent-Reach (public channels)
- mxcheck

### Phase 4 — Worker extensions
- Tool-runner queue (if needed)
- Monitor scheduler
- Media-forensics integration
- Dark-web monitoring

### Phase 5 — Remaining domains
- FININT
- Remaining CTI
- UI polish

## 12. Tools to skip

- Heretic (reference only)
- Direct Shodan collector (defer; use theHarvester)

## 13. Escalation rules

If an agent is blocked or unsure:

1. State the blocker in one sentence.
2. Classify the task (allowed / gated / deferred / not permitted).
3. Propose the compliant path.
4. Do not silently delete or skip.
5. Ask the operator only if genuinely blocking.

## 14. Definition of done

A feature is complete only when:

1. Backend/API/data flow exists or is wired.
2. Collector/source is registered where applicable.
3. Permission/licence/authorization gates are handled.
4. UI is implemented using the generated client.
5. Loading, empty, error, and permission states exist.
6. Tests exist.
7. Relevant checks pass.
8. Documentation is updated.
9. No fabricated data exists.
10. The feature is visible in the product.

## 15. How to use this guide

- Claude: read `CLAUDE.md` first, then this guide.
- Antigravity: read this guide first, then `CLAUDE.md` for hard rules.
- Both: follow the integration recipe (§6) for every new tool.
- Both: escalate per §13 when blocked.