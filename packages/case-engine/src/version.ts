/**
 * The case engine's version, stamped on every document it produces. Raised
 * whenever any analysis's output for the same input changes, so a stored
 * analysis says which rules produced it; a stored analysis of an earlier
 * version reads STALE, as the version is part of its input hash.
 *   1: R1-a as built.
 *   2: a discipline whose collectors were all locked is LOCKED, its counts
 *      null, where version 1 counted a measured zero.
 *   3: a run's headline names one planned collector in the singular, and a
 *      run that planned none says NOTHING PLANNED.
 *   4: a partial run that planned none says NOTHING PLANNED too, and the
 *      note on collectors that did not run agrees in number ("1 further
 *      collector was", "2 further collectors were").
 *   5: a collector the registry lists as BLOCKED or NOT_IMPLEMENTED has
 *      that registration, keeps its label and discipline, and is left out
 *      of a discipline's registered collectors, so being listed no longer
 *      makes a discipline's zero measured (a job it completed in the case's
 *      runs still does). A discipline with no evidence and no lock, none of
 *      whose collectors may run or completed a job in the case's runs, is
 *      HELD, BLOCKED (new) or NOT_BUILT, its counts null. The lock is judged
 *      without the places where a collector could not run at all: one
 *      recorded as LICENCE_BLOCKED or NOT_IMPLEMENTED, and every place
 *      without a job of a collector listed as BLOCKED or NOT_IMPLEMENTED.
 *   6: a job that ended EMPTY_UNCONFIRMED (its source answered with
 *      nothing, but its empty answers are unreliable) has that coverage
 *      state, where version 5 read every finished job that found nothing as
 *      NOTHING_FOUND. A run's headline counts it apart ("returned nothing —
 *      unconfirmed") and its coverage states the caveat; a discipline's
 *      breakdown lists it as ran, never as found nothing (Track M Day 2).
 *   7: a collector on a source whose licence is UNVERIFIED has that
 *      registration (UNVERIFIED), since an unverified source never runs
 *      (access methods, owner instruction 2026-10-16), and is left out of a
 *      discipline's registered collectors, where version 6 counted it as one
 *      that could run, so its discipline read a measured zero (D-39). A
 *      discipline with no evidence and no lock, none of whose collectors may
 *      run or completed a job in the case's runs, none held and one listed as
 *      UNVERIFIED, is UNVERIFIED (new), its counts null. A run's recorded
 *      UNVERIFIED_SOURCE_NOT_ALLOWED or ACCESS_METHOD_NOT_ENABLED is a place
 *      where the collector could not run at all, as LICENCE_BLOCKED is.
 *   8: claim contradiction review runs (M4-1): the analysis reads each claim's
 *      attribute and value, and a discipline's breakdown reports CONTRADICTIONS
 *      as a measured count (the entities whose claims disagree, supported by
 *      that discipline's evidence), where version 7 reported it as
 *      CONTRADICTION_DETECTION_NOT_BUILT. The stored document gains a
 *      `contradictions` field (the conflicting positions, with their evidence
 *      and strengths); a document stored before this does not carry it, reads
 *      STALE as its hash differs, and is never reinterpreted as having run it.
 *
 * It is one part of the input hash a stored analysis is keyed by (owner ruling
 * D-3). That hash is computed in R1-b's job, which holds the input it read, and
 * never here (owner ruling, 2026-10-09).
 */
export const ENGINE_VERSION = 8;
