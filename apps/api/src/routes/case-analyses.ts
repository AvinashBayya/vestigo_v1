import { CASE_ANALYSIS_STATUSES } from "@repo/core";
import {
  analysisProbe,
  analysisRecord,
  CASE_ANALYSIS_READ_STATES,
  CaseAnalysisDocumentSchema,
  caseProbe,
  CaseWordingSchema,
  currentInput,
  latestAnalysis,
  readView,
  requestCaseAnalysis,
  type CaseAnalysisReadView,
} from "@repo/osint-engine";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { afterCommit, tenantOf, type RequestTenant } from "../http/access.ts";
import { HttpError, notFound, ProblemSchema } from "../http/errors.ts";
import { requirePersonAccess } from "../http/person-gate.ts";
import type { Services } from "../services.ts";
import {
  iso,
  IdParams,
  isoOrNull,
  optionalInstant,
  PROTECTED_ERRORS,
  SECURITY,
} from "./schemas.ts";

const CaseAnalysisView = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  /** `sha256:<hex>` of everything the analysis reads: the same input is one analysis. */
  inputHash: z.string(),
  engineVersion: z.number().int().min(1),
  /** Who first requested it: the user, or an API key's issuer. */
  requestedByUserId: z.uuid().nullable(),
  requestedAt: z.iso.datetime(),
  /** The latest attempt: 1, then one more each time a failed analysis is requested again. */
  attempt: z.number().int().min(1),
  status: z.enum(CASE_ANALYSIS_STATUSES),
  attemptRequestedAt: z.iso.datetime(),
  /** When the latest attempt finished; null while it has not. */
  finishedAt: optionalInstant,
  /** Why the latest attempt failed; null unless it did. */
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  /** case-engine's documents; present only when COMPLETE. */
  document: CaseAnalysisDocumentSchema.nullable(),
  /** The wording the document was produced under; present only when COMPLETE. */
  wording: CaseWordingSchema.nullable(),
});

const CaseAnalysisRead = z
  .object({
    state: z.enum(CASE_ANALYSIS_READ_STATES),
    /** Why it is in this state, in words. No state claims progress it did not measure. */
    reason: z.string(),
    caseId: z.uuid(),
    /** The hash of the case's input as it is now: STALE when the analysis's differs. */
    currentInputHash: z.string(),
    /** Null only when NONE_YET. */
    analysis: CaseAnalysisView.nullable(),
  })
  .meta({ id: "CaseAnalysisRead" });

const CaseAnalysisRequested = CaseAnalysisRead.extend({
  /** Null: no credit cost is declared for a case analysis, and none is charged. */
  estimatedCredits: z.number().int().min(0).nullable(),
  /** Why `estimatedCredits` is null; null when a cost is given. */
  estimatedCreditsReason: z.string().nullable(),
}).meta({ id: "CaseAnalysisRequested" });

const NO_COST_REASON = "No credit cost is declared for a case analysis, so none is estimated.";

const CONFLICT = { 409: ProblemSchema } as const;

const view = (read: CaseAnalysisReadView): z.infer<typeof CaseAnalysisRead> => {
  const record = read.analysis;
  return {
    state: read.state,
    reason: read.reason,
    caseId: read.caseId,
    currentInputHash: read.currentInputHash,
    analysis:
      record === null
        ? null
        : {
            id: record.analysis.id,
            caseId: record.analysis.caseId,
            inputHash: record.analysis.inputHash,
            engineVersion: record.analysis.engineVersion,
            requestedByUserId: record.analysis.requestedByUserId,
            requestedAt: iso(record.analysis.requestedAt),
            attempt: record.attempt,
            status: record.status,
            attemptRequestedAt: iso(record.attemptRequestedAt),
            finishedAt: isoOrNull(record.finishedAt),
            error: record.error,
            document: record.document,
            wording: record.wording,
          },
  };
};

const userOf = (context: RequestTenant): string | null =>
  context.principal.kind === "session" ? context.principal.userId : context.principal.issuerUserId;

/** Every case-analysis read and its probe run on one snapshot (D-32). */
const WITHHELD = {
  request: "A new analysis of this case, and where any earlier analysis of it stands.",
  latest: "This case's analysis: its state, its documents and where it stands.",
  one: "This case analysis: its state, its documents and where it stands.",
} as const;

export const caseAnalysisRoutes =
  (services: () => Services): FastifyPluginAsyncZod =>
  (app) => {
    app.post(
      "/api/v1/cases/:id/analyses",
      {
        config: {
          access: { permission: "case:analyse", action: "case.analyse", snapshot: true },
        },
        schema: {
          operationId: "requestCaseAnalysis",
          summary: "Request an analysis of a case as it is now, made in the background",
          description:
            "Reads the case's stored records, hashes them, and returns the analysis of exactly that input: 202 with a new one (or a new attempt at one that failed), 200 with the existing one when it is pending or complete. Nothing is collected. Refused whole (403 with a `locked` block) when the case rests on person-investigation data the organisation cannot access, a run whose person collector found nothing included; 409 CASE_TOO_LARGE past the size one analysis reads; 409 when a concurrent request for the same analysis won.",
          tags: ["cases"],
          security: SECURITY,
          params: IdParams,
          response: {
            200: CaseAnalysisRequested,
            202: CaseAnalysisRequested,
            ...PROTECTED_ERRORS,
            ...CONFLICT,
          },
        },
      },
      async (request, reply) => {
        const context = tenantOf(request);
        const { repos, reads } = context;
        const caseId = request.params.id;
        if ((await repos.cases.findById(caseId)) === null) throw notFound("The case");
        await requirePersonAccess(
          context,
          caseProbe(caseId, await reads.caseScope.runIds(caseId)),
          WITHHELD.request,
        );
        const { runs } = services();
        const requested = await requestCaseAnalysis(context, {
          caseId,
          collectors: runs.caseAnalysisCollectors,
          requestedByUserId: userOf(context),
          at: new Date(),
        });
        const { analysis } = requested.record;
        request.auditTarget = { type: "case_analysis", id: analysis.id };
        const body = {
          ...view(readView(caseId, requested.currentInputHash, requested.record)),
          estimatedCredits: null,
          estimatedCreditsReason: NO_COST_REASON,
        };
        const status = requested.kind === "EXISTING" ? 200 : 202;
        if (!requested.enqueue) {
          void reply.code(status);
          return body;
        }
        // Enqueued once the request is committed, so the worker always finds
        // it. Enqueueing is idempotent per attempt: a pending analysis whose
        // enqueue was lost is resumed by requesting it again.
        const { tenantId } = context;
        const attempt = requested.record.attempt;
        afterCommit(request, async () => {
          try {
            await runs.caseAnalyses.enqueueAnalysis(tenantId, analysis.id, attempt);
          } catch {
            throw new HttpError(
              503,
              "QUEUE_UNAVAILABLE",
              "The analysis is recorded, but the job queue could not take it. Request it again to resume it.",
            );
          }
          void reply.code(status);
          return body;
        });
        return;
      },
    );

    app.get(
      "/api/v1/cases/:id/analyses",
      {
        config: {
          access: { permission: "case:read", action: "case.read_analysis", snapshot: true },
        },
        schema: {
          operationId: "getLatestCaseAnalysis",
          summary: "Read where a case's analysis stands, and whether it is still current",
          description:
            "The analysis of the case as it is now when there is one, else the most recently requested one as STALE: NONE_YET, PENDING, COMPLETE, FAILED (with its code) or STALE, each with a reason. Refused whole (403 with a `locked` block) when the case as it is now, or the records the shown analysis read, rest on person-investigation data the organisation cannot access.",
          tags: ["cases"],
          security: SECURITY,
          params: IdParams,
          response: { 200: CaseAnalysisRead, ...PROTECTED_ERRORS, ...CONFLICT },
        },
      },
      async (request) => {
        const context = tenantOf(request);
        const { repos, reads } = context;
        const caseId = request.params.id;
        request.auditTarget = { type: "case", id: caseId };
        if ((await repos.cases.findById(caseId)) === null) throw notFound("The case");
        // The case as it is now first, before any analysis is looked at.
        await requirePersonAccess(
          context,
          caseProbe(caseId, await reads.caseScope.runIds(caseId)),
          WITHHELD.latest,
        );
        const current = await currentInput(context, caseId, services().runs.caseAnalysisCollectors);
        const analysis = await latestAnalysis(context, caseId, current.inputHash);
        const record = analysis === null ? null : await analysisRecord(context, analysis);
        await requirePersonAccess(
          context,
          analysisProbe(caseId, current.runIds, record),
          WITHHELD.latest,
        );
        return view(readView(caseId, current.inputHash, record));
      },
    );

    app.get(
      "/api/v1/case-analyses/:id",
      {
        config: {
          access: { permission: "case:read", action: "case.read_analysis", snapshot: true },
        },
        schema: {
          operationId: "getCaseAnalysis",
          summary: "Read one case analysis, and whether it is still current",
          description:
            "PENDING, COMPLETE, FAILED (with its code), or STALE when the case's input has changed since it was requested. Refused whole (403 with a `locked` block) when its case as it is now, or the records it read, rest on person-investigation data the organisation cannot access.",
          tags: ["cases"],
          security: SECURITY,
          params: IdParams,
          response: { 200: CaseAnalysisRead, ...PROTECTED_ERRORS, ...CONFLICT },
        },
      },
      async (request) => {
        const context = tenantOf(request);
        const { repos, reads } = context;
        request.auditTarget = { type: "case_analysis", id: request.params.id };
        const analysis = await repos.caseAnalyses.findById(request.params.id);
        if (analysis === null) throw notFound("The case analysis");
        const { caseId } = analysis;
        await requirePersonAccess(
          context,
          caseProbe(caseId, await reads.caseScope.runIds(caseId)),
          WITHHELD.one,
        );
        const current = await currentInput(context, caseId, services().runs.caseAnalysisCollectors);
        const record = await analysisRecord(context, analysis);
        await requirePersonAccess(
          context,
          analysisProbe(caseId, current.runIds, record),
          WITHHELD.one,
        );
        return view(readView(caseId, current.inputHash, record));
      },
    );
    return Promise.resolve();
  };
