import { decideDisciplineAccess, decideTargetAccess, type TenantEntitlement } from "@repo/access";
import type { z } from "zod";
import { AppError, type TargetType } from "@repo/core";
import {
  makeReturn,
  returningRun,
  type CollectorCredentials,
  type CollectorReturn,
  type CollectorSecret,
  type EvidenceItem,
  type RunContext,
} from "./contract.ts";
import {
  CollectorDefinitionError,
  InvalidTargetError,
  RateLimiterUnavailableError,
  UpstreamRateLimitedError,
  UpstreamRejectedError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
  UpstreamUnreachableError,
} from "./errors.ts";
import { captureLocal, capturedPayload, capturingRun, type Captured } from "./fetcher/capture.ts";
import { createUpstreamFetch, type NetworkRuntime } from "./fetcher/fetcher.ts";
import {
  markFound,
  type CollectionOutcome,
  type FailedOutcome,
  type RefusedOutcome,
} from "./outcome.ts";
import { registryInternals, type CollectorRegistry, type RegistryEntry } from "./registry.ts";
import { payloadIndex, reportedPart, unreadValuePath } from "./provenance.ts";
import { parseTarget, type Target } from "./target.ts";

/** A scope authorisation in force for a target, as read from the database. */
export interface ScopeClearance {
  readonly id: string;
  readonly targetType: TargetType;
  readonly target: string;
}

/** What admission to a run needs, all read by the caller for this tenant. */
export interface Admission {
  readonly target: Target;
  /** The tenant's plan and vetting status. */
  readonly entitlement: TenantEntitlement;
  /** The authorisation in force for this exact target, or null. Required for ACTIVE collectors. */
  readonly scopeAuthorisation: ScopeClearance | null;
}

/** Counts what a run consumed upstream, for metering against the tenant. */
export interface UsageMeter {
  /** One request sent to the collector's source, redirect hops included. */
  requestSent(sourceId: string, host: string): void;
}

export interface DispatchRequest extends Admission {
  /** Revealed tenant credentials, by vault id. */
  readonly credentials: ReadonlyMap<string, CollectorSecret>;
  /** Told of every request the run sends, whatever its outcome. */
  readonly meter?: UsageMeter;
}

type Rejection = RefusedOutcome | FailedOutcome;

const OK_FOR_FOUND = (status: number) => status >= 200 && status <= 299;
const OK_FOR_NOT_FOUND = (status: number) =>
  OK_FOR_FOUND(status) || status === 404 || status === 410;

/**
 * An empty result: nothing, blank text, zero, false, an empty list, or an
 * object made only of those. FOUND must carry something; "nothing" is
 * NOT_FOUND, and a failure is never either.
 */
export function isEmptyResult(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.values(value).every(isEmptyResult);
  return false;
}

function refused(
  collectorId: string,
  reason: RefusedOutcome["reason"],
  message: string,
): RefusedOutcome {
  return Object.freeze({ status: "REFUSED", collectorId, reason, message });
}

function failed(collectorId: string, code: string, message: string): FailedOutcome {
  return Object.freeze({ status: "FAILED", collectorId, error: Object.freeze({ code, message }) });
}

class RunBudgetExceeded extends AppError {
  readonly code = "COLLECTOR_TIMEOUT";

  constructor(timeoutMs: number) {
    super(`The collector did not finish within its ${String(timeoutMs)} ms budget.`);
    this.name = "RunBudgetExceeded";
  }
}

/**
 * @param credentialsHanded whether this run was handed any of the collector's
 * vault credentials. A 401 or 403 is a credentials failure only then: from a
 * source that takes no credentials, or a run that had none, it is the
 * upstream refusing the request (Phase 3B review: it was reported as
 * rejected credentials either way).
 */
function outcomeOfError(
  collectorId: string,
  error: unknown,
  credentialsHanded: boolean,
): CollectionOutcome {
  const unavailable = (
    code: string,
    message: string,
    retryAfterMs: number | null,
  ): CollectionOutcome =>
    Object.freeze({
      status: "UNAVAILABLE",
      collectorId,
      error: Object.freeze({ code, message }),
      retryAfterMs,
    });
  if (error instanceof UpstreamRateLimitedError) {
    return unavailable(error.code, error.message, error.retryAfterMs);
  }
  if (error instanceof UpstreamUnavailableError) {
    return unavailable(error.code, error.message, error.retryAfterMs);
  }
  if (
    error instanceof UpstreamTimeoutError ||
    error instanceof RunBudgetExceeded ||
    error instanceof UpstreamUnreachableError ||
    error instanceof RateLimiterUnavailableError
  ) {
    return unavailable(error.code, error.message, null);
  }
  if (error instanceof UpstreamRejectedError && !credentialsHanded) {
    return failed(
      collectorId,
      "UPSTREAM_REFUSED",
      `The upstream refused the request: ${error.problem}. No credential was sent, so this is not a credentials failure.`,
    );
  }
  // Everything else is permanent for this request: a refused destination,
  // rejected credentials, an unusable response, a collector bug.
  if (error instanceof AppError) return failed(collectorId, error.code, error.message);
  // An unknown error's message may carry anything; it is not repeated.
  return failed(collectorId, "COLLECTOR_ERROR", "The collector failed with an unexpected error.");
}

/**
 * The only way to run a collector. Every check happens here, before the
 * collector's code is reached, and every outcome is checked after:
 *   - licence: BLOCKED never runs; UNVERIFIED only where allowed;
 *   - an implementation exists and the target type is accepted and valid;
 *   - plan and vetting for the discipline, and for a person target type
 *     whatever the discipline (a TOPIC; @repo/access);
 *   - a scope authorisation for the exact target, for ACTIVE collectors;
 *   - required credentials are present.
 * Then the collector runs within its budget, with a fetch bound to its source,
 * and its return must be a found()/notFound() from this very run.
 */
export class CollectorRuntime {
  readonly #registry: CollectorRegistry;
  readonly #allowUnverifiedSources: boolean;
  readonly #network: NetworkRuntime;

  constructor(options: {
    readonly registry: CollectorRegistry;
    /** From allowsUnverifiedSources(env): never true in production unless configured. */
    readonly allowUnverifiedSources: boolean;
    readonly network: NetworkRuntime;
  }) {
    this.#registry = options.registry;
    this.#allowUnverifiedSources = options.allowUnverifiedSources;
    this.#network = options.network;
  }

  get registry(): CollectorRegistry {
    return this.#registry;
  }

  /**
   * Every check that needs no credentials, in order. Null means the collector
   * may run; otherwise the refusal (or, for an invalid target, the failure).
   */
  admit(collectorId: string, admission: Admission): Rejection | null {
    const entry = this.#registry.entry(collectorId);
    const { source } = entry;
    if (source.licence.commercialUse === "BLOCKED") {
      return refused(
        entry.id,
        "LICENCE_BLOCKED",
        `${source.name} is blocked: ${source.licence.reason}`,
      );
    }
    if (source.licence.commercialUse === "UNVERIFIED" && !this.#allowUnverifiedSources) {
      return refused(
        entry.id,
        "UNVERIFIED_SOURCE_NOT_ALLOWED",
        `${source.name}'s licence is unverified, and this deployment does not allow unverified sources.`,
      );
    }
    if (registryInternals(this.#registry).implementations.get(entry.id) === undefined) {
      return refused(entry.id, "NOT_IMPLEMENTED", "This collector has no implementation yet.");
    }
    if (!entry.targetTypes.includes(admission.target.type)) {
      return refused(
        entry.id,
        "TARGET_TYPE_NOT_ACCEPTED",
        `This collector does not accept ${admission.target.type} targets.`,
      );
    }
    let target: Target;
    try {
      target = parseTarget(admission.target.type, admission.target.value);
    } catch (error) {
      if (error instanceof InvalidTargetError) return failed(entry.id, error.code, error.message);
      throw error;
    }
    const module = decideDisciplineAccess(admission.entitlement, entry.discipline);
    if (!module.allowed) {
      return refused(
        entry.id,
        module.reason,
        module.reason === "VETTING_NOT_APPROVED"
          ? "This collector needs the tenant's vetting to be approved."
          : "This collector's module is not in the tenant's plan.",
      );
    }
    // A person target type (a TOPIC) is person data whatever collects it: it
    // needs the person module's plan and vetting even from a news collector.
    const targetAccess = decideTargetAccess(admission.entitlement, target.type);
    if (!targetAccess.allowed) {
      return refused(
        entry.id,
        targetAccess.reason,
        targetAccess.reason === "VETTING_NOT_APPROVED"
          ? `A ${target.type} target may name a person, so collecting on it needs the tenant's vetting to be approved.`
          : `A ${target.type} target may name a person, so collecting on it needs the person investigation module in the tenant's plan.`,
      );
    }
    if (entry.collectionMode === "ACTIVE") {
      const scope = admission.scopeAuthorisation;
      if (scope === null || scope.targetType !== target.type || scope.target !== target.value) {
        return refused(
          entry.id,
          "SCOPE_AUTHORISATION_REQUIRED",
          "An active collector needs a scope authorisation in force for this exact target.",
        );
      }
    }
    return null;
  }

  async execute(collectorId: string, request: DispatchRequest): Promise<CollectionOutcome> {
    const rejection = this.admit(collectorId, request);
    if (rejection !== null) return rejection;
    const entry = this.#registry.entry(collectorId);
    const internals = registryInternals(this.#registry);
    const implementation = internals.implementations.get(entry.id);
    if (implementation === undefined) {
      return refused(entry.id, "NOT_IMPLEMENTED", "This collector has no implementation yet.");
    }
    const target = parseTarget(request.target.type, request.target.value);

    const missing = entry.credentials.vaultIds.filter((id) => !request.credentials.has(id));
    if (missing.length > 0 && !entry.credentials.runsWithout) {
      return Object.freeze({ status: "NEEDS_CREDENTIALS", collectorId: entry.id, missing });
    }

    const run = Symbol(entry.id);
    const controller = new AbortController();
    const secrets = [...request.credentials.values()].map((secret) => secret.expose());
    const credentials: CollectorCredentials = Object.freeze({
      get: (vaultId: string) => request.credentials.get(vaultId) ?? null,
    });
    const context: RunContext<unknown> = Object.freeze({
      target,
      credentials,
      fetch: createUpstreamFetch({
        source: entry.source,
        network: this.#network,
        run,
        signal: controller.signal,
        secrets,
        onRequestSent: (host) => request.meter?.requestSent(entry.source.id, host),
      }),
      signal: controller.signal,
      found: (result: unknown, evidence: readonly [EvidenceItem, ...EvidenceItem[]]) =>
        makeReturn(run, { kind: "FOUND", result, evidence }),
      notFound: (response: Captured, detail: string) =>
        makeReturn(run, { kind: "NOT_FOUND", response, detail }),
      record: (output: unknown) => {
        if (entry.collectionMode !== "LOCAL_ANALYSIS") {
          throw new CollectorDefinitionError(
            `collector "${entry.id}"`,
            "only a LOCAL_ANALYSIS collector records an analysis; others cite responses",
          );
        }
        return captureLocal(
          run,
          {
            collector: { id: entry.id, version: entry.version },
            target: { type: target.type, value: target.value },
            output,
          },
          new Date(),
        );
      },
    });

    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // Settle first, then abort: a collector that stops on the abort signal
        // must not win the race with its own error and turn a timeout
        // (retryable) into a failure (permanent). Found in Phase 4.
        reject(new RunBudgetExceeded(entry.timeoutMs));
        controller.abort();
      }, entry.timeoutMs);
    });
    let returned: CollectorReturn<unknown>;
    try {
      returned = await Promise.race([implementation(context), budget]);
    } catch (error) {
      return outcomeOfError(
        entry.id,
        error,
        entry.credentials.vaultIds.some((id) => request.credentials.has(id)),
      );
    } finally {
      clearTimeout(timer);
      // Anything the collector left in flight is cut off.
      controller.abort();
    }
    return this.#check(entry, run, returned, internals.schemas.get(entry.id));
  }

  /** The contract, checked after the collector returns. */
  #check(
    entry: RegistryEntry,
    run: symbol,
    returned: unknown,
    schema: z.ZodType | undefined,
  ): CollectionOutcome {
    const violation = (message: string) =>
      failed(entry.id, "COLLECTOR_CONTRACT_VIOLATION", message);
    if (returningRun(returned) !== run) {
      return violation("The collector did not return found() or notFound() from its own run.");
    }
    const value = returned as
      | {
          readonly kind: "FOUND";
          readonly result: unknown;
          readonly evidence: readonly EvidenceItem[];
        }
      | {
          readonly kind: "NOT_FOUND";
          readonly response: Captured;
          readonly detail: string;
        };
    // A network collector cites what its fetch received; a local analysis
    // cites its own recorded analysis. Never the other kind.
    const local = entry.collectionMode === "LOCAL_ANALYSIS";
    const citable = (captured: Captured, okStatus: (status: number) => boolean) =>
      capturingRun(captured) === run &&
      (local
        ? captured.kind === "LOCAL"
        : captured.kind === "NETWORK" && okStatus(captured.status));

    if (value.kind === "NOT_FOUND") {
      if (!citable(value.response, OK_FOR_NOT_FOUND)) {
        return violation(
          local
            ? "A not-found must cite this run's recorded analysis."
            : "A not-found must cite a 2xx, 404 or 410 response this run received.",
        );
      }
      if (value.detail.trim().length === 0)
        return violation("A not-found must say what was not found.");
      return Object.freeze({
        status: "NOT_FOUND",
        collectorId: entry.id,
        detail: value.detail,
        response: value.response,
      });
    }

    if (value.evidence.length === 0) return violation("A result must cite at least one response.");
    for (const item of value.evidence) {
      if (capturingRun(item.response) !== run) {
        return violation("Evidence may only cite what this run captured from its own source.");
      }
      if (!citable(item.response, OK_FOR_FOUND)) {
        return violation(
          local
            ? "A local analysis cites its recorded analysis, never a network response."
            : "Evidence must be a 2xx response; a failed request is not a result.",
        );
      }
      if (item.observedAt !== null && Number.isNaN(item.observedAt.getTime())) {
        return violation("observedAt must be a valid date, or null when the upstream gives none.");
      }
    }
    if (schema === undefined) return violation("The collector has no result schema.");
    const parsed = schema.safeParse(value.result);
    if (!parsed.success) {
      return failed(
        entry.id,
        "RESULT_SCHEMA_INVALID",
        "The collector's result did not match its declared schema.",
      );
    }
    // What the source reported is the result without its derived values: a
    // result with nothing but derived values found nothing.
    if (isEmptyResult(local ? parsed.data : reportedPart(parsed.data))) {
      return violation("A FOUND result was empty; report nothing found with notFound().");
    }
    if (!local) {
      const payloads = value.evidence.map((item) => capturedPayload(item.response));
      const appears = payloadIndex(payloads.filter((p): p is Uint8Array => p !== null));
      const unread = unreadValuePath(parsed.data, appears);
      if (unread !== null) {
        return violation(
          `The value at ${unread} is not in the responses the result cites; a value the collector computed or stated belongs under "derived".`,
        );
      }
    }
    return markFound({
      status: "FOUND",
      collectorId: entry.id,
      result: parsed.data,
      evidence: value.evidence,
    });
  }
}
