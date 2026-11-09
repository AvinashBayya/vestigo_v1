import { detectTargetType, validateCronExpression } from "@repo/core";
import type { Monitor } from "@repo/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import { HttpError, notFound } from "../http/errors.ts";
import { requirePersonAccess } from "../http/person-gate.ts";
import { IdParams, iso, LimitQuery, page, PROTECTED_ERRORS, SECURITY } from "./schemas.ts";

export const MonitorView = z.object({
  id: z.uuid(),
  name: z.string(),
  target: z.string(),
  scheduleCron: z.string(),
  enabled: z.boolean(),
  createdByUserId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export type MonitorViewType = z.infer<typeof MonitorView>;

export const viewMonitor = (row: Monitor): MonitorViewType => ({
  id: row.id,
  name: row.name,
  target: row.target,
  scheduleCron: row.scheduleCron,
  enabled: row.enabled,
  createdByUserId: row.createdByUserId,
  createdAt: iso(row.createdAt),
});

export const TickResult = z.object({
  monitorId: z.uuid(),
  executedAt: z.iso.datetime(),
  target: z.string(),
  status: z.enum(["EXECUTED", "NO_NEW_DATA"]),
  message: z.string(),
  alertId: z.uuid().nullable(),
});

export const monitorRoutes: FastifyPluginAsyncZod = (app) => {
  app.post(
    "/api/v1/monitors",
    {
      config: { access: { permission: "monitor:write", action: "monitor.create" } },
      schema: {
        operationId: "createMonitor",
        summary: "Create a scheduled monitor for an intelligence target",
        tags: ["monitors"],
        security: SECURITY,
        body: z.object({
          name: z.string().trim().min(1).max(200),
          target: z.string().trim().min(1).max(500),
          scheduleCron: z.string().trim().min(1).max(100),
          enabled: z.boolean().default(true),
        }),
        response: { 201: MonitorView, ...PROTECTED_ERRORS },
      },
    },
    async (request, reply) => {
      const { repos, principal } = tenantOf(request);
      const { name, target, scheduleCron, enabled } = request.body;

      const cronValidation = validateCronExpression(scheduleCron);
      if (!cronValidation.isValid) {
        throw new HttpError(400, "INVALID_CRON", cronValidation.error);
      }

      const createdByUserId =
        principal.kind === "session" ? principal.userId : principal.issuerUserId;

      const created = await repos.monitors.create({
        name,
        target,
        scheduleCron,
        enabled,
        createdByUserId,
      });

      request.auditTarget = { type: "monitor", id: created.id };
      void reply.code(201);
      return viewMonitor(created);
    },
  );

  app.get(
    "/api/v1/monitors",
    {
      config: { access: { permission: "monitor:read", action: "monitor.list" } },
      schema: {
        operationId: "listMonitors",
        summary: "List scheduled monitors for this tenant",
        tags: ["monitors"],
        security: SECURITY,
        querystring: LimitQuery,
        response: {
          200: z.object({ items: z.array(MonitorView), hasMore: z.boolean() }),
          ...PROTECTED_ERRORS,
        },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      const rows = await repos.monitors.list({ limit: request.query.limit + 1 });
      const result = page(rows, request.query.limit);
      return { items: result.items.map(viewMonitor), hasMore: result.hasMore };
    },
  );

  app.get(
    "/api/v1/monitors/:id",
    {
      config: { access: { permission: "monitor:read", action: "monitor.read" } },
      schema: {
        operationId: "getMonitor",
        summary: "Inspect a scheduled monitor by ID",
        tags: ["monitors"],
        security: SECURITY,
        params: IdParams,
        response: { 200: MonitorView, ...PROTECTED_ERRORS },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      const row = await repos.monitors.findById(request.params.id);
      if (row === null) throw notFound("The monitor");
      return viewMonitor(row);
    },
  );

  app.patch(
    "/api/v1/monitors/:id",
    {
      config: { access: { permission: "monitor:write", action: "monitor.update" } },
      schema: {
        operationId: "updateMonitor",
        summary: "Update a monitor's schedule, target, name, or enabled state",
        tags: ["monitors"],
        security: SECURITY,
        params: IdParams,
        body: z.object({
          name: z.string().trim().min(1).max(200).optional(),
          target: z.string().trim().min(1).max(500).optional(),
          scheduleCron: z.string().trim().min(1).max(100).optional(),
          enabled: z.boolean().optional(),
        }),
        response: { 200: MonitorView, ...PROTECTED_ERRORS },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      const patch = request.body;

      if (patch.scheduleCron !== undefined) {
        const cronValidation = validateCronExpression(patch.scheduleCron);
        if (!cronValidation.isValid) {
          throw new HttpError(400, "INVALID_CRON", cronValidation.error);
        }
      }

      const updated = await repos.monitors.update(request.params.id, patch);
      if (updated === null) throw notFound("The monitor");
      request.auditTarget = { type: "monitor", id: updated.id };
      return viewMonitor(updated);
    },
  );

  app.post(
    "/api/v1/monitors/:id/enable",
    {
      config: { access: { permission: "monitor:write", action: "monitor.enable" } },
      schema: {
        operationId: "enableMonitor",
        summary: "Explicitly enable a scheduled monitor",
        tags: ["monitors"],
        security: SECURITY,
        params: IdParams,
        response: { 200: MonitorView, ...PROTECTED_ERRORS },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      const updated = await repos.monitors.update(request.params.id, { enabled: true });
      if (updated === null) throw notFound("The monitor");
      request.auditTarget = { type: "monitor", id: updated.id };
      return viewMonitor(updated);
    },
  );

  app.post(
    "/api/v1/monitors/:id/disable",
    {
      config: { access: { permission: "monitor:write", action: "monitor.disable" } },
      schema: {
        operationId: "disableMonitor",
        summary: "Explicitly disable/pause a scheduled monitor",
        tags: ["monitors"],
        security: SECURITY,
        params: IdParams,
        response: { 200: MonitorView, ...PROTECTED_ERRORS },
      },
    },
    async (request) => {
      const { repos } = tenantOf(request);
      const updated = await repos.monitors.update(request.params.id, { enabled: false });
      if (updated === null) throw notFound("The monitor");
      request.auditTarget = { type: "monitor", id: updated.id };
      return viewMonitor(updated);
    },
  );

  app.delete(
    "/api/v1/monitors/:id",
    {
      config: { access: { permission: "monitor:write", action: "monitor.delete" } },
      schema: {
        operationId: "deleteMonitor",
        summary: "Deactivate a scheduled monitor",
        tags: ["monitors"],
        security: SECURITY,
        params: IdParams,
        response: { 204: z.null(), ...PROTECTED_ERRORS },
      },
    },
    async (request, reply) => {
      const { repos } = tenantOf(request);
      const deactivated = await repos.monitors.deactivate(request.params.id);
      if (!deactivated) throw notFound("The monitor");
      request.auditTarget = { type: "monitor", id: request.params.id };
      void reply.code(204);
      return null;
    },
  );

  app.post(
    "/api/v1/monitors/:id/tick",
    {
      config: { access: { permission: "monitor:write", action: "monitor.tick" } },
      schema: {
        operationId: "tickMonitor",
        summary:
          "Execute an authorized monitor check using existing collection and evidence infrastructure",
        tags: ["monitors"],
        security: SECURITY,
        params: IdParams,
        response: { 200: TickResult, ...PROTECTED_ERRORS },
      },
    },
    async (request) => {
      const context = tenantOf(request);
      const { repos } = context;
      const monitor = await repos.monitors.findById(request.params.id);
      if (monitor === null) throw notFound("The monitor");
      if (!monitor.enabled) {
        throw new HttpError(
          400,
          "MONITOR_DISABLED",
          "Cannot execute a disabled monitor. Enable the monitor first.",
        );
      }

      // Validate target through detection
      const detected = detectTargetType(monitor.target);

      // Check for latest evidence on this target in tenant evidence repository
      const targetEvidence = await repos.evidence.list({ limit: 50 });
      const matchingEvidence = targetEvidence.find(
        (e) =>
          (e.sourceUrl !== null && e.sourceUrl.includes(monitor.target)) ||
          e.collectorId === monitor.target,
      );

      // The correlated evidence can rest on person data; refuse the whole tick
      // before any alert is created or returned when the tenant may not access
      // it (CLAUDE.md §9). Empty when nothing matched, so nothing is withheld.
      await requirePersonAccess(
        context,
        { evidenceIds: matchingEvidence === undefined ? [] : [matchingEvidence.id] },
        "This monitor tick's correlated evidence and any alert it would raise.",
      );

      let createdAlertId: string | null = null;
      if (matchingEvidence !== undefined) {
        // Check for existing alert for this (monitorId, evidenceId) to ensure deduplication
        const existingAlert = await repos.alerts.findByMonitorAndEvidence(
          monitor.id,
          matchingEvidence.id,
        );

        if (existingAlert === null) {
          const alert = await repos.alerts.create({
            monitorId: monitor.id,
            title: `Monitor check detected evidence for ${monitor.target}`,
            evidenceId: matchingEvidence.id,
          });
          createdAlertId = alert.id;
        } else {
          createdAlertId = existingAlert.id;
        }
      }

      return {
        monitorId: monitor.id,
        executedAt: new Date().toISOString(),
        target: monitor.target,
        status: matchingEvidence !== undefined ? ("EXECUTED" as const) : ("NO_NEW_DATA" as const),
        message:
          matchingEvidence !== undefined
            ? `Monitor check completed; evidence correlated for ${detected.primaryType}.`
            : `Monitor check completed; detected as ${detected.primaryType}, no new evidence found.`,
        alertId: createdAlertId,
      };
    },
  );

  return Promise.resolve();
};
