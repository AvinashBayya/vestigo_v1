import {
  ClaimStrength,
  cn,
  EntityClassName,
  Notice,
  Panel,
  StatusChip,
  Unmeasured,
} from "@repo/ui";
import type { CollectorStatus } from "@repo/ui";
import type { ReactNode } from "react";
import {
  ClaimValue,
  Heading,
  Instant,
  MaybeInstant,
  MISSING_TIME,
} from "../../components/Values.tsx";
import { PinButton } from "../Pin.tsx";
import { ProvenanceLink } from "../Provenance.tsx";
import type { ReportDocument } from "./queries.ts";

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

/** Each coverage state as a §3 chip; the chip's words are the report's own. */
const STATE_CHIP: Readonly<Record<CoverageState, CollectorStatus>> = {
  COLLECTED: "RAN",
  NOTHING_FOUND: "RAN",
  FAILED: "FAILED",
  NEEDS_CREDENTIALS: "NEEDS_KEY",
  REFUSED: "SKIPPED",
  NOT_FINISHED: "QUEUED",
  EXCLUDED: "SKIPPED",
  HELD: "HELD",
};

/**
 * As the stored PDF buckets them (packages/integrations/src/exports/pdf.ts):
 * only COLLECTED is "collected"; NOTHING_FOUND and every other state is listed
 * under what was not collected, and why.
 */
const isCollected = (state: CoverageState) => state === "COLLECTED";

function Section({
  title,
  children,
  className,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <Panel className={cn("flex flex-col gap-3", className)}>
      <h2 className="text-title text-ink-primary">{title}</h2>
      {children}
    </Panel>
  );
}

/** Citation markers: each opens the provenance of the evidence it numbers. */
function Citations({
  numbers,
  sources,
  missing,
}: {
  readonly numbers: readonly number[];
  readonly sources: ReportDocument["sources"];
  /** The stored wording for a citation no source matches ("{number}. Source not found…"). */
  readonly missing: string;
}) {
  if (numbers.length === 0) {
    return <span className="text-caption text-status-failed-ink">no citation</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {numbers.map((number) => {
        const source = sources.find((entry) => entry.number === number);
        return source === undefined ? (
          <span key={number} className="text-caption text-status-failed-ink">
            {fill(missing, { number })}
          </span>
        ) : (
          <ProvenanceLink
            key={number}
            target={{ kind: "evidence", id: source.evidenceId }}
            label={`Source ${String(number)}: ${source.sourceLabel}`}
            className="min-w-target font-mono text-mono-caption"
          >
            [{number}]
          </ProvenanceLink>
        );
      })}
    </span>
  );
}

/** The report as stored, every part of it: coverage, synthesis, findings and their sources. */
export function ReportDocumentView({ document: report }: { readonly document: ReportDocument }) {
  const { wording, coverage } = report;
  const headings = wording.headings;
  return (
    <article aria-label="Report" className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-display text-ink-primary">{report.title}</h1>
        <dl className="flex flex-col gap-1 text-small text-ink-secondary">
          <div>
            <dt className="inline text-body-strong">{wording.cover.target}</dt>
            <dd className="inline font-mono">{report.target.input}</dd>
          </div>
          {report.target.types.length === 0 ? null : (
            <div>
              <dt className="inline text-body-strong">{wording.cover.collectedAs}</dt>
              <dd className="inline font-mono">
                {report.target.types.map((type) => `${type.type} ${type.value}`).join("; ")}
              </dd>
            </div>
          )}
          <div>
            <dt className="inline text-body-strong">{wording.cover.run}</dt>
            <dd className="inline font-mono">
              {fill(wording.cover.runValue, { runId: report.runId, status: report.run.status })}
            </dd>
          </div>
          <div>
            <dt className="inline text-body-strong">{wording.cover.generated}</dt>
            <dd className="inline">
              <Instant iso={report.generatedAt} />
            </dd>
          </div>
        </dl>
        <p className="text-small text-ink-secondary">
          {report.handlingMarking === null
            ? wording.marking.notSet
            : fill(wording.marking.set, { marking: report.handlingMarking })}
        </p>
      </header>

      {coverage.partial ? (
        <Notice aria-label="Coverage" className="text-body-strong">
          {coverage.headline}
        </Notice>
      ) : null}

      <CoverageSection
        coverage={coverage}
        wording={wording}
        title={headings.coverage}
        omittedClaims={report.omittedClaims}
      />
      <SynthesisSection report={report} />
      <FindingsSection report={report} />
      <RelationshipsSection report={report} />
      <SourcesSection report={report} />

      {report.untrustedContent.length === 0 ? null : (
        <Section title={headings.untrustedContent}>
          <p className="text-small text-ink-secondary">{wording.untrustedContent.intro}</p>
          <ul className="flex flex-col gap-1">
            {report.untrustedContent.map((entry) => (
              <li key={entry.sourceNumber} className="text-small">
                {fill(wording.untrustedContent.line, {
                  number: entry.sourceNumber,
                  patterns: entry.patterns.join(", "),
                })}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={headings.attribution}>
        {report.attributions.length === 0 ? (
          <p className="text-small text-ink-secondary">{wording.attribution.none}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {report.attributions.map((entry) => (
              <li key={entry.sourceId} className="text-small">
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-target min-w-target items-center text-accent underline"
                >
                  {entry.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={headings.glossary}>
        <dl className="flex flex-col gap-2">
          {wording.glossary.map((entry) => (
            <div key={entry.strength} className="flex flex-wrap items-start gap-3">
              <dt>
                <ClaimStrength strength={entry.strength} />
              </dt>
              <dd className="min-w-0 flex-1 text-small text-ink-secondary">{entry.definition}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <p className="text-caption text-ink-muted">{report.producedBy}</p>
    </article>
  );
}

function CoverageSection({
  coverage,
  wording,
  title,
  omittedClaims,
}: {
  readonly coverage: Coverage;
  readonly wording: ReportDocument["wording"];
  readonly title: string;
  readonly omittedClaims: number;
}) {
  const missed = coverage.entries.filter((entry) => !isCollected(entry.state));
  const got = coverage.entries.filter((entry) => isCollected(entry.state));
  const row = (entry: Coverage["entries"][number]) => (
    <li
      key={entry.collectorId}
      className={cn(
        "flex flex-col gap-1 rounded-md border p-3",
        entry.state === "FAILED"
          ? "border-status-failed-mark bg-status-failed-fill"
          : "border-border-default",
      )}
    >
      <span className="flex flex-wrap items-center gap-2">
        <StatusChip status={STATE_CHIP[entry.state]}>
          {wording.states[entry.state] ?? entry.state}
        </StatusChip>
        <span className="text-body-strong text-ink-primary">{entry.sourceLabel}</span>
        <span className="font-mono text-mono-caption text-ink-muted">{entry.collectorId}</span>
      </span>
      {entry.detail === null ? null : (
        <span className="text-small text-ink-primary">{entry.detail}</span>
      )}
      <span className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
        {entry.reasonCode === null ? null : <span className="font-mono">{entry.reasonCode}</span>}
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

  return (
    <Section title={title}>
      <p className="text-body text-ink-primary">{coverage.headline}</p>
      <section aria-label={wording.headings.notCollected} className="flex flex-col gap-2">
        <Heading>{wording.headings.notCollected}</Heading>
        {missed.length === 0 ? (
          <p className="text-small text-ink-secondary">{wording.coverage.allCollected}</p>
        ) : (
          <ul className="flex flex-col gap-2">{missed.map(row)}</ul>
        )}
      </section>
      <section aria-label={wording.headings.collected} className="flex flex-col gap-2">
        <Heading>{wording.headings.collected}</Heading>
        {got.length === 0 ? (
          <p className="text-small text-ink-secondary">{wording.coverage.noneCollected}</p>
        ) : (
          <ul className="flex flex-col gap-2">{got.map(row)}</ul>
        )}
      </section>
      {coverage.notApplicable.length === 0 ? null : (
        <p className="text-small text-ink-secondary">
          {wording.coverage.notApplicable}
          {coverage.notApplicable.map((entry) => entry.sourceLabel).join("; ")}
        </p>
      )}
      <section aria-label={wording.headings.standingLimits} className="flex flex-col gap-2">
        <Heading>{wording.headings.standingLimits}</Heading>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-ink-secondary">
          {coverage.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </section>
      {omittedClaims > 0 ? (
        <Notice className="text-body-strong">
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
      <Section title={title}>
        <p className="text-small text-ink-secondary">{wording.synthesis.notRequested}</p>
      </Section>
    );
  }
  if (synthesis.status === "SKIPPED") {
    return (
      <Section title={title}>
        <p className="text-small text-ink-secondary">
          {fill(wording.synthesis.none, { reason: synthesis.reason })}
        </p>
      </Section>
    );
  }
  const { model } = synthesis;
  return (
    <Section title={title}>
      <Notice>{synthesis.notice}</Notice>
      <ol className="flex flex-col gap-3">
        {synthesis.statements.map((statement, index) => (
          <li key={index} className="flex flex-col gap-1">
            <p className="text-body text-ink-primary">{statement.text}</p>
            <span className="flex flex-wrap items-center gap-2">
              <ClaimStrength strength={statement.strength} />
              <Citations
                numbers={statement.citations}
                sources={report.sources}
                missing={report.wording.footnote.missing}
              />
            </span>
          </li>
        ))}
      </ol>
      <section
        aria-label="Model provenance"
        className="flex flex-col gap-1 border-t border-border-subtle pt-3"
      >
        <Heading>Model provenance</Heading>
        <p className="text-small text-ink-secondary">
          {fill(wording.synthesis.model, {
            id: model.id,
            licence: model.licence,
            profile: model.profile,
          })}
        </p>
        <p className="text-small text-ink-secondary">
          {model.servedBy === null
            ? fill(wording.synthesis.servedByEndpoint, { endpoint: model.endpointHost })
            : fill(wording.synthesis.servedBy, {
                provider: model.servedBy,
                endpoint: model.endpointHost,
              })}
        </p>
        {/* Printed only when the response carried one, as the stored wording says. */}
        {model.regionHeaders.map((header) => (
          <p key={`${header.name}:${header.value}`} className="text-small text-ink-secondary">
            {fill(wording.synthesis.regionHeader, { name: header.name, value: header.value })}
          </p>
        ))}
        <p className="text-caption text-ink-muted">
          Written <Instant iso={synthesis.generatedAt} /> · {String(synthesis.attempts)} attempt
          {synthesis.attempts === 1 ? "" : "s"}
        </p>
      </section>
    </Section>
  );
}

function FindingsSection({ report }: { readonly report: ReportDocument }) {
  const { wording } = report;
  return (
    <Section title={wording.headings.findings}>
      {report.findings.length === 0 ? (
        <p className="text-small text-ink-secondary">{wording.findings.none}</p>
      ) : (
        report.findings.map((finding) => (
          <section
            key={finding.entityId}
            aria-label={finding.displayName}
            className="flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-center gap-3">
              <EntityClassName entityClass={finding.kind} className="text-caption text-ink-muted" />
              <h3 className="text-body-strong break-all text-ink-primary">
                {finding.displayName}
                {finding.identifier === null ||
                finding.identifier === finding.displayName ? null : (
                  <span className="font-mono text-mono-caption text-ink-secondary">
                    {" "}
                    ({finding.identifier})
                  </span>
                )}
              </h3>
              <PinButton
                target={{ type: "entity", id: finding.entityId }}
                what={finding.displayName}
              />
            </div>
            <ul className="flex flex-col gap-2">
              {finding.claims.map((claim) => (
                <li
                  key={claim.claimId}
                  className={cn(
                    "flex items-start gap-3 rounded-md border p-3",
                    claim.strength === "DERIVED"
                      ? "border-dashed border-claim-derived-mark"
                      : "border-border-default",
                  )}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-small text-ink-secondary">{claim.attribute}</span>
                    {claim.display.text === "" ? (
                      <span className="text-small text-ink-muted">
                        {wording.findings.emptyValue}
                      </span>
                    ) : (
                      <ClaimValue value={claim.display.text} />
                    )}
                    {claim.display.truncated ? (
                      <span className="text-caption text-ink-muted">
                        {wording.findings.shortened}
                      </span>
                    ) : null}
                    <span className="flex flex-wrap items-center gap-2">
                      <ClaimStrength strength={claim.strength} />
                      {claim.strength === "DERIVED" ? (
                        <span className="text-caption text-ink-muted">
                          computed by the platform
                        </span>
                      ) : null}
                      <Citations
                        numbers={claim.citations}
                        sources={report.sources}
                        missing={report.wording.footnote.missing}
                      />
                    </span>
                  </div>
                  <PinButton target={{ type: "claim", id: claim.claimId }} what={claim.attribute} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </Section>
  );
}

function RelationshipsSection({ report }: { readonly report: ReportDocument }) {
  if (report.relationships.length === 0) return null;
  return (
    <Section title={report.wording.headings.relationships}>
      <ul className="flex flex-col gap-2">
        {report.relationships.map((relationship) => {
          const words = `${relationship.from.displayName} ${relationship.kind} ${relationship.to.displayName}`;
          return (
            <li
              key={relationship.relationshipId}
              className="flex items-start gap-3 rounded-md border border-border-default p-3"
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
                  <ClaimStrength strength={relationship.strength} />
                  <Citations
                    numbers={relationship.citations}
                    sources={report.sources}
                    missing={report.wording.footnote.missing}
                  />
                </span>
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
    <Section title={wording.headings.evidenceBasis}>
      <p className="text-small text-ink-secondary">
        {report.sources.length === 0 ? wording.evidence.none : wording.evidence.intro}
      </p>
      <ol className="flex flex-col gap-2">
        {report.sources.map((source) => (
          <li
            key={source.number}
            id={`source-${String(source.number)}`}
            className="flex items-start gap-3 rounded-md border border-border-default p-3"
          >
            <span className="font-mono text-mono-body text-ink-primary">[{source.number}]</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <ProvenanceLink
                  target={{ kind: "evidence", id: source.evidenceId }}
                  label={`Provenance of source ${String(source.number)}: ${source.sourceLabel}`}
                  className="min-w-target text-body-strong"
                >
                  {source.sourceLabel}
                </ProvenanceLink>
                <ClaimStrength strength={source.strength} />
                {/* The stored report's Claims column: how many of its claims rest on this source. */}
                <span className="text-caption text-ink-muted">
                  {wording.evidence.columns.claims}:{" "}
                  <span className="font-mono">{String(source.claimCount)}</span>
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
