import swagger from "@fastify/swagger";
import { PRODUCT_NAME } from "@repo/config";
import Fastify, { type FastifyServerOptions } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { healthRoutes } from "./routes/health.ts";
import { openapiRoutes } from "./routes/openapi.ts";

/** Version of the public contract described by the OpenAPI document. */
export const API_CONTRACT_VERSION = "0.1.0";

/** Inbound requests never wait longer than this; long work belongs in jobs. */
const REQUEST_TIMEOUT_MS = 30_000;

export interface AppOptions {
  readonly logger: FastifyServerOptions["logger"];
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
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: `${PRODUCT_NAME} API`, version: API_CONTRACT_VERSION },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(healthRoutes);
  await app.register(openapiRoutes);

  return app;
}
