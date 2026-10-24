/**
 * The platform test harness and the recorded data it relies on: fixtures carry
 * provenance and name only declared hosts, https platform sources run
 * through it with every production check, and the RDAP host list is exactly
 * the recorded IANA bootstrap snapshot.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { RDAP_REGISTRY_HOSTS } from "../../src/data/rdap-registry-hosts.ts";
import {
  COLLECTOR_USER_AGENT,
  defineCollector,
  forbiddenPlatformDomainOf,
  PLATFORM_COLLECTORS,
  PLATFORM_SOURCES,
  type Collector,
} from "../../src/index.ts";
import { allFixturePaths, FIXTURE, startHarness, type Fixture, type Harness } from "./harness.ts";

const DECLARED = new Set(PLATFORM_SOURCES.flatMap((source) => source.network?.hosts ?? []));
// A collector whose source is open-host names no static host: its fixtures name
// the host the authorised target would (the host comes from the target, not a
// declared list), so they are exempt from the declared-host check — but still
// never a platform that is never contacted (CLAUDE.md §3).
const OPEN_HOST_SOURCES = new Set(
  PLATFORM_SOURCES.filter((source) => source.network?.openHost === true).map((source) => source.id),
);
const OPEN_HOST_COLLECTORS = new Set(
  PLATFORM_COLLECTORS.filter((collector) =>
    OPEN_HOST_SOURCES.has(collector.declaration.source),
  ).map((collector) => collector.declaration.id),
);

describe("fixtures", () => {
  it("every fixture file has a valid shape and says where it came from", () => {
    for (const path of allFixturePaths()) {
      const parsed = FIXTURE.safeParse(JSON.parse(readFileSync(path, "utf8")));
      expect(parsed.success, path).toBe(true);
      if (!parsed.success) continue;
      const host = parsed.data.request.host;
      if (OPEN_HOST_COLLECTORS.has(basename(dirname(path)))) {
        expect(forbiddenPlatformDomainOf(host), path).toBeNull();
      } else {
        expect(DECLARED.has(host), path).toBe(true);
      }
    }
  });
});

describe("the RDAP registry hosts", () => {
  it("are exactly the https hosts in the recorded IANA bootstrap snapshot", () => {
    const snapshot = z
      .object({
        publication: z.string(),
        services: z.array(z.tuple([z.array(z.string()), z.array(z.string())])),
      })
      .parse(
        JSON.parse(
          readFileSync(join(import.meta.dirname, "..", "snapshots", "iana-rdap-dns.json"), "utf8"),
        ),
      );
    const https = new Set<string>();
    for (const [, urls] of snapshot.services) {
      for (const url of urls) {
        const parsed = new URL(url);
        if (parsed.protocol === "https:") https.add(parsed.hostname);
      }
    }
    expect([...RDAP_REGISTRY_HOSTS].sort()).toEqual([...https].sort());
    const rdap = PLATFORM_SOURCES.find((source) => source.id === "rdap");
    expect(rdap?.network?.hosts).toEqual(["rdap.org", ...RDAP_REGISTRY_HOSTS]);
  });
});

describe("the harness", () => {
  const SMOKE = z.object({ body: z.string().min(1), derived: z.object({}) });
  const smoke: Collector = defineCollector(
    {
      id: "test.harness-smoke",
      version: "0.0.1",
      displayName: "[Harness smoke test via crt.sh]",
      discipline: "TECHINT",
      targetTypes: ["DOMAIN"],
      collectionMode: "PASSIVE_API",
      source: "crtsh",
      credentials: { vaultIds: [], runsWithout: true },
      claimStrength: "REPORTED",
      timeoutMs: 5_000,
      resultSchema: SMOKE,
    },
    async (ctx) => {
      const response = await ctx.fetch(`https://crt.sh/?q=${ctx.target.value}`, {
        method: "GET",
        timeoutMs: 2_000,
      });
      return ctx.found({ body: response.text(), derived: {} }, [{ response, observedAt: null }]);
    },
  );
  const fixture: Fixture = {
    provenance: {
      kind: "synthetic",
      source: "https://crt.sh/",
      recordedOn: "2026-09-28",
      notes: "Harness smoke test only; not a crt.sh response shape.",
    },
    request: { host: "crt.sh", path: "/?q=example.com" },
    response: { status: 200, headers: { "content-type": "text/plain" }, body: "[fixture body]" },
  };
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness({ collectors: [smoke], fixtures: [fixture] });
  });

  afterAll(async () => {
    await harness.close();
  });

  it("runs an https platform source through every production check, offline", async () => {
    const outcome = await harness.run("test.harness-smoke", {
      type: "DOMAIN",
      value: "example.com",
    });
    expect(outcome.status).toBe("FOUND");
    expect(harness.unmatched).toEqual([]);
    expect(harness.requests.map((r) => [r.host, r.path, r.headers["user-agent"]])).toEqual([
      ["crt.sh", "/?q=example.com", COLLECTOR_USER_AGENT],
    ]);
  });
});
