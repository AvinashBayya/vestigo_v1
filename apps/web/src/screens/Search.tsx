import { Button, Notice, Panel, Skeleton, StatusChip, Unmeasured } from "@repo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Search as SearchIcon } from "lucide-react";
import { useId, useState, type ReactNode, type SyntheticEvent } from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import {
  collectorsQuery,
  DISCIPLINE_TEXT,
  readiness,
  readinessNote,
  runsHere,
} from "../collectors.ts";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import {
  creditsText,
  exclusionStatus,
  NOT_APPLICABLE_REASON,
  unmeasuredReason,
  TYPE_LABEL,
  typeOptions,
  type Estimate,
  type PlannedCollector,
  type TargetType,
} from "../search/plan.ts";

interface Check {
  readonly target: string;
  /** The type the analyst chose; null lets detection decide. */
  readonly targetType: TargetType | null;
}

/**
 * The search dashboard (docs/design/mockups/Main.dc.html): one input.
 * Investigating a target first shows what it is, which sources would run and
 * which would not (with why), and the cost estimate; nothing runs until the
 * analyst starts it. Before that, recent cases and collector health.
 */
export function SearchDashboard() {
  const navigate = useNavigate();
  const inputId = useId();
  const [input, setInput] = useState("");
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

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    check(null);
  };

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col items-center gap-5 pt-6">
        <h1 className="text-center text-display text-ink-primary">What are you investigating?</h1>
        <form
          role="search"
          className="flex w-full max-w-search items-center gap-3 rounded-lg border border-border-strong bg-surface-raised py-2 pr-2 pl-4 shadow-card"
          onSubmit={onSubmit}
          noValidate
        >
          <SearchIcon
            className="size-4 shrink-0 text-ink-muted"
            strokeWidth={1.9}
            aria-hidden="true"
          />
          <label htmlFor={inputId} className="sr-only">
            Target to investigate
          </label>
          <input
            id={inputId}
            name="target"
            autoComplete="off"
            spellCheck={false}
            placeholder="Domain, URL, phone number, username or organisation"
            className="min-h-target min-w-0 flex-1 bg-surface-raised text-body text-ink-primary placeholder:text-ink-muted"
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
          <Button type="submit" disabled={input.trim() === "" || estimate.isPending}>
            {estimate.isPending ? "Checking…" : "Investigate"}
          </Button>
        </form>
        <AcceptedTypes />
        {estimate.isError ? (
          <div className="w-full max-w-search">
            <ProblemNotice error={estimate.error} />
          </div>
        ) : null}
      </section>

      {estimate.isPending ? <EstimateSkeleton /> : null}

      {plan === undefined && !estimate.isPending ? (
        <div className="grid gap-6 md:grid-cols-2">
          <RecentCases />
          <CollectorHealth />
        </div>
      ) : null}

      {plan !== undefined && checked !== undefined ? (
        <>
          {stale ? (
            <Notice>
              This plan is for <span className="font-mono">{plan.input}</span>. Check the target
              again to plan for what is in the box now.
            </Notice>
          ) : null}
          <TargetPanel
            plan={plan}
            options={options}
            chosen={chosen}
            disabled={stale || start.isPending}
            onChoose={(type) => {
              check(type === options[0] ? null : type);
            }}
          />
          <CollectorsPanel plan={plan} />
          <ExcludedPanel plan={plan} />
          <Panel className="flex flex-col gap-4">
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
                disabled={stale || plan.collectors.length === 0 || start.isPending}
                onClick={() => {
                  start.mutate({ target: plan.input, targetType: checked.targetType });
                }}
              >
                {start.isPending ? "Starting…" : start.isError ? "Try again" : "Start run"}
              </Button>
              {plan.collectors.length === 0 ? (
                <p className="text-small text-ink-secondary">
                  No source can run for this target, so there is nothing to start.
                </p>
              ) : null}
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

/** While the estimate is computed: the shape of the panels it fills (§8). */
function EstimateSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Checking the target">
      {[0, 1, 2].map((panel) => (
        <Panel key={panel} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-1/4" />
          <Skeleton className="h-target" />
          <Skeleton className="h-target" />
        </Panel>
      ))}
    </div>
  );
}

function Heading({ children }: { readonly children: ReactNode }) {
  return <h2 className="text-eyebrow uppercase text-ink-muted">{children}</h2>;
}

function TargetPanel({
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
    <Panel className="flex flex-col gap-4">
      <Heading>Target</Heading>
      <p className="font-mono text-mono-body text-ink-primary">{plan.input}</p>
      {options.length > 1 ? (
        <fieldset className="flex flex-col gap-2" disabled={disabled}>
          <legend className="text-body-strong text-ink-primary">Treat it as</legend>
          <div className="flex flex-wrap gap-2">
            {options.map((type, index) => (
              <label
                key={type}
                className="inline-flex min-h-target cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 text-body has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:text-accent-ink"
              >
                <input
                  type="radio"
                  name="target-type"
                  value={type}
                  checked={type === current}
                  onChange={() => {
                    onChoose(type);
                  }}
                />
                {TYPE_LABEL[type]}
                {index === 0 ? <span className="text-caption"> (detected)</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-body text-ink-secondary">
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
          <p key={target.type} className="text-small text-status-failed-ink">
            Not a valid {TYPE_LABEL[target.type].toLowerCase()}: {target.invalid}
          </p>
        ))}
    </Panel>
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
      <p className="text-body-strong text-ink-primary">{label}</p>
      {cost.estimatedCredits === null ? (
        <>
          <Unmeasured reason={unmeasuredReason(cost)} />
          <p className="text-small text-ink-secondary">{unmeasuredReason(cost)}</p>
        </>
      ) : (
        <p className="font-mono text-metric text-ink-primary">
          {creditsText(cost.estimatedCredits)}
        </p>
      )}
    </div>
  );
}

function CollectorsPanel({ plan }: { readonly plan: Estimate }) {
  return (
    <Panel className="flex flex-col gap-3">
      <Heading>Sources that would run ({plan.collectors.length})</Heading>
      {plan.collectors.length === 0 ? (
        <p className="text-body text-ink-secondary">
          None. Every source is listed below with the reason it would not run.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {plan.collectors.map((collector) => (
            <li
              key={collector.collectorId}
              className="flex flex-wrap items-center justify-between gap-4 py-3"
            >
              <div className="flex flex-col gap-1">
                <p className="text-body-strong text-ink-primary">{collector.sourceLabel}</p>
                <p className="text-small text-ink-secondary">
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
    </Panel>
  );
}

function ExcludedPanel({ plan }: { readonly plan: Estimate }) {
  const blocked = plan.excluded.filter((row) => row.reason !== NOT_APPLICABLE_REASON);
  const notApplicable = plan.excluded.filter((row) => row.reason === NOT_APPLICABLE_REASON);
  if (plan.excluded.length === 0) return null;
  return (
    <Panel className="flex flex-col gap-3">
      <Heading>Sources that would not run ({blocked.length})</Heading>
      {blocked.length === 0 ? (
        <p className="text-body text-ink-secondary">
          None was held back by policy, plan or licence.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {blocked.map((row) => (
            <li key={row.collectorId} className="flex flex-wrap items-start gap-3 py-3">
              <StatusChip status={exclusionStatus(row.reason)} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-body-strong text-ink-primary">{row.sourceLabel}</p>
                <p className="text-small text-ink-secondary">{row.message}</p>
                <p className="font-mono text-mono-caption text-ink-muted">{row.reason}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {notApplicable.length === 0 ? null : (
        <details className="flex flex-col gap-2">
          <summary className="min-h-target cursor-pointer py-3 text-body text-ink-secondary">
            {notApplicable.length} other sources do not take this kind of target
          </summary>
          <ul className="flex flex-col gap-1">
            {notApplicable.map((row) => (
              <li key={row.collectorId} className="text-small text-ink-secondary">
                <span className="text-ink-primary">{row.sourceLabel}</span>: {row.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

/** The kinds of target some source here runs for, from the collector list. */
function AcceptedTypes() {
  const collectors = useQuery(collectorsQuery);
  if (collectors.data === undefined) return null;
  const list = collectors.data;
  const types = new Set<string>(
    list.items.filter((item) => runsHere(item, list)).flatMap((item) => item.targetTypes),
  );
  if (types.size === 0) {
    return (
      <p className="text-small text-ink-secondary">
        No source can run in this deployment, so no target would collect anything.
      </p>
    );
  }
  const accepted = (Object.keys(TYPE_LABEL) as TargetType[]).filter((type) => types.has(type));
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-small text-ink-muted">
      <span>Sources here run for:</span>
      {accepted.map((type) => (
        <span
          key={type}
          className="rounded-sm border border-border-default bg-surface-raised px-2 py-1 font-mono text-mono-caption text-ink-secondary"
        >
          {TYPE_LABEL[type].toLowerCase()}
        </span>
      ))}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-target" />
      <Skeleton className="h-target" />
      <Skeleton className="h-target" />
    </div>
  );
}

const casesQuery = {
  queryKey: ["cases", "recent"],
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    unwrap(api.GET("/api/v1/cases", { params: { query: { limit: 500 } }, signal: timed(signal) })),
};

/** The newest open cases, by when each was created: cases record no updated time. */
function RecentCases() {
  const cases = useQuery(casesQuery);
  const recent =
    cases.data === undefined
      ? []
      : cases.data.items
          .filter((item) => item.archivedAt === null)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, 3);
  return (
    <Panel className="flex flex-col gap-4">
      <Heading>Recent cases</Heading>
      {cases.isPending ? <PanelSkeleton /> : null}
      {cases.isError ? <ProblemNotice error={cases.error} /> : null}
      {cases.data !== undefined && recent.length === 0 ? (
        <p className="text-body text-ink-secondary">
          No cases yet. A case holds the results you pin to it.
        </p>
      ) : null}
      {recent.length === 0 ? null : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {recent.map((item) => (
            <li key={item.id} className="flex flex-col gap-1 py-3">
              <p className="text-body-strong text-ink-primary">{item.title}</p>
              <p className="text-small text-ink-secondary">
                {item.pinCount} pinned · created{" "}
                <time dateTime={item.createdAt} className="font-mono text-mono-caption">
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
      {cases.data?.hasMore === true ? (
        <p className="text-caption text-ink-muted">
          This organisation has more than 500 cases, and the list returns the oldest first, so newer
          ones may be missing here.
        </p>
      ) : null}
    </Panel>
  );
}

/** What each registered collector is, and whether it can run here. No live health is measured. */
function CollectorHealth() {
  const collectors = useQuery(collectorsQuery);
  const list = collectors.data;
  return (
    <Panel className="flex flex-col gap-4">
      <Heading>Collector health</Heading>
      {collectors.isPending ? <PanelSkeleton /> : null}
      {collectors.isError ? <ProblemNotice error={collectors.error} /> : null}
      {list === undefined ? null : (
        <ul className="flex flex-col divide-y divide-border-subtle">
          {list.items.map((item) => {
            const note = readinessNote(item, list);
            return (
              <li key={item.id} className="flex items-start justify-between gap-3 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-body-strong text-ink-primary">{item.label}</p>
                  <p className="text-small text-ink-secondary">
                    {DISCIPLINE_TEXT[item.discipline]}
                    {note === null ? null : ` · ${note}`}
                  </p>
                </div>
                <StatusChip status={readiness(item, list)} />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
