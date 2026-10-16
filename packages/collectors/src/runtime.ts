import { decideDisciplineAccess, decideTargetAccess, type TenantEntitlement } from "@repo/access";
import type { z } from "zod";
import { AppError, type TargetType, type UnrunnableReason } from "@repo/core";
import {
  DEFAULT_ACCESS_METHODS,
  isAccessMethod,
  isKeyedAccessMethod,
  type AccessMethod,
  type AccessMethodEntry,
  type CollectorAccess,
  type RunsVia,
  type SourceAccess,
} from "./access.ts";
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
import type { Source } from "./source.ts";
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
 * Runtimes allowed to replay recorded answers for an UNVERIFIED source. Only
 * the fixture harness (src/testing.ts) adds one, to a runtime whose network
 * is its loopback fixture server: a replay never contacts the source. Nothing
 * a deployment builds is ever in it, so no product path runs an UNVERIFIED
 * source.
 */
const REPLAYING = new WeakSet<CollectorRuntime>();

/**
 * Internal to the package, for src/testing.ts alone (lint): lets the
 * harness's runtime replay recorded answers for UNVERIFIED sources. BLOCKED
 * stays refused, and so does a method that is not enabled. Not exported from
 * the package entry point.
 */
export function replayRecordedAnswers(runtime: CollectorRuntime): void {
  REPLAYING.add(runtime);
}

function refusalWhenNoMethodRuns(methods: readonly AccessMethodEntry[]): string {
  const [only] = methods;
  return methods.length === 1 && only !== undefined
    ? `Its only access method, ${only.kind}, is not enabled in this deployment.`
    : `None of its access methods (${methods.map((method) => method.kind).join(", ")}) is enabled in this deployment.`;
}

/** A non-empty list of methods, or null for none: never an empty list. */
function runsViaOf(methods: readonly AccessMethodEntry[]): RunsVia | null {
  const [first, ...rest] = methods.filter((method) => method.runnable).map((method) => method.kind);
  return first === undefined ? null : Object.freeze<RunsVia>([first, ...rest]);
}

/**
 * The only way to run a collector. Every check happens here, before the
 * collector's code is reached, and every outcome is checked after:
 *   - licence: only PERMITTED runs; BLOCKED and UNVERIFIED never do;
 *   - access method: one it can use is enabled in this deployment (access());
 *   - an implementation exists and the target type is accepted and valid;
 *   - plan and vetting for the discipline, and for a person target type
 *     whatever the discipline (a TOPIC; @repo/access);
 *   - a scope authorisation for the exact target, for ACTIVE collectors;
 *   - required credentials are present, for a keyed method enabled here;
 *     it is handed no other credential.
 * Then the collector runs within its budget, with a fetch bound to its source,
 * and its return must be a found(), notFound() or emptyUnconfirmed() from this
 * very run. A collector whose upstream's empty answers are unreliable can never
 * return notFound().
 */
export class CollectorRuntime {
  readonly #registry: CollectorRegistry;
  readonly #accessMethods: readonly AccessMethod[];
  readonly #network: NetworkRuntime;

  constructor(options: {
    readonly registry: CollectorRegistry;
    /**
     * The access methods enabled here: enabledAccessMethods(env). Unset: open,
     * official and licensed, never operator. A method still runs only for a
     * PERMITTED source.
     */
    readonly accessMethods?: readonly AccessMethod[];
    readonly network: NetworkRuntime;
  }) {
    // Read as data: a list from anywhere is checked before it means anything.
    const methods: readonly unknown[] = options.accessMethods ?? DEFAULT_ACCESS_METHODS;
    const enabled: AccessMethod[] = [];
    for (const method of methods) {
      if (typeof method !== "string" || !isAccessMethod(method) || enabled.includes(method)) {
        throw new CollectorDefinitionError(
          "collector runtime",
          "accessMethods must name distinct access methods: open, official, licensed, operator",
        );
      }
      enabled.push(method);
    }
    this.#registry = options.registry;
    this.#accessMethods = Object.freeze(enabled);
    this.#network = options.network;
  }

  get registry(): CollectorRegistry {
    return this.#registry;
  }

  /** The access methods enabled in this deployment. */
  get accessMethods(): readonly AccessMethod[] {
    return this.#accessMethods;
  }

  /** Each of these methods of a source, as this deployment treats it. */
  #methods(source: Source, kinds: readonly AccessMethod[]): readonly AccessMethodEntry[] {
    const verdict = source.licence.commercialUse;
    const verdictRuns =
      verdict === "PERMITTED" || (verdict === "UNVERIFIED" && REPLAYING.has(this));
    return Object.freeze(
      kinds.map((kind) => {
        const enabled = this.#accessMethods.includes(kind);
        return Object.freeze({
          kind,
          enabled,
          licenceVerdict: verdict,
          runnable: enabled && verdictRuns,
        });
      }),
    );
  }

  /** Why none of these methods runs here, or null when one does. The licence first. */
  #refusal(
    source: Source,
    methods: readonly AccessMethodEntry[],
  ): { readonly refusal: UnrunnableReason; readonly reason: string } | null {
    if (source.licence.commercialUse === "BLOCKED") {
      return {
        refusal: "LICENCE_BLOCKED",
        reason: `${source.name} is blocked: ${source.licence.reason}`,
      };
    }
    if (source.licence.commercialUse === "UNVERIFIED" && !REPLAYING.has(this)) {
      return {
        refusal: "UNVERIFIED_SOURCE_NOT_ALLOWED",
        reason: `${source.name}'s licence is unverified, and an unverified source never runs: its terms must be checked and a verdict recorded first.`,
      };
    }
    if (!methods.some((method) => method.runnable)) {
      return { refusal: "ACCESS_METHOD_NOT_ENABLED", reason: refusalWhenNoMethodRuns(methods) };
    }
    return null;
  }

  /**
   * Whether a collector can run here, before any per-run check, and via which
   * of its access methods: its licence (BLOCKED, then UNVERIFIED), an enabled
   * method, then an implementation. When it cannot, runsVia is null.
   */
  access(collectorId: string): CollectorAccess {
    const entry = this.#registry.entry(collectorId);
    const methods = this.#methods(entry.source, entry.accessMethods);
    const implemented = registryInternals(this.#registry).implementations.has(entry.id);
    const refusal =
      this.#refusal(entry.source, methods) ??
      (implemented
        ? null
        : {
            refusal: "NOT_IMPLEMENTED" as const,
            reason: "This collector has no implementation yet.",
          });
    if (refusal !== null) {
      return Object.freeze({ methods, vaultIds: Object.freeze([]), runsVia: null, ...refusal });
    }
    // No refusal means a method runs: #refusal says so.
    const runsVia = runsViaOf(methods);
    if (runsVia === null) {
      throw new CollectorDefinitionError(`collector "${entry.id}"`, "no access method runs");
    }
    return Object.freeze({
      methods,
      vaultIds: runsVia.some(isKeyedAccessMethod) ? entry.credentials.vaultIds : Object.freeze([]),
      runsVia,
      refusal: null,
      reason: null,
    });
  }

  /**
   * Every source in the registry's catalogue as this deployment runs it: its
   * declared methods, each enabled or not, and whether any of them can run.
   */
  sources(): readonly SourceAccess[] {
    return this.#registry.sources().map((source) => {
      const methods = this.#methods(source, source.access);
      const refusal = this.#refusal(source, methods);
      const base = {
        id: source.id,
        label: source.name,
        methods,
        licenceVerdict: source.licence.commercialUse,
      };
      if (refusal !== null) {
        return Object.freeze({ ...base, enabled: false, runsVia: null, ...refusal });
      }
      const runsVia = runsViaOf(methods);
      if (runsVia === null) {
        throw new CollectorDefinitionError(`source "${source.id}"`, "no access method runs");
      }
      return Object.freeze({ ...base, enabled: true, runsVia, refusal: null, reason: null });
    });
  }

  /**
   * Every check that needs no credentials, in order. Null means the collector
   * may run; otherwise the refusal (or, for an invalid target, the failure).
   */
  admit(collectorId: string, admission: Admission): Rejection | null {
    const entry = this.#registry.entry(collectorId);
    // Its licence, an enabled access method, an implementation: in that order.
    const access = this.access(entry.id);
    if (access.runsVia === null) return refused(entry.id, access.refusal, access.reason);
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

    // Only a keyed method enabled here hands the collector anything: a
    // credential for any other method stays out of its reach.
    const access = this.access(entry.id);
    if (access.runsVia === null) return refused(entry.id, access.refusal, access.reason);
    const handed = new Map<string, CollectorSecret>();
    for (const vaultId of access.vaultIds) {
      const secret = request.credentials.get(vaultId);
      if (secret !== undefined) handed.set(vaultId, secret);
    }
    const missing = access.vaultIds.filter((id) => !handed.has(id));
    if (missing.length > 0 && !access.runsVia.includes("open")) {
      return Object.freeze({ status: "NEEDS_CREDENTIALS", collectorId: entry.id, missing });
    }

    const run = Symbol(entry.id);
    const controller = new AbortController();
    const secrets = [...handed.values()].map((secret) => secret.expose());
    const credentials: CollectorCredentials = Object.freeze({
      get: (vaultId: string) => handed.get(vaultId) ?? null,
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
      emptyUnconfirmed: (response: Captured, detail: string) =>
        makeReturn(run, { kind: "EMPTY_UNCONFIRMED", response, detail }),
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
      return outcomeOfError(entry.id, error, handed.size > 0);
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
      return violation(
        "The collector did not return found(), notFound() or emptyUnconfirmed() from its own run.",
      );
    }
    const value = returned as
      | {
          readonly kind: "FOUND";
          readonly result: unknown;
          readonly evidence: readonly EvidenceItem[];
        }
      | { readonly kind: "NOT_FOUND"; readonly response: Captured; readonly detail: string }
      | {
          readonly kind: "EMPTY_UNCONFIRMED";
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

    if (value.kind === "EMPTY_UNCONFIRMED") {
      // An unreliable empty answer is an upstream's; a local analysis has none.
      if (local) {
        return violation(
          "Only a network collector's upstream can answer empty unreliably; a local analysis that found nothing reports not found.",
        );
      }
      if (!citable(value.response, OK_FOR_FOUND)) {
        return violation("An unconfirmed empty answer must cite a 2xx response this run received.");
      }
      if (value.detail.trim().length === 0) {
        return violation("An unconfirmed empty answer must say what came back empty.");
      }
      return Object.freeze({
        status: "EMPTY_UNCONFIRMED",
        collectorId: entry.id,
        detail: value.detail,
        response: value.response,
      });
    }

    if (value.kind === "NOT_FOUND") {
      // Its upstream's empty answers may be false, so none is "nothing there".
      if (entry.emptyAnswersUnreliable) {
        return violation(
          "This collector's upstream gives unreliable empty answers, so it reports one as unconfirmed, never as not found.",
        );
      }
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
