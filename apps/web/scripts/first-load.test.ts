// @vitest-environment node
/**
 * The first load is the router, the session check and the frame around them,
 * never a signed-in screen: each screen is downloaded when its route is first
 * matched (src/router.tsx), and Cytoscape only where a graph is drawn
 * (src/workspace/GraphTab.tsx).
 *
 * REGRESSION (2026-10-17): the router imported every screen, so the build was
 * one chunk of 1,241.80 kB (381 kB gzipped), over Vite's 500 kB warning, and
 * the sign-in page loaded the run stream, timeline, report and graph code
 * that only signed-in workspace pages use.
 *
 * This builds the app the way the browser gets it and follows each chunk's
 * static imports, which all load before the chunk runs.
 */
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";
import { beforeAll, describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

interface Chunk {
  readonly isEntry: boolean;
  readonly facadeModuleId: string | null;
  readonly imports: readonly string[];
  readonly dynamicImports: readonly string[];
  /** Module ids with forward slashes, so a test reads the same on every platform. */
  readonly moduleIds: readonly string[];
}

const chunks = new Map<string, Chunk>();

/** The chunk that starts at this module (a source path under src/). */
function chunkOf(source: string): string {
  const found = [...chunks].find(([, chunk]) => chunk.facadeModuleId?.endsWith(`/src/${source}`));
  if (found === undefined) throw new TypeError(`no chunk starts at src/${source}`);
  return found[0];
}

const entry = () => {
  const found = [...chunks].find(([, chunk]) => chunk.isEntry);
  if (found === undefined) throw new TypeError("the build has no entry chunk");
  return found[0];
};

/** A chunk and every chunk it imports statically, transitively. */
function staticClosure(fileName: string, seen = new Set<string>()): Set<string> {
  if (seen.has(fileName)) return seen;
  seen.add(fileName);
  for (const imported of chunks.get(fileName)?.imports ?? []) staticClosure(imported, seen);
  return seen;
}

/** Every module loaded before the chunk runs. */
const modulesLoadedWith = (fileName: string) =>
  [...staticClosure(fileName)].flatMap((name) => chunks.get(name)?.moduleIds ?? []);

/** Code that only signed-in workspace pages use. */
const WORKSPACE_ONLY = [
  "/src/screens/Run.tsx",
  "/src/screens/Search.tsx",
  "/src/screens/Cases.tsx",
  "/src/run/",
  "/src/workspace/",
  "/node_modules/cytoscape/",
];
const workspaceCodeIn = (moduleIds: readonly string[]) =>
  moduleIds.filter((id) => WORKSPACE_ONLY.some((part) => id.includes(part)));

beforeAll(async () => {
  const collect: Plugin = {
    name: "collect-chunks",
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        chunks.set(item.fileName, {
          isEntry: item.isEntry,
          facadeModuleId: item.facadeModuleId?.replaceAll("\\", "/") ?? null,
          imports: item.imports,
          dynamicImports: item.dynamicImports,
          moduleIds: item.moduleIds.map((id) => id.replaceAll("\\", "/")),
        });
      }
    },
  };
  await build({
    root: webRoot,
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    logLevel: "silent",
    plugins: [collect],
    build: { write: false },
  });
}, 120_000);

describe("the first load", () => {
  it("carries the router and no screen", () => {
    const loaded = modulesLoadedWith(entry());
    expect(loaded.some((id) => id.endsWith("/src/router.tsx"))).toBe(true);
    expect(loaded.filter((id) => id.includes("/src/screens/"))).toEqual([]);
    expect(workspaceCodeIn(loaded)).toEqual([]);
  });

  it("the sign-in screen brings no workspace, run, report or graph code with it", () => {
    const signIn = chunkOf("screens/SignIn.tsx");
    expect(workspaceCodeIn(modulesLoadedWith(signIn))).toEqual([]);
  });

  it("Cytoscape is downloaded only with the graph renderer, never with the workspace", () => {
    const renderer = chunkOf("workspace/graph/CytoscapeGraph.tsx");
    const withCytoscape = [...chunks]
      .filter(([, chunk]) => chunk.moduleIds.some((id) => id.includes("/node_modules/cytoscape/")))
      .map(([name]) => name);
    expect(withCytoscape).toEqual([renderer]);
    const workspace = chunkOf("workspace/Workspace.tsx");
    expect(staticClosure(workspace).has(renderer)).toBe(false);
    // The graph tab asks for it; nothing else reaches it.
    const askers = [...chunks]
      .filter(([, chunk]) => chunk.dynamicImports.includes(renderer))
      .map(([name]) => name);
    expect(askers).toEqual([workspace]);
  });
});
