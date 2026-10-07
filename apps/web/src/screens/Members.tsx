import { DataTable, Tag, Unmeasured, type DataTableColumn, type DataTableRow } from "@repo/ui";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { ApiProblem, timed, unwrap } from "../api.ts";
import { api, type paths } from "../client/index.ts";
import { AppShell } from "../components/AppShell.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { Instant, plural } from "../components/Values.tsx";
import { sessionQuery } from "../session.ts";
import { LIST_LIMIT } from "../workspace/queries.ts";
import { CutListNotice } from "../workspace/states.tsx";

type MemberList = paths["/api/v1/members"]["get"]["responses"][200]["content"]["application/json"];
type InvitationList =
  paths["/api/v1/members/invitations"]["get"]["responses"][200]["content"]["application/json"];

/** No mockup draws this screen; the label says so, so no one takes it for a designed one. */
const PROVISIONAL_LABEL = "Provisional: no screen design yet";

/** Keyed by tenant, so one organisation's members are never shown under another. */
const membersQuery = (tenantId: string) =>
  queryOptions({
    queryKey: ["members", tenantId],
    queryFn: ({ signal }): Promise<MemberList> =>
      unwrap(
        api.GET("/api/v1/members", {
          params: { query: { limit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

const invitationsQuery = (tenantId: string) =>
  queryOptions({
    queryKey: ["invitations", tenantId],
    queryFn: ({ signal }): Promise<InvitationList> =>
      unwrap(
        api.GET("/api/v1/members/invitations", {
          params: { query: { limit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

/** Roles as words, from the API's role names (an exhaustive map: a new role fails to compile). */
const ROLE_TEXT: Readonly<Record<NonNullable<MemberList["items"][number]["role"]>, string>> = {
  owner: "Owner",
  admin: "Admin",
  analyst: "Analyst",
  viewer: "Viewer",
};

const STATUS_TEXT: Readonly<Record<MemberList["items"][number]["status"], string>> = {
  ACTIVE: "Active",
  DISABLED: "Disabled",
};

const MEMBER_COLUMNS: readonly DataTableColumn[] = [
  { id: "name", header: "Name", kind: "primary" },
  { id: "email", header: "Email", kind: "mono" },
  { id: "role", header: "Role" },
  { id: "status", header: "Account" },
  { id: "created", header: "Account created" },
];

const INVITATION_COLUMNS: readonly DataTableColumn[] = [
  { id: "email", header: "Email", kind: "mono" },
  { id: "roles", header: "Role" },
  { id: "invitedBy", header: "Invited by" },
  { id: "sent", header: "Sent" },
  { id: "expires", header: "Expires" },
];

/** A refusal for lack of permission: retrying cannot change it, so it offers no retry. */
const retryFor = (error: unknown, refetch: () => unknown) =>
  error instanceof ApiProblem && error.status === 403
    ? undefined
    : () => {
        void refetch();
      };

/**
 * Provisional (U1-c): no mockup draws this screen, so it is the standard page
 * with existing components only. It reads the organisation's members and its
 * pending invitations. Inviting, changing a role and removing a member are
 * backed by the API but not built here, and the page says so.
 */
export function MembersScreen() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  // The route guard admits only a signed-in person with an organisation chosen.
  const tenantId = session.state === "SIGNED_IN" ? session.activeTenantId : null;

  return (
    <AppShell>
      <div className="flex flex-col gap-6 px-4 py-8 md:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title text-ink-primary">Members</h1>
          <Tag mono={false}>{PROVISIONAL_LABEL}</Tag>
        </div>
        <p className="text-body text-ink-secondary">
          The people in this organisation and the invitations still waiting to be accepted, as the
          API lists them. Inviting someone, changing a role and removing a member are not built in
          this provisional screen.
        </p>
        {tenantId === null ? null : <MembersAndInvitations tenantId={tenantId} />}
      </div>
    </AppShell>
  );
}

function MembersAndInvitations({ tenantId }: { readonly tenantId: string }) {
  const members = useQuery(membersQuery(tenantId));
  const invitations = useQuery(invitationsQuery(tenantId));
  const emailOf = new Map((members.data?.items ?? []).map((row) => [row.userId, row.email]));

  return (
    <>
      <section aria-label="Members" className="flex flex-col gap-3">
        <h2 className="text-section-label text-ink-muted uppercase">People in this organisation</h2>
        {members.isError ? (
          <ProblemNotice
            error={members.error}
            title="The members could not be read."
            onRetry={retryFor(members.error, members.refetch)}
          />
        ) : (
          <>
            {members.data?.hasMore === true ? (
              <CutListNotice shown={members.data.items.length} total={null} noun="members" />
            ) : null}
            <DataTable
              caption="Members"
              columns={MEMBER_COLUMNS}
              loading={members.isPending ? "Reading the organisation's members." : undefined}
              rows={(members.data?.items ?? []).map((row): DataTableRow => ({
                id: row.userId,
                cells: {
                  name:
                    row.displayName === null ? (
                      <Unmeasured reason="No display name is recorded for this account." />
                    ) : (
                      row.displayName
                    ),
                  email: row.email,
                  role:
                    row.role === null ? (
                      <Unmeasured reason="No role: this account is no longer a member of this organisation." />
                    ) : (
                      ROLE_TEXT[row.role]
                    ),
                  status: STATUS_TEXT[row.status],
                  created: <Instant iso={row.createdAt} />,
                },
              }))}
              empty={{
                kind: "empty",
                title: "No members listed",
                body: "The API listed no members for this organisation.",
              }}
              // An empty table says so in its empty state; a count under it would repeat it.
              footer={
                members.data === undefined || members.data.items.length === 0
                  ? undefined
                  : {
                      start: members.data.hasMore
                        ? `${String(members.data.items.length)} shown; the organisation has more`
                        : plural(members.data.items.length, "member"),
                    }
              }
            />
          </>
        )}
      </section>

      <section aria-label="Pending invitations" className="flex flex-col gap-3">
        <h2 className="text-section-label text-ink-muted uppercase">Pending invitations</h2>
        {invitations.isError ? (
          <ProblemNotice
            error={invitations.error}
            title="The pending invitations could not be read."
            onRetry={retryFor(invitations.error, invitations.refetch)}
          />
        ) : (
          <>
            {invitations.data?.hasMore === true ? (
              <CutListNotice
                shown={invitations.data.items.length}
                total={null}
                noun="pending invitations"
              />
            ) : null}
            <DataTable
              caption="Pending invitations"
              columns={INVITATION_COLUMNS}
              loading={invitations.isPending ? "Reading the pending invitations." : undefined}
              rows={(invitations.data?.items ?? []).map((row): DataTableRow => ({
                id: row.id,
                cells: {
                  email: row.email,
                  roles:
                    row.roles.length === 0 ? (
                      <Unmeasured reason="The invitation names no role this app recognises." />
                    ) : (
                      row.roles.map((role) => ROLE_TEXT[role]).join(", ")
                    ),
                  // The inviter's email when the members list has it; otherwise their id.
                  invitedBy: emailOf.get(row.invitedByUserId) ?? (
                    <span className="font-mono text-mono-meta">{row.invitedByUserId}</span>
                  ),
                  sent: <Instant iso={row.createdAt} />,
                  expires: <Instant iso={row.expiresAt} />,
                },
              }))}
              empty={{
                kind: "empty",
                title: "No pending invitations",
                body: "No invitation is waiting to be accepted. Sending one is not built in this provisional screen.",
              }}
              footer={
                invitations.data === undefined || invitations.data.items.length === 0
                  ? undefined
                  : {
                      start: invitations.data.hasMore
                        ? `${String(invitations.data.items.length)} shown; there are more`
                        : plural(invitations.data.items.length, "pending invitation"),
                    }
              }
            />
          </>
        )}
      </section>
    </>
  );
}
