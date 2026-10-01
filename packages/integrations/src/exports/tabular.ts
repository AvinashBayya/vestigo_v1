/**
 * Report exports as data: JSON (the report document itself), CSV (one row
 * per claim or relationship), and a Maltego-compatible graph (an edge list
 * for Maltego's "Import Graph from Table").
 *
 * Every row carries what must travel with the data when it is forwarded: the
 * handling marking, whether the run was partial, the claim's strength as
 * text, the evidence it cites, and the attribution its sources require. A
 * CSV has no room for a coverage section, so the JSON export is the complete
 * record and the tabular ones say where to find it.
 *
 * Ported from the previous codebase's maltego-export.ts (INVENTORY: KEEP):
 * the edge-list shape, one row per relationship, unconnected entities kept as
 * single-entity rows, RFC 4180 quoting, and the original kind kept beside the
 * Maltego type because the type mapping is best effort. Fixed, with a
 * regression test: a cell beginning with =, +, -, @, a tab or a carriage
 * return is written with a leading apostrophe, so a collected value such as
 * `=HYPERLINK(...)` is never executed as a formula when the file is opened
 * in a spreadsheet.
 */
import type { EntityKind, ReportDocument, ReportEndpoint, ReportSource } from "@repo/core";

/** RFC 4180 quoting, after neutralising spreadsheet formulas. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(",");
}

/** A claim's value as it goes into a cell: strings as they are, everything else as JSON. */
function cellValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function attributionsFor(document: ReportDocument, sources: readonly ReportSource[]): string {
  const collectors = new Set(sources.map((source) => source.collectorId));
  return document.attributions
    .filter((attribution) => attribution.collectorIds.some((id) => collectors.has(id)))
    .map((attribution) => `${attribution.text} (${attribution.url})`)
    .join("; ");
}

function sourcesOf(document: ReportDocument, numbers: readonly number[]): ReportSource[] {
  return document.sources.filter((source) => numbers.includes(source.number));
}

const marking = (document: ReportDocument): string =>
  document.handlingMarking === null ? "not set" : document.handlingMarking;

export const REPORT_CSV_HEADERS = [
  "report_id",
  "handling_marking",
  "run_status",
  "run_partial",
  "row_type",
  "entity_kind",
  "entity",
  "entity_identifier",
  "attribute",
  "value",
  "strength",
  "citations",
  "evidence_ids",
  "source_labels",
  "source_urls",
  "collected_at",
  "attribution",
] as const;

/** One row per claim, then one per relationship. */
export function renderReportCsv(document: ReportDocument): string {
  const common = [
    document.reportId,
    marking(document),
    document.run.status,
    String(document.coverage.partial),
  ];
  const cited = (numbers: readonly number[]) => {
    const sources = sourcesOf(document, numbers);
    return [
      numbers.join(";"),
      sources.map((s) => s.evidenceId).join(";"),
      sources.map((s) => s.sourceLabel).join(";"),
      sources.map((s) => (s.sourceUrl === null ? "not recorded" : s.sourceUrl)).join(";"),
      sources.map((s) => (s.collectedAt === null ? "not recorded" : s.collectedAt)).join(";"),
      attributionsFor(document, sources),
    ];
  };
  const rows = [csvRow(REPORT_CSV_HEADERS)];
  for (const entity of document.findings) {
    for (const claim of entity.claims) {
      rows.push(
        csvRow([
          ...common,
          "claim",
          entity.kind,
          entity.displayName,
          entity.identifier === null ? "" : entity.identifier,
          claim.attribute,
          cellValue(claim.value),
          claim.strength,
          ...cited(claim.citations),
        ]),
      );
    }
  }
  for (const relationship of document.relationships) {
    rows.push(
      csvRow([
        ...common,
        "relationship",
        relationship.from.kind,
        relationship.from.displayName,
        relationship.from.identifier === null ? "" : relationship.from.identifier,
        relationship.kind,
        relationship.to.displayName,
        relationship.strength,
        ...cited(relationship.citations),
      ]),
    );
  }
  return `${rows.join("\r\n")}\r\n`;
}

/**
 * Maltego stock entity types for each entity kind. A best-effort mapping,
 * not verified against a live Maltego installation (the previous codebase
 * said the same of its mapping): every row also carries the platform's own
 * kind, so an analyst can remap a column at import.
 */
export const MALTEGO_TYPE: Readonly<Record<EntityKind, string>> = {
  PERSON: "maltego.Person",
  ORGANIZATION: "maltego.Organization",
  DOMAIN: "maltego.Domain",
  IP_ADDRESS: "maltego.IPv4Address",
  EMAIL_ADDRESS: "maltego.EmailAddress",
  USERNAME: "maltego.Alias",
  PHONE_NUMBER: "maltego.PhoneNumber",
  URL: "maltego.URL",
  SOCIAL_ACCOUNT: "maltego.Alias",
  LOCATION: "maltego.Location",
};

export const MALTEGO_CSV_HEADERS = [
  "Source Maltego Type",
  "Source Kind",
  "Source Value",
  "Source Display Name",
  "Relationship",
  "Relationship Strength",
  "Citations",
  "Target Maltego Type",
  "Target Kind",
  "Target Value",
  "Target Display Name",
  "Attribution",
  "Handling Marking",
  "Report",
] as const;

function maltegoType(
  endpoint: Pick<ReportEndpoint, "kind" | "identifier" | "displayName">,
): string {
  const value = endpoint.identifier === null ? endpoint.displayName : endpoint.identifier;
  return endpoint.kind === "IP_ADDRESS" && value.includes(":")
    ? "maltego.IPv6Address"
    : MALTEGO_TYPE[endpoint.kind];
}

function endpointColumns(endpoint: Pick<ReportEndpoint, "kind" | "identifier" | "displayName">) {
  return [
    maltegoType(endpoint),
    endpoint.kind,
    endpoint.identifier === null ? endpoint.displayName : endpoint.identifier,
    endpoint.displayName,
  ];
}

/** An edge list: one row per relationship; each entity with no relationship on a row of its own. */
export function renderMaltegoCsv(document: ReportDocument): string {
  // A graph row holds entities, not the claims behind them, so it cannot say
  // which sources it rests on: every row carries every attribution the
  // report requires, and none can be lost with a row.
  const everyAttribution = document.attributions
    .map((attribution) => `${attribution.text} (${attribution.url})`)
    .join("; ");
  const rows = [csvRow(MALTEGO_CSV_HEADERS)];
  const linked = new Set<string>();
  for (const relationship of document.relationships) {
    linked.add(relationship.from.entityId);
    linked.add(relationship.to.entityId);
    rows.push(
      csvRow([
        ...endpointColumns(relationship.from),
        relationship.kind,
        relationship.strength,
        relationship.citations.join(";"),
        ...endpointColumns(relationship.to),
        everyAttribution,
        marking(document),
        document.reportId,
      ]),
    );
  }
  for (const entity of document.findings) {
    if (linked.has(entity.entityId)) continue;
    const citations = [...new Set(entity.claims.flatMap((claim) => claim.citations))];
    rows.push(
      csvRow([
        ...endpointColumns(entity),
        "",
        "",
        citations.join(";"),
        "",
        "",
        "",
        "",
        everyAttribution,
        marking(document),
        document.reportId,
      ]),
    );
  }
  return `${rows.join("\r\n")}\r\n`;
}

/** The report document itself: the complete record, including coverage and limitations. */
export function renderReportJson(document: ReportDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
