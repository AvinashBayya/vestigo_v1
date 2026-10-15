import { detectTargetType, EmptyTargetError, type TargetType } from "@repo/core";
import {
  decideDisciplineAccess,
  type ModuleDecision,
  type TenantEntitlement,
} from "./entitlements.ts";

/**
 * Target types that are person data whatever collects them (CLAUDE.md §9;
 * Track M D-M1, ruled 2026-10-15). A TOPIC is free text, a phrase or a
 * hashtag, and is as easily a person's name as a subject. No detector can tell
 * the two apart (a name reads like any other words), so none is tried: the type
 * alone decides, and it fails closed. Additive only. The database's own checks
 * on runs and jobs name the same types (packages/db migrations 0025 and 0026),
 * and a database test keeps them in step with this list.
 */
export const PERSON_TARGET_TYPES: readonly TargetType[] = ["TOPIC"];

/** Whether a target of this type is person data, whichever collector reads it. */
export function targetRestsOnPersonData(type: TargetType): boolean {
  return PERSON_TARGET_TYPES.includes(type);
}

/**
 * The target types a run of this input plans for, in order of preference: the
 * type the analyst chose, or else detection's answer and its alternates. A
 * person target type is planned only when it was chosen or detected first,
 * never as an alternate, so an ordinary search never turns into person data
 * unasked: "[two words]" is planned as an organisation's name, and is a topic
 * only when the analyst says so. The alternate is still reported by detection.
 * Throws EmptyTargetError when detection has nothing to read.
 */
export function plannedTargetTypes(
  input: string,
  requestedType: TargetType | null,
): readonly TargetType[] {
  if (requestedType !== null) return [requestedType];
  const detected = detectTargetType(input);
  return [
    detected.primaryType,
    ...detected.alternateTypes.filter((type) => !targetRestsOnPersonData(type)),
  ];
}

/**
 * Whether a run of this input rests on person data by its target alone, before
 * any collector is chosen: it plans a person target type. Recorded on the run
 * when it is created (runs.person_bearing), and read by the person-data probe.
 * An empty input plans nothing, so it rests on nothing.
 */
export function runRestsOnPersonTarget(input: string, requestedType: TargetType | null): boolean {
  try {
    return plannedTargetTypes(input, requestedType).some(targetRestsOnPersonData);
  } catch (error) {
    if (error instanceof EmptyTargetError) return false;
    throw error;
  }
}

/**
 * Whether a tenant may collect on a target of this type. A person target type
 * needs what a PERSON collector needs, the plan AND approved vetting, whatever
 * the collector's own discipline: a news search for a person's name is a person
 * search. Any other type adds no condition; the collector's discipline still
 * applies (decideDisciplineAccess).
 */
export function decideTargetAccess(tenant: TenantEntitlement, type: TargetType): ModuleDecision {
  return targetRestsOnPersonData(type)
    ? decideDisciplineAccess(tenant, "PERSON")
    : { allowed: true };
}
