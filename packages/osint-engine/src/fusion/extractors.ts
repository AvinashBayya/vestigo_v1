/**
 * What each collector's recorded result says, as entities, relationships and
 * claims, each claim citing the one evidence item it rests on.
 *
 * A claim's strength is decided mechanically, never by the extractor (Phase 5,
 * on the Phase 3B `derived` contract). An extractor names WHERE in the result
 * a claim's value is, as a path, and never supplies the value itself.
 * `resolveClaims` reads the value there and sets the strength:
 *   - a path through a `derived` block is the collector's computation: DERIVED;
 *   - any other path is the source's value, with the evidence's own strength,
 *     and any `derived` block nested inside that value is stripped from it.
 * So a value inside `derived` can never be stored as OBSERVED or REPORTED, and
 * a reported value can never carry a computed field along with it.
 *
 * The other rules every extractor follows:
 *   - A null value is absence and makes no claim: nothing is asserted about
 *     what was not stated.
 *   - An entity is identified only by an identifier the result states (a
 *     domain, an address, an account); people and organisations only by an
 *     external registry's id, never by a name (./identifiers.ts).
 *   - Evidence is referred to by its index in the job's evidence list, which
 *     is the order the collector cited its responses in.
 */
import {
  BLUESKY_SEARCH_RESULT,
  COMMONCRAWL_RESULT,
  CONTACT_PHONE_RESULT,
  CRTSH_RESULT,
  DERIVED_KEY,
  DEVTO_RESULT,
  DNS_RESULT,
  GITHUB_RESULT,
  HACKERNEWS_RESULT,
  NEWS_RESULT,
  RDAP_RESULT,
  REDDIT_SEARCH_RESULT,
  reportedPart,
  RSS_COLLECTORS,
  RSS_RESULT,
  WAYBACK_RESULT,
  WIKIDATA_RESULT,
} from "@repo/collectors";
import {
  AppError,
  NotImplementedError,
  type ClaimStrength,
  type EntityKind,
  type TargetType,
} from "@repo/core";
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

/** Keys and array indices from the result's root to a value. */
export type ResultPath = readonly (string | number)[];

export interface ClaimDraft {
  /** An entity key, or a relationship key. */
  readonly subject: { readonly entity: string } | { readonly relationship: string };
  readonly attribute: string;
  /**
   * Where the claim's value is in the result. For a relationship claim, the
   * value that established the relationship: it decides the strength, and the
   * claim itself stores no value.
   */
  readonly path: ResultPath;
  /** Index into the job's evidence list. */
  readonly evidence: number;
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

/** An extractor pointed at a place the result does not have. A bug, never data. */
export class ClaimPathError extends AppError {
  readonly code = "CLAIM_PATH_INVALID";

  constructor(path: ResultPath) {
    super(`An extractor named a claim path the result does not have: ${path.join(".")}.`);
    this.name = "ClaimPathError";
  }
}

/** A claim with its value read and its strength decided. */
export interface ResolvedClaim {
  readonly subject: ClaimDraft["subject"];
  readonly attribute: string;
  readonly value: unknown;
  readonly strength: ClaimStrength;
  readonly evidence: number;
}

/** True when the path passes through a `derived` block: the value is computed. */
export function isDerivedPath(path: ResultPath): boolean {
  return path.some((segment) => segment === DERIVED_KEY);
}

function valueAt(result: unknown, path: ResultPath): unknown {
  let node: unknown = result;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(node) || segment < 0 || segment >= node.length) {
        throw new ClaimPathError(path);
      }
      node = node[segment] as unknown;
    } else {
      if (typeof node !== "object" || node === null || Array.isArray(node) || !(segment in node)) {
        throw new ClaimPathError(path);
      }
      node = (node as Record<string, unknown>)[segment];
    }
  }
  return node;
}

/**
 * Reads each claim's value from the result and decides its strength. A claim
 * whose value is null is absence and is dropped. A relationship claim stores
 * no value; its path only decides its strength.
 */
export function resolveClaims(
  claims: readonly ClaimDraft[],
  result: unknown,
  evidenceStrength: ClaimStrength,
): ResolvedClaim[] {
  const resolved: ResolvedClaim[] = [];
  for (const claim of claims) {
    const raw = valueAt(result, claim.path);
    if (raw === null || raw === undefined) continue;
    const derived = isDerivedPath(claim.path);
    resolved.push({
      subject: claim.subject,
      attribute: claim.attribute,
      value: "relationship" in claim.subject ? null : derived ? raw : reportedPart(raw),
      strength: derived ? "DERIVED" : evidenceStrength,
      evidence: claim.evidence,
    });
  }
  return resolved;
}

/** `platform_attribute` in snake case, e.g. ("github", "publicRepositories") → github_public_repositories. */
function attributeName(prefix: string, field: string): string {
  const snake = field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return snake.startsWith(`${prefix}_`) ? snake : `${prefix}_${snake}`;
}

/** Collects drafts, keeping one entity and one relationship per key. */
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

  /** A claim about an entity: its value is whatever the result holds at `path`. */
  claim(entity: string, attribute: string, path: ResultPath, evidence: number): void {
    this.#claims.push({ subject: { entity }, attribute, path, evidence });
  }

  /** A relationship, and the claim citing the evidence and the value that assert it. */
  relate(from: string, to: string, kind: string, evidence: number, basis: ResultPath): void {
    if (from === to) return;
    const key = `${from}>${kind}>${to}`;
    if (!this.#relationships.has(key)) this.#relationships.set(key, { key, from, to, kind });
    this.#claims.push({ subject: { relationship: key }, attribute: kind, path: basis, evidence });
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
    case "TOPIC":
      // The news extractor, the one reader of a TOPIC, never asks for it (D-M2 adds the kinds).
      throw new NotImplementedError("fusion.topic-target", "a TOPIC has no entity kind yet");
  }
}

const crtsh: Extractor = ({ target, result }) => {
  const r = CRTSH_RESULT.parse(result);
  const d = new Drafts();
  const domain = targetEntity(d, target);
  r.certificates.forEach((_certificate, i) => {
    d.claim(domain, "certificate", ["certificates", i], 0);
  });
  r.derived.hostnames.forEach((host, i) => {
    const at = ["derived", "hostnames", i] as const;
    if (host.wildcard) {
      d.claim(domain, "wildcard_certificate_name", at, 0);
      return;
    }
    const name = d.entity("DOMAIN", normaliseDomain(host.name), host.name);
    d.relate(name, domain, "subdomain_of", 0, at);
    d.claim(name, "certificate_ids", [...at, "certificateIds"], 0);
    d.claim(name, "earliest_not_before", [...at, "earliestNotBefore"], 0);
    d.claim(name, "latest_not_after", [...at, "latestNotAfter"], 0);
    d.claim(name, "certificate_issuers", [...at, "issuerOrganisations"], 0);
  });
  return d.build();
};

const dns: Extractor = ({ target, result }) => {
  const r = DNS_RESULT.parse(result);
  const d = new Drafts();
  const domain = targetEntity(d, target);
  r.answer.forEach((record, i) => {
    if (record.type === 1) {
      const ip = d.entity("IP_ADDRESS", record.data.toLowerCase(), record.data);
      d.relate(domain, ip, "resolves_to", 0, ["answer", i]);
      d.claim(ip, "a_record", ["answer", i], 0);
    } else {
      d.claim(domain, "dns_record", ["answer", i], 0);
    }
  });
  d.claim(domain, "dnssec_authenticated", ["authenticatedData"], 0);
  d.claim(domain, "dns_answer_truncated", ["truncated"], 0);
  return d.build();
};

const rdap: Extractor = ({ target, result }) => {
  const r = RDAP_RESULT.parse(result);
  const d = new Drafts();
  const domain = targetEntity(d, target);
  d.claim(domain, "rdap_ldh_name", ["ldhName"], 0);
  d.claim(domain, "rdap_unicode_name", ["unicodeName"], 0);
  d.claim(domain, "rdap_handle", ["handle"], 0);
  d.claim(domain, "rdap_status", ["status"], 0);
  d.claim(domain, "registrar", ["registrar"], 0);
  d.claim(domain, "rdap_events", ["events"], 0);
  d.claim(domain, "delegation_signed", ["delegationSigned"], 0);
  (r.nameservers ?? []).forEach((nameserver, i) => {
    if (nameserver.ldhName === null) return;
    const ns = d.entity("DOMAIN", normaliseDomain(nameserver.ldhName), nameserver.ldhName);
    d.relate(domain, ns, "uses_nameserver", 0, ["nameservers", i, "ldhName"]);
  });
  d.claim(domain, "rdap_responding_host", ["derived", "respondingHost"], 0);
  return d.build();
};

const wayback: Extractor = ({ target, result }) => {
  const r = WAYBACK_RESULT.parse(result);
  const d = new Drafts();
  const subject = targetEntity(d, target);
  r.captures.forEach((_capture, i) => {
    d.claim(subject, "archived_capture", ["captures", i], 0);
    d.claim(subject, "archived_capture_time", ["captures", i, "derived", "capturedAt"], 0);
  });
  d.claim(subject, "archive_coverage", ["derived", "coverage"], 0);
  return d.build();
};

const contactPhone: Extractor = ({ target, result }) => {
  const r = CONTACT_PHONE_RESULT.parse(result);
  const d = new Drafts();
  const phone = targetEntity(d, target);
  // A local analysis: the evidence itself is DERIVED, so every claim is too.
  for (const attribute of Object.keys(r)) {
    d.claim(phone, attributeName("phone", attribute), [attribute], 0);
  }
  return d.build();
};

const wikidata: Extractor = ({ target, result }) => {
  const r = WIKIDATA_RESULT.parse(result);
  const d = new Drafts();
  const searched = targetEntity(d, target);
  r.candidates.forEach((candidate, i) => {
    const at = ["candidates", i] as const;
    // A candidate is the Wikidata item, identified by its QID; the match to
    // the searched name is a relationship, never an identity.
    const item = d.entity(
      "ORGANIZATION",
      externalIdentifier("wikidata", candidate.wikidataItemId),
      candidate.label ?? candidate.wikidataItemId,
    );
    d.relate(searched, item, "wikidata_search_candidate", 0, [...at, "wikidataItemId"]);
    d.claim(item, "wikidata_item_id", [...at, "wikidataItemId"], 1);
    d.claim(item, "wikidata_matched_by", [...at, "matchedBy"], 0);
    d.claim(item, "wikidata_matched_text", [...at, "matchedText"], 0);
    d.claim(item, "label", [...at, "label"], 1);
    d.claim(item, "description", [...at, "description"], 1);
    d.claim(item, "wikidata_item_last_edited_at", [...at, "itemLastEditedAt"], 1);
    d.claim(item, "wikidata_claims", [...at, "claims"], 1);
  });
  return d.build();
};

const github: Extractor = ({ target, result }) => {
  const r = GITHUB_RESULT.parse(result);
  const d = new Drafts();
  const username = targetEntity(d, target);
  const account = d.entity(
    "SOCIAL_ACCOUNT",
    socialAccountIdentifier("github", r.account.login),
    `GitHub: ${r.account.login}`,
  );
  d.relate(username, account, "account_with_handle", 0, ["account", "login"]);
  for (const attribute of Object.keys(r.account)) {
    if (attribute === "login") continue;
    d.claim(account, attributeName("github", attribute), ["account", attribute], 0);
  }
  d.claim(account, "github_repositories", ["repositories", "items"], 1);
  d.claim(account, "github_repositories_partial", ["derived", "repositories", "partial"], 1);
  d.claim(account, "github_commit_search_total_count", ["commits", "totalCount"], 2);
  d.claim(account, "github_commit_search_incomplete", ["commits", "incompleteResults"], 2);
  d.claim(account, "github_recent_commits", ["commits", "items"], 2);
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
  d.relate(username, account, "account_with_handle", 0, ["account", "handle"]);
  d.claim(account, "hackernews_created_unix_seconds", ["account", "created"], 0);
  d.claim(account, "hackernews_karma", ["account", "karma"], 0);
  d.claim(account, "hackernews_about", ["account", "about"], 0);
  d.claim(account, "hackernews_created_at", ["derived", "accountCreatedAt"], 0);
  d.claim(account, "hackernews_submitted_item_count", ["derived", "submittedItemCount"], 0);
  d.claim(account, "hackernews_indexed_item_count", ["recentItems", "indexedItemCount"], 1);
  d.claim(account, "hackernews_recent_items", ["recentItems", "items"], 1);
  return d.build();
};

const devto: Extractor = ({ target, result }) => {
  const r = DEVTO_RESULT.parse(result);
  const d = new Drafts();
  const username = targetEntity(d, target);
  const account = d.entity(
    "SOCIAL_ACCOUNT",
    socialAccountIdentifier("devto", r.account.username),
    `DEV: ${r.account.username}`,
  );
  d.relate(username, account, "account_with_handle", 0, ["account", "username"]);
  // The Twitter and GitHub handles are claims as the user entered them, not
  // accounts: DEV does not verify them, and neither does fusion.
  for (const attribute of Object.keys(r.account)) {
    if (attribute === "username") continue;
    d.claim(account, attributeName("devto", attribute), ["account", attribute], 0);
  }
  return d.build();
};

const commoncrawl: Extractor = ({ target, result }) => {
  const r = COMMONCRAWL_RESULT.parse(result);
  const d = new Drafts();
  const domain = targetEntity(d, target);
  d.claim(domain, "commoncrawl_index", ["index"], 0);
  r.captures.forEach((_capture, i) => {
    d.claim(domain, "crawled_capture", ["captures", i], 1);
    d.claim(domain, "crawled_capture_time", ["captures", i, "derived", "capturedAt"], 1);
  });
  d.claim(domain, "commoncrawl_limit_reached", ["derived", "limitReached"], 1);
  d.claim(domain, "commoncrawl_note", ["derived", "note"], 1);
  return d.build();
};

/**
 * news (GDELT DOC): each article becomes a URL entity and its outlet a DOMAIN
 * entity, the article `published_by` that outlet. The article's own fields are
 * REPORTED claims on its URL entity; the seen-time GDELT gives, parsed to ISO,
 * is DERIVED (the collector's computation, named `seen_by_gdelt_at`, never
 * `published_at`: GDELT's seendate is when GDELT saw the article, not when it
 * was published — news.ts).
 *
 * What is deliberately NOT drawn, so nothing is fabricated or mislabelled:
 *   - No entity from a title or a country. A headline can name a person, and a
 *     person or organisation is never resolved by a name (./identifiers.ts);
 *     GDELT's `outletCountry` is where the OUTLET is, never an event location
 *     (news.ts), so it stays a claim, never a LOCATION entity.
 *   - No edge between two entities merely because they share an article: the
 *     only edge is the one the article states, its publishing outlet.
 *   - No count: an article list is not a measure of coverage (news.ts), so no
 *     claim counts the articles, and none can be read as a rise.
 *
 * A TOPIC has no entity kind, so the topic itself is not an entity and the
 * extractor never asks for the target's; a DOMAIN run's searched domain appears
 * only where GDELT reports it as an outlet. One evidence row backs every claim:
 * GDELT's single search response (index 0).
 */
const news: Extractor = ({ result }) => {
  const r = NEWS_RESULT.parse(result);
  const d = new Drafts();
  r.articles.forEach((article, i) => {
    const at: ResultPath = ["articles", i];
    const url = d.entity("URL", normaliseUrl(article.url), article.url);
    d.claim(url, "news_title", [...at, "title"], 0);
    d.claim(url, "news_language", [...at, "language"], 0);
    d.claim(url, "news_outlet_country", [...at, "outletCountry"], 0);
    d.claim(url, "news_seendate", [...at, "seendate"], 0);
    d.claim(url, "news_seen_by_gdelt_at", [...at, "derived", "seenByGdeltAt"], 0);
    d.claim(url, "news_mobile_url", [...at, "mobileUrl"], 0);
    d.claim(url, "news_social_image_url", [...at, "socialImageUrl"], 0);
    if (article.outletDomain !== null) {
      const outlet = d.entity(
        "DOMAIN",
        normaliseDomain(article.outletDomain),
        article.outletDomain,
      );
      d.relate(url, outlet, "published_by", 0, [...at, "outletDomain"]);
    }
  });
  return d.build();
};

/**
 * The monitoring collectors (2026-10-17: Bluesky and Reddit search, and one
 * RSS collector per publisher): each result is checked, and nothing is drawn
 * from it yet, as from news. Their items become items, with their authors,
 * outlets and links as entities, in Track M's item extractors
 * (docs/monitoring/MONITORING-PLAN.md §7); until then no claim is made from an
 * item list, and in particular no count. Every RSS collector shares one.
 */
const checkedOnly =
  (schema: { parse(value: unknown): unknown }): Extractor =>
  ({ result }) => {
    schema.parse(result);
    return new Drafts().build();
  };
const rss = checkedOnly(RSS_RESULT);

/**
 * One extractor per platform collector. A collector without one cannot be
 * fused, and fusion refuses to mark its job fused (a test checks every
 * registered collector has one).
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
  news,
  "bluesky.search": checkedOnly(BLUESKY_SEARCH_RESULT),
  "reddit.search": checkedOnly(REDDIT_SEARCH_RESULT),
  ...Object.fromEntries(RSS_COLLECTORS.map((collector) => [collector.declaration.id, rss])),
};
