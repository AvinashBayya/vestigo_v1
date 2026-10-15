/**
 * The registry and the held collectors as a case analysis reads them: plain
 * data, built once by whoever holds the collector registry (the worker and the
 * API) and handed to the analysis, so its job never imports the collector
 * runtime. Labels and disciplines come from here alone (CLAUDE.md, source
 * labelling).
 */
import type { CaseHeldCollector, CaseRegistryCollector } from "@repo/case-engine";
import type { CollectorRegistry, HeldCollector } from "@repo/collectors";

export interface CaseAnalysisCollectors {
  readonly registry: readonly CaseRegistryCollector[];
  readonly held: readonly CaseHeldCollector[];
}

/**
 * Every registered collector (BLOCKED and not implemented ones included, as the
 * registry lists them, each saying it cannot run) and every held one, as plain
 * data. A collector that cannot run stays in the list, so a run that records it
 * is labelled from the registry, never "not in the current registry" (owner
 * ruling, 2026-10-13).
 */
export function caseAnalysisCollectors(
  registry: CollectorRegistry,
  held: readonly HeldCollector[],
): CaseAnalysisCollectors {
  return {
    registry: registry.list().map((entry) => ({
      id: entry.id,
      label: entry.label,
      collectionMode: entry.collectionMode,
      discipline: entry.discipline,
      cannotRun:
        entry.availability === "BLOCKED" || entry.availability === "NOT_IMPLEMENTED"
          ? entry.availability
          : null,
    })),
    held: held.map((entry) => ({
      id: entry.collector.declaration.id,
      displayName: entry.collector.declaration.displayName,
      targetTypes: entry.collector.declaration.targetTypes,
      reason: entry.reason,
      discipline: entry.collector.declaration.discipline,
      collectionMode: entry.collector.declaration.collectionMode,
    })),
  };
}
