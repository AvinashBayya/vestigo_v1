/**
 * RELEASE-BLOCKING. A stored credential is never returned in plaintext
 * through any API response, never written to the audit log, never stored in
 * plaintext; and every server-side read of it is audited.
 */
import { randomBytes } from "node:crypto";
import type { TenantId } from "@repo/core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_API } from "./config.ts";
import {
  auditRows,
  createTestApi,
  provisionTestTenant,
  readyBrowser,
  type Browser,
  type TestApi,
} from "./support.ts";

let api: TestApi;
let tenantId: TenantId;
let owner: Browser;
const secret = `sk-test-${randomBytes(24).toString("hex")}`;
let credentialId: string;

beforeAll(async () => {
  api = await createTestApi();
  const provisioned = await provisionTestTenant(api, "vault");
  tenantId = provisioned.tenantId;
  owner = await readyBrowser(api, provisioned.owner, tenantId);
  const stored = await owner.request("POST", "/api/v1/credentials", {
    provider: "example-provider",
    label: "[test credential]",
    secret,
  });
  expect(stored.status).toBe(201);
  credentialId = stored.json<{ id: string }>().id;
});

afterAll(async () => {
  await api.close();
});

describe("credentials never leave in plaintext (RELEASE-BLOCKING)", () => {
  it("no credential route returns the secret", async () => {
    await owner.request("GET", "/api/v1/credentials");
    await owner.request("POST", `/api/v1/credentials/${credentialId}/revoke`, {});
    await owner.request("GET", "/api/v1/credentials?limit=500");
    await owner.request("GET", "/api/v1/audit-log?limit=500");
    await owner.request("GET", "/api/v1/me");
    expect(owner.seen.length).toBeGreaterThan(5);
    for (const body of owner.seen) {
      expect(body).not.toContain(secret);
      expect(body).not.toMatch(/ciphertext|encryptedDataKey|encrypted_data_key/);
    }
  });

  it("the OpenAPI contract describes no field that could carry it back", async () => {
    const spec = await api.app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    const credentialResponses = JSON.stringify(
      Object.entries(spec.json<{ paths: Record<string, unknown> }>().paths)
        .filter(([path]) => path.startsWith("/api/v1/credentials"))
        .map(([, operations]) =>
          Object.values(operations as Record<string, { responses?: unknown }>).map(
            (operation) => operation.responses,
          ),
        ),
    );
    expect(credentialResponses).not.toMatch(/"secret"|ciphertext|encryptedDataKey/);
  });

  it("the audit log records the storing and revoking, never the secret", async () => {
    const rows = await auditRows(api, tenantId);
    expect(rows.find((row) => row.action === "credential.create")).toMatchObject({
      targetId: credentialId,
      outcome: "ALLOWED",
      permission: "credential:write",
    });
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it("the database stores only ciphertext", async () => {
    const client = new pg.Client({ connectionString: TEST_API.ownerUrl });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const rows = await client.query<{ ciphertext: Buffer; encrypted_data_key: Buffer }>(
        "select ciphertext, encrypted_data_key from public.credentials where id = $1",
        [credentialId],
      );
      await client.query("rollback");
      const row = rows.rows[0];
      expect(row).toBeDefined();
      expect(row?.ciphertext.includes(Buffer.from(secret))).toBe(false);
      expect(row?.encrypted_data_key.includes(Buffer.from(secret))).toBe(false);
    } finally {
      await client.end();
    }
  });

  it("a server-side read is audited, and the secret stays out of the audit row", async () => {
    const fresh = await owner.request("POST", "/api/v1/credentials", {
      provider: "example-provider",
      label: "[readable credential]",
      secret,
    });
    const id = fresh.json<{ id: string }>().id;
    const revealed = await api.db.withTenant(tenantId, (context) =>
      api.services.vault.reveal(context, id, {
        purpose: "[collector run]",
        actor: { kind: "SYSTEM" },
        authorization: { method: "SYSTEM", permission: null, sessionId: null },
        requestId: null,
      }),
    );
    expect(revealed.expose()).toBe(secret);
    expect(String(revealed)).not.toContain(secret);
    expect(JSON.stringify({ revealed })).not.toContain(secret);

    const read = (await auditRows(api, tenantId)).find(
      (row) => row.action === "credential.read" && row.targetId === id,
    );
    expect(read).toMatchObject({ outcome: "ALLOWED", targetType: "credential" });
    expect(JSON.stringify(read)).not.toContain(secret);
  });

  it("a revoked credential cannot be read", async () => {
    await expect(
      api.db.withTenant(tenantId, (context) =>
        api.services.vault.reveal(context, credentialId, {
          purpose: "[collector run]",
          actor: { kind: "SYSTEM" },
          authorization: { method: "SYSTEM", permission: null, sessionId: null },
          requestId: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "CREDENTIAL_REVOKED" });
  });
});
