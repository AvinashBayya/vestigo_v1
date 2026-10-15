import type { CollectorStatus } from "@repo/ui";
import type { paths } from "../client/index.ts";
import { runsHere, type CollectorList } from "../collectors.ts";

/** What POST /api/v1/estimates answers: the plan a run would follow. */
export type Estimate =
  paths["/api/v1/estimates"]["post"]["responses"][200]["content"]["application/json"];
export type TargetType = Estimate["targets"][number]["type"];
export type PlannedCollector = Estimate["collectors"][number];
export type ExcludedCollector = Estimate["excluded"][number];

/** A target type in words. */
export const TYPE_LABEL: Readonly<Record<TargetType, string>> = {
  DOMAIN: "Domain",
  IP_ADDRESS: "IP address",
  EMAIL_ADDRESS: "Email address",
  PHONE_NUMBER: "Phone number",
  USERNAME: "Username",
  ORGANIZATION: "Organisation",
  URL: "URL",
  FILE: "File",
  TOPIC: "Topic",
};

/** Registered but not enabled for this deployment (§3 Held). */
const HELD_REASONS = new Set([
  "LICENCE_BLOCKED",
  "UNVERIFIED_SOURCE_NOT_ALLOWED",
  "NOT_IMPLEMENTED",
]);
/** Policy or plan prevents it (§3 Skipped). */
const SKIPPED_REASONS = new Set([
  "MODULE_NOT_IN_PLAN",
  "VETTING_NOT_APPROVED",
  "SCOPE_AUTHORISATION_REQUIRED",
]);
/** The collector does not take any type this target could be: not a status, just not relevant. */
export const NOT_APPLICABLE_REASON = "TARGET_TYPE_NOT_ACCEPTED";

/**
 * The §3 status of a collector the plan leaves out. Any other reason is the
 * admission check failing (an invalid target, say), shown as Failed with the
 * API's own message.
 */
export function exclusionStatus(reason: string): CollectorStatus {
  if (HELD_REASONS.has(reason)) return "HELD";
  if (SKIPPED_REASONS.has(reason)) return "SKIPPED";
  return "FAILED";
}

/** The types the analyst can choose between: detection's answer first, then its alternates. */
export function typeOptions(estimate: Estimate): TargetType[] {
  if (estimate.detectedType === null) return [];
  return [estimate.detectedType, ...estimate.alternateTypes];
}

type Cost = Pick<PlannedCollector, "estimatedCredits" | "estimatedCreditsReason">;

/**
 * Why a cost is not given, as the API stated it. The API always states one;
 * if it ever did not, the page says exactly that rather than inventing one.
 */
export function unmeasuredReason(cost: Cost): string {
  if (cost.estimatedCreditsReason !== null) return cost.estimatedCreditsReason;
  return "No estimate was given, and the server did not say why.";
}

/** A measured credit count in words. */
export function creditsText(credits: number): string {
  return credits === 1 ? "1 credit" : `${String(credits)} credits`;
}

/**
 * The kinds of target some source that runs here takes, in TYPE_LABEL order.
 * FILE is never offered: nothing can upload a file to investigate yet.
 */
export function acceptedTypes(list: CollectorList): TargetType[] {
  const taken = new Set<string>(
    list.items.filter((item) => runsHere(item, list)).flatMap((item) => item.targetTypes),
  );
  return (Object.keys(TYPE_LABEL) as TargetType[]).filter(
    (type) => type !== "FILE" && taken.has(type),
  );
}
