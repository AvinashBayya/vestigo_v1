import type { DeclaredAccess } from "./access.ts";
import { RDAP_REGISTRY_HOSTS } from "./data/rdap-registry-hosts.ts";
import { RSS_PUBLISHERS, type RssPublisher } from "./data/rss-feeds.ts";
import type {
  LicenceCheck,
  SourceDeclaration,
  SourceNetwork,
  SourceOperator,
  SourceRateLimit,
} from "./source.ts";

/**
 * The platform's source catalogue: every upstream the product may use, or has
 * decided not to, with its commercial-use verdict. Verdicts come from
 * docs/audit/COLLECTORS.md (fetched 2026-09-23) and from the Phase 3A licence
 * decisions recorded in docs/PLAN.md. UNKNOWN in the audit is UNVERIFIED here,
 * never PERMITTED. Changing a verdict is a reviewed code change, never
 * configuration.
 *
 * Where the audit quoted a terms page without recording its address, the URL
 * below was reconstructed from its description; docs/PLAN.md lists those for
 * confirmation.
 */

const AUDITED_ON = "2026-09-23";
const DECIDED_ON = "2026-09-28";
const DECISIONS = "docs/PLAN.md, Phase 3A licence decisions";

function audited(row: number, sourceUrl: string | null): LicenceCheck {
  return {
    checkedOn: AUDITED_ON,
    sourceUrl,
    recordedIn: `docs/audit/COLLECTORS.md row ${String(row)}`,
  };
}

const CHECKED_ON = "2026-09-28";
const CHECKS = "docs/PLAN.md, Phase 3B licence checks";

/** A terms page read in Phase 3B. */
function checked(sourceUrl: string, recordedAlsoIn: string | null = null): LicenceCheck {
  return {
    checkedOn: CHECKED_ON,
    sourceUrl,
    recordedIn: recordedAlsoIn === null ? CHECKS : `${CHECKS}; ${recordedAlsoIn}`,
  };
}

function decided(row: number, sourceUrl: string | null = null): LicenceCheck {
  return {
    checkedOn: DECIDED_ON,
    sourceUrl,
    recordedIn: `${DECISIONS}; docs/audit/COLLECTORS.md row ${String(row)}`,
  };
}

/**
 * How each source is reached (src/access.ts), from what docs/audit/COLLECTORS.md
 * records of it: a key, a token or a paid account, or none. A method says how
 * a source is reached; whether that may be done is its licence verdict, so a
 * BLOCKED source declares its method too and still never runs. No platform
 * source is reached through the operator method: the product ships none.
 */
/** No credential. */
const OPEN = ["open"] as const satisfies DeclaredAccess;
/** The provider's own keyed API: a key, token or client credential the tenant sets. */
const OFFICIAL = ["official"] as const satisfies DeclaredAccess;
/** No credential, or the provider's key for more (a higher quota). */
const OPEN_OR_OFFICIAL = ["open", "official"] as const satisfies DeclaredAccess;
/** A third-party data vendor, through the tenant's own paid account with it. */
const LICENSED = ["licensed"] as const satisfies DeclaredAccess;

/** Our own limit for upstreams whose published limit nobody has checked. */
const SELF_IMPOSED_DEFAULT: SourceRateLimit = {
  requests: 1,
  intervalSeconds: 1,
  basis: "SELF_IMPOSED",
  note: "No published limit has been checked; one request a second until one is.",
};

/** Who runs these hosts, as a reader would name them. */
function operator(name: string, hosts: readonly string[]): SourceOperator {
  return { name, hosts };
}

/** An https source: its hosts are exactly its operators' hosts. */
function https(
  operators: readonly SourceOperator[],
  rateLimit: SourceRateLimit = SELF_IMPOSED_DEFAULT,
): SourceNetwork {
  return {
    protocol: "https",
    hosts: operators.flatMap((entry) => entry.hosts),
    rateLimit,
    operators,
  };
}

/** Each publisher's feeds: our own politeness limit, one request every two seconds. */
const RSS_RATE_LIMIT: SourceRateLimit = {
  requests: 1,
  intervalSeconds: 2,
  basis: "SELF_IMPOSED",
  note: "No published limit has been checked for this publisher's feeds; one request every two seconds until one is.",
};

/**
 * A publisher's RSS feeds (src/data/rss-feeds.ts): reached openly, its terms
 * unchecked, so UNVERIFIED, never run until the owner records them. A
 * publisher's feeds are published for syndication; whether that allows a
 * commercial product to read them is what the owner reads.
 */
function rssSource(publisher: RssPublisher): SourceDeclaration {
  return {
    id: publisher.id,
    name: `${publisher.publisher} RSS feeds`,
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The publisher's terms for its feeds have not been checked.",
      check: null,
    },
    network: https(
      publisher.operators.map((entry) => operator(entry.name, entry.hosts)),
      RSS_RATE_LIMIT,
    ),
    attribution: null,
  };
}

export const PLATFORM_SOURCES: readonly SourceDeclaration[] = [
  // ── BLOCKED: registered and listed, never run ──────────────────────────
  {
    id: "shodan-internetdb",
    name: "Shodan InternetDB",
    access: OPEN,
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Free for non-commercial use only; using it to make money needs a Shodan enterprise licence.",
      check: audited(6, "https://internetdb.shodan.io/"),
    },
    network: https([operator("Shodan", ["internetdb.shodan.io"])]),
    attribution: null,
  },
  {
    id: "c2intelfeeds",
    name: "C2IntelFeeds",
    access: OPEN,
    licence: {
      commercialUse: "BLOCKED",
      reason: "Licensed CC BY-NC-SA 4.0: non-commercial use only.",
      check: audited(37, "https://github.com/drb-ra/C2IntelFeeds"),
    },
    network: https([operator("C2IntelFeeds", ["raw.githubusercontent.com"])]),
    attribution: null,
  },
  {
    id: "insightface-buffalo-l",
    name: "InsightFace buffalo_l model pack",
    access: OPEN,
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "The pretrained models are for non-commercial research only; buffalo_l needs a licence from InsightFace.",
      check: audited(59, "https://github.com/deepinsight/insightface"),
    },
    network: null,
    attribution: null,
  },
  {
    id: "youtube-innertube",
    name: "YouTube InnerTube",
    access: OPEN,
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "YouTube's terms forbid automated access, downloading and circumventing the service; InnerTube also impersonates YouTube's own client apps.",
      check: audited(47, "https://www.youtube.com/t/terms"),
    },
    network: https([operator("YouTube", ["www.youtube.com"])]),
    attribution: null,
  },
  {
    id: "youtube-ytdlp",
    name: "YouTube via yt-dlp",
    access: OPEN,
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Downloads YouTube videos to disk with spoofed clients, which YouTube's terms forbid.",
      check: audited(49, "https://www.youtube.com/t/terms"),
    },
    network: null,
    attribution: null,
  },
  {
    id: "duckduckgo-html",
    name: "DuckDuckGo HTML results scrape",
    access: OPEN,
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Scrapes a search results page with a spoofed browser user agent; the terms defer automated access to a policy that was not fetched.",
      check: decided(51, "https://duckduckgo.com/terms"),
    },
    network: https([operator("DuckDuckGo", ["html.duckduckgo.com"])]),
    attribution: null,
  },
  {
    id: "local-network-scan",
    name: "Local network and Wi-Fi scanner",
    access: OPEN,
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Active and unauthenticated: it executes PowerShell and scans the server's own network, which on a hosted product is the hosting provider's.",
      check: decided(52),
    },
    network: null,
    attribution: null,
  },
  {
    id: "google-news-rss",
    name: "Google News RSS",
    access: OPEN,
    licence: {
      commercialUse: "BLOCKED",
      reason: "An undocumented Google feed with no confirmed terms; blocked rather than relied on.",
      check: decided(22),
    },
    network: https([operator("Google News", ["news.google.com"])]),
    attribution: null,
  },
  {
    id: "hackertarget",
    name: "HackerTarget",
    access: OPEN,
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Its terms page returned 404 to the audit, so commercial use is unconfirmed; blocked until checked.",
      check: decided(1),
    },
    network: https([operator("HackerTarget", ["api.hackertarget.com"])]),
    attribution: null,
  },
  {
    id: "alienvault-otx",
    name: "AlienVault OTX",
    access: OPEN,
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Its terms were not checked, so commercial use is unconfirmed; blocked until checked.",
      check: decided(1),
    },
    network: https([operator("AlienVault OTX", ["otx.alienvault.com"])]),
    attribution: null,
  },
  {
    id: "ucdp",
    name: "UCDP GED API",
    access: OFFICIAL,
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Tokens are issued, free of charge, for a described research project; a commercial product is not that, and commercial use is not addressed.",
      check: decided(26),
    },
    network: https([operator("UCDP", ["ucdpapi.pcr.uu.se"])], {
      requests: 5000,
      intervalSeconds: 86_400,
      basis: "UPSTREAM_STATED",
      note: "5,000 requests a day per the API documentation (docs/audit/COLLECTORS.md row 26).",
    }),
    attribution: null,
  },
  {
    id: "reliefweb",
    name: "ReliefWeb API",
    // A pre-approved appname is mandatory (docs/audit/COLLECTORS.md row 27).
    access: OFFICIAL,
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "The appname registration is described as free for non-commercial use, and its content may be copyrighted by the original sources.",
      check: decided(27),
    },
    network: https([operator("ReliefWeb", ["api.reliefweb.int"])], {
      requests: 1000,
      intervalSeconds: 86_400,
      basis: "UPSTREAM_STATED",
      note: "1,000 calls a day per the API documentation (docs/audit/COLLECTORS.md row 27).",
    }),
    attribution: null,
  },
  {
    id: "opensky",
    name: "OpenSky Network",
    access: OPEN,
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Permits non-profit research, education, internal commercial evaluation and government use; a paid product needs a separate agreement.",
      check: {
        checkedOn: DECIDED_ON,
        sourceUrl: null,
        recordedIn: "ARCHITECTURE-DECISIONS.md §11; docs/audit/COLLECTORS.md row 28",
      },
    },
    network: https([operator("OpenSky", ["opensky-network.org"])]),
    attribution: null,
  },

  // ── PERMITTED: terms read and recorded ─────────────────────────────────
  {
    id: "wikidata",
    name: "Wikidata",
    access: OPEN,
    licence: {
      commercialUse: "PERMITTED",
      reason:
        "Structured data (the main, Property, Lexeme and EntitySchema namespaces) is released into the public domain under CC0. Text in other namespaces is CC BY-SA 4.0 and is not used.",
      check: checked(
        "https://www.wikidata.org/wiki/Wikidata:Licensing",
        "docs/audit/COLLECTORS.md row 38",
      ),
    },
    network: https([operator("Wikidata", ["www.wikidata.org"])]),
    attribution: null,
  },
  {
    id: "libphonenumber-js",
    name: "libphonenumber-js phone metadata",
    access: OPEN,
    licence: {
      commercialUse: "PERMITTED",
      reason:
        "MIT for the library, and Apache-2.0 for the phone metadata it carries from Google's libphonenumber; both permit commercial use. It runs locally and sends nothing anywhere.",
      check: checked(
        "https://gitlab.com/catamphetamine/libphonenumber-js",
        "LICENSE and LICENSE.Apache in the installed package, libphonenumber-js 1.13.14",
      ),
    },
    network: null,
    attribution: null,
  },
  {
    id: "gdelt-doc",
    name: "GDELT DOC 2.0 API",
    // The first source on access methods (2026-10-16): open, no key, PERMITTED,
    // so it runs wherever open is enabled, as it did before.
    access: OPEN,
    licence: {
      commercialUse: "PERMITTED",
      reason:
        "Available for unlimited and unrestricted academic, commercial or governmental use without fee; any use or redistribution must cite the GDELT Project and link to it.",
      check: checked("https://www.gdeltproject.org/about.html", "docs/audit/COLLECTORS.md row 4"),
    },
    network: https([operator("GDELT", ["api.gdeltproject.org"])], {
      requests: 1,
      intervalSeconds: 5,
      basis: "UPSTREAM_STATED",
      note: "One request every five seconds; GDELT answers 429 above it (docs/audit/COLLECTORS.md row 4).",
    }),
    attribution: { text: "Source: The GDELT Project", url: "https://www.gdeltproject.org/" },
  },
  {
    id: "gdelt-events",
    name: "GDELT Events 2.0 exports",
    access: OPEN,
    licence: {
      commercialUse: "PERMITTED",
      reason:
        "The same GDELT terms as the DOC API; any use or redistribution must cite the GDELT Project and link to it.",
      check: checked("https://www.gdeltproject.org/about.html", "docs/audit/COLLECTORS.md row 24"),
    },
    network: https([operator("GDELT", ["data.gdeltproject.org"])], {
      requests: 1,
      intervalSeconds: 5,
      basis: "SELF_IMPOSED",
      note: "Held to the DOC API's spacing; the export files update every fifteen minutes.",
    }),
    attribution: { text: "Source: The GDELT Project", url: "https://www.gdeltproject.org/" },
  },
  {
    id: "safecast",
    name: "Safecast radiation data",
    access: OPEN,
    licence: {
      commercialUse: "PERMITTED",
      reason: "CC0: free and open for anyone to use under any circumstance.",
      check: audited(31, "https://safecast.org/about/data"),
    },
    network: https([operator("Safecast", ["api.safecast.org"])]),
    attribution: null,
  },

  // ── UNVERIFIED: never run until their terms are checked and recorded ──
  {
    id: "devto",
    name: "DEV Community API",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The DEV (Forem) API terms have not been checked.",
      check: null,
    },
    network: https([operator("DEV", ["dev.to"])]),
    attribution: null,
  },
  {
    id: "commoncrawl",
    name: "Common Crawl URL index",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "Common Crawl describes its data as freely available for reuse, but its terms of use have not been checked.",
      check: null,
    },
    network: https([operator("Common Crawl", ["index.commoncrawl.org"])], {
      requests: 1,
      intervalSeconds: 2,
      basis: "SELF_IMPOSED",
      note: "The index server is a shared, volunteer-scale service; one request every two seconds until a published limit is checked.",
    }),
    attribution: null,
  },
  {
    id: "hibp",
    name: "Have I Been Pwned API",
    access: OFFICIAL,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "The data licence, CC BY 4.0, permits commercial use with clear, visible attribution and a link. Unresolved: whether a commercial OSINT-on-persons product satisfies its acceptable-use policy, which bans queries intended to cause harm to the victims.",
      check: audited(17, "https://haveibeenpwned.com/API/v3"),
    },
    network: https([operator("Have I Been Pwned", ["haveibeenpwned.com"])], {
      requests: 10,
      intervalSeconds: 60,
      basis: "SELF_IMPOSED",
      note: "The permitted rate depends on the subscription; ten a minute until one is chosen.",
    }),
    attribution: { text: "Data from Have I Been Pwned", url: "https://haveibeenpwned.com/" },
  },
  {
    id: "crtsh",
    name: "crt.sh Certificate Transparency",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "crt.sh publishes no API terms page that has been checked.",
      check: null,
    },
    network: https([operator("crt.sh", ["crt.sh"])]),
    attribution: null,
  },
  {
    id: "cloudflare-doh",
    name: "Cloudflare DNS over HTTPS",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "Cloudflare's public resolver terms have not been checked.",
      check: null,
    },
    network: https([operator("Cloudflare", ["cloudflare-dns.com"])]),
    attribution: null,
  },
  {
    id: "rdap",
    name: "RDAP registry lookups",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "An IETF-standard registry service; each registry's terms have not been checked.",
      check: null,
    },
    // rdap.org redirects each lookup to the TLD's registry, so every registry
    // host from the IANA bootstrap registry is declared (src/data).
    network: https([operator("RDAP", ["rdap.org", ...RDAP_REGISTRY_HOSTS])]),
    attribution: null,
  },
  {
    id: "bluesky",
    name: "Bluesky public API",
    // An optional account app password, for historical search (row 44).
    access: OPEN_OR_OFFICIAL,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "An open protocol's public API; Bluesky's terms have not been checked.",
      check: null,
    },
    network: https([operator("Bluesky", ["public.api.bsky.app", "bsky.social"])]),
    attribution: null,
  },
  {
    id: "telegram-preview",
    name: "Telegram public channel preview",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "A web preview page, not an API; Telegram's terms have not been checked.",
      check: null,
    },
    network: https([operator("Telegram", ["t.me"])]),
    attribution: null,
  },
  {
    id: "reddit-api",
    name: "Reddit Data API",
    // Its public JSON endpoint without a key (rows 7 and 20), or a tenant's
    // OAuth app; one provider, one set of terms (the Data API terms).
    access: OPEN_OR_OFFICIAL,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "The Data API terms could not be fetched, so commercial use, approval and the ban on surveillance use are all unconfirmed.",
      check: audited(7, "https://redditinc.com/policies/data-api-terms"),
    },
    network: https([operator("Reddit", ["www.reddit.com", "oauth.reddit.com"])]),
    attribution: null,
  },
  {
    id: "wayback-cdx",
    name: "Internet Archive Wayback CDX",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The archive.org terms page returned no usable content to the audit.",
      check: audited(8, null),
    },
    network: https([operator("Wayback Machine", ["web.archive.org"])]),
    attribution: null,
  },
  {
    id: "jina-reader",
    name: "Jina Reader",
    access: OPEN_OR_OFFICIAL,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "The legal page says nothing explicit about commercial or unauthenticated use, and every target URL is sent to a third party.",
      check: audited(11, "https://jina.ai/legal"),
    },
    network: https([operator("Jina", ["r.jina.ai"])]),
    attribution: null,
  },
  {
    id: "brave-search",
    name: "Brave Search API",
    access: OFFICIAL,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "The API page describes a free monthly credit but not whether commercial use is permitted on it.",
      check: audited(15, "https://brave.com/search/api/"),
    },
    network: https([operator("Brave Search", ["api.search.brave.com"])]),
    attribution: null,
  },
  {
    id: "gravatar",
    name: "Gravatar",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "Gravatar's terms have not been checked.",
      check: null,
    },
    network: https([operator("Gravatar", ["www.gravatar.com", "api.gravatar.com"])]),
    attribution: null,
  },
  {
    id: "github-api",
    name: "GitHub REST API",
    access: OPEN_OR_OFFICIAL,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "GitHub's API terms have not been checked.",
      check: null,
    },
    network: https([operator("GitHub", ["api.github.com"])], {
      requests: 60,
      intervalSeconds: 3600,
      basis: "UPSTREAM_STATED",
      note: "The primary rate limit for unauthenticated requests, per GitHub's REST documentation (https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api, read 2026-09-28). A tenant key allows more, but the shared limit holds to this until limits are per credential.",
    }),
    attribution: null,
  },
  {
    id: "openpgp-keyserver",
    name: "keys.openpgp.org",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The keyserver's terms have not been checked.",
      check: null,
    },
    network: https([operator("keys.openpgp.org", ["keys.openpgp.org"])]),
    attribution: null,
  },
  {
    id: "usgs-earthquakes",
    name: "USGS earthquake feed",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "US federal government data, public domain by US law, but not separately verified.",
      check: null,
    },
    network: https([operator("USGS", ["earthquake.usgs.gov"])]),
    attribution: null,
  },
  {
    id: "nominatim",
    name: "OpenStreetMap Nominatim",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "Light use only under the OSMF policy: no bulk geocoding, and access may be withdrawn; a hosted product should run its own instance.",
      check: audited(29, "https://operations.osmfoundation.org/policies/nominatim/"),
    },
    network: https([operator("Nominatim", ["nominatim.openstreetmap.org"])], {
      requests: 1,
      intervalSeconds: 1,
      basis: "UPSTREAM_STATED",
      note: "An absolute maximum of one request a second, per the OSMF usage policy.",
    }),
    attribution: {
      text: "© OpenStreetMap contributors",
      url: "https://www.openstreetmap.org/copyright",
    },
  },
  {
    id: "gpsjam",
    name: "GPSJam interference data",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The FAQ contains no licence or reuse terms.",
      check: audited(30, null),
    },
    network: https([operator("GPSJam", ["gpsjam.org"])]),
    attribution: null,
  },
  {
    id: "nasa-eonet",
    name: "NASA EONET natural events",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "NASA open data; its terms have not been separately verified.",
      check: null,
    },
    network: https([operator("NASA EONET", ["eonet.gsfc.nasa.gov"])]),
    attribution: null,
  },
  {
    id: "noaa-swpc",
    name: "NOAA Space Weather Prediction Center",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "US federal government data; not separately verified.",
      check: null,
    },
    network: https([operator("NOAA SWPC", ["services.swpc.noaa.gov"])]),
    attribution: null,
  },
  {
    id: "kpler",
    name: "Kpler Supply & Demand API",
    access: LICENSED,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "A paid commercial API, usable under a subscription contract that does not exist yet.",
      check: null,
    },
    network: https([operator("Kpler", ["api.kpler.com"])]),
    attribution: null,
  },
  {
    id: "cisa-kev",
    name: "CISA Known Exploited Vulnerabilities",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "US federal government data; not separately verified.",
      check: null,
    },
    network: https([operator("CISA", ["www.cisa.gov"])]),
    attribution: null,
  },
  {
    id: "feodo-tracker",
    name: "abuse.ch Feodo Tracker",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "abuse.ch's terms were linked but not fetched.",
      check: null,
    },
    network: https([operator("Feodo Tracker", ["feodotracker.abuse.ch"])]),
    attribution: null,
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "Text is CC BY-SA 4.0, which requires attribution; each image carries its own licence. Not fetched in the audit.",
      check: null,
    },
    network: https([operator("Wikipedia", ["en.wikipedia.org"])]),
    attribution: { text: "Wikipedia contributors, CC BY-SA 4.0", url: "https://en.wikipedia.org/" },
  },
  {
    id: "openverse",
    name: "Openverse images",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The API's terms have not been checked; each image carries its own licence.",
      check: null,
    },
    network: https([operator("Openverse", ["api.openverse.org"])]),
    attribution: null,
  },
  {
    id: "hacker-news",
    name: "Hacker News APIs",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The Firebase and Algolia API terms have not been checked.",
      check: null,
    },
    network: https([
      operator("Hacker News", ["hacker-news.firebaseio.com"]),
      operator("Algolia", ["hn.algolia.com"]),
    ]),
    attribution: null,
  },
  {
    id: "youtube-data-api",
    name: "YouTube Data API v3",
    access: OFFICIAL,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "The official API, governed by the YouTube API Services Terms, which have not been reviewed.",
      check: null,
    },
    network: https([operator("YouTube", ["www.googleapis.com"])]),
    attribution: null,
  },
  {
    id: "nhtsa-vpic",
    name: "NHTSA vPIC VIN decoder",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "A US federal government API; its terms have not been separately verified.",
      check: null,
    },
    network: https([operator("NHTSA", ["vpic.nhtsa.dot.gov"])]),
    attribution: null,
  },
  {
    id: "theharvester",
    name: "theHarvester (tool container)",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "GPL-2.0-only, run as a separate container; whether that meets the GPL for a commercial product is a legal question. Its container is built in Phase 4.",
      check: audited(9, "https://github.com/laramies/theHarvester"),
    },
    network: null,
    attribution: null,
  },
  {
    id: "spiderfoot",
    name: "SpiderFoot (tool container)",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "Stated to be MIT in the old compose file, not verified; it has active modules. Its container is built in Phase 4.",
      check: null,
    },
    network: null,
    attribution: null,
  },
  {
    id: "searxng",
    name: "SearXNG (tool container)",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "AGPL-3.0, run as an unmodified container; its network-use obligations are a legal question.",
      check: audited(12, "https://github.com/searxng/searxng"),
    },
    network: null,
    attribution: null,
  },
  {
    id: "ivre",
    name: "IVRE (tool container)",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "GPL-3.0-or-later, run as a separate process, and its data comes from active scans that need a scope authorisation.",
      check: audited(13, "https://github.com/ivre/ivre"),
    },
    network: null,
    attribution: null,
  },

  // ── Direct article fetch: the one open-host source ─────────────────────
  // A direct article fetch reaches whatever publisher the tenant authorised
  // (per publisher domain, Stage 1 of the exact-article work), so its host is
  // not a fixed list: it comes from the authorised target, and the fetch is
  // bound to that one host (openHost, runtime.ts + fetcher). No single
  // commercial-use verdict covers every publisher, so it is UNVERIFIED and
  // never runs in a deployment; the exact-article path is proven offline
  // (docs/M1_DIRECT_ARTICLE_FETCH_REPORT.md) and a per-publisher verdict is
  // recorded before any real publisher is enabled. https only; it names no
  // operator (its host varies per target), so evidence it would produce is
  // still labelled by this source, never by a publisher-supplied string.
  {
    id: "direct-article",
    name: "Direct article fetch (open host)",
    access: OPEN,
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "A direct fetch reaches whatever publisher the tenant authorises; no blanket commercial-use verdict covers every publisher, so it is unverified and never runs until an owner records a per-publisher verdict.",
      check: null,
    },
    network: {
      protocol: "https",
      hosts: [],
      openHost: true,
      rateLimit: SELF_IMPOSED_DEFAULT,
      operators: [],
    },
    attribution: null,
  },

  // ── RSS: one source per publishing domain, every one UNVERIFIED ────────
  ...RSS_PUBLISHERS.map(rssSource),
];
