/**
 * Agent-Reach reader collectors: public-web and platform channels read through
 * the Agent-Reach tool container (Panniantong/Agent-Reach, MIT), the repo's
 * first tool container.
 *
 * SHAPE. A tool container does its own egress and is reached as a LOCAL_ANALYSIS
 * source (network: null), so every channel here is LOCAL_ANALYSIS /
 * claimStrength DERIVED — the only shape whose evidence is the run's own
 * recorded output rather than a response the in-process fetcher captured. This
 * matches how the catalogue already models tool containers (theHarvester,
 * SpiderFoot). The container is launched argv-only, never through a shell
 * (src/tool/container.ts), so a target is never interpolated into a command.
 *
 * HOW A CHANNEL IS REACHED. The container is launched by `configureAgentReach`,
 * which a deployment's composition root calls once at startup with how to run
 * it and the runner that runs it (the production runner is runContainerTool;
 * a test supplies a fake that returns a recorded or synthetic envelope). An
 * unconfigured deployment reports the tool unavailable rather than guessing.
 *
 * THE ENVELOPE. The container's entrypoint (infra/agent-reach) adapts
 * Agent-Reach's own output into one Vestigo envelope: `{ collectedAt, items }`.
 * The envelope's field mapping from Agent-Reach's real output is the one part
 * that can only be confirmed against a live container run, and is marked as
 * such in infra/agent-reach; everything in this module — the schema, the
 * normalisation, the outcome and the evidence — is exercised offline against
 * that envelope. The collector, not the container, states the result's identity
 * (tool, channel, action, query): a channel's output can never relabel itself.
 *
 * LOGIN-GATED CHANNELS. Some channels (x, linkedin, reddit) read platforms that
 * require a signed-in session. The session is the container's own configuration,
 * a deployment concern (CLAUDE.md §3: operator-configured local adapters); no
 * tenant vault credential is involved. When the container has no usable session
 * it exits non-zero, which surfaces honestly as a failed collection, never as
 * "nothing found". These channels are PERSON-discipline, so the tenant plan and
 * vetting gate still applies to running them and to reading what they collected.
 */
import type { CollectorDiscipline, TargetType } from "@repo/core";
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import { UpstreamResponseError, UpstreamUnavailableError } from "../errors.ts";
import type { ContainerRunner } from "../tool/container.ts";

/**
 * The deployment has not said how to run the Agent-Reach container, so no
 * channel can run. Retryable, as a composition that configures it a moment
 * later should recover; a deployment that never configures it simply never
 * runs these channels, and the reason is stated rather than guessed.
 */
export class AgentReachNotConfiguredError extends UpstreamUnavailableError {
  constructor() {
    super("the Agent-Reach tool container is not configured in this deployment");
    this.name = "AgentReachNotConfiguredError";
  }
}

/** How this deployment runs the Agent-Reach container, injected at startup. */
export interface AgentReachRuntimeConfig {
  /** Runs the container. Production: runContainerTool; a test: a recorded-output fake. */
  readonly runner: ContainerRunner;
  /** The executable that launches the container. Configuration, never hard-coded. */
  readonly command: string;
  /** Fixed leading argv (how the container is launched), e.g. a `docker run …` prefix. */
  readonly baseArgs: readonly string[];
  /** The container's own per-invocation budget. */
  readonly timeoutMs: number;
  /** The most stdout to accept from one invocation. */
  readonly maxOutputBytes: number;
}

let configured: AgentReachRuntimeConfig | null = null;

/**
 * Sets how the Agent-Reach container is run, once, at process startup. The
 * default collector instances read it when they run; until it is set, they
 * report the tool unavailable.
 */
export function configureAgentReach(config: AgentReachRuntimeConfig): void {
  configured = Object.freeze({ ...config, baseArgs: Object.freeze([...config.baseArgs]) });
}

/** Forgets the configuration. For tests that set their own and clean up after. */
export function resetAgentReach(): void {
  configured = null;
}

function requireRuntimeConfig(): AgentReachRuntimeConfig {
  if (configured === null) throw new AgentReachNotConfiguredError();
  return configured;
}

/** The whole-run budget for a channel: longer than the container's own timeout. */
const RUN_TIMEOUT_MS = 120_000;

// ── The container's output envelope, and the collector's result ───────────

/** What the container entrypoint prints: a normalised envelope, nothing trusted for identity. */
const ENVELOPE_ITEM = z.object({
  url: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
});

const AGENT_REACH_ENVELOPE = z.object({
  /** The container's own clock when it ran, or null. Never the content's own time. */
  collectedAt: z.string().nullable().optional(),
  items: z.array(ENVELOPE_ITEM).default([]),
});

/** One item a channel returned, every field null unless the container stated it. */
const AGENT_REACH_ITEM = z.object({
  url: z.string().nullable(),
  title: z.string().nullable(),
  author: z.string().nullable(),
  publishedAt: z.string().nullable(),
  text: z.string().nullable(),
});

/**
 * A channel's result. `tool`, `channel`, `action` and `query` are the
 * collector's own, so a channel's output can never state its own identity;
 * `collectedAt` and `items` are what the container returned.
 */
export const AGENT_REACH_RESULT = z.object({
  tool: z.literal("agent-reach"),
  channel: z.string().min(1),
  action: z.string().min(1),
  query: z.string(),
  collectedAt: z.string().nullable(),
  items: z.array(AGENT_REACH_ITEM),
});

export type AgentReachResult = z.infer<typeof AGENT_REACH_RESULT>;

/** An item carries nothing unless at least one of its fields is stated. */
function hasSubstance(item: z.infer<typeof AGENT_REACH_ITEM>): boolean {
  return (
    item.url !== null ||
    item.title !== null ||
    item.author !== null ||
    item.publishedAt !== null ||
    item.text !== null
  );
}

// ── The channels ──────────────────────────────────────────────────────────

interface ChannelSpec {
  /** The collector id, e.g. "agent-reach.web". */
  readonly id: string;
  /** The catalogue source id, e.g. "agent-reach-web". */
  readonly sourceId: string;
  readonly displayName: string;
  /** The Agent-Reach channel id passed to the container (its own identifier). */
  readonly channel: string;
  /**
   * The Agent-Reach action passed to the container. "search" is the action
   * nearly every channel lists; the container entrypoint routes a URL target
   * through Agent-Reach's `read` auto-router instead (infra/agent-reach). The
   * exact per-channel action is a container-side mapping a deployment can tune.
   */
  readonly action: string;
  readonly discipline: CollectorDiscipline;
  readonly targetTypes: readonly TargetType[];
}

/**
 * Every Agent-Reach channel, so an operator can enable or disable each one per
 * deployment (CLAUDE.md §3). The operator toggles a channel two ways, both
 * needing the catalogue verdict to be PERMITTED first: `agent-reach add/remove
 * <channel>` inside the container, and the tenant registry's per-collector
 * enabled flag. People-centric channels are PERSON-discipline, so the tenant
 * plan and vetting gate applies to running them and to reading what they found.
 */
const CHANNELS: readonly ChannelSpec[] = [
  {
    id: "agent-reach.web",
    sourceId: "agent-reach-web",
    displayName: "Agent-Reach web read",
    channel: "web",
    action: "search",
    discipline: "SOCMINT",
    targetTypes: ["URL", "DOMAIN", "TOPIC"],
  },
  {
    id: "agent-reach.github",
    sourceId: "agent-reach-github",
    displayName: "Agent-Reach GitHub read",
    channel: "github",
    action: "search",
    discipline: "SOCMINT",
    targetTypes: ["USERNAME", "ORGANIZATION", "URL", "TOPIC"],
  },
  {
    id: "agent-reach.youtube",
    sourceId: "agent-reach-youtube",
    displayName: "Agent-Reach YouTube read",
    channel: "youtube",
    action: "search",
    discipline: "MEDIAINT",
    targetTypes: ["URL", "USERNAME", "TOPIC"],
  },
  {
    id: "agent-reach.v2ex",
    sourceId: "agent-reach-v2ex",
    displayName: "Agent-Reach V2EX read",
    channel: "v2ex",
    action: "search",
    discipline: "SOCMINT",
    targetTypes: ["USERNAME", "TOPIC", "URL"],
  },
  {
    id: "agent-reach.bilibili",
    sourceId: "agent-reach-bilibili",
    displayName: "Agent-Reach Bilibili read",
    channel: "bilibili",
    action: "search",
    discipline: "MEDIAINT",
    targetTypes: ["USERNAME", "TOPIC", "URL"],
  },
  {
    id: "agent-reach.xueqiu",
    sourceId: "agent-reach-xueqiu",
    displayName: "Agent-Reach Xueqiu read",
    channel: "xueqiu",
    action: "search",
    discipline: "SOCMINT",
    targetTypes: ["TOPIC", "USERNAME", "URL"],
  },
  {
    id: "agent-reach.xiaoyuzhou",
    sourceId: "agent-reach-xiaoyuzhou",
    displayName: "Agent-Reach Xiaoyuzhou read",
    channel: "xiaoyuzhou",
    action: "search",
    discipline: "MEDIAINT",
    targetTypes: ["URL", "TOPIC"],
  },
  {
    id: "agent-reach.boss",
    sourceId: "agent-reach-boss",
    displayName: "Agent-Reach Boss Zhipin read",
    channel: "boss",
    action: "search",
    discipline: "SOCMINT",
    targetTypes: ["TOPIC", "ORGANIZATION", "URL"],
  },
  // People-centric channels: PERSON-discipline, so the person gate applies.
  {
    id: "agent-reach.x",
    sourceId: "agent-reach-x",
    displayName: "Agent-Reach X read",
    channel: "twitter",
    action: "search",
    discipline: "PERSON",
    targetTypes: ["USERNAME", "TOPIC", "URL"],
  },
  {
    id: "agent-reach.linkedin",
    sourceId: "agent-reach-linkedin",
    displayName: "Agent-Reach LinkedIn read",
    channel: "linkedin",
    action: "search",
    discipline: "PERSON",
    targetTypes: ["USERNAME", "ORGANIZATION", "URL", "TOPIC"],
  },
  {
    id: "agent-reach.reddit",
    sourceId: "agent-reach-reddit",
    displayName: "Agent-Reach Reddit read",
    channel: "reddit",
    action: "search",
    discipline: "PERSON",
    targetTypes: ["USERNAME", "TOPIC", "URL"],
  },
  {
    id: "agent-reach.xiaohongshu",
    sourceId: "agent-reach-xiaohongshu",
    displayName: "Agent-Reach Xiaohongshu read",
    channel: "xiaohongshu",
    action: "search",
    discipline: "PERSON",
    targetTypes: ["USERNAME", "TOPIC", "URL"],
  },
  {
    id: "agent-reach.facebook",
    sourceId: "agent-reach-facebook",
    displayName: "Agent-Reach Facebook read",
    channel: "facebook",
    action: "search",
    discipline: "PERSON",
    targetTypes: ["USERNAME", "TOPIC", "URL"],
  },
  {
    id: "agent-reach.instagram",
    sourceId: "agent-reach-instagram",
    displayName: "Agent-Reach Instagram read",
    channel: "instagram",
    action: "search",
    discipline: "PERSON",
    targetTypes: ["USERNAME", "TOPIC", "URL"],
  },
];

/**
 * Builds a channel's collector. The runner is injected so a test can supply a
 * recorded or synthetic envelope; by default it is read from the configured
 * runtime, together with how the container is launched.
 */
function defineAgentReachChannel(spec: ChannelSpec): Collector {
  return defineCollector(
    {
      id: spec.id,
      version: "1.0.0",
      displayName: spec.displayName,
      discipline: spec.discipline,
      targetTypes: spec.targetTypes,
      collectionMode: "LOCAL_ANALYSIS",
      source: spec.sourceId,
      credentials: { vaultIds: [], runsWithout: true },
      claimStrength: "DERIVED",
      timeoutMs: RUN_TIMEOUT_MS,
      resultSchema: AGENT_REACH_RESULT,
    },
    async (ctx) => {
      const runtime = requireRuntimeConfig();
      const output = await runtime.runner({
        toolId: `agent-reach ${spec.channel}`,
        command: runtime.command,
        baseArgs: runtime.baseArgs,
        toolArgs: [spec.channel, spec.action, ctx.target.value],
        timeoutMs: runtime.timeoutMs,
        maxOutputBytes: runtime.maxOutputBytes,
        signal: ctx.signal,
      });
      const parsed = AGENT_REACH_ENVELOPE.safeParse(output.json);
      if (!parsed.success) {
        throw new UpstreamResponseError(
          `the agent-reach ${spec.channel} tool did not print the expected envelope`,
        );
      }
      const items = parsed.data.items
        .map((item) => ({
          url: item.url ?? null,
          title: item.title ?? null,
          author: item.author ?? null,
          publishedAt: item.publishedAt ?? null,
          text: item.text ?? null,
        }))
        .filter(hasSubstance);
      const result: AgentReachResult = {
        tool: "agent-reach",
        channel: spec.channel,
        action: spec.action,
        query: ctx.target.value,
        collectedAt: parsed.data.collectedAt ?? null,
        items,
      };
      const record = ctx.record(result);
      if (items.length === 0) {
        return ctx.notFound(record, `The agent-reach ${spec.channel} channel returned no items.`);
      }
      // A local analysis has no upstream-stated observed time; the content's own
      // time, where a channel gives it, is a per-item field, never the whole.
      return ctx.found(result, [{ response: record, observedAt: null }]);
    },
  );
}

/** Every Agent-Reach channel collector, in listing order. */
export const AGENT_REACH_COLLECTORS: readonly Collector[] = CHANNELS.map(defineAgentReachChannel);

/** The collector ids, for the fusion extractor map and tests. */
export const AGENT_REACH_COLLECTOR_IDS: readonly string[] = CHANNELS.map((channel) => channel.id);
