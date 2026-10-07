import { Button, Notice, Panel, Skeleton } from "@repo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ApiProblem, timed, unwrap } from "../../api.ts";
import { api } from "../../client/index.ts";
import { ProblemNotice } from "../../components/ProblemNotice.tsx";
import { Heading, Instant } from "../../components/Values.tsx";
import { LIST_LIMIT, runQuery } from "../queries.ts";
import { Loaded, TableSkeleton } from "../states.tsx";
import { ReportDocumentView } from "./ReportDocument.tsx";
import {
  ExportNotReady,
  PDF_RETRY_FALLBACK_SECONDS,
  readExport,
  reportPdfQuery,
  reportQuery,
  runReportsQuery,
  type ExportFormat,
  type Report,
} from "./queries.ts";

const STATUS_TEXT: Readonly<Record<Report["status"], string>> = {
  QUEUED: "Queued: waiting for a worker to generate it.",
  RUNNING: "Generating.",
  SUCCEEDED: "Generated.",
  FAILED: "Failed: it could not be generated.",
};

/**
 * The Report tab (docs/design/mockups/Report.dc.html): generate a report from
 * the settled run, read it here as stored, and open the stored PDF. Reports
 * are per run; there is no case report.
 */
export function ReportTab({ runId }: { readonly runId: string }) {
  const reports = useQuery(runReportsQuery(runId));
  const run = useQuery(runQuery(runId));
  const [chosen, setChosen] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const generate = useMutation({
    mutationFn: (synthesis: boolean) =>
      unwrap(
        api.POST("/api/v1/runs/{id}/reports", {
          params: { path: { id: runId } },
          body: { synthesis },
          signal: timed(),
        }),
      ),
    onSuccess: async (created) => {
      setChosen(created.id);
      await queryClient.invalidateQueries({ queryKey: ["run-reports", runId] });
    },
  });

  const settled = run.data?.settled ?? null;
  return (
    <div className="flex flex-col gap-6">
      <Panel className="flex flex-col gap-3">
        <Heading>Generate a report</Heading>
        <p className="text-small text-ink-secondary">
          A report states what was collected, what was not and why, and cites every claim. A
          synthesis is written by a model and checked: every statement must cite the evidence.
        </p>
        {settled === false ? (
          <Notice>
            This run has not settled yet: a report can be generated once every source has finished
            and its results are merged.
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={settled !== true || generate.isPending}
            onClick={() => {
              generate.mutate(false);
            }}
          >
            Generate report
          </Button>
          <Button
            variant="secondary"
            disabled={settled !== true || generate.isPending}
            onClick={() => {
              generate.mutate(true);
            }}
          >
            Generate with a model synthesis
          </Button>
          {generate.isPending ? (
            <p role="status" className="text-small text-ink-secondary">
              Asking for the report…
            </p>
          ) : null}
        </div>
        {generate.isError ? (
          <GenerateProblem error={generate.error} synthesis={generate.variables} />
        ) : null}
      </Panel>
      <Loaded
        query={reports}
        loading={<TableSkeleton label="Reading this run's reports" rows={2} />}
      >
        {(list) => {
          if (list.items.length === 0 && chosen === null) {
            return (
              <Panel className="text-body text-ink-secondary">
                No report has been generated for this run yet.
              </Panel>
            );
          }
          // Newest first; the one just generated, or the one chosen, else the newest listed.
          const newestFirst = list.items.toReversed();
          const current = chosen ?? newestFirst[0]?.id ?? null;
          // A report just generated may be missing from a list cut at the read limit: it is
          // offered anyway, so the picker always names the report shown below it.
          const listed = newestFirst.some((item) => item.id === current);
          return (
            <div className="flex flex-col gap-6">
              {list.hasMore ? (
                <Notice className="flex flex-col gap-1">
                  <p className="text-body-strong">
                    Partial: this run has more than {String(LIST_LIMIT)} reports.
                  </p>
                  <p className="text-small">
                    The API lists a run's reports oldest first and cannot page past{" "}
                    {String(LIST_LIMIT)} yet, so newer reports are not listed and the one shown may
                    not be the newest.
                  </p>
                </Notice>
              ) : null}
              {newestFirst.length + (current !== null && !listed ? 1 : 0) > 1 ? (
                <label className="flex max-w-form flex-col gap-1 text-small text-ink-secondary">
                  Report
                  <select
                    value={current ?? ""}
                    onChange={(event) => {
                      setChosen(event.target.value);
                    }}
                    className="min-h-target rounded-md border border-border-strong bg-surface-sunken px-3 text-body text-ink-primary"
                  >
                    {current !== null && !listed ? (
                      <option value={current}>The report just asked for</option>
                    ) : null}
                    {newestFirst.map((item) => (
                      <option key={item.id} value={item.id}>
                        {new Date(item.createdAt).toLocaleString()} ·{" "}
                        {item.includeSynthesis ? "with synthesis" : "no synthesis"} · {item.status}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {current === null ? null : (
                <OneReport
                  key={current}
                  id={current}
                  runId={runId}
                  listedStatus={newestFirst.find((item) => item.id === current)?.status ?? null}
                />
              )}
            </div>
          );
        }}
      </Loaded>
    </div>
  );
}

/**
 * A refused generation, in the API's own words where the shared message
 * would name the wrong thing (QUOTA_EXCEEDED and QUEUE_UNAVAILABLE speak of
 * runs). A refused synthesis says what still works.
 */
function GenerateProblem({
  error,
  synthesis,
}: {
  readonly error: unknown;
  readonly synthesis: boolean | undefined;
}) {
  const ownWords =
    error instanceof ApiProblem &&
    (error.code === "QUOTA_EXCEEDED" || error.code === "QUEUE_UNAVAILABLE");
  const synthesisRefused =
    synthesis === true &&
    error instanceof ApiProblem &&
    (error.code === "SYNTHESIS_UNAVAILABLE" || error.code === "QUOTA_EXCEEDED");
  const nextStep = synthesisRefused ? (
    <p>A report without a synthesis can still be generated: use Generate report.</p>
  ) : null;
  if (ownWords) {
    return (
      <Notice tone="failure" className="flex flex-col gap-1">
        <p>{error.detail}</p>
        {nextStep}
        <p className="font-mono text-mono-caption">Code: {error.code}</p>
      </Notice>
    );
  }
  return <ProblemNotice error={error}>{nextStep}</ProblemNotice>;
}

function OneReport({
  id,
  runId,
  listedStatus,
}: {
  readonly id: string;
  readonly runId: string;
  /** The status the run's list gives this report; null when the list does not hold it. */
  readonly listedStatus: Report["status"] | null;
}) {
  const report = useQuery(reportQuery(id));
  const queryClient = useQueryClient();
  const status = report.data?.status;
  // The list says each report's status too. When it disagrees with this report's own read,
  // the list is read again, so it never says RUNNING beside a generated report. Agreement
  // (the usual case on opening the tab) asks for nothing.
  useEffect(() => {
    if (status !== undefined && listedStatus !== null && status !== listedStatus) {
      void queryClient.invalidateQueries({ queryKey: ["run-reports", runId] });
    }
  }, [status, listedStatus, runId, queryClient]);
  return (
    <Loaded query={report} loading={<TableSkeleton label="Reading the report" rows={4} />}>
      {(data) => (
        <div className="flex flex-col gap-6">
          <Panel className="flex flex-wrap items-center gap-4">
            <p role="status" className="text-body text-ink-primary">
              {STATUS_TEXT[data.status]}
            </p>
            <span className="text-small text-ink-secondary">
              Asked for <Instant iso={data.createdAt} />
              {data.finishedAt === null ? null : (
                <>
                  , finished <Instant iso={data.finishedAt} />
                </>
              )}{" "}
              · {String(data.attempts)} attempt{data.attempts === 1 ? "" : "s"}
            </span>
          </Panel>
          {data.status === "QUEUED" || data.status === "RUNNING" ? (
            <Panel className="flex flex-col gap-3">
              <p className="text-small text-ink-secondary">
                Generating. This page reads it again every few seconds.
              </p>
              <Skeleton className="h-target" />
              <Skeleton className="h-target" />
            </Panel>
          ) : null}
          {data.status === "FAILED" ? (
            <Notice tone="failure" className="flex flex-col gap-1">
              {data.error === null ? (
                <p>It failed, and no reason was recorded.</p>
              ) : (
                <p>{data.error.message}</p>
              )}
              {data.error === null ? null : (
                <p className="font-mono text-mono-caption">Code: {data.error.code}</p>
              )}
              <p>Generate it again above.</p>
            </Notice>
          ) : null}
          {data.status === "SUCCEEDED" && data.document !== null ? (
            <>
              <PdfPanel id={data.id} stored={data.pdf} />
              <ReportDocumentView document={data.document} />
            </>
          ) : null}
        </div>
      )}
    </Loaded>
  );
}

/** A file saved from a Blob the app holds; nothing is opened in the app. */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

const FILE_NAME: Readonly<Record<ExportFormat, (id: string) => string>> = {
  pdf: (id) => `report-${id}.pdf`,
  json: (id) => `report-${id}.json`,
  csv: (id) => `report-${id}.csv`,
  maltego: (id) => `report-${id}-maltego.csv`,
};

/** Revocations waiting one tick, by URL: a setup that follows at once cancels its own. */
const pendingRevocations = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * An object URL for a Blob, revoked only when it is really let go. StrictMode
 * runs a mount's cleanup and setup back to back; revoking in that cleanup
 * would leave the viewer on a dead URL, so the revocation waits a tick and
 * the setup that follows cancels it. A real unmount or a new Blob revokes.
 */
function useObjectUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob === null ? null : URL.createObjectURL(blob)), [blob]);
  useEffect(() => {
    if (url === null) return;
    const pending = pendingRevocations.get(url);
    if (pending !== undefined) {
      clearTimeout(pending);
      pendingRevocations.delete(url);
    }
    return () => {
      pendingRevocations.set(
        url,
        setTimeout(() => {
          URL.revokeObjectURL(url);
          pendingRevocations.delete(url);
        }, 0),
      );
    };
  }, [url]);
  return url;
}

/** The stored PDF: polled while it renders (202, Retry-After), then shown and downloadable. */
function PdfPanel({ id, stored }: { readonly id: string; readonly stored: Report["pdf"] }) {
  // A PDF that failed to render stays failed: the report says so, and it is not asked for.
  const failed = stored?.status === "FAILED";
  const pdf = useQuery({ ...reportPdfQuery(id), enabled: !failed });
  const blob = pdf.data?.kind === "ready" ? pdf.data.blob : null;
  const url = useObjectUrl(blob);
  const download = useMutation({
    mutationFn: async (format: ExportFormat) => {
      // The PDF the page already holds is saved as it is: the same stored file.
      if (format === "pdf" && blob !== null) {
        saveBlob(blob, FILE_NAME.pdf(id));
        return;
      }
      const result = await readExport(id, format);
      if (result.kind !== "ready") throw new ExportNotReady(result.retryAfterSeconds);
      saveBlob(result.blob, FILE_NAME[format](id));
    },
  });

  return (
    <Panel className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Heading>PDF</Heading>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {download.isPending ? (
            <p role="status" className="text-small text-ink-secondary">
              Preparing the download…
            </p>
          ) : null}
          {(["pdf", "json", "csv", "maltego"] as const).map((format) => (
            <Button
              key={format}
              variant="secondary"
              disabled={download.isPending || (format === "pdf" && blob === null)}
              onClick={() => {
                download.mutate(format);
              }}
            >
              Download {format === "maltego" ? "Maltego table" : format.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>
      {download.isError ? <ProblemNotice error={download.error} /> : null}
      {failed ? (
        <PdfFailed message={stored.error?.message ?? null} code={stored.error?.code ?? null} />
      ) : pdf.isPending ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-small text-ink-secondary">
            Reading the PDF…
          </p>
          <Skeleton className="h-target" />
        </div>
      ) : pdf.isError ? (
        pdf.error instanceof ApiProblem && pdf.error.code === "REPORT_PDF_FAILED" ? (
          <PdfFailed message={pdf.error.detail} code={pdf.error.code} />
        ) : (
          <ProblemNotice error={pdf.error}>
            <Button variant="quiet" className="self-start" onClick={() => void pdf.refetch()}>
              Try again
            </Button>
          </ProblemNotice>
        )
      ) : pdf.data.kind === "rendering" ? (
        <Notice>
          {pdf.data.status === "PENDING"
            ? "The PDF is waiting to render."
            : pdf.data.status === "RENDERING"
              ? "The PDF is rendering."
              : "The PDF is not ready yet."}{" "}
          Asking again in {String(pdf.data.retryAfterSeconds ?? PDF_RETRY_FALLBACK_SECONDS)} seconds
          {pdf.data.retryAfterSeconds === null ? "." : ", as the server asked."}
        </Notice>
      ) : url === null ? null : (
        <object
          data={url}
          type="application/pdf"
          aria-label="The report as a PDF"
          className="h-screen w-full rounded-md border border-border-default"
        >
          <p className="p-4 text-small text-ink-secondary">
            This browser cannot show the PDF here. Use Download PDF.
          </p>
        </object>
      )}
    </Panel>
  );
}

/**
 * A PDF that could not be rendered. It is rendered once per report and stored,
 * so asking again gets the same refusal: no retry is offered, only what works.
 */
function PdfFailed({
  message,
  code,
}: {
  readonly message: string | null;
  readonly code: string | null;
}) {
  return (
    <Notice tone="failure" className="flex flex-col gap-1">
      {message === null ? (
        <p>The PDF could not be rendered, and no reason was recorded.</p>
      ) : (
        <p>{message}</p>
      )}
      {code === null ? null : <p className="font-mono text-mono-caption">Code: {code}</p>}
      <p>
        A report's PDF is rendered once. Generate the report again to render a new one; the JSON,
        CSV and Maltego exports above do not need it.
      </p>
    </Notice>
  );
}
