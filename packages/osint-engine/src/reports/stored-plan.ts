/**
 * A run's plan as stored (runs.plan): the plan the run recorded, the error it
 * recorded instead, or nothing. Read by the run report and by a case's
 * analysis, so both read a run's recorded plan the same way, never one
 * recomputed now. Moved from reports/assemble.ts unchanged.
 */
import type { CoveragePlan } from "@repo/case-engine";
import type { TargetType } from "@repo/core";
import { z } from "zod";

export const StoredPlan = z.looseObject({
  targets: z.array(
    z.union([
      z.object({ type: z.string(), value: z.string() }),
      z.object({ type: z.string(), invalid: z.string() }),
    ]),
  ),
  excluded: z.array(
    z.object({
      collectorId: z.string(),
      targetType: z.string().nullable(),
      reason: z.string(),
      message: z.string(),
    }),
  ),
});
export const StoredPlanError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/** The run's stored plan, as coverage reads it: the plan, its recorded error, or nothing. */
export function coveragePlan(plan: unknown): CoveragePlan {
  const failed = StoredPlanError.safeParse(plan);
  if (failed.success) return { kind: "PLAN_FAILED", message: failed.data.error.message };
  const parsed = StoredPlan.safeParse(plan);
  if (!parsed.success) return { kind: "NOT_RECORDED" };
  return {
    kind: "PLANNED",
    targetTypes: parsed.data.targets
      .filter((t): t is { type: string; value: string } => "value" in t)
      .map((t) => t.type as TargetType),
    excluded: parsed.data.excluded.map((excluded) => ({
      collectorId: excluded.collectorId,
      targetType: excluded.targetType as TargetType | null,
      reason: excluded.reason,
      message: excluded.message,
    })),
  };
}
