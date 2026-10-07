import {
  CommandPalette,
  CommandPaletteButton,
  useCommandPaletteShortcut,
  type PaletteGroup,
  type PaletteItem,
} from "@repo/ui";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState, type ReactNode } from "react";
import { messageFor } from "../messages.ts";
import { Instant } from "./Values.tsx";
import { sessionQuery } from "../session.ts";
import { casesQuery, LIST_LIMIT, type CaseRow } from "../workspace/queries.ts";

/** The built pages, in the side navigation's order. */
const PAGES = [
  { to: "/", label: "Search", hint: "Investigate a target" },
  { to: "/cases", label: "Cases", hint: "Every case in this organisation" },
  { to: "/members", label: "Members", hint: "Who is in this organisation" },
  { to: "/settings", label: "Settings", hint: "This organisation's settings" },
] as const;
type PageTo = (typeof PAGES)[number]["to"];

const TENANT_ID = "tenant";
const CASES_PAGE_ID = "page:/cases";

/** A case's second line: its pins and when it was created, in the shared time form. */
function caseHint(row: CaseRow): { readonly hint: ReactNode; readonly hintText: string } {
  const lead = `Case · ${String(row.pinCount)} pinned · created `;
  const archived = row.archivedAt === null ? "" : " · archived";
  return {
    hint: (
      <>
        {lead}
        <Instant iso={row.createdAt} />
        {archived}
      </>
    ),
    // The filter matches the words, not the formatted time.
    hintText: `${lead}${archived}`,
  };
}

/**
 * The command palette (§9; not drawn) and what opens it: the header's button
 * (unless `button` is false) and Ctrl/⌘K from anywhere on the screen. It goes
 * to a page or a case. Runs are not listed: no endpoint lists a tenant's runs.
 *
 * Cases are read only while the palette is open, so the screen makes no read
 * for it at mount. A failed or cut read is said as an entry that opens the
 * Cases page, where the failure (with Try again) or the cut is shown in full.
 */
export function CommandPaletteHost({ button = true }: { readonly button?: boolean | undefined }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { data: session } = useSuspenseQuery(sessionQuery);
  const cases = useQuery({ ...casesQuery, enabled: open });
  const onOpen = useCallback(() => {
    setOpen(true);
  }, []);
  useCommandPaletteShortcut(onOpen);

  const groups: PaletteGroup[] = [
    {
      label: "Pages",
      items: PAGES.map((page) => ({ id: `page:${page.to}`, label: page.label, hint: page.hint })),
    },
  ];
  if (session.state === "SIGNED_IN" && session.tenants.length > 1) {
    groups.push({
      label: "Organisation",
      items: [{ id: TENANT_ID, label: "Switch organisation", hint: "Choose another one" }],
    });
  }
  const caseItems: PaletteItem[] = [];
  if (cases.isError) {
    const message = messageFor(cases.error);
    caseItems.push({
      id: CASES_PAGE_ID,
      label: "Cases could not be read",
      hint: `${message.text}${message.code === null ? "" : ` Code: ${message.code}.`} Open Cases to try again.`,
    });
  }
  if (cases.data !== undefined) {
    if (cases.data.hasMore) {
      caseItems.push({
        id: CASES_PAGE_ID,
        label: `Partial: the ${String(LIST_LIMIT)} oldest cases were read; newer ones are not listed.`,
        hint: "Open Cases",
      });
    }
    for (const row of cases.data.items) {
      caseItems.push({ id: `case:${row.id}`, label: row.title, ...caseHint(row) });
    }
  }
  if (caseItems.length > 0) groups.push({ label: "Cases", items: caseItems });

  const onSelect = (id: string) => {
    if (id === TENANT_ID) {
      void navigate({ to: "/tenant" });
    } else if (id.startsWith("case:")) {
      void navigate({
        to: "/cases/$caseId/$tab",
        params: { caseId: id.slice("case:".length), tab: "overview" },
      });
    } else if (id.startsWith("page:")) {
      void navigate({ to: id.slice("page:".length) as PageTo });
    }
  };

  return (
    <>
      {button ? <CommandPaletteButton onOpen={onOpen} /> : null}
      <CommandPalette
        open={open}
        onOpenChange={setOpen}
        groups={groups}
        onSelect={onSelect}
        loading={open && cases.isPending ? "Reading cases." : undefined}
        placeholder="Go to a case or a page"
        label="Search pages and cases"
        emptyText="Nothing to open yet."
        noMatchText={(query) => `Nothing matches “${query}”. Try a case name or a page.`}
      />
    </>
  );
}
