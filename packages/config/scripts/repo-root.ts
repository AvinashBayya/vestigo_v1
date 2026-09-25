import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export class RepoRootNotFoundError extends Error {
  readonly code = "REPO_ROOT_NOT_FOUND";

  constructor(start: string) {
    super(`No pnpm-workspace.yaml found in ${start} or any parent directory.`);
    this.name = "RepoRootNotFoundError";
  }
}

/** The monorepo root: the nearest ancestor holding pnpm-workspace.yaml. */
export function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new RepoRootNotFoundError(start);
    dir = parent;
  }
}
