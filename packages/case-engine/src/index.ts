// Case analysis over stored records. Pure: plain data in, a plain document
// out; no I/O, no clock, no randomness (CLAUDE.md §6). It reads stored
// evidence only and cannot import the collector runtime, so analysis can
// never cause collection.
export { ENGINE_VERSION } from "./version.ts";
export {
  COVERAGE_CAVEATS,
  coverageFromJob,
  coverageHeadline,
  runCoverage,
  sourceLabelOf,
  type CoverageCollector,
  type CoverageExclusion,
  type CoverageHeldCollector,
  type CoverageJob,
  type CoveragePlan,
  type RunCoverageInput,
} from "./analysis/run-coverage.ts";
export { displayValue } from "./analysis/display-value.ts";
export {
  byCodeUnit,
  CASE_INPUT_PROBLEMS,
  CaseInputError,
  isIsoInstant,
  type CaseClaim,
  type CaseEntity,
  type CaseEvidence,
  type CaseHeldCollector,
  type CaseInput,
  type CaseInputIssue,
  type CaseInputProblem,
  type CaseJob,
  type CaseRegistryCollector,
  type CaseRelationship,
  type CaseRun,
} from "./analysis/case-input.ts";
export {
  CASE_COVERAGE_STATES,
  caseCollectors,
  REGISTRATIONS,
  type ByStrength,
  type CaseCollector,
  type CaseCollectorRecords,
  type CaseCollectorRun,
  type CaseCollectors,
  type CaseCoverageState,
  type CaseJobCoverage,
  type CaseRunCoverage,
  type CollectorRegistration,
  type Counted,
  type EmptyCase,
  type NotMeasured,
  type Registration,
} from "./analysis/case-view.ts";
export {
  CASE_COVERAGE_CAVEATS,
  CASE_PARTIAL_REASONS,
  caseCoverage,
  type CaseCoverage,
  type CaseCoverageCaveat,
  type CasePartialReason,
  type TimeSpan,
} from "./analysis/case-coverage.ts";
export {
  CASE_BREAKDOWN_CAVEATS,
  caseBreakdown,
  DISCIPLINE_METRICS,
  DISCIPLINE_STATUSES,
  METRIC_NOT_BUILT,
  type CaseBreakdown,
  type CaseBreakdownCaveat,
  type CollectorRef,
  type CollectorRuns,
  type DisciplineCollectors,
  type DisciplineCount,
  type DisciplineMetric,
  type DisciplineMetricName,
  type DisciplineNotMeasured,
  type DisciplineSection,
  type DisciplineStatus,
  type HeldRef,
  type MetricNotBuilt,
} from "./analysis/case-breakdown.ts";
