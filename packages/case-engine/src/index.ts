// Case analysis over stored records. Pure: plain data in, a plain document
// out; no I/O, no clock, no randomness (CLAUDE.md §6). It reads stored
// evidence only and cannot import the collector runtime, so analysis can
// never cause collection.
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
