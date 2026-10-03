import type { ReadScope, Repositories } from "@repo/db";
import { z } from "zod";
import { HttpError, notFound } from "../http/errors.ts";

/**
 * What a read is about: one case or one run, never neither and never both. A
 * case holds what is pinned to it; a run holds what it collected.
 */
export const ScopeQuery = z
  .object({
    caseId: z.uuid().optional().describe("Read what is pinned to this case."),
    runId: z.uuid().optional().describe("Read what this run collected."),
  })
  .refine((query) => (query.caseId === undefined) !== (query.runId === undefined), {
    message: "Give exactly one of caseId or runId.",
  });

/**
 * The scope the query names, once it is known to exist in this tenant. An
 * unknown case or run is a 404, not an empty result: an empty list would read
 * as "nothing was found".
 */
export async function resolveScope(
  repos: Repositories,
  query: { readonly caseId?: string | undefined; readonly runId?: string | undefined },
): Promise<ReadScope> {
  if (query.caseId !== undefined) {
    if ((await repos.cases.findById(query.caseId)) === null) throw notFound("The case");
    return { caseId: query.caseId };
  }
  if (query.runId !== undefined) {
    if ((await repos.runs.findById(query.runId)) === null) throw notFound("The run");
    return { runId: query.runId };
  }
  // Unreachable through ScopeQuery; a caller that skipped it gets a clear failure.
  throw new HttpError(400, "SCOPE_REQUIRED", "Give exactly one of caseId or runId.");
}
