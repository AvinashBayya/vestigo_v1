import type { CollectorStatus } from "@repo/ui";
import { queryOptions } from "@tanstack/react-query";
import { timed, unwrap } from "./api.ts";
import { api, type paths } from "./client/index.ts";

export type CollectorList =
  paths["/api/v1/collectors"]["get"]["responses"][200]["content"]["application/json"];
export type Collector = CollectorList["items"][number];
export type AccessMethod = CollectorList["accessMethodsEnabled"][number];

/** Every registered collector, as the registry declares it. */
export const collectorsQuery = queryOptions({
  queryKey: ["collectors"],
  queryFn: ({ signal }): Promise<CollectorList> =>
    unwrap(api.GET("/api/v1/collectors", { signal: timed(signal) })),
  // The registry changes only when the platform is deployed.
  staleTime: Number.POSITIVE_INFINITY,
});

/**
 * The access methods it can run via in this deployment, as the API decides
 * them; null when none can. Read, never re-derived: whether something may run
 * is the server's decision (CLAUDE.md §6). Fails closed: a collector the API
 * did not say can run is treated as one that cannot.
 */
export function runsVia(collector: Collector): readonly AccessMethod[] | null {
  // Read as data: an answer that leaves it out says nothing can run.
  const access: unknown = collector.access;
  const via =
    typeof access === "object" && access !== null && "runsVia" in access ? access.runsVia : null;
  return Array.isArray(via) && via.length > 0 ? collector.access.runsVia : null;
}

/** Whether it can run in this deployment, before any per-run check. */
export function runsHere(collector: Collector): boolean {
  return runsVia(collector) !== null;
}

/** Its §3 status before any run: Ready, or Held. */
export function readiness(collector: Collector): CollectorStatus {
  return runsHere(collector) ? "READY" : "HELD";
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
    ready: list.items.filter((item) => runsHere(item)),
    held: list.items.filter((item) => !runsHere(item)),
  };
}

/** Why, in words, when that needs saying: why it is held, or that it needs a key. */
export function readinessNote(collector: Collector): string | null {
  const via = runsVia(collector);
  if (via === null) {
    const access: unknown = collector.access;
    const reason =
      typeof access === "object" && access !== null && "reason" in access ? access.reason : null;
    return typeof reason === "string" && reason.trim().length > 0
      ? reason
      : "The server did not say that it can run here, so it is held.";
  }
  if (!via.includes("open")) return "It needs a key that your organisation sets.";
  return null;
}

/** An access method in words, as a row says what something runs via. */
export const ACCESS_METHOD_TEXT: Readonly<Record<AccessMethod, string>> = {
  open: "open access",
  official: "its official API, with your organisation's key",
  licensed: "a licensed account, your organisation's",
  operator: "an operator's own collector",
};

/** The methods something runs via, in words: "open access or its official API, …". */
export function runsViaText(via: readonly AccessMethod[]): string {
  return via.map((method) => ACCESS_METHOD_TEXT[method]).join(" or ");
}

/** A discipline in words, as the platform names them. */
export const DISCIPLINE_TEXT: Readonly<Record<Collector["discipline"], string>> = {
  TECHINT: "TECHINT",
  SOCMINT: "SOCMINT",
  MEDIAINT: "MEDIAINT",
  GEOINT: "GEOINT",
  PERSON: "Person",
};
