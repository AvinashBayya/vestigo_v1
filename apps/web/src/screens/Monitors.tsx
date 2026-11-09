import {
  Button,
  Card,
  DataTable,
  Field,
  LoadingState,
  Notice,
  StatusChip,
  Tag,
  type DataTableColumn,
  type DataTableRow,
} from "@repo/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { timed, unwrap, unwrapEmpty } from "../api.ts";
import { api } from "../client/index.ts";
import { AppShell } from "../components/AppShell.tsx";
import { ProblemNotice } from "../components/ProblemNotice.tsx";
import { Instant } from "../components/Values.tsx";
import { monitorsQuery, unacknowledgedAlertsQuery, type Alert, type Monitor } from "../monitors.ts";
import { CutListNotice } from "../workspace/states.tsx";

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const MONITOR_COLUMNS: readonly DataTableColumn[] = [
  { id: "name", header: "Name", kind: "primary" },
  { id: "target", header: "Target", kind: "mono" },
  { id: "schedule", header: "Schedule", kind: "mono-muted" },
  { id: "status", header: "Status" },
  { id: "created", header: "Created", kind: "mono-muted" },
  { id: "actions", header: "" },
];

const ALERT_COLUMNS: readonly DataTableColumn[] = [
  { id: "title", header: "Alert", kind: "primary" },
  { id: "monitor", header: "Monitor", kind: "mono-muted" },
  { id: "created", header: "Raised", kind: "mono-muted" },
  { id: "ack", header: "" },
];

// ---------------------------------------------------------------------------
// Row builders — defined outside the component to avoid recreating on render
// ---------------------------------------------------------------------------

function monitorRowOf(
  item: Monitor,
  onToggle: (id: string, enable: boolean) => void,
  onDelete: (id: string) => void,
  isPending: boolean,
): DataTableRow {
  return {
    id: item.id,
    cells: {
      name: item.name,
      target: item.target,
      schedule: item.scheduleCron,
      status: (
        <StatusChip status={item.enabled ? "READY" : "HELD"}>
          {item.enabled ? "Active" : "Paused"}
        </StatusChip>
      ),
      created: <Instant iso={item.createdAt} className="text-mono-meta" />,
      actions: (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={isPending}
            onClick={() => {
              onToggle(item.id, !item.enabled);
            }}
          >
            {item.enabled ? "Pause" : "Resume"}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            disabled={isPending}
            onClick={() => {
              onDelete(item.id);
            }}
          >
            Delete
          </Button>
        </div>
      ),
    },
  };
}

function alertRowOf(
  item: Alert,
  monitorName: string | undefined,
  onAck: (id: string) => void,
  isPending: boolean,
): DataTableRow {
  return {
    id: item.id,
    cells: {
      title: item.title,
      monitor: monitorName ?? item.monitorId,
      created: <Instant iso={item.createdAt} className="text-mono-meta" />,
      ack: (
        <Button
          size="sm"
          variant="secondary"
          disabled={isPending}
          onClick={() => {
            onAck(item.id);
          }}
        >
          Acknowledge
        </Button>
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// Monitors table sub-component
// ---------------------------------------------------------------------------

function MonitorsTable() {
  const queryClient = useQueryClient();
  const monitors = useQuery(monitorsQuery);

  const toggle = useMutation({
    mutationFn: ({ id, enable }: { readonly id: string; readonly enable: boolean }) =>
      unwrap(
        enable
          ? api.POST("/api/v1/monitors/{id}/enable", { params: { path: { id } }, signal: timed() })
          : api.POST("/api/v1/monitors/{id}/disable", {
              params: { path: { id } },
              signal: timed(),
            }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monitors"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      unwrapEmpty(
        api.DELETE("/api/v1/monitors/{id}", { params: { path: { id } }, signal: timed() }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["monitors"] });
    },
  });

  const isPending = toggle.isPending || remove.isPending;

  if (monitors.isError) {
    return (
      <ProblemNotice
        error={monitors.error}
        title="Monitors could not be read."
        onRetry={() => {
          void monitors.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {monitors.data?.hasMore === true ? (
        <CutListNotice shown={monitors.data.items.length} total={null} noun="monitors" />
      ) : null}
      {toggle.isError || remove.isError ? (
        <ProblemNotice error={toggle.error ?? remove.error} />
      ) : null}
      <DataTable
        caption="Monitors"
        density="comfortable"
        columns={MONITOR_COLUMNS}
        rows={
          monitors.data === undefined
            ? []
            : monitors.data.items.map((item) =>
                monitorRowOf(
                  item,
                  (id, enable) => {
                    toggle.mutate({ id, enable });
                  },
                  (id) => {
                    remove.mutate(id);
                  },
                  isPending,
                ),
              )
        }
        loading={monitors.isPending ? "Reading monitors." : undefined}
        empty={{
          kind: "empty",
          title: "No monitors yet",
          body: "Create one below to start watching a target on a schedule.",
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create monitor form
// ---------------------------------------------------------------------------

const CRON_EXAMPLES = [
  { label: "Hourly", value: "0 * * * *" },
  { label: "Daily 09:00", value: "0 9 * * *" },
  { label: "Weekly Mon", value: "0 9 * * 1" },
];

function CreateMonitorForm() {
  const queryClient = useQueryClient();

  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [cron, setCron] = useState("0 9 * * *");
  const [submitted, setSubmitted] = useState(false);

  const create = useMutation({
    mutationFn: (body: {
      readonly name: string;
      readonly target: string;
      readonly scheduleCron: string;
    }) =>
      unwrap(api.POST("/api/v1/monitors", { body: { ...body, enabled: true }, signal: timed() })),
    onSuccess: () => {
      setName("");
      setTarget("");
      setCron("0 9 * * *");
      setSubmitted(false);
      void queryClient.invalidateQueries({ queryKey: ["monitors"] });
    },
  });

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    setSubmitted(true);
    const n = name.trim();
    const t = target.trim();
    const c = cron.trim();
    if (!n || !t || !c) return;
    if (!create.isPending) create.mutate({ name: n, target: t, scheduleCron: c });
  };

  return (
    <Card title="Create a monitor">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field
          label="Name"
          value={name}
          maxLength={200}
          required
          error={submitted && name.trim() === "" ? "Enter a name for this monitor." : undefined}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Field
          label="Target"
          hint="Domain, IP, email, username, or organisation to watch"
          value={target}
          maxLength={500}
          required
          error={submitted && target.trim() === "" ? "Enter a target to monitor." : undefined}
          onChange={(e) => {
            setTarget(e.target.value);
          }}
        />
        <div className="flex flex-col gap-2">
          <Field
            label="Schedule (cron)"
            hint="Standard 5-field cron expression"
            value={cron}
            maxLength={100}
            required
            error={submitted && cron.trim() === "" ? "Enter a cron schedule." : undefined}
            onChange={(e) => {
              setCron(e.target.value);
            }}
          />
          <div className="flex flex-wrap gap-2">
            {CRON_EXAMPLES.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setCron(value);
                }}
                className="inline-flex cursor-pointer items-center rounded border border-border-control bg-surface-raised px-2 py-0.5 font-mono text-mono-meta text-ink-secondary transition-colors hover:bg-surface-hover"
              >
                {label}: <span className="ml-1 text-ink-primary">{value}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button type="submit" size="lg" disabled={create.isPending} className="self-start">
            {create.isPending ? "Creating…" : "Create monitor"}
          </Button>
          {create.isError ? <ProblemNotice error={create.error} /> : null}
          {create.isSuccess ? <Notice tone="info">Monitor created successfully.</Notice> : null}
        </div>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Alerts panel
// ---------------------------------------------------------------------------

function AlertsPanel({ monitors }: { readonly monitors: Monitor[] }) {
  const queryClient = useQueryClient();
  const alerts = useQuery(unacknowledgedAlertsQuery);

  const ack = useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/api/v1/alerts/{id}/ack", { params: { path: { id } }, signal: timed() })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  const monitorNames = Object.fromEntries(monitors.map((m) => [m.id, m.name]));
  // null while the alert count has not been read yet, so it is never shown as a
  // measured zero (CLAUDE.md §1). A measured zero renders no tag, same as null.
  const count = alerts.data === undefined ? null : alerts.data.items.length;

  if (alerts.isError) {
    return (
      <ProblemNotice
        error={alerts.error}
        title="Alerts could not be read."
        onRetry={() => {
          void alerts.refetch();
        }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3">
        <h2 className="text-section-label text-ink-muted uppercase">Unacknowledged alerts</h2>
        {count !== null && count > 0 ? (
          <Tag mono={false}>{String(count) + " unacknowledged"}</Tag>
        ) : null}
      </div>
      {alerts.isPending ? (
        <LoadingState what="Reading alerts.">
          <div className="h-10 rounded-md bg-surface-raised" />
          <div className="h-10 rounded-md bg-surface-raised" />
        </LoadingState>
      ) : (
        <DataTable
          caption="Unacknowledged alerts"
          density="comfortable"
          columns={ALERT_COLUMNS}
          rows={alerts.data.items.map((item) =>
            alertRowOf(
              item,
              monitorNames[item.monitorId],
              (id) => {
                ack.mutate(id);
              },
              ack.isPending,
            ),
          )}
          empty={{
            kind: "empty",
            title: "No unacknowledged alerts",
            body: "All monitor alerts have been reviewed.",
          }}
        />
      )}
      {ack.isError ? <ProblemNotice error={ack.error} /> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * The Monitors screen: lists active scheduled monitors for this tenant, lets
 * analysts create, pause, resume, and delete them, and surfaces any
 * unacknowledged alerts raised by those monitors.
 *
 * docs/design/officer-mockups/ draws watches (01-watch-home, 05-set-up-a-watch);
 * this screen has not been checked against those drawings.
 */
export function MonitorsScreen() {
  const monitors = useQuery(monitorsQuery);
  const items = monitors.data?.items ?? [];

  return (
    <AppShell>
      <div className="flex flex-col gap-8 px-4 py-8 md:px-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-title text-ink-primary">Monitors</h1>
          <p className="text-prose-small text-ink-secondary">
            Scheduled watches that check a target for new intelligence on a cron schedule. When
            evidence is found a new alert is raised here.
          </p>
        </div>

        <MonitorsTable />

        <AlertsPanel monitors={items} />

        <CreateMonitorForm />
      </div>
    </AppShell>
  );
}
