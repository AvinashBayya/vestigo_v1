/**
 * contact.phone through the platform harness, with every production gate. It
 * analyses locally and makes no request, so it has no fixtures, and every
 * test checks that nothing reached the (loopback) network.
 *
 * Every number is from a block a regulator reserves for fiction, so none can
 * belong to anyone:
 *   - Ofcom's TV and radio drama ranges, https://www.ofcom.org.uk/phones-and-broadband/phone-numbers/numbers-for-drama
 *     (020 7946 0000-0999, 07700 900000-900999, 0808 157 0000-0999,
 *     0909 879 0000-0999, 0306 999 0000-0999);
 *   - ARCEP's numbers for audiovisual works, décision n° 2018-0881,
 *     https://www.arcep.fr/uploads/tx_gsavis/18-0881.pdf (roots 01 99 00, 06 39 98).
 * The unparseable and too-short cases reuse those digits behind a calling
 * code with no plan, or cut short, so they cannot be anyone's number either.
 *
 * Ported from legacy/tests/collectors-person-contact-phone.test.ts; each
 * legacy case is named where it lands.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  evidenceDrafts,
  tenantRegistration,
  type CollectionOutcome,
  type DispatchRequest,
} from "../../src/index.ts";
import { contactPhoneCollector } from "../../src/platform/contact-phone.ts";
import { startHarness, type Harness } from "./harness.ts";

const ID = "contact.phone";
const LONDON_DRAMA = "+442079460123"; // Ofcom: 020 7946 0123
const MOBILE_DRAMA = "+447700900123"; // Ofcom: 07700 900123
const ARCEP_FIXED = "+33199001234"; // ARCEP: 01 99 00 12 34
const ARCEP_MOBILE = "+33639981234"; // ARCEP: 06 39 98 12 34

const FULLY_ENTITLED = { plan: "TECHINT_AND_PERSON", vettingStatus: "APPROVED" } as const;

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness({ collectors: [contactPhoneCollector], fixtures: [] });
});

afterEach(() => {
  // A local analysis never touches the network, in any test.
  expect(harness.requests).toEqual([]);
  expect(harness.unmatched).toEqual([]);
});

afterAll(async () => {
  await harness.close();
});

function expectStatus<S extends CollectionOutcome["status"]>(
  outcome: CollectionOutcome,
  status: S,
): Extract<CollectionOutcome, { status: S }> {
  expect(outcome.status, JSON.stringify(outcome)).toBe(status);
  return outcome as Extract<CollectionOutcome, { status: S }>;
}

const analyse = (value: string, overrides?: Partial<Omit<DispatchRequest, "target">>) =>
  harness.run(ID, { type: "PHONE_NUMBER", value }, overrides);

/** Straight to the runtime, so the runtime's own target check is what is tested. */
const executeUnparsed = (value: string) =>
  harness.runtime.execute(ID, {
    target: { type: "PHONE_NUMBER", value },
    entitlement: FULLY_ENTITLED,
    scopeAuthorisation: null,
    credentials: new Map(),
  });

describe("contact.phone registration", () => {
  it("is a PERSON local analysis of phone numbers, labelled by its registry entry, needing no credentials", () => {
    const entry = harness.runtime.registry.entry(ID);
    expect(entry).toMatchObject({
      version: "1.0.0",
      displayName: "Phone number analysis (libphonenumber)",
      label: "Phone number analysis (libphonenumber)",
      discipline: "PERSON",
      targetTypes: ["PHONE_NUMBER"],
      collectionMode: "LOCAL_ANALYSIS",
      claimStrength: "DERIVED",
      credentials: { vaultIds: [], runsWithout: true },
      commercialUse: "PERMITTED",
      // Legacy "healthCheck always reports ready": availability is the registry's to say.
      availability: "AVAILABLE",
      availabilityReason: null,
    });
    expect(entry.source.id).toBe("libphonenumber-js");
    expect(entry.source.network).toBeNull();
    expect(tenantRegistration(entry).sourceLabel).toBe("Phone number analysis (libphonenumber)");
  });
});

describe("contact.phone gates (PERSON: plan and vetting)", () => {
  it("is refused when the plan lacks person investigation, even with vetting approved", async () => {
    const outcome = await analyse(LONDON_DRAMA, {
      entitlement: { plan: "TECHINT", vettingStatus: "APPROVED" },
    });
    expect(expectStatus(outcome, "REFUSED").reason).toBe("MODULE_NOT_IN_PLAN");
  });

  it("is refused when vetting is not approved, even on a plan with person investigation", async () => {
    const outcome = await analyse(LONDON_DRAMA, {
      entitlement: { plan: "TECHINT_AND_PERSON", vettingStatus: "PENDING" },
    });
    expect(expectStatus(outcome, "REFUSED").reason).toBe("VETTING_NOT_APPROVED");
  });

  it("runs when the tenant is fully entitled", async () => {
    const outcome = await analyse(LONDON_DRAMA, { entitlement: FULLY_ENTITLED });
    expectStatus(outcome, "FOUND");
  });

  it("does not accept other target types", async () => {
    const outcome = await harness.run(ID, { type: "DOMAIN", value: "example.com" });
    expect(expectStatus(outcome, "REFUSED").reason).toBe("TARGET_TYPE_NOT_ACCEPTED");
  });
});

describe("contact.phone targets", () => {
  // Legacy "rejects an empty target", and the legacy inputs "12345",
  // "123" and "not-a-phone-number": none is an E.164 number, so the runtime
  // fails them before the collector runs. A failure carries no result.
  it.each(["", "   ", "12345", "123", "not-a-phone-number"])(
    "fails %j as an invalid target, with no result and nothing recorded",
    async (value) => {
      const outcome = expectStatus(await executeUnparsed(value), "FAILED");
      expect(outcome.error.code).toBe("TARGET_INVALID");
      expect(outcome).not.toHaveProperty("result");
      expect(outcome).not.toHaveProperty("evidence");
    },
  );
});

describe("contact.phone analysis", () => {
  it("derives the structure of a valid number (legacy: parses a valid E.164 number)", async () => {
    const found = expectStatus(await analyse(LONDON_DRAMA), "FOUND");
    expect(found.result).toEqual({
      countryCallingCode: "44",
      nationalNumber: "2079460123",
      possibleLength: true,
      validForNumberingPlan: true,
      numberingPlanCountry: "GB",
      nonGeographic: false,
      numberType: "FIXED_LINE",
      internationalFormat: "+44 20 7946 0123",
      nationalFormat: "020 7946 0123",
    });
  });

  // Legacy "exactly one phone entity, no relationships (no lookup)": the
  // result describes only the number's structure. No carrier, holder,
  // location or service status can appear, because nothing was looked up.
  it("says only what the number's structure says", async () => {
    const found = expectStatus(await analyse(LONDON_DRAMA), "FOUND");
    expect(Object.keys(found.result as object).sort()).toEqual([
      "countryCallingCode",
      "internationalFormat",
      "nationalFormat",
      "nationalNumber",
      "nonGeographic",
      "numberType",
      "numberingPlanCountry",
      "possibleLength",
      "validForNumberingPlan",
    ]);
  });

  it.each([
    ["+448081570123", "TOLL_FREE"], // Ofcom: 0808 157 0123
    ["+449098790123", "PREMIUM_RATE"], // Ofcom: 0909 879 0123
    ["+443069990123", "UAN"], // Ofcom: 0306 999 0123
  ])("classifies %s as %s from the numbering plan", async (value, numberType) => {
    const found = expectStatus(await analyse(value), "FOUND");
    expect(found.result).toMatchObject({
      numberingPlanCountry: "GB",
      validForNumberingPlan: true,
      numberType,
    });
  });

  // Regression: the legacy module used the default ("min") metadata, whose
  // getType() leaves this French range unclassified.
  it("classifies ranges the default metadata leaves unclassified", async () => {
    const found = expectStatus(await analyse(ARCEP_FIXED), "FOUND");
    expect(found.result).toMatchObject({
      numberingPlanCountry: "FR",
      validForNumberingPlan: true,
      numberType: "FIXED_LINE",
      internationalFormat: "+33 1 99 00 12 34",
    });
  });

  // Regression: the default metadata's length-only isValid() calls this
  // reserved French mobile block valid; the full numbering-plan patterns do not.
  it("does not call a number valid on length alone", async () => {
    const found = expectStatus(await analyse(ARCEP_MOBILE), "FOUND");
    expect(found.result).toEqual({
      countryCallingCode: "33",
      nationalNumber: "639981234",
      possibleLength: true,
      validForNumberingPlan: false,
      // +33 is France's alone, so libphonenumber-js attributes it; no type is claimed.
      numberingPlanCountry: "FR",
      nonGeographic: false,
      numberType: null,
      internationalFormat: "+33 6 39 98 12 34",
      nationalFormat: "06 39 98 12 34",
    });
  });

  // Legacy "a structurally invalid number still completes (with valid:false),
  // not a collector failure" and "an invalid number produces a warning naming
  // it": invalidity is an explicit field of a FOUND result. The number itself
  // is not repeated in any message.
  it("reports a parsed number outside the numbering plan as FOUND and invalid, inventing no country or type", async () => {
    const found = expectStatus(await analyse(MOBILE_DRAMA), "FOUND");
    expect(found.result).toEqual({
      countryCallingCode: "44",
      nationalNumber: "7700900123",
      possibleLength: true,
      validForNumberingPlan: false,
      // +44 is shared by several plans and this number matches none of them.
      numberingPlanCountry: null,
      nonGeographic: false,
      numberType: null,
      internationalFormat: "+44 7700 900123",
      nationalFormat: "07700 900123",
    });
  });

  it("reports a number too short for its plan as not even possible", async () => {
    // The London drama number cut short: 020 7946.
    const found = expectStatus(await analyse("+44207946"), "FOUND");
    expect(found.result).toMatchObject({
      countryCallingCode: "44",
      nationalNumber: "207946",
      possibleLength: false,
      validForNumberingPlan: false,
      numberingPlanCountry: null,
      numberType: null,
    });
  });

  it("marks a non-geographic calling code, with no country", async () => {
    // +808 (a global service, not a country) before seven of the London drama
    // number's digits: one short of that plan's eight, so it cannot be assigned.
    const found = expectStatus(await analyse("+8082079460"), "FOUND");
    expect(found.result).toMatchObject({
      countryCallingCode: "808",
      nonGeographic: true,
      numberingPlanCountry: null,
      possibleLength: false,
      validForNumberingPlan: false,
      numberType: null,
    });
  });

  // Legacy "garbage input that fails to parse at all still completes with a
  // null country/e164": that answer is now NOT_FOUND, citing the recorded
  // analysis and libphonenumber-js's reason, never a FOUND of nulls.
  it("reports NOT_FOUND, citing its recorded analysis, when the calling code has no numbering plan", async () => {
    const value = "+9992079460123"; // +999 before the London drama number's digits
    const notFound = expectStatus(await analyse(value), "NOT_FOUND");
    expect(notFound.detail).toContain("INVALID_COUNTRY");
    expect(notFound.detail).not.toContain(value);
    expect(notFound.response.kind).toBe("LOCAL");
    expect(notFound.response.json()).toEqual({
      collector: { id: ID, version: "1.0.0" },
      target: { type: "PHONE_NUMBER", value },
      output: { parsed: false, reason: "INVALID_COUNTRY" },
    });
  });

  it("gives the same answer every time", async () => {
    const first = expectStatus(await analyse(MOBILE_DRAMA), "FOUND");
    const second = expectStatus(await analyse(MOBILE_DRAMA), "FOUND");
    expect(second.result).toEqual(first.result);
  });
});

describe("contact.phone evidence", () => {
  // Legacy "confidence is null-valued: structural validity is not
  // cross-source corroboration": the claim is DERIVED, never OBSERVED or
  // REPORTED, and carries no date the analysis did not have.
  it("cites its recorded analysis as DERIVED evidence, with no source URL and no observed date", async () => {
    const found = expectStatus(await analyse(LONDON_DRAMA), "FOUND");
    expect(found.evidence).toHaveLength(1);
    const drafts = evidenceDrafts(harness.runtime.registry.entry(ID), found);
    expect(drafts).toHaveLength(1);
    const [draft] = drafts;
    expect(draft).toMatchObject({
      collectorId: ID,
      collectorVersion: "1.0.0",
      sourceUrl: null,
      observedAt: null,
      claimStrength: "DERIVED",
    });
    expect(draft?.collectedAt).toBeInstanceOf(Date);
    expect(JSON.parse(new TextDecoder().decode(draft?.payload))).toEqual({
      collector: { id: ID, version: "1.0.0" },
      target: { type: "PHONE_NUMBER", value: LONDON_DRAMA },
      output: found.result,
    });
  });
});

describe("versioning (Phase 3B review): the library's metadata is tied to the collector's version", () => {
  const manifest = (path: string) =>
    z
      .object({
        version: z.string().optional(),
        dependencies: z.record(z.string(), z.string()).optional(),
      })
      .parse(JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")));

  it("pins libphonenumber-js to an exact version", () => {
    const specifier = manifest("../../package.json").dependencies?.["libphonenumber-js"];
    expect(specifier).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("changes together with the collector's version: upgrading the library means bumping both here", () => {
    const installed = manifest("../../node_modules/libphonenumber-js/package.json").version;
    // Each libphonenumber-js release ships new metadata, and the evidence
    // records only the collector's version. Update this pair, and bump the
    // collector's version, whenever the library changes.
    expect([installed, contactPhoneCollector.declaration.version]).toEqual(["1.13.14", "1.0.0"]);
  });
});
