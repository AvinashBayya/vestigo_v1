// Orchestration: planning a run, dispatching its collector jobs through
// per-source queues with fault isolation, fusing what they found, and
// generating reports from a settled run.
export {
  CollectionExecutor,
  CollectionInJobError,
  TenantNotProvisionedError,
  type CollectionReport,
  type CollectionRequest,
  type StandaloneCollectionRequest,
} from "./executor.ts";
export {
  VaultCredentialSource,
  type CredentialPurpose,
  type CredentialSource,
} from "./credentials.ts";
export { redisUpstreamRateLimiter } from "./rate-limiter.ts";
export { planRun, type ExcludedCollector, type PlannedJob, type RunPlan } from "./planner.ts";
export { RunCoordinator, RunNotReadyError, type PlannedRun } from "./runs.ts";
export {
  CollectorJobProcessor,
  JobNotFoundError,
  type CircuitGate,
  type JobDisposition,
  type JobObserver,
  type ProcessOptions,
} from "./jobs/collector-job.ts";
export {
  circuitVerdict,
  exceededQuota,
  isRetryable,
  jobIdempotencyKey,
  periodStart,
  retryDelayMs,
  type CircuitVerdict,
  type QuotaExceeded,
  type RetryPolicy,
} from "./jobs/policy.ts";
export {
  CaseAnalysisNotFoundError,
  CaseAnalysisProcessor,
  type CaseAnalysisDisposition,
  type CaseAnalysisProcessorOptions,
} from "./jobs/case-analysis.ts";
export {
  CASE_ANALYSIS_FORMAT_VERSION,
  CaseAnalysisDocumentSchema,
  CaseWordingSchema,
  type CaseAnalysisDocument,
} from "./case-analysis/document.ts";
export {
  analysisProbe,
  analysisRecord,
  CASE_ANALYSIS_READ_STATES,
  CASE_ANALYSIS_STATE_REASONS,
  CaseAnalysisRequestConflictError,
  CaseAnalysisUnrecordedError,
  caseProbe,
  CaseTooLargeError,
  currentInput,
  DEFAULT_MAX_CASE_RECORDS,
  latestAnalysis,
  readView,
  REPEATING_FAILURES,
  requestCaseAnalysis,
  requireCaseWithinBound,
  requestedView,
  type CaseAnalysisReadState,
  type CaseAnalysisReadView,
  type CaseAnalysisRecord,
  type CaseAnalysisRequest,
  type CaseAnalysisRequestedView,
} from "./case-analysis/requests.ts";
export {
  CASE_ANALYSES_QUEUE,
  CaseAnalysisQueue,
  DEFAULT_ENQUEUE_TIMEOUT_MS,
  QueueUnavailableError,
  type ProducerOptions,
  collectQueueName,
  DEAD_LETTER_MESSAGE,
  DEAD_LETTER_QUEUE,
  FUSION_QUEUE,
  INVESTIGATIONS_QUEUE,
  InvestigationQueue,
  JobNotReplayableError,
  JobReplayer,
  JobRetryError,
  ReplayTargetNotFoundError,
  REPORT_RENDERS_QUEUE,
  ReportQueue,
  ReportRenderQueue,
  REPORTS_QUEUE,
  selectQueues,
  startWorkerPool,
  type DeadLetter,
  type QueueConnection,
  type WorkerPool,
  type WorkerPoolObserver,
  type WorkerPoolOptions,
} from "./jobs/queues.ts";
export {
  FusionError,
  RunFusion,
  RunNotFoundError,
  runStatusOf,
  type FusionReport,
} from "./fusion/fuse.ts";
export {
  ClaimPathError,
  EXTRACTORS,
  isDerivedPath,
  resolveClaims,
  type ClaimDraft,
  type Extraction,
  type Extractor,
  type ResolvedClaim,
  type ResultPath,
} from "./fusion/extractors.ts";
export {
  readRunProgress,
  usageSummary,
  type JobProgress,
  type RunProgress,
  type UsageLine,
} from "./progress.ts";
export {
  assembleReport,
  COVERAGE_CAVEATS,
  DEFAULT_ASSEMBLY_LIMITS,
  displayValue,
  ReportRunNotFoundError,
  ReportRunNotSettledError,
  type AssembledReport,
  type AssemblyInput,
  type AssemblyLimits,
} from "./reports/assemble.ts";
export { coveragePlan } from "./reports/stored-plan.ts";
export { canonicalJson, CanonicalFormError, sha256Of } from "./case-analysis/canonical.ts";
export { caseAnalysisCollectors, type CaseAnalysisCollectors } from "./case-analysis/collectors.ts";
export {
  caseInputHash,
  CURRENT_HASH_BASIS,
  readCaseAnalysisInput,
  type CaseAnalysisInput,
  type CaseInputHashBasis,
} from "./case-analysis/input.ts";
export {
  SYNTHESIS_NOTICE,
  SYNTHESIS_PROMPT_VERSION,
  SynthesisAnswer,
  synthesise,
} from "./reports/synthesis.ts";
export {
  ReportGenerator,
  ReportNotFoundError,
  ReportQuotaError,
  type ReportDisposition,
  type ReportGeneratorOptions,
} from "./reports/generator.ts";
export {
  ReportNotRenderableError,
  ReportPdfStorageError,
  ReportRenderer,
  ReportRenderFailedError,
  type ReportRenderDisposition,
  type ReportRendererOptions,
} from "./reports/renderer.ts";
