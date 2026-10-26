/**
 * How a collector reaches its source (owner instruction, 2026-10-16):
 *   open      a public or official free service, with no credential;
 *   official  the provider's own keyed API, with a key the tenant sets in its
 *             vault;
 *   licensed  a third-party data vendor, through the tenant's own account
 *             with it, kept in its vault;
 *   operator  an operator's own collector attached to the platform, with
 *             credentials the operator supplies through the tenant's vault.
 * A method says how a source is reached; whether that may be done is the
 * source's licence verdict, which is code (packages/collectors catalogue),
 * never configuration. Which methods run is configuration: open, official and
 * licensed unless COLLECTORS_ACCESS_METHODS says otherwise, and operator only
 * where it names it. No collector credential is ever configured here: every
 * method's credentials come from the tenant's vault.
 *
 * The vocabulary lives here because configuration validates it at startup;
 * @repo/collectors re-exports it for everything else.
 */
export const ACCESS_METHODS = ["open", "official", "licensed", "operator"] as const;
export type AccessMethod = (typeof ACCESS_METHODS)[number];

/** The methods a deployment runs when COLLECTORS_ACCESS_METHODS is not set: never operator. */
export const DEFAULT_ACCESS_METHODS = [
  "open",
  "official",
  "licensed",
] as const satisfies readonly AccessMethod[];

export function isAccessMethod(value: string): value is AccessMethod {
  return (ACCESS_METHODS as readonly string[]).includes(value);
}

/**
 * The methods a comma-separated list names, in its order, or null when it is
 * not one: a blank entry, an unknown method or a method named twice.
 */
export function parseAccessMethods(value: string): AccessMethod[] | null {
  const entries = value.split(",").map((entry) => entry.trim());
  const methods: AccessMethod[] = [];
  for (const entry of entries) {
    if (!isAccessMethod(entry) || methods.includes(entry)) return null;
    methods.push(entry);
  }
  return methods;
}
