/**
 * POST /api/v1/estimates: the vault ids an estimate lists for a planned
 * collector are the ones a run would read, those of a keyed access method
 * enabled in this deployment, and it runs without them only if open is
 * enabled (access methods, 2026-10-16).
 */
import {
  CollectorRegistry,
  defineCollector,
  type AccessMethod,
  type SourceDeclaration,
} from "@repo/collectors";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestApi, provisionTestTenant, readyBrowser, type TestApi } from "./support.ts";

/** Open, or with a tenant key for more: test code only. */
const KEYED_SOURCE: SourceDeclaration = {
  id: "keyed-test",
  name: "[Keyed test source]",
  access: ["open", "official"],
  licence: {
    commercialUse: "PERMITTED",
    reason: "[test source]",
    check: {
      checkedOn: "2026-10-16",
      sourceUrl: "https://example.com/terms",
      recordedIn: "[test]",
    },
  },
  network: {
    protocol: "https",
    hosts: ["keyed.example"],
    rateLimit: { requests: 1, intervalSeconds: 1, basis: "SELF_IMPOSED", note: "[test]" },
    operators: [{ name: "fake", hosts: ["keyed.example"] }],
  },
  attribution: null,
};

const registry = new CollectorRegistry({
  sources: [KEYED_SOURCE],
  collectors: [
    defineCollector(
      {
        id: "fake.keyed",
        version: "1.0.0",
        displayName: "[fake keyed]",
        discipline: "TECHINT",
        targetTypes: ["DOMAIN"],
        collectionMode: "PASSIVE_API",
        source: "keyed-test",
        credentials: { vaultIds: ["keyed-key"], runsWithout: true },
        claimStrength: "REPORTED",
        timeoutMs: 1_000,
        resultSchema: z.object({ derived: z.object({}) }),
      },
      () => Promise.reject(new Error("[test] an estimate never runs a collector")),
    ),
  ],
});

const apis: TestApi[] = [];

afterAll(async () => {
  await Promise.all(apis.map((api) => api.close()));
});

async function estimatedCredentials(
  accessMethods: readonly AccessMethod[] | undefined,
  tag: string,
): Promise<unknown> {
  const api = await createTestApi({
    registry,
    ...(accessMethods === undefined ? {} : { accessMethods }),
  });
  apis.push(api);
  const provisioned = await provisionTestTenant(api, tag);
  const owner = await readyBrowser(api, provisioned.owner, provisioned.tenantId);
  const response = await owner.request("POST", "/api/v1/estimates", { target: "example.com" });
  expect(response.status).toBe(200);
  const estimate = response.json<{
    collectors: { collectorId: string; credentials: unknown }[];
  }>();
  return estimate.collectors.find((collector) => collector.collectorId === "fake.keyed")
    ?.credentials;
}

describe("the estimate's vault ids are the ones a run would read", () => {
  it("lists the key only while a keyed method is enabled, and says it runs without one only while open is", async () => {
    expect(await estimatedCredentials(undefined, "estimate-default")).toEqual({
      vaultIds: ["keyed-key"],
      runsWithout: true,
    });
    // Official off: the run would read no key, and runs open.
    expect(await estimatedCredentials(["open"], "estimate-open")).toEqual({
      vaultIds: [],
      runsWithout: true,
    });
    // Open off: the run reads the key, and does not run without it.
    expect(await estimatedCredentials(["official"], "estimate-official")).toEqual({
      vaultIds: ["keyed-key"],
      runsWithout: false,
    });
  });
});
