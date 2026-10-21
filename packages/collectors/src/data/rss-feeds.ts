/**
 * News outlets' RSS and Atom feeds, one entry per publishing domain (one
 * provider, one set of terms; a publisher whose feeds FeedBurner serves is
 * named as the owner's list names it). Generated from the live checks recorded
 * in test/snapshots/rss-feed-verification.json, which accounts for every URL
 * fetched; a test checks this list, and each publisher's country, against it.
 *
 * Two lead batches, both verified live (owner instruction):
 *   2026-10-17 — World Monitor's feed list (AGPL-3.0) as leads, no file copied,
 *     Google News left out (that source is BLOCKED), plus eight Indian outlets.
 *   2026-10-21 — the owner's global news catalog
 *     (Vestigo_Global_News_Providers_and_APIs.md), its licensed wire agencies
 *     and website-only outlets left out, Instagram/Facebook/X hosts refused.
 * Each URL was fetched and kept only if it answered 200 within its redirects
 * and parsed as RSS or Atom with at least one item that has a title and a link;
 * anything else was skipped. The redirect chain's hosts are declared, so the
 * fetcher follows them and nothing else. 217 publishers, 239 feeds.
 *
 * Every source here is UNVERIFIED and never runs until the owner records the
 * publisher's terms (see catalogue.ts). `country` is the publishing outlet's
 * country where the catalog records one (ISO 3166-1 alpha-2); null otherwise.
 * A feed's language tag (The Hindu states en-US) is not a country.
 */
export const RSS_COUNTRY_CODES = [
  "AE",
  "AR",
  "AU",
  "BD",
  "BE",
  "BR",
  "CA",
  "CH",
  "CN",
  "CO",
  "DE",
  "DK",
  "DO",
  "ES",
  "FI",
  "FR",
  "GB",
  "HK",
  "ID",
  "IE",
  "IL",
  "IN",
  "IR",
  "IT",
  "JP",
  "KE",
  "LV",
  "MM",
  "MX",
  "NA",
  "NG",
  "NL",
  "NO",
  "NP",
  "NZ",
  "PH",
  "PK",
  "QA",
  "RS",
  "SA",
  "SE",
  "SG",
  "TH",
  "TR",
  "TW",
  "US",
  "VN",
  "ZA",
] as const;
export type CountryCode = (typeof RSS_COUNTRY_CODES)[number];

export interface RssPublisher {
  /** Source and collector id. */
  readonly id: string;
  /** The publishing domain, or the publisher's name for one FeedBurner serves. */
  readonly publisher: string;
  /** The feed URLs, each verified. */
  readonly feeds: readonly string[];
  /** Who runs each host the feeds are fetched from, by registrable domain. */
  readonly operators: readonly { readonly name: string; readonly hosts: readonly string[] }[];
  /** ISO 3166-1 alpha-2, where the catalog records the outlet's country; else null. */
  readonly country: CountryCode | null;
}

export const RSS_PUBLISHERS: readonly RssPublisher[] = [
  {
    id: "rss.24-hu",
    publisher: "24.hu",
    feeds: ["https://24.hu/feed/"],
    operators: [
      {
        name: "24.hu",
        hosts: ["24.hu"],
      },
    ],
    country: null,
  },
  {
    id: "rss.444-hu",
    publisher: "444.hu",
    feeds: ["https://444.hu/feed"],
    operators: [
      {
        name: "444.hu",
        hosts: ["444.hu"],
      },
    ],
    country: null,
  },
  {
    id: "rss.a16z-news",
    publisher: "a16z.news",
    feeds: ["https://www.a16z.news/feed"],
    operators: [
      {
        name: "a16z.news",
        hosts: ["www.a16z.news"],
      },
    ],
    country: null,
  },
  {
    id: "rss.aajtak-in",
    publisher: "aajtak.in",
    feeds: ["https://www.aajtak.in/rssfeeds/?id=home"],
    operators: [
      {
        name: "aajtak.in",
        hosts: ["www.aajtak.in"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.abc-net-au",
    publisher: "abc.net.au",
    feeds: ["https://www.abc.net.au/news/feed/51120/rss.xml"],
    operators: [
      {
        name: "abc.net.au",
        hosts: ["www.abc.net.au"],
      },
    ],
    country: "AU",
  },
  {
    id: "rss.abcnews-com",
    publisher: "abcnews.com",
    feeds: ["https://feeds.abcnews.com/abcnews/topstories"],
    operators: [
      {
        name: "abcnews.com",
        hosts: ["abcnews.com", "feeds.abcnews.com"],
      },
      {
        name: "go.com",
        hosts: ["abcnews.go.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.africanews-com",
    publisher: "africanews.com",
    feeds: ["https://www.africanews.com/feed/"],
    operators: [
      {
        name: "africanews.com",
        hosts: ["www.africanews.com"],
      },
    ],
    country: "FR",
  },
  {
    id: "rss.al-monitor-com",
    publisher: "al-monitor.com",
    feeds: ["https://www.al-monitor.com/rss"],
    operators: [
      {
        name: "al-monitor.com",
        hosts: ["www.al-monitor.com"],
      },
    ],
    country: "US",
  },
  {
    id: "rss.aljazeera-com",
    publisher: "aljazeera.com",
    feeds: ["https://www.aljazeera.com/xml/rss/all.xml"],
    operators: [
      {
        name: "aljazeera.com",
        hosts: ["www.aljazeera.com"],
      },
    ],
    country: "QA",
  },
  {
    id: "rss.allafrica-com",
    publisher: "allafrica.com",
    feeds: ["https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf"],
    operators: [
      {
        name: "allafrica.com",
        hosts: ["allafrica.com"],
      },
    ],
    country: "US",
  },
  {
    id: "rss.altnews-in",
    publisher: "altnews.in",
    feeds: ["https://www.altnews.in/feed/"],
    operators: [
      {
        name: "altnews.in",
        hosts: ["www.altnews.in"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.amarujala-com",
    publisher: "amarujala.com",
    feeds: ["https://www.amarujala.com/rss/national.xml"],
    operators: [
      {
        name: "amarujala.com",
        hosts: ["www.amarujala.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.ansa-it",
    publisher: "ansa.it",
    feeds: ["https://www.ansa.it/sito/ansait_rss.xml"],
    operators: [
      {
        name: "ansa.it",
        hosts: ["www.ansa.it"],
      },
    ],
    country: "IT",
  },
  {
    id: "rss.apublica-org",
    publisher: "apublica.org",
    feeds: ["https://apublica.org/feed/"],
    operators: [
      {
        name: "apublica.org",
        hosts: ["apublica.org"],
      },
    ],
    country: "BR",
  },
  {
    id: "rss.arabnews-com",
    publisher: "arabnews.com",
    feeds: ["https://www.arabnews.com/rss.xml"],
    operators: [
      {
        name: "arabnews.com",
        hosts: ["www.arabnews.com"],
      },
    ],
    country: "SA",
  },
  {
    id: "rss.arstechnica-com",
    publisher: "arstechnica.com",
    feeds: ["https://feeds.arstechnica.com/arstechnica/technology-lab"],
    operators: [
      {
        name: "arstechnica.com",
        hosts: ["feeds.arstechnica.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.arxiv-org",
    publisher: "arxiv.org",
    feeds: ["https://export.arxiv.org/rss/cs.AI"],
    operators: [
      {
        name: "arxiv.org",
        hosts: ["export.arxiv.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.atv-hu",
    publisher: "atv.hu",
    feeds: ["https://www.atv.hu/rss"],
    operators: [
      {
        name: "atv.hu",
        hosts: ["www.atv.hu"],
      },
    ],
    country: null,
  },
  {
    id: "rss.axios-com",
    publisher: "axios.com",
    feeds: ["https://api.axios.com/feed/"],
    operators: [
      {
        name: "axios.com",
        hosts: ["api.axios.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.balkaninsight-com",
    publisher: "balkaninsight.com",
    feeds: ["https://balkaninsight.com/feed/"],
    operators: [
      {
        name: "balkaninsight.com",
        hosts: ["balkaninsight.com"],
      },
    ],
    country: "RS",
  },
  {
    id: "rss.bangkokpost-com",
    publisher: "bangkokpost.com",
    feeds: ["https://www.bangkokpost.com/rss/data/topstories.xml"],
    operators: [
      {
        name: "bangkokpost.com",
        hosts: ["www.bangkokpost.com"],
      },
    ],
    country: "TH",
  },
  {
    id: "rss.bbci-co-uk",
    publisher: "bbci.co.uk",
    feeds: [
      "https://feeds.bbci.co.uk/hindi/rss.xml",
      "https://feeds.bbci.co.uk/news/world/africa/rss.xml",
      "https://feeds.bbci.co.uk/news/world/asia/rss.xml",
      "https://feeds.bbci.co.uk/news/world/latin_america/rss.xml",
      "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
      "https://feeds.bbci.co.uk/news/world/rss.xml",
      "https://feeds.bbci.co.uk/persian/rss.xml",
    ],
    operators: [
      {
        name: "bbci.co.uk",
        hosts: ["feeds.bbci.co.uk"],
      },
    ],
    country: "GB",
  },
  {
    id: "rss.bitcoinmagazine-com",
    publisher: "bitcoinmagazine.com",
    feeds: ["https://bitcoinmagazine.com/feed"],
    operators: [
      {
        name: "bitcoinmagazine.com",
        hosts: ["bitcoinmagazine.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.boomlive-in",
    publisher: "boomlive.in",
    feeds: ["https://www.boomlive.in/feed"],
    operators: [
      {
        name: "boomlive.in",
        hosts: ["www.boomlive.in"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.cbc-ca",
    publisher: "cbc.ca",
    feeds: ["https://www.cbc.ca/webfeed/rss/rss-topstories"],
    operators: [
      {
        name: "cbc.ca",
        hosts: ["www.cbc.ca"],
      },
    ],
    country: "CA",
  },
  {
    id: "rss.cbsnews-com",
    publisher: "cbsnews.com",
    feeds: ["https://www.cbsnews.com/latest/rss/main"],
    operators: [
      {
        name: "cbsnews.com",
        hosts: ["www.cbsnews.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.changelog-com",
    publisher: "changelog.com",
    feeds: ["https://changelog.com/feed"],
    operators: [
      {
        name: "changelog.com",
        hosts: ["changelog.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.channelnewsasia-com",
    publisher: "channelnewsasia.com",
    feeds: ["https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml"],
    operators: [
      {
        name: "channelnewsasia.com",
        hosts: ["www.channelnewsasia.com"],
      },
    ],
    country: "SG",
  },
  {
    id: "rss.channelstv-com",
    publisher: "channelstv.com",
    feeds: ["https://www.channelstv.com/feed/"],
    operators: [
      {
        name: "channelstv.com",
        hosts: ["www.channelstv.com"],
      },
    ],
    country: "NG",
  },
  {
    id: "rss.chequeado-com",
    publisher: "chequeado.com",
    feeds: ["https://chequeado.com/feed/"],
    operators: [
      {
        name: "chequeado.com",
        hosts: ["chequeado.com"],
      },
    ],
    country: "AR",
  },
  {
    id: "rss.cisa-gov",
    publisher: "cisa.gov",
    feeds: ["https://www.cisa.gov/cybersecurity-advisories/all.xml"],
    operators: [
      {
        name: "cisa.gov",
        hosts: ["www.cisa.gov"],
      },
    ],
    country: null,
  },
  {
    id: "rss.clarin-com",
    publisher: "clarin.com",
    feeds: ["https://www.clarin.com/rss/lo-ultimo/"],
    operators: [
      {
        name: "clarin.com",
        hosts: ["www.clarin.com"],
      },
    ],
    country: "AR",
  },
  {
    id: "rss.cnbc-com",
    publisher: "cnbc.com",
    feeds: [
      "https://www.cnbc.com/id/100003114/device/rss/rss.html",
      "https://www.cnbc.com/id/19854910/device/rss/rss.html",
    ],
    operators: [
      {
        name: "cnbc.com",
        hosts: ["www.cnbc.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.coindesk-com",
    publisher: "coindesk.com",
    feeds: ["https://www.coindesk.com/arc/outboundfeeds/rss/"],
    operators: [
      {
        name: "coindesk.com",
        hosts: ["www.coindesk.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.cointelegraph-com",
    publisher: "cointelegraph.com",
    feeds: ["https://cointelegraph.com/rss"],
    operators: [
      {
        name: "cointelegraph.com",
        hosts: ["cointelegraph.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.com-ar",
    publisher: "com.ar",
    feeds: ["https://www.lanacion.com.ar/arc/outboundfeeds/rss/"],
    operators: [
      {
        name: "com.ar",
        hosts: ["www.lanacion.com.ar"],
      },
    ],
    country: "AR",
  },
  {
    id: "rss.com-na",
    publisher: "com.na",
    feeds: ["https://www.namibian.com.na/feed/"],
    operators: [
      {
        name: "com.na",
        hosts: ["www.namibian.com.na"],
      },
    ],
    country: "NA",
  },
  {
    id: "rss.conservationoptimism-org",
    publisher: "conservationoptimism.org",
    feeds: ["https://conservationoptimism.org/feed/"],
    operators: [
      {
        name: "conservationoptimism.org",
        hosts: ["conservationoptimism.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.correctiv-org",
    publisher: "correctiv.org",
    feeds: ["https://correctiv.org/feed/"],
    operators: [
      {
        name: "correctiv.org",
        hosts: ["correctiv.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.crisisgroup-org",
    publisher: "crisisgroup.org",
    feeds: ["https://www.crisisgroup.org/rss"],
    operators: [
      {
        name: "crisisgroup.org",
        hosts: ["www.crisisgroup.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.crunchbase-com",
    publisher: "crunchbase.com",
    feeds: ["https://news.crunchbase.com/feed/"],
    operators: [
      {
        name: "crunchbase.com",
        hosts: ["news.crunchbase.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.cryptoslate-com",
    publisher: "cryptoslate.com",
    feeds: ["https://cryptoslate.com/feed/"],
    operators: [
      {
        name: "cryptoslate.com",
        hosts: ["cryptoslate.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.csis-org",
    publisher: "csis.org",
    feeds: ["https://www.csis.org/rss.xml"],
    operators: [
      {
        name: "csis.org",
        hosts: ["www.csis.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.dailysabah-com",
    publisher: "dailysabah.com",
    feeds: ["https://www.dailysabah.com/rssFeed/home"],
    operators: [
      {
        name: "dailysabah.com",
        hosts: ["www.dailysabah.com"],
      },
    ],
    country: "TR",
  },
  {
    id: "rss.dailytrust-com",
    publisher: "dailytrust.com",
    feeds: ["https://dailytrust.com/feed/"],
    operators: [
      {
        name: "dailytrust.com",
        hosts: ["dailytrust.com"],
      },
    ],
    country: "NG",
  },
  {
    id: "rss.darkreading-com",
    publisher: "darkreading.com",
    feeds: ["https://www.darkreading.com/rss.xml"],
    operators: [
      {
        name: "darkreading.com",
        hosts: ["www.darkreading.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.dawn-com",
    publisher: "dawn.com",
    feeds: ["https://www.dawn.com/feeds/home"],
    operators: [
      {
        name: "dawn.com",
        hosts: ["www.dawn.com"],
      },
    ],
    country: "PK",
  },
  {
    id: "rss.decrypt-co",
    publisher: "decrypt.co",
    feeds: ["https://decrypt.co/feed"],
    operators: [
      {
        name: "decrypt.co",
        hosts: ["decrypt.co"],
      },
    ],
    country: null,
  },
  {
    id: "rss.defensenews-com",
    publisher: "defensenews.com",
    feeds: ["https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml"],
    operators: [
      {
        name: "defensenews.com",
        hosts: ["www.defensenews.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.defenseone-com",
    publisher: "defenseone.com",
    feeds: ["https://www.defenseone.com/rss/all/"],
    operators: [
      {
        name: "defenseone.com",
        hosts: ["www.defenseone.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.dev-to",
    publisher: "dev.to",
    feeds: ["https://dev.to/feed"],
    operators: [
      {
        name: "dev.to",
        hosts: ["dev.to"],
      },
    ],
    country: null,
  },
  {
    id: "rss.dfrlab-org",
    publisher: "dfrlab.org",
    feeds: ["https://dfrlab.org/feed/"],
    operators: [
      {
        name: "dfrlab.org",
        hosts: ["dfrlab.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.diariolibre-com",
    publisher: "diariolibre.com",
    feeds: ["https://www.diariolibre.com/rss/portada.xml"],
    operators: [
      {
        name: "diariolibre.com",
        hosts: ["www.diariolibre.com"],
      },
    ],
    country: "DO",
  },
  {
    id: "rss.dowjones-io",
    publisher: "dowjones.io",
    feeds: ["https://feeds.content.dowjones.io/public/rss/RSSUSnews"],
    operators: [
      {
        name: "dowjones.io",
        hosts: ["feeds.content.dowjones.io"],
      },
    ],
    country: null,
  },
  {
    id: "rss.dr-dk",
    publisher: "dr.dk",
    feeds: ["https://www.dr.dk/nyheder/service/feeds/allenyheder"],
    operators: [
      {
        name: "dr.dk",
        hosts: ["www.dr.dk"],
      },
    ],
    country: "DK",
  },
  {
    id: "rss.dw-com",
    publisher: "dw.com",
    feeds: ["https://rss.dw.com/xml/rss-en-all"],
    operators: [
      {
        name: "dw.com",
        hosts: ["rss.dw.com"],
      },
    ],
    country: "DE",
  },
  {
    id: "rss.ebc-com-br",
    publisher: "ebc.com.br",
    feeds: ["https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml"],
    operators: [
      {
        name: "ebc.com.br",
        hosts: ["agenciabrasil.ebc.com.br"],
      },
    ],
    country: "BR",
  },
  {
    id: "rss.eldiario-es",
    publisher: "eldiario.es",
    feeds: ["https://www.eldiario.es/rss/"],
    operators: [
      {
        name: "eldiario.es",
        hosts: ["www.eldiario.es"],
      },
    ],
    country: "ES",
  },
  {
    id: "rss.elpais-com",
    publisher: "elpais.com",
    feeds: ["https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada"],
    operators: [
      {
        name: "elpais.com",
        hosts: ["feeds.elpais.com"],
      },
    ],
    country: "ES",
  },
  {
    id: "rss.eltiempo-com",
    publisher: "eltiempo.com",
    feeds: ["https://www.eltiempo.com/rss/mundo.xml"],
    operators: [
      {
        name: "eltiempo.com",
        hosts: ["www.eltiempo.com"],
      },
    ],
    country: "CO",
  },
  {
    id: "rss.eluniverso-com",
    publisher: "eluniverso.com",
    feeds: ["https://www.eluniverso.com/arc/outboundfeeds/rss/category/noticias/?outputType=xml"],
    operators: [
      {
        name: "eluniverso.com",
        hosts: ["www.eluniverso.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.euronews-com",
    publisher: "euronews.com",
    feeds: ["https://www.euronews.com/rss", "https://www.euronews.com/rss?format=xml"],
    operators: [
      {
        name: "euronews.com",
        hosts: ["www.euronews.com"],
      },
    ],
    country: "FR",
  },
  {
    id: "rss.factcheck-org",
    publisher: "factcheck.org",
    feeds: ["https://www.factcheck.org/feed/"],
    operators: [
      {
        name: "factcheck.org",
        hosts: ["www.factcheck.org"],
      },
    ],
    country: "US",
  },
  {
    id: "rss.factly-in",
    publisher: "factly.in",
    feeds: ["https://factly.in/feed/"],
    operators: [
      {
        name: "factly.in",
        hosts: ["factly.in"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.fao-org",
    publisher: "fao.org",
    feeds: ["https://www.fao.org/feeds/fao-newsroom-rss"],
    operators: [
      {
        name: "fao.org",
        hosts: ["www.fao.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.federalreserve-gov",
    publisher: "federalreserve.gov",
    feeds: ["https://www.federalreserve.gov/feeds/press_all.xml"],
    operators: [
      {
        name: "federalreserve.gov",
        hosts: ["www.federalreserve.gov"],
      },
    ],
    country: null,
  },
  {
    id: "rss.firstround-com",
    publisher: "firstround.com",
    feeds: ["https://review.firstround.com/articles/rss"],
    operators: [
      {
        name: "firstround.com",
        hosts: ["review.firstround.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.foreignaffairs-com",
    publisher: "foreignaffairs.com",
    feeds: ["https://www.foreignaffairs.com/rss.xml"],
    operators: [
      {
        name: "foreignaffairs.com",
        hosts: ["www.foreignaffairs.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.foreignpolicy-com",
    publisher: "foreignpolicy.com",
    feeds: ["https://foreignpolicy.com/feed/"],
    operators: [
      {
        name: "foreignpolicy.com",
        hosts: ["foreignpolicy.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.france24-com",
    publisher: "france24.com",
    feeds: ["https://www.france24.com/en/rss"],
    operators: [
      {
        name: "france24.com",
        hosts: ["www.france24.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.ft-com",
    publisher: "ft.com",
    feeds: ["https://www.ft.com/rss/home"],
    operators: [
      {
        name: "ft.com",
        hosts: ["www.ft.com"],
      },
    ],
    country: "GB",
  },
  {
    id: "rss.fullfact-org",
    publisher: "fullfact.org",
    feeds: ["https://fullfact.org/feed/all/"],
    operators: [
      {
        name: "fullfact.org",
        hosts: ["fullfact.org"],
      },
    ],
    country: "GB",
  },
  {
    id: "rss.gcaptain-com",
    publisher: "gcaptain.com",
    feeds: ["https://gcaptain.com/feed/"],
    operators: [
      {
        name: "gcaptain.com",
        hosts: ["gcaptain.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.geo-tv",
    publisher: "geo.tv",
    feeds: ["https://www.geo.tv/rss/1/1"],
    operators: [
      {
        name: "geo.tv",
        hosts: ["www.geo.tv"],
      },
    ],
    country: "PK",
  },
  {
    id: "rss.github-blog",
    publisher: "github.blog",
    feeds: ["https://github.blog/feed/"],
    operators: [
      {
        name: "github.blog",
        hosts: ["github.blog"],
      },
    ],
    country: null,
  },
  {
    id: "rss.globalinitiative-net",
    publisher: "globalinitiative.net",
    feeds: ["https://globalinitiative.net/feed/"],
    operators: [
      {
        name: "globalinitiative.net",
        hosts: ["globalinitiative.net"],
      },
    ],
    country: null,
  },
  {
    id: "rss.globalnews-ca",
    publisher: "globalnews.ca",
    feeds: ["https://globalnews.ca/feed/"],
    operators: [
      {
        name: "globalnews.ca",
        hosts: ["globalnews.ca"],
      },
    ],
    country: "CA",
  },
  {
    id: "rss.globaltimes-cn",
    publisher: "globaltimes.cn",
    feeds: ["https://www.globaltimes.cn/rss/outbrain.xml"],
    operators: [
      {
        name: "globaltimes.cn",
        hosts: ["www.globaltimes.cn"],
      },
    ],
    country: "CN",
  },
  {
    id: "rss.goodnewsnetwork-org",
    publisher: "goodnewsnetwork.org",
    feeds: [
      "https://www.goodnewsnetwork.org/category/news/health/feed/",
      "https://www.goodnewsnetwork.org/category/news/inspiring/feed/",
      "https://www.goodnewsnetwork.org/feed/",
    ],
    operators: [
      {
        name: "goodnewsnetwork.org",
        hosts: ["www.goodnewsnetwork.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.hindustantimes-com",
    publisher: "hindustantimes.com",
    feeds: ["https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml"],
    operators: [
      {
        name: "hindustantimes.com",
        hosts: ["www.hindustantimes.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.hnrss-org",
    publisher: "hnrss.org",
    feeds: ["https://hnrss.org/frontpage", "https://hnrss.org/show"],
    operators: [
      {
        name: "hnrss.org",
        hosts: ["hnrss.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.hongkongfp-com",
    publisher: "hongkongfp.com",
    feeds: ["https://hongkongfp.com/feed/"],
    operators: [
      {
        name: "hongkongfp.com",
        hosts: ["hongkongfp.com"],
      },
    ],
    country: "HK",
  },
  {
    id: "rss.humanprogress-org",
    publisher: "humanprogress.org",
    feeds: ["https://humanprogress.org/feed/"],
    operators: [
      {
        name: "humanprogress.org",
        hosts: ["humanprogress.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.hvg-hu",
    publisher: "hvg.hu",
    feeds: ["https://hvg.hu/rss"],
    operators: [
      {
        name: "hvg.hu",
        hosts: ["hvg.hu"],
      },
    ],
    country: null,
  },
  {
    id: "rss.iaea-org",
    publisher: "iaea.org",
    feeds: ["https://www.iaea.org/feeds/topnews"],
    operators: [
      {
        name: "iaea.org",
        hosts: ["www.iaea.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.inc42-com",
    publisher: "inc42.com",
    feeds: ["https://inc42.com/feed/"],
    operators: [
      {
        name: "inc42.com",
        hosts: ["inc42.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.independent-co-uk",
    publisher: "independent.co.uk",
    feeds: ["https://www.independent.co.uk/news/world/rss"],
    operators: [
      {
        name: "independent.co.uk",
        hosts: ["www.independent.co.uk"],
      },
    ],
    country: "GB",
  },
  {
    id: "rss.index-hu",
    publisher: "index.hu",
    feeds: ["https://index.hu/24ora/rss"],
    operators: [
      {
        name: "index.hu",
        hosts: ["index.hu"],
      },
    ],
    country: null,
  },
  {
    id: "rss.indianexpress-com",
    publisher: "indianexpress.com",
    feeds: ["https://indianexpress.com/feed/"],
    operators: [
      {
        name: "indianexpress.com",
        hosts: ["indianexpress.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.indiatimes-com",
    publisher: "indiatimes.com",
    feeds: [
      "https://economictimes.indiatimes.com/rssfeedstopstories.cms",
      "https://timesofindia.indiatimes.com/rssfeedstopstories.cms",
    ],
    operators: [
      {
        name: "indiatimes.com",
        hosts: ["economictimes.indiatimes.com", "timesofindia.indiatimes.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.indiatoday-in",
    publisher: "indiatoday.in",
    feeds: ["https://www.indiatoday.in/rss/home"],
    operators: [
      {
        name: "indiatoday.in",
        hosts: ["www.indiatoday.in"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.infobae-com",
    publisher: "infobae.com",
    feeds: ["https://www.infobae.com/arc/outboundfeeds/rss/"],
    operators: [
      {
        name: "infobae.com",
        hosts: ["www.infobae.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.infoq-com",
    publisher: "infoq.com",
    feeds: ["https://feed.infoq.com/"],
    operators: [
      {
        name: "infoq.com",
        hosts: ["feed.infoq.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.inquirer-net",
    publisher: "inquirer.net",
    feeds: ["https://www.inquirer.net/feed/"],
    operators: [
      {
        name: "inquirer.net",
        hosts: ["www.inquirer.net"],
      },
    ],
    country: "PH",
  },
  {
    id: "rss.insightcrime-org",
    publisher: "insightcrime.org",
    feeds: ["https://insightcrime.org/feed/"],
    operators: [
      {
        name: "insightcrime.org",
        hosts: ["insightcrime.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.irishtimes-com",
    publisher: "irishtimes.com",
    feeds: ["https://www.irishtimes.com/arc/outboundfeeds/rss/"],
    operators: [
      {
        name: "irishtimes.com",
        hosts: ["www.irishtimes.com"],
      },
    ],
    country: "IE",
  },
  {
    id: "rss.irrawaddy-com",
    publisher: "irrawaddy.com",
    feeds: ["https://www.irrawaddy.com/feed"],
    operators: [
      {
        name: "irrawaddy.com",
        hosts: ["www.irrawaddy.com"],
      },
    ],
    country: "MM",
  },
  {
    id: "rss.japantimes-co-jp",
    publisher: "japantimes.co.jp",
    feeds: ["https://www.japantimes.co.jp/feed/"],
    operators: [
      {
        name: "japantimes.co.jp",
        hosts: ["www.japantimes.co.jp"],
      },
    ],
    country: "JP",
  },
  {
    id: "rss.jeuneafrique-com",
    publisher: "jeuneafrique.com",
    feeds: ["https://www.jeuneafrique.com/feed/"],
    operators: [
      {
        name: "jeuneafrique.com",
        hosts: ["www.jeuneafrique.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.jornada-com-mx",
    publisher: "jornada.com.mx",
    feeds: ["https://www.jornada.com.mx/rss/edicion.xml"],
    operators: [
      {
        name: "jornada.com.mx",
        hosts: ["www.jornada.com.mx"],
      },
    ],
    country: "MX",
  },
  {
    id: "rss.jpost-com",
    publisher: "jpost.com",
    feeds: ["https://www.jpost.com/rss/rssfeedsheadlines.aspx"],
    operators: [
      {
        name: "jpost.com",
        hosts: ["www.jpost.com"],
      },
    ],
    country: "IL",
  },
  {
    id: "rss.jutarnji-hr",
    publisher: "jutarnji.hr",
    feeds: ["https://www.jutarnji.hr/feed"],
    operators: [
      {
        name: "jutarnji.hr",
        hosts: ["www.jutarnji.hr"],
      },
    ],
    country: null,
  },
  {
    id: "rss.kathmandupost-com",
    publisher: "kathmandupost.com",
    feeds: ["https://kathmandupost.com/rss"],
    operators: [
      {
        name: "kathmandupost.com",
        hosts: ["kathmandupost.com"],
      },
    ],
    country: "NP",
  },
  {
    id: "rss.krebsonsecurity-com",
    publisher: "krebsonsecurity.com",
    feeds: ["https://krebsonsecurity.com/feed/"],
    operators: [
      {
        name: "krebsonsecurity.com",
        hosts: ["krebsonsecurity.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.lasillavacia-com",
    publisher: "lasillavacia.com",
    feeds: ["https://www.lasillavacia.com/feed/"],
    operators: [
      {
        name: "lasillavacia.com",
        hosts: ["www.lasillavacia.com"],
      },
    ],
    country: "CO",
  },
  {
    id: "rss.latimes-com",
    publisher: "latimes.com",
    feeds: ["https://www.latimes.com/world-nation/rss2.0.xml"],
    operators: [
      {
        name: "latimes.com",
        hosts: ["www.latimes.com"],
      },
    ],
    country: "US",
  },
  {
    id: "rss.lefigaro-fr",
    publisher: "lefigaro.fr",
    feeds: ["https://www.lefigaro.fr/rss/figaro_actualites.xml"],
    operators: [
      {
        name: "lefigaro.fr",
        hosts: ["www.lefigaro.fr"],
      },
    ],
    country: "FR",
  },
  {
    id: "rss.lemonde-fr",
    publisher: "lemonde.fr",
    feeds: ["https://www.lemonde.fr/en/rss/une.xml"],
    operators: [
      {
        name: "lemonde.fr",
        hosts: ["www.lemonde.fr"],
      },
    ],
    country: "FR",
  },
  {
    id: "rss.lighthousereports-com",
    publisher: "lighthousereports.com",
    feeds: ["https://www.lighthousereports.com/feed/"],
    operators: [
      {
        name: "lighthousereports.com",
        hosts: ["www.lighthousereports.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.livemint-com",
    publisher: "livemint.com",
    feeds: ["https://www.livemint.com/rss/news"],
    operators: [
      {
        name: "livemint.com",
        hosts: ["www.livemint.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.lobste-rs",
    publisher: "lobste.rs",
    feeds: ["https://lobste.rs/rss"],
    operators: [
      {
        name: "lobste.rs",
        hosts: ["lobste.rs"],
      },
    ],
    country: null,
  },
  {
    id: "rss.mediapart-fr",
    publisher: "mediapart.fr",
    feeds: ["https://www.mediapart.fr/articles/feed"],
    operators: [
      {
        name: "mediapart.fr",
        hosts: ["www.mediapart.fr"],
      },
    ],
    country: "FR",
  },
  {
    id: "rss.meduza-io",
    publisher: "meduza.io",
    feeds: ["https://meduza.io/rss/en/all"],
    operators: [
      {
        name: "meduza.io",
        hosts: ["meduza.io"],
      },
    ],
    country: "LV",
  },
  {
    id: "rss.middleeasteye-net",
    publisher: "middleeasteye.net",
    feeds: ["https://www.middleeasteye.net/rss"],
    operators: [
      {
        name: "middleeasteye.net",
        hosts: ["www.middleeasteye.net"],
      },
    ],
    country: "GB",
  },
  {
    id: "rss.militarytimes-com",
    publisher: "militarytimes.com",
    feeds: ["https://www.militarytimes.com/arc/outboundfeeds/rss/?outputType=xml"],
    operators: [
      {
        name: "militarytimes.com",
        hosts: ["www.militarytimes.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.mining-technology-com",
    publisher: "mining-technology.com",
    feeds: ["https://www.mining-technology.com/feed/"],
    operators: [
      {
        name: "mining-technology.com",
        hosts: ["www.mining-technology.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.mongabay-com",
    publisher: "mongabay.com",
    feeds: ["https://news.mongabay.com/feed/"],
    operators: [
      {
        name: "mongabay.com",
        hosts: ["news.mongabay.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.n1info-hr",
    publisher: "n1info.hr",
    feeds: ["https://n1info.hr/feed/"],
    operators: [
      {
        name: "n1info.hr",
        hosts: ["n1info.hr"],
      },
    ],
    country: null,
  },
  {
    id: "rss.nature-com",
    publisher: "nature.com",
    feeds: ["https://www.nature.com/nature.rss"],
    operators: [
      {
        name: "nature.com",
        hosts: ["www.nature.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.nbcnews-com",
    publisher: "nbcnews.com",
    feeds: ["https://feeds.nbcnews.com/nbcnews/public/news"],
    operators: [
      {
        name: "nbcnews.com",
        hosts: ["feeds.nbcnews.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.ndtv-via-feedburner",
    publisher: "NDTV",
    feeds: [
      "https://feeds.feedburner.com/ndtvkhabar-latest",
      "https://feeds.feedburner.com/ndtvnews-top-stories",
    ],
    operators: [
      {
        name: "feedburner.com",
        hosts: ["feeds.feedburner.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.newarab-com",
    publisher: "newarab.com",
    feeds: ["https://www.newarab.com/rss"],
    operators: [
      {
        name: "newarab.com",
        hosts: ["www.newarab.com"],
      },
    ],
    country: "GB",
  },
  {
    id: "rss.news18-com",
    publisher: "news18.com",
    feeds: ["https://www.news18.com/rss/india.xml"],
    operators: [
      {
        name: "news18.com",
        hosts: ["www.news18.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.newslaundry-com",
    publisher: "newslaundry.com",
    feeds: ["https://www.newslaundry.com/stories.rss"],
    operators: [
      {
        name: "newslaundry.com",
        hosts: ["www.newslaundry.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.nos-nl",
    publisher: "nos.nl",
    feeds: ["https://feeds.nos.nl/nosnieuwsalgemeen"],
    operators: [
      {
        name: "nos.nl",
        hosts: ["feeds.nos.nl"],
      },
    ],
    country: "NL",
  },
  {
    id: "rss.npr-org",
    publisher: "npr.org",
    feeds: ["https://feeds.npr.org/1001/rss.xml"],
    operators: [
      {
        name: "npr.org",
        hosts: ["feeds.npr.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.nrc-nl",
    publisher: "nrc.nl",
    feeds: ["https://www.nrc.nl/rss/"],
    operators: [
      {
        name: "nrc.nl",
        hosts: ["www.nrc.nl"],
      },
    ],
    country: "NL",
  },
  {
    id: "rss.nrk-no",
    publisher: "nrk.no",
    feeds: ["https://www.nrk.no/toppsaker.rss"],
    operators: [
      {
        name: "nrk.no",
        hosts: ["www.nrk.no"],
      },
    ],
    country: "NO",
  },
  {
    id: "rss.nytimes-com",
    publisher: "nytimes.com",
    feeds: ["https://rss.nytimes.com/services/xml/rss/nyt/World.xml"],
    operators: [
      {
        name: "nytimes.com",
        hosts: ["rss.nytimes.com"],
      },
    ],
    country: "US",
  },
  {
    id: "rss.nzz-ch",
    publisher: "nzz.ch",
    feeds: ["https://www.nzz.ch/recent.rss"],
    operators: [
      {
        name: "nzz.ch",
        hosts: ["www.nzz.ch"],
      },
    ],
    country: "CH",
  },
  {
    id: "rss.occrp-org",
    publisher: "occrp.org",
    feeds: ["https://www.occrp.org/en/feed"],
    operators: [
      {
        name: "occrp.org",
        hosts: ["www.occrp.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.oilprice-com",
    publisher: "oilprice.com",
    feeds: ["https://oilprice.com/rss/main"],
    operators: [
      {
        name: "oilprice.com",
        hosts: ["oilprice.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.omanobserver-om",
    publisher: "omanobserver.om",
    feeds: ["https://www.omanobserver.om/rssFeed/1"],
    operators: [
      {
        name: "omanobserver.om",
        hosts: ["www.omanobserver.om"],
      },
    ],
    country: null,
  },
  {
    id: "rss.optimistdaily-com",
    publisher: "optimistdaily.com",
    feeds: ["https://www.optimistdaily.com/feed/"],
    operators: [
      {
        name: "optimistdaily.com",
        hosts: ["www.optimistdaily.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.oryxspioenkop-com",
    publisher: "oryxspioenkop.com",
    feeds: ["https://www.oryxspioenkop.com/feeds/posts/default?alt=rss"],
    operators: [
      {
        name: "oryxspioenkop.com",
        hosts: ["www.oryxspioenkop.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.pbs-org",
    publisher: "pbs.org",
    feeds: ["https://www.pbs.org/newshour/feeds/rss/headlines"],
    operators: [
      {
        name: "pbs.org",
        hosts: ["www.pbs.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.politico-com",
    publisher: "politico.com",
    feeds: [
      "https://rss.politico.com/politics-news.xml",
      "https://rss.politico.com/technology.xml",
    ],
    operators: [
      {
        name: "politico.com",
        hosts: ["rss.politico.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.portfolio-hu",
    publisher: "portfolio.hu",
    feeds: ["https://portfolio.hu/rss/all.xml"],
    operators: [
      {
        name: "portfolio.hu",
        hosts: ["portfolio.hu", "www.portfolio.hu"],
      },
    ],
    country: null,
  },
  {
    id: "rss.positive-news",
    publisher: "positive.news",
    feeds: ["https://www.positive.news/feed/"],
    operators: [
      {
        name: "positive.news",
        hosts: ["www.positive.news"],
      },
    ],
    country: null,
  },
  {
    id: "rss.premiumtimesng-com",
    publisher: "premiumtimesng.com",
    feeds: ["https://www.premiumtimesng.com/feed"],
    operators: [
      {
        name: "premiumtimesng.com",
        hosts: ["www.premiumtimesng.com"],
      },
    ],
    country: "NG",
  },
  {
    id: "rss.producthunt-com",
    publisher: "producthunt.com",
    feeds: ["https://www.producthunt.com/feed"],
    operators: [
      {
        name: "producthunt.com",
        hosts: ["www.producthunt.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.propublica-org",
    publisher: "propublica.org",
    feeds: ["https://www.propublica.org/feeds/propublica/main"],
    operators: [
      {
        name: "propublica.org",
        hosts: ["www.propublica.org"],
      },
    ],
    country: "US",
  },
  {
    id: "rss.prothomalo-com",
    publisher: "prothomalo.com",
    feeds: ["https://en.prothomalo.com/feed/"],
    operators: [
      {
        name: "prothomalo.com",
        hosts: ["en.prothomalo.com"],
      },
    ],
    country: "BD",
  },
  {
    id: "rss.punchng-com",
    publisher: "punchng.com",
    feeds: ["https://punchng.com/feed/"],
    operators: [
      {
        name: "punchng.com",
        hosts: ["punchng.com", "rss.punchng.com"],
      },
    ],
    country: "NG",
  },
  {
    id: "rss.rappler-com",
    publisher: "rappler.com",
    feeds: ["https://www.rappler.com/feed/"],
    operators: [
      {
        name: "rappler.com",
        hosts: ["www.rappler.com"],
      },
    ],
    country: "PH",
  },
  {
    id: "rss.reasonstobecheerful-world",
    publisher: "reasonstobecheerful.world",
    feeds: ["https://reasonstobecheerful.world/feed/"],
    operators: [
      {
        name: "reasonstobecheerful.world",
        hosts: ["reasonstobecheerful.world"],
      },
    ],
    country: null,
  },
  {
    id: "rss.repubblica-it",
    publisher: "repubblica.it",
    feeds: ["https://www.repubblica.it/rss/homepage/rss2.0.xml"],
    operators: [
      {
        name: "repubblica.it",
        hosts: ["www.repubblica.it"],
      },
    ],
    country: "IT",
  },
  {
    id: "rss.rigzone-com",
    publisher: "rigzone.com",
    feeds: ["https://www.rigzone.com/news/rss/rigzone_latest.aspx"],
    operators: [
      {
        name: "rigzone.com",
        hosts: ["www.rigzone.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.rnz-co-nz",
    publisher: "rnz.co.nz",
    feeds: ["https://www.rnz.co.nz/rss/world.xml"],
    operators: [
      {
        name: "rnz.co.nz",
        hosts: ["www.rnz.co.nz"],
      },
    ],
    country: "NZ",
  },
  {
    id: "rss.rte-ie",
    publisher: "rte.ie",
    feeds: ["https://www.rte.ie/feeds/rss/?index=/news/"],
    operators: [
      {
        name: "rte.ie",
        hosts: ["www.rte.ie"],
      },
    ],
    country: "IE",
  },
  {
    id: "rss.rtve-es",
    publisher: "rtve.es",
    feeds: ["https://api2.rtve.es/rss/temas_noticias.xml"],
    operators: [
      {
        name: "rtve.es",
        hosts: ["api2.rtve.es"],
      },
    ],
    country: "ES",
  },
  {
    id: "rss.sabcnews-com",
    publisher: "sabcnews.com",
    feeds: ["https://www.sabcnews.com/sabcnews/feed/"],
    operators: [
      {
        name: "sabcnews.com",
        hosts: ["www.sabcnews.com"],
      },
    ],
    country: "ZA",
  },
  {
    id: "rss.sbs-com-au",
    publisher: "sbs.com.au",
    feeds: ["https://www.sbs.com.au/news/topic/latest/feed"],
    operators: [
      {
        name: "sbs.com.au",
        hosts: ["www.sbs.com.au"],
      },
    ],
    country: "AU",
  },
  {
    id: "rss.sciencedaily-com",
    publisher: "sciencedaily.com",
    feeds: ["https://www.sciencedaily.com/rss/all.xml"],
    operators: [
      {
        name: "sciencedaily.com",
        hosts: ["www.sciencedaily.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.scmp-com",
    publisher: "scmp.com",
    feeds: ["https://www.scmp.com/rss/91/feed"],
    operators: [
      {
        name: "scmp.com",
        hosts: ["www.scmp.com"],
      },
    ],
    country: "HK",
  },
  {
    id: "rss.scroll-in-via-feedburner",
    publisher: "Scroll.in",
    feeds: ["https://feeds.feedburner.com/ScrollinArticles.rss"],
    operators: [
      {
        name: "feedburner.com",
        hosts: ["feeds.feedburner.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.sec-gov",
    publisher: "sec.gov",
    feeds: ["https://www.sec.gov/news/pressreleases.rss"],
    operators: [
      {
        name: "sec.gov",
        hosts: ["www.sec.gov"],
      },
    ],
    country: null,
  },
  {
    id: "rss.seekingalpha-com",
    publisher: "seekingalpha.com",
    feeds: ["https://seekingalpha.com/market_currents.xml"],
    operators: [
      {
        name: "seekingalpha.com",
        hosts: ["seekingalpha.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.semianalysis-com",
    publisher: "semianalysis.com",
    feeds: ["https://www.semianalysis.com/feed"],
    operators: [
      {
        name: "semianalysis.com",
        hosts: ["semianalysis.com", "www.semianalysis.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.sequoiacap-com",
    publisher: "sequoiacap.com",
    feeds: ["https://www.sequoiacap.com/feed/"],
    operators: [
      {
        name: "framerusercontent.com",
        hosts: ["framerusercontent.com"],
      },
      {
        name: "sequoiacap.com",
        hosts: ["sequoiacap.com", "www.sequoiacap.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.shareable-net",
    publisher: "shareable.net",
    feeds: ["https://www.shareable.net/feed/"],
    operators: [
      {
        name: "shareable.net",
        hosts: ["www.shareable.net"],
      },
    ],
    country: null,
  },
  {
    id: "rss.sifted-eu",
    publisher: "sifted.eu",
    feeds: ["https://sifted.eu/feed"],
    operators: [
      {
        name: "sifted.eu",
        hosts: ["sifted.eu"],
      },
    ],
    country: null,
  },
  {
    id: "rss.singularityhub-com",
    publisher: "singularityhub.com",
    feeds: ["https://singularityhub.com/feed/"],
    operators: [
      {
        name: "singularityhub.com",
        hosts: ["singularityhub.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.sixthtone-com",
    publisher: "sixthtone.com",
    feeds: ["https://www.sixthtone.com/rss"],
    operators: [
      {
        name: "sixthtone.com",
        hosts: ["api.sixthtone.com", "www.sixthtone.com"],
      },
    ],
    country: "CN",
  },
  {
    id: "rss.smh-com-au",
    publisher: "smh.com.au",
    feeds: ["https://www.smh.com.au/rss/feed.xml"],
    operators: [
      {
        name: "smh.com.au",
        hosts: ["www.smh.com.au"],
      },
    ],
    country: "AU",
  },
  {
    id: "rss.snopes-com",
    publisher: "snopes.com",
    feeds: ["https://www.snopes.com/feed/"],
    operators: [
      {
        name: "snopes.com",
        hosts: ["www.snopes.com"],
      },
    ],
    country: "US",
  },
  {
    id: "rss.spiegel-de",
    publisher: "spiegel.de",
    feeds: ["https://www.spiegel.de/international/index.rss"],
    operators: [
      {
        name: "spiegel.de",
        hosts: ["www.spiegel.de"],
      },
    ],
    country: "DE",
  },
  {
    id: "rss.srf-ch",
    publisher: "srf.ch",
    feeds: ["https://www.srf.ch/news/bnf/rss/1646"],
    operators: [
      {
        name: "srf.ch",
        hosts: ["www.srf.ch"],
      },
    ],
    country: "CH",
  },
  {
    id: "rss.standardmedia-co-ke",
    publisher: "standardmedia.co.ke",
    feeds: ["https://www.standardmedia.co.ke/rss/headlines.php"],
    operators: [
      {
        name: "standardmedia.co.ke",
        hosts: ["www.standardmedia.co.ke"],
      },
    ],
    country: "KE",
  },
  {
    id: "rss.straitstimes-com",
    publisher: "straitstimes.com",
    feeds: ["https://www.straitstimes.com/news/world/rss.xml"],
    operators: [
      {
        name: "straitstimes.com",
        hosts: ["www.straitstimes.com"],
      },
    ],
    country: "SG",
  },
  {
    id: "rss.stratechery-com",
    publisher: "stratechery.com",
    feeds: ["https://stratechery.com/feed/"],
    operators: [
      {
        name: "stratechery.com",
        hosts: ["stratechery.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.stuff-co-nz",
    publisher: "stuff.co.nz",
    feeds: ["https://www.stuff.co.nz/rss"],
    operators: [
      {
        name: "stuff.co.nz",
        hosts: ["www.stuff.co.nz"],
      },
    ],
    country: "NZ",
  },
  {
    id: "rss.sueddeutsche-de",
    publisher: "sueddeutsche.de",
    feeds: ["https://rss.sueddeutsche.de/rss/Topthemen"],
    operators: [
      {
        name: "sueddeutsche.de",
        hosts: ["rss.sueddeutsche.de"],
      },
    ],
    country: "DE",
  },
  {
    id: "rss.svt-se",
    publisher: "svt.se",
    feeds: ["https://www.svt.se/nyheter/rss.xml"],
    operators: [
      {
        name: "svt.se",
        hosts: ["www.svt.se"],
      },
    ],
    country: "SE",
  },
  {
    id: "rss.tagesschau-de",
    publisher: "tagesschau.de",
    feeds: ["https://www.tagesschau.de/xml/rss2/"],
    operators: [
      {
        name: "tagesschau.de",
        hosts: ["www.tagesschau.de"],
      },
    ],
    country: "DE",
  },
  {
    id: "rss.taipeitimes-com",
    publisher: "taipeitimes.com",
    feeds: ["https://www.taipeitimes.com/xml/index.rss"],
    operators: [
      {
        name: "taipeitimes.com",
        hosts: ["www.taipeitimes.com"],
      },
    ],
    country: "TW",
  },
  {
    id: "rss.taskandpurpose-com",
    publisher: "taskandpurpose.com",
    feeds: ["https://taskandpurpose.com/feed/"],
    operators: [
      {
        name: "taskandpurpose.com",
        hosts: ["taskandpurpose.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.tech-eu",
    publisher: "tech.eu",
    feeds: ["https://tech.eu/feed/"],
    operators: [
      {
        name: "tech.eu",
        hosts: ["tech.eu"],
      },
    ],
    country: null,
  },
  {
    id: "rss.techcabal-com",
    publisher: "techcabal.com",
    feeds: ["https://techcabal.com/feed/"],
    operators: [
      {
        name: "techcabal.com",
        hosts: ["techcabal.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.techcrunch-com",
    publisher: "techcrunch.com",
    feeds: [
      "https://techcrunch.com/category/startups/feed/",
      "https://techcrunch.com/feed/",
      "https://techcrunch.com/tag/layoffs/feed/",
    ],
    operators: [
      {
        name: "techcrunch.com",
        hosts: ["techcrunch.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.technologyreview-com",
    publisher: "technologyreview.com",
    feeds: [
      "https://www.technologyreview.com/feed/",
      "https://www.technologyreview.com/topic/artificial-intelligence/feed",
    ],
    operators: [
      {
        name: "technologyreview.com",
        hosts: ["www.technologyreview.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.tehrantimes-com",
    publisher: "tehrantimes.com",
    feeds: ["https://www.tehrantimes.com/rss"],
    operators: [
      {
        name: "tehrantimes.com",
        hosts: ["www.tehrantimes.com"],
      },
    ],
    country: "IR",
  },
  {
    id: "rss.telegraph-co-uk",
    publisher: "telegraph.co.uk",
    feeds: ["https://www.telegraph.co.uk/news/rss.xml"],
    operators: [
      {
        name: "telegraph.co.uk",
        hosts: ["www.telegraph.co.uk"],
      },
    ],
    country: "GB",
  },
  {
    id: "rss.telex-hu",
    publisher: "telex.hu",
    feeds: ["https://telex.hu/rss"],
    operators: [
      {
        name: "telex.hu",
        hosts: ["telex.hu"],
      },
    ],
    country: null,
  },
  {
    id: "rss.tempo-co",
    publisher: "tempo.co",
    feeds: ["https://rss.tempo.co/nasional"],
    operators: [
      {
        name: "tempo.co",
        hosts: ["rss.tempo.co"],
      },
    ],
    country: "ID",
  },
  {
    id: "rss.theafricareport-com",
    publisher: "theafricareport.com",
    feeds: ["https://www.theafricareport.com/feed/"],
    operators: [
      {
        name: "theafricareport.com",
        hosts: ["www.theafricareport.com"],
      },
    ],
    country: "FR",
  },
  {
    id: "rss.theage-com-au",
    publisher: "theage.com.au",
    feeds: ["https://www.theage.com.au/rss/feed.xml"],
    operators: [
      {
        name: "theage.com.au",
        hosts: ["www.theage.com.au"],
      },
    ],
    country: "AU",
  },
  {
    id: "rss.thedailystar-net",
    publisher: "thedailystar.net",
    feeds: ["https://www.thedailystar.net/rss.xml"],
    operators: [
      {
        name: "thedailystar.net",
        hosts: ["www.thedailystar.net"],
      },
    ],
    country: "BD",
  },
  {
    id: "rss.thedefiant-io",
    publisher: "thedefiant.io",
    feeds: ["https://thedefiant.io/feed"],
    operators: [
      {
        name: "thedefiant.io",
        hosts: ["thedefiant.io"],
      },
    ],
    country: null,
  },
  {
    id: "rss.thediplomat-com",
    publisher: "thediplomat.com",
    feeds: ["https://thediplomat.com/feed/"],
    operators: [
      {
        name: "thediplomat.com",
        hosts: ["thediplomat.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.theglobeandmail-com",
    publisher: "theglobeandmail.com",
    feeds: ["https://www.theglobeandmail.com/arc/outboundfeeds/rss/category/world/"],
    operators: [
      {
        name: "theglobeandmail.com",
        hosts: ["www.theglobeandmail.com"],
      },
    ],
    country: "CA",
  },
  {
    id: "rss.theguardian-com",
    publisher: "theguardian.com",
    feeds: [
      "https://www.theguardian.com/world/americas/rss",
      "https://www.theguardian.com/world/middleeast/rss",
      "https://www.theguardian.com/world/rss",
    ],
    operators: [
      {
        name: "theguardian.com",
        hosts: ["www.theguardian.com"],
      },
    ],
    country: "GB",
  },
  {
    id: "rss.thehill-com",
    publisher: "thehill.com",
    feeds: ["https://thehill.com/news/feed"],
    operators: [
      {
        name: "thehill.com",
        hosts: ["thehill.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.thehindu-com",
    publisher: "thehindu.com",
    feeds: ["https://www.thehindu.com/feeder/default.rss"],
    operators: [
      {
        name: "thehindu.com",
        hosts: ["www.thehindu.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.thenationalnews-com",
    publisher: "thenationalnews.com",
    feeds: ["https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml"],
    operators: [
      {
        name: "thenationalnews.com",
        hosts: ["www.thenationalnews.com"],
      },
    ],
    country: "AE",
  },
  {
    id: "rss.thenews-com-pk",
    publisher: "thenews.com.pk",
    feeds: ["https://www.thenews.com.pk/rss/1/1"],
    operators: [
      {
        name: "thenews.com.pk",
        hosts: ["www.thenews.com.pk"],
      },
    ],
    country: "PK",
  },
  {
    id: "rss.thenewsminute-com",
    publisher: "thenewsminute.com",
    feeds: ["https://www.thenewsminute.com/feed"],
    operators: [
      {
        name: "thenewsminute.com",
        hosts: ["www.thenewsminute.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.thenewstack-io",
    publisher: "thenewstack.io",
    feeds: ["https://thenewstack.io/feed/"],
    operators: [
      {
        name: "thenewstack.io",
        hosts: ["thenewstack.io"],
      },
    ],
    country: null,
  },
  {
    id: "rss.thequint-com",
    publisher: "thequint.com",
    feeds: ["https://www.thequint.com/stories.rss"],
    operators: [
      {
        name: "thequint.com",
        hosts: ["www.thequint.com"],
      },
    ],
    country: "IN",
  },
  {
    id: "rss.thesentry-org",
    publisher: "thesentry.org",
    feeds: ["https://thesentry.org/feed/"],
    operators: [
      {
        name: "thesentry.org",
        hosts: ["thesentry.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.theverge-com",
    publisher: "theverge.com",
    feeds: [
      "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
      "https://www.theverge.com/rss/index.xml",
    ],
    operators: [
      {
        name: "theverge.com",
        hosts: ["www.theverge.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.timesofisrael-com",
    publisher: "timesofisrael.com",
    feeds: ["https://www.timesofisrael.com/feed/"],
    operators: [
      {
        name: "timesofisrael.com",
        hosts: ["www.timesofisrael.com"],
      },
    ],
    country: "IL",
  },
  {
    id: "rss.trumpstruth-org",
    publisher: "trumpstruth.org",
    feeds: ["https://trumpstruth.org/feed"],
    operators: [
      {
        name: "trumpstruth.org",
        hosts: ["trumpstruth.org", "www.trumpstruth.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.twz-com",
    publisher: "twz.com",
    feeds: ["https://www.twz.com/feed"],
    operators: [
      {
        name: "twz.com",
        hosts: ["www.twz.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.un-org",
    publisher: "un.org",
    feeds: ["https://news.un.org/feed/subscribe/en/news/all/rss.xml"],
    operators: [
      {
        name: "un.org",
        hosts: ["news.un.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.unchainedcrypto-com",
    publisher: "unchainedcrypto.com",
    feeds: ["https://unchainedcrypto.com/feed/"],
    operators: [
      {
        name: "unchainedcrypto.com",
        hosts: ["unchainedcrypto.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.vnexpress-net",
    publisher: "vnexpress.net",
    feeds: ["https://e.vnexpress.net/rss/news.rss"],
    operators: [
      {
        name: "vnexpress.net",
        hosts: ["e.vnexpress.net"],
      },
    ],
    country: "VN",
  },
  {
    id: "rss.voanews-com",
    publisher: "voanews.com",
    feeds: ["https://www.voanews.com/api/epiqq"],
    operators: [
      {
        name: "voanews.com",
        hosts: ["www.voanews.com"],
      },
    ],
    country: "US",
  },
  {
    id: "rss.vrt-be",
    publisher: "vrt.be",
    feeds: ["https://www.vrt.be/vrtnws/nl.rss.articles.xml"],
    operators: [
      {
        name: "vrt.be",
        hosts: ["www.vrt.be"],
      },
    ],
    country: "BE",
  },
  {
    id: "rss.vsquare-org",
    publisher: "vsquare.org",
    feeds: ["https://vsquare.org/feed/"],
    operators: [
      {
        name: "vsquare.org",
        hosts: ["vsquare.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.war-gov",
    publisher: "war.gov",
    feeds: ["https://www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945"],
    operators: [
      {
        name: "war.gov",
        hosts: ["www.war.gov"],
      },
    ],
    country: null,
  },
  {
    id: "rss.warontherocks-com",
    publisher: "warontherocks.com",
    feeds: ["https://warontherocks.com/feed/"],
    operators: [
      {
        name: "warontherocks.com",
        hosts: ["warontherocks.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.whitehouse-gov",
    publisher: "whitehouse.gov",
    feeds: [
      "https://www.whitehouse.gov/briefings-statements/feed/",
      "https://www.whitehouse.gov/presidential-actions/feed/",
    ],
    operators: [
      {
        name: "whitehouse.gov",
        hosts: ["www.whitehouse.gov"],
      },
    ],
    country: null,
  },
  {
    id: "rss.who-int",
    publisher: "who.int",
    feeds: ["https://www.who.int/rss-feeds/news-english.xml"],
    operators: [
      {
        name: "who.int",
        hosts: ["www.who.int"],
      },
    ],
    country: null,
  },
  {
    id: "rss.ycombinator-com",
    publisher: "ycombinator.com",
    feeds: ["https://news.ycombinator.com/rss", "https://www.ycombinator.com/blog/rss/"],
    operators: [
      {
        name: "ycombinator.com",
        hosts: ["news.ycombinator.com", "www.ycombinator.com"],
      },
    ],
    country: null,
  },
  {
    id: "rss.yesmagazine-org",
    publisher: "yesmagazine.org",
    feeds: ["https://www.yesmagazine.org/feed"],
    operators: [
      {
        name: "yesmagazine.org",
        hosts: ["www.yesmagazine.org"],
      },
    ],
    country: null,
  },
  {
    id: "rss.yle-fi",
    publisher: "yle.fi",
    feeds: ["https://feeds.yle.fi/uutiset/v1/majorHeadlines/YLE_UUTISET.rss"],
    operators: [
      {
        name: "yle.fi",
        hosts: ["feeds.yle.fi", "yle.fi"],
      },
    ],
    country: "FI",
  },
];
