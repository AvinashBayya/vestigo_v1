import type { Availability } from "@repo/collectors";
import { COLLECTION_MODES, COLLECTOR_DISCIPLINES, TARGET_TYPES } from "@repo/core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Services } from "../services.ts";
import { PROTECTED_ERRORS, SECURITY } from "./schemas.ts";

const AVAILABILITIES = [
  "AVAILABLE",
  "UNVERIFIED",
  "BLOCKED",
  "NOT_IMPLEMENTED",
] as const satisfies readonly Availability[];

const CollectorView = z
  .object({
    id: z.string(),
    version: z.string(),
    /** The source label every piece of its evidence carries. */
    label: z.string(),
    discipline: z.enum(COLLECTOR_DISCIPLINES),
    targetTypes: z.array(z.enum(TARGET_TYPES)),
    collectionMode: z.enum(COLLECTION_MODES),
    /** The strength its claims are stored with. */
    claimStrength: z.enum(["OBSERVED", "REPORTED", "DERIVED"]),
    /** Vault ids it may use, and whether it runs without any. */
    credentials: z.object({ vaultIds: z.array(z.string()), runsWithout: z.boolean() }),
    /**
     * Before any per-run check. UNVERIFIED runs only where the deployment
     * allows unverified sources (`unverifiedSourcesAllowed`).
     */
    availability: z.enum(AVAILABILITIES),
    /** Why it is not AVAILABLE; null when it is. */
    availabilityReason: z.string().nullable(),
  })
  .meta({ id: "Collector" });

const CollectorList = z
  .object({
    /** Whether this deployment runs collectors whose licence is UNVERIFIED. */
    unverifiedSourcesAllowed: z.boolean(),
    items: z.array(CollectorView),
  })
  .describe("Every registered collector, as the registry declares it.");

export const collectorRoutes =
  (services: () => Services): FastifyPluginAsyncZod =>
  (app) => {
    app.get(
      "/api/v1/collectors",
      {
        config: { access: { permission: "run:read", action: "collector.list" } },
        schema: {
          operationId: "listCollectors",
          summary: "The registered collectors: what each is, what it takes, and whether it can run",
          description:
            "The registry's declarations only: no live health, and no tenant credentials. Whether a collector actually ran for a target is on the run (GET /api/v1/runs/{id}).",
          tags: ["runs"],
          security: SECURITY,
          response: { 200: CollectorList, ...PROTECTED_ERRORS },
        },
      },
      () => {
        const { registry, unverifiedSourcesAllowed } = services().runs;
        return {
          unverifiedSourcesAllowed,
          items: registry.list().map((entry) => ({
            id: entry.id,
            version: entry.version,
            label: entry.label,
            discipline: entry.discipline,
            targetTypes: [...entry.targetTypes],
            collectionMode: entry.collectionMode,
            claimStrength: entry.claimStrength,
            credentials: {
              vaultIds: [...entry.credentials.vaultIds],
              runsWithout: entry.credentials.runsWithout,
            },
            availability: entry.availability,
            availabilityReason: entry.availabilityReason,
          })),
        };
      },
    );
    return Promise.resolve();
  };
