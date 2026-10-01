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
  TenantQuotasRepository,
  UsageEventsRepository,
} from "./operations.ts";
import { ReportsRepository } from "./reports.ts";
import { ApiKeysRepository, TenantsRepository, UsersRepository } from "./tenancy.ts";
import {
  AuditLogRepository,
  CollectorsRegistryRepository,
  InvestigationsRepository,
  JobsRepository,
  RunsRepository,
  ScopeAuthorisationsRepository,
} from "./work.ts";

/** One repository per table, all bound to the same live tenant scope. */
export interface Repositories {
  readonly tenants: TenantsRepository;
  readonly users: UsersRepository;
  readonly apiKeys: ApiKeysRepository;
  readonly auditLog: AuditLogRepository;
  readonly collectorsRegistry: CollectorsRegistryRepository;
  readonly scopeAuthorisations: ScopeAuthorisationsRepository;
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
  readonly tenantQuotas: TenantQuotasRepository;
  readonly reports: ReportsRepository;
}

/** Table each repository owns; the isolation tests check every table is covered. */
export const REPOSITORY_TABLES: Readonly<Record<keyof Repositories, string>> = {
  tenants: "tenants",
  users: "users",
  apiKeys: "api_keys",
  auditLog: "audit_log",
  collectorsRegistry: "collectors_registry",
  scopeAuthorisations: "scope_authorisations",
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
  tenantQuotas: "tenant_quotas",
  reports: "reports",
};

export function createRepositories(scope: TenantScope): Repositories {
  return {
    tenants: new TenantsRepository(scope),
    users: new UsersRepository(scope),
    apiKeys: new ApiKeysRepository(scope),
    auditLog: new AuditLogRepository(scope),
    collectorsRegistry: new CollectorsRegistryRepository(scope),
    scopeAuthorisations: new ScopeAuthorisationsRepository(scope),
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
    tenantQuotas: new TenantQuotasRepository(scope),
    reports: new ReportsRepository(scope),
  };
}

export * from "./evidence.ts";
export * from "./entities.ts";
export * from "./operations.ts";
export * from "./tenancy.ts";
export * from "./work.ts";
export * from "./reports.ts";
export { TenantRepository, type ListOptions } from "./base.ts";
