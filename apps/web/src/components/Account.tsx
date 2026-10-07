import { AccountMenu } from "@repo/ui";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { HealthStatus } from "../HealthStatus.tsx";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { timed, unwrap, type SessionState } from "../api.ts";
import { api } from "../client/index.ts";
import { sessionQuery } from "../session.ts";
import { applyTheme, currentTheme, type Theme } from "../theme.ts";
import { ProblemNotice } from "./ProblemNotice.tsx";

type SignedIn = Extract<SessionState, { state: "SIGNED_IN" }>;

/** Up to two initials from the person's name, else the first letter of their email. */
export function initialsOf(user: SignedIn["user"]): string {
  const fromName = user.name
    .split(/\s+/)
    .map((word) => /\p{L}/u.exec(word)?.[0] ?? "")
    .filter((letter) => letter !== "")
    .slice(0, 2)
    .join("");
  return (fromName === "" ? user.email.slice(0, 1) : fromName).toUpperCase();
}

/**
 * The account button and its menu (§9 Account menu), wired to this app: the
 * signed-in person and organisation from the session, the Light/Dark radio
 * pair as the theme toggle (applyTheme: `<html data-theme>` and the stored
 * choice), Switch organisation only where there is another one, and Sign out.
 *
 * Used by the app frame's header and, at the far right of their
 * ContextHeader (`account` slot), by the full-bleed run and workspace screens,
 * so the theme, the organisation and sign-out are reachable from every
 * signed-in screen. Renders nothing for a session that is not signed in.
 */
export function AccountButton() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  if (session.state !== "SIGNED_IN") return null;
  return <SignedInAccount session={session} />;
}

function SignedInAccount({ session }: { readonly session: SignedIn }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [theme, setTheme] = useState<Theme>(currentTheme);
  const tenant = session.tenants.find((candidate) => candidate.id === session.activeTenantId);

  const signOut = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/session/sign-out", { signal: timed() })),
    onSuccess: async (next) => {
      queryClient.setQueryData(sessionQuery.queryKey, next);
      await navigate({ to: "/sign-in", search: { reason: "signed-out" } });
    },
  });

  return (
    <AccountMenu
      initials={initialsOf(session.user)}
      name={session.user.name}
      email={session.user.email}
      organisation={tenant?.name ?? null}
      theme={theme}
      onThemeChange={(next) => {
        applyTheme(next);
        setTheme(next);
      }}
      onSwitchOrganisation={
        session.tenants.length > 1
          ? () => {
              void navigate({ to: "/tenant" });
            }
          : undefined
      }
      onSignOut={() => {
        // One request at a time: a second press while one is out does nothing.
        if (!signOut.isPending) signOut.mutate();
      }}
      signingOut={signOut.isPending}
      footer={
        <>
          <HealthStatus />
          {signOut.isError ? (
            <ProblemNotice error={signOut.error} title="You are still signed in." />
          ) : null}
        </>
      }
    />
  );
}
