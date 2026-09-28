/**
 * RELEASE-BLOCKING in part. The one outbound path, against a real HTTP server
 * on loopback. The fetcher runs every check exactly as in production; only
 * the socket is redirected to the test server, after the checks. So a
 * refusal that failed would show up as a request reaching the server, and
 * every refusal test asserts that none did.
 */
import { connect } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { capturedPayload } from "../src/fetcher/capture.ts";
import {
  createUpstreamFetch,
  type NetworkRuntime,
  type PinnedDestination,
} from "../src/fetcher/fetcher.ts";
import {
  COLLECTOR_USER_AGENT,
  DestinationRefusedError,
  FetchOptionsError,
  ResponseTooLargeError,
  UpstreamRateLimitedError,
  UpstreamTimeoutError,
  UpstreamUnreachableError,
  type SourceDeclaration,
} from "../src/index.ts";
import {
  MemoryRateLimiter,
  PUBLIC_TEST_ADDRESS,
  startUpstream,
  testNetwork,
  testSource,
  type TestUpstream,
} from "./support.ts";

let upstream: TestUpstream;
const routes = new Map<string, (res: import("node:http").ServerResponse) => void>();

beforeAll(async () => {
  upstream = await startUpstream((req, res) => {
    const route = routes.get(`${req.headers.host ?? ""}${req.url ?? ""}`);
    if (route === undefined) {
      res.writeHead(404).end("not found");
      return;
    }
    route(res);
  });
});

afterEach(() => {
  routes.clear();
  upstream.requests.length = 0;
});

afterAll(async () => {
  await upstream.close();
});

function fetcherFor(
  source: SourceDeclaration,
  network: NetworkRuntime = testNetwork(upstream),
  secrets: string[] = [],
) {
  return createUpstreamFetch({
    source,
    network,
    run: Symbol("test run"),
    signal: new AbortController().signal,
    secrets,
  });
}

const one = testSource("one", {
  network: {
    protocol: "http",
    hosts: ["one.test", "mirror.one.test"],
    rateLimit: { requests: 100, intervalSeconds: 1, basis: "SELF_IMPOSED", note: "[test]" },
  },
});
const GET = { method: "GET", timeoutMs: 2_000 } as const;

async function refusal(run: () => Promise<unknown>): Promise<DestinationRefusedError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof DestinationRefusedError) return error;
    throw error;
  }
  return expect.fail("the request was not refused");
}

describe("SSRF protection (RELEASE-BLOCKING)", () => {
  it.each([
    ["loopback", "http://127.0.0.1/", "HOST_NOT_ALLOWED"],
    ["loopback, IPv6", "http://[::1]/", "HOST_NOT_ALLOWED"],
    ["loopback, decimal", "http://2130706433/", "HOST_NOT_ALLOWED"],
    ["loopback, hex", "http://0x7f000001/", "HOST_NOT_ALLOWED"],
    ["loopback, octal", "http://0177.0.0.1/", "HOST_NOT_ALLOWED"],
    ["loopback, short form", "http://127.1/", "HOST_NOT_ALLOWED"],
    ["localhost", "http://localhost/", "HOST_NOT_ALLOWED"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/", "HOST_NOT_ALLOWED"],
    [
      "GCP metadata name",
      "http://metadata.google.internal/computeMetadata/v1/",
      "HOST_NOT_ALLOWED",
    ],
    ["IPv6 metadata", "http://[fd00:ec2::254]/", "HOST_NOT_ALLOWED"],
    ["private range", "http://10.0.0.1/", "HOST_NOT_ALLOWED"],
    ["allowlisted name as a suffix", "http://one.test.attacker.example/", "HOST_NOT_ALLOWED"],
    ["credentials smuggling a host", "http://one.test@127.0.0.1/", "CREDENTIALS_IN_URL"],
    ["credentials in the URL", "http://user:pass@one.test/", "CREDENTIALS_IN_URL"],
    ["another port", "http://one.test:8080/", "PORT_NOT_ALLOWED"],
    ["another scheme", "https://one.test/", "SCHEME_NOT_ALLOWED"],
    ["file", "file:///etc/passwd", "SCHEME_NOT_ALLOWED"],
    ["gopher", "gopher://one.test/", "SCHEME_NOT_ALLOWED"],
    ["not a URL", "one.test/path", "MALFORMED_URL"],
  ])("refuses %s before sending anything", async (_label, url, reason) => {
    const error = await refusal(() => fetcherFor(one)(url, GET));
    expect(error.reason).toBe(reason);
    expect(upstream.requests).toEqual([]);
  });

  it.each([
    ["loopback", ["127.0.0.1"]],
    ["cloud metadata", ["169.254.169.254"]],
    ["a private address", ["10.1.2.3"]],
    ["IPv6 loopback", ["::1"]],
    ["IPv6 metadata", ["fd00:ec2::254"]],
    ["IPv4-mapped loopback", ["::ffff:127.0.0.1"]],
    ["a public and a private address (rebinding)", [PUBLIC_TEST_ADDRESS, "192.168.0.1"]],
  ])("refuses an allowlisted host whose DNS answer is %s", async (_label, answers) => {
    const network = testNetwork(upstream, { answers: { "one.test": answers } });
    routes.set("one.test/", (res) => res.end("secret internal data"));
    const error = await refusal(() => fetcherFor(one, network)("http://one.test/", GET));
    expect(error.reason).toBe("ADDRESS_NOT_PUBLIC");
    expect(upstream.requests).toEqual([]);
  });

  it("refuses a host with no address", async () => {
    const network = testNetwork(upstream, { answers: {} });
    const error = await refusal(() => fetcherFor(one, network)("http://one.test/", GET));
    expect(error.reason).toBe("NO_ADDRESS");
  });

  it("follows a redirect that stays within the allowlist", async () => {
    routes.set("one.test/start", (res) =>
      res.writeHead(302, { location: "http://mirror.one.test/end" }).end(),
    );
    routes.set("mirror.one.test/end", (res) => res.end("arrived"));
    const response = await fetcherFor(one)("http://one.test/start", GET);
    expect(response.status).toBe(200);
    expect(response.text()).toBe("arrived");
    expect(response.url).toBe("http://mirror.one.test/end");
  });

  it.each([
    ["another host", "http://two.test/steal"],
    ["loopback", "http://127.0.0.1/"],
    ["cloud metadata", "http://169.254.169.254/latest/meta-data/"],
    ["another scheme", "file:///etc/passwd"],
  ])("refuses a redirect to %s, and never contacts it", async (_label, location) => {
    routes.set("one.test/start", (res) => res.writeHead(302, { location }).end());
    await refusal(() => fetcherFor(one)("http://one.test/start", GET));
    expect(upstream.requests.map((request) => request.host)).toEqual(["one.test"]);
  });

  it("refuses an endless redirect chain", async () => {
    routes.set("one.test/loop", (res) => res.writeHead(302, { location: "/loop" }).end());
    const error = await refusal(() => fetcherFor(one)("http://one.test/loop", GET));
    expect(error.reason).toBe("TOO_MANY_REDIRECTS");
    expect(upstream.requests).toHaveLength(6);
  });

  it("refuses a source that is not reached over the network", async () => {
    const offline = testSource("offline", { network: null });
    const error = await refusal(() => fetcherFor(offline)("http://offline.test/", GET));
    expect(error.reason).toBe("HOST_NOT_ALLOWED");
  });
});

describe("the fetcher's other guarantees", () => {
  it("opens every connection itself, to the address it checked, for the declared host", async () => {
    routes.set("one.test/", (res) => res.end("ok"));
    const connections: PinnedDestination[] = [];
    const base = testNetwork(upstream);
    const network: NetworkRuntime = {
      ...base,
      socketFactory: (destination) => {
        connections.push(destination);
        return connect(upstream.port, "127.0.0.1");
      },
    };
    await fetcherFor(one, network)("http://one.test/", GET);
    expect(connections).toEqual([
      { protocol: "http", host: "one.test", port: 80, address: PUBLIC_TEST_ADDRESS, family: 4 },
    ]);
    expect(upstream.requests).toHaveLength(1);
  });

  it("declares the platform user agent, and a collector cannot set another", async () => {
    routes.set("one.test/", (res) => res.end("ok"));
    await fetcherFor(one)("http://one.test/", GET);
    expect(upstream.requests[0]?.headers["user-agent"]).toBe(COLLECTOR_USER_AGENT);
    await expect(
      fetcherFor(one)("http://one.test/", { ...GET, headers: { "User-Agent": "Mozilla/5.0" } }),
    ).rejects.toBeInstanceOf(FetchOptionsError);
    await expect(
      fetcherFor(one)("http://one.test/", { ...GET, headers: { Host: "127.0.0.1" } }),
    ).rejects.toBeInstanceOf(FetchOptionsError);
  });

  it("requires a timeout, and enforces it", async () => {
    await expect(
      fetcherFor(one)("http://one.test/", { method: "GET" } as never),
    ).rejects.toBeInstanceOf(FetchOptionsError);
    await expect(
      fetcherFor(one)("http://one.test/", { method: "GET", timeoutMs: 600_000 }),
    ).rejects.toBeInstanceOf(FetchOptionsError);
    routes.set("one.test/slow", (res) => setTimeout(() => res.end("late"), 1_000));
    await expect(
      fetcherFor(one)("http://one.test/slow", { method: "GET", timeoutMs: 150 }),
    ).rejects.toBeInstanceOf(UpstreamTimeoutError);
  });

  it("refuses a body over the size limit, compressed or not", async () => {
    routes.set("one.test/big", (res) => res.end("x".repeat(2048)));
    await expect(
      fetcherFor(one)("http://one.test/big", { ...GET, maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
    routes.set("one.test/bomb", (res) =>
      res.writeHead(200, { "content-encoding": "gzip" }).end(gzipSync("y".repeat(1_000_000))),
    );
    await expect(
      fetcherFor(one)("http://one.test/bomb", { ...GET, maxBytes: 10_000 }),
    ).rejects.toBeInstanceOf(ResponseTooLargeError);
  });

  it("reports an unreachable upstream as unreachable, not as an empty answer", async () => {
    const closed = await startUpstream(() => undefined);
    await closed.close();
    const network = { ...testNetwork(closed) };
    await expect(fetcherFor(one, network)("http://one.test/", GET)).rejects.toBeInstanceOf(
      UpstreamUnreachableError,
    );
  });

  it("records the final URL with credential values redacted, and keeps the payload immutable", async () => {
    routes.set("one.test/data?key=s3cr3t-value", (res) => res.end("payload"));
    const response = await fetcherFor(one, testNetwork(upstream), ["s3cr3t-value"])(
      "http://one.test/data?key=s3cr3t-value",
      GET,
    );
    expect(response.url).toBe("http://one.test/data?key=[redacted]");
    response.body.fill(0);
    expect(new TextDecoder().decode(capturedPayload(response) ?? new Uint8Array())).toBe("payload");
    expect(response.text()).toBe("payload");
    expect(Object.isFrozen(response)).toBe(true);
  });
});

describe("the shared per-upstream rate limit", () => {
  it("waits for a slot within the timeout, and refuses when none comes in time", async () => {
    routes.set("one.test/", (res) => res.end("ok"));
    const strict = testSource("one", {
      network: {
        protocol: "http",
        hosts: ["one.test"],
        rateLimit: { requests: 1, intervalSeconds: 1, basis: "UPSTREAM_STATED", note: "[test]" },
      },
    });
    const network = testNetwork(upstream, { rateLimiter: new MemoryRateLimiter() });
    const started = performance.now();
    await fetcherFor(strict, network)("http://one.test/", GET);
    await fetcherFor(strict, network)("http://one.test/", GET);
    expect(performance.now() - started).toBeGreaterThanOrEqual(950);
    await expect(
      fetcherFor(strict, network)("http://one.test/", { method: "GET", timeoutMs: 200 }),
    ).rejects.toBeInstanceOf(UpstreamRateLimitedError);
    expect(upstream.requests).toHaveLength(2);
  });
});
