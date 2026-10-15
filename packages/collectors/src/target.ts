import { TARGET_TYPES, type TargetType } from "@repo/core";
import { InvalidTargetError } from "./errors.ts";
import { parseIPv4, parseIPv6 } from "./fetcher/address.ts";

/** A target in its normalised form: what a collector receives and what scope authorisations match. */
export interface Target {
  readonly type: TargetType;
  readonly value: string;
}

const MAX_LENGTH = 2048;
const DNS_NAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const E164 = /^\+[1-9]\d{6,14}$/;
const USERNAME = /^[\p{L}\p{N}._-]{1,100}$/u;
const FILE_REF = /^sha256:[0-9a-f]{64}$/;

function invalid(type: TargetType, problem: "EMPTY" | "TOO_LONG" | "MALFORMED"): never {
  throw new InvalidTargetError(type, problem);
}

function domain(value: string): string | null {
  const bare = value.toLowerCase().replace(/\.$/, "");
  if (!URL.canParse(`http://${bare}/`)) return null;
  // The URL parser converts internationalised names to their ASCII form.
  const { hostname } = new URL(`http://${bare}/`);
  if (parseIPv4(hostname) !== null || hostname.startsWith("[")) return null;
  return DNS_NAME.test(hostname) ? hostname : null;
}

function ipAddress(value: string): string | null {
  if (parseIPv4(value) !== null) return value;
  if (parseIPv6(value) === null) return null;
  // The URL parser gives IPv6 its canonical compressed, lowercase form.
  return new URL(`http://[${value}]/`).hostname.slice(1, -1);
}

function email(value: string): string | null {
  const at = value.lastIndexOf("@");
  if (at < 1 || at !== value.indexOf("@") || value.length > 254) return null;
  const local = value.slice(0, at);
  const host = domain(value.slice(at + 1));
  if (host === null || /\s/.test(local) || local.length > 64) return null;
  // The domain part is case-insensitive; the local part may not be, so it is kept.
  return `${local}@${host}`;
}

function url(value: string): string | null {
  if (!URL.canParse(value)) return null;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  return parsed.href;
}

function normalise(type: TargetType, value: string): string | null {
  switch (type) {
    case "DOMAIN":
      return domain(value);
    case "IP_ADDRESS":
      return ipAddress(value);
    case "EMAIL_ADDRESS":
      return email(value);
    case "PHONE_NUMBER": {
      const digits = value.replace(/[\s().-]/g, "");
      return E164.test(digits) ? digits : null;
    }
    case "USERNAME": {
      const name = value.replace(/^@/, "");
      return USERNAME.test(name) ? name : null;
    }
    case "ORGANIZATION": {
      const name = value.replace(/\s+/g, " ");
      return name.length <= 300 ? name : null;
    }
    case "TOPIC": {
      // Free text, kept as typed (a hashtag keeps its #, a phrase its quotes),
      // with its spacing made single.
      const topic = value.replace(/\s+/g, " ");
      return topic.length <= 300 ? topic : null;
    }
    case "URL":
      return url(value);
    case "FILE":
      return FILE_REF.test(value) ? value : null;
  }
}

/**
 * Validates and normalises a target. Throws InvalidTargetError, whose message
 * never repeats the value: a target can be personal data.
 */
export function parseTarget(type: TargetType, raw: string): Target {
  if (!(TARGET_TYPES as readonly string[]).includes(type)) invalid(type, "MALFORMED");
  const value = raw.trim();
  if (value.length === 0) invalid(type, "EMPTY");
  if (value.length > MAX_LENGTH) invalid(type, "TOO_LONG");
  const normalised = normalise(type, value);
  if (normalised === null) invalid(type, "MALFORMED");
  return Object.freeze({ type, value: normalised });
}
