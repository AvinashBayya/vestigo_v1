/**
 * Keeps only the component schemas the document actually references. The
 * Zod transform emits every named schema twice, as an input and an output
 * variant; a schema only ever sent (the progress stream's events, the Locked
 * block) would otherwise leave an unused `…Input` twin in the contract and in
 * the generated client.
 */

const SCHEMA_REF = "#/components/schemas/";

/** Every component schema named by a `$ref` anywhere inside `value`. */
function referencedSchemas(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) referencedSchemas(item, into);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "$ref" && typeof child === "string" && child.startsWith(SCHEMA_REF)) {
      into.add(child.slice(SCHEMA_REF.length));
    } else {
      referencedSchemas(child, into);
    }
  }
}

export function withoutUnusedSchemas<
  T extends {
    readonly paths?: unknown;
    readonly components?: { schemas?: Record<string, unknown> };
  },
>(document: T): T {
  const schemas = document.components?.schemas;
  if (schemas === undefined) return document;
  // Reachable from the paths, then from whatever those schemas reference, until nothing new.
  const kept = new Set<string>();
  referencedSchemas(document.paths, kept);
  let frontier = [...kept];
  while (frontier.length > 0) {
    const found = new Set<string>();
    for (const name of frontier) referencedSchemas(schemas[name], found);
    frontier = [...found].filter((name) => !kept.has(name));
    for (const name of frontier) kept.add(name);
  }
  return {
    ...document,
    components: {
      ...document.components,
      schemas: Object.fromEntries(Object.entries(schemas).filter(([name]) => kept.has(name))),
    },
  };
}
