// @vitest-environment node
/**
 * §7, computed from tokens.css: every mark and ring (dots, edges, legend
 * keys, map points) meets 3:1 on every ground a dot can sit on, in both
 * themes. REGRESSION (U1-b review): the light hypothesis grey was 2.70–2.92:1
 * on the page, `accent-soft`, `surface-muted` and `surface-map`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
const [light = "", dark = ""] = css.split('[data-theme="dark"]');

function tokens(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/--ds-([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map(
      (match) => [match[1] ?? "", match[2] ?? ""] as const,
    ),
  );
}

function luminance(hex: string): number {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const GROUNDS = [
  "surface-page",
  "surface-raised",
  "surface-sunken",
  "surface-hover",
  "surface-map",
  "surface-muted",
  "accent-soft",
];

describe("marks meet 3:1 on every ground, both themes (§7)", () => {
  it.each([
    ["light", tokens(light)],
    // Dark overrides light; a token the dark block leaves alone keeps its light value.
    ["dark", new Map([...tokens(light), ...tokens(dark)])],
  ] as const)("%s", (_theme, defined) => {
    // Marks and rings, and the edge that must be seen (border-input: inputs and the vetting pill, R2).
    const marks = [...defined.keys()].filter(
      (name) => /-(mark|ring)$/.test(name) || name === "border-input",
    );
    expect(marks.length).toBeGreaterThan(15);
    const failing: string[] = [];
    for (const mark of marks) {
      for (const ground of GROUNDS) {
        const value = ratio(defined.get(mark) ?? "", defined.get(ground) ?? "");
        if (value < 3) failing.push(`${mark} on ${ground}: ${value.toFixed(2)}`);
      }
    }
    expect(failing).toEqual([]);
  });
});
