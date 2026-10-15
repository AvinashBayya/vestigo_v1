import { AppError } from "./errors.ts";
import type { TargetType } from "./vocabulary.ts";

/**
 * Target detection: which target types a raw string plausibly is.
 *
 * Ported from the previous codebase's query planner (legacy
 * src/utils/osint/query-planner.ts, INVENTORY verdict KEEP), onto this
 * repository's target types. One defect is fixed, with a regression test:
 * legacy answered an empty input with the type "person", a guess standing in
 * for "there is nothing to detect". Here an empty input is an error.
 *
 * Detection only proposes types. It never validates or normalises a value:
 * each candidate is parsed by the collectors' target rules before anything
 * runs, and a candidate that does not parse is dropped then.
 */

/** The best single guess, and the other types the input may also be. */
export interface DetectedTarget {
  readonly primaryType: TargetType;
  /**
   * Other plausible types, non-empty only when the input genuinely does not
   * disambiguate (a bare word may be a username or an organisation's name).
   * Never guessed away to one type.
   */
  readonly alternateTypes: readonly TargetType[];
}

export class EmptyTargetError extends AppError {
  readonly code = "TARGET_EMPTY";

  constructor() {
    super("The target is empty: there is nothing to detect.");
    this.name = "EmptyTargetError";
  }
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
/** Hex groups and colons only; full validation is the collectors' target rule. */
const IPV6 = /^[0-9a-f:]+$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
const PHONE = /^\+?[\d\s().-]{7,}$/;
const FILE_REFERENCE = /^sha256:[0-9a-f]{64}$/;
/**
 * A hashtag: # and one word of letters, digits or underscores. Combining marks
 * count as part of a word: Devanagari and other Indic vowel signs are marks.
 */
const HASHTAG = /^#[\p{L}\p{M}\p{N}_]+$/u;
/** A phrase in straight or curly double quotes, with something inside them. */
const QUOTED_PHRASE = /^(?:"[^"]*\S[^"]*"|“[^“”]*\S[^“”]*”)$/;
/** Bare words longer than this are not usernames on any platform the collectors read. */
const MAX_USERNAME_LENGTH = 30;

function isIPv4(value: string): boolean {
  const match = IPV4.exec(value);
  return match !== null && match.slice(1).every((octet) => Number(octet) <= 255);
}

function isIPv6(value: string): boolean {
  return IPV6.test(value) && value.split(":").length >= 3;
}

/**
 * Precedence-ordered: an unambiguous shape (file reference, IP address, URL,
 * email address, domain, phone number, hashtag, quoted phrase) wins outright.
 * What is left is ambiguous and is returned with its alternates. A hashtag or a
 * quoted phrase is a topic. Other words with spaces are an organisation's name
 * first, and may be a topic: the analyst chooses, nothing here guesses (a topic
 * may name a person, which no rule can tell from any other words).
 */
export function detectTargetType(raw: string): DetectedTarget {
  const input = raw.trim();
  if (input.length === 0) throw new EmptyTargetError();

  if (FILE_REFERENCE.test(input)) return { primaryType: "FILE", alternateTypes: [] };
  if (isIPv4(input) || isIPv6(input)) return { primaryType: "IP_ADDRESS", alternateTypes: [] };
  if (URL_SCHEME.test(input)) return { primaryType: "URL", alternateTypes: ["DOMAIN"] };
  if (EMAIL.test(input)) return { primaryType: "EMAIL_ADDRESS", alternateTypes: [] };
  if (!input.includes(" ") && DOMAIN.test(input)) {
    return { primaryType: "DOMAIN", alternateTypes: [] };
  }
  if (PHONE.test(input) && input.replace(/\D/g, "").length >= 7) {
    return { primaryType: "PHONE_NUMBER", alternateTypes: [] };
  }
  if (HASHTAG.test(input) || QUOTED_PHRASE.test(input)) {
    return { primaryType: "TOPIC", alternateTypes: [] };
  }
  // Legacy offered "person" here. There is no person target type: a bare word
  // is a plausible handle or a plausible organisation's name.
  if (!input.includes(" ") && input.length <= MAX_USERNAME_LENGTH) {
    return { primaryType: "USERNAME", alternateTypes: ["ORGANIZATION"] };
  }
  // Words with spaces may be a topic; one long word is an organisation's name, as before.
  return {
    primaryType: "ORGANIZATION",
    alternateTypes: /\s/.test(input) ? ["TOPIC"] : [],
  };
}
