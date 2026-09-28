// The collector SDK: declarations, the platform source catalogue, the
// registry, the runtime that gates and runs collectors, and the one outbound
// fetcher. No database access; osint-engine writes evidence.
//
// Deliberately not exported: anything that reaches a collector's
// implementation. The runtime is the only way to run one.
export { PLATFORM_SOURCES } from "./catalogue.ts";
export {
  declareCollector,
  defineCollector,
  type Collector,
  type CollectorCredentials,
  type CollectorDeclaration,
  type CollectorImplementation,
  type CollectorReturn,
  type CollectorSecret,
  type EvidenceItem,
  type RunContext,
} from "./contract.ts";
export {
  CollectorDefinitionError,
  DestinationRefusedError,
  FetchOptionsError,
  InvalidTargetError,
  RateLimiterUnavailableError,
  ResponseTooLargeError,
  UnknownCollectorError,
  UpstreamRateLimitedError,
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
  UpstreamUnreachableError,
  type DestinationRefusal,
  type TargetProblem,
} from "./errors.ts";
export {
  evidenceDrafts,
  tenantRegistration,
  type EvidenceDraft,
  type TenantRegistration,
} from "./evidence.ts";
export { isPublicAddress } from "./fetcher/address.ts";
export type { CapturedResponse } from "./fetcher/capture.ts";
export {
  COLLECTOR_USER_AGENT,
  MAX_FETCH_TIMEOUT_MS,
  type FetchRequest,
  type NetworkRuntime,
  type PinnedDestination,
  type RateLimitAnswer,
  type ResolvedAddress,
  type Resolver,
  type SocketFactory,
  type UpstreamFetch,
  type UpstreamRateLimiter,
} from "./fetcher/fetcher.ts";
export {
  foundBy,
  type CollectionOutcome,
  type FailedOutcome,
  type FoundOutcome,
  type OutcomeError,
  type RefusalReason,
  type RefusedOutcome,
} from "./outcome.ts";
export { CollectorRegistry, type Availability, type RegistryEntry } from "./registry.ts";
export {
  CollectorRuntime,
  isEmptyResult,
  type Admission,
  type DispatchRequest,
  type ScopeClearance,
} from "./runtime.ts";
export {
  validateSource,
  type Attribution,
  type IsoDate,
  type LicenceCheck,
  type LicenceVerdict,
  type Source,
  type SourceDeclaration,
  type SourceNetwork,
  type SourceRateLimit,
} from "./source.ts";
export { parseTarget, type Target } from "./target.ts";
