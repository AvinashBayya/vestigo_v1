import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

export const OPENAPI_PATH = "/api/v1/openapi.json";

/** Serves the OpenAPI document @fastify/swagger builds from the route schemas. */
export const openapiRoutes: FastifyPluginAsyncZod = (app) => {
  app.get(
    OPENAPI_PATH,
    {
      config: { access: { public: "The API contract is published so clients can be generated." } },
      schema: { hide: true },
    },
    () => app.swagger(),
  );
  return Promise.resolve();
};
