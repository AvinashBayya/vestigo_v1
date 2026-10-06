/**
 * GET /api/v1/collectors: the registry's declarations, exactly as the
 * registry holds them, behind the same access check as reading a run.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  Browser,
  createTestApi,
  joinAs,
  provisionTestTenant,
  readyBrowser,
  type TestApi,
} from "./support.ts";

interface CollectorList {
  unverifiedSourcesAllowed: boolean;
  items: {
    id: string;
    label: string;
    discipline: string;
    collectionMode: string;
    targetTypes: string[];
    credentials: { vaultIds: string[]; runsWithout: boolean };
    availability: string;
    availabilityReason: string | null;
  }[];
}

let api: TestApi;
let owner: Browser;
let viewer: Browser;

beforeAll(async () => {
  api = await createTestApi();
  const provisioned = await provisionTestTenant(api, "collectors");
  owner = await readyBrowser(api, provisioned.owner, provisioned.tenantId);
  viewer = await joinAs(api, owner, provisioned.tenantId, "viewer", "collectors-viewer");
});

afterAll(async () => {
  await api.close();
});

describe("the collector list", () => {
  it("is the registry's declarations, entry for entry, with the deployment's rule on unverified sources", async () => {
    const response = await owner.request("GET", "/api/v1/collectors");
    expect(response.status).toBe(200);
    const list = response.json<CollectorList>();
    expect(list.unverifiedSourcesAllowed).toBe(api.services.runs.unverifiedSourcesAllowed);

    const registry = api.services.runs.registry.list();
    expect(list.items.map((item) => item.id)).toEqual(registry.map((entry) => entry.id));
    for (const entry of registry) {
      const item = list.items.find((candidate) => candidate.id === entry.id);
      expect(item).toMatchObject({
        label: entry.label,
        discipline: entry.discipline,
        collectionMode: entry.collectionMode,
        targetTypes: [...entry.targetTypes],
        credentials: {
          vaultIds: [...entry.credentials.vaultIds],
          runsWithout: entry.credentials.runsWithout,
        },
        availability: entry.availability,
        availabilityReason: entry.availabilityReason,
      });
    }
    // A collector that is not available always says why; one that is never invents a reason.
    for (const item of list.items) {
      expect(item.availabilityReason === null).toBe(item.availability === "AVAILABLE");
    }
  });

  it("is readable by anyone who can read runs, and by no one signed out", async () => {
    expect((await viewer.request("GET", "/api/v1/collectors")).status).toBe(200);
    expect((await new Browser(api).request("GET", "/api/v1/collectors")).status).toBe(401);
  });
});
