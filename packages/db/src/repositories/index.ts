import type { TenantScope } from "../scope.ts";
import { ClaimsRepository, EvidenceRepository } from "./evidence.ts";
import {
  EntitiesRepository,
  EntityMergesRepository,
  EntityRelationshipsRepository,
} from "./entities.ts";
import {
  AlertsRepository,
  CasePinsRepository,
  CasesRepository,
  CredentialsRepository,
  MonitorsRepository,
  UsageEventsRepository,
} from "./operations.ts";
import {
  ApiKeysRepository,
  MembershipsRepository,
  PermissionsRepository,
  RolesRepository,
  TenantsRepository,
  UsersRepository,
} from "./tenancy.ts";
import {
  AuditLogRepository,
  CollectorsRegistryRepository,
  InvestigationsRepository,
  JobsRepository,
  RunsRepository,
} from "./work.ts";

/** One repository per table, all bound to the same live tenant scope. */
export interface Repositories {
  readonly tenants: TenantsRepository;
  readonly users: UsersRepository;
  readonly roles: RolesRepository;
  readonly permissions: PermissionsRepository;
  readonly memberships: MembershipsRepository;
  readonly apiKeys: ApiKeysRepository;
  readonly auditLog: AuditLogRepository;
  readonly collectorsRegistry: CollectorsRegistryRepository;
  readonly investigations: InvestigationsRepository;
  readonly runs: RunsRepository;
  readonly jobs: JobsRepository;
  readonly evidence: EvidenceRepository;
  readonly entities: EntitiesRepository;
  readonly entityRelationships: EntityRelationshipsRepository;
  readonly entityMerges: EntityMergesRepository;
  readonly claims: ClaimsRepository;
  readonly cases: CasesRepository;
  readonly casePins: CasePinsRepository;
  readonly monitors: MonitorsRepository;
  readonly alerts: AlertsRepository;
  readonly credentials: CredentialsRepository;
  readonly usageEvents: UsageEventsRepository;
}

/** Table each repository owns; the isolation tests check every table is covered. */
export const REPOSITORY_TABLES: Readonly<Record<keyof Repositories, string>> = {
  tenants: "tenants",
  users: "users",
  roles: "roles",
  permissions: "permissions",
  memberships: "memberships",
  apiKeys: "api_keys",
  auditLog: "audit_log",
  collectorsRegistry: "collectors_registry",
  investigations: "investigations",
  runs: "runs",
  jobs: "jobs",
  evidence: "evidence",
  entities: "entities",
  entityRelationships: "entity_relationships",
  entityMerges: "entity_merges",
  claims: "claims",
  cases: "cases",
  casePins: "case_pins",
  monitors: "monitors",
  alerts: "alerts",
  credentials: "credentials",
  usageEvents: "usage_events",
};

export function createRepositories(scope: TenantScope): Repositories {
  return {
    tenants: new TenantsRepository(scope),
    users: new UsersRepository(scope),
    roles: new RolesRepository(scope),
    permissions: new PermissionsRepository(scope),
    memberships: new MembershipsRepository(scope),
    apiKeys: new ApiKeysRepository(scope),
    auditLog: new AuditLogRepository(scope),
    collectorsRegistry: new CollectorsRegistryRepository(scope),
    investigations: new InvestigationsRepository(scope),
    runs: new RunsRepository(scope),
    jobs: new JobsRepository(scope),
    evidence: new EvidenceRepository(scope),
    entities: new EntitiesRepository(scope),
    entityRelationships: new EntityRelationshipsRepository(scope),
    entityMerges: new EntityMergesRepository(scope),
    claims: new ClaimsRepository(scope),
    cases: new CasesRepository(scope),
    casePins: new CasePinsRepository(scope),
    monitors: new MonitorsRepository(scope),
    alerts: new AlertsRepository(scope),
    credentials: new CredentialsRepository(scope),
    usageEvents: new UsageEventsRepository(scope),
  };
}

export * from "./evidence.ts";
export * from "./entities.ts";
export * from "./operations.ts";
export * from "./tenancy.ts";
export * from "./work.ts";
export { TenantRepository, type ListOptions } from "./base.ts";
