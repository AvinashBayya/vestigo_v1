// @vitest-environment node
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findRawHex, RAW_HEX } from "../scripts/no-raw-hex.ts";

describe("no raw hex colour in packages/ui (RELEASE-BLOCKING, U1-b)", () => {
  it("can tell a hex colour from words that merely start with #", () => {
    // Assembled, so this file holds no hex colour of its own.
    const hash = "#";
    for (const colour of [`${hash}A33F27`, `${hash}fff`, `${hash}15171c80`, `bg: ${hash}abcd;`]) {
      expect(RAW_HEX.test(colour), colour).toBe(true);
    }
    for (const text of ["#root", "#token=…", "§2", "#12345", "#header-row"]) {
      expect(RAW_HEX.test(text), text).toBe(false);
    }
  });

  it("finds none outside tokens.css", () => {
    const { scanned, found } = findRawHex(fileURLToPath(new URL("..", import.meta.url)));
    expect(scanned).toBeGreaterThan(20);
    expect(found).toEqual([]);
  });
});
