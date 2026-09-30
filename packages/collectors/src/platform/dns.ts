import { z } from "zod";
import { defineCollector, type Collector } from "../contract.ts";
import { UpstreamResponseError, UpstreamUnavailableError } from "../errors.ts";
import { parseIPv4 } from "../fetcher/address.ts";
import type { CapturedResponse } from "../fetcher/capture.ts";

/**
 * DNS A-record resolution through Cloudflare's public resolver, over its
 * DNS-over-HTTPS JSON API. Ported from the previous codebase's DNS adapter
 * (INVENTORY.md verdict: KEEP), which queried A records only.
 *
 * The resolver is a third party reporting what DNS says, so the evidence is
 * REPORTED, not OBSERVED. Every record in the answer is returned as the
 * resolver wrote it: nothing is filtered out (the previous adapter silently
 * dropped private addresses), renamed or filled in.
 *
 * Status mapping:
 *   HTTP 2xx, DNS NOERROR with A records    FOUND
 *   HTTP 2xx, DNS NOERROR with no A records NOT_FOUND (the name has no address)
 *   HTTP 2xx, DNS NXDOMAIN                  NOT_FOUND (the name does not exist)
 *   HTTP 2xx, DNS SERVFAIL                  UNAVAILABLE (the resolver could not answer)
 *   HTTP 2xx, any other DNS status          FAILED
 *   HTTP 429, 5xx                           UNAVAILABLE, with Retry-After when given
 *   anything else, or an unusable body      FAILED
 */

const ENDPOINT = "https://cloudflare-dns.com/dns-query";
const FETCH_TIMEOUT_MS = 10_000;
/** A DNS message is at most 64 KiB on the wire; its JSON form stays well inside this. */
const MAX_RESPONSE_BYTES = 256 * 1024;

/** DNS record type codes (IANA "Resource Record (RR) TYPEs"). */
const TYPE_A = 1;
const TYPE_CNAME = 5;

/** DNS RCODEs (RFC 1035 §4.1.1) the mapping above distinguishes. */
const RCODE_NOERROR = 0;
const RCODE_SERVFAIL = 2;
const RCODE_NXDOMAIN = 3;

/** The resolver's JSON, as Cloudflare documents it. Fields the collector does not use are ignored. */
const DOH_RECORD = z.object({
  name: z.string().min(1),
  type: z.number().int().min(0).max(65_535),
  TTL: z.number().int().min(0),
  data: z.string(),
});
const DOH_RESPONSE = z.object({
  Status: z.number().int().min(0),
  TC: z.boolean().optional(),
  AD: z.boolean().optional(),
  Question: z.array(z.object({ name: z.string(), type: z.number().int() })),
  Answer: z.array(DOH_RECORD).optional(),
});

const RECORD = z.object({
  /** The record's owner name, as the resolver wrote it. */
  name: z.string().min(1),
  /** The record type code as reported: 1 is A, 5 is CNAME. */
  type: z.number().int().min(0).max(65_535),
  /** The record's TTL as reported: how long, in seconds, the resolver said it may be cached. */
  ttlSeconds: z.number().int().min(0),
  /** The record's data as reported: an IPv4 address for A, the alias target for CNAME. */
  data: z.string(),
});

export const DNS_RESULT = z.object({
  /** The question the resolver says it answered: the target name, type A. */
  question: z.object({ name: z.string().min(1), type: z.literal(TYPE_A) }),
  /**
   * The answer section, in the resolver's order, every record as reported.
   * Holds at least one A record; any CNAME records are the alias chain the
   * resolver followed to reach them.
   */
  answer: z.array(RECORD).min(1),
  /**
   * The resolver's AD flag: whether it reports having authenticated the
   * answer with DNSSEC. Null when the response does not carry the flag.
   */
  authenticatedData: z.boolean().nullable(),
  /**
   * The resolver's TC flag. True means it says the answer was truncated, so
   * the records here may be only part of the answer. Null when not carried.
   */
  truncated: z.boolean().nullable(),
  /** Nothing here is computed: every value above is the resolver's (src/provenance.ts). */
  derived: z.object({}).strict(),
});
export type DnsResult = z.infer<typeof DNS_RESULT>;

/** A DNS name compared as DNS compares it: case-insensitive, trailing dot optional. */
function sameName(a: string, b: string): boolean {
  return a.toLowerCase().replace(/\.$/, "") === b.toLowerCase().replace(/\.$/, "");
}

/**
 * The wait the upstream asked for, from Retry-After in seconds or as an
 * HTTP date. A date is measured against the response's own Date header, or
 * the time it arrived. Null when the header is absent or unreadable.
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

function readAnswer(response: CapturedResponse) {
  const parsed = DOH_RESPONSE.safeParse(response.json());
  if (!parsed.success) {
    throw new UpstreamResponseError("the resolver's JSON is not the documented DNS answer shape");
  }
  return parsed.data;
}

export const dnsCollector: Collector = defineCollector(
  {
    id: "dns",
    version: "1.0.0",
    displayName: "DNS over HTTPS (Cloudflare resolver)",
    discipline: "TECHINT",
    targetTypes: ["DOMAIN"],
    collectionMode: "PASSIVE_API",
    source: "cloudflare-doh",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "REPORTED",
    timeoutMs: 15_000,
    resultSchema: DNS_RESULT,
  },
  async (ctx) => {
    const name = ctx.target.value;
    const response = await ctx.fetch(`${ENDPOINT}?name=${encodeURIComponent(name)}&type=A`, {
      method: "GET",
      headers: { accept: "application/dns-json" },
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_RESPONSE_BYTES,
    });

    const { status } = response;
    if (status === 429) {
      throw new UpstreamUnavailableError(
        "the resolver is rate limiting (HTTP 429)",
        retryAfterMs(response),
      );
    }
    if (status >= 500) {
      throw new UpstreamUnavailableError(
        `the resolver answered HTTP ${String(status)}`,
        retryAfterMs(response),
      );
    }
    if (status < 200 || status > 299) {
      // There are no credentials to reject, and a 404 here means the endpoint,
      // not the name, was not found: none of these is an answer about the target.
      throw new UpstreamResponseError(`the resolver answered HTTP ${String(status)}`);
    }

    const doh = readAnswer(response);
    const [question, ...extraQuestions] = doh.Question;
    if (
      question === undefined ||
      extraQuestions.length > 0 ||
      question.type !== TYPE_A ||
      !sameName(question.name, name)
    ) {
      throw new UpstreamResponseError("the resolver's answer is not for the question asked");
    }
    const answer = doh.Answer ?? [];

    if (doh.Status === RCODE_SERVFAIL) {
      throw new UpstreamUnavailableError("the resolver answered SERVFAIL", null);
    }
    if (doh.Status === RCODE_NXDOMAIN) {
      return ctx.notFound(
        response,
        answer.some((record) => record.type === TYPE_CNAME)
          ? "The resolver answered NXDOMAIN: the name is an alias whose target does not exist."
          : "The resolver answered NXDOMAIN: the name does not exist.",
      );
    }
    if (doh.Status !== RCODE_NOERROR) {
      throw new UpstreamResponseError(`the resolver answered DNS status ${String(doh.Status)}`);
    }

    const addresses = answer.filter((record) => record.type === TYPE_A);
    if (addresses.length === 0 && doh.TC === true) {
      // A truncated answer may have lost the A records: it cannot show the name
      // has no address (Phase 3B review: this was NOT_FOUND).
      throw new UpstreamResponseError(
        "the resolver's answer is truncated (TC) and holds no A records, so it shows nothing about the name's addresses",
      );
    }
    if (addresses.length === 0) {
      return ctx.notFound(
        response,
        answer.some((record) => record.type === TYPE_CNAME)
          ? "The resolver answered NOERROR with no A records: the name is an alias whose target has no IPv4 address."
          : "The resolver answered NOERROR with no A records: the name exists but has no IPv4 address.",
      );
    }
    if (addresses.some((record) => parseIPv4(record.data) === null)) {
      throw new UpstreamResponseError("an A record's data is not an IPv4 address");
    }

    return ctx.found(
      {
        question: { name: question.name, type: TYPE_A },
        answer: answer.map((record) => ({
          name: record.name,
          type: record.type,
          ttlSeconds: record.TTL,
          data: record.data,
        })),
        authenticatedData: doh.AD ?? null,
        truncated: doh.TC ?? null,
        derived: {},
      },
      // The resolver gives no date for the records it reports; a TTL is not one.
      [{ response, observedAt: null }],
    );
  },
);
