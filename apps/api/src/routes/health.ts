import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

export const HealthResponseSchema = z.object({
  status: z.literal("ok").describe("The API process is up and serving requests."),
});

/**
 * Liveness only: it proves this process answers HTTP. It does not check
 * Postgres or Redis, and says so, rather than implying it did.
 */
export const healthRoutes: FastifyPluginAsyncZod = (app) => {
  app.get(
    "/health",
    {
      config: { access: { public: "Liveness must be checkable without credentials." } },
      schema: {
        operationId: "getHealth",
        summary: "Liveness check",
        description: "Reports that the API process is serving. Does not check dependencies.",
        tags: ["system"],
        response: { 200: HealthResponseSchema },
      },
    },
    () => ({ status: "ok" as const }),
  );
  return Promise.resolve();
};
