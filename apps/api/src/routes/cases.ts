import { CLAIM_STRENGTHS, ENTITY_KINDS } from "@repo/core";
import type { Case, CasePin, PinTarget } from "@repo/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { tenantOf } from "../http/access.ts";
import { requirePersonAccess } from "../http/person-gate.ts";
import { HttpError, notFound, ProblemSchema } from "../http/errors.ts";
import type { Services } from "../services.ts";
import {
  iso,
  IdParams,
  JsonValue,
  isoOrNull,
  LimitQuery,
  optionalInstant,
  page,
  PROTECTED_ERRORS,
  SECURITY,
} from "./schemas.ts";

const CaseView = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string().nullable(),
  createdByUserId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  archivedAt: optionalInstant,
  /** How many items are pinned to the case (measured: 0 means none). */
  pinCount: z.number().int().min(0),
});

/**
 * The measured pin count of a case. countsForCases returns an entry for every
 * case asked about, so a missing one is a defect: it fails rather than
 * becoming a zero that was never measured.
 */
function pinCountOf(counts: ReadonlyMap<string, number>, caseId: string): number {
  const count = counts.get(caseId);
  if (count === undefined) {
    throw new HttpError(500, "PIN_COUNT_MISSING", "A case's pin count was not measured.");
  }
  return count;
}

const caseView = (row: Case, pinCount: number): z.infer<typeof CaseView> => ({
  id: row.id,
  title: row.title,
  description: row.description,
  createdByUserId: row.createdByUserId,
  createdAt: iso(row.createdAt),
  archivedAt: isoOrNull(row.archivedAt),
  pinCount,
});

/** What can be pinned. The pin endpoint takes a type and an id, never a screen. */
const PIN_TARGET_TYPES = ["evidence", "entity", "claim"] as const;
const PinTargetInput = z.object({ type: z.enum(PIN_TARGET_TYPES), id: z.uuid() });

const Strength = z.enum(CLAIM_STRENGTHS);

/** The pinned record, summarised so a list needs no further reads. */
const PinSubject = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("evidence"),
    collectorId: z.string(),
    /** The collector's label from the platform registry; null when it is no longer registered. */
    sourceLabel: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    /** When the source says it happened; null when it does not say. */
    observedAt: optionalInstant,
    /** When we fetched it; null when not recorded. */
    collectedAt: optionalInstant,
    strength: Strength,
  }),
  z.object({
    type: z.literal("entity"),
    kind: z.enum(ENTITY_KINDS),
    displayName: z.string(),
  }),
  z.object({
    type: z.literal("claim"),
    entityId: z.uuid().nullable(),
    relationshipId: z.uuid().nullable(),
    attribute: z.string(),
    value: JsonValue,
    strength: Strength,
  }),
]);

const PinView = z.object({
  id: z.uuid(),
  caseId: z.uuid(),
  target: PinTargetInput,
  note: z.string().nullable(),
  pinnedByUserId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  /** Null only if the pinned record can no longer be read. */
  subject: PinSubject.nullable(),
});

function targetOf(pin: CasePin): z.infer<typeof PinTargetInput> {
  if (pin.evidenceId !== null) return { type: "evidence", id: pin.evidenceId };
  if (pin.entityId !== null) return { type: "entity", id: pin.entityId };
  if (pin.claimId !== null) return { type: "claim", id: pin.claimId };
  // The table's CHECK allows exactly one target; this is a corrupted row.
  throw new HttpError(500, "PIN_WITHOUT_TARGET", "A pin has no target.");
}

const pinTarget = (input: z.infer<typeof PinTargetInput>): PinTarget =>
  input.type === "evidence"
    ? { evidenceId: input.id }
    : input.type === "entity"
      ? { entityId: input.id }
      : { claimId: input.id };

export const caseRoutes =
  (services: () => Services): FastifyPluginAsyncZod =>
  (app) => {
    const labelOf = (collectorId: string): string | null =>
      services()
        .runs.registry.list()
        .find((entry) => entry.id === collectorId)?.label ?? null;

    app.post(
      "/api/v1/cases",
      {
        config: { access: { permission: "case:write", action: "case.create" } },
        schema: {
          operationId: "createCase",
          summary: "Open a case",
          tags: ["cases"],
          security: SECURITY,
          body: z.object({
            title: z.string().trim().min(1).max(200),
            description: z.string().trim().min(1).max(5000).nullable().default(null),
          }),
          response: { 201: CaseView, ...PROTECTED_ERRORS },
        },
      },
      async (request, reply) => {
        const { repos, principal } = tenantOf(request);
        const created = await repos.cases.create({
          title: request.body.title,
          description: request.body.description,
          createdByUserId: principal.kind === "session" ? principal.userId : principal.issuerUserId,
        });
        request.auditTarget = { type: "case", id: created.id };
        void reply.code(201);
        return caseView(created, 0);
      },
    );

    app.get(
      "/api/v1/cases",
      {
        config: { access: { permission: "case:read", action: "case.list" } },
        schema: {
          operationId: "listCases",
          summary: "List the tenant's cases, oldest first, archived ones included",
          tags: ["cases"],
          security: SECURITY,
          querystring: LimitQuery,
          response: {
            200: z.object({ items: z.array(CaseView), hasMore: z.boolean() }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const { repos } = tenantOf(request);
        const rows = await repos.cases.list({ limit: request.query.limit + 1 });
        const result = page(rows, request.query.limit);
        const counts = await repos.casePins.countsForCases(result.items.map((row) => row.id));
        return {
          items: result.items.map((row) => caseView(row, pinCountOf(counts, row.id))),
          hasMore: result.hasMore,
        };
      },
    );

    app.get(
      "/api/v1/cases/:id",
      {
        config: { access: { permission: "case:read", action: "case.read" } },
        schema: {
          operationId: "getCase",
          summary: "Read one case",
          tags: ["cases"],
          security: SECURITY,
          params: IdParams,
          response: { 200: CaseView, ...PROTECTED_ERRORS },
        },
      },
      async (request) => {
        const { repos } = tenantOf(request);
        request.auditTarget = { type: "case", id: request.params.id };
        const row = await repos.cases.findById(request.params.id);
        if (row === null) throw notFound("The case");
        const counts = await repos.casePins.countsForCases([row.id]);
        return caseView(row, pinCountOf(counts, row.id));
      },
    );

    app.patch(
      "/api/v1/cases/:id",
      {
        config: { access: { permission: "case:write", action: "case.update" } },
        schema: {
          operationId: "updateCase",
          summary: "Rename a case, change its description, or archive it",
          description:
            "Archiving is one-way here: a case can be archived but not reopened. Pins and the case's content are kept.",
          tags: ["cases"],
          security: SECURITY,
          params: IdParams,
          body: z
            .object({
              title: z.string().trim().min(1).max(200).optional(),
              description: z.string().trim().min(1).max(5000).nullable().optional(),
              archived: z.literal(true).optional(),
            })
            .refine((body) => Object.values(body).some((value) => value !== undefined), {
              message: "Change at least one of title, description or archived.",
            }),
          response: { 200: CaseView, ...PROTECTED_ERRORS },
        },
      },
      async (request) => {
        const { repos } = tenantOf(request);
        const { id } = request.params;
        request.auditTarget = { type: "case", id };
        const { title, description, archived } = request.body;
        if ((await repos.cases.findById(id)) === null) throw notFound("The case");
        if (title !== undefined || description !== undefined) {
          await repos.cases.update(id, {
            ...(title === undefined ? {} : { title }),
            ...(description === undefined ? {} : { description }),
          });
        }
        // Archiving an archived case changes nothing: it stays archived.
        if (archived === true) await repos.cases.archive(id);
        const row = await repos.cases.findById(id);
        if (row === null) throw notFound("The case");
        const counts = await repos.casePins.countsForCases([id]);
        return caseView(row, pinCountOf(counts, id));
      },
    );

    app.post(
      "/api/v1/cases/:id/pins",
      {
        config: { access: { permission: "case:write", action: "case.pin" } },
        schema: {
          operationId: "pinToCase",
          summary: "Pin evidence, an entity or a claim to a case",
          description:
            "Takes the kind and id of what is pinned, from any screen that shows it. Pinning what is already pinned returns the existing pin (200) and changes nothing.",
          tags: ["cases"],
          security: SECURITY,
          params: IdParams,
          body: z.object({
            target: PinTargetInput,
            note: z.string().trim().min(1).max(1000).nullable().default(null),
          }),
          response: {
            200: PinView,
            201: PinView,
            409: ProblemSchema,
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request, reply) => {
        const context = tenantOf(request);
        const { repos, principal } = context;
        const caseRow = await repos.cases.findById(request.params.id);
        if (caseRow === null) throw notFound("The case");
        if (caseRow.archivedAt !== null) {
          throw new HttpError(409, "CASE_ARCHIVED", "An archived case takes no new pins.");
        }
        const target = pinTarget(request.body.target);
        // The pin comes back with a summary of what it points at: person data is not summarised.
        await requirePersonAccess(
          context,
          "evidenceId" in target
            ? { evidenceIds: [target.evidenceId] }
            : "claimId" in target
              ? { claimIds: [target.claimId] }
              : { entityIds: [target.entityId] },
          "The pinned item and its summary.",
        );
        const existing = await repos.casePins.findByTarget(caseRow.id, target);
        const pin =
          existing ??
          (await repos.casePins.pin({
            caseId: caseRow.id,
            target,
            pinnedByUserId:
              principal.kind === "session" ? principal.userId : principal.issuerUserId,
            note: request.body.note,
          }));
        request.auditTarget = { type: "case_pin", id: pin.id };
        void reply.code(existing === null ? 201 : 200);
        const [view] = await pinViews(request, [pin]);
        if (view === undefined) throw notFound("The pin");
        return view;
      },
    );

    app.get(
      "/api/v1/cases/:id/pins",
      {
        config: { access: { permission: "case:read", action: "case.list_pins" } },
        schema: {
          operationId: "listCasePins",
          summary: "List what is pinned to a case, oldest first",
          tags: ["cases"],
          security: SECURITY,
          params: IdParams,
          querystring: LimitQuery,
          response: {
            200: z.object({ items: z.array(PinView), hasMore: z.boolean() }),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request) => {
        const context = tenantOf(request);
        const { repos } = context;
        request.auditTarget = { type: "case", id: request.params.id };
        if ((await repos.cases.findById(request.params.id)) === null) throw notFound("The case");
        // The whole case: its pins point at evidence, claims and entities that may be person data.
        await requirePersonAccess(
          context,
          { scope: { caseId: request.params.id } },
          "The pins of this case, with a summary of each pinned item.",
        );
        const pins = await repos.casePins.listForCase(request.params.id);
        const result = page(pins, request.query.limit);
        return { items: await pinViews(request, result.items), hasMore: result.hasMore };
      },
    );

    app.delete(
      "/api/v1/cases/:id/pins/:pinId",
      {
        config: { access: { permission: "case:write", action: "case.unpin" } },
        schema: {
          operationId: "unpinFromCase",
          summary: "Remove a pin from a case",
          description: "Removes the pin only. The pinned record itself is untouched.",
          tags: ["cases"],
          security: SECURITY,
          params: z.object({ id: z.uuid(), pinId: z.uuid() }),
          response: { 204: z.null(), ...PROTECTED_ERRORS },
        },
      },
      async (request, reply) => {
        const { repos } = tenantOf(request);
        request.auditTarget = { type: "case_pin", id: request.params.pinId };
        const pin = await repos.casePins.findById(request.params.pinId);
        // A pin of another case is not this case's pin.
        if (pin === null || pin.caseId !== request.params.id) throw notFound("The pin");
        await repos.casePins.unpin(pin.id);
        void reply.code(204);
        return null;
      },
    );

    /** Pin rows with their pinned record summarised, in the order given. */
    async function pinViews(
      request: Parameters<typeof tenantOf>[0],
      pins: readonly CasePin[],
    ): Promise<z.infer<typeof PinView>[]> {
      const { repos } = tenantOf(request);
      const ids = (pick: (pin: CasePin) => string | null): string[] =>
        pins.flatMap((pin) => {
          const id = pick(pin);
          return id === null ? [] : [id];
        });
      const [evidenceRows, entityRows, claimRows] = await Promise.all([
        repos.evidence.findByIds(ids((pin) => pin.evidenceId)),
        repos.entities.findByIds(ids((pin) => pin.entityId)),
        repos.claims.findByIds(ids((pin) => pin.claimId)),
      ]);
      const evidenceById = new Map(evidenceRows.map((row) => [row.id, row]));
      const entityById = new Map(entityRows.map((row) => [row.id, row]));
      const claimById = new Map(claimRows.map((row) => [row.id, row]));

      return pins.map((pin): z.infer<typeof PinView> => {
        const target = targetOf(pin);
        let subject: z.infer<typeof PinSubject> | null = null;
        const evidence = pin.evidenceId === null ? undefined : evidenceById.get(pin.evidenceId);
        const entity = pin.entityId === null ? undefined : entityById.get(pin.entityId);
        const claim = pin.claimId === null ? undefined : claimById.get(pin.claimId);
        if (evidence !== undefined) {
          subject = {
            type: "evidence",
            collectorId: evidence.collectorId,
            sourceLabel: labelOf(evidence.collectorId),
            sourceUrl: evidence.sourceUrl,
            observedAt: isoOrNull(evidence.observedAt),
            collectedAt: isoOrNull(evidence.collectedAt),
            strength: evidence.claimStrength,
          };
        } else if (entity !== undefined) {
          subject = { type: "entity", kind: entity.kind, displayName: entity.displayName };
        } else if (claim !== undefined) {
          subject = {
            type: "claim",
            entityId: claim.entityId,
            relationshipId: claim.relationshipId,
            attribute: claim.attribute,
            value: claim.value,
            strength: claim.strength,
          };
        }
        return {
          id: pin.id,
          caseId: pin.caseId,
          target,
          note: pin.note,
          pinnedByUserId: pin.pinnedByUserId,
          createdAt: iso(pin.createdAt),
          subject,
        };
      });
    }
    return Promise.resolve();
  };
