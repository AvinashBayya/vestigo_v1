import { TARGET_TYPES } from "@repo/core";
import {
  Button,
  Card,
  Field,
  KeyValueList,
  LoadingState,
  NotBuilt,
  Notice,
  Skeleton,
  Tag,
  Unmeasured,
} from "@repo/ui";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { useId, useState, type ReactNode, type SyntheticEvent } from "react";
import { ApiProblem, timed, unwrap } from "../api.ts";
import { api, type paths } from "../client/index.ts";
import { AppShell } from "../components/AppShell.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { Instant } from "../components/Values.tsx";
import { TYPE_LABEL, type TargetType } from "../search/plan.ts";
import { sessionQuery } from "../session.ts";
import { LIST_LIMIT } from "../workspace/queries.ts";
import { CutListNotice } from "../workspace/states.tsx";

type Retention =
  paths["/api/v1/settings/retention"]["get"]["responses"][200]["content"]["application/json"];
type Usage = paths["/api/v1/usage"]["get"]["responses"][200]["content"]["application/json"];
type UsageLine = Usage["lines"][number];
type CredentialList =
  paths["/api/v1/credentials"]["get"]["responses"][200]["content"]["application/json"];
type CredentialRow = CredentialList["items"][number];
type ScopeAuthList =
  paths["/api/v1/scope-authorisations"]["get"]["responses"][200]["content"]["application/json"];
type ScopeAuthRow = ScopeAuthList["items"][number];

/** No mockup draws this screen; the label says so, so no one takes it for a designed one. */
const PROVISIONAL_LABEL = "Provisional: no screen design yet";

/** Keyed by tenant, so one organisation's settings are never shown under another. */
const retentionQuery = (tenantId: string) =>
  queryOptions({
    queryKey: ["settings", "retention", tenantId],
    queryFn: ({ signal }): Promise<Retention> =>
      unwrap(api.GET("/api/v1/settings/retention", { signal: timed(signal) })),
  });

/** Keyed by tenant, so one organisation's usage is never shown under another. */
const usageQuery = (tenantId: string) =>
  queryOptions({
    queryKey: ["settings", "usage", tenantId],
    queryFn: ({ signal }): Promise<Usage> =>
      unwrap(api.GET("/api/v1/usage", { signal: timed(signal) })),
  });

/** Keyed by tenant, so one organisation's credentials are never shown under another. */
const credentialsQuery = (tenantId: string) =>
  queryOptions({
    queryKey: ["settings", "credentials", tenantId],
    queryFn: ({ signal }): Promise<CredentialList> =>
      unwrap(
        api.GET("/api/v1/credentials", {
          params: { query: { limit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
  });

/** Keyed by tenant, so one organisation's scope authorisations are never shown under another. */
const scopeAuthorisationsQuery = (tenantId: string) =>
  queryOptions({
    queryKey: ["settings", "scope-authorisations", tenantId],
    queryFn: ({ signal }): Promise<ScopeAuthList> =>
      unwrap(
        api.GET("/api/v1/scope-authorisations", {
          params: { query: { limit: LIST_LIMIT } },
          signal: timed(signal),
        }),
      ),
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
] as const;

/**
 * Provisional (U1-c): no mockup draws this screen, so it is the standard page
 * with existing components only. It reads the retention window and this
 * organisation's usage, and manages its stored credentials and scope
 * authorisations (add and revoke); the other settings are backed by the API
 * but not built here, and the page says so.
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
          This organisation&apos;s settings, as the API reports them. Stored credentials and scope
          authorisations can be managed here; the other settings cannot be changed in this
          provisional screen.
        </p>
        {/* All six areas in one grid; a Not built area is its own card, never a card in a card. */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Reports">
            <KeyValueList
              rows={[{ key: "Report handling marking", value: null, reason: MARKING_UNREADABLE }]}
            />
          </Card>
          {tenantId === null ? null : <RetentionCard tenantId={tenantId} />}
          {tenantId === null ? null : <UsageCard tenantId={tenantId} />}
          {tenantId === null ? null : <CredentialsCard tenantId={tenantId} />}
          {tenantId === null ? null : <ScopeAuthorisationsCard tenantId={tenantId} />}
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

/** Each usage period in words. */
const PERIOD_TEXT: Readonly<Record<UsageLine["period"], string>> = {
  DAY: "Today",
  MONTH: "This month",
};

/** The reason a period shows an em dash in place of a quota: the API returned none. */
const NO_QUOTA_REASON = "This organisation has no quota for this unit in this period.";

/** A usage unit in words; the raw code for a unit this screen does not name, never a guess. */
function unitLabel(unit: string): string {
  switch (unit) {
    case "UPSTREAM_REQUEST":
      return "Upstream requests";
    default:
      return unit;
  }
}

/** One usage line: what a unit has used in a period, counted since it began, beside its quota. */
function UsageLineRow({ line }: { readonly line: UsageLine }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-ui-strong text-ink-primary">
          {unitLabel(line.unit)} · {PERIOD_TEXT[line.period]}
        </h3>
        <p className="text-caption text-ink-muted">
          Counted since <Instant iso={line.periodStart} />.
        </p>
      </div>
      <KeyValueList
        rows={[
          // A measured count: 0 is shown as 0, never an em dash (§1).
          { key: "Used", value: String(line.used) },
          line.maxQuantity === null
            ? { key: "Quota", value: null, reason: NO_QUOTA_REASON }
            : { key: "Quota", value: String(line.maxQuantity) },
        ]}
      />
    </div>
  );
}

/**
 * This organisation's recorded usage beside its quotas, exactly as /usage
 * reports it. A used count is a measured number, so 0 is shown as 0; a period
 * with no quota is an em dash with that reason, never an invented limit.
 * Reading usage needs the usage:read permission; a refusal for lack of it
 * cannot change on retry, so none is offered (as the retention card does).
 */
function UsageCard({ tenantId }: { readonly tenantId: string }) {
  const usage = useQuery(usageQuery(tenantId));
  let body: ReactNode;
  if (usage.isPending) {
    body = (
      <LoadingState what="Reading usage.">
        <Skeleton className="h-target" />
        <Skeleton className="h-target" />
      </LoadingState>
    );
  } else if (usage.isError) {
    const refused = usage.error instanceof ApiProblem && usage.error.status === 403;
    body = (
      <ProblemNotice
        error={usage.error}
        title="Usage could not be read."
        // A refusal for lack of permission cannot change on retry.
        onRetry={
          refused
            ? undefined
            : () => {
                void usage.refetch();
              }
        }
      />
    );
  } else if (usage.data.lines.length === 0) {
    body = (
      <p className="text-prose-small text-ink-secondary">
        The API reported no usage for this organisation.
      </p>
    );
  } else {
    const { lines, exceeded } = usage.data;
    body = (
      <div className="flex flex-col gap-4">
        {exceeded ? (
          <Notice className="text-small">
            A quota is spent, so new runs are refused until its period ends.
          </Notice>
        ) : null}
        {lines.map((line) => (
          <UsageLineRow key={`${line.unit}\u0000${line.period}`} line={line} />
        ))}
      </div>
    );
  }
  return <Card title="Usage">{body}</Card>;
}

/**
 * One stored credential: its label and provider, whether it is active or
 * revoked, when it was stored and last used (an em dash when never recorded),
 * and — for an active one — a two-step Revoke so a stray click cannot revoke
 * it. No secret or ciphertext is shown: the API returns metadata only (§9).
 */
function CredentialRow({
  row,
  confirming,
  pending,
  onAskRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: {
  readonly row: CredentialRow;
  readonly confirming: boolean;
  readonly pending: boolean;
  readonly onAskRevoke: () => void;
  readonly onCancelRevoke: () => void;
  readonly onConfirmRevoke: () => void;
}) {
  const revoked = row.revokedAt !== null;
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-ui-strong break-words text-ink-primary">{row.label}</span>
          <span className="text-caption text-ink-muted">
            Provider <span className="font-mono text-mono-caption">{row.provider}</span>
          </span>
        </div>
        {/* In words, never colour alone (as the Members and Cases tables say status). */}
        <span className={revoked ? "text-caption text-ink-muted" : "text-caption text-ink-primary"}>
          {revoked ? "Revoked" : "Active"}
        </span>
      </div>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-caption text-ink-muted">
        <div className="flex items-center gap-1.5">
          <dt>Stored</dt>
          <dd>
            <Instant iso={row.createdAt} className="text-mono-caption" />
          </dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt>Last used</dt>
          <dd>
            {row.lastUsedAt === null ? (
              <Unmeasured summary="None." reason="No use of this credential has been recorded." />
            ) : (
              <Instant iso={row.lastUsedAt} className="text-mono-caption" />
            )}
          </dd>
        </div>
        {row.revokedAt === null ? null : (
          <div className="flex items-center gap-1.5">
            <dt>Revoked on</dt>
            <dd>
              <Instant iso={row.revokedAt} className="text-mono-caption" />
            </dd>
          </div>
        )}
      </dl>
      {revoked ? null : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-small text-ink-secondary">
            Revoke this credential? Sources that rely on it will stop running.
          </span>
          <Button variant="secondary" size="sm" disabled={pending} onClick={onConfirmRevoke}>
            {pending ? "Revoking…" : "Confirm revoke"}
          </Button>
          <Button variant="secondary" size="sm" disabled={pending} onClick={onCancelRevoke}>
            Cancel
          </Button>
        </div>
      ) : (
        <div>
          <Button variant="secondary" size="sm" onClick={onAskRevoke}>
            Revoke
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * The form that stores a new provider credential. The secret is a password
 * field, never echoed back, and cleared from state the moment it is stored
 * (§9: a secret is never kept or shown by the client). The submit is disabled
 * while a store is in flight, so a double click cannot store it twice.
 */
function AddCredentialForm({ tenantId }: { readonly tenantId: string }) {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  // Set when Add is pressed with a field empty; typing in any field clears it.
  const [emptySubmit, setEmptySubmit] = useState(false);

  const create = useMutation({
    mutationFn: (input: { provider: string; label: string; secret: string }) =>
      unwrap(api.POST("/api/v1/credentials", { body: input, signal: timed() })),
    onSuccess: async () => {
      // The submitted secret never lingers once the API has stored it.
      setProvider("");
      setLabel("");
      setSecret("");
      setEmptySubmit(false);
      await queryClient.invalidateQueries({ queryKey: ["settings", "credentials", tenantId] });
    },
  });

  const clearEmpty = () => {
    setEmptySubmit(false);
  };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    const trimmedProvider = provider.trim();
    const trimmedLabel = label.trim();
    // Nothing is sent until every field is filled; each field says what is missing.
    if (trimmedProvider === "" || trimmedLabel === "" || secret === "") {
      setEmptySubmit(true);
      return;
    }
    if (!create.isPending) {
      create.mutate({ provider: trimmedProvider, label: trimmedLabel, secret });
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3 border-t border-border-subtle pt-4"
    >
      <h3 className="text-ui-strong text-ink-primary">Add a credential</h3>
      <Field
        label="Provider"
        hint="The source this key is for, in lowercase: letters, digits, dot, dash or underscore."
        value={provider}
        maxLength={64}
        required
        error={
          emptySubmit && provider.trim() === "" ? "Enter the provider this key is for." : undefined
        }
        onChange={(event) => {
          setProvider(event.target.value);
          clearEmpty();
        }}
      />
      <Field
        label="Label"
        hint="A name for this key, so you can tell it apart later."
        value={label}
        maxLength={200}
        required
        error={
          emptySubmit && label.trim() === "" ? "Enter a label for this credential." : undefined
        }
        onChange={(event) => {
          setLabel(event.target.value);
          clearEmpty();
        }}
      />
      <Field
        label="Secret"
        type="password"
        autoComplete="off"
        hint="Stored encrypted. It is never shown again after you add it."
        value={secret}
        maxLength={8192}
        required
        error={emptySubmit && secret === "" ? "Enter the secret to store." : undefined}
        onChange={(event) => {
          setSecret(event.target.value);
          clearEmpty();
        }}
      />
      {create.isError ? <ProblemNotice error={create.error} /> : null}
      <Button type="submit" size="md" disabled={create.isPending} className="self-start">
        {create.isPending ? "Adding…" : "Add credential"}
      </Button>
    </form>
  );
}

/**
 * The stored provider credentials for this organisation, as the vault lists
 * them (metadata only, oldest first, revoked ones included), with a way to add
 * one and to revoke an active one. Reading needs credential:read and writing
 * credential:write; the API is the gate, so a refused read or write is shown
 * as it comes back, not second-guessed here (CLAUDE.md §6).
 */
function CredentialsCard({ tenantId }: { readonly tenantId: string }) {
  const queryClient = useQueryClient();
  const credentials = useQuery(credentialsQuery(tenantId));
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST("/api/v1/credentials/{id}/revoke", {
          params: { path: { id } },
          signal: timed(),
        }),
      ),
    onSuccess: async () => {
      setConfirmingId(null);
      await queryClient.invalidateQueries({ queryKey: ["settings", "credentials", tenantId] });
    },
  });

  let list: ReactNode;
  if (credentials.isPending) {
    list = (
      <LoadingState what="Reading the stored credentials.">
        <Skeleton className="h-target" />
        <Skeleton className="h-target" />
      </LoadingState>
    );
  } else if (credentials.isError) {
    const refused = credentials.error instanceof ApiProblem && credentials.error.status === 403;
    list = (
      <ProblemNotice
        error={credentials.error}
        title="The stored credentials could not be read."
        // A refusal for lack of permission cannot change on retry.
        onRetry={
          refused
            ? undefined
            : () => {
                void credentials.refetch();
              }
        }
      />
    );
  } else if (credentials.data.items.length === 0) {
    list = (
      <p className="text-prose-small text-ink-secondary">
        No credentials are stored for this organisation yet. A key-gated source will not run until a
        key it needs is added below.
      </p>
    );
  } else {
    list = (
      <div className="flex flex-col gap-3">
        {credentials.data.hasMore ? (
          <CutListNotice shown={credentials.data.items.length} total={null} noun="credentials" />
        ) : null}
        <ul className="flex flex-col divide-y divide-border-subtle">
          {credentials.data.items.map((row) => (
            <CredentialRow
              key={row.id}
              row={row}
              confirming={confirmingId === row.id}
              pending={revoke.isPending && revoke.variables === row.id}
              onAskRevoke={() => {
                revoke.reset();
                setConfirmingId(row.id);
              }}
              onCancelRevoke={() => {
                setConfirmingId(null);
              }}
              onConfirmRevoke={() => {
                if (!revoke.isPending) revoke.mutate(row.id);
              }}
            />
          ))}
        </ul>
        {revoke.isError ? <ProblemNotice error={revoke.error} /> : null}
      </div>
    );
  }

  return (
    <Card title="Credentials">
      <div className="flex flex-col gap-4">
        {list}
        <AddCredentialForm tenantId={tenantId} />
      </div>
    </Card>
  );
}

type ScopeStatus = "ACTIVE" | "PENDING" | "EXPIRED" | "REVOKED";

/**
 * A scope authorisation's state now, derived from its own dates and whether it
 * was revoked — the API stores no status field, only these facts. The dates are
 * what is authoritative; this word is a reading of them against the current time.
 */
function scopeStatus(row: ScopeAuthRow, now: number): ScopeStatus {
  if (row.revokedAt !== null) return "REVOKED";
  if (now < Date.parse(row.validFrom)) return "PENDING";
  if (now > Date.parse(row.validUntil)) return "EXPIRED";
  return "ACTIVE";
}

const SCOPE_STATUS_TEXT: Readonly<Record<ScopeStatus, string>> = {
  ACTIVE: "Active",
  PENDING: "Not yet valid",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
};

/**
 * One scope authorisation: the exact target it covers, its derived status, its
 * validity period and basis, who authorised it, and — for one not already
 * revoked — a two-step Revoke. Revoking is permanent; a new record is needed to
 * authorise again. This is a record of permission, not a trigger for collection.
 */
function ScopeAuthorisationRow({
  row,
  now,
  confirming,
  pending,
  onAskRevoke,
  onCancelRevoke,
  onConfirmRevoke,
}: {
  readonly row: ScopeAuthRow;
  readonly now: number;
  readonly confirming: boolean;
  readonly pending: boolean;
  readonly onAskRevoke: () => void;
  readonly onCancelRevoke: () => void;
  readonly onConfirmRevoke: () => void;
}) {
  const status = scopeStatus(row, now);
  const revoked = status === "REVOKED";
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-ui-strong text-ink-primary">{TYPE_LABEL[row.targetType]}</span>
          <span className="font-mono text-mono-caption break-all text-ink-primary">
            {row.target}
          </span>
        </div>
        {/* In words, never colour alone. */}
        <span className={revoked ? "text-caption text-ink-muted" : "text-caption text-ink-primary"}>
          {SCOPE_STATUS_TEXT[status]}
        </span>
      </div>
      <dl className="flex flex-col gap-1 text-caption text-ink-muted">
        <div className="flex flex-wrap items-center gap-1.5">
          <dt>Valid</dt>
          <dd className="flex flex-wrap items-center gap-1">
            <Instant iso={row.validFrom} className="text-mono-caption" />
            <span aria-hidden="true">–</span>
            <Instant iso={row.validUntil} className="text-mono-caption" />
          </dd>
        </div>
        {row.revokedAt === null ? null : (
          <div className="flex items-center gap-1.5">
            <dt>Revoked on</dt>
            <dd>
              <Instant iso={row.revokedAt} className="text-mono-caption" />
            </dd>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <dt>Authorised by</dt>
          <dd className="font-mono text-mono-caption break-all">{row.authorisedByUserId}</dd>
        </div>
      </dl>
      <p className="text-small break-words text-ink-secondary">
        <span className="text-ink-muted">Basis: </span>
        {row.basis}
      </p>
      {revoked ? null : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-small text-ink-secondary">
            Revoke this authorisation? It cannot be undone; a new one must be recorded to authorise
            again.
          </span>
          <Button variant="secondary" size="sm" disabled={pending} onClick={onConfirmRevoke}>
            {pending ? "Revoking…" : "Confirm revoke"}
          </Button>
          <Button variant="secondary" size="sm" disabled={pending} onClick={onCancelRevoke}>
            Cancel
          </Button>
        </div>
      ) : (
        <div>
          <Button variant="secondary" size="sm" onClick={onAskRevoke}>
            Revoke
          </Button>
        </div>
      )}
    </li>
  );
}

/**
 * The form that records a scope authorisation. It only stores the record; it
 * starts no collection, and a collector still applies its own checks before it
 * runs (CLAUDE.md §3). The dates are entered locally and sent as instants. The
 * server has the final word on the target, the basis and the validity window.
 */
function AddScopeAuthorisationForm({ tenantId }: { readonly tenantId: string }) {
  const queryClient = useQueryClient();
  const typeFieldId = useId();
  const [targetType, setTargetType] = useState<TargetType | "">("");
  const [target, setTarget] = useState("");
  const [basis, setBasis] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  // Set when Record is pressed with something missing or the dates out of order.
  const [submitted, setSubmitted] = useState(false);

  const create = useMutation({
    mutationFn: (body: {
      targetType: TargetType;
      target: string;
      basis: string;
      validFrom: string;
      validUntil: string;
    }) => unwrap(api.POST("/api/v1/scope-authorisations", { body, signal: timed() })),
    onSuccess: async () => {
      setTargetType("");
      setTarget("");
      setBasis("");
      setValidFrom("");
      setValidUntil("");
      setSubmitted(false);
      await queryClient.invalidateQueries({
        queryKey: ["settings", "scope-authorisations", tenantId],
      });
    },
  });

  // End-after-start, checked only once both dates are present; the server is the final word
  // (it also caps the window at 366 days, which is left to the server to enforce).
  const datesOutOfOrder =
    validFrom !== "" &&
    validUntil !== "" &&
    new Date(validUntil).getTime() <= new Date(validFrom).getTime();

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const trimmedTarget = target.trim();
    const trimmedBasis = basis.trim();
    if (
      targetType === "" ||
      trimmedTarget === "" ||
      trimmedBasis === "" ||
      validFrom === "" ||
      validUntil === "" ||
      datesOutOfOrder
    ) {
      return;
    }
    if (!create.isPending) {
      create.mutate({
        targetType,
        target: trimmedTarget,
        basis: trimmedBasis,
        validFrom: new Date(validFrom).toISOString(),
        validUntil: new Date(validUntil).toISOString(),
      });
    }
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3 border-t border-border-subtle pt-4"
    >
      <h3 className="text-ui-strong text-ink-primary">Record an authorisation</h3>
      <p className="text-caption text-ink-muted">
        This records written permission to actively collect against one exact target. It starts no
        collection, and a collector still applies its own checks before it runs.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor={typeFieldId} className="text-body-strong text-ink-primary">
          Target type
        </label>
        <select
          id={typeFieldId}
          value={targetType}
          aria-invalid={submitted && targetType === "" ? true : undefined}
          onChange={(event) => {
            setTargetType(event.target.value as TargetType | "");
          }}
          className="min-h-target cursor-pointer rounded-md border border-border-input bg-surface-sunken px-3 text-body text-ink-primary aria-[invalid=true]:border-status-failed-mark"
        >
          <option value="">Choose a target type</option>
          {TARGET_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABEL[type]}
            </option>
          ))}
        </select>
        {submitted && targetType === "" ? (
          <p className="text-small text-status-failed-ink">Choose the target type.</p>
        ) : null}
      </div>
      <Field
        label="Target"
        hint="The exact target, matched as-is: no subdomain, range or other target is covered."
        value={target}
        maxLength={2048}
        required
        error={submitted && target.trim() === "" ? "Enter the exact target." : undefined}
        onChange={(event) => {
          setTarget(event.target.value);
        }}
      />
      <Field
        label="Basis"
        hint="The recorded basis: the engagement and the written permission for it."
        value={basis}
        maxLength={2000}
        required
        error={
          submitted && basis.trim() === "" ? "Record the basis for this authorisation." : undefined
        }
        onChange={(event) => {
          setBasis(event.target.value);
        }}
      />
      <Field
        label="Valid from"
        type="datetime-local"
        value={validFrom}
        required
        error={submitted && validFrom === "" ? "Enter when the authorisation starts." : undefined}
        onChange={(event) => {
          setValidFrom(event.target.value);
        }}
      />
      <Field
        label="Valid until"
        type="datetime-local"
        hint="At most 366 days after it starts."
        value={validUntil}
        required
        error={
          submitted && validUntil === ""
            ? "Enter when the authorisation ends."
            : submitted && datesOutOfOrder
              ? "The end must be after the start."
              : undefined
        }
        onChange={(event) => {
          setValidUntil(event.target.value);
        }}
      />
      {create.isError ? <ProblemNotice error={create.error} /> : null}
      <Button type="submit" size="md" disabled={create.isPending} className="self-start">
        {create.isPending ? "Recording…" : "Record authorisation"}
      </Button>
    </form>
  );
}

/**
 * The tenant's scope authorisations, as the API lists them (oldest first,
 * revoked ones included), with a way to record one and to revoke a standing
 * one. Reading needs scope_authorisation:read and writing
 * scope_authorisation:write; the API is the gate, so a refused read or write
 * is shown as it comes back, not second-guessed here (CLAUDE.md §6). An
 * authorisation is a record of permission only — it never starts collection.
 */
function ScopeAuthorisationsCard({ tenantId }: { readonly tenantId: string }) {
  const queryClient = useQueryClient();
  const authorisations = useQuery(scopeAuthorisationsQuery(tenantId));
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Captured at mount for the derived status; the authoritative dates are shown regardless.
  const [now] = useState(() => Date.now());

  const revoke = useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST("/api/v1/scope-authorisations/{id}/revoke", {
          params: { path: { id } },
          body: {},
          signal: timed(),
        }),
      ),
    onSuccess: async () => {
      setConfirmingId(null);
      await queryClient.invalidateQueries({
        queryKey: ["settings", "scope-authorisations", tenantId],
      });
    },
  });

  let list: ReactNode;
  if (authorisations.isPending) {
    list = (
      <LoadingState what="Reading the scope authorisations.">
        <Skeleton className="h-target" />
        <Skeleton className="h-target" />
      </LoadingState>
    );
  } else if (authorisations.isError) {
    const refused =
      authorisations.error instanceof ApiProblem && authorisations.error.status === 403;
    list = (
      <ProblemNotice
        error={authorisations.error}
        title="The scope authorisations could not be read."
        // A refusal for lack of permission cannot change on retry.
        onRetry={
          refused
            ? undefined
            : () => {
                void authorisations.refetch();
              }
        }
      />
    );
  } else if (authorisations.data.items.length === 0) {
    list = (
      <p className="text-prose-small text-ink-secondary">
        No scope authorisations are recorded. An active collector will not run against a target
        until an authorisation for that exact target is recorded below.
      </p>
    );
  } else {
    list = (
      <div className="flex flex-col gap-3">
        {authorisations.data.hasMore ? (
          <CutListNotice
            shown={authorisations.data.items.length}
            total={null}
            noun="scope authorisations"
          />
        ) : null}
        <ul className="flex flex-col divide-y divide-border-subtle">
          {authorisations.data.items.map((row) => (
            <ScopeAuthorisationRow
              key={row.id}
              row={row}
              now={now}
              confirming={confirmingId === row.id}
              pending={revoke.isPending && revoke.variables === row.id}
              onAskRevoke={() => {
                revoke.reset();
                setConfirmingId(row.id);
              }}
              onCancelRevoke={() => {
                setConfirmingId(null);
              }}
              onConfirmRevoke={() => {
                if (!revoke.isPending) revoke.mutate(row.id);
              }}
            />
          ))}
        </ul>
        {revoke.isError ? <ProblemNotice error={revoke.error} /> : null}
      </div>
    );
  }

  return (
    <Card title="Scope authorisations">
      <div className="flex flex-col gap-4">
        {list}
        <AddScopeAuthorisationForm tenantId={tenantId} />
      </div>
    </Card>
  );
}
