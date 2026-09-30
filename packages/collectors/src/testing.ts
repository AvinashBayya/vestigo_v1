/**
 * The test harness for platform collectors, exported as @repo/collectors/testing
 * so the engine's end-to-end tests run the real registered collectors against
 * the same recorded fixtures. Never imported by any other file in src/ (lint).
 *
 * The test harness for platform collectors. Tests never touch the network:
 * every declared host of every platform source resolves to a placeholder
 * public address (checked by the fetcher exactly as in production, never
 * contacted), and the socket goes to a loopback server that answers only with
 * recorded fixtures, matched on exact host and path. Anything unmatched is
 * answered 599 and listed, so a test cannot pass on a request it did not expect.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { join } from "node:path";
import type { TargetType } from "@repo/core";
import { z } from "zod";
import {
  CollectorRegistry,
  CollectorRuntime,
  parseTarget,
  PLATFORM_SOURCES,
  type CollectionOutcome,
  type Collector,
  type DispatchRequest,
  type UpstreamRateLimiter,
} from "./index.ts";

/** The package's recorded fixtures: test/fixtures, from src/ or dist/ alike. */
export const FIXTURES_DIR = join(import.meta.dirname, "..", "test", "fixtures");

/** Checked, never contacted: sockets go to the loopback fixture server. */
const PLACEHOLDER_ADDRESS = "1.1.1.1";

const PROVENANCE = z.object({
  /**
   * recorded: the upstream's response as received. recorded-redacted: the
   * same, with personal values replaced by bracketed placeholders, or trimmed
   * (the notes say what). synthetic: written to the upstream's documented
   * shape, with placeholder values.
   */
  kind: z.enum(["recorded", "recorded-redacted", "synthetic"]),
  /** The URL it was recorded from, or the documentation a synthetic one follows. */
  source: z.url({ protocol: /^https$/ }),
  recordedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().min(1),
});

export const FIXTURE = z.object({
  provenance: PROVENANCE,
  request: z.object({ host: z.string().min(1), path: z.string().startsWith("/") }),
  response: z.object({
    status: z.number().int().min(100).max(599),
    headers: z.record(z.string(), z.string()),
    body: z.string(),
  }),
});
export type Fixture = z.infer<typeof FIXTURE>;

/** Loads test/fixtures/<collector>/<name>.json, validating its shape and provenance. */
export function loadFixture(collector: string, name: string): Fixture {
  const path = join(FIXTURES_DIR, collector, `${name}.json`);
  return FIXTURE.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Every fixture file on disk, for the provenance test. */
export function allFixturePaths(): string[] {
  return readdirSync(FIXTURES_DIR, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".json"))
    .map((path) => join(FIXTURES_DIR, path));
}

export interface RecordedRequest {
  readonly host: string;
  readonly path: string;
  readonly method: string;
  readonly headers: IncomingHttpHeaders;
}

export interface Harness {
  readonly runtime: CollectorRuntime;
  readonly requests: RecordedRequest[];
  /** Requests no fixture matched. A passing test expects this to be empty. */
  readonly unmatched: string[];
  run(
    collectorId: string,
    target: { readonly type: TargetType; readonly value: string },
    overrides?: Partial<Omit<DispatchRequest, "target">>,
  ): Promise<CollectionOutcome>;
  close(): Promise<void>;
}

/** Entitled and vetted, so gates do not interfere with a collector's own tests. */
const ENTITLED = { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" } as const;

const ALWAYS_ALLOW: UpstreamRateLimiter = { acquire: () => Promise.resolve({ allowed: true }) };

/** Headers the server computes itself; fixture bodies are stored decoded. */
const DROPPED_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

export async function startHarness(options: {
  readonly collectors: readonly Collector[];
  readonly fixtures: readonly Fixture[];
  readonly rateLimiter?: UpstreamRateLimiter;
  readonly allowUnverifiedSources?: boolean;
}): Promise<Harness> {
  const byKey = new Map(options.fixtures.map((f) => [`${f.request.host}${f.request.path}`, f]));
  const requests: RecordedRequest[] = [];
  const unmatched: string[] = [];
  const server = createServer((req, res) => {
    const host = req.headers.host ?? "";
    const path = req.url ?? "";
    requests.push({ host, path, method: req.method ?? "", headers: req.headers });
    const fixture = byKey.get(`${host}${path}`);
    if (fixture === undefined) {
      unmatched.push(`${host}${path}`);
      res.writeHead(599).end("no fixture");
      return;
    }
    const headers = Object.fromEntries(
      Object.entries(fixture.response.headers).filter(
        ([name]) => !DROPPED_HEADERS.has(name.toLowerCase()),
      ),
    );
    res.writeHead(fixture.response.status, headers).end(fixture.response.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const declared = new Set(PLATFORM_SOURCES.flatMap((source) => source.network?.hosts ?? []));
  const runtime = new CollectorRuntime({
    registry: new CollectorRegistry({ sources: PLATFORM_SOURCES, collectors: options.collectors }),
    allowUnverifiedSources: options.allowUnverifiedSources ?? true,
    network: {
      rateLimiter: options.rateLimiter ?? ALWAYS_ALLOW,
      resolver: (host) =>
        Promise.resolve(
          declared.has(host) ? [{ address: PLACEHOLDER_ADDRESS, family: 4 as const }] : [],
        ),
      socketFactory: () => connect(port, "127.0.0.1"),
    },
  });

  return {
    runtime,
    requests,
    unmatched,
    run: (collectorId, target, overrides = {}) =>
      runtime.execute(collectorId, {
        target: parseTarget(target.type, target.value),
        entitlement: ENTITLED,
        scopeAuthorisation: null,
        credentials: new Map(),
        ...overrides,
      }),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}
