import { Button, Card, DataTable, Field, type DataTableRow } from "@repo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type SyntheticEvent } from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AppShell } from "../components/AppShell.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { Instant } from "../components/Values.tsx";
import { casesQuery, type CaseRow } from "../workspace/queries.ts";
import { CutListNotice } from "../workspace/states.tsx";

const COLUMNS = [
  { id: "case", header: "Case", kind: "primary" },
  { id: "pins", header: "Pins", kind: "mono", align: "end" },
  { id: "created", header: "Created", kind: "mono-muted" },
  { id: "state", header: "State", kind: "text" },
] as const;

function rowOf(item: CaseRow): DataTableRow {
  return {
    id: item.id,
    cells: {
      case: (
        <Link
          to="/cases/$caseId/$tab"
          params={{ caseId: item.id, tab: "overview" }}
          className="inline-flex min-h-target items-center text-link hover:text-link-hover hover:underline"
        >
          {item.title}
        </Link>
      ),
      // A measured count: 0 is shown as 0.
      pins: String(item.pinCount),
      created: <Instant iso={item.createdAt} className="text-mono-meta" />,
      // In words, never colour alone.
      state: item.archivedAt === null ? "Open" : "Archived",
    },
  };
}

/**
 * The organisation's cases (no mockup draws the list: §9 Data table, §4
 * page title), oldest first as the API lists them, and a way to start one.
 */
export function CasesScreen() {
  const cases = useQuery(casesQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  // Set when Create case is pressed with no title; typing clears it.
  const [emptySubmit, setEmptySubmit] = useState(false);
  const create = useMutation({
    mutationFn: (newTitle: string) =>
      unwrap(
        api.POST("/api/v1/cases", {
          body: { title: newTitle, description: null },
          signal: timed(),
        }),
      ),
    onSuccess: async (created) => {
      setTitle("");
      await queryClient.invalidateQueries({ queryKey: ["cases"] });
      await navigate({
        to: "/cases/$caseId/$tab",
        params: { caseId: created.id, tab: "overview" },
      });
    },
  });
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    // Nothing is sent without a title: the field says why instead.
    if (trimmed === "") {
      setEmptySubmit(true);
      return;
    }
    if (!create.isPending) create.mutate(trimmed);
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6 px-4 py-8 md:px-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-title text-ink-primary">Cases</h1>
          <p className="text-prose-small text-ink-secondary">
            A case holds what you pin to it from any run&apos;s results. It is not linked to the
            runs themselves.
          </p>
        </div>
        {cases.isError ? (
          <ProblemNotice
            error={cases.error}
            title="The cases could not be read."
            onRetry={() => void cases.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {cases.data?.hasMore === true ? (
              <CutListNotice shown={cases.data.items.length} total={null} noun="cases" />
            ) : null}
            <DataTable
              caption="Cases"
              density="comfortable"
              columns={COLUMNS}
              rows={cases.data === undefined ? [] : cases.data.items.map(rowOf)}
              loading={cases.isPending ? "Reading cases." : undefined}
              empty={{
                kind: "empty",
                title: "No cases yet",
                body: "Create one here, or pin a result from a run to create one there.",
              }}
            />
          </div>
        )}
        <Card title="Create a case" className="max-w-form">
          <form onSubmit={submit} noValidate className="flex flex-col gap-3">
            <Field
              label="New case"
              value={title}
              maxLength={200}
              required
              error={emptySubmit ? "Enter a title for the case." : undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                setEmptySubmit(false);
              }}
            />
            <Button type="submit" size="lg" disabled={create.isPending} className="self-start">
              {create.isPending ? "Creating…" : "Create case"}
            </Button>
            {create.isError ? <ProblemNotice error={create.error} /> : null}
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
