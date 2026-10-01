/**
 * Every format a report can be exported in. A format is listed here or it
 * does not exist: the API offers exactly these, and the attribution test
 * renders every one of them for every source that requires attribution, so a
 * format that cannot carry attribution fails CI.
 */
import type { ReportDocument } from "@repo/core";
import { renderReportPdf } from "./pdf.ts";
import { renderMaltegoCsv, renderReportCsv, renderReportJson } from "./tabular.ts";

export interface ExportFormat {
  readonly contentType: string;
  /** The file name's ending, after the report id. */
  readonly extension: string;
  readonly render: (document: ReportDocument) => Promise<Uint8Array>;
}

const text = (render: (document: ReportDocument) => string) => (document: ReportDocument) =>
  Promise.resolve(new TextEncoder().encode(render(document)));

export const REPORT_EXPORT_FORMATS = {
  pdf: { contentType: "application/pdf", extension: "pdf", render: renderReportPdf },
  json: { contentType: "application/json", extension: "json", render: text(renderReportJson) },
  csv: { contentType: "text/csv; charset=utf-8", extension: "csv", render: text(renderReportCsv) },
  maltego: {
    contentType: "text/csv; charset=utf-8",
    extension: "maltego.csv",
    render: text(renderMaltegoCsv),
  },
} as const satisfies Readonly<Record<string, ExportFormat>>;

export type ReportExportFormat = keyof typeof REPORT_EXPORT_FORMATS;
export const REPORT_EXPORT_FORMAT_NAMES = Object.keys(REPORT_EXPORT_FORMATS) as [
  ReportExportFormat,
  ...ReportExportFormat[],
];
