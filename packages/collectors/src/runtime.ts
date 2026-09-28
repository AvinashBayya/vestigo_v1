import { decideDisciplineAccess, type TenantEntitlement } from "@repo/access";
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
  InvalidTargetError,
  RateLimiterUnavailableError,
  UpstreamRateLimitedError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
  UpstreamUnreachableError,
} from "./errors.ts";
import { capturingRun, type CapturedResponse } from "./fetcher/capture.ts";
import { createUpstreamFetch, type NetworkRuntime } from "./fetcher/fetcher.ts";
import {
  markFound,
  type CollectionOutcome,
  type FailedOutcome,
  type RefusedOutcome,
} from "./outcome.ts";
import { registryInternals, type CollectorRegistry, type RegistryEntry } from "./registry.ts";
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

export interface DispatchRequest extends Admission {
  /** Revealed tenant credentials, by vault id. */
  readonly credentials: ReadonlyMap<string, CollectorSecret>;
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

function outcomeOfError(collectorId: string, error: unknown): CollectionOutcome {
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
 *   - plan and vetting for the discipline (@repo/access);
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
      }),
      signal: controller.signal,
      found: (result: unknown, evidence: readonly [EvidenceItem, ...EvidenceItem[]]) =>
        makeReturn(run, { kind: "FOUND", result, evidence }),
      notFound: (response: CapturedResponse, detail: string) =>
        makeReturn(run, { kind: "NOT_FOUND", response, detail }),
    });

    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new RunBudgetExceeded(entry.timeoutMs));
      }, entry.timeoutMs);
    });
    let returned: CollectorReturn<unknown>;
    try {
      returned = await Promise.race([implementation(context), budget]);
    } catch (error) {
      return outcomeOfError(entry.id, error);
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
          readonly response: CapturedResponse;
          readonly detail: string;
        };

    if (value.kind === "NOT_FOUND") {
      if (capturingRun(value.response) !== run || !OK_FOR_NOT_FOUND(value.response.status)) {
        return violation("A not-found must cite a 2xx, 404 or 410 response this run received.");
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
        return violation("Evidence may only cite responses this run received from its own source.");
      }
      if (!OK_FOR_FOUND(item.response.status)) {
        return violation("Evidence must be a 2xx response; a failed request is not a result.");
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
    if (isEmptyResult(parsed.data)) {
      return violation("A FOUND result was empty; report nothing found with notFound().");
    }
    return markFound({
      status: "FOUND",
      collectorId: entry.id,
      result: parsed.data,
      evidence: value.evidence,
    });
  }
}
