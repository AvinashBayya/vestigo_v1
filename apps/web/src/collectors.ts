import type { CollectorStatus } from "@repo/ui";
import { queryOptions } from "@tanstack/react-query";
import { timed, unwrap } from "./api.ts";
import { api, type paths } from "./client/index.ts";

export type CollectorList =
  paths["/api/v1/collectors"]["get"]["responses"][200]["content"]["application/json"];
export type Collector = CollectorList["items"][number];

/** Every registered collector, as the registry declares it. */
export const collectorsQuery = queryOptions({
  queryKey: ["collectors"],
  queryFn: ({ signal }): Promise<CollectorList> =>
    unwrap(api.GET("/api/v1/collectors", { signal: timed(signal) })),
  // The registry changes only when the platform is deployed.
  staleTime: Number.POSITIVE_INFINITY,
});

/**
 * Whether it can run in this deployment, before any per-run check, read
 * from what the API states: AVAILABLE runs; UNVERIFIED runs only where the
 * deployment allows unverified sources; BLOCKED and NOT_IMPLEMENTED never do.
 */
export function runsHere(collector: Collector, list: CollectorList): boolean {
  if (collector.availability === "AVAILABLE") return true;
  if (collector.availability === "UNVERIFIED") return list.unverifiedSourcesAllowed;
  return false;
}

/** Its §3 status before any run: Ready, or Held. */
export function readiness(collector: Collector, list: CollectorList): CollectorStatus {
  return runsHere(collector, list) ? "READY" : "HELD";
}

/**
 * The registry split by whether each collector can run here, each part in
 * registry order: the ones that run, and the held ones (Held, with why).
 */
export function byReadiness(list: CollectorList): {
  readonly ready: readonly Collector[];
  readonly held: readonly Collector[];
} {
  return {
    ready: list.items.filter((item) => runsHere(item, list)),
    held: list.items.filter((item) => !runsHere(item, list)),
  };
}

/** Why, in words, when that needs saying: held, licence unverified, or a key needed. */
export function readinessNote(collector: Collector, list: CollectorList): string | null {
  if (collector.availability === "UNVERIFIED") {
    return list.unverifiedSourcesAllowed
      ? "Its licence is unverified; this deployment allows unverified sources."
      : "Its licence is unverified, and this deployment does not allow unverified sources.";
  }
  if (collector.availability !== "AVAILABLE") return collector.availabilityReason;
  if (collector.credentials.vaultIds.length > 0 && !collector.credentials.runsWithout) {
    return "It needs a key that your organisation sets.";
  }
  return null;
}

/** A discipline in words, as the platform names them. */
export const DISCIPLINE_TEXT: Readonly<Record<Collector["discipline"], string>> = {
  TECHINT: "TECHINT",
  SOCMINT: "SOCMINT",
  MEDIAINT: "MEDIAINT",
  GEOINT: "GEOINT",
  PERSON: "Person",
};
