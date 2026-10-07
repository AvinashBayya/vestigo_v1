import { cn, KeyValueList, NavItem, NotBuilt, StrengthBadge, Unmeasured } from "@repo/ui";
import { useId, useState, type MouseEvent } from "react";
import { Instant, MISSING_TIME } from "../../components/Values.tsx";
import { useProvenance } from "../Provenance.tsx";
import type { ReportDocument } from "./queries.ts";
import { fill } from "./ReportDocument.tsx";
import { PDF_ANCHOR, sectionId, type ReportSectionEntry, type SectionKey } from "./sections.ts";

/**
 * Brings an in-page anchor into view and moves focus to it, without letting
 * the browser rewrite the URL (the router owns it). jsdom has no
 * scrollIntoView, so it is called only where it exists.
 */
export function jumpTo(id: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(id);
    if (target === null) return;
    event.preventDefault();
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ block: "start" });
    }
    target.focus({ preventScroll: true });
  };
}

/** Rail eyebrow: the §9 section label, in sans. */
const EYEBROW = "text-eyebrow text-ink-muted uppercase";

/**
 * The sections rail (§9 Report, `layout-report-nav-width`): jump links to the
 * stored report's own sections, in its PDF's order, and to its PDF. The
 * active one is the one last chosen, or the one in view where the browser can
 * say. At its foot, the citation check, which is not built. From lg it is a
 * column the full height of the document (`surface-raised`, a right rule)
 * whose contents stay in view as the document scrolls.
 */
export function SectionsRail({
  sections,
  active,
  onChoose,
  synthesisGenerated,
}: {
  readonly sections: readonly ReportSectionEntry[];
  readonly active: SectionKey | null;
  readonly onChoose: (key: SectionKey) => void;
  readonly synthesisGenerated: boolean;
}) {
  return (
    <aside className="flex shrink-0 flex-col border-y border-border-default bg-surface-raised lg:w-report-nav lg:border-y-0 lg:border-r">
      <div className="flex flex-col gap-4 px-3 py-4 lg:sticky lg:top-0 lg:max-h-screen lg:overflow-auto">
        <nav aria-label="Report sections" className="flex flex-col gap-1.5">
          <h2 className={cn(EYEBROW, "ml-1.5")}>Sections</h2>
          <ul className="flex flex-row flex-wrap gap-0.75 lg:flex-col">
            {sections.map((section) => (
              <NavItem
                key={section.key}
                size="rail"
                current={section.key === active}
                aria-current={section.key === active ? "location" : undefined}
                href={`#${sectionId(section.key)}`}
                onClick={(event) => {
                  onChoose(section.key);
                  jumpTo(sectionId(section.key))(event);
                }}
              >
                {section.label}
              </NavItem>
            ))}
          </ul>
          <ul className="flex flex-col gap-0.75 border-t border-border-subtle pt-1.5">
            <NavItem
              size="rail"
              current={false}
              href={`#${PDF_ANCHOR}`}
              onClick={jumpTo(PDF_ANCHOR)}
            >
              PDF
            </NavItem>
          </ul>
        </nav>
        <CitationCheck synthesisGenerated={synthesisGenerated} />
      </div>
    </aside>
  );
}

/**
 * The citation check (Report, drawn green with a count): the stored report
 * records each claim's citations but no check result, so it is Not built and
 * neutral. A count tallied here would ignore omitted claims and count
 * unmatched numbers as cited.
 */
function CitationCheck({ synthesisGenerated }: { readonly synthesisGenerated: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-inner border border-border-subtle p-3">
      <NotBuilt
        title="Citation check"
        needs="The API does not record a citation check for a stored report."
        className="rounded-none border-0 bg-transparent p-0"
      />
      {synthesisGenerated ? (
        <p className="text-caption text-ink-muted">
          A synthesis sentence that cannot cite this run's evidence is rejected before it is stored.
        </p>
      ) : null}
    </div>
  );
}

type Source = ReportDocument["sources"][number];

/**
 * One cited source in the rail (§9 Report citation rail): its number, which
 * opens the evidence, its strength in words, its source and when it was
 * collected. The API gives no per-evidence title, so none is shown.
 */
function CitationCard({ source }: { readonly source: Source }) {
  const open = useProvenance();
  const inferred = source.strength === "INFERRED";
  return (
    <li
      className={cn(
        "flex flex-col gap-1.25 rounded-inner border p-2.75",
        inferred ? "border-claim-inferred-border bg-claim-inferred-tint" : "border-border-subtle",
      )}
    >
      <span className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`Open source ${String(source.number)}: ${source.sourceLabel}`}
          onClick={() => {
            open({ kind: "evidence", id: source.evidenceId });
          }}
          className="hit-area cursor-pointer rounded-sm font-mono text-mono-caption text-link hover:text-link-hover hover:underline"
        >
          [{source.number}]
        </button>
        <StrengthBadge strength={source.strength} size="sm" />
      </span>
      <span className="text-small break-all text-ink-body">{source.sourceLabel}</span>
      <span className="flex flex-wrap items-center gap-1 text-caption text-ink-muted">
        {source.collectedAt === null ? (
          <>
            collected <Unmeasured reason={MISSING_TIME.collectedAt} />
          </>
        ) : (
          <>
            collected <Instant iso={source.collectedAt} />
          </>
        )}
      </span>
      {inferred ? (
        <span className="flex items-center gap-1 text-caption text-claim-inferred-ink">
          from <Unmeasured reason="The stored report does not record what this rests on." />
        </span>
      ) : null}
    </li>
  );
}

/**
 * The citation rail (§9 Report): the sources the active section cites, from
 * the stored document; a cited number no source matches is the stored wording
 * for it. At its foot, the model's provenance as stored. From xl it is the
 * column beside the card (`side-rail` wide, a left rule, its contents kept in
 * view); below xl it is a disclosure under the toolbar, closed until asked for.
 */
export function CitationRail({
  report,
  section,
  numbers,
}: {
  readonly report: ReportDocument;
  readonly section: ReportSectionEntry | null;
  readonly numbers: readonly number[];
}) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const count = (
    <span className="font-mono text-mono-caption text-ink-muted">{String(numbers.length)}</span>
  );
  return (
    <aside
      aria-label="Citations"
      className={cn(
        "flex shrink-0 flex-col rounded-lg border border-border-default bg-surface-raised",
        "xl:order-last xl:w-side-rail xl:rounded-none xl:border-0 xl:border-l",
      )}
    >
      {/* Below xl: the disclosure. From xl the rail is always shown and this is not drawn. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => {
          setOpen((was) => !was);
        }}
        className="flex min-h-target cursor-pointer items-center justify-between gap-2 rounded-lg px-4.5 text-left hover:bg-surface-hover xl:hidden"
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={EYEBROW}>Citations in this section</span>
          {section === null ? null : (
            <span className="text-caption text-ink-muted">{section.label}</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {count}
          <span className="text-caption text-link">{open ? "Hide" : "Show"}</span>
        </span>
      </button>
      <div
        id={contentId}
        className={cn(
          open ? "flex border-t border-border-subtle" : "hidden",
          "flex-col gap-3.5 p-4.5 xl:sticky xl:top-0 xl:flex xl:max-h-screen xl:overflow-auto xl:border-t-0",
        )}
      >
        <div className="hidden flex-col gap-0.5 xl:flex">
          <div className="flex items-center justify-between gap-2">
            <h2 className={EYEBROW}>Citations in this section</h2>
            {count}
          </div>
          {section === null ? null : <p className="text-caption text-ink-muted">{section.label}</p>}
        </div>
        {numbers.length === 0 ? (
          <p className="text-small text-ink-secondary">This section cites no evidence.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {numbers.map((number) => {
              const source = report.sources.find((entry) => entry.number === number);
              return source === undefined ? (
                <li
                  key={number}
                  className="rounded-inner border border-border-subtle p-2.75 text-small text-status-failed-ink"
                >
                  {fill(report.wording.footnote.missing, { number })}
                </li>
              ) : (
                <CitationCard key={number} source={source} />
              );
            })}
          </ul>
        )}
        <ModelBlock report={report} />
      </div>
    </aside>
  );
}

/**
 * The model's provenance exactly as the report stores it: the model, the
 * endpoint (and an upstream provider only when the endpoint named one), and
 * region headers raw, never interpreted. No residency and no rejected-draft
 * count: neither is recorded.
 */
function ModelBlock({ report }: { readonly report: ReportDocument }) {
  const { synthesis, wording } = report;
  const foot = "flex flex-col gap-2.25 border-t border-border-subtle pt-3.25";
  if (synthesis.status !== "GENERATED") {
    return (
      <div className={foot}>
        <h2 className={EYEBROW}>Model</h2>
        <p className="text-caption-prose text-ink-secondary">
          {synthesis.status === "NOT_REQUESTED"
            ? wording.synthesis.notRequested
            : fill(wording.synthesis.none, { reason: synthesis.reason })}
        </p>
      </div>
    );
  }
  const { model } = synthesis;
  return (
    <section aria-label="Model provenance" className={foot}>
      <h2 className={EYEBROW}>Model</h2>
      <KeyValueList rows={[{ key: "Used", value: model.id }]} />
      <p className="text-caption-prose text-ink-secondary">
        {fill(wording.synthesis.model, {
          id: model.id,
          licence: model.licence,
          profile: model.profile,
        })}
      </p>
      <p className="text-caption-prose text-ink-secondary">
        {model.servedBy === null
          ? fill(wording.synthesis.servedByEndpoint, { endpoint: model.endpointHost })
          : fill(wording.synthesis.servedBy, {
              provider: model.servedBy,
              endpoint: model.endpointHost,
            })}
      </p>
      {/* Printed only when the response carried one, as the stored wording says. */}
      {model.regionHeaders.map((header) => (
        <p key={`${header.name}:${header.value}`} className="text-caption-prose text-ink-secondary">
          {fill(wording.synthesis.regionHeader, { name: header.name, value: header.value })}
        </p>
      ))}
      <p className="text-caption text-ink-muted">
        Written <Instant iso={synthesis.generatedAt} /> · {String(synthesis.attempts)} attempt
        {synthesis.attempts === 1 ? "" : "s"}
      </p>
    </section>
  );
}
