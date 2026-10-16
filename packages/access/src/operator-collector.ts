import type { CollectorDiscipline } from "@repo/core";
import { DISCIPLINE_MODULE } from "./entitlements.ts";

/**
 * Whether a collector reached through the operator access method (an
 * operator's own collector, attached to the platform, with credentials the
 * operator supplies) may be registered under this discipline: only the person
 * discipline.
 *
 * Such a collector reads, through someone's own account, a service the
 * platform has not reviewed, so it may read people whatever it says it reads.
 * It therefore counts as person data, fail closed (CLAUDE.md §9): collecting
 * with it needs the person investigation module and approved vetting, through
 * the discipline gate at dispatch, and so does reading what it collected,
 * because the person-data probe reads the collector's discipline.
 */
export function disciplineFitsOperatorCollector(discipline: CollectorDiscipline): boolean {
  return DISCIPLINE_MODULE[discipline] === "PERSON_INVESTIGATION";
}
