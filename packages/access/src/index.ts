// Who may do what, shared by the API and the workers: the permission
// catalogue, plan and vetting evaluation, and API key hashing, verification
// and scope. Pure: no I/O, and nothing here reads a database or the network.
export {
  isPermission,
  isRole,
  MODULES,
  PERMISSION_MODULE,
  PERMISSIONS,
  permissionsForRoles,
  ROLE_PERMISSIONS,
  ROLES,
  type Module,
  type Permission,
  type Role,
} from "./permissions.ts";
export {
  decideDisciplineAccess,
  decideModuleAccess,
  decidePermissionModuleAccess,
  DISCIPLINE_MODULE,
  PLAN_MODULES,
  PLANS,
  VETTING_GATED_MODULES,
  VETTING_STATUSES,
  type ModuleDecision,
  type Plan,
  type TenantEntitlement,
  type VettingStatus,
} from "./entitlements.ts";
export { personGate, type PersonLock } from "./person-gate.ts";
export { generateApiKey, hashApiKeySecret, parseApiKey, secretMatches } from "./api-keys/codec.ts";
export type { GeneratedApiKey, ParsedApiKey } from "./api-keys/codec.ts";
export { capApiKeyPermissions, grantableApiKeyScope } from "./api-keys/scope.ts";
export { ApiKeyScopeError, type ApiKeyScopeProblem } from "./api-keys/errors.ts";
