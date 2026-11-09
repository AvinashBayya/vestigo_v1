/**
 * Query planning: from an investigation's raw target to the collector jobs a
 * run will dispatch, and the collectors it will not, each with its reason.
 *
 * Ported from the previous codebase's planner (legacy
 * src/utils/osint/query-planner.ts, INVENTORY verdict KEEP), onto the
 * registry and the runtime's admission. Target detection lives in
 * @repo/core. What changes from legacy:
 *   - Every exclusion is recorded with its reason. Legacy's `excluded` list
 *     was always empty, so a collector that could not run was simply absent.
 *   - Admission is the runtime's own: licence, target type and validity, plan
 *     and vetting (through @repo/access), and a scope authorisation for an
 *     ACTIVE collector. The API and the workers apply the same rules.
 *   - A candidate type whose value does not parse as that type is dropped
 *     with its reason, never passed to a collector.
 *   - A person target type (a TOPIC) is planned only when it was chosen or
 *     detected first (plannedTargetTypes, @repo/access), and only for a tenant
 *     whose plan and vetting allow person data: the runtime refuses it as it
 *     refuses a PERSON collector.
 */
import {
  InvalidTargetError,
  parseTarget,
  type Admission,
  type CollectorRuntime,
  type ScopeClearance,
} from "@repo/collectors";
import { detectTargetType, type DetectedTarget, type TargetType } from "@repo/core";
import { plannedTargetTypes, type TenantEntitlement } from "@repo/access";

export interface PlannedJob {
  readonly collectorId: string;
  readonly target: { readonly type: TargetType; readonly value: string };
}

export interface ExcludedCollector {
  readonly collectorId: string;
  /** The target type it was considered for; null when no type applied. */
  readonly targetType: TargetType | null;
  /** Machine-readable: the runtime's refusal reason, or TARGET_TYPE_NOT_ACCEPTED. */
  readonly reason: string;
  readonly message: string;
}

export interface RunPlan {
  readonly input: string;
  /** The type the analyst chose, or null when detection chose. */
  readonly requestedType: TargetType | null;
  /** Detection's answer; null when the analyst chose the type. */
  readonly detected: DetectedTarget | null;
  /** Each candidate type, with the normalised value or why the input is not one. */
  readonly targets: readonly (
    | { readonly type: TargetType; readonly value: string }
    | { readonly type: TargetType; readonly invalid: string }
  )[];
  readonly jobs: readonly PlannedJob[];
  readonly excluded: readonly ExcludedCollector[];
  /**
   * Types detection offered that the run did not plan, each with why: a
   * person target type (a TOPIC) that was only an alternate. So the plan says
   * what it did not cover, and a reading shown as an alternate is never taken
   * for one that ran. Absent from plans recorded before Day 1.
   */
  readonly notPlanned: readonly NotPlannedType[];
}

/** A detected type the run did not plan, and why. */
export interface NotPlannedType {
  readonly type: TargetType;
  readonly reason: typeof NOT_PLANNED_UNLESS_CHOSEN;
  readonly message: string;
}

export const NOT_PLANNED_UNLESS_CHOSEN = "NOT_PLANNED_UNLESS_CHOSEN";

/** A source the analyst did not choose for this run (the general source filter). */
export const NOT_SELECTED = "NOT_SELECTED";

export interface PlanRequest {
  readonly input: string;
  readonly requestedType: TargetType | null;
  readonly entitlement: TenantEntitlement;
  /** The scope authorisation in force for an exact target, for ACTIVE collectors. */
  readonly scopeFor: (target: {
    readonly type: TargetType;
    readonly value: string;
  }) => Promise<ScopeClearance | null>;
  /**
   * The collector ids the analyst chose to run (the source filter). Null or
   * absent runs every source that is otherwise admitted, as before. A source
   * that would have run but was not chosen is excluded with NOT_SELECTED, so
   * the plan records exactly what the choice left out. A chosen id that cannot
   * run anyway is still excluded with its real reason, never NOT_SELECTED.
   */
  readonly selectedCollectorIds?: readonly string[] | null;
}

/**
 * Plans a run. Throws EmptyTargetError for an empty input; every other
 * problem is recorded in the plan, never thrown away.
 */
export async function planRun(runtime: CollectorRuntime, request: PlanRequest): Promise<RunPlan> {
  const detected = request.requestedType === null ? detectTargetType(request.input) : null;
  // The same types the run was recorded as resting on when it was created
  // (runRestsOnPersonTarget): a person target type that detection offers only
  // as an alternate is not planned; it stays in `detected` for the analyst to choose.
  const candidateTypes = plannedTargetTypes(request.input, request.requestedType);
  const notPlanned: NotPlannedType[] = (detected?.alternateTypes ?? [])
    .filter((type) => !candidateTypes.includes(type))
    .map((type) => ({
      type,
      reason: NOT_PLANNED_UNLESS_CHOSEN,
      message: `Not planned unless chosen: the input may be a ${type} only as an alternate reading, and a ${type} may name a person, so it is person data whatever collects it.`,
    }));

  const targets: RunPlan["targets"][number][] = [];
  const valid: { readonly type: TargetType; readonly value: string }[] = [];
  for (const type of candidateTypes) {
    try {
      const target = parseTarget(type, request.input);
      targets.push({ type, value: target.value });
      valid.push({ type, value: target.value });
    } catch (error) {
      if (!(error instanceof InvalidTargetError)) throw error;
      targets.push({ type, invalid: error.message });
    }
  }

  const jobs: PlannedJob[] = [];
  const excluded: ExcludedCollector[] = [];
  for (const entry of runtime.registry.list()) {
    const accepted = valid.filter((target) => entry.targetTypes.includes(target.type));
    if (accepted.length === 0) {
      excluded.push({
        collectorId: entry.id,
        targetType: null,
        reason: "TARGET_TYPE_NOT_ACCEPTED",
        message: `It accepts ${entry.targetTypes.join(", ")}; the target is ${
          valid.map((target) => target.type).join(" or ") || "no valid type"
        }.`,
      });
      continue;
    }
    // A collector runs once per run: on the first candidate type it accepts,
    // in detection's order of preference.
    const [target] = accepted;
    if (target === undefined) continue;
    const admission: Admission = {
      target,
      entitlement: request.entitlement,
      scopeAuthorisation: entry.collectionMode === "ACTIVE" ? await request.scopeFor(target) : null,
    };
    const rejection = runtime.admit(entry.id, admission);
    if (rejection !== null) {
      excluded.push({
        collectorId: entry.id,
        targetType: target.type,
        reason: rejection.status === "REFUSED" ? rejection.reason : rejection.error.code,
        message: rejection.status === "REFUSED" ? rejection.message : rejection.error.message,
      });
      continue;
    }
    // The source filter is the last gate: a source that would run but was not
    // chosen is recorded as not selected, so the plan shows what the choice
    // left out. A null or absent selection runs every admitted source.
    if (request.selectedCollectorIds != null && !request.selectedCollectorIds.includes(entry.id)) {
      excluded.push({
        collectorId: entry.id,
        targetType: target.type,
        reason: NOT_SELECTED,
        message: "Not selected: this source was not chosen to run for this investigation.",
      });
      continue;
    }
    jobs.push({ collectorId: entry.id, target });
  }

  return {
    input: request.input,
    requestedType: request.requestedType,
    detected,
    targets,
    jobs,
    excluded,
    notPlanned,
  };
}
