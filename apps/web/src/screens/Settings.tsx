import { Card, KeyValueList, LoadingState, NotBuilt, Skeleton, Tag } from "@repo/ui";
import { queryOptions, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ApiProblem, timed, unwrap } from "../api.ts";
import { api, type paths } from "../client/index.ts";
import { AppShell } from "../components/AppShell.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { sessionQuery } from "../session.ts";

type Retention =
  paths["/api/v1/settings/retention"]["get"]["responses"][200]["content"]["application/json"];

/** No mockup draws this screen; the label says so, so no one takes it for a designed one. */
const PROVISIONAL_LABEL = "Provisional: no screen design yet";

/** Keyed by tenant, so one organisation's settings are never shown under another. */
const retentionQuery = (tenantId: string) =>
  queryOptions({
    queryKey: ["settings", "retention", tenantId],
    queryFn: ({ signal }): Promise<Retention> =>
      unwrap(api.GET("/api/v1/settings/retention", { signal: timed(signal) })),
  });

/**
 * The report handling marking can be set (PUT) but the API has no read for
 * it, so its current value is unknown here: an em dash with that reason.
 */
const MARKING_UNREADABLE =
  "The API can set this marking but has no way to read it back, so the current marking cannot be shown here.";

/**
 * Whether deletion follows the retention window, in the API's own terms
 * (`enforced`). Each value is said as it is; neither is assumed.
 */
function enforcementText(enforced: boolean): string {
  return enforced
    ? "Enforced: the API reports that evidence is deleted when the window passes."
    : "Not enforced: nothing deletes evidence when the window passes yet.";
}

/** Settings areas the API has but this provisional screen does not show. Text only, no figures. */
const NOT_BUILT_AREAS = [
  {
    area: "API keys",
    title: "This organisation's API keys",
    needs:
      "This provisional screen does not list, issue, rotate or revoke API keys. The API's api-keys endpoints do.",
  },
  {
    area: "Credentials",
    title: "Provider credentials stored for collectors",
    needs:
      "This provisional screen does not list, store or revoke credentials. The API's credentials endpoints do.",
  },
  {
    area: "Scope authorisations",
    title: "Recorded authorisations for active collection",
    needs:
      "This provisional screen does not list, record or revoke scope authorisations. The API's scope-authorisations endpoints do.",
  },
  {
    area: "Usage",
    title: "Upstream requests beside this organisation's quotas",
    needs: "This provisional screen does not read usage. The API's usage endpoint does.",
  },
] as const;

/**
 * Provisional (U1-c): no mockup draws this screen, so it is the standard page
 * with existing components only. It reads the retention window; changing any
 * setting is backed by the API but not built here, and the page says so.
 */
export function SettingsScreen() {
  const { data: session } = useSuspenseQuery(sessionQuery);
  // The route guard admits only a signed-in person with an organisation chosen.
  const tenantId = session.state === "SIGNED_IN" ? session.activeTenantId : null;

  return (
    <AppShell>
      <div className="flex flex-col gap-6 px-4 py-8 md:px-10">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title text-ink-primary">Settings</h1>
          <Tag mono={false}>{PROVISIONAL_LABEL}</Tag>
        </div>
        <p className="text-body text-ink-secondary">
          This organisation&apos;s settings, as the API reports them. Changing a setting is not
          built in this provisional screen.
        </p>
        {/* All six areas in one grid; a Not built area is its own card, never a card in a card. */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Reports">
            <KeyValueList
              rows={[{ key: "Report handling marking", value: null, reason: MARKING_UNREADABLE }]}
            />
          </Card>
          {tenantId === null ? null : <RetentionCard tenantId={tenantId} />}
          {NOT_BUILT_AREAS.map((item) => (
            <section key={item.area} aria-label={item.area} className="flex">
              <NotBuilt title={item.title} needs={item.needs} className="w-full" />
            </section>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function RetentionCard({ tenantId }: { readonly tenantId: string }) {
  const retention = useQuery(retentionQuery(tenantId));
  let body: ReactNode;
  if (retention.isPending) {
    body = (
      <LoadingState what="Reading the retention window.">
        <Skeleton className="h-target" />
        <Skeleton className="h-target" />
      </LoadingState>
    );
  } else if (retention.isError) {
    const refused = retention.error instanceof ApiProblem && retention.error.status === 403;
    body = (
      <ProblemNotice
        error={retention.error}
        title="The retention window could not be read."
        // A refusal for lack of permission cannot change on retry.
        onRetry={
          refused
            ? undefined
            : () => {
                void retention.refetch();
              }
        }
      />
    );
  } else {
    const days = retention.data.retentionDays;
    body = (
      <KeyValueList
        rows={[
          days === null
            ? {
                key: "Retention window",
                value: null,
                reason: "This organisation has not chosen a retention window.",
              }
            : { key: "Retention window", value: days === 1 ? "1 day" : `${String(days)} days` },
          {
            key: "Deletion when it passes",
            // From the API's `enforced`, never assumed by this screen.
            value: enforcementText(retention.data.enforced),
            mono: false,
          },
        ]}
      />
    );
  }
  return <Card title="Retention">{body}</Card>;
}
