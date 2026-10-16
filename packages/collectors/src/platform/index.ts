import { PLATFORM_SOURCES } from "../catalogue.ts";
import type { Collector } from "../contract.ts";
import { CollectorRegistry } from "../registry.ts";
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

/** The platform registry: the source catalogue and every platform collector. */
export function createPlatformRegistry(): CollectorRegistry {
  return new CollectorRegistry({ sources: PLATFORM_SOURCES, collectors: PLATFORM_COLLECTORS });
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
