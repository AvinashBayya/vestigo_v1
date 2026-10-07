import { Button, EmptyState, FailedAlert, LoadingState, Notice, Skeleton } from "@repo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ApiProblem, timed, unwrap } from "../../api.ts";
import { api } from "../../client/index.ts";
import { ProblemNotice } from "../../components/ProblemNotice.tsx";
import { Instant } from "../../components/Values.tsx";
import { LIST_LIMIT, runQuery } from "../queries.ts";
import { Loaded } from "../states.tsx";
import { PdfPanel } from "./PdfPanel.tsx";
import { ReportDocumentView } from "./ReportDocument.tsx";
import { CitationRail, jumpTo, SectionsRail } from "./ReportRails.tsx";
import { reportQuery, runReportsQuery, type Report, type ReportDocument } from "./queries.ts";
import { citationsOf, PDF_ANCHOR, sectionId, sectionsOf, type SectionKey } from "./sections.ts";

/** The report's generation status, as a sentence (no chip: §3 has no report vocabulary). */
const STATUS_TEXT: Readonly<Record<Report["status"], string>> = {
  QUEUED: "Queued: waiting for a worker to generate it.",
  RUNNING: "Generating.",
  SUCCEEDED: "Generated.",
  FAILED: "Failed: it could not be generated.",
};

/**
 * The Report tab (docs/design/mockups/Report.dc.html): generate a report from
 * the settled run, read it here as stored, and open the stored PDF. Reports
 * are per run; there is no case report. The drawn review pill and
 * per-section regeneration have no endpoint, so they are not shown.
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

  // Newest first; the one just generated, or the one chosen, else the newest listed.
  const list = reports.data;
  const newestFirst = useMemo(() => list?.items.toReversed() ?? [], [list]);
  const current = list === undefined ? null : (chosen ?? newestFirst[0]?.id ?? null);
  // A report just generated may be missing from a list cut at the read limit: it is
  // offered anyway, so the picker always names the report shown below it.
  const listed = newestFirst.some((item) => item.id === current);
  const listedStatus = newestFirst.find((item) => item.id === current)?.status ?? null;
  const empty = list !== undefined && list.items.length === 0 && chosen === null;

  const report = useQuery({ ...reportQuery(current ?? ""), enabled: current !== null });
  const shown = current === null ? undefined : report.data;
  const status = shown?.status;
  // The list says each report's status too. When it disagrees with this report's own read,
  // the list is read again, so it never says RUNNING beside a generated report. Agreement
  // (the usual case on opening the tab) asks for nothing.
  useEffect(() => {
    if (status !== undefined && listedStatus !== null && status !== listedStatus) {
      void queryClient.invalidateQueries({ queryKey: ["run-reports", runId] });
    }
  }, [status, listedStatus, runId, queryClient]);

  const settled = run.data?.settled ?? null;
  const controls = (place: "toolbar" | "empty") => (
    <GenerateControls
      place={place}
      disabled={settled !== true || generate.isPending}
      pending={generate.isPending}
      onGenerate={(synthesis) => {
        generate.mutate(synthesis);
      }}
    />
  );

  const picker =
    current !== null && newestFirst.length + (listed ? 0 : 1) > 1 ? (
      <label className="inline-flex min-h-target items-center gap-1.75 text-small-strong text-ink-secondary">
        Report
        <select
          value={current}
          onChange={(event) => {
            setChosen(event.target.value);
          }}
          className="h-control-sm max-w-form cursor-pointer rounded-md border border-border-input bg-surface-sunken px-3.25 text-meta text-ink-primary"
        >
          {listed ? null : <option value={current}>The report just asked for</option>}
          {newestFirst.map((item) => (
            <option key={item.id} value={item.id}>
              {new Date(item.createdAt).toLocaleString(undefined, { timeZoneName: "short" })} ·{" "}
              {item.includeSynthesis ? "with synthesis" : "no synthesis"} · {item.status}
            </option>
          ))}
        </select>
      </label>
    ) : null;

  const generated = shown?.status === "SUCCEEDED" ? shown.document : null;
  return (
    <div className="flex grow flex-col gap-4">
      <div className="flex flex-col rounded-lg border border-border-default bg-surface-raised px-5">
        <div className="flex min-h-case-header flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h2 className="text-body-strong break-words text-ink-primary">
              {generated === null ? "Report" : generated.title}
            </h2>
            {picker === null ? null : (
              <>
                <span aria-hidden="true" className="h-4.5 w-px bg-border-default" />
                {picker}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2.25">
            {empty ? null : controls("toolbar")}
            {generated === null ? null : (
              <Button asChild size="sm">
                <a href={`#${PDF_ANCHOR}`} onClick={jumpTo(PDF_ANCHOR)}>
                  View PDF
                </a>
              </Button>
            )}
          </div>
        </div>
        {shown === undefined ? null : (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border-subtle py-2">
            <p role="status" className="text-small text-ink-primary">
              {STATUS_TEXT[shown.status]}
            </p>
            <span className="text-caption text-ink-muted">
              Asked for <Instant iso={shown.createdAt} />
              {shown.finishedAt === null ? null : (
                <>
                  , finished <Instant iso={shown.finishedAt} />
                </>
              )}{" "}
              · {String(shown.attempts)} attempt{shown.attempts === 1 ? "" : "s"}
            </span>
          </div>
        )}
      </div>
      {settled === false ? (
        <Notice>
          This run has not settled yet: a report can be generated once every source has finished and
          its results are merged.
        </Notice>
      ) : null}
      {generate.isError ? (
        <GenerateProblem error={generate.error} synthesis={generate.variables} />
      ) : null}
      <Loaded
        query={reports}
        loading={
          <LoadingState what="Reading this run's reports.">
            <Skeleton className="h-target" />
            <Skeleton className="h-target" />
          </LoadingState>
        }
      >
        {(read) => (
          <div className="flex grow flex-col gap-4">
            {read.hasMore ? (
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
            {empty ? (
              <EmptyState title="No report yet" action={controls("empty")}>
                No report has been generated for this run yet.
              </EmptyState>
            ) : current === null ? null : (
              <Loaded query={report} loading={<ReportLoading />}>
                {(data) => <ReportBody key={data.id} data={data} />}
              </Loaded>
            )}
          </div>
        )}
      </Loaded>
    </div>
  );
}

/**
 * The whole-report generate controls (they take the drawn "Regenerate
 * section" slot: no per-section endpoint exists). Exactly one set is on
 * screen: in the empty card while there is no report, otherwise the toolbar.
 */
function GenerateControls({
  place,
  disabled,
  pending,
  onGenerate,
}: {
  readonly place: "toolbar" | "empty";
  readonly disabled: boolean;
  readonly pending: boolean;
  readonly onGenerate: (synthesis: boolean) => void;
}) {
  const size = place === "toolbar" ? "sm" : "md";
  return (
    <div className="flex flex-wrap items-center gap-2.25">
      {pending ? (
        <p role="status" className="text-small text-ink-secondary">
          Asking for the report…
        </p>
      ) : null}
      <Button
        variant="secondary"
        size={size}
        disabled={disabled}
        onClick={() => {
          onGenerate(true);
        }}
      >
        Generate with a model synthesis
      </Button>
      <Button
        variant={place === "toolbar" ? "secondary" : "primary"}
        size={size}
        disabled={disabled}
        onClick={() => {
          onGenerate(false);
        }}
      >
        Generate report
      </Button>
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
      <FailedAlert title="The report was not generated" reason={error.detail} code={error.code}>
        {nextStep === null ? null : (
          <div className="text-prose-small text-ink-secondary">{nextStep}</div>
        )}
      </FailedAlert>
    );
  }
  return <ProblemNotice error={error}>{nextStep}</ProblemNotice>;
}

/** Loading in the report's shape: the sections rail, the document card and the citation rail. */
function ReportLoading() {
  return (
    <LoadingState what="Reading the report.">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex shrink-0 flex-col gap-2 lg:w-report-nav">
          <Skeleton className="h-target" />
          <Skeleton className="h-target" />
          <Skeleton className="h-target" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Skeleton className="h-target w-1/3" />
          <Skeleton className="h-target" />
          <Skeleton className="h-target" />
          <Skeleton className="h-target" />
        </div>
        <div className="hidden shrink-0 flex-col gap-2 xl:flex xl:w-side-rail">
          <Skeleton className="h-target" />
          <Skeleton className="h-target" />
        </div>
      </div>
    </LoadingState>
  );
}

/** One report, by its generation status. */
function ReportBody({ data }: { readonly data: Report }) {
  if (data.status === "QUEUED" || data.status === "RUNNING") {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-border-default bg-surface-raised p-4.5">
        <p className="text-small text-ink-secondary">
          Generating. This page reads it again every few seconds.
        </p>
        <Skeleton className="h-target w-1/3" />
        <Skeleton className="h-target" />
        <Skeleton className="h-target" />
      </div>
    );
  }
  if (data.status === "FAILED") {
    return (
      <FailedAlert
        title="The report could not be generated"
        reason={data.error === null ? "It failed, and no reason was recorded." : data.error.message}
        code={data.error === null ? null : data.error.code}
      >
        <p className="text-prose-small text-ink-secondary">Generate it again above.</p>
      </FailedAlert>
    );
  }
  if (data.document === null) {
    // SUCCEEDED always carries its document; were one missing, it is said, not left blank.
    return <Notice>The report is marked generated, but its document was not in the answer.</Notice>;
  }
  return <ReportView id={data.id} document={data.document} pdf={data.pdf} />;
}

/**
 * The generated report (Report.png), full-bleed: the sections rail (the full
 * column height, its nav sticky), the one continuous document card with the
 * stored PDF under it, and the citation rail with the model's provenance.
 * Three columns from xl (226 + the card + 330 fit 1280 and up). Below xl the
 * citation rail is a disclosure placed first, under the toolbar; below lg the
 * sections rail wraps above the document.
 */
function ReportView({
  id,
  document: report,
  pdf,
}: {
  readonly id: string;
  readonly document: ReportDocument;
  readonly pdf: Report["pdf"];
}) {
  const sections = useMemo(() => sectionsOf(report), [report]);
  const [active, setActive] = useState<SectionKey | null>(sections[0]?.key ?? null);

  // Where the browser can say which section is in view, the rails follow it. jsdom (and
  // any browser without it) has no IntersectionObserver: the active section is then the
  // one last chosen in the rail.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    // The sections in view; the first of them, in the document's order, is the active one.
    const inView = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const key = entry.target.getAttribute("data-report-section");
        if (key === null) continue;
        if (entry.isIntersecting) inView.add(key);
        else inView.delete(key);
      }
      const first = sections.find((section) => inView.has(section.key));
      if (first !== undefined) setActive(first.key);
    });
    for (const section of sections) {
      const element = window.document.getElementById(sectionId(section.key));
      if (element !== null) observer.observe(element);
    }
    return () => {
      observer.disconnect();
    };
  }, [sections]);

  const activeSection = sections.find((section) => section.key === active) ?? null;
  const numbers = activeSection === null ? [] : citationsOf(report, activeSection.key);
  return (
    <div className="flex grow flex-col gap-4 xl:flex-row xl:gap-0">
      {/* First in the source and on screen below xl (under the toolbar); last, beside the
          card, from xl. */}
      <CitationRail report={report} section={activeSection} numbers={numbers} />
      <div className="flex min-w-0 flex-1 flex-col lg:flex-row">
        <SectionsRail
          sections={sections}
          active={active}
          onChoose={setActive}
          synthesisGenerated={report.synthesis.status === "GENERATED"}
        />
        <div className="flex min-w-0 flex-1 flex-col items-center gap-5 px-4 py-6.5 lg:px-8.5">
          <ReportDocumentView document={report} />
          <PdfPanel id={id} stored={pdf} />
        </div>
      </div>
    </div>
  );
}
