import { Button, Notice, TextLink } from "@repo/ui";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { timed, unwrap } from "../api.ts";
import { api } from "../client/index.ts";
import { AppShell } from "../components/AppShell.tsx";
import { AuthFrame } from "../components/AuthFrame.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { homeOf, sessionQuery } from "../session.ts";

const TITLE = "Choose an organisation";
const INTRO = "Your work is kept separately in each one.";

/**
 * Choosing the organisation (tenant) this session works in (no mockup). The
 * first choice after signing in sits in the sign-in frame, since no
 * organisation is open yet; switching from one already open sits in the app
 * frame, like any other page. The one in use is marked Current, in words and
 * aria-current.
 */
export function TenantScreen() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const activeTenantId = session.state === "SIGNED_IN" ? session.activeTenantId : null;

  if (activeTenantId === null) {
    return (
      <AuthFrame title={TITLE} intro={INTRO}>
        <TenantChoice />
      </AuthFrame>
    );
  }
  return (
    <AppShell>
      <div className="flex max-w-form flex-col gap-6 px-4 py-8 md:px-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-title text-ink-primary">{TITLE}</h1>
          <p className="text-prose-small text-ink-secondary">{INTRO}</p>
        </div>
        <TenantChoice>
          <TextLink asChild className="self-start">
            <Link to="/">Back to search</Link>
          </TextLink>
        </TenantChoice>
      </div>
    </AppShell>
  );
}

/** The organisations as buttons, with any failure under them, then `children`. */
function TenantChoice({ children }: { readonly children?: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSuspenseQuery(sessionQuery);

  const choose = useMutation({
    mutationFn: (tenantId: string) =>
      unwrap(api.POST("/api/v1/session/tenant", { body: { tenantId }, signal: timed() })),
    onSuccess: async (next) => {
      queryClient.setQueryData(sessionQuery.queryKey, next);
      await navigate({ to: homeOf(next) });
    },
  });

  const tenants = session.state === "SIGNED_IN" ? session.tenants : [];
  const activeTenantId = session.state === "SIGNED_IN" ? session.activeTenantId : null;
  return (
    <div className="flex flex-col gap-6.5">
      {tenants.length === 0 ? (
        <Notice tone="info">
          This account is not a member of any organisation. Ask an administrator to invite you.
        </Notice>
      ) : (
        // Every row reserves the same trailing width (space-16, room for "Current"), so the
        // buttons line up whichever row is Current. Tokens only: no arbitrary grid tracks.
        <ul className="flex flex-col gap-2">
          {tenants.map((tenant) => {
            const current = tenant.id === activeTenantId;
            const opening = choose.isPending && choose.variables === tenant.id;
            return (
              <li key={tenant.id} className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="lg"
                  className="min-w-0 grow justify-start"
                  aria-current={current ? "true" : undefined}
                  disabled={choose.isPending}
                  onClick={() => {
                    choose.mutate(tenant.id);
                  }}
                >
                  <span className="truncate">{opening ? "Opening…" : tenant.name}</span>
                </Button>
                {/* Beside the button, so the button's name stays the organisation's name. */}
                <span className="w-16 shrink-0 text-caption text-ink-muted">
                  {current ? "Current" : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {choose.isError ? <ProblemNotice error={choose.error} /> : null}
      {children}
    </div>
  );
}
