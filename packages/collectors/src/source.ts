import { COMMERCIAL_USE_VERDICTS, type CommercialUseVerdict } from "@repo/core";
import {
  isAccessMethod,
  isKeyedAccessMethod,
  OPERATOR_ID_PREFIX,
  type AccessMethod,
  type DeclaredAccess,
} from "./access.ts";
import { CollectorDefinitionError } from "./errors.ts";
import { isIpLiteralHost } from "./fetcher/address.ts";

/** A calendar date, `YYYY-MM-DD`. */
export type IsoDate = `${number}-${number}-${number}`;

/** A record that someone checked a source's terms, and where that is written down. */
export interface LicenceCheck {
  readonly checkedOn: IsoDate;
  /** The terms page that was read. Null when it could not be fetched or was not recorded. */
  readonly sourceUrl: string | null;
  /** Where the check or decision is recorded, e.g. "docs/audit/COLLECTORS.md row 6". */
  readonly recordedIn: string;
}

/**
 * Whether a source may be used in a commercial product. PERMITTED must rest
 * on terms someone read (a check with its URL). BLOCKED must rest on a
 * recorded check or decision. Only UNVERIFIED may have no check at all, and
 * UNVERIFIED never means "probably fine" (docs/audit/COLLECTORS.md).
 */
export interface LicenceVerdict {
  readonly commercialUse: CommercialUseVerdict;
  /** Why, in a sentence a customer or an auditor could read. */
  readonly reason: string;
  readonly check: LicenceCheck | null;
}

/**
 * A rate limit shared by every collector that uses the source, across every
 * worker process: requests allowed in any interval of this length.
 */
export interface SourceRateLimit {
  readonly requests: number;
  readonly intervalSeconds: number;
  /** UPSTREAM_STATED: the upstream publishes or enforces it. SELF_IMPOSED: our own politeness limit. */
  readonly basis: "UPSTREAM_STATED" | "SELF_IMPOSED";
  readonly note: string;
}

/** Where a source's requests may go. Nothing outside `hosts` is ever contacted. */
/** Who runs some of a source's hosts: the name a reader would recognise. */
export interface SourceOperator {
  readonly name: string;
  readonly hosts: readonly string[];
}

export interface SourceNetwork {
  readonly protocol: "https" | "http";
  /** Exact DNS names; redirects may only stay within them. */
  readonly hosts: readonly string[];
  readonly rateLimit: SourceRateLimit;
  /**
   * Who operates the hosts: every host belongs to exactly one operator. A
   * collector's label must name every operator of its source, so data from
   * a second operator is never shown under the first one's name (Phase 4;
   * the Phase 3B hackernews label named one operator for data from two).
   */
  readonly operators: readonly SourceOperator[];
}

/**
 * The operators a label does not name. A name counts only as a whole word
 * (case-insensitive): "DEV" is named by "DEV Community profile", not by
 * "DEVICE lookup".
 */
export function operatorsMissingFrom(
  label: string,
  operators: readonly SourceOperator[],
): SourceOperator[] {
  return operators.filter((operator) => {
    const escaped = operator.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(label);
  });
}

/** Text and a link that must accompany the source's data wherever it is shown. */
export interface Attribution {
  readonly text: string;
  readonly url: string;
}

/**
 * An upstream: one provider, one set of terms. A fallback to a different
 * provider is a different source with its own verdict, never part of this one.
 */
export interface SourceDeclaration {
  readonly id: string;
  readonly name: string;
  /**
   * How it is reached (src/access.ts): one or more of open, official, licensed
   * and operator, at most one of them keyed. A method says how; whether that
   * may be done is `licence`, which every method of the source shares. A
   * licensed vendor, or an operator's own collector, is a source of its own.
   */
  readonly access: DeclaredAccess;
  readonly licence: LicenceVerdict;
  /** Null for a source that is not reached over the network (a model, a local tool). */
  readonly network: SourceNetwork | null;
  readonly attribution: Attribution | null;
}

export type Source = SourceDeclaration;

const PROTOCOLS = ["https", "http"] as const;
const SOURCE_ID = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DNS_NAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const INTERNAL_SUFFIXES = [".internal", ".local", ".localhost", ".localdomain", ".home.arpa"];
const MAX_INTERVAL_SECONDS = 24 * 60 * 60;

/**
 * Instagram, Facebook and X: never collected from, by any access method
 * (CLAUDE.md §3; ARCHITECTURE-DECISIONS §12). No source may declare one of
 * these domains or a host under it. A backstop for the rule, not the whole of
 * it: a host list cannot see a mirror, or a service that fetches any URL.
 */
export const FORBIDDEN_PLATFORM_DOMAINS: readonly string[] = [
  "instagram.com",
  "cdninstagram.com",
  "instagr.am",
  "facebook.com",
  "facebook.net",
  "fb.com",
  "fb.me",
  "fb.watch",
  "fbcdn.net",
  "fbsbx.com",
  "messenger.com",
  "m.me",
  "x.com",
  "twitter.com",
  "twimg.com",
  "t.co",
];

/** The forbidden domain a host is, or sits under; null when it is none of them. */
export function forbiddenPlatformDomainOf(host: string): string | null {
  const lower = host.toLowerCase();
  return (
    FORBIDDEN_PLATFORM_DOMAINS.find((domain) => lower === domain || lower.endsWith(`.${domain}`)) ??
    null
  );
}

function fail(subject: string, problem: string): never {
  throw new CollectorDefinitionError(subject, problem);
}

function requireText(subject: string, field: string, value: string): void {
  if (value.trim().length === 0) fail(subject, `${field} must not be blank`);
}

function requireHttpsUrl(subject: string, field: string, value: string): void {
  if (!URL.canParse(value) || new URL(value).protocol !== "https:") {
    fail(subject, `${field} must be an https URL`);
  }
}

function isRealDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (match === null) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

/** Whether a host may be declared as a source's destination at all. */
export function isDeclarableHost(host: string): boolean {
  if (host !== host.toLowerCase() || !DNS_NAME.test(host) || isIpLiteralHost(host)) return false;
  if (host === "localhost" || INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return false;
  }
  return true;
}

function validateLicence(subject: string, licence: LicenceVerdict): void {
  if (!(COMMERCIAL_USE_VERDICTS as readonly string[]).includes(licence.commercialUse)) {
    fail(subject, "licence.commercialUse is not a known verdict");
  }
  requireText(subject, "licence.reason", licence.reason);
  const { check } = licence;
  if (check !== null) {
    if (!isRealDate(check.checkedOn)) fail(subject, "licence.check.checkedOn must be YYYY-MM-DD");
    requireText(subject, "licence.check.recordedIn", check.recordedIn);
    if (check.sourceUrl !== null)
      requireHttpsUrl(subject, "licence.check.sourceUrl", check.sourceUrl);
  }
  if (licence.commercialUse === "PERMITTED" && (check === null || check.sourceUrl === null)) {
    fail(subject, "PERMITTED must rest on terms someone read: a check with its sourceUrl");
  }
  if (licence.commercialUse === "BLOCKED" && check === null) {
    fail(subject, "BLOCKED must rest on a recorded check or decision");
  }
}

function validateNetwork(subject: string, network: SourceNetwork): void {
  if (!(PROTOCOLS as readonly string[]).includes(network.protocol)) {
    fail(subject, "network.protocol must be https or http");
  }
  if (network.hosts.length === 0) fail(subject, "network.hosts must name at least one host");
  if (new Set(network.hosts).size !== network.hosts.length) {
    fail(subject, "network.hosts has duplicates");
  }
  for (const host of network.hosts) {
    if (!isDeclarableHost(host)) {
      fail(
        subject,
        `network host "${host}" must be a lowercase public DNS name, not an IP literal`,
      );
    }
    const forbidden = forbiddenPlatformDomainOf(host);
    if (forbidden !== null) {
      fail(
        subject,
        `network host "${host}" is under ${forbidden}: Instagram, Facebook and X are never collected from (CLAUDE.md §3)`,
      );
    }
  }
  const { requests, intervalSeconds, note } = network.rateLimit;
  if (!Number.isSafeInteger(requests) || requests < 1) {
    fail(subject, "network.rateLimit.requests must be a positive integer");
  }
  if (
    !Number.isSafeInteger(intervalSeconds) ||
    intervalSeconds < 1 ||
    intervalSeconds > MAX_INTERVAL_SECONDS
  ) {
    fail(subject, "network.rateLimit.intervalSeconds must be an integer from 1 to 86400");
  }
  requireText(subject, "network.rateLimit.note", note);
  if (network.operators.length === 0) fail(subject, "network.operators must name an operator");
  const operatorNames = network.operators.map((operator) => operator.name.trim().toLowerCase());
  if (new Set(operatorNames).size !== operatorNames.length) {
    fail(subject, "network.operators has duplicate names");
  }
  const operated = network.operators.flatMap((operator) => {
    requireText(subject, "network.operators[].name", operator.name);
    if (operator.hosts.length === 0) fail(subject, `operator "${operator.name}" names no host`);
    return operator.hosts;
  });
  if (
    operated.length !== network.hosts.length ||
    new Set(operated).size !== operated.length ||
    operated.some((host) => !network.hosts.includes(host))
  ) {
    fail(subject, "network.operators must assign every host to exactly one operator");
  }
}

function validateAccess(subject: string, source: SourceDeclaration): void {
  // Read as data, as every field is: a declaration may come from anywhere.
  const declared: unknown = source.access;
  if (!Array.isArray(declared) || declared.length === 0) {
    fail(
      subject,
      "access must name at least one access method: open, official, licensed or operator",
    );
  }
  const methods: AccessMethod[] = [];
  for (const method of declared as readonly unknown[]) {
    if (typeof method !== "string" || !isAccessMethod(method)) {
      fail(subject, "access names something that is not open, official, licensed or operator");
    }
    if (methods.includes(method)) fail(subject, `access names ${method} twice`);
    methods.push(method);
  }
  if (methods.filter(isKeyedAccessMethod).length > 1) {
    fail(
      subject,
      "access names more than one keyed method (official, licensed, operator): another way in, with other credentials, is another source with its own verdict",
    );
  }
  const operator = methods.includes("operator");
  if (operator && methods.length > 1) {
    fail(
      subject,
      "the operator method stands alone: an operator's own collector reads a source of its own",
    );
  }
  if (operator && source.network === null) {
    fail(subject, "the operator method reaches a service over the network, so it needs a network");
  }
  if (operator !== source.id.startsWith(OPERATOR_ID_PREFIX)) {
    fail(
      subject,
      `an id starts "${OPERATOR_ID_PREFIX}" exactly when the source is reached through the operator method`,
    );
  }
}

/** Checks one source declaration against the catalogue rules; throws on the first problem. */
export function validateSource(source: SourceDeclaration): void {
  const subject = `source "${source.id}"`;
  if (!SOURCE_ID.test(source.id)) fail(subject, "id must match ^[a-z0-9][a-z0-9.-]{0,63}$");
  requireText(subject, "name", source.name);
  validateAccess(subject, source);
  validateLicence(subject, source.licence);
  if (source.network !== null) validateNetwork(subject, source.network);
  if (source.attribution !== null) {
    requireText(subject, "attribution.text", source.attribution.text);
    requireHttpsUrl(subject, "attribution.url", source.attribution.url);
  }
}
