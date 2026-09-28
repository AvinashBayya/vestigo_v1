/**
 * Whether an IP address is public unicast, so an outbound request may go to
 * it. Everything else is refused: private and shared ranges, loopback,
 * link-local (which holds the cloud metadata endpoints 169.254.169.254 and
 * fd00:ec2::254 via unique-local), documentation, benchmarking, multicast,
 * broadcast and reserved space. Forms that embed an IPv4 address (mapped,
 * NAT64, 6to4) are judged by the IPv4 address they carry, and refused when
 * that is not public.
 *
 * Parsing is strict: only canonical dotted-quad IPv4 and RFC 4291 IPv6 text.
 * Anything else is not an address, and callers treat that as refused.
 */

type Cidr4 = readonly [base: number, bits: number];

function v4(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

/** IPv4 space that is never a public destination (RFC 6890 and related). */
const NON_PUBLIC_V4: readonly Cidr4[] = [
  [v4(0, 0, 0, 0), 8], // "this network"
  [v4(10, 0, 0, 0), 8], // private
  [v4(100, 64, 0, 0), 10], // shared address space (CGNAT; Alibaba metadata 100.100.100.200)
  [v4(127, 0, 0, 0), 8], // loopback
  [v4(169, 254, 0, 0), 16], // link-local (cloud metadata 169.254.169.254)
  [v4(172, 16, 0, 0), 12], // private
  [v4(192, 0, 0, 0), 24], // IETF protocol assignments
  [v4(192, 0, 2, 0), 24], // documentation (TEST-NET-1)
  [v4(192, 88, 99, 0), 24], // 6to4 relay anycast (deprecated)
  [v4(192, 168, 0, 0), 16], // private
  [v4(198, 18, 0, 0), 15], // benchmarking
  [v4(198, 51, 100, 0), 24], // documentation (TEST-NET-2)
  [v4(203, 0, 113, 0), 24], // documentation (TEST-NET-3)
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4], // reserved, and 255.255.255.255 broadcast
];

function inCidr4(address: number, [base, bits]: Cidr4): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (address & mask) >>> 0 === (base & mask) >>> 0;
}

const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Canonical dotted-quad only: no leading zeros, no hex, no octal, no shorthand. */
export function parseIPv4(text: string): number | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!OCTET.test(part)) return null;
    value = value * 256 + Number(part);
  }
  return value >>> 0;
}

export function isPublicIPv4(text: string): boolean {
  const address = parseIPv4(text);
  if (address === null) return false;
  return !NON_PUBLIC_V4.some((cidr) => inCidr4(address, cidr));
}

/** Eight 16-bit groups, or null if the text is not an IPv6 address. */
export function parseIPv6(text: string): readonly number[] | null {
  if (text.length === 0 || text.length > 45 || text.includes("%")) return null;
  let head = text;
  let tail: number[] = [];
  // A trailing dotted-quad supplies the last two groups.
  const lastColon = text.lastIndexOf(":");
  const trailing = lastColon >= 0 ? text.slice(lastColon + 1) : "";
  if (trailing.includes(".")) {
    const embedded = parseIPv4(trailing);
    if (embedded === null) return null;
    tail = [embedded >>> 16, embedded & 0xffff];
    head = text.slice(0, lastColon + 1);
    // "::1.2.3.4" leaves "::", "a::1.2.3.4" leaves "a::", "a:b:1.2.3.4" leaves "a:b:".
    if (head.endsWith(":") && !head.endsWith("::")) head = head.slice(0, -1);
  }
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const groupsOf = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };
  const left = groupsOf(halves[0] ?? "");
  if (left === null) return null;
  if (halves.length === 1) {
    const all = [...left, ...tail];
    return all.length === 8 ? all : null;
  }
  const right = groupsOf(halves[1] ?? "");
  if (right === null) return null;
  const missing = 8 - left.length - right.length - tail.length;
  if (missing < 1) return null;
  return [...left, ...new Array<number>(missing).fill(0), ...right, ...tail];
}

/** A prefix written with its leading groups only; the rest are zero by definition. */
function fullPrefix(leading: readonly number[]): readonly number[] {
  return [...leading, ...new Array<number>(8 - leading.length).fill(0)];
}

function startsWith(groups: readonly number[], leading: readonly number[], bits: number): boolean {
  const prefix = fullPrefix(leading);
  let remaining = bits;
  for (let i = 0; remaining > 0; i++) {
    const group = groups[i];
    const expected = prefix[i];
    // Parsed addresses always have eight groups; anything shorter is refused.
    if (group === undefined || expected === undefined) return false;
    const take = Math.min(16, remaining);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if ((group & mask) !== (expected & mask)) return false;
    remaining -= take;
  }
  return true;
}

function embeddedV4(high: number, low: number): string {
  const value = ((high << 16) | low) >>> 0;
  return [value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(".");
}

export function isPublicIPv6(text: string): boolean {
  const g = parseIPv6(text);
  if (g === null) return false;
  // IPv4-mapped ::ffff:a.b.c.d and NAT64 64:ff9b::a.b.c.d: judge the IPv4 address.
  const [, g1, g2, , , , g6, g7] = g;
  if (g1 === undefined || g2 === undefined || g6 === undefined || g7 === undefined) return false;
  if (startsWith(g, [0, 0, 0, 0, 0, 0xffff], 96) || startsWith(g, [0x64, 0xff9b], 96)) {
    return isPublicIPv4(embeddedV4(g6, g7));
  }
  // 6to4 2002:a.b.c.d::/48 embeds an IPv4 address in groups 1-2.
  if (startsWith(g, [0x2002], 16)) return isPublicIPv4(embeddedV4(g1, g2));
  // Only global unicast 2000::/3 can be public; everything outside it is not
  // (unspecified, loopback, IPv4-compatible, unique-local fc00::/7 including
  // fd00:ec2::254, link-local, site-local, multicast).
  if (!startsWith(g, [0x2000], 3)) return false;
  const nonPublic: readonly (readonly [readonly number[], number])[] = [
    [[0x2001, 0], 23], // IETF protocol assignments, incl. Teredo 2001::/32
    [[0x2001, 0x0db8], 32], // documentation
    [[0x3fff], 20], // documentation (RFC 9637)
    [[0x64, 0xff9b, 1], 48], // local-use NAT64
  ];
  return !nonPublic.some(([prefix, bits]) => startsWith(g, prefix, bits));
}

/** Public unicast IPv4 or IPv6. Anything unparseable is not. */
export function isPublicAddress(text: string): boolean {
  return text.includes(":") ? isPublicIPv6(text) : isPublicIPv4(text);
}

/**
 * Whether a URL host is an IP literal in any form a URL parser accepts. The
 * WHATWG parser turns "127.1", "2130706433", "0x7f000001" and "0177.0.0.1"
 * into 127.0.0.1, so it decides, not a pattern of ours.
 */
export function isIpLiteralHost(host: string): boolean {
  if (host.includes(":") || host.startsWith("[")) return true;
  if (!URL.canParse(`http://${host}/`)) return false;
  const { hostname } = new URL(`http://${host}/`);
  return hostname.startsWith("[") || parseIPv4(hostname) !== null;
}
