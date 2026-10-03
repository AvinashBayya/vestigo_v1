/**
 * REGRESSION (Phase 5 live checkpoint): the renderer re-wrapped every
 * footnote on its page for each line it placed, shaping each word with
 * fontkit again, so the live report of example.com (615 claims) took about
 * 150 s to render, and the 600-claim fixture below took 573 s. The same
 * re-wrapping counted a footnote's undrawable characters again each time, so
 * the rendering note printed hundreds of times their number.
 *
 * Measured on the development machine, 2026-10-03: the 600-claim fixture
 * rendered in 573 s before the fix and 5 to 7 s after; pdf-lib measurements
 * fell from about 2,200 per claim to about 6.
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFFont } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderReportPdf } from "../../src/index.ts";
import { largeReportFixture } from "../report-fixture.ts";

async function textOf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
  const text: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    for (const item of content.items) if ("str" in item) text.push(item.str);
  }
  return text.join(" ").replace(/\s+/g, " ");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rendering a large report", () => {
  it("renders 600 claims in seconds, measuring each piece of text once", async () => {
    const measure = vi.spyOn(PDFFont.prototype, "widthOfTextAtSize");
    const started = performance.now();
    const bytes = await renderReportPdf(largeReportFixture(600));
    const elapsed = performance.now() - started;

    expect(bytes.byteLength).toBeGreaterThan(0);
    // Deterministic: about 6 measurements per claim now, about 2,200 before.
    expect(measure.mock.calls.length / 600).toBeLessThan(20);
    // Generous for slow machines under parallel load: 5 to 7 s here, 573 s before.
    expect(elapsed).toBeLessThan(60_000);
  }, 120_000);

  it("counts an undrawable footnote character once for every time it is printed", async () => {
    const document = largeReportFixture(30);
    // Five Devanagari code points, outside the embedded font's coverage.
    const label = "[स्रोत]";
    const text = await textOf(
      await renderReportPdf({
        ...document,
        sources: document.sources.map((source) =>
          source.number === 2 ? { ...source, sourceLabel: label } : source,
        ),
      }),
    );
    const printed = text.split("[?????]").length - 1;
    // The label is printed in the evidence table and in a footnote on every page citing it.
    expect(printed).toBeGreaterThan(2);
    expect(text).toContain(
      `${String(5 * printed)} character(s) in this report are outside the embedded font's coverage`,
    );
  });
});
