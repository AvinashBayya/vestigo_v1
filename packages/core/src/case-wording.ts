/**
 * The fixed wording of a case's analysis documents, as the owner approved it
 * (R1-a rulings, 2026-10-09). The documents carry codes; this says what each
 * code means to a reader. It lives beside REPORT_WORDING so that a stored
 * analysis can copy the wording it was produced under (D-22), as a report
 * copies its own.
 *
 * Owner-reviewed: change it only with the owner's approval. case-wording.test.ts
 * pins every sentence.
 */

export interface CaseWording {
  /** The standing caveats of a case's coverage, by code. */
  readonly coverageCaveats: {
    readonly NO_NEW_COLLECTION: string;
  };
  /** The standing caveats of a case's discipline breakdown, by code. */
  readonly breakdownCaveats: {
    readonly COUNTS_ARE_NOT_COVERAGE: string;
    readonly DISCIPLINE_FROM_REGISTRY: string;
    readonly ENTITY_AND_RELATIONSHIP_COUNTS_OVERLAP: string;
    readonly UNMEASURED_IS_NOT_ZERO: string;
  };
  /** One line for a breakdown's header. Never a percentage: the counts overlap. */
  readonly breakdownHeadline: {
    /** {disciplines}, {evidence}, {entities}, {relationships} */
    readonly present: string;
    /** {evidence}: every evidence record comes from collectors no longer registered. */
    readonly onlyUnregistered: string;
    /** {evidence}: no discipline holds a record, and no evidence is unaccounted for. */
    readonly noDiscipline: string;
  };
}

export const CASE_WORDING: CaseWording = {
  coverageCaveats: {
    NO_NEW_COLLECTION:
      "This coverage was built from records already stored for this case. It reports only what earlier runs collected; no new collection was done to produce it.",
  },
  breakdownCaveats: {
    COUNTS_ARE_NOT_COVERAGE:
      "These are counts of stored records, not an assessment of coverage. A high count is not evidence of thorough collection.",
    DISCIPLINE_FROM_REGISTRY:
      "Each collector's discipline comes from its registry entry, never from its name or its output.",
    ENTITY_AND_RELATIONSHIP_COUNTS_OVERLAP:
      "Each collector has one discipline, so evidence and claims split cleanly by discipline. An entity or relationship is counted under every discipline whose evidence its claims cite. Those figures overlap and do not add up to the case total.",
    UNMEASURED_IS_NOT_ZERO:
      "A figure shown as absent could not be measured: no collector is built for that discipline, its only collectors are held, its collectors were locked, or the figure is not built yet. Absent is not zero; zero means the case was checked and holds none.",
  },
  breakdownHeadline: {
    present:
      "{disciplines} present · {evidence} evidence, {entities} entities, {relationships} relationships in this case.",
    onlyUnregistered:
      "{evidence} evidence records are held, all from collectors no longer registered.",
    noDiscipline:
      "No discipline in this case holds any stored record. {evidence} evidence records total.",
  },
};
