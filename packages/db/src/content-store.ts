import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { AppError, parseTenantId, type TenantId } from "@repo/core";

/** `sha256:<64 lowercase hex>`, the form stored in evidence.content_hash. */
export type ContentHash = `sha256:${string}`;

const HASH = /^sha256:[0-9a-f]{64}$/;

export class ContentIntegrityError extends AppError {
  readonly code = "CONTENT_INTEGRITY_FAILED";

  constructor(ref: string) {
    super(`Stored content at ${ref} no longer matches its hash.`);
    this.name = "ContentIntegrityError";
  }
}

export class ContentNotFoundError extends AppError {
  readonly code = "CONTENT_NOT_FOUND";

  constructor(ref: string) {
    super(`No stored content at ${ref}.`);
    this.name = "ContentNotFoundError";
  }
}

export class InvalidContentHashError extends AppError {
  readonly code = "CONTENT_HASH_INVALID";

  constructor() {
    super("A content hash must be `sha256:` followed by 64 lowercase hex digits.");
    this.name = "InvalidContentHashError";
  }
}

export interface StoredContent {
  readonly contentHash: ContentHash;
  /** Storage key; this is what evidence.payload_ref records. */
  readonly ref: string;
  readonly byteLength: number;
  /** False when identical content was already stored for this tenant. */
  readonly created: boolean;
}

export function hashContent(bytes: Uint8Array): ContentHash {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function requireHash(contentHash: string): ContentHash {
  if (!HASH.test(contentHash)) throw new InvalidContentHashError();
  return contentHash as ContentHash;
}

/**
 * The key for a tenant's content. Keys are namespaced by tenant: content is
 * never shared across tenants, so storing it reveals nothing about what
 * another tenant holds, and deleting a tenant removes all of its payloads.
 */
export function contentRef(tenantId: TenantId, contentHash: string): string {
  const hex = requireHash(contentHash).slice("sha256:".length);
  return `tenants/${parseTenantId(tenantId)}/sha256/${hex.slice(0, 2)}/${hex.slice(2, 4)}/${hex}`;
}

/**
 * Content-addressed storage for raw payloads. Storing the same bytes twice for
 * a tenant writes them once; every read re-hashes and refuses content that no
 * longer matches its key.
 */
export interface ContentStore {
  put(tenantId: TenantId, bytes: Uint8Array): Promise<StoredContent>;
  get(tenantId: TenantId, contentHash: string): Promise<Uint8Array>;
  has(tenantId: TenantId, contentHash: string): Promise<boolean>;
}

/**
 * Filesystem backend for local development and tests. Production uses an
 * S3-compatible store behind the same interface (ARCHITECTURE-DECISIONS §10);
 * that backend is not built yet.
 */
export class FileSystemContentStore implements ContentStore {
  readonly #root: string;

  constructor(rootDirectory: string) {
    this.#root = rootDirectory;
  }

  async put(tenantId: TenantId, bytes: Uint8Array): Promise<StoredContent> {
    const contentHash = hashContent(bytes);
    const ref = contentRef(tenantId, contentHash);
    const path = join(this.#root, ref);
    const stored = { contentHash, ref, byteLength: bytes.byteLength };

    if (await this.#exists(path)) {
      await this.#verified(path, contentHash, ref);
      return { ...stored, created: false };
    }

    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
    await writeFile(temporary, bytes, { flag: "wx" });
    try {
      await rename(temporary, path);
    } catch (error) {
      // Another writer stored the same content first: identical bytes by
      // definition, so keep theirs, after checking it.
      await rm(temporary, { force: true });
      if (!(await this.#exists(path))) throw error;
      await this.#verified(path, contentHash, ref);
      return { ...stored, created: false };
    }
    return { ...stored, created: true };
  }

  async get(tenantId: TenantId, contentHash: string): Promise<Uint8Array> {
    const ref = contentRef(tenantId, contentHash);
    const path = join(this.#root, ref);
    if (!(await this.#exists(path))) throw new ContentNotFoundError(ref);
    return this.#verified(path, requireHash(contentHash), ref);
  }

  async has(tenantId: TenantId, contentHash: string): Promise<boolean> {
    return this.#exists(join(this.#root, contentRef(tenantId, contentHash)));
  }

  async #verified(path: string, contentHash: ContentHash, ref: string): Promise<Uint8Array> {
    const bytes = new Uint8Array(await readFile(path));
    if (hashContent(bytes) !== contentHash) throw new ContentIntegrityError(ref);
    return bytes;
  }

  async #exists(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
      throw error;
    }
  }
}
