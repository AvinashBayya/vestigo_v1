/**
 * Task-based routing (ARCHITECTURE-DECISIONS §7): a small, fast model for
 * extraction and classification, a larger one for synthesis. Which models
 * those are is configuration; which size a task needs is decided here.
 */
import type { LlmEndpoint, LlmModelRoute } from "@repo/config";

export const LLM_TASKS = ["extraction", "classification", "synthesis"] as const;
export type LlmTask = (typeof LLM_TASKS)[number];

export const TASK_SIZE: Readonly<Record<LlmTask, "SMALL" | "LARGE">> = {
  extraction: "SMALL",
  classification: "SMALL",
  synthesis: "LARGE",
};

export function modelFor(
  endpoint: Pick<LlmEndpoint, "small" | "large">,
  task: LlmTask,
): LlmModelRoute {
  return TASK_SIZE[task] === "SMALL" ? endpoint.small : endpoint.large;
}
