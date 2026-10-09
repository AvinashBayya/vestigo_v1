import { NotImplementedError } from "@repo/core";
import type { CollectorRegistry, CollectorRuntime } from "@repo/collectors";
import type { CredentialVault } from "@repo/integrations";
import type { ContentStore } from "@repo/db";
import type {
  CaseAnalysisCollectors,
  CaseAnalysisQueue,
  InvestigationQueue,
  JobReplayer,
  ReportQueue,
  ReportRenderQueue,
} from "@repo/osint-engine";
import type { Auth } from "./auth/better-auth.ts";
import type { AccessServices } from "./http/access.ts";
import { resolvePrincipal, type PrincipalServices } from "./http/principal.ts";

/** What the run routes need: queues to start and replay work, never to do it. */
export interface RunServices {
  readonly investigations: InvestigationQueue;
  readonly replayer: JobReplayer;
  /** The platform registry, for each job's source label. */
  readonly registry: CollectorRegistry;
  /** Admission for planning a run before it starts (estimates); it never fetches. */
  readonly planner: CollectorRuntime;
  /** Whether collectors with an UNVERIFIED licence run here; the planner is built with the same value. */
  readonly unverifiedSourcesAllowed: boolean;
  /** How often the progress stream reads a run's state. */
  readonly eventsPollMs: number;
  /** Enqueues report generation; the worker does it. */
  readonly reports: ReportQueue;
  /** Enqueues a generated report's PDF render, to resume one; the worker does it. */
  readonly renders: ReportRenderQueue;
  /** Where the worker stores report PDFs; read here to serve them. */
  readonly contentStore: ContentStore;
  /** Why a model-written synthesis cannot be offered, or null when it can. */
  readonly synthesisUnavailable: string | null;
  /** Enqueues an attempt at a case analysis; the worker makes it. */
  readonly caseAnalyses: CaseAnalysisQueue;
  /** The registry and held collectors as a case analysis reads them, for its input hash. */
  readonly caseAnalysisCollectors: CaseAnalysisCollectors;
}

/** Everything request handling needs. Constructed once, in server.ts or a test. */
export interface Services extends PrincipalServices {
  readonly vault: CredentialVault;
  readonly runs: RunServices;
}

/**
 * An app built without services only documents the API (the OpenAPI emitter
 * uses one). Any request that needs a service fails as not implemented,
 * rather than being answered with anything that looks like data.
 */
function unavailable(what: string): NotImplementedError {
  return new NotImplementedError(
    what,
    "this app instance was built without services: it only documents the API",
  );
}

export function requireServices(services: Services | null): Services {
  if (services === null) throw unavailable("request handling");
  return services;
}

export function accessServicesFor(services: Services | null): AccessServices {
  return {
    authenticate: (request) =>
      services === null
        ? Promise.reject(unavailable("authentication"))
        : resolvePrincipal(request, services),
    withTenant: (tenantId, work, options) =>
      services === null
        ? Promise.reject(unavailable("tenant data"))
        : services.db.withTenant(tenantId, work, options),
  };
}

export function authOf(services: Services | null): () => Auth {
  return () => requireServices(services).auth;
}
