/**
 * RDAP registration data for a domain, ported from the previous codebase's
 * RDAP adapter (docs/audit/INVENTORY.md: KEEP). The duplicate inline client in
 * the old news route is not ported, and nor are its invented registrar strings
 * (docs/audit/REPORT.md §4): here an absent registrar is null.
 *
 * One lookup: https://rdap.org/domain/<domain>. rdap.org redirects it to the
 * TLD registry's RDAP server; the fetcher follows the redirect only to a
 * registry host the source declares (the IANA bootstrap snapshot), so a
 * registry that serves RDAP over plain http fails as DESTINATION_REFUSED.
 *
 * What a status means here:
 *   - the registry answers 200: FOUND, with what the record states;
 *   - the registry answers 404: NOT_FOUND, "the registry has no record";
 *   - rdap.org answers 404 itself: FAILED. It knows no RDAP service for the
 *     TLD, so no registry was asked and nothing is known about registration;
 *   - 429 and 5xx: UNAVAILABLE, with the upstream's Retry-After when given;
 *   - 401 and 403: FAILED as rejected; anything else: FAILED as unusable.
 */
import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";

const REDIRECTOR_HOST = "rdap.org";

/**
 * Per request. The source allows one request a second across both hops, so
 * the redirect hop can wait up to a second for its slot; this covers that
 * wait and two slow registries.
 */
const FETCH_TIMEOUT_MS = 20_000;

/**
 * The RDAP event whose date is used as the evidence's observedAt: when the
 * registry says the database this record was read from was last updated. It
 * is the registry's own "as of" date for everything reported here. No other
 * date stands in for it.
 */
const OBSERVED_AT_EVENT = "last update of RDAP database";

/** RFC 3339 date-time, as RFC 9083 section 4.5 requires for eventDate. */
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;

// ── What the registry sends (RFC 9083), read leniently: unknown members are ignored.

const RDAP_ENTITY = z.object({
  handle: z.string().optional(),
  roles: z.array(z.string()).optional(),
  // Read strictly only for the registrar (below), so an odd vCard on some
  // other entity cannot fail the lookup.
  vcardArray: z.unknown().optional(),
  publicIds: z.unknown().optional(),
});

const RDAP_DOMAIN = z.object({
  objectClassName: z.literal("domain"),
  ldhName: z.string().min(1),
  unicodeName: z.string().optional(),
  handle: z.string().optional(),
  status: z.array(z.string()).optional(),
  entities: z.array(RDAP_ENTITY).optional(),
  events: z
    .array(
      z.object({
        eventAction: z.string().min(1),
        eventDate: z.string().optional(),
        eventActor: z.string().optional(),
      }),
    )
    .optional(),
  nameservers: z
    .array(z.object({ ldhName: z.string().optional(), unicodeName: z.string().optional() }))
    .optional(),
  secureDNS: z.object({ delegationSigned: z.boolean().optional() }).optional(),
});

/** A jCard (RFC 7095): ["vcard", [[name, parameters, type, value, ...], ...]]. */
const JCARD = z.tuple([z.literal("vcard"), z.array(z.array(z.unknown()).min(4))]);

const PUBLIC_IDS = z.array(z.object({ type: z.string(), identifier: z.string() }));

// ── What this collector reports: only what the record states.

const REGISTRAR = z.object({
  /** The registrar entity's vCard formatted name (its first "fn"), as given; null when it states none. */
  name: z.string().min(1).nullable(),
  /** The registrar entity's RDAP handle, as given; null when it has none. */
  handle: z.string().min(1).nullable(),
  /** Its "IANA Registrar ID" public identifier, as given; null when it lists none. */
  ianaRegistrarId: z.string().min(1).nullable(),
});

export const RDAP_RESULT = z.object({
  /** The domain as the registry names it, in LDH form, exactly as given (often upper case). */
  ldhName: z.string().min(1),
  /** The domain's Unicode form, as given; null when the record has none. */
  unicodeName: z.string().min(1).nullable(),
  /** The registry's handle for the domain; null when the record has none. */
  handle: z.string().min(1).nullable(),
  /** RDAP status values, as given; null when the record has no status member. */
  status: z.array(z.string()).nullable(),
  /** The one entity with the "registrar" role; null when the record names no registrar. */
  registrar: REGISTRAR.nullable(),
  /** Every event, in the record's order, dates exactly as given; null when the record has none. */
  events: z
    .array(
      z.object({
        action: z.string().min(1),
        date: z.string().min(1).nullable(),
        actor: z.string().min(1).nullable(),
      }),
    )
    .nullable(),
  /** Nameservers as the record names them (case as given); null when it has no nameservers member. */
  nameservers: z
    .array(
      z.object({
        ldhName: z.string().min(1).nullable(),
        unicodeName: z.string().min(1).nullable(),
      }),
    )
    .nullable(),
  /** secureDNS.delegationSigned as given; null when the record does not state it. */
  delegationSigned: z.boolean().nullable(),
  /** What this collector measured or computed, not what the record states (src/provenance.ts). */
  derived: z.object({
    /**
     * Measured by the fetcher, not stated by the registry: the host whose
     * response this is, after rdap.org's redirect.
     */
    respondingHost: z.string().min(1),
  }),
});

export type RdapResult = z.infer<typeof RDAP_RESULT>;
type RdapEntity = z.infer<typeof RDAP_ENTITY>;

/** A string the record states: null when absent or blank, otherwise exactly as given. */
function stated(value: string | undefined): string | null {
  return value === undefined || value.trim().length === 0 ? null : value;
}

function readRegistrar(entities: readonly RdapEntity[] | undefined): RdapResult["registrar"] {
  const registrars = (entities ?? []).filter((entity) => entity.roles?.includes("registrar"));
  const [registrar, ...others] = registrars;
  if (registrar === undefined) return null;
  if (others.length > 0) {
    throw new UpstreamResponseError(
      "the record names more than one registrar entity, so none can be reported as its registrar",
    );
  }

  let name: string | null = null;
  if (registrar.vcardArray !== undefined) {
    const jcard = JCARD.safeParse(registrar.vcardArray);
    if (!jcard.success) {
      throw new UpstreamResponseError("the registrar entity's vCard is not a valid jCard");
    }
    const fn = jcard.data[1].find((property) => property[0] === "fn");
    if (fn !== undefined) {
      const value = fn[3];
      if (typeof value !== "string") {
        throw new UpstreamResponseError("the registrar entity's vCard name is not text");
      }
      name = stated(value);
    }
  }

  let ianaRegistrarId: string | null = null;
  if (registrar.publicIds !== undefined) {
    const ids = PUBLIC_IDS.safeParse(registrar.publicIds);
    if (!ids.success) {
      throw new UpstreamResponseError("the registrar entity's publicIds are malformed");
    }
    ianaRegistrarId = stated(ids.data.find((id) => id.type === "IANA Registrar ID")?.identifier);
  }

  return { name, handle: stated(registrar.handle), ianaRegistrarId };
}

/**
 * The registry's own date for this record (OBSERVED_AT_EVENT), or null when
 * it states none, states it more than once, or states it in a form that is
 * not an RFC 3339 date. Never the fetch time.
 */
function observedAtOf(events: RdapResult["events"]): Date | null {
  const matching = (events ?? []).filter((event) => event.action === OBSERVED_AT_EVENT);
  const [only, ...more] = matching;
  if (only === undefined || more.length > 0 || only.date === null) return null;
  if (!RFC3339.test(only.date)) return null;
  const date = new Date(only.date);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Retry-After in milliseconds: delta-seconds, or an HTTP-date measured
 * against the same response's Date header (both the upstream's own values,
 * so no local clock is involved). Null when absent or unreadable.
 */
function retryAfterMs(response: CapturedResponse): number | null {
  const value = response.headers["retry-after"]?.trim();
  if (value === undefined || value.length === 0) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const sentHeader = response.headers.date;
  if (sentHeader === undefined) return null;
  const until = Date.parse(value);
  const sent = Date.parse(sentHeader);
  if (Number.isNaN(until) || Number.isNaN(sent)) return null;
  return Math.max(0, until - sent);
}

function hostOf(response: CapturedResponse): string {
  return new URL(response.url).hostname;
}

export const rdapCollector: Collector = defineCollector(
  {
    id: "rdap",
    version: "1.0.0",
    displayName: "RDAP registration data",
    discipline: "TECHINT",
    targetTypes: ["DOMAIN"],
    collectionMode: "PASSIVE_API",
    source: "rdap",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 30_000,
    resultSchema: RDAP_RESULT,
  },
  async (ctx) => {
    const domain = ctx.target.value;
    const response = await ctx.fetch(
      `https://${REDIRECTOR_HOST}/domain/${encodeURIComponent(domain)}`,
      { method: "GET", timeoutMs: FETCH_TIMEOUT_MS, headers: { accept: "application/rdap+json" } },
    );
    const host = hostOf(response);
    const { status } = response;

    if (status === 404) {
      if (host === REDIRECTOR_HOST) {
        // rdap.org did not redirect: it has no RDAP service for this TLD.
        // That is a gap in coverage, not an answer about registration.
        throw new UpstreamResponseError(
          "rdap.org knows no RDAP registry for this domain's TLD (HTTP 404), so no registry was asked",
        );
      }
      return ctx.notFound(
        response,
        `The registry's RDAP server (${host}) has no record of this domain (HTTP 404).`,
      );
    }
    if (status === 429 || (status >= 500 && status <= 599)) {
      throw new UpstreamUnavailableError(
        `${host} answered HTTP ${String(status)}`,
        retryAfterMs(response),
      );
    }
    if (status === 401 || status === 403) {
      throw new UpstreamRejectedError(
        `${host} refused the request with HTTP ${String(status)}; this source takes no credentials`,
      );
    }
    if (status !== 200) {
      throw new UpstreamResponseError(`${host} answered HTTP ${String(status)}`);
    }

    const parsed = RDAP_DOMAIN.safeParse(response.json());
    if (!parsed.success) {
      throw new UpstreamResponseError(`${host} did not return an RDAP domain object`);
    }
    const record = parsed.data;
    if (record.ldhName.toLowerCase().replace(/\.$/, "") !== domain) {
      throw new UpstreamResponseError(`${host} returned a record for a different domain`);
    }

    const events =
      record.events?.map((event) => ({
        action: event.eventAction,
        date: stated(event.eventDate),
        actor: stated(event.eventActor),
      })) ?? null;
    const result: RdapResult = {
      ldhName: record.ldhName,
      unicodeName: stated(record.unicodeName),
      handle: stated(record.handle),
      status: record.status ?? null,
      registrar: readRegistrar(record.entities),
      events,
      nameservers:
        record.nameservers?.map((nameserver) => ({
          ldhName: stated(nameserver.ldhName),
          unicodeName: stated(nameserver.unicodeName),
        })) ?? null,
      delegationSigned: record.secureDNS?.delegationSigned ?? null,
      derived: { respondingHost: host },
    };
    return ctx.found(result, [{ response, observedAt: observedAtOf(events) }]);
  },
);
