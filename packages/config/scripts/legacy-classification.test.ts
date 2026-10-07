/**
 * The R0 classifier (legacy-classification.ts), on small in-memory trees: it
 * never reads legacy/, which is gitignored and absent in CI. Each case is a
 * shape the real pass met: a local named like a browser global, I/O reached
 * through an import, a collector held in an object, a fabrication the legacy
 * code had silenced, an export only tests import.
 */
import { describe, expect, it } from "vitest";
import {
  classifyLegacy,
  classifyLegacyWithData,
  ioRank,
  resolveSpecifier,
  type LegacyFile,
} from "./legacy-classification.ts";

const file = (path: string, ...lines: string[]): LegacyFile => ({ path, text: lines.join("\n") });

const binOf = (files: LegacyFile[], name: string) => {
  const found = classifyLegacy(files).find((entry) => entry.name === name);
  if (found === undefined) throw new TypeError(`${name} was not classified`);
  return found;
};

/** A module that imports everything named, so nothing in it reads as dead. */
const user = (from: string, ...names: string[]) =>
  file(
    "legacy/src/user.ts",
    `import { ${names.join(", ")} } from "${from}";`,
    `export const used = [${names.join(", ")}];`,
  );

describe("the legacy classifier", () => {
  it("bins a deterministic function PURE", () => {
    const files = [
      file(
        "legacy/src/utils/maths.ts",
        "export function add(a: number, b: number) { return a + b; }",
      ),
      user("@/utils/maths", "add"),
    ];
    expect(binOf(files, "add")).toMatchObject({ bin: "PURE", line: 1 });
  });

  it("does not read a local named `window` as the browser's", () => {
    const files = [
      file(
        "legacy/src/utils/span.ts",
        "export function span(minutes: number) { const window = minutes * 2; return window; }",
      ),
      user("@/utils/span", "span"),
    ];
    expect(binOf(files, "span").bin).toBe("PURE");
  });

  it("bins browser state, JSX and hooks UI/DEAD", () => {
    const files = [
      file(
        "legacy/src/utils/store.ts",
        "export function load() { return localStorage.getItem('k'); }",
      ),
      file("legacy/src/components/Card.tsx", "export function Card() { return <div />; }"),
      file(
        "legacy/src/hooks/useX.ts",
        "import { useState } from 'react';",
        "export function useX() { return useState(1); }",
      ),
      user("@/utils/store", "load"),
      file(
        "legacy/src/routes/page.tsx",
        "import { Card } from '@/components/Card';",
        "import { useX } from '@/hooks/useX';",
      ),
    ];
    expect(binOf(files, "load")).toMatchObject({
      bin: "UI/DEAD",
      reason: "uses browser state (localStorage)",
    });
    expect(binOf(files, "Card")).toMatchObject({ bin: "UI/DEAD", reason: "renders JSX" });
    expect(binOf(files, "useX").bin).toBe("UI/DEAD");
  });

  it("bins an export nothing imports UI/DEAD; one only tests import stays, and says so", () => {
    const files = [
      file(
        "legacy/src/utils/a.ts",
        "export function orphan() { return 1; }",
        "export function tested() { return 2; }",
      ),
      file("legacy/tests/a.test.ts", "import { tested } from '../src/utils/a';"),
    ];
    expect(binOf(files, "orphan")).toMatchObject({
      bin: "UI/DEAD",
      reason: "no legacy module or test imports it",
    });
    expect(binOf(files, "tested")).toMatchObject({
      bin: "PURE",
      reason: "deterministic; imported only by tests",
    });
  });

  it("carries I/O across an import, naming the root cause, and ranks the network over the clock", () => {
    const files = [
      file(
        "legacy/src/utils/net.ts",
        "export async function get(url: string) { return fetch(url); }",
      ),
      file(
        "legacy/src/utils/use-net.ts",
        "import { get } from './net';",
        "export async function lookup(name: string) { const at = Date.now(); return [at, await get(name)]; }",
      ),
      user("@/utils/use-net", "lookup"),
    ];
    expect(binOf(files, "lookup")).toMatchObject({
      bin: "IO-BOUND",
      reason: "via get (src/utils/net.ts): calls fetch",
    });
    expect(ioRank("reads the clock (Date.now)")).toBeGreaterThan(ioRank("calls fetch"));
  });

  it("classifies a collector held in an object by what its methods do", () => {
    const files = [
      file(
        "legacy/src/utils/collectors/x.ts",
        "export const xCollector = { id: 'x', async run(target: string) { return fetch(target); } };",
        "export const LIMITS = { max: 5 };",
      ),
      user("@/utils/collectors/x", "xCollector"),
    ];
    const outcome = classifyLegacyWithData(files);
    expect(outcome.classified.find((entry) => entry.name === "xCollector")).toMatchObject({
      kind: "object",
      bin: "IO-BOUND",
      reason: "calls fetch",
    });
    // Data with no behaviour is counted, not binned.
    expect(outcome.plainExports.map((entry) => entry.name)).toContain("LIMITS");
  });

  it("flags a fabrication the gate catches, even where legacy silenced its own rule", () => {
    const zero = "?" + "? 0";
    const files = [
      file(
        "legacy/src/utils/counts.ts",
        `export function total(n: number | null) { return n ${zero}; }`,
        "export function status(s: string | null) {",
        "  // eslint-disable-next-line no-fabricated-fallback -- legacy said this was fine",
        `  return s ${"|" + "|"} "Online";`,
        "}",
      ),
      user("@/utils/counts", "total", "status"),
    ];
    expect(binOf(files, "total")).toMatchObject({ bin: "FABRICATION-FLAGGED" });
    expect(binOf(files, "total").reason).toContain("numeric-zero-flattening");
    expect(binOf(files, "status").bin).toBe("FABRICATION-FLAGGED");
  });

  it("resolves the legacy alias and relative paths to files that exist, and nothing else", () => {
    const exists = (path: string) =>
      ["legacy/src/utils/a.ts", "legacy/src/lib/index.ts"].includes(path);
    expect(resolveSpecifier("legacy/src/x.ts", "@/utils/a", exists)).toBe("legacy/src/utils/a.ts");
    expect(resolveSpecifier("legacy/src/utils/b.ts", "../lib", exists)).toBe(
      "legacy/src/lib/index.ts",
    );
    expect(resolveSpecifier("legacy/src/x.ts", "react", exists)).toBeNull();
  });
});
