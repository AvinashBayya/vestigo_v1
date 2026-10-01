/**
 * Data exports (JSON, CSV, Maltego) and the attribution rule: a source that
 * requires attribution has it rendered in every export format. A format that
 * cannot carry it fails here.
 */
import { PLATFORM_SOURCES } from "@repo/collectors";
import type { ReportDocument } from "@repo/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import {
  csvCell,
  MALTEGO_CSV_HEADERS,
  REPORT_CSV_HEADERS,
  REPORT_EXPORT_FORMAT_NAMES,
  REPORT_EXPORT_FORMATS,
  renderMaltegoCsv,
  renderReportCsv,
  renderReportJson,
} from "../../src/index.ts";
import { reportFixture } from "../report-fixture.ts";

/** Minimal RFC 4180 parser for reading exports back. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else cell += c;
  }
  return rows;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
  const parts: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const content = await (await pdf.getPage(n)).getTextContent();
    for (const item of content.items) if ("str" in item) parts.push(item.str);
  }
  return parts.join(" ");
}

describe("csv cells", () => {
  it("quote commas, quotes and line breaks (RFC 4180)", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "x"')).toBe('"say ""x"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("plain")).toBe("plain");
  });

  // REGRESSION (legacy maltego-export.ts): collected values went into cells
  // as they were, so "=HYPERLINK(...)" ran as a formula when opened.
  it("neutralise spreadsheet formulas in collected values", () => {
    for (const payload of [
      '=HYPERLINK("https://attacker.invalid")',
      "+1+1",
      "-2+3",
      "@SUM(A1)",
      "\t=1",
    ]) {
      expect(csvCell(payload).replace(/^"/, "").startsWith("'"), payload).toBe(true);
    }
  });
});

describe("the CSV export", () => {
  const rows = parseCsv(renderReportCsv(reportFixture()));

  it("has one row per claim and per relationship, under its header", () => {
    expect(rows[0]).toEqual([...REPORT_CSV_HEADERS]);
    const document = reportFixture();
    const claims = document.findings.flatMap((f) => f.claims).length;
    expect(rows.length - 1).toBe(claims + document.relationships.length);
  });

  it("carries the marking, the partial run, the strength and the citations on every row", () => {
    const at = (name: (typeof REPORT_CSV_HEADERS)[number]) => REPORT_CSV_HEADERS.indexOf(name);
    for (const row of rows.slice(1)) {
      expect(row[at("handling_marking")]).toBe("[TENANT MARKING]");
      expect(row[at("run_partial")]).toBe("true");
      expect(row[at("strength")]).toMatch(
        /^(OBSERVED|REPORTED|DERIVED|CORRELATED|INFERRED|HYPOTHESIS)$/,
      );
      expect(row[at("evidence_ids")]).toMatch(/^[0-9a-f-]{36}/);
    }
  });

  it("keeps the full value, where the PDF shortens it", () => {
    const at = REPORT_CSV_HEADERS.indexOf("value");
    expect(rows.some((row) => row[at] === "[long value]")).toBe(true);
  });
});

describe("the Maltego export", () => {
  const rows = parseCsv(renderMaltegoCsv(reportFixture()));

  it("is an edge list with the platform's kind beside the Maltego type", () => {
    expect(rows[0]).toEqual([...MALTEGO_CSV_HEADERS]);
    const edge = rows.find((row) => row[4] === "subdomain_of");
    expect(edge?.slice(0, 4)).toEqual([
      "maltego.Domain",
      "DOMAIN",
      "www.example.com",
      "www.example.com",
    ]);
    expect(edge?.slice(7, 11)).toEqual(["maltego.Domain", "DOMAIN", "example.com", "example.com"]);
    expect(edge?.[5]).toBe("DERIVED");
  });

  it("keeps an entity with no relationship on a row of its own", () => {
    const document = reportFixture({ relationships: [] });
    const standalone = parseCsv(renderMaltegoCsv(document));
    expect(standalone).toHaveLength(2);
    expect(standalone[1]?.slice(0, 3)).toEqual(["maltego.Domain", "DOMAIN", "example.com"]);
  });
});

describe("the JSON export", () => {
  it("is the whole report document, coverage and limitations included", () => {
    const parsed = JSON.parse(renderReportJson(reportFixture())) as ReportDocument;
    expect(parsed).toEqual(reportFixture());
    expect(parsed.coverage.entries.some((entry) => entry.state === "FAILED")).toBe(true);
  });
});

describe("attribution in every export format", () => {
  const requiring = PLATFORM_SOURCES.filter((source) => source.attribution !== null);

  it("is tested against the catalogue's real attribution requirements", () => {
    expect(requiring.length).toBeGreaterThan(0);
  });

  it.each(REPORT_EXPORT_FORMAT_NAMES)("%s renders every required attribution", async (format) => {
    for (const source of requiring) {
      if (source.attribution === null) continue;
      const base = reportFixture();
      const document = reportFixture({
        attributions: [
          {
            sourceId: source.id,
            text: source.attribution.text,
            url: source.attribution.url,
            collectorIds: ["[collector-c]"],
          },
        ],
      });
      expect(base.sources.some((s) => s.collectorId === "[collector-c]")).toBe(true);
      const bytes = await REPORT_EXPORT_FORMATS[format].render(document);
      const rendered = format === "pdf" ? await pdfText(bytes) : new TextDecoder().decode(bytes);
      expect(rendered, `${format} / ${source.id}`).toContain(source.attribution.text);
      expect(rendered, `${format} / ${source.id}`).toContain(source.attribution.url);
    }
  });
});
