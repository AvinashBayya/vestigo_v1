import { NotImplementedError } from "@repo/core";
import type { CredentialVault } from "@repo/integrations";
import type { Auth } from "./auth/better-auth.ts";
import type { AccessServices } from "./http/access.ts";
import { resolvePrincipal, type PrincipalServices } from "./http/principal.ts";

/** Everything request handling needs. Constructed once, in server.ts or a test. */
export interface Services extends PrincipalServices {
  readonly vault: CredentialVault;
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
