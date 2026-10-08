import type { ServerResponse } from "node:http";
import { JOB_OUTCOMES, JOB_STATUSES, RUN_STATUSES, TARGET_TYPES } from "@repo/core";
import {
  readRunProgress,
  ReplayTargetNotFoundError,
  usageSummary,
  type JobProgress,
  type RunProgress,
} from "@repo/osint-engine";
import type { FastifyBaseLogger } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import { forbidden, HttpError, LockedSchema, notFound, ProblemSchema } from "../http/errors.ts";
import { personLockFor, requirePersonAccess } from "../http/person-gate.ts";
import {
  ACCESS_REFUSAL_REASONS,
  identityStanding,
  recheckAccess,
  refusalFromLock,
  type AccessRefusal,
} from "../http/recheck.ts";
import type { RunServices, Services } from "../services.ts";
import {
  iso,
  IdParams,
  isoOrNull,
  LimitQuery,
  optionalInstant,
  page,
  PROTECTED_ERRORS,
  SECURITY,
} from "./schemas.ts";

const JobView = z.object({
  id: z.uuid(),
  collectorId: z.string(),
  /** The label every piece of this collector's evidence carries (its registry entry). */
  sourceLabel: z.string(),
  status: z.enum(JOB_STATUSES),
  /** The last attempt's outcome; null before any attempt finished. */
  outcome: z.enum(JOB_OUTCOMES).nullable(),
  /** What a NOT_FOUND said was not found; null otherwise. */
  outcomeDetail: z.string().nullable(),
  /** Why the last attempt did not succeed; null when it did, or none finished. */
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  attempts: z.number().int().min(0),
  nextAttemptAt: optionalInstant,
  deadLetteredAt: optionalInstant,
  startedAt: optionalInstant,
  finishedAt: optionalInstant,
  fusedAt: optionalInstant,
  evidenceIds: z.array(z.uuid()),
});

const TargetView = z.object({ type: z.enum(TARGET_TYPES), value: z.string() });

/** What the planner decided, exactly as recorded on the run. */
const PlanView = z.union([
  z.object({
    input: z.string(),
    /** The type the analyst chose; null when detection chose. */
    requestedType: z.enum(TARGET_TYPES).nullable(),
    detected: z
      .object({
        primaryType: z.enum(TARGET_TYPES),
        alternateTypes: z.array(z.enum(TARGET_TYPES)),
      })
      .nullable(),
    /** Each candidate type: its normalised value, or why the input is not one. */
    targets: z.array(
      z.union([TargetView, z.object({ type: z.enum(TARGET_TYPES), invalid: z.string() })]),
    ),
    jobs: z.array(z.object({ collectorId: z.string(), target: TargetView })),
    /** Every collector not dispatched, with its machine-readable reason. */
    excluded: z.array(
      z.object({
        collectorId: z.string(),
        targetType: z.enum(TARGET_TYPES).nullable(),
        reason: z.string(),
        message: z.string(),
      }),
    ),
  }),
  /** The run could not be planned at all (an empty target). */
  z.object({ error: z.object({ code: z.string(), message: z.string() }) }),
]);

const RunView = z.object({
  id: z.uuid(),
  investigationId: z.uuid(),
  /** PARTIAL: some collectors succeeded and some failed; each failure is in `jobs`. */
  status: z.enum(RUN_STATUSES),
  /** The planner's record: detected types, planned jobs, and every exclusion with its reason. */
  plan: PlanView.nullable(),
  createdAt: z.iso.datetime(),
  startedAt: optionalInstant,
  finishedAt: optionalInstant,
  /** The run has finished and every found result is fused: nothing more will change. */
  settled: z.boolean(),
  counts: z.record(z.enum(JOB_STATUSES), z.number().int().min(0)),
  jobs: z.array(JobView),
});
type RunViewType = z.infer<typeof RunView>;

const RunSummary = z.object({
  id: z.uuid(),
  status: z.enum(RUN_STATUSES),
  createdAt: z.iso.datetime(),
  startedAt: optionalInstant,
  finishedAt: optionalInstant,
});

const UsageView = z.object({
  lines: z.array(
    z.object({
      unit: z.string(),
      period: z.enum(["DAY", "MONTH"]),
      periodStart: z.iso.datetime(),
      used: z.number().int().min(0),
      /** Null: the tenant has no quota for this unit and period. */
      maxQuantity: z.number().int().min(0).nullable(),
    }),
  ),
  /** A quota is spent: new runs are refused until its period ends. */
  exceeded: z.boolean(),
});

const labelOf = (runs: RunServices, collectorId: string): string =>
  runs.registry.list().find((entry) => entry.id === collectorId)?.label ?? collectorId;

function jobView(runs: RunServices, job: JobProgress): z.infer<typeof JobView> {
  return {
    id: job.id,
    collectorId: job.collectorId,
    sourceLabel: labelOf(runs, job.collectorId),
    status: job.status,
    outcome: job.outcome,
    outcomeDetail: job.outcomeDetail,
    error: job.error,
    attempts: job.attempts,
    nextAttemptAt: isoOrNull(job.nextAttemptAt),
    deadLetteredAt: isoOrNull(job.deadLetteredAt),
    startedAt: isoOrNull(job.startedAt),
    finishedAt: isoOrNull(job.finishedAt),
    fusedAt: isoOrNull(job.fusedAt),
    evidenceIds: [...job.evidenceIds],
  };
}

function runView(runs: RunServices, progress: RunProgress): RunViewType {
  return {
    id: progress.id,
    investigationId: progress.investigationId,
    status: progress.status,
    plan: progress.plan === null ? null : PlanView.parse(progress.plan),
    createdAt: iso(progress.createdAt),
    startedAt: isoOrNull(progress.startedAt),
    finishedAt: isoOrNull(progress.finishedAt),
    settled: progress.settled,
    counts: { ...progress.counts },
    jobs: progress.jobs.map((job) => jobView(runs, job)),
  };
}

const QUOTA_UNIT = "UPSTREAM_REQUEST";

/** What a locked run read or progress stream would have shown. */
const RUN_WITHHELD =
  "This run's progress: each collector's outcome, its errors and the evidence it recorded.";

/**
 * Sent when the stream's access re-check refuses access, just before the
 * stream closes. It says why, that the close is a policy decision rather than
 * a dropped connection, and how often access was being re-checked.
 */
const LockedEvent = z.object({
  /** Which check refused: the credential, membership, permission, plan or vetting. */
  reason: z.enum(ACCESS_REFUSAL_REASONS),
  /** The code a fresh request would now be refused with. */
  code: z.string(),
  detail: z.string(),
  /** The Locked block when the person-data gate refused; null for every other reason. */
  locked: LockedSchema.nullable(),
  /** Access is re-checked with every progress read, so this is the poll interval. */
  recheckIntervalMs: z.number().int().min(1),
  /** When the re-check that refused access ran. */
  checkedAt: z.iso.datetime(),
});

/**
 * The run progress stream's events, as schemas: each is sent as
 * `event: <event>` and `data: <JSON of data>`, validated on the way out, and
 * named in the OpenAPI document so the generated client types them.
 */
export const RunStreamEvent = z
  .discriminatedUnion("event", [
    z
      .object({
        event: z.literal("run"),
        /** The run's state without its jobs, which come as `job` events. */
        data: RunView.omit({ jobs: true }),
      })
      .meta({
        id: "RunStreamRunEvent",
        description: "The run's state: sent first, and again whenever it changes.",
      }),
    z.object({ event: z.literal("job"), data: JobView }).meta({
      id: "RunStreamJobEvent",
      description: "One collector job: sent first for every job, and again whenever it changes.",
    }),
    z
      .object({
        event: z.literal("end"),
        data: z.object({
          /** The settled run's status; null when the run no longer exists. */
          status: z.enum(RUN_STATUSES).nullable(),
        }),
      })
      .meta({
        id: "RunStreamEndEvent",
        description: "The run is settled (or gone); the stream closes.",
      }),
    z.object({ event: z.literal("locked"), data: LockedEvent }).meta({
      id: "RunStreamLockedEvent",
      description:
        "A re-check of access refused it; the stream closes. A policy decision, not a dropped connection.",
    }),
    z.object({ event: z.literal("timeout"), data: z.object({ reconnect: z.literal(true) }) }).meta({
      id: "RunStreamTimeoutEvent",
      description: "The stream reached its maximum length while the run goes on; reconnect.",
    }),
    z
      .object({ event: z.literal("error"), data: z.object({ code: z.literal("STREAM_FAILED") }) })
      .meta({
        id: "RunStreamErrorEvent",
        description: "The stream failed; the run itself is unaffected. Reconnect to resume.",
      }),
  ])
  .meta({
    id: "RunStreamEvent",
    description:
      "One server-sent event of a run's progress stream, parsed: `event` is the SSE event name and `data` its JSON payload.",
  });
export type RunStreamEventType = z.infer<typeof RunStreamEvent>;

/** The permission the progress stream needs, re-checked on every read as at connect. */
const STREAM_PERMISSION = "run:read" as const;
/** A progress stream ends after this long even if the run is still going; the client reconnects. */
const MAX_STREAM_MS = 60 * 60 * 1000;
const HEARTBEAT_MS = 15_000;

const CONFLICT = { 409: ProblemSchema } as const;

export const runRoutes =
  (services: () => Services): FastifyPluginAsyncZod =>
  (app) => {
    app.post(
      "/api/v1/investigations/:id/runs",
      {
        config: { access: { permission: "run:start", action: "run.start" } },
        schema: {
          operationId: "startRun",
          summary: "Start a run of an investigation: plan it and collect in the background",
          description:
            "Returns at once with the QUEUED run; collection happens in background jobs. Follow it with GET /api/v1/runs/{id} or the /events stream. Refused with 429 QUOTA_EXCEEDED when a quota is spent.",
          tags: ["runs"],
          security: SECURITY,
          params: IdParams,
          body: z.object({
            /** The target's type, when the analyst knows it; otherwise it is detected. */
            targetType: z.enum(TARGET_TYPES).optional(),
          }),
          response: { 202: RunView, ...PROTECTED_ERRORS, ...CONFLICT },
        },
      },
      async (request, reply) => {
        const { repos, principal } = tenantOf(request);
        const runs = services().runs;
        const investigation = await repos.investigations.findById(request.params.id);
        if (investigation === null) throw notFound("The investigation");
        if (investigation.archivedAt !== null) {
          throw new HttpError(409, "INVESTIGATION_ARCHIVED", "The investigation is archived.");
        }
        // Quotas are checked before anything is dispatched (and again before each job).
        const usage = await usageSummary(repos, QUOTA_UNIT, new Date());
        if (usage.exceeded) {
          throw new HttpError(429, "QUOTA_EXCEEDED", "A usage quota for this tenant is spent.");
        }
        const run = await repos.runs.create({
          investigationId: investigation.id,
          status: "QUEUED",
          requestedByUserId: principal.kind === "session" ? principal.userId : null,
          requestedTargetType: request.body.targetType ?? null,
        });
        request.auditTarget = { type: "run", id: run.id };
        try {
          // Enqueued inside the run's own transaction: if it rolls back, the
          // planning job finds no run and dead-letters, visibly.
          await runs.investigations.enqueueRun(principal.tenantId, run.id);
        } catch {
          throw new HttpError(503, "QUEUE_UNAVAILABLE", "The job queue could not take the run.");
        }
        const progress = await readRunProgress(repos, run.id);
        if (progress === null) throw notFound("The run");
        void reply.code(202);
        return runView(runs, progress);
      },
    );

    app.get(
      "/api/v1/investigations/:id/runs",
      {
        config: { access: { permission: "run:read", action: "run.list" } },
        schema: {
          operationId: "listRuns",
          summary: "List an investigation's runs, oldest first",
          tags: ["runs"],
          security: SECURITY,
          params: IdParams,
          querystring: LimitQuery,
          response: {
            200: z.object({ items: z.array(RunSummary), hasMore: z.boolean() }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const { repos } = tenantOf(request);
        if ((await repos.investigations.findById(request.params.id)) === null) {
          throw notFound("The investigation");
        }
        const rows = await repos.runs.listForInvestigation(request.params.id, {
          limit: request.query.limit + 1,
        });
        const result = page(rows, request.query.limit);
        return {
          items: result.items.map((run) => ({
            id: run.id,
            status: run.status,
            createdAt: iso(run.createdAt),
            startedAt: isoOrNull(run.startedAt),
            finishedAt: isoOrNull(run.finishedAt),
          })),
          hasMore: result.hasMore,
        };
      },
    );

    app.get(
      "/api/v1/runs/:id",
      {
        config: { access: { permission: "run:read", action: "run.read" } },
        schema: {
          operationId: "getRun",
          summary: "Read a run: its status, its plan, and every collector job's outcome",
          tags: ["runs"],
          security: SECURITY,
          params: IdParams,
          response: { 200: RunView, ...PROTECTED_ERRORS },
        },
      },
      async (request) => {
        const context = tenantOf(request);
        const { repos } = context;
        request.auditTarget = { type: "run", id: request.params.id };
        const progress = await readRunProgress(repos, request.params.id);
        if (progress === null) throw notFound("The run");
        // A run that used a person collector is person data, whatever its jobs found.
        await requirePersonAccess(context, { runJobs: progress.id }, RUN_WITHHELD);
        return runView(services().runs, progress);
      },
    );

    app.get(
      "/api/v1/runs/:id/events",
      {
        config: { access: { permission: STREAM_PERMISSION, action: "run.watch" } },
        schema: {
          operationId: "watchRun",
          summary: "Stream a run's progress as server-sent events",
          description:
            "text/event-stream. Events: `run` (the run's state, sent first and on every change), `job` (one job, on every change), `end` (the run is settled; the stream closes), `timeout` (the stream reached its maximum length; reconnect), `error` (the stream failed), and `locked`. Access is checked when the stream opens, as for any request, and re-checked with every progress read, every RUN_EVENTS_POLL_MS milliseconds: the session or API key is still valid, the person (or the key's issuer) is still a member, the current role still grants run:read, and the plan and vetting still allow the run's data. If a re-check refuses, a `locked` event says why (`reason`: CREDENTIAL_REVOKED, MEMBERSHIP_REVOKED, PERMISSION_LOST, MODULE_NOT_IN_PLAN or VETTING_NOT_APPROVED), with the code a fresh request would get, the Locked detail when person data is the reason, the re-check interval (`recheckIntervalMs`) and when the check ran, and the stream closes: a policy decision, not a dropped connection. A comment line is sent every 15 s to keep the connection open.",
          tags: ["runs"],
          security: SECURITY,
          params: IdParams,
          response: {
            200: {
              description:
                "A stream of server-sent events. Each is written as `event: <event>` and `data: <JSON>`; the schema is one event, parsed.",
              content: { "text/event-stream": { schema: RunStreamEvent } },
            },
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request, reply) => {
        const context = tenantOf(request);
        const { repos, principal } = context;
        request.auditTarget = { type: "run", id: request.params.id };
        const initial = await readRunProgress(repos, request.params.id);
        if (initial === null) throw notFound("The run");
        // Checked before the stream opens, so a locked run is an ordinary 403.
        await requirePersonAccess(context, { runJobs: initial.id }, RUN_WITHHELD);
        const all = services();
        const runId = request.params.id;
        const tenantId = principal.tenantId;
        // The access check and its audit row commit with this handler; the
        // stream then reads in short transactions of its own, never holding one open.
        void reply.hijack();
        reply.raw.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        streamRun({
          raw: reply.raw,
          runs: all.runs,
          initial,
          // Every read re-checks what connect checked: the credential, membership and
          // permission (identity store first, outside the tenant transaction), then
          // plan, vetting and person data in the same transaction as the progress read.
          read: async () => {
            const identity = await identityStanding(principal, all.authStore);
            return all.db.withTenant(tenantId, async (ctx): Promise<StreamRead> => {
              const tenant = await ctx.repos.tenants.current();
              if (tenant === null) {
                throw forbidden("TENANT_NOT_PROVISIONED", "This tenant has not been provisioned.");
              }
              const refused = await recheckAccess({
                principal,
                identity,
                context: ctx,
                tenant,
                permission: STREAM_PERMISSION,
              });
              if (refused !== null) return { kind: "refused", refusal: refused };
              // Read first, then probe: a job committed between a probe and a later read would
              // reach a tenant that is now locked. The probe sees at least what the read saw.
              const progress = await readRunProgress(ctx.repos, runId);
              const lock = await personLockFor(tenant, ctx.reads, { runJobs: runId }, RUN_WITHHELD);
              if (lock !== null) return { kind: "refused", refusal: refusalFromLock(lock) };
              return { kind: "progress", progress };
            });
          },
          log: request.log,
        });
      },
    );

    app.post(
      "/api/v1/jobs/:id/replay",
      {
        config: { access: { permission: "job:replay", action: "job.replay" } },
        schema: {
          operationId: "replayJob",
          summary: "Replay a failed or dead-lettered collector job",
          description:
            "The same job, under the same idempotency key, with a fresh attempt budget; its run is fused again when it finishes. A job that succeeded cannot be replayed (409). A replay never double-charges or duplicates evidence.",
          tags: ["runs"],
          security: SECURITY,
          params: IdParams,
          body: z.object({}),
          response: { 202: z.object({ runId: z.uuid() }), ...PROTECTED_ERRORS, ...CONFLICT },
        },
      },
      async (request, reply) => {
        const context = tenantOf(request);
        const { principal, repos } = context;
        request.auditTarget = { type: "job", id: request.params.id };
        const job = await repos.jobs.findById(request.params.id);
        if (job === null) throw new ReplayTargetNotFoundError();
        // A replay re-queues collection on the job's run and rewrites the job's and the run's
        // recorded state, in a transaction of its own: refused whole before it starts when the
        // run is person data (D-30, reversing the Phase 6a ruling that left replay ungated).
        await requirePersonAccess(
          context,
          { runJobs: job.runId },
          "This job's replay: its run's collection and its recorded outcome.",
        );
        const replayed = await services().runs.replayer.replay(
          principal.tenantId,
          request.params.id,
        );
        void reply.code(202);
        return replayed;
      },
    );

    app.get(
      "/api/v1/usage",
      {
        config: { access: { permission: "usage:read", action: "usage.read" } },
        schema: {
          operationId: "getUsage",
          summary: "The tenant's upstream requests this day and month, beside its quotas",
          tags: ["usage"],
          security: SECURITY,
          response: { 200: UsageView, ...PROTECTED_ERRORS },
        },
      },
      async (request) => {
        const { repos } = tenantOf(request);
        const summary = await usageSummary(repos, QUOTA_UNIT, new Date());
        return {
          lines: summary.lines.map((line) => ({ ...line, periodStart: iso(line.periodStart) })),
          exceeded: summary.exceeded,
        };
      },
    );
    return Promise.resolve();
  };

/** One read of the stream: the run's progress (null once it is gone), or why access is refused. */
type StreamRead =
  | { readonly kind: "progress"; readonly progress: RunProgress | null }
  | { readonly kind: "refused"; readonly refusal: AccessRefusal };

/**
 * Writes a run's progress as server-sent events until it is settled, the
 * client leaves, or a re-check of access refuses it.
 */
function streamRun(options: {
  readonly raw: ServerResponse;
  readonly runs: RunServices;
  readonly initial: RunProgress;
  readonly read: () => Promise<StreamRead>;
  readonly log: FastifyBaseLogger;
}): void {
  const { raw, runs } = options;
  /**
   * How often access is re-checked: with every progress read, so exactly the
   * poll interval (RUN_EVENTS_POLL_MS). Stated in the `locked` event.
   */
  const accessRecheckMs = runs.eventsPollMs;
  // An object, so the check after each wait sees a disconnect that happened during it.
  const stream = { open: true };
  const isOpen = () => stream.open;
  const started = Date.now();
  let lastHeartbeat = started;
  let lastRun = "";
  const lastJobs = new Map<string, string>();

  /** Validated on the way out, so the wire never differs from the documented schema. */
  const send = (message: RunStreamEventType) => {
    const event = RunStreamEvent.parse(message);
    raw.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
  };
  const emit = (progress: RunProgress) => {
    const view = runView(runs, progress);
    const { jobs, ...run } = view;
    const runJson = JSON.stringify(run);
    if (runJson !== lastRun) {
      lastRun = runJson;
      send({ event: "run", data: run });
    }
    for (const job of jobs) {
      const jobJson = JSON.stringify(job);
      if (lastJobs.get(job.id) !== jobJson) {
        lastJobs.set(job.id, jobJson);
        send({ event: "job", data: job });
      }
    }
    return progress.settled;
  };
  const close = () => {
    if (!stream.open) return;
    stream.open = false;
    raw.end();
  };
  raw.on("close", () => {
    stream.open = false;
  });

  const loop = async () => {
    if (emit(options.initial)) {
      send({ event: "end", data: { status: options.initial.status } });
      close();
      return;
    }
    while (isOpen()) {
      await new Promise((resolve) => setTimeout(resolve, runs.eventsPollMs));
      if (!isOpen()) return;
      const read = await options.read();
      if (read.kind === "refused") {
        const { refusal } = read;
        send({
          event: "locked",
          data: {
            reason: refusal.reason,
            code: refusal.code,
            detail: `${refusal.message} Access to this run was re-checked and is now refused, so the stream is closed: a policy decision, not a dropped connection. Access is re-checked with every progress read, every ${String(accessRecheckMs)} ms.`,
            locked: refusal.locked,
            recheckIntervalMs: accessRecheckMs,
            checkedAt: new Date().toISOString(),
          },
        });
        close();
        return;
      }
      const progress = read.progress;
      if (progress === null) {
        send({ event: "end", data: { status: null } });
        close();
        return;
      }
      if (emit(progress)) {
        send({ event: "end", data: { status: progress.status } });
        close();
        return;
      }
      if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
        lastHeartbeat = Date.now();
        raw.write(": keep-alive\n\n");
      }
      if (Date.now() - started >= MAX_STREAM_MS) {
        send({ event: "timeout", data: { reconnect: true } });
        close();
        return;
      }
    }
  };
  loop().catch((error: unknown) => {
    options.log.error({ err: error }, "run progress stream failed");
    if (stream.open) {
      send({ event: "error", data: { code: "STREAM_FAILED" } });
      close();
    }
  });
}
