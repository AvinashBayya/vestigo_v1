import { randomUUID } from "node:crypto";
import swagger from "@fastify/swagger";
import { PRODUCT_NAME } from "@repo/config";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { enforceRouteAccess, type DeclaredRoute } from "./http/access.ts";
import { withoutUnusedSchemas } from "./http/openapi-components.ts";
import { registerErrorHandling } from "./http/errors.ts";
import { apiKeyRoutes } from "./routes/api-keys.ts";
import { auditLogRoutes } from "./routes/audit-log.ts";
import { authRoutes } from "./routes/auth.ts";
import { caseRoutes } from "./routes/cases.ts";
import { entityRoutes } from "./routes/entities.ts";
import { estimateRoutes } from "./routes/estimates.ts";
import { evidenceRoutes } from "./routes/evidence.ts";
import { exploreRoutes } from "./routes/explore.ts";
import { memberRoutes } from "./routes/members.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { credentialRoutes } from "./routes/credentials.ts";
import { healthRoutes } from "./routes/health.ts";
import { investigationRoutes } from "./routes/investigations.ts";
import { meRoutes } from "./routes/me.ts";
import { openapiRoutes } from "./routes/openapi.ts";
import { personRoutes } from "./routes/person.ts";
import { reportRoutes } from "./routes/reports.ts";
import { runRoutes } from "./routes/runs.ts";
import { scopeAuthorisationRoutes } from "./routes/scope-authorisations.ts";
import { sessionRoutes } from "./routes/session.ts";
import { accessServicesFor, authOf, requireServices, type Services } from "./services.ts";

/** Version of the public contract described by the OpenAPI document. */
export const API_CONTRACT_VERSION = "0.3.0";

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
    // Schemas given an id (`.meta({ id })`) become named components, so the
    // generated client types them by name; unreferenced ones are dropped.
    transformObject: (document) => withoutUnusedSchemas(jsonSchemaTransformObject(document)),
  });

  const services = () => requireServices(options.services);
  await app.register(healthRoutes);
  await app.register(openapiRoutes);
  await app.register(authRoutes(authOf(options.services)));
  await app.register(sessionRoutes(services));
  await app.register(meRoutes);
  await app.register(investigationRoutes);
  await app.register(auditLogRoutes);
  await app.register(apiKeyRoutes(services));
  await app.register(credentialRoutes(services));
  await app.register(personRoutes);
  await app.register(runRoutes(services));
  await app.register(reportRoutes(services));
  await app.register(scopeAuthorisationRoutes);
  await app.register(caseRoutes(services));
  await app.register(entityRoutes);
  await app.register(evidenceRoutes(services));
  await app.register(exploreRoutes(services));
  await app.register(memberRoutes(services));
  await app.register(settingsRoutes);
  await app.register(estimateRoutes(services));

  return app;
}
