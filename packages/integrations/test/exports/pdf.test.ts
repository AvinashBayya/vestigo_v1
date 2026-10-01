/**
 * The PDF report, read back from the rendered bytes with pdf.js: serif body
 * at 12 pt, nothing smaller than 10 pt but citation markers, black text only,
 * claim labels as text, a footnote on the same page for every citation, the
 * handling marking on every page, and every attribution printed.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { REPORT_WORDING, type ReportDocument } from "@repo/core";
import { beforeAll, describe, expect, it } from "vitest";
import { renderReportPdf } from "../../src/index.ts";
import { reportFixture } from "../report-fixture.ts";

interface TextItem {
  readonly str: string;
  readonly size: number;
}

interface PageText {
  readonly items: readonly TextItem[];
  readonly text: string;
  readonly fills: readonly string[];
}

async function readPdf(bytes: Uint8Array): Promise<PageText[]> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
  const pages: PageText[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const items = content.items
      .filter((item): item is typeof item & { str: string; transform: number[] } => "str" in item)
      .filter((item) => item.str.trim().length > 0)
      .map((item) => ({
        str: item.str,
        size: Math.round(Math.abs(Number(item.transform[3])) * 10) / 10,
      }));
    const operators = await page.getOperatorList();
    const fills: string[] = [];
    operators.fnArray.forEach((fn, i) => {
      if (fn === OPS.setFillRGBColor) fills.push(JSON.stringify(operators.argsArray[i]));
    });
    pages.push({ items, text: items.map((item) => item.str).join(" "), fills });
  }
  return pages;
}

let pages: PageText[];
let bytes: Uint8Array;

beforeAll(async () => {
  bytes = await renderReportPdf(reportFixture());
  pages = await readPdf(bytes);
});

const all = () => pages.map((page) => page.text).join(" ");

describe("the PDF report", () => {
  it("embeds only the serif report faces", async () => {
    const doc = await PDFDocument.load(bytes);
    const names = new Set<string>();
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      if (object instanceof PDFDict && object.get(PDFName.of("Type")) === PDFName.of("Font")) {
        const base = object.get(PDFName.of("BaseFont"));
        if (base instanceof PDFName) names.add(base.decodeText());
      }
    }
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/NotoSerif/);
  });

  it("sets body text at 12 pt, and nothing but citation markers below 10 pt", () => {
    const claim = pages
      .flatMap((p) => p.items)
      .find((item) => item.str.includes("[Registrar name]"));
    expect(claim?.size).toBeGreaterThanOrEqual(12);
    for (const item of pages.flatMap((p) => p.items)) {
      if (item.size < 10)
        expect(item.str, `"${item.str}" at ${String(item.size)} pt`).toMatch(/^[\d,]+$/);
    }
  });

  it("prints claim strengths as text labels, and draws all text in black", () => {
    for (const label of [
      "[REPORTED]",
      "[DERIVED]",
      "[CORRELATED]",
      "[INFERRED]",
      "[HYPOTHESIS]",
      "[OBSERVED]",
    ]) {
      expect(all()).toContain(label);
    }
    const fills = new Set(pages.flatMap((page) => page.fills));
    expect(fills.size).toBeGreaterThan(0);
    for (const fill of fills) expect(["[0,0,0]", '["#000000"]', '"#000000"']).toContain(fill);
  });

  it("puts the handling marking on every page, top and bottom", () => {
    for (const page of pages) {
      const count = page.text.split("HANDLING: [TENANT MARKING]").length - 1;
      expect(count).toBe(2);
    }
  });

  it("says so when no handling marking is set, rather than inventing one", async () => {
    const unmarked = await readPdf(await renderReportPdf(reportFixture({ handlingMarking: null })));
    for (const page of unmarked) {
      expect(page.text).toContain("NO HANDLING MARKING IS SET FOR THIS ORGANISATION");
    }
  });

  it("states a partial run on the first page, before any finding", () => {
    const first = pages[0]?.text ?? "";
    expect(first).toContain("PARTIAL RUN");
    expect(first).toContain("What was not collected, and why");
    expect(first.indexOf("[FAILED]")).toBeGreaterThan(-1);
    expect(all().indexOf("Coverage and limitations")).toBeLessThan(all().indexOf("Findings"));
  });

  it("footnotes every citation on the page that cites it", () => {
    const document = reportFixture();
    for (const page of pages) {
      const markers = page.items.filter((item) => item.size < 10 && /^[\d,]+$/.test(item.str));
      const cited = new Set(markers.flatMap((item) => item.str.split(",").map(Number)));
      for (const number of cited) {
        const source = document.sources.find((s) => s.number === number);
        expect(source, `source ${String(number)}`).toBeDefined();
        expect(page.text).toContain(`${String(number)}. ${source?.sourceLabel ?? ""}`);
        expect(page.text.replace(/\s+/g, "")).toContain(source?.evidenceId ?? "");
      }
    }
    expect(pages.some((page) => page.items.some((item) => item.size < 10))).toBe(true);
  });

  it("lists every evidence item in the evidence-basis table", () => {
    const text = all().replace(/\s+/g, "");
    expect(all()).toContain("Evidence basis");
    for (const source of reportFixture().sources) expect(text).toContain(source.evidenceId);
  });

  it("prints every attribution", () => {
    expect(all()).toContain("[Attribution text required by source C]");
    expect(all()).toContain("https://attribution.example/");
  });

  it("marks characters the font cannot draw, and counts them, rather than dropping them", async () => {
    const base = reportFixture();
    const [finding] = base.findings;
    if (finding === undefined) return expect.unreachable("fixture has a finding");
    const script = "नमस्ते"; // six Devanagari code points
    const document = reportFixture({
      findings: [
        {
          ...finding,
          claims: [
            {
              ...finding.claims[0],
              display: { text: script, truncated: false },
            } as (typeof finding.claims)[number],
          ],
        },
      ],
    });
    const text = (await readPdf(await renderReportPdf(document))).map((p) => p.text).join(" ");
    expect(text).toContain("??????");
    expect(text).toContain(
      "6 character(s) in this report are outside the embedded font's coverage",
    );
  });

  // REGRESSION (Phase 5 checkpoint): crt.sh lists names one per line, and the
  // renderer dropped the line breaks, printing "example.comwww.example.com".
  it("keeps items separated by line breaks apart, never running them together", async () => {
    const base = reportFixture();
    const [finding] = base.findings;
    if (finding === undefined) return expect.unreachable("fixture has a finding");
    const document = reportFixture({
      findings: [
        {
          ...finding,
          claims: [
            {
              ...finding.claims[0],
              display: { text: "a.example.com\nb.example.com", truncated: false },
            } as (typeof finding.claims)[number],
          ],
        },
      ],
    });
    const text = (await readPdf(await renderReportPdf(document))).map((p) => p.text).join(" ");
    expect(text).toContain("a.example.com / b.example.com");
    expect(text).not.toContain("a.example.comb.example.com");
  });

  it("renders the same report to the same bytes on every download", async () => {
    const first = await renderReportPdf(reportFixture());
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await renderReportPdf(reportFixture());
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
  });

  it("prints only the report's stored wording: changing the code's wording changes nothing", async () => {
    const stored = reportFixture();
    const before = await renderReportPdf(stored);
    const mutable = REPORT_WORDING as unknown as {
      glossary: { strength: string; definition: string }[];
      headings: Record<string, string>;
      marking: Record<string, string>;
    };
    const original = structuredClone(REPORT_WORDING);
    try {
      for (const entry of mutable.glossary) entry.definition = "[changed in code]";
      mutable.headings.glossary = "[changed heading]";
      mutable.marking.set = "[changed marking prefix] {marking}";
      const after = await renderReportPdf(stored);
      expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
      const text = (await readPdf(after)).map((p) => p.text).join(" ");
      expect(text).not.toContain("[changed");
    } finally {
      Object.assign(REPORT_WORDING, original);
    }
  });

  it("prints the glossary as stored, OBSERVED included, with the analysis model named", () => {
    // A definition can wrap across a page break; read the body without the page furniture.
    const text = all()
      .replace(/ *HANDLING: \[TENANT MARKING\] */g, " ")
      .replace(/ *Report [0-9a-f-]{36} */g, " ")
      .replace(/ *Page \d+ of \d+ */g, " ")
      .replace(/\s+/g, " ");
    expect(text).toContain(
      "[OBSERVED] Seen directly by the platform, not taken from anyone's statement.",
    );
    expect(text).toContain(
      "[CORRELATED] A link drawn by the analysis model between two or more independent cited sources.",
    );
    expect(text).toContain(
      "[INFERRED] An analytic inference drawn by the analysis model from the cited evidence. No source stated it.",
    );
  });

  describe("the synthesis provenance", () => {
    /** The rendered text without page furniture, which can fall inside any passage. */
    const bodyOf = (read: readonly PageText[]) =>
      read
        .map((page) => page.text)
        .join(" ")
        .replace(/ *HANDLING: \[TENANT MARKING\] */g, " ")
        .replace(/ *Report [0-9a-f-]{36} */g, " ")
        .replace(/ *Page \d+ of \d+ */g, " ")
        .replace(/\s+/g, " ");
    /** Everything printed between the model line and the first statement. */
    const provenanceOf = (text: string) =>
      text.slice(text.indexOf("Served by:"), text.indexOf("[CORRELATED] [A synthesised")).trim();
    const withModel = async (
      model: Partial<Extract<ReportDocument["synthesis"], { status: "GENERATED" }>["model"]>,
    ) => {
      const fixture = reportFixture();
      if (fixture.synthesis.status !== "GENERATED") throw new Error("synthesis expected");
      return bodyOf(
        await readPdf(
          await renderReportPdf(
            reportFixture({
              synthesis: { ...fixture.synthesis, model: { ...fixture.synthesis.model, ...model } },
            }),
          ),
        ),
      );
    };

    it("names the provider the endpoint named, the endpoint, and the region header as sent", () => {
      expect(provenanceOf(bodyOf(pages))).toBe(
        "Served by: [upstream provider], as the endpoint [endpoint host] reported it. " +
          "The endpoint reported region header x-example-region: [region]. This records what the endpoint said; it is not a guarantee of where the request was processed.",
      );
    });

    it("names the endpoint when it named no provider: it is known where the request went", async () => {
      const text = await withModel({ servedBy: null });
      expect(provenanceOf(text)).toMatch(
        /^Served by: \[endpoint host\], the endpoint this request was sent to\. It named no upstream provider\. /,
      );
      expect(text).not.toContain("[upstream provider]");
      expect(text).not.toContain("not reported");
    });

    it("prints no region line when the response carried no region header", async () => {
      const text = await withModel({ regionHeaders: [] });
      expect(provenanceOf(text)).toBe(
        "Served by: [upstream provider], as the endpoint [endpoint host] reported it.",
      );
      expect(text).not.toContain("region header");
    });

    it("prints a direct endpoint's region header exactly as sent, adding nothing to it", async () => {
      // As Groq answered on 2026-10-01: no provider header, one region header.
      const text = await withModel({
        endpointHost: "api.groq.com",
        servedBy: null,
        regionHeaders: [{ name: "x-groq-region", value: "bom" }],
      });
      expect(provenanceOf(text)).toBe(
        "Served by: api.groq.com, the endpoint this request was sent to. It named no upstream provider. " +
          "The endpoint reported region header x-groq-region: bom. This records what the endpoint said; it is not a guarantee of where the request was processed.",
      );
    });
  });

  it("ships the vendored fonts unmodified", () => {
    const expected: Record<string, string> = {
      "NotoSerif-Regular.ttf": "a7e8ea1ab7e7d368b001c892d6148325fffc849a46e030e55e1bdc597bbe939d",
      "NotoSerif-Italic.ttf": "15d5f8050fc1f142545e7a26a50bd07a0434eca535d4d98aad9d5e8f03741e43",
      "NotoSerif-Bold.ttf": "1b941681106aae26ead3a24c6f15b51f994b1b26adce8742a37ce96648f0fe0a",
    };
    for (const [file, hash] of Object.entries(expected)) {
      const bytes = readFileSync(new URL(`../../assets/fonts/${file}`, import.meta.url));
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(hash);
    }
  });
});
