// Public surface: the credential vault, API key storage and the shared rate limiter.
// Envelope primitives and master-key internals are deliberately not exported:
// a secret is decrypted only through CredentialVault.reveal(), which audits.
export { CredentialVault } from "./vault/credential-vault.ts";
export type {
  CredentialMetadata,
  RevealRequest,
  StoreCredentialInput,
} from "./vault/credential-vault.ts";
export { MasterKey } from "./vault/master-key.ts";
export { SecretValue } from "./vault/secret-value.ts";
export {
  CredentialDecryptionError,
  CredentialInputError,
  CredentialNotFoundError,
  CredentialRevokedError,
  InvalidMasterKeyError,
  MasterKeyMismatchError,
} from "./vault/errors.ts";
export type {
  CredentialInputField,
  DecryptionStage,
  InvalidMasterKeyReason,
} from "./vault/errors.ts";

// API key storage and lifecycle. The key format, hashing, verification and
// scope rules are @repo/access's.
export { ApiKeyService } from "./api-keys/service.ts";
export type {
  ApiKeyMetadata,
  ApiKeyPrincipal,
  CreateApiKeyInput,
  IssuedApiKey,
  RotateApiKeyInput,
} from "./api-keys/service.ts";
export {
  ApiKeyAuthenticationError,
  ApiKeyInputError,
  ApiKeyNotFoundError,
} from "./api-keys/errors.ts";
export type { ApiKeyInputField } from "./api-keys/errors.ts";

export { createRedisClient, waitForRedisReady } from "./rate-limit/redis-client.ts";
export type { RedisClientOptions } from "./rate-limit/redis-client.ts";
export { FixedWindowRateLimiter } from "./rate-limit/fixed-window.ts";
export { SlidingLogRateLimiter } from "./rate-limit/sliding-log.ts";
export type { IntervalPolicy, SlidingLogDecision } from "./rate-limit/sliding-log.ts";
export type { RateLimitDecision, RateLimitPolicy } from "./rate-limit/fixed-window.ts";
export { RateLimiterConfigError, RateLimiterUnavailableError } from "./rate-limit/errors.ts";
