import { describe, expect, it } from "vitest";
import { CASE_WORDING } from "./case-wording.ts";

// Owner-approved wording (R1-a rulings, 2026-10-09), pinned sentence by
// sentence: a change here is a change the owner must approve.
describe("CASE_WORDING", () => {
  it("states the coverage caveat as approved", () => {
    expect(CASE_WORDING.coverageCaveats).toEqual({
      NO_NEW_COLLECTION:
        "This coverage was built from records already stored for this case. It reports only what earlier runs collected; no new collection was done to produce it.",
    });
  });

  it("states the breakdown caveats as approved, locked among the causes of an absent figure", () => {
    expect(CASE_WORDING.breakdownCaveats).toEqual({
      COUNTS_ARE_NOT_COVERAGE:
        "These are counts of stored records, not an assessment of coverage. A high count is not evidence of thorough collection.",
      DISCIPLINE_FROM_REGISTRY:
        "Each collector's discipline comes from its registry entry, never from its name or its output.",
      ENTITY_AND_RELATIONSHIP_COUNTS_OVERLAP:
        "Each collector has one discipline, so evidence and claims split cleanly by discipline. An entity or relationship is counted under every discipline whose evidence its claims cite. Those figures overlap and do not add up to the case total.",
      UNMEASURED_IS_NOT_ZERO:
        "A figure shown as absent could not be measured: no collector is built for that discipline, its only collectors are held, its collectors were locked, or the figure is not built yet. Absent is not zero; zero means the case was checked and holds none.",
    });
  });

  it("states the breakdown headline as approved", () => {
    expect(CASE_WORDING.breakdownHeadline).toEqual({
      present:
        "{disciplines} present · {evidence} evidence, {entities} entities, {relationships} relationships in this case.",
      onlyUnregistered:
        "{evidence} evidence records are held, all from collectors no longer registered.",
      noDiscipline:
        "No discipline in this case holds any stored record. {evidence} evidence records total.",
    });
  });
});
