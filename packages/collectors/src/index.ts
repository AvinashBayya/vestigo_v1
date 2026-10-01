// The collector SDK: declarations, the platform source catalogue, the
// registry, the runtime that gates and runs collectors, and the one outbound
// fetcher. No database access; osint-engine writes evidence.
//
// Deliberately not exported: anything that reaches a collector's
// implementation. The runtime is the only way to run one.
export { PLATFORM_SOURCES } from "./catalogue.ts";
export {
  COMMONCRAWL_RESULT,
  CONTACT_PHONE_RESULT,
  createPlatformRegistry,
  CRTSH_RESULT,
  DEVTO_RESULT,
  DNS_RESULT,
  GITHUB_RESULT,
  HACKERNEWS_RESULT,
  HELD_PLATFORM_COLLECTORS,
  NEWS_RESULT,
  PLATFORM_COLLECTORS,
  RDAP_RESULT,
  WAYBACK_RESULT,
  WIKIDATA_RESULT,
  type HeldCollector,
} from "./platform/index.ts";
export { DERIVED_KEY, reportedPart } from "./provenance.ts";
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
export type { Captured, CapturedResponse, LocalRecord } from "./fetcher/capture.ts";
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
  type UsageMeter,
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
  type SourceOperator,
  type SourceRateLimit,
} from "./source.ts";
export { parseTarget, type Target } from "./target.ts";
