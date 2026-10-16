import {
  COLLECTION_MODES,
  COLLECTOR_DISCIPLINES,
  TARGET_TYPES,
  type CollectionMode,
  type CollectorDiscipline,
  type CommercialUseVerdict,
  type TargetType,
} from "@repo/core";
import type { z } from "zod";
import { implementationOf, type Collector, type CollectorImplementation } from "./contract.ts";
import { CollectorDefinitionError, UnknownCollectorError } from "./errors.ts";
import { declaresDerivedBlock } from "./provenance.ts";
import {
  operatorsMissingFrom,
  validateSource,
  type Attribution,
  type Source,
  type SourceDeclaration,
} from "./source.ts";

/**
 * Whether a collector can run, before any per-request check:
 *   AVAILABLE        PERMITTED source, implemented;
 *   UNVERIFIED       runs only where configuration allows unverified sources;
 *   BLOCKED          never runs, whatever the configuration;
 *   NOT_IMPLEMENTED  listed, but there is no code to run.
 */
export type Availability = "AVAILABLE" | "UNVERIFIED" | "BLOCKED" | "NOT_IMPLEMENTED";

/** A collector as the registry lists it: data only. */
export interface RegistryEntry {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  /** The source label on every evidence row it produces. Always the displayName. */
  readonly label: string;
  readonly discipline: CollectorDiscipline;
  readonly targetTypes: readonly TargetType[];
  readonly collectionMode: CollectionMode;
  readonly claimStrength: "OBSERVED" | "REPORTED" | "DERIVED";
  readonly timeoutMs: number;
  readonly credentials: { readonly vaultIds: readonly string[]; readonly runsWithout: boolean };
  readonly source: Source;
  readonly commercialUse: CommercialUseVerdict;
  readonly availability: Availability;
  /** Why it is not AVAILABLE; null when it is. */
  readonly availabilityReason: string | null;
  /** Must accompany its data wherever shown; null when the source requires none. */
  readonly attribution: Attribution | null;
  /**
   * True when its upstream's empty answer may be false: an empty answer is
   * EMPTY_UNCONFIRMED, and a not-found is refused. False: an empty answer
   * means the upstream holds nothing.
   */
  readonly emptyAnswersUnreliable: boolean;
}

const CLAIM_STRENGTHS_FOR_EVIDENCE = ["OBSERVED", "REPORTED", "DERIVED"] as const;
const COLLECTOR_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const VAULT_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_RUN_TIMEOUT_MS = 30 * 60 * 1000;

function fail(subject: string, problem: string): never {
  throw new CollectorDefinitionError(subject, problem);
}

function isZodSchema(value: unknown): value is z.ZodType {
  return (
    typeof value === "object" &&
    value !== null &&
    "safeParse" in value &&
    typeof value.safeParse === "function"
  );
}

function deepFreezeSource(source: SourceDeclaration): Source {
  return Object.freeze({
    id: source.id,
    name: source.name,
    licence: Object.freeze({
      commercialUse: source.licence.commercialUse,
      reason: source.licence.reason,
      check: source.licence.check === null ? null : Object.freeze({ ...source.licence.check }),
    }),
    network:
      source.network === null
        ? null
        : Object.freeze({
            protocol: source.network.protocol,
            hosts: Object.freeze([...source.network.hosts]),
            rateLimit: Object.freeze({ ...source.network.rateLimit }),
            operators: Object.freeze(
              source.network.operators.map((operator) =>
                Object.freeze({ name: operator.name, hosts: Object.freeze([...operator.hosts]) }),
              ),
            ),
          }),
    attribution: source.attribution === null ? null : Object.freeze({ ...source.attribution }),
  });
}

function availabilityOf(
  source: Source,
  implemented: boolean,
): { readonly availability: Availability; readonly reason: string | null } {
  if (source.licence.commercialUse === "BLOCKED") {
    return {
      availability: "BLOCKED",
      reason: `${source.name} is blocked: ${source.licence.reason}`,
    };
  }
  if (!implemented) {
    return { availability: "NOT_IMPLEMENTED", reason: "This collector has no implementation yet." };
  }
  if (source.licence.commercialUse === "UNVERIFIED") {
    return {
      availability: "UNVERIFIED",
      reason: `${source.name}'s licence is unverified: ${source.licence.reason}`,
    };
  }
  return { availability: "AVAILABLE", reason: null };
}

interface RegistryInternals {
  readonly implementations: ReadonlyMap<string, CollectorImplementation<unknown>>;
  readonly schemas: ReadonlyMap<string, z.ZodType>;
}

// Implementations live here, not on the registry object, so nothing outside
// this package can reach one: the runtime is the only caller, and the package
// entry point does not export this map or its accessor.
const INTERNALS = new WeakMap<CollectorRegistry, RegistryInternals>();

/** Internal to the package: the runtime's only way to reach implementations and schemas. */
export function registryInternals(registry: CollectorRegistry): RegistryInternals {
  const internals = INTERNALS.get(registry);
  if (internals === undefined) throw new UnknownCollectorError("(unregistered registry)");
  return internals;
}

/**
 * The platform registry: the source catalogue and every collector, validated
 * as a whole when it is built. It registers BLOCKED collectors so they appear
 * in listings with their reason, and discards their code: a BLOCKED
 * collector's implementation is never stored, so no path can run it.
 */
export class CollectorRegistry {
  readonly #sources: ReadonlyMap<string, Source>;
  readonly #entries: ReadonlyMap<string, RegistryEntry>;

  constructor(options: {
    readonly sources: readonly SourceDeclaration[];
    readonly collectors: readonly Collector[];
  }) {
    const sources = new Map<string, Source>();
    for (const declaration of options.sources) {
      validateSource(declaration);
      if (sources.has(declaration.id)) fail(`source "${declaration.id}"`, "is declared twice");
      sources.set(declaration.id, deepFreezeSource(declaration));
    }

    const entries = new Map<string, RegistryEntry>();
    const implementations = new Map<string, CollectorImplementation<unknown>>();
    const schemas = new Map<string, z.ZodType>();
    const labels = new Set<string>();
    for (const collector of options.collectors) {
      const d = collector.declaration;
      const subject = `collector "${d.id}"`;
      if (!COLLECTOR_ID.test(d.id)) fail(subject, "id must match ^[a-z0-9][a-z0-9.-]{0,63}$");
      if (entries.has(d.id)) fail(subject, "is registered twice");
      if (!VERSION.test(d.version)) fail(subject, "version must be MAJOR.MINOR.PATCH");
      if (d.displayName.trim().length === 0) fail(subject, "displayName must not be blank");
      const label = d.displayName.trim().toLowerCase();
      if (labels.has(label)) {
        fail(
          subject,
          "displayName is already another collector's; evidence labels must be distinguishable",
        );
      }
      labels.add(label);
      if (!(COLLECTOR_DISCIPLINES as readonly string[]).includes(d.discipline)) {
        fail(subject, "discipline is not a known discipline");
      }
      if (!(COLLECTION_MODES as readonly string[]).includes(d.collectionMode)) {
        fail(subject, "collectionMode is not a known mode");
      }
      if (d.targetTypes.length === 0) fail(subject, "must accept at least one target type");
      if (new Set(d.targetTypes).size !== d.targetTypes.length)
        fail(subject, "targetTypes has duplicates");
      for (const type of d.targetTypes) {
        if (!(TARGET_TYPES as readonly string[]).includes(type))
          fail(subject, `unknown target type ${type}`);
      }
      const source = sources.get(d.source);
      if (source === undefined) fail(subject, `source "${d.source}" is not in the catalogue`);
      if (source.network !== null) {
        const missing = operatorsMissingFrom(d.displayName, source.network.operators);
        if (missing.length > 0) {
          fail(
            subject,
            `displayName must name every operator whose hosts it reads; it does not name ${missing
              .map((operator) => `"${operator.name}"`)
              .join(", ")}`,
          );
        }
      }
      for (const vaultId of d.credentials.vaultIds) {
        if (!VAULT_ID.test(vaultId)) fail(subject, `vault id "${vaultId}" is malformed`);
      }
      if (new Set(d.credentials.vaultIds).size !== d.credentials.vaultIds.length) {
        fail(subject, "credentials.vaultIds has duplicates");
      }
      if (d.credentials.vaultIds.length === 0 && !d.credentials.runsWithout) {
        fail(subject, "a collector needing no credentials must run without them");
      }
      if (!(CLAIM_STRENGTHS_FOR_EVIDENCE as readonly string[]).includes(d.claimStrength)) {
        fail(subject, "claimStrength must be OBSERVED, REPORTED or DERIVED");
      }
      // A local analysis derives its result; a network collector observes or
      // relays what the upstream reports. Neither may claim the other.
      if ((d.collectionMode === "LOCAL_ANALYSIS") !== (d.claimStrength === "DERIVED")) {
        fail(subject, "claimStrength is DERIVED exactly when collectionMode is LOCAL_ANALYSIS");
      }
      if (
        !Number.isSafeInteger(d.timeoutMs) ||
        d.timeoutMs < 1 ||
        d.timeoutMs > MAX_RUN_TIMEOUT_MS
      ) {
        fail(subject, "timeoutMs must be an integer from 1 to 1,800,000");
      }
      if (!isZodSchema(d.resultSchema)) fail(subject, "resultSchema must be a Zod schema");
      // What the collector computed or stated, rather than read, lives under
      // `derived`, so Phase 4 never turns it into a claim of the source (src/provenance.ts).
      if (d.collectionMode !== "LOCAL_ANALYSIS" && !declaresDerivedBlock(d.resultSchema)) {
        fail(subject, "resultSchema must be an object with a derived object for computed values");
      }

      const implementation = implementationOf(collector);
      if (source.network === null && d.collectionMode !== "LOCAL_ANALYSIS") {
        fail(
          subject,
          `source "${source.id}" is not reached over the network, so only LOCAL_ANALYSIS fits`,
        );
      }
      if (source.network !== null && d.collectionMode === "LOCAL_ANALYSIS") {
        fail(subject, "LOCAL_ANALYSIS collectors cannot use a networked source");
      }
      // Read as data, as every field is: only `true` or nothing is a declaration.
      const declared: unknown = d.emptyAnswersUnreliable;
      if (declared !== undefined && declared !== true) {
        fail(subject, "emptyAnswersUnreliable is either true or left out");
      }
      const emptyAnswersUnreliable = declared === true;
      // Only an upstream answers empty; a local analysis that finds nothing knows it.
      if (emptyAnswersUnreliable && d.collectionMode === "LOCAL_ANALYSIS") {
        fail(
          subject,
          "a LOCAL_ANALYSIS collector has no upstream whose empty answers are unreliable",
        );
      }

      const { availability, reason } = availabilityOf(source, implementation !== null);
      entries.set(
        d.id,
        Object.freeze({
          id: d.id,
          version: d.version,
          displayName: d.displayName,
          label: d.displayName,
          discipline: d.discipline,
          targetTypes: d.targetTypes,
          collectionMode: d.collectionMode,
          claimStrength: d.claimStrength,
          timeoutMs: d.timeoutMs,
          credentials: d.credentials,
          source,
          commercialUse: source.licence.commercialUse,
          availability,
          availabilityReason: reason,
          attribution: source.attribution,
          emptyAnswersUnreliable,
        }),
      );
      schemas.set(d.id, d.resultSchema);
      if (implementation !== null && source.licence.commercialUse !== "BLOCKED") {
        implementations.set(d.id, implementation);
      }
    }

    // Collectors sharing a source share its one verdict, so they cannot disagree.
    this.#sources = sources;
    this.#entries = entries;
    INTERNALS.set(this, { implementations, schemas });
  }

  /** Every source in the catalogue, with its verdict and attribution. */
  sources(): readonly Source[] {
    return [...this.#sources.values()];
  }

  source(id: string): Source | null {
    return this.#sources.get(id) ?? null;
  }

  /** Every registered collector, BLOCKED and not implemented included, each with its reason. */
  list(): readonly RegistryEntry[] {
    return [...this.#entries.values()];
  }

  entry(collectorId: string): RegistryEntry {
    const entry = this.#entries.get(collectorId);
    if (entry === undefined) throw new UnknownCollectorError(collectorId);
    return entry;
  }

  /** The attribution a report or screen must show with this collector's data, or null. */
  attributionFor(collectorId: string): Attribution | null {
    return this.entry(collectorId).attribution;
  }
}
