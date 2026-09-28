import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTenantId } from "@repo/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  contentRef,
  ContentIntegrityError,
  ContentNotFoundError,
  FileSystemContentStore,
  hashContent,
  InvalidContentHashError,
} from "../src/content-store.ts";

const tenantA = parseTenantId(randomUUID());
const tenantB = parseTenantId(randomUUID());
const payload = new TextEncoder().encode("[raw payload]");

let root = "";
let store: FileSystemContentStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "content-store-"));
  store = new FileSystemContentStore(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("content-addressed store", () => {
  it("keys content by its sha256", async () => {
    const stored = await store.put(tenantA, payload);
    expect(stored.contentHash).toBe(hashContent(payload));
    expect(stored.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(stored.ref).toBe(contentRef(tenantA, stored.contentHash));
    expect(stored.byteLength).toBe(payload.byteLength);
  });

  it("does not duplicate content that is collected again", async () => {
    const first = await store.put(tenantA, payload);
    const again = await store.put(tenantA, new Uint8Array(payload));
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.ref).toBe(first.ref);
    expect(await filesUnder(root)).toHaveLength(1);
  });

  it("keeps each tenant's content separate, so deleting a tenant removes its payloads", async () => {
    const a = await store.put(tenantA, payload);
    const b = await store.put(tenantB, payload);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.ref).not.toBe(b.ref);
    expect(await store.has(tenantB, a.contentHash)).toBe(true);
    await rm(join(root, "tenants", tenantA), { recursive: true });
    expect(await store.has(tenantA, a.contentHash)).toBe(false);
    expect(await store.get(tenantB, b.contentHash)).toEqual(payload);
  });

  it("returns the stored bytes", async () => {
    const stored = await store.put(tenantA, payload);
    expect(await store.get(tenantA, stored.contentHash)).toEqual(payload);
  });

  it("refuses content that no longer matches its hash", async () => {
    const stored = await store.put(tenantA, payload);
    await writeFile(join(root, stored.ref), "[tampered]");
    await expect(store.get(tenantA, stored.contentHash)).rejects.toBeInstanceOf(
      ContentIntegrityError,
    );
    await expect(store.put(tenantA, payload)).rejects.toBeInstanceOf(ContentIntegrityError);
  });

  it("reports missing content as missing, not as empty", async () => {
    await expect(store.get(tenantA, hashContent(payload))).rejects.toBeInstanceOf(
      ContentNotFoundError,
    );
  });

  it.each(["sha256:../../etc/passwd", "md5:abc", "sha256:ABC", ""])(
    "rejects a malformed hash %j instead of building a path from it",
    async (hash) => {
      await expect(store.get(tenantA, hash)).rejects.toBeInstanceOf(InvalidContentHashError);
    },
  );
});
