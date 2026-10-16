import { PLATFORM_SOURCES } from "../catalogue.ts";
import type { Collector } from "../contract.ts";
import { CollectorDefinitionError } from "../errors.ts";
import { CollectorRegistry } from "../registry.ts";
import type { SourceDeclaration } from "../source.ts";
import { commoncrawlCollector } from "./commoncrawl.ts";
import { contactPhoneCollector } from "./contact-phone.ts";
import { crtshCollector } from "./crtsh.ts";
import { devtoCollector } from "./devto.ts";
import { dnsCollector } from "./dns.ts";
import { githubCollector } from "./github.ts";
import { hackernewsCollector } from "./hackernews.ts";
import { newsCollector } from "./news.ts";
import { rdapCollector } from "./rdap.ts";
import { waybackCollector } from "./wayback.ts";
import { wikidataCollector } from "./wikidata.ts";

/**
 * Every collector the platform ships, in listing order.
 *
 * news (src/platform/news.ts) was held from Phase 3B until Track M Day 2: its
 * NOT_FOUND rested on GDELT's `{}` meaning "no coverage", which a live `{}`
 * for a domain that plausibly has coverage put in doubt. It is registered now
 * that it never reports NOT_FOUND (an empty answer is EMPTY_UNCONFIRMED, after
 * a canary) and a live FOUND is recorded (test/fixtures/news/found.json,
 * 2026-10-15; docs/PLAN.md, Track M Day 2).
 */
export const PLATFORM_COLLECTORS: readonly Collector[] = [
  crtshCollector,
  dnsCollector,
  rdapCollector,
  waybackCollector,
  contactPhoneCollector,
  wikidataCollector,
  githubCollector,
  hackernewsCollector,
  devtoCollector,
  commoncrawlCollector,
  newsCollector,
];

/** A collector built but held off the platform: it never runs, and reports say why. */
export interface HeldCollector {
  readonly collector: Collector;
  readonly reason: string;
}

/** None is held now; a collector built but not yet fit to run is listed here with why. */
export const HELD_PLATFORM_COLLECTORS: readonly HeldCollector[] = [];

/**
 * An operator's own collector, attached to the platform: the interface the
 * operator access method runs through (owner instruction, 2026-10-16). The
 * product ships none and contains no credentialed collection code; this is
 * only where one is attached.
 *
 * The source is the operator's own: access exactly ["operator"], an id and a
 * collector id starting "operator.", hosts no platform source or other
 * attachment declares, never Instagram, Facebook or X, a licence verdict like
 * any other (only PERMITTED runs) and credentials from the tenant's vault.
 * The collector is declared in the person discipline, so it needs the person
 * module and approved vetting to run, and to read what it collected.
 *
 * Trust: an attachment is code compiled into the deployment and run in the
 * worker's process, with what that process can reach. It needs the same
 * review as platform code. The rules above are backstops, not a sandbox; the
 * fetcher's host and address checks bind only requests made through
 * ctx.fetch. It runs only where COLLECTORS_ACCESS_METHODS names operator, and
 * the API and every worker must attach the same set.
 */
export interface OperatorAttachment {
  readonly source: SourceDeclaration;
  readonly collector: Collector;
}

function refuseAttachment(subject: string, problem: string): never {
  throw new CollectorDefinitionError(subject, problem);
}

/**
 * The platform registry: the source catalogue and every platform collector,
 * and any operator attachments (none, in the product's own composition).
 */
export function createPlatformRegistry(
  options: { readonly operatorAttachments?: readonly OperatorAttachment[] } = {},
): CollectorRegistry {
  // The product reaches nothing through the operator method itself.
  for (const source of PLATFORM_SOURCES) {
    if (source.access.includes("operator")) {
      refuseAttachment(`source "${source.id}"`, "a platform source never uses the operator method");
    }
  }
  const attachments = options.operatorAttachments ?? [];
  const taken = new Set(PLATFORM_SOURCES.flatMap((source) => source.network?.hosts ?? []));
  for (const { source, collector } of attachments) {
    const subject = `operator attachment "${source.id}"`;
    if (source.access.length !== 1 || source.access[0] !== "operator") {
      refuseAttachment(
        subject,
        'its source is reached through the operator method alone: ["operator"]',
      );
    }
    if (collector.declaration.source !== source.id) {
      refuseAttachment(subject, "its collector reads the attachment's own source");
    }
    // A host another source declares would escape that source's verdict and
    // its shared rate limit.
    for (const host of source.network?.hosts ?? []) {
      if (taken.has(host)) refuseAttachment(subject, `host "${host}" is another source's`);
      taken.add(host);
    }
  }
  return new CollectorRegistry({
    sources: [...PLATFORM_SOURCES, ...attachments.map((attachment) => attachment.source)],
    collectors: [...PLATFORM_COLLECTORS, ...attachments.map((attachment) => attachment.collector)],
  });
}

// The result schemas, for code that reads what a collector recorded (fusion).
export { COMMONCRAWL_RESULT } from "./commoncrawl.ts";
export { CONTACT_PHONE_RESULT } from "./contact-phone.ts";
export { CRTSH_RESULT } from "./crtsh.ts";
export { DEVTO_RESULT } from "./devto.ts";
export { DNS_RESULT } from "./dns.ts";
export { GITHUB_RESULT } from "./github.ts";
export { HACKERNEWS_RESULT } from "./hackernews.ts";
export { NEWS_RESULT } from "./news.ts";
export { RDAP_RESULT } from "./rdap.ts";
export { WAYBACK_RESULT } from "./wayback.ts";
export { WIKIDATA_RESULT } from "./wikidata.ts";
