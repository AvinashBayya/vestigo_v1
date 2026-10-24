/**
 * checkDestination — the per-request/per-redirect host gate. The static path is
 * unchanged (allowed hosts default to the source's declared `hosts`); an
 * open-host source hands the one authorised host it may contact. Every other
 * SSRF rule (scheme, no credentials, default port) is the same for both, and
 * Instagram/Facebook/X are refused by host even if somehow allowed (CLAUDE.md §3).
 * The private-address / DNS-rebinding defence is in the fetcher's resolver step
 * (fetcher.test.ts), which is source-agnostic and so covers open-host too.
 */
import { describe, expect, it } from "vitest";
import { checkDestination } from "../../src/fetcher/destination.ts";
import { DestinationRefusedError } from "../../src/errors.ts";
import type { SourceNetwork } from "../../src/source.ts";

const rateLimit = {
  requests: 100,
  intervalSeconds: 1,
  basis: "SELF_IMPOSED" as const,
  note: "[test]",
};

const STATIC: SourceNetwork = {
  protocol: "http",
  hosts: ["one.test"],
  rateLimit,
  operators: [{ name: "fake", hosts: ["one.test"] }],
};

const OPEN: SourceNetwork = {
  protocol: "https",
  hosts: [],
  openHost: true,
  rateLimit,
  operators: [],
};

function reasonOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    if (error instanceof DestinationRefusedError) return error.reason;
    throw error;
  }
  return "(no refusal)";
}

describe("checkDestination — static source (default allowed hosts)", () => {
  it("accepts a declared host over the declared scheme at the default port", () => {
    expect(checkDestination("http://one.test/path?q=1", STATIC).hostname).toBe("one.test");
  });

  it("refuses a host that is not declared", () => {
    expect(reasonOf(() => checkDestination("http://other.test/", STATIC))).toBe("HOST_NOT_ALLOWED");
  });
});

describe("checkDestination — open-host source (authorised host passed in)", () => {
  const allowed = ["news.example.com"];

  it("accepts the one authorised host over https", () => {
    expect(
      checkDestination("https://news.example.com/india/story-1?x=2", OPEN, allowed).hostname,
    ).toBe("news.example.com");
  });

  it("refuses any host other than the authorised one (a redirect off-host is refused the same way)", () => {
    expect(reasonOf(() => checkDestination("https://evil.example/x", OPEN, allowed))).toBe(
      "HOST_NOT_ALLOWED",
    );
    expect(reasonOf(() => checkDestination("https://sub.news.example.com/x", OPEN, allowed))).toBe(
      "HOST_NOT_ALLOWED",
    );
  });

  it("is https only: an http URL is refused", () => {
    expect(reasonOf(() => checkDestination("http://news.example.com/x", OPEN, allowed))).toBe(
      "SCHEME_NOT_ALLOWED",
    );
  });

  it("refuses credentials and a non-default port", () => {
    expect(reasonOf(() => checkDestination("https://u:p@news.example.com/x", OPEN, allowed))).toBe(
      "CREDENTIALS_IN_URL",
    );
    expect(reasonOf(() => checkDestination("https://news.example.com:8443/x", OPEN, allowed))).toBe(
      "PORT_NOT_ALLOWED",
    );
  });

  it("refuses Instagram, Facebook or X even if somehow in the allowed set (CLAUDE.md §3)", () => {
    for (const host of ["www.instagram.com", "facebook.com", "x.com"]) {
      expect(reasonOf(() => checkDestination(`https://${host}/p`, OPEN, [host]))).toBe(
        "HOST_NOT_ALLOWED",
      );
    }
  });
});
