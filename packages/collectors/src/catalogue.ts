import type { LicenceCheck, SourceDeclaration, SourceNetwork, SourceRateLimit } from "./source.ts";

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

function decided(row: number, sourceUrl: string | null = null): LicenceCheck {
  return {
    checkedOn: DECIDED_ON,
    sourceUrl,
    recordedIn: `${DECISIONS}; docs/audit/COLLECTORS.md row ${String(row)}`,
  };
}

/** Our own limit for upstreams whose published limit nobody has checked. */
const SELF_IMPOSED_DEFAULT: SourceRateLimit = {
  requests: 1,
  intervalSeconds: 1,
  basis: "SELF_IMPOSED",
  note: "No published limit has been checked; one request a second until one is.",
};

function https(
  hosts: readonly string[],
  rateLimit: SourceRateLimit = SELF_IMPOSED_DEFAULT,
): SourceNetwork {
  return { protocol: "https", hosts, rateLimit };
}

export const PLATFORM_SOURCES: readonly SourceDeclaration[] = [
  // ── BLOCKED: registered and listed, never run ──────────────────────────
  {
    id: "shodan-internetdb",
    name: "Shodan InternetDB",
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Free for non-commercial use only; using it to make money needs a Shodan enterprise licence.",
      check: audited(6, "https://internetdb.shodan.io/"),
    },
    network: https(["internetdb.shodan.io"]),
    attribution: null,
  },
  {
    id: "c2intelfeeds",
    name: "C2IntelFeeds",
    licence: {
      commercialUse: "BLOCKED",
      reason: "Licensed CC BY-NC-SA 4.0: non-commercial use only.",
      check: audited(37, "https://github.com/drb-ra/C2IntelFeeds"),
    },
    network: https(["raw.githubusercontent.com"]),
    attribution: null,
  },
  {
    id: "insightface-buffalo-l",
    name: "InsightFace buffalo_l model pack",
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
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "YouTube's terms forbid automated access, downloading and circumventing the service; InnerTube also impersonates YouTube's own client apps.",
      check: audited(47, "https://www.youtube.com/t/terms"),
    },
    network: https(["www.youtube.com"]),
    attribution: null,
  },
  {
    id: "youtube-ytdlp",
    name: "YouTube via yt-dlp",
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
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Scrapes a search results page with a spoofed browser user agent; the terms defer automated access to a policy that was not fetched.",
      check: decided(51, "https://duckduckgo.com/terms"),
    },
    network: https(["html.duckduckgo.com"]),
    attribution: null,
  },
  {
    id: "local-network-scan",
    name: "Local network and Wi-Fi scanner",
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
    licence: {
      commercialUse: "BLOCKED",
      reason: "An undocumented Google feed with no confirmed terms; blocked rather than relied on.",
      check: decided(22),
    },
    network: https(["news.google.com"]),
    attribution: null,
  },
  {
    id: "hackertarget",
    name: "HackerTarget",
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Its terms page returned 404 to the audit, so commercial use is unconfirmed; blocked until checked.",
      check: decided(1),
    },
    network: https(["api.hackertarget.com"]),
    attribution: null,
  },
  {
    id: "alienvault-otx",
    name: "AlienVault OTX",
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Its terms were not checked, so commercial use is unconfirmed; blocked until checked.",
      check: decided(1),
    },
    network: https(["otx.alienvault.com"]),
    attribution: null,
  },
  {
    id: "ucdp",
    name: "UCDP GED API",
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "Tokens are issued, free of charge, for a described research project; a commercial product is not that, and commercial use is not addressed.",
      check: decided(26),
    },
    network: https(["ucdpapi.pcr.uu.se"], {
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
    licence: {
      commercialUse: "BLOCKED",
      reason:
        "The appname registration is described as free for non-commercial use, and its content may be copyrighted by the original sources.",
      check: decided(27),
    },
    network: https(["api.reliefweb.int"], {
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
    network: https(["opensky-network.org"]),
    attribution: null,
  },

  // ── PERMITTED: terms read and recorded ─────────────────────────────────
  {
    id: "gdelt-doc",
    name: "GDELT DOC 2.0 API",
    licence: {
      commercialUse: "PERMITTED",
      reason:
        "Available for unlimited and unrestricted academic, commercial or governmental use without fee; citation required on redistribution.",
      check: audited(4, "https://www.gdeltproject.org/about.html"),
    },
    network: https(["api.gdeltproject.org"], {
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
    licence: {
      commercialUse: "PERMITTED",
      reason: "The same GDELT terms as the DOC API; citation required on redistribution.",
      check: audited(24, "https://www.gdeltproject.org/about.html"),
    },
    network: https(["data.gdeltproject.org"], {
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
    licence: {
      commercialUse: "PERMITTED",
      reason: "CC0: free and open for anyone to use under any circumstance.",
      check: audited(31, "https://safecast.org/about/data"),
    },
    network: https(["api.safecast.org"]),
    attribution: null,
  },

  // ── UNVERIFIED: run only where configuration allows unverified sources ──
  {
    id: "hibp",
    name: "Have I Been Pwned API",
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "The data licence, CC BY 4.0, permits commercial use with clear, visible attribution and a link. Unresolved: whether a commercial OSINT-on-persons product satisfies its acceptable-use policy, which bans queries intended to cause harm to the victims.",
      check: audited(17, "https://haveibeenpwned.com/API/v3"),
    },
    network: https(["haveibeenpwned.com"], {
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
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "crt.sh publishes no API terms page that has been checked.",
      check: null,
    },
    network: https(["crt.sh"]),
    attribution: null,
  },
  {
    id: "cloudflare-doh",
    name: "Cloudflare DNS over HTTPS",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "Cloudflare's public resolver terms have not been checked.",
      check: null,
    },
    network: https(["cloudflare-dns.com"]),
    attribution: null,
  },
  {
    id: "rdap",
    name: "RDAP registry lookups",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "An IETF-standard registry service; each registry's terms have not been checked.",
      check: null,
    },
    network: https(["rdap.org", "rdap.verisign.com", "rdap.publicinterestregistry.org"]),
    attribution: null,
  },
  {
    id: "bluesky",
    name: "Bluesky public API",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "An open protocol's public API; Bluesky's terms have not been checked.",
      check: null,
    },
    network: https(["public.api.bsky.app", "bsky.social"]),
    attribution: null,
  },
  {
    id: "telegram-preview",
    name: "Telegram public channel preview",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "A web preview page, not an API; Telegram's terms have not been checked.",
      check: null,
    },
    network: https(["t.me"]),
    attribution: null,
  },
  {
    id: "reddit-api",
    name: "Reddit Data API",
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "The Data API terms could not be fetched, so commercial use, approval and the ban on surveillance use are all unconfirmed.",
      check: audited(7, "https://redditinc.com/policies/data-api-terms"),
    },
    network: https(["www.reddit.com", "oauth.reddit.com"]),
    attribution: null,
  },
  {
    id: "wayback-cdx",
    name: "Internet Archive Wayback CDX",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The archive.org terms page returned no usable content to the audit.",
      check: audited(8, null),
    },
    network: https(["web.archive.org"]),
    attribution: null,
  },
  {
    id: "jina-reader",
    name: "Jina Reader",
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "The legal page says nothing explicit about commercial or unauthenticated use, and every target URL is sent to a third party.",
      check: audited(11, "https://jina.ai/legal"),
    },
    network: https(["r.jina.ai"]),
    attribution: null,
  },
  {
    id: "brave-search",
    name: "Brave Search API",
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "The API page describes a free monthly credit but not whether commercial use is permitted on it.",
      check: audited(15, "https://brave.com/search/api/"),
    },
    network: https(["api.search.brave.com"]),
    attribution: null,
  },
  {
    id: "gravatar",
    name: "Gravatar",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "Gravatar's terms have not been checked.",
      check: null,
    },
    network: https(["www.gravatar.com", "api.gravatar.com"]),
    attribution: null,
  },
  {
    id: "github-api",
    name: "GitHub REST API",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "GitHub's API terms have not been checked.",
      check: null,
    },
    network: https(["api.github.com"], {
      requests: 10,
      intervalSeconds: 60,
      basis: "UPSTREAM_STATED",
      note: "The unauthenticated search ceiling (docs/audit/COLLECTORS.md row 41); other endpoints differ.",
    }),
    attribution: null,
  },
  {
    id: "openpgp-keyserver",
    name: "keys.openpgp.org",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The keyserver's terms have not been checked.",
      check: null,
    },
    network: https(["keys.openpgp.org"]),
    attribution: null,
  },
  {
    id: "usgs-earthquakes",
    name: "USGS earthquake feed",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "US federal government data, public domain by US law, but not separately verified.",
      check: null,
    },
    network: https(["earthquake.usgs.gov"]),
    attribution: null,
  },
  {
    id: "nominatim",
    name: "OpenStreetMap Nominatim",
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "Light use only under the OSMF policy: no bulk geocoding, and access may be withdrawn; a hosted product should run its own instance.",
      check: audited(29, "https://operations.osmfoundation.org/policies/nominatim/"),
    },
    network: https(["nominatim.openstreetmap.org"], {
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
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The FAQ contains no licence or reuse terms.",
      check: audited(30, null),
    },
    network: https(["gpsjam.org"]),
    attribution: null,
  },
  {
    id: "nasa-eonet",
    name: "NASA EONET natural events",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "NASA open data; its terms have not been separately verified.",
      check: null,
    },
    network: https(["eonet.gsfc.nasa.gov"]),
    attribution: null,
  },
  {
    id: "noaa-swpc",
    name: "NOAA Space Weather Prediction Center",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "US federal government data; not separately verified.",
      check: null,
    },
    network: https(["services.swpc.noaa.gov"]),
    attribution: null,
  },
  {
    id: "kpler",
    name: "Kpler Supply & Demand API",
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "A paid commercial API, usable under a subscription contract that does not exist yet.",
      check: null,
    },
    network: https(["api.kpler.com"]),
    attribution: null,
  },
  {
    id: "cisa-kev",
    name: "CISA Known Exploited Vulnerabilities",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "US federal government data; not separately verified.",
      check: null,
    },
    network: https(["www.cisa.gov"]),
    attribution: null,
  },
  {
    id: "feodo-tracker",
    name: "abuse.ch Feodo Tracker",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "abuse.ch's terms were linked but not fetched.",
      check: null,
    },
    network: https(["feodotracker.abuse.ch"]),
    attribution: null,
  },
  {
    id: "wikidata",
    name: "Wikidata",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "Published under CC0, which is widely documented but was not fetched in the audit.",
      check: null,
    },
    network: https(["www.wikidata.org"]),
    attribution: null,
  },
  {
    id: "wikipedia",
    name: "Wikipedia",
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "Text is CC BY-SA 4.0, which requires attribution; each image carries its own licence. Not fetched in the audit.",
      check: null,
    },
    network: https(["en.wikipedia.org"]),
    attribution: { text: "Wikipedia contributors, CC BY-SA 4.0", url: "https://en.wikipedia.org/" },
  },
  {
    id: "openverse",
    name: "Openverse images",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The API's terms have not been checked; each image carries its own licence.",
      check: null,
    },
    network: https(["api.openverse.org"]),
    attribution: null,
  },
  {
    id: "hacker-news",
    name: "Hacker News APIs",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "The Firebase and Algolia API terms have not been checked.",
      check: null,
    },
    network: https(["hacker-news.firebaseio.com", "hn.algolia.com"]),
    attribution: null,
  },
  {
    id: "youtube-data-api",
    name: "YouTube Data API v3",
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "The official API, governed by the YouTube API Services Terms, which have not been reviewed.",
      check: null,
    },
    network: https(["www.googleapis.com"]),
    attribution: null,
  },
  {
    id: "nhtsa-vpic",
    name: "NHTSA vPIC VIN decoder",
    licence: {
      commercialUse: "UNVERIFIED",
      reason: "A US federal government API; its terms have not been separately verified.",
      check: null,
    },
    network: https(["vpic.nhtsa.dot.gov"]),
    attribution: null,
  },
  {
    id: "theharvester",
    name: "theHarvester (tool container)",
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
    licence: {
      commercialUse: "UNVERIFIED",
      reason:
        "GPL-3.0-or-later, run as a separate process, and its data comes from active scans that need a scope authorisation.",
      check: audited(13, "https://github.com/ivre/ivre"),
    },
    network: null,
    attribution: null,
  },
];
