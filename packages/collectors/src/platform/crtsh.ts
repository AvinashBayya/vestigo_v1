import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import {
  UpstreamRejectedError,
  UpstreamResponseError,
  UpstreamUnavailableError,
} from "../errors.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";
import { MAX_BYTES_LIMIT } from "../fetcher/fetcher.ts";

/**
 * Certificate Transparency search through crt.sh: the certificates public CT
 * logs hold for names under a domain. Passive: it reads crt.sh's copy of the
 * logs and never contacts the domain. Rewritten from the previous codebase's
 * crt.sh lookup (INVENTORY.md verdict: REWRITE).
 *
 * What the rewrite removes (docs/audit/COLLECTORS.md row 1): on any failure,
 * a rate limit, an unreadable body, or a genuine zero result, the old lookup
 * silently queried two other upstreams and labelled their rows as crt.sh's.
 * There is no fallback here, and none can be added: this collector's fetch
 * reaches only the hosts of its own catalogue source. If crt.sh fails, the
 * collector fails; if crt.sh lists nothing, the outcome is NOT_FOUND.
 *
 * Also gone: the one in-collector retry. UNAVAILABLE is retryable, and the
 * worker retries it with backoff (CLAUDE.md §5); a second retry loop here
 * would double every retry and spend the source's shared rate limit twice.
 *
 * crt.sh relays what the logs recorded, so the evidence is REPORTED. The
 * result keeps each entry's fields exactly as crt.sh sent them. Everything
 * this collector computes from them sits under `derived`.
 *
 * Status mapping:
 *   HTTP 2xx, a JSON array of entries      FOUND
 *   HTTP 2xx, an empty JSON array          NOT_FOUND (crt.sh lists no certificate)
 *   HTTP 404                               UNAVAILABLE (see below)
 *   HTTP 429, 5xx                          UNAVAILABLE, with Retry-After when given
 *   HTTP 401, 403                          FAILED (crt.sh refused the request)
 *   anything else, or an unusable body     FAILED
 *
 * A 404 is not "no certificates". crt.sh answers a search with nothing in it
 * as an empty array (recorded in test/fixtures/crtsh/empty-example-invalid.json),
 * and the previous codebase measured it answering 404 for the same search URL
 * that answered 200 moments later, when overloaded. Reading that 404 as
 * NOT_FOUND would report a service fault as a fact about the domain.
 */

const SEARCH_ENDPOINT = "https://crt.sh/";
/**
 * The most the fetcher allows. crt.sh is slow: the previous codebase
 * measured successful answers taking 18 s and 43 s.
 */
const FETCH_TIMEOUT_MS = 60_000;
/** The fetch, plus time to parse and index a large answer. */
const RUN_TIMEOUT_MS = 90_000;
/**
 * The most the fetcher allows. A domain with many certificates has a large
 * answer; one larger than this fails (UPSTREAM_RESPONSE_TOO_LARGE) rather
 * than being cut short.
 */
const MAX_RESPONSE_BYTES = MAX_BYTES_LIMIT;

/** crt.sh's timestamp form: an ISO 8601 date and time, with no zone designator. */
const TIMESTAMP = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/);

/**
 * One entry of crt.sh's JSON answer, as recorded in
 * test/fixtures/crtsh/found-example-com.json. crt.sh publishes no schema.
 * `id` and `name_value` are what make an entry an answer to the search, so
 * they are required; any other field may be missing or null. Fields not
 * listed are not read (their meaning is undocumented), and they remain in
 * the evidence payload as sent.
 */
const CRTSH_ENTRY = z.object({
  id: z.number().int().positive(),
  name_value: z.string(),
  common_name: z.string().nullish(),
  issuer_name: z.string().nullish(),
  issuer_ca_id: z.number().int().nullish(),
  serial_number: z.string().nullish(),
  not_before: TIMESTAMP.nullish(),
  not_after: TIMESTAMP.nullish(),
});
const CRTSH_ANSWER = z.array(CRTSH_ENTRY);
type CrtshEntry = z.infer<typeof CRTSH_ENTRY>;

/** One entry as crt.sh reported it. Null where crt.sh sent null or left the field out. */
const CERTIFICATE = z.object({
  /**
   * crt.sh's id for the entry (https://crt.sh/?id=<id> shows it). The same
   * certificate serial can appear under more than one id.
   */
  id: z.number().int().positive(),
  /** crt.sh's issuer_ca_id, as sent. */
  issuerCaId: z.number().int().nullable(),
  /** crt.sh's issuer_name: the issuer's distinguished name, as sent. */
  issuerName: z.string().nullable(),
  /** crt.sh's common_name, as sent. */
  commonName: z.string().nullable(),
  /** crt.sh's name_value, as sent: the identities it matched, one per line. */
  nameValue: z.string(),
  /** crt.sh's serial_number, as sent. */
  serialNumber: z.string().nullable(),
  /** The certificate's validity start, as crt.sh wrote it (no zone designator). */
  notBefore: TIMESTAMP.nullable(),
  /** The certificate's validity end, as crt.sh wrote it (no zone designator). */
  notAfter: TIMESTAMP.nullable(),
  /** Computed by this collector from the fields above (src/provenance.ts). */
  derived: z.object({
    /** nameValue split at its line breaks. */
    names: z.array(z.string()).min(1),
  }),
});

/**
 * A DNS name under the queried domain, gathered from the certificates' names
 * and common names. Computed by this collector, not reported by crt.sh.
 */
const HOSTNAME = z.object({
  /** Lower-cased, with any trailing dot removed. A wildcard keeps its "*." prefix. */
  name: z.string().min(1),
  /** Whether the name is a wildcard ("*." prefix): it names a pattern, not one host. */
  wildcard: z.boolean(),
  /** The ids of the certificates naming it, ascending. */
  certificateIds: z.array(z.number().int().positive()).min(1),
  /** The earliest notBefore among those certificates. Null when none of them carries one. */
  earliestNotBefore: TIMESTAMP.nullable(),
  /** The latest notAfter among those certificates. Null when none of them carries one. */
  latestNotAfter: TIMESTAMP.nullable(),
  /**
   * The organisations (O=) in those certificates' issuer names, distinct and
   * sorted. A certificate whose issuer name has no O= adds none: no issuer is
   * ever guessed.
   */
  issuerOrganisations: z.array(z.string().min(1)),
});

export const CRTSH_RESULT = z.object({
  /** Every entry crt.sh returned, in crt.sh's order. */
  certificates: z.array(CERTIFICATE).min(1),
  /** Computed from `certificates` by this collector. */
  derived: z.object({
    /**
     * Sorted by name. Names that are not DNS names (email addresses, free
     * text), or are outside the queried domain, are left out here and kept
     * in `certificates`.
     */
    hostnames: z.array(HOSTNAME),
  }),
});
export type CrtshResult = z.infer<typeof CRTSH_RESULT>;
type Certificate = CrtshResult["certificates"][number];
type Hostname = CrtshResult["derived"]["hostnames"][number];

const DNS_LABEL = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?$/;

/**
 * True when `host` is the domain itself or a name under it. A bare
 * endsWith(domain) would also accept notexample.com for example.com and
 * credit a third party's certificate to the target.
 */
export function isWithinDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * The organisation (O=) in an issuer's distinguished name, as crt.sh writes
 * it (for example `C=US, O="Example, Inc.", CN=Example CA`). Null when there
 * is no O= component, or it is empty: an issuer is never guessed.
 */
export function parseIssuerOrganisation(issuerName: string | null): string | null {
  if (issuerName === null) return null;
  const match = /(?:^|,)\s*O=("[^"]*"|[^,]*)/.exec(issuerName);
  const raw = match?.[1];
  if (raw === undefined) return null;
  const organisation = raw.trim().replace(/^"|"$/g, "").trim();
  return organisation.length > 0 ? organisation : null;
}

/** A certificate name as a DNS name, or null when it is not one (an email address, free text). */
function dnsName(raw: string): { readonly name: string; readonly wildcard: boolean } | null {
  const name = raw.trim().toLowerCase().replace(/\.$/, "");
  const wildcard = name.startsWith("*.");
  const base = wildcard ? name.slice(2) : name;
  if (base.length === 0 || base.length > 253) return null;
  if (!base.split(".").every((label) => DNS_LABEL.test(label))) return null;
  return { name, wildcard };
}

function earlier(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return b < a ? b : a;
}

function later(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return b > a ? b : a;
}

function toCertificate(entry: CrtshEntry): Certificate {
  return {
    id: entry.id,
    issuerCaId: entry.issuer_ca_id ?? null,
    issuerName: entry.issuer_name ?? null,
    commonName: entry.common_name ?? null,
    nameValue: entry.name_value,
    serialNumber: entry.serial_number ?? null,
    notBefore: entry.not_before ?? null,
    notAfter: entry.not_after ?? null,
    derived: { names: entry.name_value.split("\n") },
  };
}

/** A hostname's facts while the certificates are read; sets keep the work linear. */
interface HostnameFacts {
  readonly name: string;
  readonly wildcard: boolean;
  readonly certificateIds: Set<number>;
  earliestNotBefore: string | null;
  latestNotAfter: string | null;
  readonly issuerOrganisations: Set<string>;
}

/** The DNS names under `domain` that the certificates name, with what they say about each. */
export function deriveHostnames(certificates: readonly Certificate[], domain: string): Hostname[] {
  const found = new Map<string, HostnameFacts>();
  for (const certificate of certificates) {
    const candidates =
      certificate.commonName === null
        ? certificate.derived.names
        : [...certificate.derived.names, certificate.commonName];
    const organisation = parseIssuerOrganisation(certificate.issuerName);
    for (const candidate of candidates) {
      const parsed = dnsName(candidate);
      if (parsed === null) continue;
      const base = parsed.wildcard ? parsed.name.slice(2) : parsed.name;
      if (!isWithinDomain(base, domain)) continue;
      let facts = found.get(parsed.name);
      if (facts === undefined) {
        facts = {
          name: parsed.name,
          wildcard: parsed.wildcard,
          certificateIds: new Set(),
          earliestNotBefore: null,
          latestNotAfter: null,
          issuerOrganisations: new Set(),
        };
        found.set(parsed.name, facts);
      }
      // A certificate naming the same host as both a SAN and its common name counts once.
      if (facts.certificateIds.has(certificate.id)) continue;
      facts.certificateIds.add(certificate.id);
      facts.earliestNotBefore = earlier(facts.earliestNotBefore, certificate.notBefore);
      facts.latestNotAfter = later(facts.latestNotAfter, certificate.notAfter);
      if (organisation !== null) facts.issuerOrganisations.add(organisation);
    }
  }
  return [...found.values()]
    .map((facts) => ({
      name: facts.name,
      wildcard: facts.wildcard,
      certificateIds: [...facts.certificateIds].sort((a, b) => a - b),
      earliestNotBefore: facts.earliestNotBefore,
      latestNotAfter: facts.latestNotAfter,
      issuerOrganisations: [...facts.issuerOrganisations].sort(),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * The wait crt.sh asked for, from Retry-After in seconds or as an HTTP date.
 * A date is measured against the response's own Date header, or the time it
 * arrived. Null when the header is absent or unreadable.
 */
function retryAfterMs(response: CapturedResponse): number | null {
  const header = response.headers["retry-after"];
  if (header === undefined) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) {
    const ms = Number(value) * 1000;
    return Number.isSafeInteger(ms) ? ms : null;
  }
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  const sentHeader = response.headers.date;
  const sent = sentHeader === undefined ? Number.NaN : Date.parse(sentHeader);
  const reference = Number.isNaN(sent) ? response.receivedAt.getTime() : sent;
  return Math.max(0, at - reference);
}

/** Throws the typed error for any status that is not a search answer. */
function requireAnswer(response: CapturedResponse): void {
  const { status } = response;
  if (status >= 200 && status <= 299) return;
  if (status === 429) {
    throw new UpstreamUnavailableError(
      "crt.sh rate-limited the request (HTTP 429)",
      retryAfterMs(response),
    );
  }
  if (status >= 500) {
    throw new UpstreamUnavailableError(
      `crt.sh answered HTTP ${String(status)}`,
      retryAfterMs(response),
    );
  }
  if (status === 404) {
    throw new UpstreamUnavailableError(
      "crt.sh answered HTTP 404, which it does when overloaded; it answers an empty search with an empty list, so this is not a finding",
      retryAfterMs(response),
    );
  }
  if (status === 401 || status === 403) {
    throw new UpstreamRejectedError(`crt.sh refused the request (HTTP ${String(status)})`);
  }
  throw new UpstreamResponseError(
    `crt.sh answered HTTP ${String(status)}, which is not a search answer`,
  );
}

function readEntries(response: CapturedResponse): CrtshEntry[] {
  // json() throws UpstreamResponseError for a body that is not JSON (an HTML error page).
  const body = response.json();
  if (!Array.isArray(body)) {
    throw new UpstreamResponseError("crt.sh's JSON is not a list of certificate entries");
  }
  const parsed = CRTSH_ANSWER.safeParse(body);
  if (!parsed.success) {
    throw new UpstreamResponseError("a crt.sh certificate entry does not have the recorded shape");
  }
  return parsed.data;
}

export const crtshCollector: Collector = defineCollector(
  {
    id: "crtsh",
    version: "1.0.0",
    displayName: "crt.sh Certificate Transparency",
    discipline: "TECHINT",
    targetTypes: ["DOMAIN"],
    collectionMode: "PASSIVE_API",
    source: "crtsh",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: RUN_TIMEOUT_MS,
    resultSchema: CRTSH_RESULT,
  },
  async (ctx) => {
    const domain = ctx.target.value;
    const url = new URL(SEARCH_ENDPOINT);
    // "%." asks for names under the domain; URLSearchParams encodes it as %25.
    url.search = new URLSearchParams({ q: `%.${domain}`, output: "json" }).toString();
    const response = await ctx.fetch(url.href, {
      method: "GET",
      headers: { accept: "application/json" },
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
    });
    requireAnswer(response);
    const entries = readEntries(response);
    if (entries.length === 0) {
      return ctx.notFound(
        response,
        "crt.sh returned an empty list: it lists no certificates for names under the queried domain.",
      );
    }
    const certificates = entries.map(toCertificate);
    // The answer spans many certificates with different dates, so it has no
    // single date of its own; each certificate's dates are in the result.
    return ctx.found(
      { certificates, derived: { hostnames: deriveHostnames(certificates, domain) } },
      [{ response, observedAt: null }],
    );
  },
);
