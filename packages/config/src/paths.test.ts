import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveContentStoreDir } from "./paths.ts";

/** This package's checkout: the repository root sits two levels up. */
const ROOT = resolve(import.meta.dirname, "..", "..", "..");

describe("resolving CONTENT_STORE_DIR", () => {
  let outside: string;
  beforeAll(async () => {
    outside = await mkdtemp(join(tmpdir(), "content-store-dir-"));
  });
  afterAll(async () => {
    await rm(outside, { recursive: true, force: true });
  });

  it("REGRESSION: resolves a relative path from the repository root, from any app directory", () => {
    const fromApi = resolveContentStoreDir("./data/content-store", join(ROOT, "apps", "api"));
    const fromWorker = resolveContentStoreDir("./data/content-store", join(ROOT, "apps", "worker"));
    expect(fromApi).toBe(join(ROOT, "data", "content-store"));
    expect(fromWorker).toBe(fromApi);
  });

  it("uses an absolute path as given", () => {
    expect(resolveContentStoreDir(outside, join(ROOT, "apps", "api"))).toBe(outside);
  });

  it("resolves from the working directory outside a checkout", () => {
    expect(resolveContentStoreDir("store", outside)).toBe(join(outside, "store"));
  });
});
