/**
 * What each collector's recorded result says, as entities, relationships and
 * claims, each claim citing the one evidence item it rests on.
 *
 * The rules every extractor follows:
 *   - A value outside the result's `derived` block is the source's, and its
 *     claim carries the evidence's own strength. A value under `derived` is
 *     this collector's computation, and its claim is DERIVED (Phase 3B).
 *   - A null value is absence and makes no claim: nothing is asserted about
 *     what was not stated.
 *   - An entity is identified only by an identifier the result states (a
 *     domain, an address, an account); people and organisations only by an
 *     external registry's id, never by a name (./identifiers.ts).
 *   - Evidence is referred to by its index in the job's evidence list, which
 *     is the order the collector cited its responses in.
 */
import {
  COMMONCRAWL_RESULT,
  CONTACT_PHONE_RESULT,
  CRTSH_RESULT,
  DEVTO_RESULT,
  DNS_RESULT,
  GITHUB_RESULT,
  HACKERNEWS_RESULT,
  RDAP_RESULT,
  WAYBACK_RESULT,
  WIKIDATA_RESULT,
} from "@repo/collectors";
import { NotImplementedError, type EntityKind, type TargetType } from "@repo/core";
import {
  externalIdentifier,
  normaliseDomain,
  normaliseEmail,
  normaliseUrl,
  normaliseUsername,
  socialAccountIdentifier,
} from "./identifiers.ts";

export interface EntityDraft {
  readonly key: string;
  readonly kind: EntityKind;
  /** Null for a named entity with no external id: it is created, never resolved. */
  readonly identifier: string | null;
  readonly displayName: string;
}

export interface RelationshipDraft {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
}

export interface ClaimDraft {
  /** An entity key, or a relationship key. */
  readonly subject: { readonly entity: string } | { readonly relationship: string };
  readonly attribute: string;
  readonly value: unknown;
  /** Index into the job's evidence list. */
  readonly evidence: number;
  /** A value under the result's `derived` block: the claim is DERIVED. */
  readonly derived: boolean;
}

export interface Extraction {
  readonly entities: readonly EntityDraft[];
  readonly relationships: readonly RelationshipDraft[];
  readonly claims: readonly ClaimDraft[];
}

export interface ExtractorInput {
  readonly target: { readonly type: TargetType; readonly value: string };
  readonly result: unknown;
}

export type Extractor = (input: ExtractorInput) => Extraction;

/** The source's own values: everything but the collector's `derived` block. */
function reported<T extends object>(value: T): Omit<T, "derived"> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "derived")) as Omit<
    T,
    "derived"
  >;
}

/** `platform_attribute` in snake case, e.g. ("github", "publicRepositories") → github_public_repositories. */
function attributeName(prefix: string, field: string): string {
  const snake = field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return snake.startsWith(`${prefix}_`) ? snake : `${prefix}_${snake}`;
}

/** Collects drafts, keeping one entity per key and dropping claims about absent values. */
class Drafts {
  readonly #entities = new Map<string, EntityDraft>();
  readonly #relationships = new Map<string, RelationshipDraft>();
  readonly #claims: ClaimDraft[] = [];
  #unnamed = 0;

  entity(kind: EntityKind, identifier: string | null, displayName: string): string {
    const key =
      identifier === null ? `${kind}|new:${String(this.#unnamed++)}` : `${kind}|${identifier}`;
    if (!this.#entities.has(key)) this.#entities.set(key, { key, kind, identifier, displayName });
    return key;
  }

  /** A claim about an entity; none when the value is null (absence asserts nothing). */
  claim(
    entity: string,
    attribute: string,
    value: unknown,
    evidence: number,
    derived = false,
  ): void {
    if (value === null || value === undefined) return;
    this.#claims.push({ subject: { entity }, attribute, value, evidence, derived });
  }

  /** A relationship, and the claim citing the evidence that asserts it. */
  relate(from: string, to: string, kind: string, evidence: number, derived = false): void {
    if (from === to) return;
    const key = `${from}>${kind}>${to}`;
    if (!this.#relationships.has(key)) this.#relationships.set(key, { key, from, to, kind });
    this.#claims.push({
      subject: { relationship: key },
      attribute: kind,
      value: null,
      evidence,
      derived,
    });
  }

  build(): Extraction {
    return {
      entities: [...this.#entities.values()],
      relationships: [...this.#relationships.values()],
      claims: this.#claims,
    };
  }
}

/** The entity for the target itself: its kind, and its identifier where it has one. */
function targetEntity(drafts: Drafts, target: ExtractorInput["target"]): string {
  switch (target.type) {
    case "DOMAIN":
      return drafts.entity("DOMAIN", normaliseDomain(target.value), target.value);
    case "IP_ADDRESS":
      return drafts.entity("IP_ADDRESS", target.value.toLowerCase(), target.value);
    case "EMAIL_ADDRESS":
      return drafts.entity("EMAIL_ADDRESS", normaliseEmail(target.value), target.value);
    case "PHONE_NUMBER":
      return drafts.entity("PHONE_NUMBER", target.value, target.value);
    case "USERNAME":
      return drafts.entity("USERNAME", normaliseUsername(target.value), target.value);
    case "URL":
      return drafts.entity("URL", normaliseUrl(target.value), target.value);
    case "ORGANIZATION":
      // An organisation's name identifies nothing: a new entity every time.
      return drafts.entity("ORGANIZATION", null, target.value);
    case "FILE":
      throw new NotImplementedError("fusion.file-target", "no collector reads FILE targets yet");
  }
}

const crtsh: Extractor = ({ target, result }) => {
  const r = CRTSH_RESULT.parse(result);
  const d = new Drafts();
  const domain = targetEntity(d, target);
  for (const certificate of r.certificates)
    d.claim(domain, "certificate", reported(certificate), 0);
  for (const host of r.derived.hostnames) {
    if (host.wildcard) {
      d.claim(domain, "wildcard_certificate_name", host, 0, true);
      continue;
    }
    const name = d.entity("DOMAIN", normaliseDomain(host.name), host.name);
    d.relate(name, domain, "subdomain_of", 0, true);
    d.claim(name, "certificate_ids", host.certificateIds, 0, true);
    d.claim(name, "earliest_not_before", host.earliestNotBefore, 0, true);
    d.claim(name, "latest_not_after", host.latestNotAfter, 0, true);
    d.claim(name, "certificate_issuers", host.issuerOrganisations, 0, true);
  }
  return d.build();
};

const dns: Extractor = ({ target, result }) => {
  const r = DNS_RESULT.parse(result);
  const d = new Drafts();
  const domain = targetEntity(d, target);
  for (const record of r.answer) {
    if (record.type === 1) {
      const ip = d.entity("IP_ADDRESS", record.data.toLowerCase(), record.data);
      d.relate(domain, ip, "resolves_to", 0);
      d.claim(ip, "a_record", { name: record.name, ttlSeconds: record.ttlSeconds }, 0);
    } else {
      d.claim(domain, "dns_record", record, 0);
    }
  }
  d.claim(domain, "dnssec_authenticated", r.authenticatedData, 0);
  d.claim(domain, "dns_answer_truncated", r.truncated, 0);
  return d.build();
};

const rdap: Extractor = ({ target, result }) => {
  const r = RDAP_RESULT.parse(result);
  const d = new Drafts();
  const domain = targetEntity(d, target);
  d.claim(domain, "rdap_ldh_name", r.ldhName, 0);
  d.claim(domain, "rdap_unicode_name", r.unicodeName, 0);
  d.claim(domain, "rdap_handle", r.handle, 0);
  d.claim(domain, "rdap_status", r.status, 0);
  d.claim(domain, "registrar", r.registrar, 0);
  d.claim(domain, "rdap_events", r.events, 0);
  d.claim(domain, "delegation_signed", r.delegationSigned, 0);
  for (const nameserver of r.nameservers ?? []) {
    if (nameserver.ldhName === null) continue;
    const ns = d.entity("DOMAIN", normaliseDomain(nameserver.ldhName), nameserver.ldhName);
    d.relate(domain, ns, "uses_nameserver", 0);
  }
  d.claim(domain, "rdap_responding_host", r.derived.respondingHost, 0, true);
  return d.build();
};

const wayback: Extractor = ({ target, result }) => {
  const r = WAYBACK_RESULT.parse(result);
  const d = new Drafts();
  const subject = targetEntity(d, target);
  for (const capture of r.captures) {
    d.claim(subject, "archived_capture", reported(capture), 0);
    d.claim(subject, "archived_capture_time", capture.derived.capturedAt, 0, true);
  }
  d.claim(subject, "archive_coverage", r.derived.coverage, 0, true);
  return d.build();
};

const contactPhone: Extractor = ({ target, result }) => {
  const r = CONTACT_PHONE_RESULT.parse(result);
  const d = new Drafts();
  const phone = targetEntity(d, target);
  // A local analysis: every value is derived, and the evidence is DERIVED too.
  for (const [attribute, value] of Object.entries(r)) {
    d.claim(phone, attributeName("phone", attribute), value, 0, true);
  }
  return d.build();
};

const wikidata: Extractor = ({ target, result }) => {
  const r = WIKIDATA_RESULT.parse(result);
  const d = new Drafts();
  const searched = targetEntity(d, target);
  for (const candidate of r.candidates) {
    // A candidate is the Wikidata item, identified by its QID; the match to
    // the searched name is a relationship, never an identity.
    const item = d.entity(
      "ORGANIZATION",
      externalIdentifier("wikidata", candidate.wikidataItemId),
      candidate.label ?? candidate.wikidataItemId,
    );
    d.relate(searched, item, "wikidata_search_candidate", 0);
    d.claim(item, "wikidata_item_id", candidate.wikidataItemId, 1);
    d.claim(item, "wikidata_matched_by", candidate.matchedBy, 0);
    d.claim(item, "wikidata_matched_text", candidate.matchedText, 0);
    d.claim(item, "label", candidate.label, 1);
    d.claim(item, "description", candidate.description, 1);
    d.claim(item, "wikidata_item_last_edited_at", candidate.itemLastEditedAt, 1);
    d.claim(item, "wikidata_claims", candidate.claims, 1);
  }
  return d.build();
};

const github: Extractor = ({ target, result }) => {
  const r = GITHUB_RESULT.parse(result);
  const d = new Drafts();
  const username = targetEntity(d, target);
  const { login, ...profile } = r.account;
  const account = d.entity(
    "SOCIAL_ACCOUNT",
    socialAccountIdentifier("github", login),
    `GitHub: ${login}`,
  );
  d.relate(username, account, "account_with_handle", 0);
  for (const [attribute, value] of Object.entries(profile)) {
    d.claim(account, attributeName("github", attribute), value, 0);
  }
  d.claim(account, "github_repositories", r.repositories.items, 1);
  d.claim(account, "github_repositories_partial", r.derived.repositories.partial, 1, true);
  d.claim(
    account,
    "github_commit_search",
    { totalCount: r.commits.totalCount, incompleteResults: r.commits.incompleteResults },
    2,
  );
  d.claim(account, "github_recent_commits", r.commits.items, 2);
  return d.build();
};

const hackernews: Extractor = ({ target, result }) => {
  const r = HACKERNEWS_RESULT.parse(result);
  const d = new Drafts();
  const username = targetEntity(d, target);
  const account = d.entity(
    "SOCIAL_ACCOUNT",
    socialAccountIdentifier("hackernews", r.account.handle),
    `Hacker News: ${r.account.handle}`,
  );
  d.relate(username, account, "account_with_handle", 0);
  d.claim(account, "hackernews_created_unix_seconds", r.account.created, 0);
  d.claim(account, "hackernews_karma", r.account.karma, 0);
  d.claim(account, "hackernews_about", r.account.about, 0);
  d.claim(account, "hackernews_created_at", r.derived.accountCreatedAt, 0, true);
  d.claim(account, "hackernews_submitted_item_count", r.derived.submittedItemCount, 0, true);
  d.claim(account, "hackernews_indexed_item_count", r.recentItems.indexedItemCount, 1);
  d.claim(
    account,
    "hackernews_recent_items",
    r.recentItems.items.map((item) => reported(item)),
    1,
  );
  return d.build();
};

const devto: Extractor = ({ target, result }) => {
  const r = DEVTO_RESULT.parse(result);
  const d = new Drafts();
  const username = targetEntity(d, target);
  const { username: handle, ...profile } = r.account;
  const account = d.entity(
    "SOCIAL_ACCOUNT",
    socialAccountIdentifier("devto", handle),
    `DEV: ${handle}`,
  );
  d.relate(username, account, "account_with_handle", 0);
  // The Twitter and GitHub handles are claims as the user entered them, not
  // accounts: DEV does not verify them, and neither does fusion.
  for (const [attribute, value] of Object.entries(profile)) {
    d.claim(account, attributeName("devto", attribute), value, 0);
  }
  return d.build();
};

const commoncrawl: Extractor = ({ target, result }) => {
  const r = COMMONCRAWL_RESULT.parse(result);
  const d = new Drafts();
  const domain = targetEntity(d, target);
  d.claim(domain, "commoncrawl_index", r.index, 0);
  for (const capture of r.captures) {
    d.claim(domain, "crawled_capture", reported(capture), 1);
    d.claim(domain, "crawled_capture_time", capture.derived.capturedAt, 1, true);
  }
  d.claim(domain, "commoncrawl_limit_reached", r.derived.limitReached, 1, true);
  d.claim(domain, "commoncrawl_note", r.derived.note, 1, true);
  return d.build();
};

/**
 * One extractor per platform collector. A collector without one cannot be
 * fused, and fusion refuses to mark its job fused (test/fusion.test.ts checks
 * every registered collector has one).
 */
export const EXTRACTORS: Readonly<Record<string, Extractor>> = {
  crtsh,
  dns,
  rdap,
  wayback,
  "contact.phone": contactPhone,
  wikidata,
  github,
  hackernews,
  devto,
  commoncrawl,
};
