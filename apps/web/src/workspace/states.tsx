import { Notice, Panel, Skeleton } from "@repo/ui";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { LIST_LIMIT } from "./queries.ts";

/** A Not built body inside a titled card: the card draws the edge, so the body draws none. */
export const NOT_BUILT_BODY = "rounded-none border-0 bg-transparent p-0";

/** Loading in the shape of a table (§8): rows, never a centred spinner. */
export function TableSkeleton({
  label,
  rows = 5,
}: {
  readonly label: string;
  readonly rows?: number;
}) {
  return (
    <Panel aria-busy="true" aria-label={label} className="flex flex-col gap-3">
      <Skeleton className="h-target" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-target" />
      ))}
    </Panel>
  );
}

/**
 * A read's pending and failed states (§8), or its content once it is in. A
 * failure is the §8 Failed alert with "Try again"; a refusal carrying
 * `locked` renders as the Locked state instead, through ProblemNotice.
 */
export function Loaded<T>({
  query,
  loading,
  children,
}: {
  readonly query: UseQueryResult<T>;
  readonly loading: ReactNode;
  readonly children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{loading}</>;
  if (query.isError) {
    // §8 Failed, with its retry: the same design as every other failure.
    return <ProblemNotice error={query.error} onRetry={() => void query.refetch()} />;
  }
  return <>{children(query.data)}</>;
}

/**
 * The Partial state (§8) for a list cut at the read limit: what is shown, of
 * how many when that is known, and what that means for sorting and filtering.
 */
export function CutListNotice({
  shown,
  total,
  noun,
}: {
  readonly shown: number;
  /** The measured total, or null when the API gives none. */
  readonly total: number | null;
  readonly noun: string;
}) {
  return (
    <Notice className="flex flex-col gap-1">
      <p className="text-body-strong">
        Partial: {String(shown)} of{" "}
        {total === null ? `more than ${String(LIST_LIMIT)}` : String(total)} {noun}.
      </p>
      <p className="text-small">
        A read returns at most {String(LIST_LIMIT)}, and the API cannot page past them yet. Sorting
        and filtering here apply to these {String(shown)} only.
      </p>
    </Notice>
  );
}
