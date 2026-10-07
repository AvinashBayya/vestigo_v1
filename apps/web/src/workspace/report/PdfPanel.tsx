import {
  Button,
  FailedAlert,
  LoadingState,
  Notice,
  shortHash,
  Skeleton,
  Unmeasured,
} from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ApiProblem } from "../../api.ts";
import { ProblemNotice } from "../../components/ProblemNotice.tsx";
import { Heading } from "../../components/Values.tsx";
import {
  ExportNotReady,
  PDF_RETRY_FALLBACK_SECONDS,
  readExport,
  reportPdfQuery,
  type ExportFormat,
  type Report,
} from "./queries.ts";
import { PDF_ANCHOR } from "./sections.ts";

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

/** What the report records about its stored PDF: its size and hash, or why either is missing. */
function StoredPdfMeta({ stored }: { readonly stored: NonNullable<Report["pdf"]> }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-caption text-ink-muted">
      <span>Stored PDF ·</span>
      {stored.byteLength === null ? (
        <Unmeasured reason="The report does not record the stored PDF's size." />
      ) : (
        <span className="font-mono text-mono-caption">{String(stored.byteLength)} bytes</span>
      )}
      <span>· hash</span>
      {stored.contentHash === null ? (
        <Unmeasured reason="The report does not record the stored PDF's hash." />
      ) : (
        <span title={stored.contentHash} className="font-mono text-mono-caption">
          {shortHash(stored.contentHash)}
        </span>
      )}
    </p>
  );
}

/** The stored PDF: polled while it renders (202, Retry-After), then shown and downloadable. */
export function PdfPanel({ id, stored }: { readonly id: string; readonly stored: Report["pdf"] }) {
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
    <section
      id={PDF_ANCHOR}
      aria-labelledby={`${PDF_ANCHOR}-heading`}
      tabIndex={-1}
      className="flex w-full flex-col gap-3 rounded-lg border border-border-default bg-surface-raised p-4.5"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Heading className="mr-auto">
          <span id={`${PDF_ANCHOR}-heading`}>PDF</span>
        </Heading>
        {download.isPending ? (
          <p role="status" className="text-small text-ink-secondary">
            Preparing the download…
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2.25">
          {(["pdf", "json", "csv", "maltego"] as const).map((format) => (
            <Button
              key={format}
              variant="secondary"
              size="sm"
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
      {stored?.status === "READY" ? <StoredPdfMeta stored={stored} /> : null}
      {download.isError ? <ProblemNotice error={download.error} /> : null}
      {failed ? (
        <PdfFailed message={stored.error?.message ?? null} code={stored.error?.code ?? null} />
      ) : pdf.isPending ? (
        <LoadingState what="Reading the PDF…">
          <Skeleton className="h-target" />
        </LoadingState>
      ) : pdf.isError ? (
        pdf.error instanceof ApiProblem && pdf.error.code === "REPORT_PDF_FAILED" ? (
          <PdfFailed message={pdf.error.detail} code={pdf.error.code} />
        ) : (
          <ProblemNotice error={pdf.error} onRetry={() => void pdf.refetch()} />
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
        // h-screen: no page-height token exists for the drawn A4 proportion (raised).
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
    </section>
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
    <FailedAlert
      title="The PDF could not be rendered"
      reason={message === null ? "No reason was recorded." : message}
      code={code}
    >
      <p className="text-prose-small text-ink-secondary">
        A report's PDF is rendered once. Generate the report again to render a new one; the JSON,
        CSV and Maltego exports above do not need it.
      </p>
    </FailedAlert>
  );
}
