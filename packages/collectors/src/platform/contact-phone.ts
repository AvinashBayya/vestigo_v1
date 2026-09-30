/**
 * contact.phone: what a phone number's own structure says about it, derived
 * locally by libphonenumber-js from Google's numbering-plan metadata. There
 * is no lookup of any kind: no carrier database, no reverse lookup, no
 * request. Nothing here says who holds the number, whether it is in service,
 * or where anyone is.
 *
 * Ported from the previous codebase (docs/audit/INVENTORY.md: KEEP), with one
 * deliberate change: it reads the complete ("max") metadata set, not the
 * package's default ("min") one. With the default set, getType() classifies
 * almost no country's numbers (229 of the 245 bundled mobile example numbers
 * come back unclassified), and isValid() only checks length, so it calls
 * numbers valid that the full numbering-plan patterns reject. Same package,
 * same licence.
 *
 * VERSIONING. Every result is derived from the metadata bundled with
 * libphonenumber-js, and the evidence records this collector's version, not
 * the library's. So the library is pinned to an exact version in
 * package.json, and every upgrade of it (each one ships new metadata) must
 * bump this collector's version, so evidence from different metadata is never
 * filed under one version. test/platform/contact-phone.test.ts fails until
 * both are updated together.
 *
 * Outcomes:
 *   FOUND      libphonenumber-js parsed the number. The result states what it
 *              derived, including whether the number fits the numbering plan
 *              at all: a parsed number that does not is still a finding.
 *   NOT_FOUND  it could not parse the number (for an E.164 target, only when
 *              the country calling code has no numbering plan in its
 *              metadata), so there is nothing to derive. It cites the recorded
 *              analysis, which carries libphonenumber-js's reason.
 * A malformed target never reaches this code: the runtime fails it first.
 */
import {
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type PhoneNumber,
  type PhoneNumberType,
} from "libphonenumber-js/max";
import { z } from "zod";
import { defineCollector, type Collector, type RunContext } from "../contract.ts";

/** Every type libphonenumber-js can assign. A type outside this list fails the schema, never relabelled. */
const NUMBER_TYPES = [
  "FIXED_LINE",
  "MOBILE",
  "FIXED_LINE_OR_MOBILE",
  "TOLL_FREE",
  "PREMIUM_RATE",
  "SHARED_COST",
  "VOIP",
  "PERSONAL_NUMBER",
  "PAGER",
  "UAN",
  "VOICEMAIL",
] as const satisfies readonly PhoneNumberType[];

export const CONTACT_PHONE_RESULT = z.strictObject({
  /** The country calling code, without "+". */
  countryCallingCode: z.string().regex(/^[1-9]\d{0,2}$/),
  /** The number after the calling code, as libphonenumber-js splits it. */
  nationalNumber: z.string().regex(/^\d{1,17}$/),
  /** Its length is one the numbering plan allows (isPossible: length only). */
  possibleLength: z.boolean(),
  /** It matches the numbering plan's patterns for its length and leading digits (isValid). */
  validForNumberingPlan: z.boolean(),
  /**
   * ISO 3166-1 alpha-2 code of the country or territory libphonenumber-js
   * attributes the number to: the one whose plan it matches, or the only one
   * using its calling code. Null when it attributes none (a calling code
   * shared by several with no plan matched, or a non-geographic code). Says
   * nothing about where the subscriber is.
   */
  numberingPlanCountry: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  /** The calling code is a global service (+800, +808, +870, ...), not a country's. */
  nonGeographic: z.boolean(),
  /**
   * The kind of range the numbering plan puts the number in. A property of
   * the range's allocation, not a carrier lookup. Null when the metadata
   * does not classify it, which is always the case for an invalid number.
   */
  numberType: z.enum(NUMBER_TYPES).nullable(),
  /** libphonenumber-js's formatting of the number, derived from the same metadata. */
  internationalFormat: z.string().min(1),
  nationalFormat: z.string().min(1),
});

export type ContactPhoneResult = z.infer<typeof CONTACT_PHONE_RESULT>;

function structureOf(parsed: PhoneNumber): ContactPhoneResult {
  return {
    countryCallingCode: parsed.countryCallingCode,
    nationalNumber: parsed.nationalNumber,
    possibleLength: parsed.isPossible(),
    validForNumberingPlan: parsed.isValid(),
    // libphonenumber-js leaves these undefined when it cannot say; null is
    // "not determined", never a guessed country or type.
    numberingPlanCountry: parsed.country ?? null,
    nonGeographic: parsed.isNonGeographic(),
    numberType: parsed.getType() ?? null,
    internationalFormat: parsed.formatInternational(),
    nationalFormat: parsed.formatNational(),
  };
}

function analyse(ctx: RunContext<ContactPhoneResult>) {
  // The target is already E.164; extract: false parses it whole or not at all.
  const parsed = parsePhoneNumberFromString(ctx.target.value, { extract: false });
  if (parsed === undefined) {
    // The reason comes from libphonenumber-js; if it gives none, none is recorded.
    const reason = validatePhoneNumberLength(ctx.target.value) ?? null;
    const record = ctx.record({ parsed: false, reason });
    return ctx.notFound(
      record,
      reason === null
        ? "libphonenumber-js could not parse the number, and gave no reason."
        : `libphonenumber-js could not parse the number (${reason}); nothing about it can be derived.`,
    );
  }
  const result = structureOf(parsed);
  // No date comes with a structural analysis, so observedAt is null.
  return ctx.found(result, [{ response: ctx.record(result), observedAt: null }]);
}

export const contactPhoneCollector: Collector = defineCollector(
  {
    id: "contact.phone",
    version: "1.0.0",
    displayName: "Phone number analysis (libphonenumber)",
    discipline: "PERSON",
    targetTypes: ["PHONE_NUMBER"],
    collectionMode: "LOCAL_ANALYSIS",
    source: "libphonenumber-js",
    credentials: { vaultIds: [], runsWithout: true },
    claimStrength: "DERIVED",
    timeoutMs: 5_000,
    resultSchema: CONTACT_PHONE_RESULT,
  },
  (ctx) => Promise.resolve(analyse(ctx)),
);
