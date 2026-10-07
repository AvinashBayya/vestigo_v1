import {
  DashedNote,
  LoadingState,
  RunsRail,
  Skeleton,
  Unmeasured,
  type RunRailItem,
} from "@repo/ui";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId } from "react";
import { timed, unwrap } from "../../api.ts";
import { api } from "../../client/index.ts";
import { ProblemNotice } from "../../components/ProblemNotice.tsx";
import { formatInstant } from "../../run/progress.ts";
import {
  casePinsQuery,
  LIST_LIMIT,
  PIN_TYPES,
  PIN_WORDS,
  PINS_UNCOUNTED,
  runQuery,
  type PinList,
  type Scope,
} from "../queries.ts";

const investigationQuery = (id: string) =>
  queryOptions({
    queryKey: ["investigation", id],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/investigations/{id}", {
          params: { path: { id } },
          signal: timed(signal),
        }),
      ),
  });

const investigationRunsQuery = (id: string) =>
  queryOptions({
    queryKey: ["investigation-runs", id],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET("/api/v1/investigations/{id}/runs", {
          params: { path: { id }, query: { limit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

/**
 * When a run was created, in the shared instant form (the reader's local time
 * with its zone, as Instant writes it). The rail's meta line is text, so the
 * shared formatter is used rather than the element.
 */
const created = (iso: string) => `Created ${formatInstant(iso)}`;

/**
 * The Graph tab's runs rail (Workspace.dc.html, left): a run's investigation
 * and every run in it, each with its own status in words; choosing one opens
 * that run's graph. A case is not linked to runs, so its rail says so rather
 * than listing any, and at its foot counts what is pinned to it (§9 "Pinned
 * to case"), from the case's pins. Discipline filters and their counts are
 * not drawn: no read counts evidence by discipline.
 */
export function GraphRail({ scope }: { readonly scope: Scope }) {
  if (scope.kind === "case") {
    return (
      <div className="flex grow flex-col gap-2">
        <h2 className="px-1.5 text-eyebrow text-ink-muted uppercase">Runs</h2>
        <DashedNote className="px-3 py-2.5">
          A case is not linked to the runs its pins came from, so no run is listed here.
        </DashedNote>
        <PinnedFoot caseId={scope.id} />
      </div>
    );
  }
  return <RunRail runId={scope.id} />;
}

function RunRail({ runId }: { readonly runId: string }) {
  const navigate = useNavigate();
  const run = useQuery(runQuery(runId));
  const investigationId = run.data?.investigationId;
  const investigation = useQuery({
    ...investigationQuery(investigationId ?? ""),
    enabled: investigationId !== undefined,
  });
  const runs = useQuery({
    ...investigationRunsQuery(investigationId ?? ""),
    enabled: investigationId !== undefined,
  });

  const failed = run.error ?? investigation.error ?? runs.error;
  if (failed !== null) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="px-1.5 text-eyebrow text-ink-muted uppercase">Runs</h2>
        <ProblemNotice
          error={failed}
          title="The runs could not be read."
          onRetry={() => {
            void run.refetch();
            void investigation.refetch();
            void runs.refetch();
          }}
        />
      </div>
    );
  }
  if (investigation.data === undefined || runs.data === undefined) {
    return (
      <LoadingState what="Reading the runs." className="px-1.5">
        <Skeleton className="h-target" />
        <Skeleton className="h-target" />
      </LoadingState>
    );
  }

  const target = investigation.data.target;
  const items: RunRailItem[] = runs.data.items.map((item) => ({
    id: item.id,
    target,
    meta: created(item.createdAt),
    status: item.status,
  }));
  return (
    <>
      <RunsRail
        runs={items}
        selectedId={runId}
        onSelect={(id) => {
          void navigate({ to: "/runs/$runId/$tab", params: { runId: id, tab: "graph" } });
        }}
        className="h-auto w-full border-r-0 bg-transparent px-0 py-0"
      />
      {runs.data.hasMore ? (
        <p className="px-1.5 text-caption text-ink-muted">
          Only {String(runs.data.items.length)} of this investigation's runs are listed here; it has
          more.
        </p>
      ) : null}
    </>
  );
}

/**
 * The rail's foot (§9 Runs rail, Workspace.dc.html): what is pinned to the
 * case, counted by kind from the case's pins. Counts are measured; past the
 * read's limit each is an em dash with why, never a short number.
 */
function PinnedFoot({ caseId }: { readonly caseId: string }) {
  const pins = useQuery(casePinsQuery(caseId));
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="mt-auto flex flex-col gap-1.75 border-t border-border-subtle px-1.5 pt-3.25"
    >
      <h2 id={headingId} className="text-eyebrow text-ink-muted uppercase">
        Pinned to case
      </h2>
      {pins.isError ? (
        <ProblemNotice
          error={pins.error}
          title="The pins could not be read."
          onRetry={() => void pins.refetch()}
        />
      ) : pins.data === undefined ? (
        <LoadingState what="Reading the pins.">
          <Skeleton className="h-row-compact" />
        </LoadingState>
      ) : (
        <PinnedCounts pins={pins.data} />
      )}
    </section>
  );
}

function PinnedCounts({ pins }: { readonly pins: PinList }) {
  if (pins.items.length === 0) {
    return <p className="text-small text-ink-secondary">Nothing is pinned yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-1.75 text-small text-ink-secondary">
      {PIN_TYPES.map((type) => {
        const count = pins.items.filter((pin) => pin.target.type === type).length;
        const [one, many] = PIN_WORDS[type];
        // Measured zero is a count like any other; past the limit there is no count at all.
        return (
          <li key={type} className="flex items-center gap-1">
            {pins.hasMore ? (
              <>
                <Unmeasured reason={PINS_UNCOUNTED} /> {many}
              </>
            ) : (
              `${String(count)} ${count === 1 ? one : many}`
            )}
          </li>
        );
      })}
    </ul>
  );
}
