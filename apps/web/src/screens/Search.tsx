import {
  Button,
  Card,
  HeroSearch,
  LoadingState,
  NotBuilt,
  Notice,
  Skeleton,
  StatusChip,
  TagList,
  TextLink,
  Unmeasured,
} from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import {
  byReadiness,
  collectorsQuery,
  readiness,
  readinessNote,
  type Collector,
  type CollectorList,
} from "../collectors.ts";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { Instant } from "../components/Values.tsx";
import {
  acceptedTypes,
  creditsText,
  exclusionStatus,
  NOT_APPLICABLE_REASON,
  TYPE_LABEL,
  typeOptions,
  unmeasuredReason,
  type Estimate,
  type PlannedCollector,
  type TargetType,
} from "../search/plan.ts";
import { casesQuery, LIST_LIMIT } from "../workspace/queries.ts";

interface Check {
  readonly target: string;
  /** The type the analyst chose; null lets detection decide. */
  readonly targetType: TargetType | null;
}

/**
 * The search dashboard (docs/design/mockups/Main.dc.html, Dashboard-dark):
 * the hero question and one search shell. Before a search, three cards in the
 * drawn order: recent cases, monitor alerts (not built) and collector health.
 * Investigating a target replaces them with the plan: what the target is,
 * which sources would run and which would not (with why), and the cost
 * estimate; nothing runs until the analyst starts it.
 */
export function SearchDashboard() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  // Set when Investigate is pressed with nothing in the box; typing clears it.
  const [emptySubmit, setEmptySubmit] = useState(false);
  // The types detection offered for this target, kept while the analyst picks one.
  const [options, setOptions] = useState<TargetType[]>([]);
  const [chosen, setChosen] = useState<TargetType | null>(null);
  // The investigation opened for this target: a retry of a failed start reuses it.
  const [investigation, setInvestigation] = useState<{
    readonly id: string;
    readonly target: string;
  } | null>(null);

  const estimate = useMutation({
    mutationFn: (check: Check) =>
      unwrap(
        api.POST("/api/v1/estimates", {
          body: {
            target: check.target,
            ...(check.targetType === null ? {} : { targetType: check.targetType }),
          },
          signal: timed(),
        }),
      ),
    onSuccess: (plan, check) => {
      if (check.targetType === null) setOptions(typeOptions(plan));
    },
  });

  const start = useMutation({
    mutationFn: async (check: Check) => {
      let opened = investigation?.target === check.target ? investigation : null;
      if (opened === null) {
        const created = await unwrap(
          api.POST("/api/v1/investigations", {
            // The investigation is titled with its target; it can be renamed later.
            body: { title: check.target, target: check.target },
            signal: timed(),
          }),
        );
        opened = { id: created.id, target: created.target };
        setInvestigation(opened);
      }
      return unwrap(
        api.POST("/api/v1/investigations/{id}/runs", {
          params: { path: { id: opened.id } },
          body: check.targetType === null ? {} : { targetType: check.targetType },
          signal: timed(),
        }),
      );
    },
    // Straight to the run's live progress.
    onSuccess: async (started) => {
      await navigate({ to: "/runs/$runId", params: { runId: started.id } });
    },
  });

  const plan = estimate.data;
  const checked = estimate.variables;
  // The plan on screen is for what was checked; once the text changes it no longer applies.
  const stale = plan !== undefined && input.trim() !== plan.input;

  const check = (targetType: TargetType | null) => {
    const target = input.trim();
    if (targetType === null) {
      setOptions([]);
      setChosen(null);
    } else {
      setChosen(targetType);
    }
    start.reset();
    estimate.mutate({ target, targetType });
  };

  return (
    <div className="flex flex-col gap-8.5 px-4 pt-13.5 pb-16 md:px-16">
      <section className="flex flex-col items-center gap-5">
        <h1 className="text-center text-display text-ink-primary">What are you investigating?</h1>
        <HeroSearch
          label="Target to investigate"
          placeholder="Domain, IP, email, phone, username, company or URL"
          value={input}
          onValueChange={(next) => {
            setInput(next);
            setEmptySubmit(false);
          }}
          onSubmit={() => {
            // Nothing is sent for an empty box: the reason is said under the shell instead.
            if (input.trim() === "") {
              setEmptySubmit(true);
              return;
            }
            if (!estimate.isPending) check(null);
          }}
          submitLabel={estimate.isPending ? "Checking…" : "Investigate"}
          submitting={estimate.isPending}
        />
        {emptySubmit ? (
          // HeroSearch cannot tie an error to its input, so the message is announced.
          <p role="alert" className="w-full max-w-search text-small text-status-failed-ink">
            Enter a target to investigate: a domain, IP, email, phone, username, company or URL.
          </p>
        ) : null}
        <AcceptedTypes />
        {estimate.isError ? (
          <div className="w-full max-w-search">
            <ProblemNotice error={estimate.error} />
          </div>
        ) : null}
      </section>

      {estimate.isPending ? <EstimateSkeleton /> : null}

      {plan === undefined && !estimate.isPending ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <RecentCases />
          <MonitorAlerts />
          <CollectorHealth />
        </div>
      ) : null}

      {plan !== undefined && checked !== undefined ? (
        <div className="mx-auto flex w-full max-w-search flex-col gap-4">
          {stale ? (
            <Notice>
              This plan is for <span className="font-mono">{plan.input}</span>. Check the target
              again to plan for what is in the box now.
            </Notice>
          ) : null}
          <TargetCard
            plan={plan}
            options={options}
            chosen={chosen}
            disabled={stale || start.isPending}
            onChoose={(type) => {
              check(type === options[0] ? null : type);
            }}
          />
          <CollectorsCard plan={plan} />
          <ExcludedCard plan={plan} />
          <Card title="Cost and start">
            <div className="flex flex-col gap-4">
              <CostLine label="Estimated cost of this run" cost={plan.total} />
              {start.isError ? (
                <ProblemNotice error={start.error}>
                  {investigation === null ? null : (
                    <p>
                      The investigation was opened; trying again starts the run in it rather than
                      opening another.
                    </p>
                  )}
                </ProblemNotice>
              ) : null}
              <div className="flex flex-wrap items-center gap-4">
                <Button
                  size="lg"
                  disabled={stale || plan.collectors.length === 0 || start.isPending}
                  onClick={() => {
                    start.mutate({ target: plan.input, targetType: checked.targetType });
                  }}
                >
                  {start.isPending ? "Starting…" : start.isError ? "Try again" : "Start run"}
                </Button>
                {plan.collectors.length === 0 ? (
                  <p className="text-prose-small text-ink-secondary">
                    No source can run for this target, so there is nothing to start.
                  </p>
                ) : null}
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

/** While the estimate is computed: the shape of the plan's cards (§8). */
function EstimateSkeleton() {
  return (
    <div
      className="mx-auto flex w-full max-w-search flex-col gap-4"
      aria-label="Checking the target"
    >
      <LoadingState what="Checking the target.">
        {[0, 1, 2].map((card) => (
          <Card key={card} label="Checking the target">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-4.5 w-mini-progress" />
              <Skeleton className="h-target" />
              <Skeleton className="h-target" />
            </div>
          </Card>
        ))}
      </LoadingState>
    </div>
  );
}

function TargetCard({
  plan,
  options,
  chosen,
  disabled,
  onChoose,
}: {
  readonly plan: Estimate;
  readonly options: readonly TargetType[];
  readonly chosen: TargetType | null;
  readonly disabled: boolean;
  readonly onChoose: (type: TargetType) => void;
}) {
  const current = chosen ?? options[0];
  return (
    <Card title="Target">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-mono-body break-all text-ink-primary">{plan.input}</p>
        {options.length > 1 ? (
          <fieldset className="flex flex-col gap-2" disabled={disabled}>
            <legend className="text-ui-strong text-ink-primary">Treat it as</legend>
            <div className="flex flex-wrap gap-2">
              {options.map((type, index) => (
                <label
                  key={type}
                  className="inline-flex min-h-target cursor-pointer items-center gap-2 rounded-md border border-border-input px-3 text-ui text-ink-primary has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-ink"
                >
                  <input
                    type="radio"
                    name="target-type"
                    value={type}
                    checked={type === current}
                    onChange={() => {
                      onChoose(type);
                    }}
                    className="accent-accent"
                  />
                  {TYPE_LABEL[type]}
                  {index === 0 ? <span className="text-caption"> (detected)</span> : null}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="text-ui text-ink-secondary">
            {plan.requestedType === null && plan.detectedType !== null
              ? `Detected as: ${TYPE_LABEL[plan.detectedType]}.`
              : plan.requestedType === null
                ? "Its type could not be detected."
                : `Treated as: ${TYPE_LABEL[plan.requestedType]}.`}
          </p>
        )}
        {plan.targets
          .filter((target) => target.invalid !== null)
          .map((target) => (
            <p key={target.type} className="text-caption text-status-failed-ink">
              Not a valid {TYPE_LABEL[target.type].toLowerCase()}: {target.invalid}
            </p>
          ))}
      </div>
    </Card>
  );
}

function credentialsText(collector: PlannedCollector): ReactNode {
  const { vaultIds, runsWithout } = collector.credentials;
  if (vaultIds.length === 0) return "Needs no key.";
  const ids = <span className="font-mono text-mono-caption">{vaultIds.join(", ")}</span>;
  return runsWithout ? (
    <>Uses a key if your organisation has set one ({ids}); runs without it.</>
  ) : (
    <>Needs a key ({ids}). Without one it will not run.</>
  );
}

function CostLine({
  label,
  cost,
}: {
  readonly label: string;
  readonly cost: Pick<PlannedCollector, "estimatedCredits" | "estimatedCreditsReason">;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="text-ui-strong text-ink-primary">{label}</p>
      {cost.estimatedCredits === null ? (
        <>
          <Unmeasured reason={unmeasuredReason(cost)} />
          <p className="text-caption text-ink-muted">{unmeasuredReason(cost)}</p>
        </>
      ) : (
        <p className="font-mono text-metric text-ink-primary">
          {creditsText(cost.estimatedCredits)}
        </p>
      )}
    </div>
  );
}

function CollectorsCard({ plan }: { readonly plan: Estimate }) {
  return (
    <Card title={`Sources that would run (${String(plan.collectors.length)})`}>
      {plan.collectors.length === 0 ? (
        <p className="text-prose-small text-ink-secondary">
          None. Every source is listed below with the reason it would not run.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {plan.collectors.map((collector) => (
            <li
              key={collector.collectorId}
              className="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-col gap-0.75">
                <p className="text-ui-strong text-ink-primary">{collector.sourceLabel}</p>
                <p className="text-caption text-ink-muted">
                  As {TYPE_LABEL[collector.targetType].toLowerCase()}. {credentialsText(collector)}
                </p>
              </div>
              {collector.estimatedCredits === null ? (
                <Unmeasured reason={unmeasuredReason(collector)} />
              ) : (
                <p className="font-mono text-mono-body text-ink-primary">
                  {creditsText(collector.estimatedCredits)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ExcludedCard({ plan }: { readonly plan: Estimate }) {
  const blocked = plan.excluded.filter((row) => row.reason !== NOT_APPLICABLE_REASON);
  const notApplicable = plan.excluded.filter((row) => row.reason === NOT_APPLICABLE_REASON);
  if (plan.excluded.length === 0) return null;
  return (
    <Card title={`Sources that would not run (${String(blocked.length)})`}>
      {blocked.length === 0 ? (
        <p className="text-prose-small text-ink-secondary">
          None was held back by policy, plan or licence.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {blocked.map((row) => (
            <li
              key={row.collectorId}
              className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0"
            >
              <StatusChip status={exclusionStatus(row.reason)} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.75">
                <p className="text-ui-strong text-ink-primary">{row.sourceLabel}</p>
                <p className="text-caption text-ink-muted">{row.message}</p>
                <p className="font-mono text-mono-caption text-ink-muted">{row.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {notApplicable.length === 0 ? null : (
        <details className="mt-2 flex flex-col gap-2 border-t border-border-subtle">
          <summary className="flex min-h-target cursor-pointer items-center text-ui text-ink-secondary">
            {notApplicable.length} other sources do not take this kind of target
          </summary>
          <ul className="flex flex-col gap-1 pb-1">
            {notApplicable.map((row) => (
              <li key={row.collectorId} className="text-caption text-ink-muted">
                <span className="text-ink-primary">{row.sourceLabel}</span>: {row.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

/** The kinds of target some source here runs for, from the collector list. */
function AcceptedTypes() {
  const collectors = useQuery(collectorsQuery);
  if (collectors.isError) {
    // Not an alert: the Collector health card carries the failure and its retry.
    return (
      <p className="text-caption text-ink-muted">
        Which kinds of target can be collected is unknown: the collector list could not be read.
      </p>
    );
  }
  if (collectors.data === undefined) return null;
  const accepted = acceptedTypes(collectors.data);
  if (accepted.length === 0) {
    return (
      <p className="text-caption text-ink-muted">
        No source can run in this deployment, so no target would collect anything.
      </p>
    );
  }
  return (
    <TagList
      className="justify-center"
      label="Sources here run for:"
      tags={accepted.map((type) => TYPE_LABEL[type].toLowerCase())}
    />
  );
}

function CardSkeleton({ what }: { readonly what: string }) {
  return (
    <LoadingState what={what}>
      <Skeleton className="h-target" />
      <Skeleton className="h-target" />
      <Skeleton className="h-target" />
    </LoadingState>
  );
}

/** The newest open cases, by when each was created: cases record no updated time. */
function RecentCases() {
  const cases = useQuery(casesQuery);
  const allCases = (
    <TextLink asChild size="meta">
      <Link to="/cases">All cases</Link>
    </TextLink>
  );
  let body: ReactNode;
  if (cases.isPending) {
    body = <CardSkeleton what="Reading cases." />;
  } else if (cases.isError) {
    body = <ProblemNotice error={cases.error} onRetry={() => void cases.refetch()} />;
  } else {
    // The list is oldest first and cut at the limit: the newest are found by sorting what was read.
    const recent = cases.data.items
      .filter((item) => item.archivedAt === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 3);
    body = (
      <div className="flex flex-col gap-3">
        {cases.data.hasMore ? (
          <Notice className="text-caption">
            Partial: only the {String(LIST_LIMIT)} oldest cases could be read, so newer ones may be
            missing here.
          </Notice>
        ) : null}
        {recent.length === 0 ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-prose-small text-ink-secondary">
              No cases yet. A case holds the results you pin to it.
            </p>
            <TextLink asChild size="meta">
              <Link to="/cases">Create a case</Link>
            </TextLink>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {recent.map((item) => (
              <li key={item.id} className="py-1.5 first:pt-0 last:pb-0">
                <Link
                  to="/cases/$caseId/$tab"
                  params={{ caseId: item.id, tab: "overview" }}
                  className="flex min-h-target items-center text-body-strong text-ink-primary hover:text-link"
                >
                  {item.title}
                </Link>
                <p className="text-meta text-ink-muted">
                  {item.pinCount} pinned · created{" "}
                  <Instant iso={item.createdAt} className="text-mono-meta" />
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <Card title="Recent cases" end={allCases}>
      {body}
    </Card>
  );
}

/** Drawn in the mockup; nothing backs it, so it is the Not built card (§8). No count, no rows. */
function MonitorAlerts() {
  return (
    <section aria-label="Monitor alerts" className="flex">
      <NotBuilt
        title="Monitor alerts"
        needs="Monitors do not exist: nothing watches a target between runs, and no endpoint lists alerts."
        className="w-full"
      />
    </section>
  );
}

/** The note every row shares, when there is more than one row and all say the same; else null. */
function sharedNote(items: readonly Collector[], list: CollectorList): string | null {
  const notes = items.map((item) => readinessNote(item, list));
  const first = notes[0];
  if (notes.length < 2 || first === null || first === undefined) return null;
  return notes.every((note) => note === first) ? first : null;
}

function CollectorRows({
  items,
  list,
}: {
  readonly items: readonly Collector[];
  readonly list: CollectorList;
}) {
  // The same note on every row is said once, above them, rather than repeated.
  const shared = sharedNote(items, list);
  const rows = (
    <ul className="flex flex-col gap-2.75">
      {items.map((item) => {
        const note = shared === null ? readinessNote(item, list) : null;
        return (
          <li key={item.id} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.75">
              <p className="text-ui text-ink-primary">{item.label}</p>
              {note === null ? null : <p className="text-caption text-ink-muted">{note}</p>}
            </div>
            <StatusChip status={readiness(item, list)} />
          </li>
        );
      })}
    </ul>
  );
  if (shared === null) return rows;
  return (
    <div className="flex flex-col gap-2.75">
      <p className="text-caption text-ink-muted">{shared}</p>
      {rows}
    </div>
  );
}

/**
 * Each registered collector and whether it can run here, as the registry
 * declares it. The ones that run are listed; the held ones sit behind a
 * disclosure that states how many there are. No live health is measured, so
 * no row says "Needs key" or "Unavailable".
 */
function CollectorHealth() {
  const collectors = useQuery(collectorsQuery);
  let body: ReactNode;
  if (collectors.isPending) {
    body = <CardSkeleton what="Reading the collector list." />;
  } else if (collectors.isError) {
    body = <ProblemNotice error={collectors.error} onRetry={() => void collectors.refetch()} />;
  } else if (collectors.data.items.length === 0) {
    body = (
      <p className="text-prose-small text-ink-secondary">
        No collector is registered in this deployment.
      </p>
    );
  } else {
    const list = collectors.data;
    const { ready, held } = byReadiness(list);
    body = (
      <div className="flex flex-col gap-3">
        <p className="text-caption text-ink-muted">
          As the registry declares them. Live health is not measured.
        </p>
        {ready.length === 0 ? (
          <p className="text-prose-small text-ink-secondary">
            None of them can run in this deployment.
          </p>
        ) : (
          <CollectorRows items={ready} list={list} />
        )}
        {held.length === 0 ? null : (
          <details className="flex flex-col gap-2 border-t border-border-subtle">
            <summary className="flex min-h-target cursor-pointer items-center text-ui text-ink-secondary">
              {held.length} held: not enabled here
            </summary>
            <CollectorRows items={held} list={list} />
          </details>
        )}
      </div>
    );
  }
  return <Card title="Collector health">{body}</Card>;
}
