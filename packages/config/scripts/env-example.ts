import type { z } from "zod";

export const ENV_EXAMPLE_HEADER = [
  "# Generated from packages/config/src/env.ts — do not edit by hand.",
  "# Regenerate with: pnpm --filter @repo/config generate:env",
  "# Copy to .env for local development.",
];

interface VariableMeta {
  readonly description?: string;
  readonly examples?: readonly unknown[];
}

interface EnvSchemaLike {
  readonly shape: Readonly<Record<string, z.ZodType>>;
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * Renders `.env.example` from the schema. Required variables are emitted with
 * their example value; variables with a default are commented out, showing
 * the default; optional variables without one (credentials) are left blank.
 */
export function renderEnvExample(schema: EnvSchemaLike): string {
  const blocks = Object.entries(schema.shape).map(([name, field]) => {
    const meta = (field.meta() ?? {}) as VariableMeta;
    const lines: string[] = [];
    if (meta.description) lines.push(`# ${meta.description}`);

    const parsedMissing = field.safeParse(undefined);
    if (!parsedMissing.success) {
      const example = meta.examples?.[0];
      lines.push("# Required.");
      lines.push(`${name}=${example === undefined ? "" : formatValue(example)}`);
    } else if (parsedMissing.data === undefined) {
      lines.push("# Optional.");
      lines.push(`${name}=`);
    } else {
      lines.push("# Optional; the default is shown.");
      lines.push(`# ${name}=${formatValue(parsedMissing.data)}`);
    }
    return lines.join("\n");
  });
  return `${[ENV_EXAMPLE_HEADER.join("\n"), ...blocks].join("\n\n")}\n`;
}
