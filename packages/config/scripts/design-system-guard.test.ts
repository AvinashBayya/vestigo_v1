/**
 * RELEASE-BLOCKING (docs/DESIGN-SYSTEM.md §11). The token stylesheet is the
 * design system document, value for value; and nothing else in the web app or
 * the UI package writes a raw colour, length, font stack, arbitrary value or
 * inline style.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  scanDesignScopes,
  scanForRawValues,
  tokensFromDocument,
  tokensFromStylesheet,
} from "./design-system-guard.ts";
import { findRepoRoot } from "./repo-root.ts";

const root = findRepoRoot(process.cwd());
const read = (path: string) => readFileSync(join(root, path), "utf8");

// Samples are assembled at runtime, so this file does not itself contain the
// raw values it tests: the guard scans the UI scopes, and this file is
// outside them, but the fabrication-style habit keeps it safe if that changes.
const HASH = "#";
const PX = "p" + "x";

describe("the guard recognises a raw value", () => {
  it.each([
    ["raw-colour", `const ink = "${HASH}15171c";`],
    ["raw-colour", `color: ${HASH}fff;`],
    ["raw-colour", `background: rgb` + `a(0, 0, 0, 0.5);`],
    ["raw-length", `padding: 13${PX};`],
    ["raw-length", `const gap = "1.5re` + `m";`],
    ["font-stack", `font-fam` + `ily: Arial;`],
    ["tailwind-arbitrary-value", `<div className="p-[13${PX}]" />`],
    ["tailwind-arbitrary-value", `<div className="bg-[${HASH}fff]" />`],
    ["inline-style", `<div style={{ padding: 4 }} />`.replace("style={{", "sty" + "le={{")],
  ])("flags %s: %s", (check, line) => {
    expect(scanForRawValues("apps/web/src/x.tsx", line).map((match) => match.check)).toContain(
      check,
    );
  });

  it.each([
    `<div className="p-4 text-body text-ink-primary rounded-lg" />`,
    `<p className="font-mono text-mono-caption">Code: {code}</p>`,
    `const token = new URLSearchParams(location.hash).get("token");`,
    `globalThis.history.replaceState(null, "", "/enrol");`,
    // A variant's bracket is a selector, not a value.
    `"aria-[invalid=true]:border-status-failed-mark",`,
    // A font-family that reads a token is the token.
    `font-family: var(--ds-font-sans);`,
  ])("does not flag token use: %s", (line) => {
    expect(scanForRawValues("apps/web/src/x.tsx", line)).toEqual([]);
  });
});

describe("the token stylesheet is the design system document (RELEASE-BLOCKING)", () => {
  const documented = tokensFromDocument(read("docs/DESIGN-SYSTEM.md"));
  const defined = tokensFromStylesheet(read("packages/ui/src/tokens.css"));

  it("reads every table of the document", () => {
    // 14 chrome + 16 claim + 3 failure + 20 entity class + 2 QR colours, 2 families,
    // 10 type styles x 3 values + 2 trackings, 8 spacing + 4 radius + 2 shadow + 9 sizes.
    expect(documented.size).toBe(112);
  });

  it("defines every documented token, with the documented value in each theme", () => {
    for (const [name, value] of documented) {
      expect(defined.get(name), name).toEqual(value);
    }
  });

  it("defines nothing the document does not", () => {
    expect([...defined.keys()].filter((name) => !documented.has(name))).toEqual([]);
  });
});

describe("no raw values outside the token stylesheet (RELEASE-BLOCKING)", () => {
  it("finds none in the web app or the UI package", () => {
    const { filesScanned, matches } = scanDesignScopes(root);
    expect(filesScanned).toBeGreaterThan(10);
    expect(
      matches.map((match) => `${match.file}:${String(match.line)} [${match.check}] ${match.text}`),
    ).toEqual([]);
  });
});
