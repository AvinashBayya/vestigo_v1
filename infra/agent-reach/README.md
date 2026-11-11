# Agent-Reach tool container

The first tool container in Vestigo. It wraps **Agent-Reach**
(<https://github.com/Panniantong/Agent-Reach>, MIT) — a CLI that reads public
web and platform channels — and presents each channel to the collector layer as
a `LOCAL_ANALYSIS` source.

- Collector: [`packages/collectors/src/platform/agent-reach.ts`](../../packages/collectors/src/platform/agent-reach.ts)
- Runner (the repo's only subprocess): [`packages/collectors/src/tool/container.ts`](../../packages/collectors/src/tool/container.ts)
- Worker wiring: [`apps/worker/src/worker.ts`](../../apps/worker/src/worker.ts) (`configureAgentReach`)

## How it is invoked

The worker launches the image **one-shot per collection**, argv-only (never a
shell), with a timeout and an output cap:

```
<command> <base-args...> <channel> <action> <target>
# default: docker run --rm vestigo/agent-reach <channel> <action> <target>
```

`<command>` and `<base-args...>` are `AGENT_REACH_COMMAND` and
`AGENT_REACH_BASE_ARGS` (see `.env.example`). A deployment adds the mounts or
environment a login-gated channel's session needs to the base args.

## The envelope contract

The container's entrypoint (`entrypoint.py`) prints exactly one JSON object:

```json
{
  "collectedAt": "2026-11-11T09:00:00Z",
  "items": [
    { "url": null, "title": null, "author": null, "publishedAt": null, "text": null }
  ]
}
```

- `collectedAt` is the container's own clock when it ran — a measured value,
  not a stand-in for an item's (unknown) publication time, which stays `null`.
- Each item's fields are taken from Agent-Reach's output or are `null`. An item
  the adapter does not recognise field-by-field is preserved whole as `text`,
  so nothing the tool returned is dropped or guessed.
- The collector, not the container, states the result's identity (`tool`,
  `channel`, `action`, `query`): a channel's output can never relabel itself.

A failure is a failure: if Agent-Reach cannot start, exits non-zero, or reports
`ok: false`, the entrypoint prints nothing to stdout and exits non-zero, so the
collector records a **failed** collection, never an empty "nothing found".

## Channels

The entrypoint is channel-agnostic: it passes `<channel>` straight to
Agent-Reach, so every channel Agent-Reach supports works (web, github, youtube,
v2ex, bilibili, xueqiu, xiaoyuzhou, boss, reddit, linkedin, twitter/X,
xiaohongshu, facebook, instagram). The operator enables or disables each channel
**per deployment**, two ways, both of which require the catalogue verdict to be
`PERMITTED` first (it is, by the operator's recorded decision):

1. `agent-reach add <channel>` / `agent-reach remove <channel>` inside the
   container (the tool's own per-channel toggle), and
2. the tenant collectors registry's per-collector `enabled` flag.

People-centric channels are `PERSON`-discipline, so the tenant plan and vetting
gate applies to running them and to reading what they collected.

## Login-gated sessions

A channel that needs a signed-in session (x/twitter, linkedin, reddit,
facebook, instagram, xiaohongshu, …) reads that session from the **container's
own configuration** — a mounted config directory or environment on the launch
command — never from a Vestigo vault credential. Provide it through
`AGENT_REACH_BASE_ARGS`, e.g. `run,--rm,-v,/srv/agent-reach:/root/.agent-reach,vestigo/agent-reach`.

## Pending confirmation against a live run

Everything in the collector and the runner is exercised offline. The one part
that can only be confirmed by running the real container is the mapping from
Agent-Reach's per-channel `result` shape to the envelope item fields
(`url`/`title`/`author`/`publishedAt`/`text`). The adapter tries the common
field names (`_ITEM_KEYS` / `_LIST_KEYS` in `entrypoint.py`) and preserves
anything unrecognised as `text`; refine those lists once a channel's real output
is seen. Likewise, pin the Agent-Reach release in the `Dockerfile` (it currently
installs `latest`) once a version is chosen, and confirm the per-channel
`action` (`packages/collectors/src/platform/agent-reach.ts`, currently
`search`, with URL targets routed through Agent-Reach's `read`).

## Building

```
docker build -t vestigo/agent-reach infra/agent-reach
```
