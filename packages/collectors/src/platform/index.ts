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
import { rdapCollector } from "./rdap.ts";
import { waybackCollector } from "./wayback.ts";
import { wikidataCollector } from "./wikidata.ts";

/**
 * Every collector the platform ships, in listing order.
 *
 * Not registered: news (src/platform/news.ts). Its NOT_FOUND rests on GDELT's
 * `{}` meaning "no coverage", and a quoted-domain query answered `{}` live for
 * a domain that plausibly has coverage, so it may be systematically false.
 * It is held until one live FOUND for a domain phrase is recorded
 * (docs/PLAN.md, Phase 3B).
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
];

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
