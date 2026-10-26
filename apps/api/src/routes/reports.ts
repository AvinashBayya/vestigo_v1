import {
  CLAIM_STRENGTHS,
  COVERAGE_STATES,
  ENTITY_KINDS,
  REPORT_FORMAT_VERSION,
  REPORT_PDF_STATUSES,
  REPORT_STATUSES,
  RUN_STATUSES,
  SYNTHESIS_STRENGTHS,
  TARGET_TYPES,
  type ReportDocument,
} from "@repo/core";
import type { Report, ReportPdf } from "@repo/db";
import { REPORT_EXPORT_FORMAT_NAMES, REPORT_EXPORT_FORMATS } from "@repo/integrations";
import { readRunProgress, usageSummary } from "@repo/osint-engine";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { afterCommit, tenantOf } from "../http/access.ts";
import { HttpError, notFound, ProblemSchema } from "../http/errors.ts";
import { requirePersonAccess } from "../http/person-gate.ts";
import type { Services } from "../services.ts";
import {
  iso,
  IdParams,
  isoOrNull,
  LimitQuery,
  optionalInstant,
  page,
  PROTECTED_ERRORS,
  SECURITY,
} from "./schemas.ts";

// ── The report document, as the API serves it (ReportDocument in @repo/core) ──

const Strength = z.enum(CLAIM_STRENGTHS);
const Endpoint = z.object({
  entityId: z.uuid(),
  kind: z.enum(ENTITY_KINDS),
  displayName: z.string(),
  identifier: z.string().nullable(),
});

const text = z.string();
const ReportWordingSchema = z.object({
  glossary: z.array(z.object({ strength: Strength, definition: text })),
  headings: z.object({
    coverage: text,
    notCollected: text,
    collected: text,
    standingLimits: text,
    glossary: text,
    synthesis: text,
    findings: text,
    relationships: text,
    untrustedContent: text,
    evidenceBasis: text,
    attribution: text,
    renderingNote: text,
  }),
  cover: z.object({ target: text, collectedAs: text, run: text, runValue: text, generated: text }),
  marking: z.object({ set: text, notSet: text }),
  footer: z.object({ report: text, page: text }),
  // Partial: a report keeps its wording, so one stored before a state existed
  // (EMPTY_UNCONFIRMED, Track M Day 2) has no label for it, and no entry in it.
  states: z.partialRecord(z.enum(COVERAGE_STATES), text),
  coverage: z.object({
    allCollected: text,
    noneCollected: text,
    notApplicable: text,
    evidenceItems: text,
    attempts: text,
    omittedClaims: text,
  }),
  synthesis: z.object({
    model: text,
    servedBy: text,
    servedByEndpoint: text,
    regionHeader: text,
    notRequested: text,
    none: text,
  }),
  findings: z.object({ none: text, emptyValue: text, shortened: text }),
  untrustedContent: z.object({ intro: text, line: text }),
  evidence: z.object({
    intro: text,
    none: text,
    columns: z.object({
      number: text,
      source: text,
      collected: text,
      strength: text,
      claims: text,
    }),
    notRecorded: text,
    detail: text,
    noUrl: text,
  }),
  footnote: z.object({
    line: text,
    collectedAt: text,
    collectedUnknown: text,
    noUrl: text,
    missing: text,
  }),
  attribution: z.object({ none: text }),
  renderingNote: text,
  tabular: z.object({ markingNotSet: text, notRecorded: text }),
});

const ReportDocumentSchema = z.object({
  formatVersion: z.literal(REPORT_FORMAT_VERSION),
  reportId: z.uuid(),
  title: z.string(),
  investigationId: z.uuid(),
  runId: z.uuid(),
  target: z.object({
    input: z.string(),
    types: z.array(z.object({ type: z.enum(TARGET_TYPES), value: z.string() })),
  }),
  run: z.object({
    status: z.enum(RUN_STATUSES),
    startedAt: optionalInstant,
    finishedAt: optionalInstant,
  }),
  generatedAt: z.iso.datetime(),
  /** The tenant's marking, or the platform's; null when neither is set. */
  handlingMarking: z.string().nullable(),
  coverage: z.object({
    runStatus: z.enum(RUN_STATUSES),
    /** True unless every planned collector completed. */
    partial: z.boolean(),
    headline: z.string(),
    entries: z.array(
      z.object({
        collectorId: z.string(),
        sourceLabel: z.string(),
        state: z.enum(COVERAGE_STATES),
        targetType: z.enum(TARGET_TYPES).nullable(),
        reasonCode: z.string().nullable(),
        detail: z.string().nullable(),
        evidenceCount: z.number().int().min(0),
        /** Null when no job existed (excluded or held). */
        attempts: z.number().int().min(0).nullable(),
      }),
    ),
    notApplicable: z.array(z.object({ collectorId: z.string(), sourceLabel: z.string() })),
    caveats: z.array(z.string()),
  }),
  findings: z.array(
    z.object({
      entityId: z.uuid(),
      kind: z.enum(ENTITY_KINDS),
      displayName: z.string(),
      identifier: z.string().nullable(),
      claims: z.array(
        z.object({
          claimId: z.uuid(),
          attribute: z.string(),
          /** The value exactly as stored. */
          value: z.unknown(),
          display: z.object({ text: z.string(), truncated: z.boolean() }),
          strength: Strength,
          citations: z.array(z.number().int().min(1)),
        }),
      ),
    }),
  ),
  relationships: z.array(
    z.object({
      relationshipId: z.uuid(),
      from: Endpoint,
      kind: z.string(),
      to: Endpoint,
      strength: Strength,
      citations: z.array(z.number().int().min(1)),
    }),
  ),
  sources: z.array(
    z.object({
      number: z.number().int().min(1),
      evidenceId: z.uuid(),
      collectorId: z.string(),
      sourceLabel: z.string(),
      sourceUrl: z.string().nullable(),
      collectedAt: optionalInstant,
      observedAt: optionalInstant,
      contentHash: z.string(),
      strength: Strength,
      claimCount: z.number().int().min(0),
    }),
  ),
  synthesis: z.union([
    z.object({
      status: z.literal("GENERATED"),
      model: z.object({
        id: z.string(),
        licence: z.string(),
        profile: z.string(),
        endpointHost: z.string().meta({
          description:
            "The host of the configured model endpoint the request was sent to (e.g. api.groq.com), from configuration.",
        }),
        servedBy: z.string().nullable().meta({
          description:
            "The upstream inference provider that produced the synthesis, as the endpoint named it. A routing endpoint may send each request to a different third party, under its own terms and region. Null: the endpoint named none; it is then known only that the request went to endpointHost.",
        }),
        regionHeaders: z.array(z.object({ name: z.string(), value: z.string() })).meta({
          description:
            "Every region header the endpoint's response carried, exactly as received and never interpreted. Evidence of what the endpoint said, not a guarantee of where the request was processed. Empty when none was carried.",
        }),
      }),
      statements: z.array(
        z.object({
          text: z.string(),
          strength: z.enum(SYNTHESIS_STRENGTHS),
          citations: z.array(z.number().int().min(1)).min(1),
        }),
      ),
      generatedAt: z.iso.datetime(),
      attempts: z.number().int().min(1),
      notice: z.string(),
    }),
    z.object({ status: z.literal("NOT_REQUESTED") }),
    z.object({ status: z.literal("SKIPPED"), reason: z.string() }),
  ]),
  attributions: z.array(
    z.object({
      sourceId: z.string(),
      text: z.string(),
      url: z.string(),
      collectorIds: z.array(z.string()),
    }),
  ),
  untrustedContent: z.array(
    z.object({ sourceNumber: z.number().int().min(1), patterns: z.array(z.string()) }),
  ),
  omittedClaims: z.number().int().min(0),
  /** Every fixed word the renderers print, as it stood when the report was generated. */
  wording: ReportWordingSchema,
  /** The product that generated the report. */
  producedBy: z.string(),
}) satisfies z.ZodType<ReportDocument>;

const ReportView = z.object({
  id: z.uuid(),
  runId: z.uuid(),
  status: z.enum(REPORT_STATUSES),
  includeSynthesis: z.boolean(),
  attempts: z.number().int().min(0),
  /** Why generation failed, or why the last attempt is being retried; null otherwise. */
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  startedAt: optionalInstant,
  finishedAt: optionalInstant,
  /** The report itself; present only when SUCCEEDED. */
  document: ReportDocumentSchema.nullable(),
  pdf: z
    .object({
      status: z.enum(REPORT_PDF_STATUSES),
      /** The stored file's size, once READY. */
      byteLength: z.number().int().min(1).nullable(),
      /** The stored file's hash (`sha256:<hex>`), once READY: every download is this file. */
      contentHash: z.string().nullable(),
      /** Why it could not be rendered, when FAILED. */
      error: z.object({ code: z.string(), message: z.string() }).nullable(),
    })
    .nullable()
    .meta({
      description:
        "The report's PDF, rendered once in the background from the stored document and stored. Null until the report has succeeded; a report generated before PDFs were stored has none until its PDF is first requested.",
    }),
});

function pdfView(pdf: ReportPdf | null): z.infer<typeof ReportView>["pdf"] {
  if (pdf === null) return null;
  return {
    status: pdf.status,
    byteLength: pdf.byteLength,
    contentHash: pdf.contentHash,
    error:
      pdf.errorCode === null || pdf.errorMessage === null
        ? null
        : { code: pdf.errorCode, message: pdf.errorMessage },
  };
}

function reportView(report: Report, pdf: ReportPdf | null): z.infer<typeof ReportView> {
  return {
    id: report.id,
    runId: report.runId,
    status: report.status,
    includeSynthesis: report.includeSynthesis,
    attempts: report.attempts,
    error:
      report.errorCode === null || report.errorMessage === null
        ? null
        : { code: report.errorCode, message: report.errorMessage },
    createdAt: iso(report.createdAt),
    startedAt: isoOrNull(report.startedAt),
    finishedAt: isoOrNull(report.finishedAt),
    // Validated on the way out, like every boundary (CLAUDE.md §7).
    document: report.document === null ? null : ReportDocumentSchema.parse(report.document),
    pdf: pdfView(pdf),
  };
}

const CONFLICT = { 409: ProblemSchema } as const;

/** How long a client waits before asking again for a PDF that is still rendering. */
const PDF_RETRY_AFTER_SECONDS = 5;

export const reportRoutes =
  (services: () => Services): FastifyPluginAsyncZod =>
  (app) => {
    app.post(
      "/api/v1/runs/:id/reports",
      {
        config: { access: { permission: "report:create", action: "report.create" } },
        schema: {
          operationId: "createReport",
          summary: "Generate a report from a settled run, in the background",
          description:
            "Returns at once with the QUEUED report. Refused with 409 RUN_NOT_SETTLED until the run has finished and every found result is fused, and with 409 SYNTHESIS_UNAVAILABLE when a synthesis is asked for and no model provider is configured. Every report states what was not collected and why; a synthesis, when asked for, is model-written, cited, and validated.",
          tags: ["reports"],
          security: SECURITY,
          params: IdParams,
          body: z.object({
            /** Ask a model to write a cited synthesis section. */
            synthesis: z.boolean(),
          }),
          response: { 202: ReportView, ...PROTECTED_ERRORS, ...CONFLICT },
        },
      },
      async (request, reply) => {
        const context = tenantOf(request);
        const { repos, principal } = context;
        const runs = services().runs;
        const progress = await readRunProgress(repos, request.params.id);
        if (progress === null) throw notFound("The run");
        // A run that used a person collector is person data, whatever its jobs found.
        await requirePersonAccess(
          context,
          { runJobs: progress.id },
          "A report on this run, generated from what its collectors found.",
        );
        if (!progress.settled) {
          throw new HttpError(
            409,
            "RUN_NOT_SETTLED",
            "The run has not finished, or is not fully fused yet.",
          );
        }
        if (request.body.synthesis && runs.synthesisUnavailable !== null) {
          throw new HttpError(409, "SYNTHESIS_UNAVAILABLE", runs.synthesisUnavailable);
        }
        if (request.body.synthesis) {
          for (const unit of ["LLM_INPUT_TOKEN", "LLM_OUTPUT_TOKEN"] as const) {
            if ((await usageSummary(repos, unit, new Date())).exceeded) {
              throw new HttpError(
                429,
                "QUOTA_EXCEEDED",
                "A model token quota for this tenant is spent.",
              );
            }
          }
        }
        const report = await repos.reports.create({
          runId: progress.id,
          includeSynthesis: request.body.synthesis,
          requestedByUserId: principal.kind === "session" ? principal.userId : null,
        });
        request.auditTarget = { type: "report", id: report.id };
        try {
          await runs.reports.enqueueReport(principal.tenantId, report.id);
        } catch {
          throw new HttpError(503, "QUEUE_UNAVAILABLE", "The job queue could not take the report.");
        }
        void reply.code(202);
        return reportView(report, null);
      },
    );

    app.get(
      "/api/v1/runs/:id/reports",
      {
        config: { access: { permission: "report:read", action: "report.list", snapshot: true } },
        schema: {
          operationId: "listReports",
          summary: "List a run's reports, oldest first",
          tags: ["reports"],
          security: SECURITY,
          params: IdParams,
          querystring: LimitQuery,
          response: {
            200: z.object({ items: z.array(ReportView), hasMore: z.boolean() }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const context = tenantOf(request);
        const { repos } = context;
        if ((await repos.runs.findById(request.params.id)) === null) throw notFound("The run");
        await requirePersonAccess(
          context,
          { runJobs: request.params.id },
          "This run's reports and their status.",
        );
        const rows = await repos.reports.listForRun(request.params.id, {
          limit: request.query.limit + 1,
        });
        const result = page(rows, request.query.limit);
        const items = [];
        for (const report of result.items) {
          items.push(reportView(report, await repos.reportPdfs.findByReportId(report.id)));
        }
        return { items, hasMore: result.hasMore };
      },
    );

    app.get(
      "/api/v1/reports/:id",
      {
        config: { access: { permission: "report:read", action: "report.read", snapshot: true } },
        schema: {
          operationId: "getReport",
          summary: "Read a report: its generation state and, once generated, the report itself",
          tags: ["reports"],
          security: SECURITY,
          params: IdParams,
          response: { 200: ReportView, ...PROTECTED_ERRORS },
        },
      },
      async (request) => {
        const context = tenantOf(request);
        const { repos } = context;
        request.auditTarget = { type: "report", id: request.params.id };
        const report = await repos.reports.findById(request.params.id);
        if (report === null) throw notFound("The report");
        await requirePersonAccess(
          context,
          { runJobs: report.runId },
          "This report: its findings, claims, coverage and limitations.",
        );
        return reportView(report, await repos.reportPdfs.findByReportId(report.id));
      },
    );

    app.get(
      "/api/v1/reports/:id/export/:format",
      {
        config: { access: { permission: "report:read", action: "report.export", snapshot: true } },
        schema: {
          operationId: "exportReport",
          summary: "Download a generated report as PDF, JSON, CSV or a Maltego graph table",
          description:
            "pdf: the formatted report, rendered once in the background and stored, so every download is the same file; 202 while it is still rendering (retry after the Retry-After seconds), 409 REPORT_PDF_FAILED if it could not be rendered. json: the complete report document. csv: one row per claim and relationship. maltego: an edge list for Maltego's Import Graph from Table. Every format carries the handling marking and the attribution its sources require.",
          tags: ["reports"],
          security: SECURITY,
          params: z.object({ id: z.uuid(), format: z.enum(REPORT_EXPORT_FORMAT_NAMES) }),
          produces: ["application/pdf", "application/json", "text/csv"],
          response: {
            200: z.string().describe("The report in the requested format."),
            202: z
              .object({
                status: z.enum(["PENDING", "RENDERING"]),
                detail: z.string(),
              })
              .describe("The PDF is still rendering; request it again after Retry-After seconds."),
            ...PROTECTED_ERRORS,
            ...CONFLICT,
          },
        },
      },
      async (request, reply) => {
        const context = tenantOf(request);
        const { repos, tenantId } = context;
        request.auditTarget = { type: "report", id: request.params.id };
        const report = await repos.reports.findById(request.params.id);
        if (report === null) throw notFound("The report");
        await requirePersonAccess(
          context,
          { runJobs: report.runId },
          "This report's exports: PDF, JSON, CSV and Maltego.",
        );
        if (report.status !== "SUCCEEDED" || report.document === null) {
          throw new HttpError(
            409,
            "REPORT_NOT_READY",
            `The report is ${report.status}; only a generated report can be exported.`,
          );
        }

        if (request.params.format === "pdf") {
          // The PDF is rendered once, in the worker, and stored: served as
          // stored, never rendered here. A report generated before PDFs were
          // stored gets its row now, PENDING.
          const pdf = await repos.reportPdfs.ensure(report.id);
          if (pdf.status === "FAILED") {
            throw new HttpError(
              409,
              "REPORT_PDF_FAILED",
              `The report's PDF could not be rendered: ${pdf.errorMessage ?? "no reason was recorded"}`,
            );
          }
          const { contentStore, renders } = services().runs;
          if (pdf.status === "READY" && pdf.contentHash !== null) {
            const contentHash = pdf.contentHash;
            // Read after the transaction commits: the store is not the database.
            afterCommit(request, async () => {
              // Re-hashed on read: a stored file that no longer matches is refused.
              const bytes = await contentStore.get(tenantId, contentHash);
              void reply.hijack();
              reply.raw.writeHead(200, {
                "content-type": "application/pdf",
                "content-length": String(bytes.byteLength),
                "content-disposition": `attachment; filename="report-${report.id}.pdf"`,
                "cache-control": "no-store",
              });
              reply.raw.end(Buffer.from(bytes));
            });
            return;
          }
          // Still to render. Enqueued again after the commit, so the worker
          // always finds the row: enqueueing is idempotent, and this resumes a
          // render whose enqueue was lost.
          const status = pdf.status === "RENDERING" ? "RENDERING" : "PENDING";
          afterCommit(request, async () => {
            try {
              await renders.enqueueRender(tenantId, report.id);
            } catch {
              throw new HttpError(
                503,
                "QUEUE_UNAVAILABLE",
                "The report's PDF is still to be rendered, but the job queue did not take it in time. Request it again.",
              );
            }
            void reply.code(202).header("retry-after", String(PDF_RETRY_AFTER_SECONDS));
            return {
              status,
              detail: "The report's PDF is still rendering. Request it again shortly.",
            };
          });
          return;
        }

        const format = REPORT_EXPORT_FORMATS[request.params.format];
        const document = ReportDocumentSchema.parse(report.document);
        // Rendered once the transaction has committed: rendering needs no
        // database, and holding the transaction through it left the
        // connection idle in transaction until the server ended it.
        afterCommit(request, async () => {
          const bytes = await format.render(document);
          // Bytes, not JSON: written directly, after the access check and its audit row.
          void reply.hijack();
          reply.raw.writeHead(200, {
            "content-type": format.contentType,
            "content-length": String(bytes.byteLength),
            "content-disposition": `attachment; filename="report-${report.id}.${format.extension}"`,
            "cache-control": "no-store",
          });
          reply.raw.end(Buffer.from(bytes));
        });
      },
    );

    app.put(
      "/api/v1/settings/report-handling-marking",
      {
        config: {
          access: { permission: "organization:update", action: "settings.report_marking" },
        },
        schema: {
          operationId: "setReportHandlingMarking",
          summary:
            "Set or clear the handling marking printed on every page of this organisation's reports",
          description:
            "Applies to reports generated from now on. Null clears it: the platform's default applies, and when none is set reports say no marking is set.",
          tags: ["settings"],
          security: SECURITY,
          body: z.object({
            marking: z
              .string()
              .trim()
              .min(1)
              .max(80)
              .regex(/^[^\p{Cc}]+$/u, "no control characters")
              .nullable(),
          }),
          response: { 200: z.object({ marking: z.string().nullable() }), ...PROTECTED_ERRORS },
        },
      },
      async (request) => {
        const { repos, principal } = tenantOf(request);
        request.auditTarget = { type: "tenant", id: principal.tenantId };
        const tenant = await repos.tenants.setReportHandlingMarking(request.body.marking);
        if (tenant === null) throw notFound("The organisation");
        return { marking: tenant.reportHandlingMarking };
      },
    );
    return Promise.resolve();
  };
