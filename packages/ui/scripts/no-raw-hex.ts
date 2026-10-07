/**
 * Fails the build when a raw hex colour appears anywhere in this package's
 * source (U1-b). Every colour is a token (docs/DESIGN-SYSTEM.md §11); the one
 * file allowed hex values is tokens.css, which DEFINES the tokens and is held
 * to the design document value for value by
 * packages/config/scripts/design-system-guard.test.ts.
 *
 * Run by `pnpm build` (before tsc) and by the package's tests.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** A hex colour: #rgb, #rgba, #rrggbb or #rrggbbaa, standing alone. */
export const RAW_HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/;

/** Where the tokens are defined: the only place a hex value belongs. */
export const HEX_ALLOWED: readonly string[] = ["src/tokens.css"];

const SCANNED = new Set([
  ".ts",
  ".tsx",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".svg",
]);

export interface RawHex {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export function findRawHex(packageRoot: string): {
  readonly scanned: number;
  readonly found: RawHex[];
} {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "dist"].includes(entry.name)) walk(path);
      } else if (SCANNED.has(extname(entry.name))) {
        files.push(path);
      }
    }
  };
  walk(join(packageRoot, "src"));
  walk(join(packageRoot, "scripts"));
  const found: RawHex[] = [];
  let scanned = 0;
  for (const path of files.sort()) {
    const file = relative(packageRoot, path).split(sep).join("/");
    if (HEX_ALLOWED.includes(file)) continue;
    scanned += 1;
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .forEach((text, index) => {
        // This file names the pattern in a regular expression, not a colour.
        if (file === "scripts/no-raw-hex.ts" && text.includes("RAW_HEX =")) return;
        if (RAW_HEX.test(text)) found.push({ file, line: index + 1, text: text.trim() });
      });
  }
  return { scanned, found };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { scanned, found } = findRawHex(fileURLToPath(new URL("..", import.meta.url)));
  if (found.length > 0) {
    for (const hit of found) {
      process.stderr.write(`raw hex colour: ${hit.file}:${String(hit.line)}  ${hit.text}\n`);
    }
    process.stderr.write(
      "Use a colour token (docs/DESIGN-SYSTEM.md §2); hex values live only in src/tokens.css.\n",
    );
    process.exit(1);
  }
  process.stdout.write(`no raw hex colours in ${String(scanned)} files of packages/ui\n`);
}
