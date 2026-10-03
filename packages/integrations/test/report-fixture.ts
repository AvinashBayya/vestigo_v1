/**
 * A report document for renderer tests. SYNTHETIC: written to exercise every
 * section, with bracketed placeholders and reserved example domains. It is
 * not the output of any run; the engine's own tests build real ones.
 */
import { REPORT_WORDING, type ReportDocument } from "@repo/core";

const EVIDENCE = [
  "01900000-0000-7000-8000-000000000001",
  "01900000-0000-7000-8000-000000000002",
  "01900000-0000-7000-8000-000000000003",
] as const;

export function reportFixture(overrides: Partial<ReportDocument> = {}): ReportDocument {
  return {
    formatVersion: 3,
    reportId: "00000000-0000-4000-8000-00000000a001",
    title: "[Investigation title]",
    investigationId: "00000000-0000-4000-8000-00000000a002",
    runId: "00000000-0000-4000-8000-00000000a003",
    target: { input: "example.com", types: [{ type: "DOMAIN", value: "example.com" }] },
    run: {
      status: "PARTIAL",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
    },
    generatedAt: "2026-01-01T00:02:00.000Z",
    handlingMarking: "[TENANT MARKING]",
    coverage: {
      runStatus: "PARTIAL",
      partial: true,
      headline:
        "PARTIAL RUN: 1 of 3 planned collectors did not complete, so this report does not cover what they would have collected (2 found something, 0 found nothing).",
      entries: [
        {
          collectorId: "[collector-a]",
          sourceLabel: "[Source A label]",
          state: "COLLECTED",
          targetType: "DOMAIN",
          reasonCode: null,
          detail: null,
          evidenceCount: 2,
          attempts: 1,
        },
        {
          collectorId: "[collector-b]",
          sourceLabel: "[Source B label]",
          state: "FAILED",
          targetType: "DOMAIN",
          reasonCode: "UPSTREAM_UNAVAILABLE",
          detail: "[The upstream answered HTTP 503.]",
          evidenceCount: 0,
          attempts: 3,
        },
        {
          collectorId: "[collector-c]",
          sourceLabel: "[Source C label]",
          state: "COLLECTED",
          targetType: "DOMAIN",
          reasonCode: null,
          detail: null,
          evidenceCount: 1,
          attempts: 1,
        },
        {
          collectorId: "[collector-d]",
          sourceLabel: "[Source D label]",
          state: "HELD",
          targetType: "DOMAIN",
          reasonCode: "COLLECTOR_HELD",
          detail: "[Held off the platform.]",
          evidenceCount: 0,
          attempts: null,
        },
      ],
      notApplicable: [{ collectorId: "[collector-e]", sourceLabel: "[Source E label]" }],
      caveats: ["[Standing caveat one.]", "[Standing caveat two.]"],
    },
    findings: [
      {
        entityId: "00000000-0000-4000-8000-00000000e001",
        kind: "DOMAIN",
        displayName: "example.com",
        identifier: "example.com",
        claims: [
          {
            claimId: "00000000-0000-4000-8000-00000000c001",
            attribute: "registrar",
            value: "[Registrar name]",
            display: { text: "[Registrar name]", truncated: false },
            strength: "REPORTED",
            citations: [1],
          },
          {
            claimId: "00000000-0000-4000-8000-00000000c002",
            attribute: "archive_coverage",
            value: "[coverage note]",
            display: { text: "[coverage note]", truncated: false },
            strength: "DERIVED",
            citations: [2],
          },
          {
            claimId: "00000000-0000-4000-8000-00000000c003",
            attribute: "long_value",
            value: "[long value]",
            display: { text: "[a long value shortened for display]", truncated: true },
            strength: "REPORTED",
            citations: [3],
          },
        ],
      },
    ],
    relationships: [
      {
        relationshipId: "00000000-0000-4000-8000-00000000f001",
        from: {
          entityId: "00000000-0000-4000-8000-00000000e002",
          kind: "DOMAIN",
          displayName: "www.example.com",
          identifier: "www.example.com",
        },
        kind: "subdomain_of",
        to: {
          entityId: "00000000-0000-4000-8000-00000000e001",
          kind: "DOMAIN",
          displayName: "example.com",
          identifier: "example.com",
        },
        strength: "DERIVED",
        citations: [2],
      },
    ],
    sources: EVIDENCE.map((evidenceId, index) => ({
      number: index + 1,
      evidenceId,
      collectorId: index === 2 ? "[collector-c]" : "[collector-a]",
      sourceLabel: index === 2 ? "[Source C label]" : "[Source A label]",
      sourceUrl: `https://source.example/${String(index + 1)}`,
      collectedAt: "2026-01-01T00:00:30.000Z",
      observedAt: null,
      contentHash: `sha256:${"0".repeat(63)}${String(index + 1)}`,
      strength: "REPORTED" as const,
      claimCount: 1,
    })),
    synthesis: {
      status: "GENERATED",
      model: {
        id: "Qwen/Qwen3-32B",
        licence: "Apache-2.0",
        profile: "hosted",
        endpointHost: "[endpoint host]",
        servedBy: "[upstream provider]",
        regionHeaders: [{ name: "x-example-region", value: "[region]" }],
      },
      statements: [
        {
          text: "[A synthesised statement linking two sources.]",
          strength: "CORRELATED",
          citations: [1, 3],
        },
        { text: "[An inference from one source.]", strength: "INFERRED", citations: [2] },
      ],
      generatedAt: "2026-01-01T00:02:00.000Z",
      attempts: 1,
      notice: "[Synthesis notice.]",
    },
    attributions: [
      {
        sourceId: "[source-c]",
        text: "[Attribution text required by source C]",
        url: "https://attribution.example/",
        collectorIds: ["[collector-c]"],
      },
    ],
    untrustedContent: [{ sourceNumber: 3, patterns: ["addressed-to-ai"] }],
    omittedClaims: 0,
    wording: structuredClone(REPORT_WORDING),
    producedBy: "[product]",
    ...overrides,
  };
}

/**
 * A large report for the renderer's performance test. SYNTHETIC, shaped like
 * the Phase 5 live checkpoint's report of example.com (615 claims, almost all
 * archive captures on one entity): two claim shapes of about 145 and 330
 * characters, alternating between two sources whose footnotes carry long query
 * URLs. Bracketed placeholders throughout; no value is a real capture.
 */
export function largeReportFixture(claimCount: number): ReportDocument {
  const base = reportFixture();
  const pad = (n: number) => String(n).padStart(4, "0");
  const sources = [1, 2, 3].map((number) => ({
    number,
    evidenceId: `01900000-0000-7000-8000-${String(number).padStart(12, "0")}`,
    collectorId: `[collector-${String(number)}]`,
    sourceLabel: `[Source ${String(number)} label]`,
    sourceUrl: `https://source.example/[query-${String(number)}]?url=example.com&output=json&fl=[fields-a],[fields-b],[fields-c]&limit=[limit]&from=[from-time]&to=[to-time]&page=[page]`,
    collectedAt: "2026-01-01T00:00:30.000Z",
    observedAt: null,
    contentHash: `sha256:${"0".repeat(63)}${String(number)}`,
    strength: "REPORTED" as const,
    claimCount: number === 1 ? 1 : Math.ceil(claimCount / 2),
  }));
  const claims = Array.from({ length: claimCount }, (_, index) => {
    const n = pad(index + 1);
    const archived = index % 2 === 0;
    const text = archived
      ? `digest: [digest-${n}-ABCDEFGHIJKLMNOPQRSTUV]; mimeType: [mime-type]; timestamp: [timestamp-${n}]; originalUrl: https://example.com/[path-${n}]; statusCode: [status]; length: [length-${n}]`
      : `url: https://example.com/[path-${n}]; mime: [mime-type]; digest: [digest-${n}-ABCDEFGHIJKLMNOPQRSTUV]; status: [status]; languages: [languages]; timestamp: [timestamp-${n}]; length: [length-${n}]; offset: [offset-${n}]; filename: [crawl-segment]/[segment-${n}]/warc/[file-${n}].warc.gz; encoding: [encoding]; truncated: [truncated]`;
    return {
      claimId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      attribute: archived ? "archived_capture" : "crawled_capture",
      value: text,
      display: { text, truncated: false },
      strength: "REPORTED" as const,
      citations: [archived ? 2 : 3],
    };
  });
  return {
    ...base,
    findings: [
      {
        entityId: "00000000-0000-4000-8000-00000000e001",
        kind: "DOMAIN",
        displayName: "example.com",
        identifier: "example.com",
        claims: [...(base.findings[0]?.claims.slice(0, 1) ?? []), ...claims],
      },
    ],
    sources,
    attributions: [],
    untrustedContent: [],
  };
}
