import {
  CitationMarker,
  Citations,
  cn,
  CoverageLimitation,
  EntityClassName,
  InferredPassage,
  Notice,
  ReportProse,
  ReportSectionHeading,
  ReportSurface,
  StatusChip,
  StatusDot,
  StrengthBadge,
  TextLink,
  Unmeasured,
} from "@repo/ui";
import type { CollectorStatus } from "@repo/ui";
import type { ReactNode } from "react";
import {
  ClaimValue,
  Instant,
  MaybeInstant,
  MISSING_TIME,
  plural,
} from "../../components/Values.tsx";
import { PinButton } from "../Pin.tsx";
import { ProvenanceLink, useProvenance } from "../Provenance.tsx";
import type { ReportDocument } from "./queries.ts";
import { sectionId, type SectionKey } from "./sections.ts";

type Coverage = ReportDocument["coverage"];
type CoverageState = Coverage["entries"][number]["state"];

/**
 * The report's own wording, filled with its own values: the screen says what
 * the stored report (and its PDF) says, never a paraphrase. `{name}` is
 * replaced; anything unfilled is left visible rather than guessed.
 */
export function fill(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

/**
 * Each coverage state as a §3 chip colour; the chip's words are always the
 * report's own. NOTHING_FOUND is a measured empty result: the Found nothing
 * family (D7), never the Ran green. EMPTY_UNCONFIRMED is its own status (D9),
 * never Found nothing.
 */
const STATE_CHIP: Readonly<Record<CoverageState, CollectorStatus>> = {
  COLLECTED: "RAN",
  NOTHING_FOUND: "FOUND_NOTHING",
  FAILED: "FAILED",
  NEEDS_CREDENTIALS: "NEEDS_KEY",
  REFUSED: "SKIPPED",
  NOT_FINISHED: "QUEUED",
  EXCLUDED: "SKIPPED",
  HELD: "HELD",
  EMPTY_UNCONFIRMED: "UNCONFIRMED",
};

/**
 * As the stored PDF buckets them (packages/integrations/src/exports/pdf.ts):
 * only COLLECTED is "collected"; NOTHING_FOUND and every other state is listed
 * under what was not collected, and why.
 */
const isCollected = (state: CoverageState) => state === "COLLECTED";

/** The citation numbers in words, for what an INFERRED statement is drawn from (§2). */
export const fromSources = (numbers: readonly number[]) =>
  numbers.length === 0
    ? "no cited source"
    : `${numbers.length === 1 ? "source" : "sources"} ${numbers.map((n) => `[${String(n)}]`).join(", ")}`;

/** One of the stored report's sections, anchored for the sections rail. */
function Section({
  section,
  title,
  children,
}: {
  readonly section: SectionKey;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const id = sectionId(section);
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      tabIndex={-1}
      data-report-section={section}
      className="flex scroll-mt-4 flex-col gap-4 outline-none"
    >
      <ReportSectionHeading id={`${id}-heading`}>{title}</ReportSectionHeading>
      {children}
    </section>
  );
}

/** A sub-heading inside a section: the eyebrow, in sans. */
function SubHeading({ children }: { readonly children: ReactNode }) {
  return <h4 className="text-eyebrow text-ink-muted uppercase">{children}</h4>;
}

/**
 * A paragraph's citations as the library's standalone controls after it (D8),
 * each named for its source and opening the cited evidence. A number no
 * source matches is the stored wording for it, as text; a claim with no
 * citation says so.
 */
function SourceCitations({
  numbers,
  report,
}: {
  readonly numbers: readonly number[];
  readonly report: ReportDocument;
}) {
  const open = useProvenance();
  if (numbers.length === 0) {
    return <span className="text-caption text-status-failed-ink">no citation</span>;
  }
  const labels = new Map(report.sources.map((source) => [source.number, source.sourceLabel]));
  return (
    <Citations
      numbers={numbers}
      labels={labels}
      missing={(number) => fill(report.wording.footnote.missing, { number })}
      onOpen={(number) => {
        const source = report.sources.find((entry) => entry.number === number);
        if (source !== undefined) open({ kind: "evidence", id: source.evidenceId });
      }}
    />
  );
}

/**
 * The report as stored, every part of it, in the order its PDF prints them:
 * the cover, coverage, the glossary, synthesis, findings, relationships,
 * untrusted content, the evidence basis and attribution. One continuous
 * document, so it reads whole (§12).
 */
export function ReportDocumentView({ document: report }: { readonly document: ReportDocument }) {
  const { wording } = report;
  const headings = wording.headings;
  return (
    // The document is named "Report" whatever its own title, which ReportSurface prints
    // (and names its own card with) in the report's serif.
    <article aria-label="Report" className="w-full">
      <ReportSurface title={report.title} className="w-full">
        <Cover report={report} />
        <div className="mt-4 flex flex-col gap-8">
          <CoverageSection report={report} />
          <Section section="glossary" title={headings.glossary}>
            {/* A table layout gives the terms an auto-sized first column, so every
                definition starts at one edge (a grid template would need an arbitrary
                value, which the token guard forbids). */}
            <dl className="table border-separate border-spacing-y-2">
              {wording.glossary.map((entry) => (
                <div key={entry.strength} className="table-row">
                  <dt className="table-cell pt-1 pr-3 align-top whitespace-nowrap">
                    <StrengthBadge strength={entry.strength} size="sm" />
                  </dt>
                  <dd className="table-cell align-top">
                    <ReportProse>{entry.definition}</ReportProse>
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
          <SynthesisSection report={report} />
          <FindingsSection report={report} />
          <RelationshipsSection report={report} />
          {report.untrustedContent.length === 0 ? null : (
            <Section section="untrustedContent" title={headings.untrustedContent}>
              <ReportProse>{wording.untrustedContent.intro}</ReportProse>
              <ul className="flex flex-col gap-1">
                {report.untrustedContent.map((entry) => (
                  <li key={entry.sourceNumber}>
                    <ReportProse>
                      {fill(wording.untrustedContent.line, {
                        number: entry.sourceNumber,
                        patterns: entry.patterns.join(", "),
                      })}
                    </ReportProse>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <SourcesSection report={report} />
          <Section section="attribution" title={headings.attribution}>
            {report.attributions.length === 0 ? (
              <ReportProse>{wording.attribution.none}</ReportProse>
            ) : (
              <ul className="flex flex-col items-start gap-1">
                {report.attributions.map((entry) => (
                  <li key={entry.sourceId}>
                    <TextLink
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="meta"
                      className="min-h-target"
                    >
                      {entry.text}
                    </TextLink>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        {/* The stored report's own line; the screen never types the product name. */}
        <p className="border-t border-border-subtle pt-3 text-caption text-ink-muted">
          {report.producedBy}
        </p>
      </ReportSurface>
    </article>
  );
}

/** The cover, as the PDF prints it: the marking, the target, the run and when. */
function Cover({ report }: { readonly report: ReportDocument }) {
  const { wording } = report;
  const term = "inline text-small-strong text-ink-secondary";
  const value = "inline font-mono text-mono-small text-ink-primary break-all";
  return (
    <header className="flex flex-col gap-2">
      <p className="text-eyebrow text-ink-secondary uppercase">
        {report.handlingMarking === null
          ? wording.marking.notSet
          : fill(wording.marking.set, { marking: report.handlingMarking })}
      </p>
      {/* dt and dd adjacent, as the PDF prints them: "Collected as: DOMAIN [target]". */}
      <dl className="flex flex-col gap-1">
        <div>
          <dt className={term}>{wording.cover.target}</dt>
          <dd className={value}>{report.target.input}</dd>
        </div>
        {report.target.types.length === 0 ? null : (
          <div>
            <dt className={term}>{wording.cover.collectedAs}</dt>
            <dd className={value}>
              {report.target.types.map((type) => `${type.type} ${type.value}`).join("; ")}
            </dd>
          </div>
        )}
        <div>
          <dt className={term}>{wording.cover.run}</dt>
          <dd className={value}>
            {fill(wording.cover.runValue, { runId: report.runId, status: report.run.status })}
          </dd>
        </div>
        <div>
          <dt className={term}>{wording.cover.generated}</dt>
          <dd className={value}>
            <Instant iso={report.generatedAt} />
          </dd>
        </div>
      </dl>
    </header>
  );
}

function CoverageSection({ report }: { readonly report: ReportDocument }) {
  const { coverage, wording, omittedClaims } = report;
  const missed = coverage.entries.filter((entry) => !isCollected(entry.state));
  const got = coverage.entries.filter((entry) => isCollected(entry.state));
  const row = (entry: Coverage["entries"][number]) => {
    const status = STATE_CHIP[entry.state];
    return (
      <li
        key={entry.collectorId}
        className={cn(
          "flex flex-col gap-1 rounded-inner border px-3.5 py-3",
          entry.state === "FAILED"
            ? "border-status-failed-border bg-status-failed-tint"
            : "border-border-subtle",
        )}
      >
        <span className="flex flex-wrap items-center gap-2">
          <StatusDot status={status} />
          <span className="text-ui-strong text-ink-primary">{entry.sourceLabel}</span>
          <span className="font-mono text-mono-caption text-ink-muted">{entry.collectorId}</span>
          <StatusChip status={status} className="ml-auto">
            {wording.states[entry.state] ?? entry.state}
          </StatusChip>
        </span>
        {entry.detail === null ? null : (
          <span className="text-small text-ink-body">{entry.detail}</span>
        )}
        <span className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
          {entry.reasonCode === null ? null : (
            <span className="font-mono text-mono-caption">{entry.reasonCode}</span>
          )}
          {isCollected(entry.state) ? (
            <span>{fill(wording.coverage.evidenceItems, { count: entry.evidenceCount })}</span>
          ) : null}
          {entry.attempts === null ? (
            <Unmeasured reason="Never attempted: this collector did not run, so it has no attempts to count." />
          ) : (
            <span>{fill(wording.coverage.attempts, { count: entry.attempts })}</span>
          )}
        </span>
      </li>
    );
  };

  return (
    <Section section="coverage" title={wording.headings.coverage}>
      {/* The stored headline, once: boxed as the PDF boxes it when the run is partial. */}
      {coverage.partial ? (
        <CoverageLimitation title="Coverage limitation carried into the report" level={4}>
          <p role="status" aria-label="Coverage">
            {coverage.headline}
          </p>
        </CoverageLimitation>
      ) : (
        <ReportProse>{coverage.headline}</ReportProse>
      )}
      <section aria-label={wording.headings.notCollected} className="flex flex-col gap-2">
        <SubHeading>{wording.headings.notCollected}</SubHeading>
        {missed.length === 0 ? (
          <ReportProse>{wording.coverage.allCollected}</ReportProse>
        ) : (
          <ul className="flex flex-col gap-2">{missed.map(row)}</ul>
        )}
      </section>
      <section aria-label={wording.headings.collected} className="flex flex-col gap-2">
        <SubHeading>{wording.headings.collected}</SubHeading>
        {got.length === 0 ? (
          <ReportProse>{wording.coverage.noneCollected}</ReportProse>
        ) : (
          <ul className="flex flex-col gap-2">{got.map(row)}</ul>
        )}
      </section>
      {coverage.notApplicable.length === 0 ? null : (
        <ReportProse>
          {wording.coverage.notApplicable}
          {coverage.notApplicable.map((entry) => entry.sourceLabel).join("; ")}
        </ReportProse>
      )}
      <section aria-label={wording.headings.standingLimits} className="flex flex-col gap-2">
        <SubHeading>{wording.headings.standingLimits}</SubHeading>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-body marker:text-ink-muted">
          {coverage.caveats.map((caveat) => (
            <li key={caveat}>
              <ReportProse>{caveat}</ReportProse>
            </li>
          ))}
        </ul>
      </section>
      {omittedClaims > 0 ? (
        <Notice className="text-small-strong">
          {fill(wording.coverage.omittedClaims, { count: omittedClaims })}
        </Notice>
      ) : null}
    </Section>
  );
}

function SynthesisSection({ report }: { readonly report: ReportDocument }) {
  const { synthesis, wording } = report;
  const title = wording.headings.synthesis;
  if (synthesis.status === "NOT_REQUESTED") {
    return (
      <Section section="synthesis" title={title}>
        <ReportProse>{wording.synthesis.notRequested}</ReportProse>
      </Section>
    );
  }
  if (synthesis.status === "SKIPPED") {
    return (
      <Section section="synthesis" title={title}>
        <ReportProse>{fill(wording.synthesis.none, { reason: synthesis.reason })}</ReportProse>
      </Section>
    );
  }
  return (
    <Section section="synthesis" title={title}>
      <ReportProse>{synthesis.notice}</ReportProse>
      <ol className="flex flex-col gap-4">
        {synthesis.statements.map((statement, index) => {
          const markers = statement.citations.map((n) => <CitationMarker key={n} n={n} />);
          return (
            <li key={index} className="flex flex-col gap-1">
              {statement.strength === "INFERRED" ? (
                <InferredPassage from={fromSources(statement.citations)}>
                  <span>{statement.text}</span>
                  {markers}
                </InferredPassage>
              ) : (
                <ReportProse>
                  <span>{statement.text}</span>
                  {markers} <StrengthBadge strength={statement.strength} size="sm" />
                </ReportProse>
              )}
              <SourceCitations numbers={statement.citations} report={report} />
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

type Claim = ReportDocument["findings"][number]["claims"][number];

/** A claim's card: dashed for DERIVED, on the inferred tint for INFERRED (§2, §9). */
const claimCard = (strength: Claim["strength"]) =>
  strength === "DERIVED"
    ? "border-dashed border-claim-derived-mark"
    : strength === "INFERRED"
      ? "border-claim-inferred-border bg-claim-inferred-tint"
      : "border-border-subtle";

/**
 * Findings: each entity under its name, and its claims behind a disclosure
 * whose summary states how many there are (and how many values the stored
 * report shortened), so the document stays readable at any claim count.
 * Every claim is in the disclosure; none is dropped or hidden without saying.
 */
function FindingsSection({ report }: { readonly report: ReportDocument }) {
  const { wording } = report;
  return (
    <Section section="findings" title={wording.headings.findings}>
      {report.findings.length === 0 ? (
        <ReportProse>{wording.findings.none}</ReportProse>
      ) : (
        report.findings.map((finding) => {
          const shortened = finding.claims.filter((claim) => claim.display.truncated).length;
          return (
            <section
              key={finding.entityId}
              aria-label={finding.displayName}
              className="flex flex-col gap-2"
            >
              <div className="flex flex-wrap items-center gap-3">
                <EntityClassName
                  entityClass={finding.kind}
                  className="text-caption text-ink-muted"
                />
                <h4 className="text-ui-strong break-all text-ink-primary">
                  {finding.displayName}
                  {finding.identifier === null ||
                  finding.identifier === finding.displayName ? null : (
                    <span className="font-mono text-mono-caption text-ink-secondary">
                      {" "}
                      ({finding.identifier})
                    </span>
                  )}
                </h4>
                <span className="ml-auto">
                  <PinButton
                    target={{ type: "entity", id: finding.entityId }}
                    what={finding.displayName}
                  />
                </span>
              </div>
              <details className="rounded-inner border border-border-subtle">
                <summary className="flex min-h-target cursor-pointer flex-wrap items-center gap-x-2 px-3.5 text-small-strong text-ink-primary hover:bg-surface-hover">
                  {plural(finding.claims.length, "claim")}
                  {shortened === 0 ? null : (
                    <span className="text-caption text-ink-muted">
                      · {plural(shortened, "value")} shortened
                    </span>
                  )}
                </summary>
                <ul className="flex flex-col gap-2 border-t border-border-subtle p-2.5">
                  {finding.claims.map((claim) => (
                    <ClaimRow key={claim.claimId} claim={claim} report={report} />
                  ))}
                </ul>
              </details>
            </section>
          );
        })
      )}
    </Section>
  );
}

/**
 * One claim, compact: its attribute and its value as stored (the stored
 * report's shortened text, with its own wording saying so), its strength in
 * words, its citations and its pin.
 */
function ClaimRow({ claim, report }: { readonly claim: Claim; readonly report: ReportDocument }) {
  const { wording } = report;
  return (
    <li
      className={cn(
        "flex items-start gap-3 rounded-inner border px-3 py-2",
        claimCard(claim.strength),
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-small text-ink-secondary">{claim.attribute}</span>
          {claim.display.text === "" ? (
            <span className="text-small text-ink-muted">{wording.findings.emptyValue}</span>
          ) : (
            <ClaimValue value={claim.display.text} />
          )}
          {claim.display.truncated ? (
            <span className="text-caption text-ink-muted">{wording.findings.shortened}</span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-x-2">
          <StrengthBadge strength={claim.strength} size="sm" />
          {claim.strength === "DERIVED" ? (
            <span className="text-caption text-ink-muted">computed by the platform</span>
          ) : null}
          {claim.strength === "INFERRED" ? (
            <span className="text-caption text-claim-inferred-ink">
              from {fromSources(claim.citations)}
            </span>
          ) : null}
          <SourceCitations numbers={claim.citations} report={report} />
        </span>
      </div>
      <PinButton target={{ type: "claim", id: claim.claimId }} what={claim.attribute} />
    </li>
  );
}

function RelationshipsSection({ report }: { readonly report: ReportDocument }) {
  if (report.relationships.length === 0) return null;
  return (
    <Section section="relationships" title={report.wording.headings.relationships}>
      <ul className="flex flex-col gap-2">
        {report.relationships.map((relationship) => {
          const words = `${relationship.from.displayName} ${relationship.kind} ${relationship.to.displayName}`;
          return (
            <li
              key={relationship.relationshipId}
              className={cn(
                "flex items-start gap-3 rounded-inner border px-3.5 py-3",
                claimCard(relationship.strength),
              )}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <ProvenanceLink
                  target={{ kind: "relationship", id: relationship.relationshipId }}
                  label={`Provenance of the relationship: ${words}`}
                  className="font-mono text-mono-caption break-all"
                >
                  {relationship.from.displayName} → {relationship.kind} →{" "}
                  {relationship.to.displayName}
                </ProvenanceLink>
                <span className="flex flex-wrap items-center gap-2">
                  <StrengthBadge strength={relationship.strength} size="sm" />
                  {relationship.strength === "INFERRED" ? (
                    <span className="text-caption text-claim-inferred-ink">
                      from {fromSources(relationship.citations)}
                    </span>
                  ) : null}
                </span>
                <SourceCitations numbers={relationship.citations} report={report} />
              </div>
              <PinButton
                target={{ type: "relationship", id: relationship.relationshipId }}
                what={words}
              />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function SourcesSection({ report }: { readonly report: ReportDocument }) {
  const { wording } = report;
  return (
    <Section section="evidenceBasis" title={wording.headings.evidenceBasis}>
      <ReportProse>
        {report.sources.length === 0 ? wording.evidence.none : wording.evidence.intro}
      </ReportProse>
      <ol className="flex flex-col gap-2">
        {report.sources.map((source) => (
          <li
            key={source.number}
            id={`source-${String(source.number)}`}
            className="flex items-start gap-3 rounded-inner border border-border-subtle px-3.5 py-3"
          >
            <span className="pt-2.5 font-mono text-mono-body text-ink-primary">
              [{source.number}]
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <ProvenanceLink
                  target={{ kind: "evidence", id: source.evidenceId }}
                  label={`Provenance of source ${String(source.number)}: ${source.sourceLabel}`}
                  className="min-w-target text-ui-strong"
                >
                  {source.sourceLabel}
                </ProvenanceLink>
                <StrengthBadge strength={source.strength} size="sm" />
                {/* The stored report's Claims column: how many of its claims rest on this source. */}
                <span className="text-caption text-ink-muted">
                  {wording.evidence.columns.claims}:{" "}
                  <span className="font-mono text-mono-caption">{String(source.claimCount)}</span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                observed <MaybeInstant iso={source.observedAt} missing={MISSING_TIME.observedAt} />·
                collected{" "}
                <MaybeInstant iso={source.collectedAt} missing={MISSING_TIME.collectedAt} />
              </span>
              <span className="font-mono text-mono-caption break-all text-ink-secondary">
                {source.contentHash}
              </span>
              {source.sourceUrl === null ? (
                <span className="text-caption text-ink-muted">{wording.evidence.noUrl}</span>
              ) : (
                <span className="font-mono text-mono-caption break-all text-ink-secondary">
                  {source.sourceUrl}
                </span>
              )}
            </div>
            <PinButton
              target={{ type: "evidence", id: source.evidenceId }}
              what={`source ${String(source.number)}`}
            />
          </li>
        ))}
      </ol>
    </Section>
  );
}
