// @vitest-environment node
/**
 * Every class the UI writes must produce CSS. The theme resets Tailwind's
 * default scales (packages/ui/src/theme.css), so a utility outside the design
 * tokens generates nothing, silently: the class is in the markup and no rule
 * applies. jsdom does no layout, so the component tests cannot see it.
 *
 * REGRESSION (Phase 6b step 4, found in the live check on 2026-10-06): the
 * provenance drawer was `fixed top-0 right-0`. With the spacing scale reset,
 * `top-0` and `right-0` generated nothing, the drawer took its static
 * position below the page, and nobody could see it. Every test passed.
 *
 * This compiles the app's real stylesheet with Tailwind and builds each class
 * found in the UI's source, one at a time; a class whose build adds no CSS is
 * reported with where it is used.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(webRoot, "../..");
const SCOPES = [join(webRoot, "src"), join(repoRoot, "packages/ui/src")];

/** Tailwind's own stylesheet and the design system's, resolved the way Vite resolves them. */
async function loadStylesheet(id: string, base: string) {
  const path =
    id === "tailwindcss"
      ? join(webRoot, "node_modules/tailwindcss/index.css")
      : id === "@repo/ui/theme.css"
        ? join(repoRoot, "packages/ui/src/theme.css")
        : resolve(base, id);
  return Promise.resolve({ path, base: dirname(path), content: readFileSync(path, "utf8") });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "client" ? [] : sourceFiles(path);
    // cn.ts lists the theme's scale names for tailwind-merge; they are not classes.
    if (entry.name === "cn.ts") return [];
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** A token shaped like a utility: lower case, variants allowed, a hyphen, colon or slash inside. */
const UTILITY = /^!?(?:[a-z0-9-]+:)*-?[a-z][a-z0-9]*(?:[-/][a-z0-9]+)+$/;
/** Bare words that are utilities. */
const BARE = new Set(
  ["flex", "grid", "block", "hidden", "contents", "uppercase", "underline"].concat([
    "truncate",
    "fixed",
    "absolute",
    "relative",
    "sticky",
    "border",
    "grow",
    "shrink",
  ]),
);
/** How a lone token must begin to be read as a class (a status map's `"bg-…"`, say). */
const PREFIX =
  /^(?:[a-z-]+:)*(?:bg|text|border|rounded|[pm][xytrbl]?|gap|w|h|size|min-[wh]|max-[wh]|top|right|bottom|left|inset|font|shadow|ring|outline|decoration|aspect|self|items|justify|col|row|z|opacity)-/;

/** The source without its comments, so prose in a comment is never read as a class. */
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/**
 * Class names as the source writes them. A literal of several tokens counts
 * when every token is class-shaped and one is unmistakably a utility; copy
 * (capitals, punctuation) never qualifies. A lone token counts only where a
 * class goes: not an object key, not a function argument, not an index, not
 * another attribute's value, and only with a utility's prefix.
 */
function classesIn(text: string): string[] {
  const source = withoutComments(text);
  const found: string[] = [];
  for (const match of source.matchAll(/"([^"\n]*)"|`([^`$\n]*)`/g)) {
    const literal = match[1] ?? match[2] ?? "";
    const tokens = literal.split(/\s+/).filter((token) => token !== "");
    if (tokens.length === 0) continue;
    if (tokens.length > 1) {
      const classLike = tokens.every((token) => UTILITY.test(token) || BARE.has(token));
      const certain = tokens.some((token) => /[:/]/.test(token) || /^[a-z]+-[a-z0-9]/.test(token));
      if (classLike && certain) found.push(...tokens);
      continue;
    }
    const [token = ""] = tokens;
    const at = match.index;
    const before = source.slice(Math.max(0, at - 12), at);
    const after = source.slice(at + match[0].length).trimStart();
    const elsewhere =
      after.startsWith(":") ||
      /[([]\s*$/.test(before) ||
      /from\s*$/.test(before) ||
      (/[a-zA-Z]=\s*$/.test(before) && !/className=\s*$/.test(before));
    if (!elsewhere && UTILITY.test(token) && PREFIX.test(token)) found.push(token);
  }
  return found;
}

const appCompiler = () =>
  compile(readFileSync(join(webRoot, "src/index.css"), "utf8"), {
    base: join(webRoot, "src"),
    loadStylesheet,
  });

describe("every class the UI uses generates CSS (RELEASE-BLOCKING)", () => {
  it("can tell: a token utility adds CSS, one outside the tokens adds none", async () => {
    const compiler = await appCompiler();
    const base = compiler.build([]);
    expect(compiler.build(["p-7"])).toBe(base);
    expect(compiler.build(["p-4"])).not.toBe(base);
    expect(classesIn('className="fixed top-0 right-0 min-w-0"')).toEqual([
      "fixed",
      "top-0",
      "right-0",
      "min-w-0",
    ]);
    // Copy, attribute values, object keys and function arguments are not classes.
    expect(
      classesIn(
        'autoComplete="one-time-code" token("border-strong") { "border-color": 1 } "Pinned to a case"',
      ),
    ).toEqual([]);
  });

  it("finds none that Tailwind, restricted to the design tokens, ignores", async () => {
    const compiler = await appCompiler();
    const used = new Map<string, Set<string>>();
    for (const file of SCOPES.flatMap(sourceFiles)) {
      for (const name of classesIn(readFileSync(file, "utf8"))) {
        const where = used.get(name) ?? new Set<string>();
        where.add(file.slice(repoRoot.length + 1).replaceAll("\\", "/"));
        used.set(name, where);
      }
    }
    expect(used.size).toBeGreaterThan(100);

    // build() is incremental: a class that adds nothing to the output generated nothing.
    let css = compiler.build([]);
    const silent: string[] = [];
    for (const [name, where] of [...used].sort(([a], [b]) => a.localeCompare(b))) {
      const next = compiler.build([name]);
      if (next === css) silent.push(`${name}  (${[...where].join(", ")})`);
      css = next;
    }
    expect(silent).toEqual([]);
  });
});
