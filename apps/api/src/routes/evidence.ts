import { CLAIM_STRENGTHS } from "@repo/core";
import { ContentIntegrityError, ContentNotFoundError } from "@repo/db";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { afterCommit, tenantOf } from "../http/access.ts";
import { HttpError, notFound } from "../http/errors.ts";
import { requirePersonAccess } from "../http/person-gate.ts";
import type { Services } from "../services.ts";
import {
  iso,
  IdParams,
  isoOrNull,
  JsonValue,
  optionalInstant,
  PROTECTED_ERRORS,
  SECURITY,
} from "./schemas.ts";

const Strength = z.enum(CLAIM_STRENGTHS);
const CLAIM_LIMIT_MAX = 500;

const EvidenceClaim = z.object({
  id: z.uuid(),
  /** The entity or the relationship the claim is about: exactly one is set. */
  entityId: z.uuid().nullable(),
  relationshipId: z.uuid().nullable(),
  attribute: z.string(),
  /** What the claim states. Null is a stated null, not a missing value. */
  value: JsonValue,
  strength: Strength,
  createdAt: z.iso.datetime(),
});

const EvidenceView = z.object({
  id: z.uuid(),
  collectorId: z.string(),
  collectorVersion: z.string(),
  /**
   * The collector's label from the platform registry. Null when the collector
   * is no longer registered; the attribution is then unknown too.
   */
  sourceLabel: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  /** The job that collected it; null for evidence recorded outside a job. */
  jobId: z.uuid().nullable(),
  runId: z.uuid().nullable(),
  /** `sha256:` of the raw payload, which the payload download re-checks on every read. */
  contentHash: z.string(),
  /** When the source says it happened. Null when it does not say: never the collection time. */
  observedAt: optionalInstant,
  /** When we fetched it. Null when not recorded. */
  collectedAt: optionalInstant,
  /** When the platform recorded the evidence. */
  recordedAt: z.iso.datetime(),
  /** The strength the collector's registry entry assigns to everything it stated. */
  strength: Strength,
  /** Must be shown wherever this evidence or its data appears; null when the source requires none. */
  attribution: z.object({ text: z.string(), url: z.string() }).nullable(),
  /** All claims citing this evidence (measured: 0 means none). */
  claimCount: z.number().int().min(0),
  /** True when more claims cite it than were returned: the two lists below are partial. */
  claimsTruncated: z.boolean(),
  /**
   * Claims whose value the source stated, at the evidence's strength.
   * (The stored payload is the raw upstream response. Values the platform
   * computed from it are the DERIVED claims below, never mixed into these.)
   */
  stated: z.array(EvidenceClaim),
  /** Claims the platform computed from this evidence: strength DERIVED. */
  derived: z.array(EvidenceClaim),
});

export const evidenceRoutes =
  (services: () => Services): FastifyPluginAsyncZod =>
  (app) => {
    app.get(
      "/api/v1/evidence/:id",
      {
        config: { access: { permission: "evidence:read", action: "evidence.read" } },
        schema: {
          operationId: "getEvidence",
          summary: "Read one evidence record: where it came from, when, and what rests on it",
          description:
            "The record the provenance drawer shows. observedAt and collectedAt are separate and each may be null. Claims citing the evidence are split: `stated` by the source, `derived` computed by the platform. The raw payload is a separate download.",
          tags: ["evidence"],
          security: SECURITY,
          params: IdParams,
          querystring: z.object({
            claimLimit: z.coerce.number().int().min(1).max(CLAIM_LIMIT_MAX).default(200),
          }),
          response: { 200: EvidenceView, ...PROTECTED_ERRORS },
        },
      },
      async (request) => {
        const context = tenantOf(request);
        const { repos } = context;
        request.auditTarget = { type: "evidence", id: request.params.id };
        const evidence = await repos.evidence.findById(request.params.id);
        if (evidence === null) throw notFound("The evidence");
        await requirePersonAccess(
          context,
          { evidenceIds: [evidence.id] },
          "This evidence record, its claims and its payload.",
        );

        const job = evidence.jobId === null ? null : await repos.jobs.findById(evidence.jobId);
        const { claimLimit } = request.query;
        const [rows, claimCount] = await Promise.all([
          repos.claims.listForEvidence([evidence.id], { limit: claimLimit + 1 }),
          repos.claims.countForEvidence([evidence.id]),
        ]);
        const claims = rows.slice(0, claimLimit).map((claim) => ({
          id: claim.id,
          entityId: claim.entityId,
          relationshipId: claim.relationshipId,
          attribute: claim.attribute,
          value: claim.value,
          strength: claim.strength,
          createdAt: iso(claim.createdAt),
        }));
        const entry = services()
          .runs.registry.list()
          .find((candidate) => candidate.id === evidence.collectorId);
        return {
          id: evidence.id,
          collectorId: evidence.collectorId,
          collectorVersion: evidence.collectorVersion,
          sourceLabel: entry === undefined ? null : entry.label,
          sourceUrl: evidence.sourceUrl,
          jobId: evidence.jobId,
          runId: job === null ? null : job.runId,
          contentHash: evidence.contentHash,
          observedAt: isoOrNull(evidence.observedAt),
          collectedAt: isoOrNull(evidence.collectedAt),
          recordedAt: iso(evidence.createdAt),
          strength: evidence.claimStrength,
          attribution:
            entry === undefined || entry.attribution === null
              ? null
              : { text: entry.attribution.text, url: entry.attribution.url },
          claimCount,
          claimsTruncated: rows.length > claimLimit,
          stated: claims.filter((claim) => claim.strength !== "DERIVED"),
          derived: claims.filter((claim) => claim.strength === "DERIVED"),
        };
      },
    );

    app.get(
      "/api/v1/evidence/:id/payload",
      {
        config: { access: { permission: "evidence:read", action: "evidence.payload" } },
        schema: {
          operationId: "downloadEvidencePayload",
          summary: "Download the raw payload exactly as it was collected",
          description:
            "The bytes the collector captured, re-hashed against the recorded content hash on every read; a payload that no longer matches is refused (500 EVIDENCE_PAYLOAD_INTEGRITY_FAILED), never served. Always an attachment, never rendered: a payload is untrusted third-party content.",
          tags: ["evidence"],
          security: SECURITY,
          params: IdParams,
          produces: ["application/octet-stream"],
          response: {
            200: z.string().describe("The raw payload bytes."),
            ...PROTECTED_ERRORS,
          },
        },
      },
      async (request, reply) => {
        const context = tenantOf(request);
        const { repos, tenantId } = context;
        request.auditTarget = { type: "evidence", id: request.params.id };
        const evidence = await repos.evidence.findById(request.params.id);
        if (evidence === null) throw notFound("The evidence");
        await requirePersonAccess(
          context,
          { evidenceIds: [evidence.id] },
          "This evidence record, its claims and its payload.",
        );
        const { contentStore } = services().runs;
        const { id, contentHash } = evidence;
        // Read after the transaction commits: the store is not the database.
        afterCommit(request, async () => {
          let bytes: Uint8Array;
          try {
            // Re-hashed on read: content that no longer matches its hash is refused.
            bytes = await contentStore.get(tenantId, contentHash);
          } catch (error) {
            if (error instanceof ContentIntegrityError) {
              throw new HttpError(
                500,
                "EVIDENCE_PAYLOAD_INTEGRITY_FAILED",
                "The stored payload no longer matches its recorded hash, so it was not served.",
              );
            }
            if (error instanceof ContentNotFoundError) {
              throw new HttpError(
                404,
                "EVIDENCE_PAYLOAD_NOT_FOUND",
                "The evidence is recorded, but its payload is not in the content store.",
              );
            }
            throw error;
          }
          void reply.hijack();
          reply.raw.writeHead(200, {
            // Untrusted third-party bytes: never typed, never inline, never sniffed.
            "content-type": "application/octet-stream",
            "content-length": String(bytes.byteLength),
            "content-disposition": `attachment; filename="evidence-${id}.bin"`,
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'; sandbox",
            "x-content-hash": contentHash,
            "cache-control": "no-store",
          });
          reply.raw.end(Buffer.from(bytes));
        });
      },
    );
    return Promise.resolve();
  };
