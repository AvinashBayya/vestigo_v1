import { Button, Field, Panel } from "@repo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type SyntheticEvent } from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AppShell } from "../components/AppShell.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { Heading, Instant, plural } from "../components/Values.tsx";
import { casesQuery, LIST_LIMIT } from "../workspace/queries.ts";
import { CutListNotice, Loaded, TableSkeleton } from "../workspace/states.tsx";

/** The organisation's cases, oldest first as the API lists them, and a way to open one. */
export function CasesScreen() {
  const cases = useQuery(casesQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
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
    if (trimmed !== "") create.mutate(trimmed);
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <h1 className="text-display text-ink-primary">Cases</h1>
        <p className="text-body text-ink-secondary">
          A case holds what you pin to it from any run's results. It is not linked to the runs
          themselves.
        </p>
        <Loaded query={cases} loading={<TableSkeleton label="Reading cases" />}>
          {(data) =>
            data.items.length === 0 ? (
              <Panel className="text-body text-ink-secondary">
                No case yet. Create one here, or pin a result from a run to create one there.
              </Panel>
            ) : (
              <div className="flex flex-col gap-3">
                {data.hasMore ? (
                  <CutListNotice shown={data.items.length} total={null} noun="cases" />
                ) : null}
                <Panel className="flex flex-col">
                  <Heading>
                    Cases (
                    {data.hasMore ? `${String(LIST_LIMIT)} shown` : String(data.items.length)})
                  </Heading>
                  <ul className="flex flex-col">
                    {data.items.map((row) => (
                      <li
                        key={row.id}
                        className="flex flex-wrap items-center gap-4 border-b border-border-subtle py-2"
                      >
                        <Link
                          to="/cases/$caseId/$tab"
                          params={{ caseId: row.id, tab: "overview" }}
                          className="min-h-target flex-1 content-center text-body-strong text-accent underline"
                        >
                          {row.title}
                        </Link>
                        <span className="text-small text-ink-secondary">
                          {plural(row.pinCount, "pin")}
                        </span>
                        <span className="text-small text-ink-muted">
                          Opened <Instant iso={row.createdAt} />
                        </span>
                        {row.archivedAt === null ? null : (
                          <span className="text-small text-ink-muted">Archived</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            )
          }
        </Loaded>
        <Panel className="flex max-w-form flex-col gap-3">
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field
              label="New case"
              value={title}
              maxLength={200}
              onChange={(event) => {
                setTitle(event.target.value);
              }}
            />
            <Button
              type="submit"
              disabled={title.trim() === "" || create.isPending}
              className="self-start"
            >
              Create case
            </Button>
          </form>
          {create.isError ? <ProblemNotice error={create.error} /> : null}
        </Panel>
      </div>
    </AppShell>
  );
}
