import { NotImplementedError } from "@repo/core";
import type { CollectorRegistry } from "@repo/collectors";
import type { CredentialVault } from "@repo/integrations";
import type { InvestigationQueue, JobReplayer, ReportQueue } from "@repo/osint-engine";
import type { Auth } from "./auth/better-auth.ts";
import type { AccessServices } from "./http/access.ts";
import { resolvePrincipal, type PrincipalServices } from "./http/principal.ts";

/** What the run routes need: queues to start and replay work, never to do it. */
export interface RunServices {
  readonly investigations: InvestigationQueue;
  readonly replayer: JobReplayer;
  /** The platform registry, for each job's source label. */
  readonly registry: CollectorRegistry;
  /** How often the progress stream reads a run's state. */
  readonly eventsPollMs: number;
  /** Enqueues report generation; the worker does it. */
  readonly reports: ReportQueue;
  /** Why a model-written synthesis cannot be offered, or null when it can. */
  readonly synthesisUnavailable: string | null;
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
    withTenant: (tenantId, work) =>
      services === null
        ? Promise.reject(unavailable("tenant data"))
        : services.db.withTenant(tenantId, work),
  };
}

export function authOf(services: Services | null): () => Auth {
  return () => requireServices(services).auth;
}
