/**
 * The platform catalogue and the registry's rules. Catalogue verdicts are
 * product decisions; these tests pin the ones the Phase 3A brief requires, and
 * the rules that keep every verdict honest.
 */
import { NotImplementedError } from "@repo/core";
import { describe, expect, it } from "vitest";
import {
  CollectorDefinitionError,
  CollectorRegistry,
  declareCollector,
  defineCollector,
  PLATFORM_SOURCES,
  validateSource,
  type CollectorDeclaration,
} from "../src/index.ts";
import { NAMES_SCHEMA, testSource } from "./support.ts";

const declaration = (
  overrides: Partial<CollectorDeclaration<typeof NAMES_SCHEMA>> = {},
): CollectorDeclaration<typeof NAMES_SCHEMA> => ({
  id: "fake.one",
  version: "1.0.0",
  displayName: "[Fake one]",
  discipline: "TECHINT",
  targetTypes: ["DOMAIN"],
  collectionMode: "PASSIVE_API",
  source: "one",
  credentials: { vaultIds: [], runsWithout: true },
  claimStrength: "REPORTED",
  timeoutMs: 5_000,
  resultSchema: NAMES_SCHEMA,
  ...overrides,
});

const never = () => expect.fail("a registry test never runs a collector");

describe("the platform catalogue", () => {
  it("validates as a whole, with unique ids", () => {
    for (const source of PLATFORM_SOURCES)
      expect(() => {
        validateSource(source);
      }).not.toThrow();
    const ids = PLATFORM_SOURCES.map((source) => source.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      () => new CollectorRegistry({ sources: PLATFORM_SOURCES, collectors: [] }),
    ).not.toThrow();
  });

  it("blocks every source the Phase 3A brief names", () => {
    const blocked = PLATFORM_SOURCES.filter((s) => s.licence.commercialUse === "BLOCKED").map(
      (s) => s.id,
    );
    expect(blocked).toEqual(
      expect.arrayContaining([
        "shodan-internetdb",
        "c2intelfeeds",
        "insightface-buffalo-l",
        "youtube-innertube",
        "youtube-ytdlp",
        "duckduckgo-html",
        "local-network-scan",
        "google-news-rss",
        "hackertarget",
        "alienvault-otx",
        "ucdp",
        "reliefweb",
        "opensky",
      ]),
    );
  });

  it("permits only sources whose terms were read, and says where", () => {
    for (const source of PLATFORM_SOURCES.filter((s) => s.licence.commercialUse === "PERMITTED")) {
      expect(source.licence.check?.sourceUrl, source.id).toMatch(/^https:\/\//);
      expect(source.licence.check?.recordedIn, source.id).toMatch(/\S/);
    }
  });

  it("reaches every networked platform source over https only", () => {
    for (const source of PLATFORM_SOURCES) {
      if (source.network !== null) expect(source.network.protocol, source.id).toBe("https");
    }
  });

  it("declares GDELT's one-request-per-five-seconds limit, and the attribution GDELT and HIBP require", () => {
    const byId = new Map(PLATFORM_SOURCES.map((source) => [source.id, source]));
    expect(byId.get("gdelt-doc")?.network?.rateLimit).toMatchObject({
      requests: 1,
      intervalSeconds: 5,
      basis: "UPSTREAM_STATED",
    });
    expect(byId.get("gdelt-doc")?.attribution?.url).toMatch(/^https:\/\/www\.gdeltproject\.org/);
    expect(byId.get("hibp")?.attribution?.url).toMatch(/^https:\/\/haveibeenpwned\.com/);
  });
});

describe("source rules", () => {
  it.each([
    [
      "PERMITTED with no check",
      { licence: { commercialUse: "PERMITTED", reason: "[x]", check: null } },
    ],
    [
      "PERMITTED without the terms URL",
      {
        licence: {
          commercialUse: "PERMITTED",
          reason: "[x]",
          check: { checkedOn: "2026-09-28", sourceUrl: null, recordedIn: "[x]" },
        },
      },
    ],
    [
      "BLOCKED with no record",
      { licence: { commercialUse: "BLOCKED", reason: "[x]", check: null } },
    ],
    [
      "an impossible date",
      {
        licence: {
          commercialUse: "BLOCKED",
          reason: "[x]",
          check: { checkedOn: "2026-02-30", sourceUrl: null, recordedIn: "[x]" },
        },
      },
    ],
  ] as const)("refuses %s", (_label, overrides) => {
    expect(() => {
      validateSource(testSource("bad", overrides));
    }).toThrow(CollectorDefinitionError);
  });

  it.each([
    "127.0.0.1",
    "169.254.169.254",
    "localhost",
    "metadata.google.internal",
    "printer.local",
    "API.example.com",
  ])("refuses to declare %s as a host", (host) => {
    const network = {
      protocol: "https",
      hosts: [host],
      rateLimit: { requests: 1, intervalSeconds: 1, basis: "SELF_IMPOSED", note: "[x]" },
    } as const;
    expect(() => {
      validateSource(testSource("bad", { network }));
    }).toThrow(CollectorDefinitionError);
  });
});

describe("the registry", () => {
  const sources = [
    testSource("one"),
    testSource("two"),
    testSource("blocked", {
      licence: {
        commercialUse: "BLOCKED",
        reason: "[non-commercial licence]",
        check: { checkedOn: "2026-09-28", sourceUrl: null, recordedIn: "[test]" },
      },
    }),
  ];

  it("lists BLOCKED and unimplemented collectors, each with its reason", () => {
    const registry = new CollectorRegistry({
      sources,
      collectors: [
        defineCollector(declaration(), never),
        defineCollector(
          declaration({ id: "fake.blocked", displayName: "[Fake blocked]", source: "blocked" }),
          never,
        ),
        declareCollector(
          declaration({ id: "fake.later", displayName: "[Fake later]", source: "two" }),
        ),
      ],
    });
    const listed = new Map(registry.list().map((entry) => [entry.id, entry]));
    expect(listed.get("fake.one")).toMatchObject({
      availability: "AVAILABLE",
      availabilityReason: null,
    });
    expect(listed.get("fake.blocked")).toMatchObject({
      availability: "BLOCKED",
      availabilityReason: expect.stringContaining("[non-commercial licence]") as unknown,
      commercialUse: "BLOCKED",
    });
    expect(listed.get("fake.later")?.availability).toBe("NOT_IMPLEMENTED");
  });

  it("takes each collector's label from its registry entry, and refuses two collectors with the same label", () => {
    const registry = new CollectorRegistry({
      sources,
      collectors: [defineCollector(declaration(), never)],
    });
    expect(registry.entry("fake.one").label).toBe("[Fake one]");
    expect(
      () =>
        new CollectorRegistry({
          sources,
          collectors: [
            defineCollector(declaration(), never),
            defineCollector(
              declaration({ id: "fake.two", source: "two", displayName: "[FAKE ONE]" }),
              never,
            ),
          ],
        }),
    ).toThrow(CollectorDefinitionError);
  });

  it.each([
    ["a duplicate id", [declaration(), declaration({ displayName: "[Other]" })]],
    ["an unknown source", [declaration({ source: "nowhere" })]],
    ["no target types", [declaration({ targetTypes: [] })]],
    ["a bad version", [declaration({ version: "one" })]],
    ["no run budget", [declaration({ timeoutMs: 0 })]],
    [
      "credentials required but none named",
      [declaration({ credentials: { vaultIds: [], runsWithout: false } })],
    ],
    ["a network collector on an offline source", [declaration({ source: "offline" })]],
  ])("refuses %s", (_label, declarations) => {
    expect(
      () =>
        new CollectorRegistry({
          sources: [...sources, testSource("offline", { network: null })],
          collectors: declarations.map((d) => defineCollector(d, never)),
        }),
    ).toThrow(CollectorDefinitionError);
  });

  it("refuses to run a LOCAL_ANALYSIS collector until its evidence basis exists (Phase 3B)", () => {
    expect(
      () =>
        new CollectorRegistry({
          sources: [testSource("offline", { network: null })],
          collectors: [
            defineCollector(
              declaration({ source: "offline", collectionMode: "LOCAL_ANALYSIS" }),
              never,
            ),
          ],
        }),
    ).toThrow(NotImplementedError);
  });

  it("exposes the attribution a report must render", () => {
    const attributed = testSource("one", {
      attribution: { text: "[Cite us]", url: "https://example.com/" },
    });
    const registry = new CollectorRegistry({
      sources: [attributed],
      collectors: [defineCollector(declaration(), never)],
    });
    expect(registry.attributionFor("fake.one")).toEqual({
      text: "[Cite us]",
      url: "https://example.com/",
    });
  });
});
