/**
 * The PDF report: a stored report document laid out for reading, printing in
 * greyscale, and forwarding to people who never log in.
 *
 *   - Serif body text at 12 pt (Noto Serif, embedded, so the text is real
 *     Unicode rather than a WinAnsi approximation). Footnotes, tables, header
 *     and footer are 10 pt; nothing is smaller except citation markers.
 *   - Every claim's strength is printed as text, [REPORTED], never as colour.
 *     All text is black; the only grey is rules.
 *   - Citations are numbered superscripts with a footnote on the same page
 *     naming the source, when it was collected, its URL and its evidence id.
 *   - Coverage and limitations come first, before any finding, so a reader
 *     who stops early has still seen what the report does not cover.
 *   - The handling marking is printed at the top and bottom of every page;
 *     when none is set the page says so rather than inventing one.
 *   - Every attribution a source requires is printed.
 *
 * Ported from the previous codebase's report-pdf.ts (INVENTORY: ADAPT): the
 * page decoration done once the page count is known, word wrapping with a
 * hard split for over-long words. Changed: Helvetica at 9.5 pt and colour
 * coding became serif at 12 pt and text labels; the fixed "UNCLASSIFIED"
 * banner became the tenant's handling marking; characters the font cannot
 * draw are counted and reported instead of silently replaced; the product
 * name comes from configuration.
 */
import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import {
  fillWording,
  type CoverageEntry,
  type ReportDocument,
  type ReportSource,
  type ReportWording,
} from "@repo/core";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// ── Page geometry and type sizes (points) ─────────────────────────────────

const PAGE: [number, number] = [595.28, 841.89]; // A4
const MARGIN_X = 64;
const TOP = PAGE[1] - 78;
const BOTTOM = 70;
const WIDTH = PAGE[0] - MARGIN_X * 2;

export const BODY_SIZE = 12;
const BODY_LEADING = 16.5;
export const SMALL_SIZE = 10;
const SMALL_LEADING = 13;
const H1 = 20;
const H2 = 15;
const H3 = 12.5;
const MARK_SIZE = 7.5;
const MARK_RISE = 4.5;

const INK = rgb(0, 0, 0);
const RULE = rgb(0.55, 0.55, 0.55);

const FONT_DIR = new URL("../../assets/fonts/", import.meta.url);

interface Fonts {
  readonly regular: PDFFont;
  readonly italic: PDFFont;
  readonly bold: PDFFont;
}

// ── Text runs and wrapping ────────────────────────────────────────────────

type Style = "regular" | "italic" | "bold";

/** A paragraph is text runs and citation markers. */
type Span =
  { readonly text: string; readonly style?: Style } | { readonly cite: readonly number[] };

interface Atom {
  readonly text: string;
  readonly font: PDFFont;
  readonly size: number;
  readonly rise: number;
  readonly width: number;
  /** Drawn directly after the previous atom, with no space. */
  readonly glued: boolean;
  readonly cites: readonly number[];
}

interface Line {
  readonly atoms: readonly Atom[];
  readonly cites: readonly number[];
}

class Renderer {
  readonly #doc: PDFDocument;
  readonly #fonts: Fonts;
  readonly #charsets: Map<PDFFont, Set<number>>;
  readonly #document: ReportDocument;
  readonly #sources: Map<number, ReportSource>;
  readonly #pages: { readonly page: PDFPage; readonly notes: number[] }[] = [];
  #y = 0;
  /** Characters the font has no glyph for, shown as "?". Counted, and reported. */
  unrenderable = 0;

  constructor(doc: PDFDocument, fonts: Fonts, document: ReportDocument) {
    this.#doc = doc;
    this.#fonts = fonts;
    this.#charsets = new Map(
      [fonts.regular, fonts.italic, fonts.bold].map((font) => [
        font,
        new Set(font.getCharacterSet()),
      ]),
    );
    this.#document = document;
    this.#sources = new Map(document.sources.map((source) => [source.number, source]));
    this.newPage();
  }

  get pages(): readonly PDFPage[] {
    return this.#pages.map((entry) => entry.page);
  }

  newPage(): void {
    this.#pages.push({ page: this.#doc.addPage(PAGE), notes: [] });
    this.#y = TOP;
  }

  #current() {
    const current = this.#pages.at(-1);
    if (current === undefined) throw new RangeError("the renderer has no page");
    return current;
  }

  /** Text the font can draw: each character it has no glyph for becomes "?", and is counted. */
  #drawable(text: string, font: PDFFont): string {
    const charset = this.#charsets.get(font);
    let out = "";
    // A line break inside a value separates items (crt.sh lists names one per
    // line): it is shown as " / ", never dropped, which would run them together.
    for (const char of text.replace(/\s*[\r\n]+\s*/g, " / ").replace(/\t/g, " ")) {
      const code = char.codePointAt(0) as number;
      if (code < 0x20 || (code >= 0x7f && code < 0xa0)) continue;
      if (charset?.has(code) === true) {
        out += char;
      } else {
        out += "?";
        this.unrenderable += 1;
      }
    }
    return out;
  }

  #font(style: Style | undefined): PDFFont {
    return style === "bold"
      ? this.#fonts.bold
      : style === "italic"
        ? this.#fonts.italic
        : this.#fonts.regular;
  }

  /** Splits spans into atoms, then lines no wider than `width`. */
  wrap(spans: readonly Span[], size: number, width: number): Line[] {
    const atoms: Atom[] = [];
    for (const span of spans) {
      if ("cite" in span) {
        if (span.cite.length === 0) continue;
        const text = span.cite.join(",");
        const font = this.#fonts.regular;
        atoms.push({
          text,
          font,
          size: MARK_SIZE,
          rise: MARK_RISE,
          width: font.widthOfTextAtSize(text, MARK_SIZE),
          glued: true,
          cites: span.cite,
        });
        continue;
      }
      const font = this.#font(span.style);
      const words = this.#drawable(span.text, font).split(/ +/).filter(Boolean);
      for (const word of words) {
        atoms.push(...this.#split(word, font, size, width));
      }
    }

    const lines: Line[] = [];
    let current: Atom[] = [];
    let used = 0;
    const flush = () => {
      if (current.length > 0) {
        lines.push({ atoms: current, cites: current.flatMap((atom) => atom.cites) });
      }
      current = [];
      used = 0;
    };
    for (const atom of atoms) {
      const space = current.length === 0 || atom.glued ? 0 : atom.font.widthOfTextAtSize(" ", size);
      if (used + space + atom.width > width && current.length > 0 && !atom.glued) flush();
      const gap = current.length === 0 || atom.glued ? 0 : atom.font.widthOfTextAtSize(" ", size);
      current.push(atom);
      used += gap + atom.width;
    }
    flush();
    return lines;
  }

  /** A word longer than the line, split by characters; otherwise the word itself. */
  #split(word: string, font: PDFFont, size: number, width: number): Atom[] {
    const atom = (text: string): Atom => ({
      text,
      font,
      size,
      rise: 0,
      width: font.widthOfTextAtSize(text, size),
      glued: false,
      cites: [],
    });
    if (font.widthOfTextAtSize(word, size) <= width) return [atom(word)];
    const parts: Atom[] = [];
    let chunk = "";
    for (const char of word) {
      if (chunk.length > 0 && font.widthOfTextAtSize(chunk + char, size) > width) {
        parts.push(atom(chunk));
        chunk = "";
      }
      chunk += char;
    }
    if (chunk.length > 0) parts.push(atom(chunk));
    return parts;
  }

  // ── Footnotes ──

  #noteText(number: number): string {
    const source = this.#sources.get(number);
    const words = this.#document.wording.footnote;
    if (source === undefined) return fillWording(words.missing, { number: String(number) });
    const collected =
      source.collectedAt === null
        ? words.collectedUnknown
        : fillWording(words.collectedAt, { at: source.collectedAt });
    return fillWording(words.line, {
      number: String(number),
      label: source.sourceLabel,
      collected,
      url: source.sourceUrl === null ? words.noUrl : source.sourceUrl,
      evidenceId: source.evidenceId,
    });
  }

  #noteLines(number: number): Line[] {
    return this.wrap([{ text: this.#noteText(number) }], SMALL_SIZE, WIDTH);
  }

  #notesHeight(numbers: readonly number[]): number {
    if (numbers.length === 0) return 0;
    const lines = numbers.reduce((sum, n) => sum + this.#noteLines(n).length, 0);
    return lines * SMALL_LEADING + 10;
  }

  /** Places one line, moving to a new page first if it and its new footnotes do not fit. */
  line(
    line: Line,
    { size, leading, indent = 0 }: { size: number; leading: number; indent?: number },
  ): void {
    const options = { size, leading };
    const place = () => {
      const current = this.#current();
      const fresh = [...new Set(line.cites)].filter((n) => !current.notes.includes(n));
      const floor = BOTTOM + this.#notesHeight([...current.notes, ...fresh]);
      return { current, fresh, fits: this.#y - options.leading >= floor };
    };
    let placement = place();
    if (!placement.fits) {
      this.newPage();
      placement = place();
    }
    const { current, fresh } = placement;
    current.notes.push(...fresh);
    this.#y -= options.leading;
    let x = MARGIN_X + indent;
    line.atoms.forEach((atom, index) => {
      if (index > 0 && !atom.glued) x += atom.font.widthOfTextAtSize(" ", options.size);
      current.page.drawText(atom.text, {
        x,
        y: this.#y + atom.rise,
        size: atom.size,
        font: atom.font,
        color: INK,
      });
      x += atom.width;
    });
  }

  paragraph(
    spans: readonly Span[],
    options: { size?: number; leading?: number; indent?: number; after?: number } = {},
  ): void {
    const size = options.size ?? BODY_SIZE;
    const leading = options.leading ?? (size <= SMALL_SIZE ? SMALL_LEADING : BODY_LEADING);
    const { indent = 0 } = options;
    for (const line of this.wrap(spans, size, WIDTH - indent)) {
      this.line(line, { size, leading, indent });
    }
    this.#y -= options.after ?? 6;
  }

  heading(text: string, size: number): void {
    // Keep a heading with at least three lines of what follows.
    if (
      this.#y - size * 1.6 - BODY_LEADING * 3 <
      BOTTOM + this.#notesHeight(this.#current().notes)
    ) {
      this.newPage();
    }
    this.#y -= size * 0.6;
    this.paragraph([{ text, style: "bold" }], { size, leading: size * 1.3, after: 4 });
  }

  rule(): void {
    const { page } = this.#current();
    page.drawLine({
      start: { x: MARGIN_X, y: this.#y },
      end: { x: MARGIN_X + WIDTH, y: this.#y },
      thickness: 0.6,
      color: RULE,
    });
    this.#y -= 8;
  }

  /** A paragraph inside a black border: used for the partial-run notice. */
  boxed(spans: readonly Span[]): void {
    const lines = this.wrap(spans, BODY_SIZE, WIDTH - 20);
    const height = lines.length * BODY_LEADING + 14;
    if (this.#y - height < BOTTOM) this.newPage();
    const { page } = this.#current();
    const top = this.#y;
    page.drawRectangle({
      x: MARGIN_X,
      y: top - height,
      width: WIDTH,
      height,
      borderColor: INK,
      borderWidth: 1.4,
    });
    this.#y -= 6;
    for (const line of lines)
      this.line(line, { size: BODY_SIZE, leading: BODY_LEADING, indent: 10 });
    this.#y = top - height - 10;
  }

  space(points: number): void {
    this.#y -= points;
  }

  /**
   * A table: a header row repeated on every page it spans, rows of wrapped
   * cells, and an optional full-width detail line under each row.
   */
  table(
    columns: readonly { readonly title: string; readonly width: number }[],
    rows: readonly { readonly cells: readonly Span[][]; readonly detail: Span[] | null }[],
  ): void {
    const pad = 4;
    const lineRule = (y: number) => {
      this.#current().page.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: MARGIN_X + WIDTH, y },
        thickness: 0.5,
        color: RULE,
      });
    };
    const drawRow = (cells: readonly Line[][], detail: Line[] | null, header: boolean) => {
      const { page } = this.#current();
      let x = MARGIN_X;
      const top = this.#y;
      columns.forEach((column, index) => {
        const lines = cells[index] ?? [];
        let y = top - pad;
        for (const line of lines) {
          y -= SMALL_LEADING;
          let cx = x + pad;
          line.atoms.forEach((atom, i) => {
            if (i > 0 && !atom.glued) cx += atom.font.widthOfTextAtSize(" ", SMALL_SIZE);
            page.drawText(atom.text, {
              x: cx,
              y,
              size: atom.size,
              font: header ? this.#fonts.bold : atom.font,
              color: INK,
            });
            cx += atom.width;
          });
        }
        x += column.width;
      });
      const main = Math.max(...cells.map((lines) => lines.length)) * SMALL_LEADING + pad * 2;
      let y = top - main;
      if (detail !== null) {
        for (const line of detail) {
          y -= SMALL_LEADING;
          let cx = MARGIN_X + pad + 12;
          line.atoms.forEach((atom, i) => {
            if (i > 0 && !atom.glued) cx += atom.font.widthOfTextAtSize(" ", SMALL_SIZE);
            page.drawText(atom.text, { x: cx, y, size: atom.size, font: atom.font, color: INK });
            cx += atom.width;
          });
        }
        y -= pad;
      }
      this.#y = y;
      lineRule(this.#y);
    };
    const wrapCells = (cells: readonly Span[][]) =>
      columns.map((column, index) =>
        this.wrap(cells[index] ?? [], SMALL_SIZE, column.width - pad * 2),
      );
    const headerCells = wrapCells(
      columns.map((column) => [{ text: column.title, style: "bold" as const }]),
    );
    const heightOf = (cells: readonly Line[][], detail: Line[] | null) =>
      Math.max(...cells.map((lines) => lines.length)) * SMALL_LEADING +
      pad * 2 +
      (detail === null ? 0 : detail.length * SMALL_LEADING + pad);
    const header = () => {
      lineRule(this.#y);
      drawRow(headerCells, null, true);
    };
    const floor = () => BOTTOM + this.#notesHeight(this.#current().notes);

    if (this.#y - heightOf(headerCells, null) * 2 < floor()) this.newPage();
    header();
    for (const row of rows) {
      const cells = wrapCells(row.cells);
      const detail =
        row.detail === null ? null : this.wrap(row.detail, SMALL_SIZE, WIDTH - pad * 2 - 12);
      if (this.#y - heightOf(cells, detail) < floor()) {
        this.newPage();
        header();
      }
      drawRow(cells, detail, false);
    }
    this.#y -= 8;
  }

  /** Header, footer and footnotes on every page, now that the page count is known. */
  finish(): void {
    const { wording, handlingMarking: marking } = this.#document;
    const markingText = (
      marking === null ? wording.marking.notSet : fillWording(wording.marking.set, { marking })
    ).toUpperCase();
    const total = this.#pages.length;
    this.#pages.forEach(({ page, notes }, index) => {
      const bold = this.#fonts.bold;
      const regular = this.#fonts.regular;
      const text = this.#drawable(markingText, bold);
      const width = bold.widthOfTextAtSize(text, SMALL_SIZE);
      page.drawText(text, {
        x: (PAGE[0] - width) / 2,
        y: PAGE[1] - 40,
        size: SMALL_SIZE,
        font: bold,
        color: INK,
      });
      page.drawText(text, {
        x: (PAGE[0] - width) / 2,
        y: 28,
        size: SMALL_SIZE,
        font: bold,
        color: INK,
      });
      const left = this.#drawable(
        fillWording(wording.footer.report, { reportId: this.#document.reportId }),
        regular,
      );
      page.drawText(left, { x: MARGIN_X, y: 44, size: SMALL_SIZE, font: regular, color: INK });
      const right = this.#drawable(
        fillWording(wording.footer.page, { page: String(index + 1), pages: String(total) }),
        regular,
      );
      page.drawText(right, {
        x: MARGIN_X + WIDTH - regular.widthOfTextAtSize(right, SMALL_SIZE),
        y: 44,
        size: SMALL_SIZE,
        font: regular,
        color: INK,
      });

      if (notes.length === 0) return;
      const sorted = [...notes].sort((a, b) => a - b);
      let y = BOTTOM + this.#notesHeight(sorted) - 4;
      page.drawLine({
        start: { x: MARGIN_X, y },
        end: { x: MARGIN_X + 140, y },
        thickness: 0.6,
        color: RULE,
      });
      y -= 6;
      for (const number of sorted) {
        for (const line of this.#noteLines(number)) {
          y -= SMALL_LEADING;
          let x = MARGIN_X;
          line.atoms.forEach((atom, i) => {
            if (i > 0 && !atom.glued) x += atom.font.widthOfTextAtSize(" ", SMALL_SIZE);
            page.drawText(atom.text, { x, y, size: atom.size, font: atom.font, color: INK });
            x += atom.width;
          });
        }
      }
    });
  }
}

// ── The document ──────────────────────────────────────────────────────────

const words = (attribute: string) => attribute.replace(/_/g, " ");

function coverageLine(wording: ReportWording, entry: CoverageEntry): Span[] {
  const parts: Span[] = [{ text: `[${wording.states[entry.state]}]`, style: "bold" }];
  const facts: string[] = [];
  if (entry.state === "COLLECTED") {
    facts.push(fillWording(wording.coverage.evidenceItems, { count: String(entry.evidenceCount) }));
  }
  if (entry.reasonCode !== null) facts.push(entry.reasonCode);
  if (entry.detail !== null) facts.push(entry.detail);
  if (entry.attempts !== null) {
    facts.push(fillWording(wording.coverage.attempts, { count: String(entry.attempts) }));
  }
  const sentence = facts.map((fact) => fact.replace(/\.+$/, "")).join(". ");
  return facts.length === 0
    ? [...parts, { text: entry.sourceLabel, style: "bold" }]
    : [...parts, { text: `${entry.sourceLabel}:`, style: "bold" }, { text: `${sentence}.` }];
}

async function loadFonts(doc: PDFDocument): Promise<Fonts> {
  doc.registerFontkit(fontkit);
  const [regular, italic, bold] = await Promise.all(
    ["NotoSerif-Regular.ttf", "NotoSerif-Italic.ttf", "NotoSerif-Bold.ttf"].map((name) =>
      readFile(new URL(name, FONT_DIR)),
    ),
  );
  if (regular === undefined || italic === undefined || bold === undefined) {
    throw new RangeError("the report fonts could not be read");
  }
  return {
    regular: await doc.embedFont(regular, { subset: false }),
    italic: await doc.embedFont(italic, { subset: false }),
    bold: await doc.embedFont(bold, { subset: false }),
  };
}

/**
 * Renders a report document as PDF bytes. Pure layout: no network, no
 * database, and no wording of its own. Every word comes from the stored
 * document (its wording snapshot, its producer, its generation time), so the
 * same report renders to the same bytes whenever it is downloaded.
 */
export async function renderReportPdf(document: ReportDocument): Promise<Uint8Array> {
  const w = document.wording;
  const doc = await PDFDocument.create();
  const generated = new Date(document.generatedAt);
  doc.setTitle(document.title);
  doc.setSubject(fillWording(w.footer.report, { reportId: document.reportId }));
  doc.setCreator(document.producedBy);
  doc.setProducer(document.producedBy);
  // The report's own time, never the download's: the file must not differ per download.
  doc.setCreationDate(generated);
  doc.setModificationDate(generated);
  const fonts = await loadFonts(doc);
  const r = new Renderer(doc, fonts, document);

  // ── Cover ──
  r.paragraph([{ text: document.title, style: "bold" }], { size: H1, leading: H1 * 1.3, after: 8 });
  const types = document.target.types.map((t) => `${t.type} ${t.value}`).join("; ");
  r.paragraph([{ text: w.cover.target, style: "bold" }, { text: document.target.input }], {
    after: 0,
  });
  if (types.length > 0) {
    r.paragraph([{ text: w.cover.collectedAs, style: "bold" }, { text: types }], { after: 0 });
  }
  r.paragraph(
    [
      { text: w.cover.run, style: "bold" },
      {
        text: fillWording(w.cover.runValue, { runId: document.runId, status: document.run.status }),
      },
    ],
    { after: 0 },
  );
  r.paragraph([{ text: w.cover.generated, style: "bold" }, { text: document.generatedAt }], {
    after: 10,
  });
  if (document.coverage.partial) {
    r.boxed([{ text: document.coverage.headline, style: "bold" }]);
  } else {
    r.paragraph([{ text: document.coverage.headline, style: "bold" }]);
  }
  r.rule();

  // ── Coverage and limitations: first, before any finding ──
  r.heading(w.headings.coverage, H2);
  r.paragraph([{ text: document.coverage.headline }]);
  const notCollected = document.coverage.entries.filter((e) => e.state !== "COLLECTED");
  const collected = document.coverage.entries.filter((e) => e.state === "COLLECTED");
  r.heading(w.headings.notCollected, H3);
  if (notCollected.length === 0) {
    r.paragraph([{ text: w.coverage.allCollected }]);
  }
  for (const entry of notCollected) {
    r.paragraph(coverageLine(w, entry), { indent: 12, after: 3 });
  }
  r.heading(w.headings.collected, H3);
  if (collected.length === 0) r.paragraph([{ text: w.coverage.noneCollected }]);
  for (const entry of collected) r.paragraph(coverageLine(w, entry), { indent: 12, after: 3 });
  if (document.coverage.notApplicable.length > 0) {
    r.paragraph([
      { text: w.coverage.notApplicable, style: "italic" },
      { text: document.coverage.notApplicable.map((n) => n.sourceLabel).join("; ") },
    ]);
  }
  r.heading(w.headings.standingLimits, H3);
  for (const caveat of document.coverage.caveats)
    r.paragraph([{ text: `- ${caveat}` }], { indent: 12, after: 3 });
  if (document.omittedClaims > 0) {
    r.paragraph([
      {
        text: fillWording(w.coverage.omittedClaims, { count: String(document.omittedClaims) }),
        style: "bold",
      },
    ]);
  }

  // ── How to read the labels ──
  r.heading(w.headings.glossary, H2);
  for (const { strength, definition } of w.glossary) {
    r.paragraph([{ text: `[${strength}]`, style: "bold" }, { text: definition }], {
      indent: 12,
      after: 3,
    });
  }

  // ── Synthesis ──
  r.heading(w.headings.synthesis, H2);
  const synthesis = document.synthesis;
  if (synthesis.status === "GENERATED") {
    r.paragraph([{ text: synthesis.notice, style: "italic" }], { size: SMALL_SIZE });
    r.paragraph(
      [
        {
          text: fillWording(w.synthesis.model, {
            id: synthesis.model.id,
            licence: synthesis.model.licence,
            profile: synthesis.model.profile,
          }),
          style: "italic",
        },
      ],
      { size: SMALL_SIZE },
    );
    // Where it was produced: the endpoint is always known (configuration); an
    // upstream provider only when the endpoint named one.
    const { endpointHost, servedBy, regionHeaders } = synthesis.model;
    r.paragraph(
      [
        {
          text:
            servedBy === null
              ? fillWording(w.synthesis.servedByEndpoint, { endpoint: endpointHost })
              : fillWording(w.synthesis.servedBy, { provider: servedBy, endpoint: endpointHost }),
          style: "italic",
        },
      ],
      { size: SMALL_SIZE },
    );
    // Region headers exactly as the endpoint sent them, never interpreted; no line without one.
    for (const header of regionHeaders) {
      r.paragraph(
        [
          {
            text: fillWording(w.synthesis.regionHeader, { name: header.name, value: header.value }),
            style: "italic",
          },
        ],
        { size: SMALL_SIZE },
      );
    }
    for (const statement of synthesis.statements) {
      r.paragraph(
        [
          { text: `[${statement.strength}]`, style: "bold" },
          { text: statement.text },
          { cite: statement.citations },
        ],
        { indent: 12 },
      );
    }
  } else if (synthesis.status === "NOT_REQUESTED") {
    r.paragraph([
      {
        text: w.synthesis.notRequested,
        style: "italic",
      },
    ]);
  } else {
    r.paragraph([
      { text: fillWording(w.synthesis.none, { reason: synthesis.reason }), style: "italic" },
    ]);
  }

  // ── Findings ──
  r.heading(w.headings.findings, H2);
  if (document.findings.length === 0) {
    r.paragraph([{ text: w.findings.none, style: "italic" }]);
  }
  for (const entity of document.findings) {
    const id =
      entity.identifier === null || entity.identifier === entity.displayName
        ? ""
        : ` (${entity.identifier})`;
    r.heading(`${entity.kind.replace(/_/g, " ")}: ${entity.displayName}${id}`, H3);
    for (const claim of entity.claims) {
      r.paragraph(
        [
          { text: `[${claim.strength}]`, style: "bold" },
          { text: `${words(claim.attribute)}:`, style: "italic" },
          { text: claim.display.text.length === 0 ? w.findings.emptyValue : claim.display.text },
          ...(claim.display.truncated
            ? [
                {
                  text: w.findings.shortened,
                  style: "italic",
                } as const,
              ]
            : []),
          { cite: claim.citations },
        ],
        { indent: 12, after: 4 },
      );
    }
  }

  if (document.relationships.length > 0) {
    r.heading(w.headings.relationships, H2);
    for (const relationship of document.relationships) {
      r.paragraph(
        [
          { text: `[${relationship.strength}]`, style: "bold" },
          {
            text: `${relationship.from.displayName} ${words(relationship.kind)} ${relationship.to.displayName}`,
          },
          { cite: relationship.citations },
        ],
        { indent: 12, after: 3 },
      );
    }
  }

  if (document.untrustedContent.length > 0) {
    r.heading(w.headings.untrustedContent, H2);
    r.paragraph([
      {
        text: w.untrustedContent.intro,
      },
    ]);
    for (const warning of document.untrustedContent) {
      r.paragraph(
        [
          {
            text: fillWording(w.untrustedContent.line, {
              number: String(warning.sourceNumber),
              patterns: warning.patterns.join(", "),
            }),
          },
          { cite: [warning.sourceNumber] },
        ],
        { indent: 12, after: 3 },
      );
    }
  }

  // ── Evidence basis ──
  r.heading(w.headings.evidenceBasis, H2);
  r.paragraph(
    [
      {
        text: w.evidence.intro,
      },
    ],
    { size: SMALL_SIZE },
  );
  if (document.sources.length === 0) {
    r.paragraph([{ text: w.evidence.none, style: "italic" }]);
  } else {
    r.table(
      [
        { title: w.evidence.columns.number, width: 32 },
        { title: w.evidence.columns.source, width: 150 },
        { title: w.evidence.columns.collected, width: 144 },
        { title: w.evidence.columns.strength, width: 86 },
        { title: w.evidence.columns.claims, width: WIDTH - 32 - 150 - 144 - 86 },
      ],
      document.sources.map((source) => ({
        cells: [
          [{ text: String(source.number), style: "bold" }],
          [{ text: source.sourceLabel }],
          [{ text: source.collectedAt === null ? w.evidence.notRecorded : source.collectedAt }],
          [{ text: `[${source.strength}]`, style: "bold" }],
          [{ text: String(source.claimCount) }],
        ],
        detail: [
          {
            text: fillWording(w.evidence.detail, {
              evidenceId: source.evidenceId,
              contentHash: source.contentHash,
              url: source.sourceUrl === null ? w.evidence.noUrl : source.sourceUrl,
            }),
          },
        ],
      })),
    );
  }

  // ── Attribution ──
  r.heading(w.headings.attribution, H2);
  if (document.attributions.length === 0) {
    r.paragraph([{ text: w.attribution.none }]);
  }
  for (const attribution of document.attributions) {
    r.paragraph([{ text: attribution.text, style: "bold" }, { text: attribution.url }], {
      indent: 12,
      after: 3,
    });
  }

  // ── Rendering notes: always last, so the count covers everything above ──
  if (r.unrenderable > 0) {
    const count = r.unrenderable;
    r.heading(w.headings.renderingNote, H2);
    r.paragraph([
      {
        text: fillWording(w.renderingNote, { count: String(count) }),
      },
    ]);
  }

  r.finish();
  return doc.save();
}
