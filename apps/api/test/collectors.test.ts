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

type Runnability =
  | { runsVia: string[]; refusal: null; reason: null }
  | { runsVia: null; refusal: string; reason: string };

interface AccessMethodView {
  kind: string;
  enabled: boolean;
  licenceVerdict: string;
  runnable: boolean;
}

interface CollectorList {
  unverifiedSourcesAllowed: boolean;
  accessMethodsEnabled: string[];
  sources: ({
    id: string;
    label: string;
    methods: AccessMethodView[];
    licenceVerdict: string;
    enabled: boolean;
  } & Runnability)[];
  items: {
    id: string;
    label: string;
    discipline: string;
    collectionMode: string;
    targetTypes: string[];
    credentials: { vaultIds: string[]; runsWithout: boolean };
    availability: string;
    availabilityReason: string | null;
    sourceId: string;
    access: { methods: AccessMethodView[] } & Runnability;
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
  it("is the registry's declarations, entry for entry, with whether each can run here", async () => {
    const response = await owner.request("GET", "/api/v1/collectors");
    expect(response.status).toBe(200);
    const list = response.json<CollectorList>();
    // Retired: an UNVERIFIED source never runs, so this can only say false.
    expect(list.unverifiedSourcesAllowed).toBe(false);
    expect(list.accessMethodsEnabled).toEqual(["open", "official", "licensed"]);

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
    // Each says whether it can run here, as the planner decides it.
    for (const entry of registry) {
      const item = list.items.find((candidate) => candidate.id === entry.id);
      expect(item?.sourceId).toBe(entry.source.id);
      const access = api.services.runs.planner.access(entry.id);
      expect(item?.access).toEqual({
        methods: access.methods,
        ...(access.runsVia === null
          ? { runsVia: null, refusal: access.refusal, reason: access.reason }
          : { runsVia: access.runsVia, refusal: null, reason: null }),
      });
    }
  });

  it("says null, with why, for a collector or source with no method that can run here: never 0, never an empty list (RELEASE-BLOCKING, acceptance c)", async () => {
    const list = (await owner.request("GET", "/api/v1/collectors")).json<CollectorList>();
    const crtsh = list.items.find((item) => item.id === "crtsh");
    expect(crtsh?.availability).toBe("UNVERIFIED");
    expect(crtsh?.access).toMatchObject({
      runsVia: null,
      refusal: "UNVERIFIED_SOURCE_NOT_ALLOWED",
      reason: expect.stringContaining("an unverified source never runs") as unknown,
    });
    for (const item of list.items) {
      if (item.access.runsVia === null) {
        expect(item.access.reason.trim().length, item.id).toBeGreaterThan(0);
      } else {
        expect(item.access.runsVia.length, item.id).toBeGreaterThan(0);
      }
    }
    for (const source of list.sources) {
      expect(source.enabled, source.id).toBe(source.runsVia !== null);
      if (source.runsVia === null)
        expect(source.reason.trim().length, source.id).toBeGreaterThan(0);
    }
    const said = JSON.stringify(list);
    expect(said).not.toContain('"runsVia":[]');
    expect(said).not.toContain('"runsVia":0');
    // GDELT's DOC API, the first source on the seam: open, PERMITTED, running here.
    expect(list.sources.find((source) => source.id === "gdelt-doc")).toEqual({
      id: "gdelt-doc",
      label: "GDELT DOC 2.0 API",
      methods: [{ kind: "open", enabled: true, licenceVerdict: "PERMITTED", runnable: true }],
      licenceVerdict: "PERMITTED",
      enabled: true,
      runsVia: ["open"],
      refusal: null,
      reason: null,
    });
    expect(list.items.find((item) => item.id === "news")?.access.runsVia).toEqual(["open"]);
  });

  it("is readable by anyone who can read runs, and by no one signed out", async () => {
    expect((await viewer.request("GET", "/api/v1/collectors")).status).toBe(200);
    expect((await new Browser(api).request("GET", "/api/v1/collectors")).status).toBe(401);
  });
});
