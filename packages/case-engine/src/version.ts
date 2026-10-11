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
 *
 * It is one part of the input hash a stored analysis is keyed by (owner ruling
 * D-3). That hash is computed in R1-b's job, which holds the input it read, and
 * never here (owner ruling, 2026-10-09).
 */
export const ENGINE_VERSION = 4;
