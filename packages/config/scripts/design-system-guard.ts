/**
 * Design-system guard (docs/DESIGN-SYSTEM.md §11): every colour, spacing,
 * radius, shadow, font and type size comes from a token, and the tokens are
 * the document's.
 *
 *   tokensFromDocument   what the design system document says each token is
 *   tokensFromStylesheet what packages/ui/src/tokens.css defines (light, dark)
 *   scanForRawValues     a raw value anywhere else in the web app or the UI
 *                        package: a colour, a length, a font stack, a Tailwind
 *                        arbitrary value or an inline style
 *
 * This file describes the raw-value patterns in words where it can, because
 * it is scanned too.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

/** A token's value in each theme; `dark` equals `light` when the theme does not change it. */
export interface TokenValue {
  readonly light: string;
  readonly dark: string;
}

/** Compared without case, runs of spaces, or spaces around commas. */
const normalise = (value: string): string =>
  value
    .trim()
    .replace(/\s*,\s*/g, ",")
    .replace(/\s+/g, " ")
    .toLowerCase();

const cells = (line: string): string[] =>
  line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

const code = (cell: string | undefined): string | null => {
  const match = /^`([^`]+)`$/.exec(cell ?? "");
  return match?.[1] ?? null;
};

/**
 * Every token the document defines, by its stylesheet name (`ds-` + the
 * token's name). Read from the tables in §2 (colours, claim strength, failure,
 * QR code), §4 (families and type styles) and §5 (spacing, radius, shadow,
 * sizes).
 */
export function tokensFromDocument(markdown: string): Map<string, TokenValue> {
  const tokens = new Map<string, TokenValue>();
  const set = (name: string, light: string, dark = light) => {
    tokens.set(`ds-${name}`, { light: normalise(light), dark: normalise(dark) });
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const row = cells(line);
    const first = code(row[0]);
    if (first === null) continue;

    // Colour tables: | `token` | `#light` | `#dark` | use |
    const light = code(row[1]);
    const dark = code(row[2]);
    if (light !== null && dark !== null && light.startsWith("#") && dark.startsWith("#")) {
      set(first, light, dark);
      continue;
    }

    // Claim strength: | `LABEL` | meaning | `#fill` / `#fill` | `#ink` / `#ink` | `#mark` / `#mark` or — |
    if (/^[A-Z]+$/.test(first) && row.length >= 5) {
      const label = first.toLowerCase();
      for (const [index, part] of [
        [2, "fill"],
        [3, "ink"],
        [4, "mark"],
      ] as const) {
        const pair = /^`(#[0-9A-Fa-f]{6})`\s*\/\s*`(#[0-9A-Fa-f]{6})`$/.exec(row[index] ?? "");
        if (pair?.[1] !== undefined && pair[2] !== undefined) {
          set(`claim-${label}-${part}`, pair[1], pair[2]);
        }
      }
      continue;
    }

    // Families: | `sans` | `"IBM Plex Sans", …` | use |  (serif is for printed reports, never the UI)
    const family = code(row[1]);
    if ((first === "sans" || first === "mono") && family !== null) {
      set(`font-${first}`, family);
      continue;
    }

    // Type styles: | `display` | 30 / 36 | 600 | notes |
    const size = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(row[1] ?? "");
    if (size?.[1] !== undefined && size[2] !== undefined && /^\d+$/.test(row[2] ?? "")) {
      set(`type-${first}-size`, `${size[1]}px`);
      set(`type-${first}-line`, `${size[2]}px`);
      set(`type-${first}-weight`, row[2] ?? "");
      const tracking = /letter-spacing:\s*(-?\d+(?:\.\d+)?px)/.exec(row[3] ?? "");
      if (tracking?.[1] !== undefined) set(`type-${first}-tracking`, tracking[1]);
      continue;
    }

    // Lengths and shadows: | `space-1` | 4px | use |  or  | `shadow-card` | `0 1px …` | use |
    const length = /^(\d+(?:\.\d+)?px)$/.exec(row[1] ?? "");
    if (length?.[1] !== undefined) {
      set(first, length[1]);
      continue;
    }
    const shadow = code(row[1]);
    if (first.startsWith("shadow-") && shadow !== null) set(first, shadow);
  }
  return tokens;
}

/** The custom properties a stylesheet block declares. */
function declarations(block: string): Map<string, string> {
  const found = new Map<string, string>();
  const withoutComments = block.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of withoutComments.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (match[1] !== undefined && match[2] !== undefined) found.set(match[1], normalise(match[2]));
  }
  return found;
}

/** The tokens the stylesheet defines: `:root` for light, `[data-theme="dark"]` over it for dark. */
export function tokensFromStylesheet(css: string): Map<string, TokenValue> {
  const block = (selector: string): string => {
    const start = css.indexOf(`${selector} {`);
    if (start < 0) return "";
    return css.slice(start, css.indexOf("}", start));
  };
  const light = declarations(block(":root"));
  const dark = declarations(block('[data-theme="dark"]'));
  const tokens = new Map<string, TokenValue>();
  for (const [name, value] of light) {
    tokens.set(name, { light: value, dark: dark.get(name) ?? value });
  }
  for (const name of dark.keys()) {
    if (!light.has(name)) tokens.set(name, { light: "(not defined)", dark: dark.get(name) ?? "" });
  }
  return tokens;
}

export interface RawValueCheck {
  readonly name: string;
  readonly regex: RegExp;
  readonly note: string;
}

export const RAW_VALUE_CHECKS: readonly RawValueCheck[] = [
  {
    name: "raw-colour",
    regex: new RegExp(
      "#[0-9a-fA-F]{8}\\b|#[0-9a-fA-F]{6}\\b|#[0-9a-fA-F]{3}\\b|\\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\\(",
    ),
    note: "a colour that is not a token: use a colour token (bg-…, text-…, border-…)",
  },
  {
    name: "raw-length",
    regex: new RegExp("\\b\\d+(?:\\.\\d+)?(?:px|rem|em|vw|vh)\\b"),
    note: "a length that is not a token: use a spacing, radius or size token",
  },
  {
    name: "font-stack",
    // A font-family that reads a token (var(--ds-font-…)) is the token.
    regex: new RegExp("font-family\\s*:(?!\\s*var\\()|fontFamily"),
    note: "a font set outside the tokens: use font-sans or font-mono",
  },
  {
    name: "tailwind-arbitrary-value",
    // A bracket followed by ":" is a variant (aria-[…]:, data-[…]:): a selector, not a value.
    regex: new RegExp("\\b[a-z][a-z0-9:-]*-\\[[^\\]\\s]+\\](?!:)"),
    note: "a Tailwind arbitrary value bypasses the tokens: use a token utility",
  },
  {
    name: "inline-style",
    regex: new RegExp("\\bstyle=\\{\\{"),
    note: "an inline style bypasses the tokens: use token utilities",
  },
];

export interface RawValueMatch {
  readonly check: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export function scanForRawValues(file: string, content: string): RawValueMatch[] {
  const matches: RawValueMatch[] = [];
  content.split(/\r?\n/).forEach((text, index) => {
    for (const check of RAW_VALUE_CHECKS) {
      if (check.regex.test(text)) {
        matches.push({ check: check.name, file, line: index + 1, text: text.trim() });
      }
    }
  });
  return matches;
}

/** Where the web app's look is written. */
export const DESIGN_SCOPES: readonly string[] = ["apps/web/src", "packages/ui/src"];

/** The one file allowed raw values, and the generated client (not ours to write). */
export const DESIGN_EXEMPT: readonly string[] = [
  "packages/ui/src/tokens.css",
  "apps/web/src/client/",
];

const SCANNED = new Set([".ts", ".tsx", ".css", ".js", ".jsx", ".mjs", ".cjs"]);

export function scanDesignScopes(root: string): {
  readonly filesScanned: number;
  readonly matches: readonly RawValueMatch[];
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
  for (const scope of DESIGN_SCOPES) walk(join(root, scope));
  const matches: RawValueMatch[] = [];
  let filesScanned = 0;
  for (const path of files.sort()) {
    const file = relative(root, path).split(sep).join("/");
    if (
      DESIGN_EXEMPT.some((exempt) =>
        exempt.endsWith("/") ? file.startsWith(exempt) : file === exempt,
      )
    ) {
      continue;
    }
    filesScanned += 1;
    matches.push(...scanForRawValues(file, readFileSync(path, "utf8")));
  }
  return { filesScanned, matches };
}
