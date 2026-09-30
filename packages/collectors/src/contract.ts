import type { CollectionMode, CollectorDiscipline, TargetType } from "@repo/core";
import type { z } from "zod";
import type { Captured, LocalRecord } from "./fetcher/capture.ts";
import type { UpstreamFetch } from "./fetcher/fetcher.ts";
import type { Target } from "./target.ts";

/** A credential value handed to a collector. It does not print itself. */
export interface CollectorSecret {
  expose(): string;
}

/** The credentials a run was given, by vault id. */
export interface CollectorCredentials {
  get(vaultId: string): CollectorSecret | null;
}

/**
 * Everything a collector declares, as data the registry reads. There is
 * deliberately no field for a source label: evidence takes its label from the
 * registry entry (`displayName`), and a collector's code can neither set nor
 * change it. Its licence verdict and rate limit belong to its source, not to
 * the collector.
 */
export interface CollectorDeclaration<Schema extends z.ZodType> {
  readonly id: string;
  /** Semantic version, recorded on every evidence row. */
  readonly version: string;
  /** Shown to people, and the label every evidence row from this collector carries. */
  readonly displayName: string;
  readonly discipline: CollectorDiscipline;
  readonly targetTypes: readonly TargetType[];
  readonly collectionMode: CollectionMode;
  /** The catalogue id of the one upstream it reads. A fallback is a different collector. */
  readonly source: string;
  readonly credentials: {
    /** Tenant vault provider ids. */
    readonly vaultIds: readonly string[];
    /** Whether it still runs, with less, when a credential is missing. */
    readonly runsWithout: boolean;
  };
  /**
   * What its evidence is: OBSERVED directly, REPORTED by the upstream, or
   * DERIVED by a LOCAL_ANALYSIS collector from its input (and only then).
   */
  readonly claimStrength: "OBSERVED" | "REPORTED" | "DERIVED";
  /** The whole run's budget; each fetch also has its own timeout. */
  readonly timeoutMs: number;
  /** Every FOUND result is validated against it before anything is recorded. */
  readonly resultSchema: Schema;
}

/**
 * One piece of evidence: a response the upstream sent this run (a network
 * collector), or this run's recorded analysis (a LOCAL_ANALYSIS collector),
 * and when the upstream says it happened.
 */
export interface EvidenceItem {
  readonly response: Captured;
  /** From the upstream's own data; null when it gives none. Never filled from the clock. */
  readonly observedAt: Date | null;
}

// A type-only brand: no module outside this one can name it, so a collector
// cannot build a return value itself. It must call found() or notFound().
declare const COLLECTOR_RETURN: unique symbol;

export type CollectorReturn<Result> =
  | {
      readonly [COLLECTOR_RETURN]: Result;
      readonly kind: "FOUND";
      readonly result: Result;
      readonly evidence: readonly EvidenceItem[];
    }
  | {
      readonly [COLLECTOR_RETURN]: Result;
      readonly kind: "NOT_FOUND";
      readonly response: Captured;
      readonly detail: string;
    };

/** What a collector's implementation receives. */
export interface RunContext<Result> {
  readonly target: Target;
  readonly credentials: CollectorCredentials;
  /** The only way out: bound to this collector's source. */
  readonly fetch: UpstreamFetch;
  /** Aborted when the run's budget is spent. */
  readonly signal: AbortSignal;
  /**
   * Something was found. Cites at least one response this run captured,
   * with a 2xx status. An empty result is refused: report nothing found
   * with notFound().
   */
  found(
    result: Result,
    evidence: readonly [EvidenceItem, ...EvidenceItem[]],
  ): CollectorReturn<Result>;
  /**
   * The upstream answered, and it has nothing for this target. Cites the
   * response that said so (2xx, 404 or 410). A failure is not "not found":
   * throw, and the SDK reports it as FAILED or UNAVAILABLE.
   */
  notFound(response: Captured, detail: string): CollectorReturn<Result>;
  /**
   * LOCAL_ANALYSIS collectors only: records this run's analysis (the
   * collector, the target and `output`) as the evidence to cite. A network
   * collector's evidence is always a response its fetch received.
   */
  record(output: unknown): LocalRecord;
}

/**
 * A collector: a pure function of (target, credentials, fetcher) to a
 * result. It has no database access and no network access except the fetch
 * it is given. Failures are thrown as typed errors, never returned as an
 * empty success.
 */
export type CollectorImplementation<Result> = (
  context: RunContext<Result>,
) => Promise<CollectorReturn<Result>>;

/**
 * A registered collector as other code sees it: its declaration, and nothing
 * callable. The implementation is held privately and runs only through the
 * runtime, after the licence, entitlement and scope checks.
 */
export interface Collector {
  readonly declaration: CollectorDeclaration<z.ZodType>;
}

const IMPLEMENTATIONS = new WeakMap<Collector, CollectorImplementation<unknown>>();

function freezeDeclaration<Schema extends z.ZodType>(
  declaration: CollectorDeclaration<Schema>,
): CollectorDeclaration<z.ZodType> {
  return Object.freeze({
    id: declaration.id,
    version: declaration.version,
    displayName: declaration.displayName,
    discipline: declaration.discipline,
    targetTypes: Object.freeze([...declaration.targetTypes]),
    collectionMode: declaration.collectionMode,
    source: declaration.source,
    credentials: Object.freeze({
      vaultIds: Object.freeze([...declaration.credentials.vaultIds]),
      runsWithout: declaration.credentials.runsWithout,
    }),
    claimStrength: declaration.claimStrength,
    timeoutMs: declaration.timeoutMs,
    resultSchema: declaration.resultSchema,
  });
}

/** Declares a collector and its implementation. Validated when it is registered. */
export function defineCollector<Schema extends z.ZodType>(
  declaration: CollectorDeclaration<Schema>,
  implementation: CollectorImplementation<z.output<Schema>>,
): Collector {
  const collector: Collector = Object.freeze({ declaration: freezeDeclaration(declaration) });
  IMPLEMENTATIONS.set(collector, implementation as CollectorImplementation<unknown>);
  return collector;
}

/**
 * Declares a collector that has no implementation: it is listed with its
 * source's verdict and never runs. For sources that are blocked, or not yet
 * ported.
 */
export function declareCollector<Schema extends z.ZodType>(
  declaration: CollectorDeclaration<Schema>,
): Collector {
  return Object.freeze({ declaration: freezeDeclaration(declaration) });
}

/** Internal to this package: the runtime's only way to reach an implementation. */
export function implementationOf(collector: Collector): CollectorImplementation<unknown> | null {
  return IMPLEMENTATIONS.get(collector) ?? null;
}

const RETURNS = new WeakMap<object, symbol>();

/** Internal: builds a return value for the run `run`, and remembers it came from that run. */
export function makeReturn<Result>(
  run: symbol,
  value:
    | {
        readonly kind: "FOUND";
        readonly result: Result;
        readonly evidence: readonly EvidenceItem[];
      }
    | { readonly kind: "NOT_FOUND"; readonly response: Captured; readonly detail: string },
): CollectorReturn<Result> {
  const frozen = Object.freeze(
    value.kind === "FOUND"
      ? {
          kind: value.kind,
          result: value.result,
          evidence: Object.freeze(
            value.evidence.map((item) =>
              Object.freeze({ response: item.response, observedAt: item.observedAt }),
            ),
          ),
        }
      : { kind: value.kind, response: value.response, detail: value.detail },
  );
  RETURNS.set(frozen, run);
  return frozen as unknown as CollectorReturn<Result>;
}

/** Internal: the run that produced a return value, or null if found()/notFound() did not. */
export function returningRun(value: unknown): symbol | null {
  if (typeof value !== "object" || value === null) return null;
  return RETURNS.get(value) ?? null;
}
