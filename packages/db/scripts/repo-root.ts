import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The monorepo root: the nearest ancestor holding pnpm-workspace.yaml.
 * Relative paths in the root .env (CONTENT_STORE_DIR) resolve from here, so
 * the seed writes to the same place whichever directory it is run from.
 */
export function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new RangeError(`no pnpm-workspace.yaml above ${start}`);
    dir = parent;
  }
}
