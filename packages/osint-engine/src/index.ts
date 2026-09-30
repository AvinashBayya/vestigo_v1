// Orchestration: planning a run, dispatching its collector jobs through
// per-source queues with fault isolation, and fusing what they found.
export {
  CollectionExecutor,
  TenantNotProvisionedError,
  type CollectionReport,
  type CollectionRequest,
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
export { EXTRACTORS, type Extraction, type Extractor } from "./fusion/extractors.ts";
export {
  readRunProgress,
  usageSummary,
  type JobProgress,
  type RunProgress,
  type UsageLine,
} from "./progress.ts";
