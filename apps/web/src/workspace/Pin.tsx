import {
  Button,
  Field,
  Notice,
  PinButton as PinToggle,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState, type SyntheticEvent } from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { meQuery } from "../me.ts";
import { sessionQuery } from "../session.ts";
import {
  casePinsQuery,
  casesQuery,
  type CaseRow,
  type PinRow,
  type PinTarget,
  type Scope,
} from "./queries.ts";

const KIND_WORD: Readonly<Record<PinTarget["type"], string>> = {
  evidence: "evidence",
  entity: "entity",
  claim: "claim",
  relationship: "relationship",
};

/** Whether the reader's role may pin; null while /me is still being read. */
function useCanPin(): boolean | null {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const tenantId = session.state === "SIGNED_IN" ? session.activeTenantId : null;
  const me = useQuery({ ...meQuery(tenantId ?? ""), enabled: tenantId !== null });
  if (me.data === undefined) return null;
  return me.data.permissions.includes("case:write");
}

/**
 * What a read says about an item's pin state in this scope. In a case, an
 * item found among the case's own pins is pinned (true). Anything else is
 * unknown (null): no read says whether an item is pinned to some case, and
 * the case's pins are read only to their first 500. "Not pinned" is never
 * claimed, because nothing here could know it.
 */
export function usePinState(scope: Scope): (target: PinTarget) => true | null {
  const pins = useQuery({ ...casePinsQuery(scope.id), enabled: scope.kind === "case" });
  const known = useMemo(() => {
    const keys = new Set<string>();
    if (scope.kind !== "case") return keys;
    for (const pin of pins.data?.items ?? []) keys.add(`${pin.target.type}:${pin.target.id}`);
    return keys;
  }, [scope.kind, pins.data]);
  return useCallback(
    (target: PinTarget) => (known.has(`${target.type}:${target.id}`) ? true : null),
    [known],
  );
}

/**
 * Pin-to-case (§9): on every result surface. Pins what is shown, by its type
 * and id, to an open case the reader chooses or creates here. The trigger is
 * the library's pin button: "✓" only when a read (or this session's own pin)
 * says the item is pinned, otherwise "+" with no pressed state at all.
 */
export function PinButton({
  target,
  what,
  pinned = null,
}: {
  readonly target: PinTarget;
  /** What is being pinned, in words, for the button's accessible name. */
  readonly what: string;
  /** True when a read says it is pinned; null when nothing says (never a guessed false). */
  readonly pinned?: true | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [pinnedHere, setPinnedHere] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PinToggle
          pinned={pinned === true || pinnedHere ? true : null}
          label={`Pin ${KIND_WORD[target.type]} to a case: ${what}`}
        />
      </PopoverTrigger>
      <PopoverContent className="w-form">
        {open ? (
          <PinPanel
            target={target}
            onPinned={() => {
              setPinnedHere(true);
            }}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function PinPanel({
  target,
  onPinned,
}: {
  readonly target: PinTarget;
  readonly onPinned: () => void;
}) {
  const canPin = useCanPin();
  const cases = useQuery(casesQuery);
  const queryClient = useQueryClient();
  const [pinned, setPinned] = useState<{ title: string; already: boolean } | null>(null);
  const [title, setTitle] = useState("");

  const pin = useMutation({
    mutationFn: async (caseRow: Pick<CaseRow, "id" | "title">) => {
      const response = await api.POST("/api/v1/cases/{id}/pins", {
        params: { path: { id: caseRow.id } },
        body: { target, note: null },
        signal: timed(),
      });
      const row: PinRow = await unwrap(Promise.resolve(response));
      return { row, already: response.response.status === 200, title: caseRow.title };
    },
    onSuccess: async ({ row, already, title: caseTitle }) => {
      setPinned({ title: caseTitle, already });
      onPinned();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cases"] }),
        queryClient.invalidateQueries({ queryKey: ["case", row.caseId] }),
        queryClient.invalidateQueries({ queryKey: ["case-pins", row.caseId] }),
        queryClient.invalidateQueries({ queryKey: ["entities", "case", row.caseId] }),
        queryClient.invalidateQueries({ queryKey: ["graph", "case", row.caseId] }),
        queryClient.invalidateQueries({ queryKey: ["timeline", "case", row.caseId] }),
      ]);
    },
  });

  const create = useMutation({
    mutationFn: (newTitle: string) =>
      unwrap(
        api.POST("/api/v1/cases", {
          body: { title: newTitle, description: null },
          signal: timed(),
        }),
      ),
    onSuccess: (created) => {
      setTitle("");
      pin.mutate(created);
    },
  });

  if (canPin === false) {
    return (
      <Notice>
        Your role in this organisation cannot pin to cases. Pinning needs the case:write permission;
        an owner or administrator can change your role.
      </Notice>
    );
  }
  if (pinned !== null) {
    return (
      <Notice>
        {pinned.already ? "Already pinned to " : "Pinned to "}
        <span className="text-small-strong">{pinned.title}</span>.
      </Notice>
    );
  }

  const open = (cases.data?.items ?? []).filter((row) => row.archivedAt === null);
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed !== "") create.mutate(trimmed);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-eyebrow text-ink-muted uppercase">Pin to a case</p>
      {cases.isPending ? (
        <p className="text-small text-ink-muted">Reading your cases…</p>
      ) : cases.isError ? (
        <ProblemNotice error={cases.error} />
      ) : open.length === 0 ? (
        <p className="text-small text-ink-secondary">
          No open case yet. Name one below to create it.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {open.map((row) => (
            <li key={row.id}>
              <Button
                variant="secondary"
                size="md"
                className="w-full justify-start"
                disabled={pin.isPending || canPin === null}
                onClick={() => {
                  pin.mutate(row);
                }}
              >
                {row.title}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {cases.data?.hasMore === true ? (
        <p className="text-caption text-ink-muted">
          Only the oldest {String(cases.data.items.length)} cases are listed here.
        </p>
      ) : null}
      <form onSubmit={submit} className="flex flex-col gap-2">
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
          variant="secondary"
          size="md"
          disabled={title.trim() === "" || create.isPending || pin.isPending || canPin === null}
        >
          Create and pin
        </Button>
      </form>
      {pin.isError ? <ProblemNotice error={pin.error} /> : null}
      {create.isError ? <ProblemNotice error={create.error} /> : null}
    </div>
  );
}
