/**
 * RELEASE-BLOCKING. Which addresses an outbound request may reach: public
 * unicast only. Real payloads: every private and reserved range, cloud
 * metadata endpoints, and the encodings used to smuggle loopback past naive
 * checks.
 */
import { describe, expect, it } from "vitest";
import { isIpLiteralHost, isPublicAddress, parseIPv4, parseIPv6 } from "../src/fetcher/address.ts";

describe("SSRF address policy (RELEASE-BLOCKING)", () => {
  it.each([
    ["loopback", "127.0.0.1"],
    ["loopback, anywhere in 127/8", "127.255.255.254"],
    ["this network", "0.0.0.0"],
    ["private 10/8", "10.0.0.1"],
    ["private 172.16/12", "172.16.0.1"],
    ["private 172.16/12, top", "172.31.255.255"],
    ["private 192.168/16", "192.168.1.1"],
    ["link-local, AWS/GCP/Azure metadata", "169.254.169.254"],
    ["link-local, ECS task metadata", "169.254.170.2"],
    ["shared space, Alibaba metadata", "100.100.100.200"],
    ["shared space (CGNAT)", "100.64.0.1"],
    ["IETF protocol assignments", "192.0.0.1"],
    ["documentation TEST-NET-1", "192.0.2.1"],
    ["documentation TEST-NET-3", "203.0.113.7"],
    ["benchmarking", "198.18.0.1"],
    ["multicast", "224.0.0.1"],
    ["reserved", "240.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 loopback", "::1"],
    ["IPv6 unspecified", "::"],
    ["IPv6 unique-local, AWS metadata", "fd00:ec2::254"],
    ["IPv6 unique-local", "fc00::1"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 multicast", "ff02::1"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped loopback, hex form", "::ffff:7f00:1"],
    ["IPv4-mapped metadata", "::ffff:169.254.169.254"],
    ["NAT64 of loopback", "64:ff9b::7f00:1"],
    ["6to4 of a private address", "2002:c0a8:0101::1"],
    ["Teredo", "2001:0:4136:e378:8000:63bf:3fff:fdd2"],
    ["IPv6 documentation", "2001:db8::1"],
    ["IPv4-compatible (deprecated)", "::127.0.0.1"],
  ])("refuses %s (%s)", (_label, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    ["obfuscated loopback, decimal", "2130706433"],
    ["obfuscated loopback, hex", "0x7f000001"],
    ["obfuscated loopback, octal", "0177.0.0.1"],
    ["obfuscated loopback, short form", "127.1"],
    ["zone id", "fe80::1%eth0"],
    ["not an address", "localhost"],
    ["empty", ""],
  ])("does not accept %s (%s) as a public address", (_label, text) => {
    expect(isPublicAddress(text)).toBe(false);
  });

  it.each([
    ["public IPv4", "1.1.1.1"],
    ["public IPv4, next to a private range", "172.32.0.1"],
    ["public IPv4, next to CGNAT", "100.128.0.1"],
    ["public IPv6", "2606:4700:4700::1111"],
    ["IPv4-mapped public", "::ffff:1.1.1.1"],
  ])("accepts %s (%s)", (_label, address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it("parses only canonical forms", () => {
    expect(parseIPv4("01.2.3.4")).toBeNull();
    expect(parseIPv4("1.2.3")).toBeNull();
    expect(parseIPv4("256.0.0.1")).toBeNull();
    expect(parseIPv6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(parseIPv6("1::2::3")).toBeNull();
    expect(parseIPv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  });

  it.each(["127.0.0.1", "2130706433", "0x7f000001", "0177.0.0.1", "127.1", "[::1]", "::1"])(
    "recognises %s as an IP literal in any spelling a URL accepts",
    (host) => {
      expect(isIpLiteralHost(host)).toBe(true);
    },
  );

  it.each(["example.com", "1a.de", "crt.sh", "api.gdeltproject.org"])(
    "does not mistake the domain %s for an IP literal",
    (host) => {
      expect(isIpLiteralHost(host)).toBe(false);
    },
  );
});
