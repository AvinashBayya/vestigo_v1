import { NotImplementedError } from "@repo/core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { ProblemSchema } from "../http/errors.ts";
import { PROTECTED_ERRORS, SECURITY } from "./schemas.ts";

/**
 * Person search. The access layer enforces the gate: the `person:search`
 * permission, a plan that includes person investigation, AND approved
 * vetting. No person collector exists yet, so past the gate this reports
 * not implemented rather than returning anything that looks like a result.
 */
export const personRoutes: FastifyPluginAsyncZod = (app) => {
  app.post(
    "/api/v1/person/search",
    {
      config: { access: { permission: "person:search", action: "person.search" } },
      schema: {
        operationId: "searchPerson",
        summary: "Search for a person (plan- and vetting-gated)",
        tags: ["person"],
        security: SECURITY,
        body: z.object({ query: z.string().trim().min(1).max(500) }),
        response: { ...PROTECTED_ERRORS, 501: ProblemSchema },
      },
    },
    () => {
      throw new NotImplementedError(
        "person.search",
        "person-investigation collectors are not built yet (Phase 3)",
      );
    },
  );
  return Promise.resolve();
};
