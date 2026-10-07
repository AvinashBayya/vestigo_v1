// @vitest-environment node
/**
 * The favicon (public/favicon.svg) echoes the product mark's tile: the
 * `accent` token's light value as the tile, the `on-accent` glyph. A favicon
 * is fetched by the browser on its own and cannot read the CSS tokens, so its
 * colours are written out; this keeps them equal to the tokens
 * (packages/ui/src/tokens.css), so the two cannot drift apart. It also holds
 * the favicon to the product-name rule: no text in it at all.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const svg = readFileSync(resolve(webRoot, "public/favicon.svg"), "utf8");
const tokensCss = readFileSync(resolve(webRoot, "../../packages/ui/src/tokens.css"), "utf8");
const html = readFileSync(resolve(webRoot, "index.html"), "utf8");

/** The light theme's tokens: the `:root` block of tokens.css. */
function lightTokens(): Map<string, string> {
  const start = tokensCss.indexOf(":root {");
  const block = tokensCss.slice(start, tokensCss.indexOf("}", start));
  const tokens = new Map<string, string>();
  for (const match of block.matchAll(/--(ds-[a-z0-9_-]+)\s*:\s*([^;]+);/g)) {
    if (match[1] !== undefined && match[2] !== undefined) {
      tokens.set(match[1], match[2].trim().toLowerCase());
    }
  }
  return tokens;
}

/** Every colour the SVG paints with: fill and stroke attributes, and any colour in a style. */
function coloursIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\b(?:fill|stroke|stop-color|color)\s*[=:]\s*"?([^"\s;>]+)/g)) {
    const value = (match[1] ?? "").toLowerCase();
    if (value !== "none" && value !== "currentcolor") found.push(value);
  }
  return found;
}

describe("the favicon", () => {
  const tokens = lightTokens();

  it("paints only with token values: every colour in it is a value tokens.css defines", () => {
    const colours = coloursIn(svg);
    expect(colours.length).toBeGreaterThan(0);
    const values = new Set(tokens.values());
    for (const colour of colours) expect(values, colour).toContain(colour);
  });

  it("is the product-mark tile: the accent tile and the on-accent glyph, in the light theme's values", () => {
    const tile = /<rect\b[^>]*\bfill="([^"]+)"/.exec(svg)?.[1]?.toLowerCase();
    expect(tile).toBe(tokens.get("ds-accent"));
    const strokes = [...svg.matchAll(/\bstroke="([^"]+)"/g)].map((match) =>
      (match[1] ?? "").toLowerCase(),
    );
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of strokes) expect(stroke).toBe(tokens.get("ds-on-accent"));
  });

  it("carries no text, so it never names the product", () => {
    expect(svg).not.toMatch(/<text\b|<title\b|<desc\b/);
  });

  it("is linked from the page", () => {
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
  });
});
