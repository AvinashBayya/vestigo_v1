import { Button, Field, Notice, Panel, Skeleton, StatusChip, Unmeasured } from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
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
 * The search dashboard: one input. Checking a target shows what it is, which
 * sources would run and which would not (with why), and the cost estimate.
 * Nothing runs until the analyst starts it.
 */
export function SearchDashboard() {
  const navigate = useNavigate();
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
    <div className="flex flex-col gap-6">
      <Panel className="flex flex-col gap-4 shadow-card">
        <form className="flex flex-wrap items-end gap-4" onSubmit={onSubmit} noValidate>
          <Field
            className="min-w-0 flex-1"
            label="Target"
            hint="A domain, IP address, email address, phone number, username, organisation or URL."
            name="target"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
            }}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={input.trim() === "" || estimate.isPending}
          >
            {estimate.isPending ? "Checking…" : "Check target"}
          </Button>
        </form>
        {estimate.isError ? <ProblemNotice error={estimate.error} /> : null}
      </Panel>

      {estimate.isPending ? <EstimateSkeleton /> : null}

      {plan === undefined && !estimate.isPending && !estimate.isError ? (
        <Panel className="flex flex-col gap-2">
          <p className="text-eyebrow uppercase text-ink-muted">Before a run</p>
          <p className="text-body text-ink-secondary">
            Check a target to see what kind of target it is, which sources would run and which would
            not, and what it would cost. Nothing is collected until you start a run.
          </p>
        </Panel>
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
