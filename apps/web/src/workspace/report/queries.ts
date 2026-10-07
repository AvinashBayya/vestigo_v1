import { queryOptions } from "@tanstack/react-query";
import { ApiProblem, ApiUnreachable, timed, unwrap } from "../../api.ts";
import { LIST_LIMIT } from "../queries.ts";
import { api, type paths } from "../../client/index.ts";

export type ReportList =
  paths["/api/v1/runs/{id}/reports"]["get"]["responses"][200]["content"]["application/json"];
export type Report =
  paths["/api/v1/reports/{id}"]["get"]["responses"][200]["content"]["application/json"];
export type ReportDocument = NonNullable<Report["document"]>;
export type ExportFormat = "pdf" | "json" | "csv" | "maltego";

/** While a report is being generated, how often to read it again. */
export const REPORT_POLL_MS = 2_000;

export const runReportsQuery = (runId: string) =>
  queryOptions({
    queryKey: ["run-reports", runId],
    queryFn: ({ signal }): Promise<ReportList> =>
      unwrap(
        api.GET("/api/v1/runs/{id}/reports", {
          params: { path: { id: runId }, query: { limit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

const generating = (report: Report | undefined) =>
  report !== undefined && (report.status === "QUEUED" || report.status === "RUNNING");

/** One report; read again every few seconds until it has been generated or has failed. */
export const reportQuery = (id: string) =>
  queryOptions({
    queryKey: ["report", id],
    queryFn: ({ signal }): Promise<Report> =>
      unwrap(api.GET("/api/v1/reports/{id}", { params: { path: { id } }, signal: timed(signal) })),
    // A failed read keeps the last data, so the status is checked too: no polling through errors.
    refetchInterval: (query) =>
      query.state.status !== "error" && generating(query.state.data) ? REPORT_POLL_MS : false,
  });

/** The stored PDF, or that it is still rendering and when to ask again (the API's Retry-After). */
export type PdfState =
  | {
      readonly kind: "rendering";
      /** PENDING or RENDERING, as the API said; null when its answer did not say. */
      readonly status: "PENDING" | "RENDERING" | null;
      readonly retryAfterSeconds: number | null;
    }
  | { readonly kind: "ready"; readonly blob: Blob };

/** An export asked for while the server still prepares it: a coded refusal, not a crash. */
export class ExportNotReady extends ApiProblem {
  constructor(retryAfterSeconds: number | null) {
    super({
      status: 202,
      code: "EXPORT_NOT_READY",
      detail: "The export is still being prepared. Try again shortly.",
      retryAfterSeconds,
      locked: null,
    });
    this.name = "ExportNotReady";
  }
}

/** When the API gives no Retry-After with a 202, how long to wait before asking again. */
export const PDF_RETRY_FALLBACK_SECONDS = 5;

/** The status word in a 202's JSON body (read from the Blob the client parsed it as), or null. */
async function renderingStatus(body: Blob): Promise<"PENDING" | "RENDERING" | null> {
  try {
    const parsed = JSON.parse(await body.text()) as { status?: unknown };
    return parsed.status === "PENDING" || parsed.status === "RENDERING" ? parsed.status : null;
  } catch {
    return null;
  }
}

const requestExport = (id: string, format: ExportFormat, signal?: AbortSignal) =>
  api.GET("/api/v1/reports/{id}/export/{format}", {
    params: { path: { id, format } },
    parseAs: "blob",
    signal: timed(signal),
  });

/** An export as a file. A 202 (the PDF still rendering) is a state, not a failure. */
export async function readExport(id: string, format: ExportFormat, signal?: AbortSignal) {
  let result: Awaited<ReturnType<typeof requestExport>>;
  try {
    result = await requestExport(id, format, signal);
  } catch (error) {
    // No answer, or the body never arrived in time: typed as every other call's is.
    throw new ApiUnreachable(error instanceof DOMException && error.name === "TimeoutError");
  }
  if (result.response.status === 202) {
    const header = Number(result.response.headers.get("retry-after") ?? Number.NaN);
    const status = await renderingStatus(result.data as Blob);
    return {
      kind: "rendering",
      status,
      retryAfterSeconds: Number.isFinite(header) ? header : null,
    } satisfies PdfState;
  }
  const blob = await unwrap(Promise.resolve(result));
  return { kind: "ready", blob } satisfies PdfState;
}

/** The report's PDF, asked for again after each Retry-After while it renders. */
export const reportPdfQuery = (id: string) =>
  queryOptions({
    queryKey: ["report-pdf", id],
    queryFn: ({ signal }): Promise<PdfState> => readExport(id, "pdf", signal),
    refetchInterval: (query) => {
      // A failed read keeps the last data (a 202's): stop rather than poll a refusal forever.
      if (query.state.status === "error") return false;
      const data = query.state.data;
      if (data?.kind !== "rendering") return false;
      return (data.retryAfterSeconds ?? PDF_RETRY_FALLBACK_SECONDS) * 1000;
    },
    // The stored PDF never changes ("every download is the same file"): once it is in,
    // it is not fetched again on focus or remount, which would reload the viewer.
    staleTime: (query) => (query.state.data?.kind === "ready" ? Number.POSITIVE_INFINITY : 0),
    refetchOnWindowFocus: false,
    // A Blob is not structurally comparable; keep each answer as given.
    structuralSharing: false,
  });
