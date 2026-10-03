import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Where CONTENT_STORE_DIR points. An absolute path is used as given, which is
 * what a deployment sets. A relative one resolves from the repository root
 * (the nearest directory at or above `cwd` holding pnpm-workspace.yaml), so
 * the API, the worker and the seed share one store whichever directory each
 * starts in; outside a checkout, from `cwd`.
 *
 * REGRESSION (Phase 5 live checkpoint): relative paths resolved from each
 * process's working directory, so the worker (run from apps/worker) and the
 * seed (from the root) wrote to different stores, and the API (apps/api)
 * would have read from a third.
 */
export function resolveContentStoreDir(dir: string, cwd: string = process.cwd()): string {
  if (isAbsolute(dir)) return dir;
  let current = resolve(cwd);
  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) return resolve(current, dir);
    const parent = dirname(current);
    if (parent === current) return resolve(cwd, dir);
    current = parent;
  }
}
