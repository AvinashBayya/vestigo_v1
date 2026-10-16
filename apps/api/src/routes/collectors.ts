import { ACCESS_METHODS, type Availability } from "@repo/collectors";
import {
  COLLECTION_MODES,
  COLLECTOR_DISCIPLINES,
  COMMERCIAL_USE_VERDICTS,
  TARGET_TYPES,
  UNRUNNABLE_REASONS,
} from "@repo/core";
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

const AccessMethod = z.enum(ACCESS_METHODS);

const AccessMethodView = z
  .object({
    kind: AccessMethod,
    /** Enabled in this deployment (COLLECTORS_ACCESS_METHODS). */
    enabled: z.boolean(),
    /** The source's verdict, shared by every way in. */
    licenceVerdict: z.enum(COMMERCIAL_USE_VERDICTS),
    /** Enabled, and the verdict is PERMITTED: the only way anything runs. */
    runnable: z.boolean(),
  })
  .meta({ id: "AccessMethod" });

/** What can run, via which methods; never an empty list. */
const RunsVia = z.array(AccessMethod).min(1);

/**
 * Whether something can run here, before any per-run check. When it cannot,
 * runsVia is null, never an empty list or a count, and refusal and reason say
 * why: a null shown as "—" with its reason, never as 0. runsVia is null
 * exactly when refusal and reason are not. (One object with nullable fields,
 * not a union with null-only members: the generated client drops a property
 * whose only possible value is null.)
 */
const runnability = <Shape extends z.ZodRawShape>(shape: Shape, id: string) =>
  z
    .object({
      ...shape,
      runsVia: RunsVia.nullable(),
      refusal: z.enum(UNRUNNABLE_REASONS).nullable(),
      reason: z.string().min(1).nullable(),
    })
    .meta({ id });

const CollectorAccessView = runnability(
  {
    /** The access methods it can use, as this deployment treats each. */
    methods: z.array(AccessMethodView),
  },
  "CollectorAccess",
);

const SourceView = runnability(
  {
    id: z.string(),
    label: z.string(),
    methods: z.array(AccessMethodView),
    licenceVerdict: z.enum(COMMERCIAL_USE_VERDICTS),
    /** Whether any of its methods can run here; not whether a collector reads it. */
    enabled: z.boolean(),
  },
  "SourceAccess",
);

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
     * Its licence and implementation status, from code alone. Whether it runs
     * here is `access`: an UNVERIFIED or BLOCKED one never does.
     */
    availability: z.enum(AVAILABILITIES),
    /** Why it is not AVAILABLE; null when it is. */
    availabilityReason: z.string().nullable(),
    /** The source it reads (`sources`). */
    sourceId: z.string(),
    /** Whether it can run here, and via which access methods. */
    access: CollectorAccessView,
  })
  .meta({ id: "Collector" });

const CollectorList = z
  .object({
    /**
     * Retired on 2026-10-16 and always false: an UNVERIFIED source never runs
     * in any deployment. Kept so a client reading it is not broken; read each
     * collector's `access` instead.
     */
    unverifiedSourcesAllowed: z.literal(false),
    /** The access methods this deployment enables; operator only where configured. */
    accessMethodsEnabled: z.array(AccessMethod),
    /** Every source in the platform catalogue, with how it is reached and whether it can run here. */
    sources: z.array(SourceView),
    items: z.array(CollectorView),
  })
  .describe("Every registered collector, as the registry declares it, and every source.");

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
            "The registry's declarations, and whether each can run in this deployment, via which access methods: no live health, and no tenant credentials. Whether a collector actually ran for a target is on the run (GET /api/v1/runs/{id}).",
          tags: ["runs"],
          security: SECURITY,
          response: { 200: CollectorList, ...PROTECTED_ERRORS },
        },
      },
      () => {
        const { registry, planner } = services().runs;
        return {
          unverifiedSourcesAllowed: false as const,
          accessMethodsEnabled: [...planner.accessMethods],
          sources: planner.sources().map((source) => {
            const base = {
              id: source.id,
              label: source.label,
              methods: source.methods.map((method) => ({ ...method })),
              licenceVerdict: source.licenceVerdict,
              enabled: source.enabled,
            };
            return source.runsVia === null
              ? { ...base, runsVia: null, refusal: source.refusal, reason: source.reason }
              : { ...base, runsVia: [...source.runsVia], refusal: null, reason: null };
          }),
          items: registry.list().map((entry) => {
            const access = planner.access(entry.id);
            return {
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
              sourceId: entry.source.id,
              access: {
                methods: access.methods.map((method) => ({ ...method })),
                ...(access.runsVia === null
                  ? { runsVia: null, refusal: access.refusal, reason: access.reason }
                  : { runsVia: [...access.runsVia], refusal: null, reason: null }),
              },
            };
          }),
        };
      },
    );
    return Promise.resolve();
  };
