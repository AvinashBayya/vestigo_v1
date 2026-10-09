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
 * registry lists them) and every held one, as plain data.
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
