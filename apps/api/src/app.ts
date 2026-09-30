import { randomUUID } from "node:crypto";
import swagger from "@fastify/swagger";
import { PRODUCT_NAME } from "@repo/config";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { enforceRouteAccess, type DeclaredRoute } from "./http/access.ts";
import { registerErrorHandling } from "./http/errors.ts";
import { apiKeyRoutes } from "./routes/api-keys.ts";
import { auditLogRoutes } from "./routes/audit-log.ts";
import { authRoutes } from "./routes/auth.ts";
import { credentialRoutes } from "./routes/credentials.ts";
import { healthRoutes } from "./routes/health.ts";
import { investigationRoutes } from "./routes/investigations.ts";
import { meRoutes } from "./routes/me.ts";
import { openapiRoutes } from "./routes/openapi.ts";
import { personRoutes } from "./routes/person.ts";
import { runRoutes } from "./routes/runs.ts";
import { scopeAuthorisationRoutes } from "./routes/scope-authorisations.ts";
import { accessServicesFor, authOf, requireServices, type Services } from "./services.ts";

/** Version of the public contract described by the OpenAPI document. */
export const API_CONTRACT_VERSION = "0.2.0";

/** Inbound requests never wait longer than this; long work belongs in jobs. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface AppOptions {
  readonly logger: FastifyServerOptions["logger"];
  /** Null builds an app that documents the API but serves no protected request. */
  readonly services: Services | null;
}

declare module "fastify" {
  interface FastifyInstance {
    /** Every route and the access it declared, as registered. */
    declaredRoutes: readonly DeclaredRoute[];
  }
}

/**
 * Builds the API without listening, so tests and the OpenAPI emitter use the
 * exact app the server runs. The same Zod schemas validate requests, serialise
 * responses and generate the OpenAPI document.
 */
export async function buildApp(options: AppOptions) {
  const app = Fastify({
    logger: options.logger ?? false,
    requestTimeout: REQUEST_TIMEOUT_MS,
    // HEAD twins of GET routes would each need their own access declaration.
    exposeHeadRoutes: false,
    // Unique across processes and restarts, so an audit row's request id
    // identifies exactly one request. Never taken from the client.
    genReqId: () => randomUUID(),
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  // Registered before any route, so no route can skip it.
  const declared: DeclaredRoute[] = [];
  enforceRouteAccess(app, () => accessServicesFor(options.services), declared);
  app.decorate("declaredRoutes", declared);

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: `${PRODUCT_NAME} API`, version: API_CONTRACT_VERSION },
      components: {
        securitySchemes: {
          session: {
            type: "apiKey",
            in: "cookie",
            name: "better-auth.session_token",
            description: "A session from /api/auth, with MFA enrolled and a tenant selected.",
          },
          apiKey: {
            type: "http",
            scheme: "bearer",
            description: "A tenant API key: ak_<tenant>_<key>_<secret>. Scoped to its permissions.",
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  const services = () => requireServices(options.services);
  await app.register(healthRoutes);
  await app.register(openapiRoutes);
  await app.register(authRoutes(authOf(options.services)));
  await app.register(meRoutes);
  await app.register(investigationRoutes);
  await app.register(auditLogRoutes);
  await app.register(apiKeyRoutes(services));
  await app.register(credentialRoutes(services));
  await app.register(personRoutes);
  await app.register(runRoutes(services));
  await app.register(scopeAuthorisationRoutes);

  return app;
}
