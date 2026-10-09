/**
 * The case engine's version, stamped on every document it produces. Raised
 * whenever any analysis's output for the same input changes, so a stored
 * analysis says which rules produced it.
 *
 * It is one part of the input hash a stored analysis is keyed by (owner ruling
 * D-3). Where that hash is computed is not decided here: it is raised for the
 * owner with R1-a.
 */
export const ENGINE_VERSION = 1;
