import { planRun } from "@repo/osint-engine";
import { EmptyTargetError, TARGET_TYPES } from "@repo/core";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import { HttpError, notFound } from "../http/errors.ts";
import type { Services } from "../services.ts";
import { PROTECTED_ERRORS, SECURITY } from "./schemas.ts";

const TargetType = z.enum(TARGET_TYPES);

/**
 * Why no cost can be given. Costs are not declared anywhere yet, so none is
 * estimated. Neither says a cost will follow: no run records one yet.
 */
const NO_COST_REASON = "No credit cost is declared for this collector, so none is estimated.";
const NO_TOTAL_COST_REASON =
  "No collector in this run declares a credit cost, so the run's cost is not estimated.";

const Cost = z.object({
  /** Null: not measured and not declared. Never 0, which would mean the run is free. */
  estimatedCredits: z.number().int().min(0).nullable(),
  /** Why `estimatedCredits` is null; null when a cost is given. */
  estimatedCreditsReason: z.string().nullable(),
});

export const estimateRoutes =
  (services: () => Services): FastifyPluginAsyncZod =>
  (app) => {
    app.post(
      "/api/v1/estimates",
      {
        config: { access: { permission: "run:start", action: "run.estimate" } },
        schema: {
          operationId: "estimateRun",
          summary: "Before a run: what a target is, what would run, and what it would cost",
          description:
            "Plans the run exactly as starting it would, but starts nothing and calls no source. Collectors the plan excludes are listed with their reasons. No collector declares a credit cost yet, so every estimate is null with the reason stated.",
          tags: ["runs"],
          security: SECURITY,
          body: z.object({
            target: z.string().trim().min(1).max(500),
            /** The type the analyst chose; omit to let detection decide. */
            targetType: TargetType.optional(),
          }),
          response: {
            200: z
              .object({
                input: z.string(),
                requestedType: TargetType.nullable(),
                /** Detection's answer; null when the analyst chose the type. */
                detectedType: TargetType.nullable(),
                /** Other types the input may be; empty when it is unambiguous or a type was chosen. */
                alternateTypes: z.array(TargetType),
                /** Each candidate type with its normalised value, or why the input is not that type. */
                targets: z.array(
                  z.object({
                    type: TargetType,
                    value: z.string().nullable(),
                    invalid: z.string().nullable(),
                  }),
                ),
                collectors: z.array(
                  z
                    .object({
                      collectorId: z.string(),
                      sourceLabel: z.string(),
                      targetType: TargetType,
                      /** Vault ids it may use, and whether it runs without any. */
                      credentials: z.object({
                        vaultIds: z.array(z.string()),
                        runsWithout: z.boolean(),
                      }),
                    })
                    .extend(Cost.shape),
                ),
                excluded: z.array(
                  z.object({
                    collectorId: z.string(),
                    sourceLabel: z.string(),
                    targetType: TargetType.nullable(),
                    reason: z.string(),
                    message: z.string(),
                  }),
                ),
                total: Cost,
              })
              .describe("The plan a run would follow."),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const { repos, tenant } = tenantOf(request);
        const { planner, registry } = services().runs;
        let plan;
        try {
          plan = await planRun(planner, {
            input: request.body.target,
            requestedType: request.body.targetType ?? null,
            entitlement: { plan: tenant.plan, vettingStatus: tenant.vettingStatus },
            scopeFor: async (target) => {
              const row = await repos.scopeAuthorisations.findInForce(target.type, target.value);
              return row === null
                ? null
                : { id: row.id, targetType: row.targetType, target: row.target };
            },
          });
        } catch (error) {
          if (error instanceof EmptyTargetError) {
            throw new HttpError(400, error.code, error.message);
          }
          throw error;
        }
        const labelOf = (collectorId: string): string => {
          const entry = registry.list().find((candidate) => candidate.id === collectorId);
          if (entry === undefined) throw notFound(`The collector ${collectorId}`);
          return entry.label;
        };
        return {
          input: plan.input,
          requestedType: plan.requestedType,
          detectedType: plan.detected === null ? null : plan.detected.primaryType,
          alternateTypes: plan.detected === null ? [] : [...plan.detected.alternateTypes],
          targets: plan.targets.map((target) =>
            "invalid" in target
              ? { type: target.type, value: null, invalid: target.invalid }
              : { type: target.type, value: target.value, invalid: null },
          ),
          collectors: plan.jobs.map((job) => {
            const entry = registry.entry(job.collectorId);
            return {
              collectorId: job.collectorId,
              sourceLabel: labelOf(job.collectorId),
              targetType: job.target.type,
              credentials: {
                vaultIds: [...entry.credentials.vaultIds],
                runsWithout: entry.credentials.runsWithout,
              },
              estimatedCredits: null,
              estimatedCreditsReason: NO_COST_REASON,
            };
          }),
          excluded: plan.excluded.map((row) => ({
            collectorId: row.collectorId,
            sourceLabel: labelOf(row.collectorId),
            targetType: row.targetType,
            reason: row.reason,
            message: row.message,
          })),
          total: { estimatedCredits: null, estimatedCreditsReason: NO_TOTAL_COST_REASON },
        };
      },
    );
    return Promise.resolve();
  };
