/**
 * Person-data gate guard (CLAUDE.md §9): "use the shared gate, never a local
 * copy", enforced rather than remembered.
 *
 * Whether a read may show person data is decided in one place in the apps,
 * apps/api/src/http/person-gate.ts. Whether data IS person data is answered in
 * one place, the probe in packages/db. Each decision is built from a few
 * recognisable pieces: an access decision from @repo/access, a collector
 * discipline compared with the person discipline, or the person module
 * compared by name. This scan fails on any of those pieces outside the files
 * that are their home.
 *
 * The homes (and only these):
 *   - apps/api/src/http/person-gate.ts: the shared read gate.
 *   - packages/access/src/: every access decision is made there (CLAUDE.md §6),
 *     with its tests.
 *   - packages/collectors/src/runtime.ts: collection-time admission, which
 *     decides whether a collector may be dispatched at all. A different gate
 *     from reading what was collected.
 *   - packages/db/src/repositories/exploration.ts: the person-data probe.
 *
 * A grep-style guard catches the plain forms of a copy, not every possible
 * disguise (a switch on a discipline reads like a switch on an entity kind).
 * The behaviour itself is pinned by the gate's lifecycle tests.
 *
 * This file describes the patterns in words where it can, because it is
 * scanned too.
 */
import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { listSourceFiles } from "./fabrication.ts";

export interface GateCopyCheck {
  readonly name: string;
  readonly regex: RegExp;
  readonly note: string;
}

const QUOTE = "[\"'`]";
const COMPARE = "(?:===|!==|==|!=|<>|=|\\s+in\\s*\\(\\s*)";

export const GATE_COPY_CHECKS: readonly GateCopyCheck[] = [
  {
    name: "person-access-decision",
    // A call of the discipline or module access decision.
    regex: new RegExp("\\bdecide(?:Discipline|Module)Access\\s*\\("),
    note: "decides module or discipline access outside the shared gate: call requirePersonAccess or personLockFor (apps/api/src/http/person-gate.ts)",
  },
  {
    name: "discipline-module-lookup",
    regex: new RegExp("\\bDISCIPLINE_MODULE\\s*\\["),
    note: "maps a discipline to its module outside @repo/access",
  },
  {
    name: "person-discipline-comparison",
    // A discipline compared with the person discipline, in code or in SQL,
    // either way round, or through a query builder's comparison.
    regex: new RegExp(
      [
        `discipline${QUOTE}?\\]?\\s*${COMPARE}\\s*${QUOTE}PERSON\\b`,
        `${QUOTE}PERSON${QUOTE}\\s*(?:===|!==|==|!=)\\s*[\\w$.?!\\[\\]"']*discipline`,
        `\\b(?:eq|ne|inArray|notInArray)\\(\\s*[\\w$.]*discipline\\s*,\\s*\\[?\\s*${QUOTE}PERSON\\b`,
      ].join("|"),
      "i",
    ),
    note: "decides whether data is person data outside the probe: use the PersonProbe (packages/db) through the shared gate",
  },
  {
    name: "person-module-comparison",
    regex: new RegExp(
      `${QUOTE}PERSON_INVESTIGATION${QUOTE}\\s*(?:===|!==|==|!=)|(?:===|!==|==|!=)\\s*${QUOTE}PERSON_INVESTIGATION${QUOTE}`,
    ),
    note: "compares the person module by name outside @repo/access",
  },
];

/** Where the pieces of the gate may appear: a file path, or a directory ending in "/". */
export const GATE_HOMES: readonly string[] = [
  "apps/api/src/http/person-gate.ts",
  "packages/access/src/",
  "packages/collectors/src/runtime.ts",
  "packages/db/src/repositories/exploration.ts",
];

const isHome = (file: string): boolean =>
  GATE_HOMES.some((home) => (home.endsWith("/") ? file.startsWith(home) : file === home));

export interface GateCopyMatch {
  readonly check: string;
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** The gate's pieces in one file; none for a file that is one of their homes. */
export function scanForGateCopies(file: string, content: string): GateCopyMatch[] {
  if (isHome(file)) return [];
  const matches: GateCopyMatch[] = [];
  content.split(/\r?\n/).forEach((text, index) => {
    for (const check of GATE_COPY_CHECKS) {
      if (check.regex.test(text)) {
        matches.push({ check: check.name, file, line: index + 1, text: text.trim() });
      }
    }
  });
  return matches;
}

export function scanRepositoryForGateCopies(root: string): {
  readonly filesScanned: number;
  readonly matches: readonly GateCopyMatch[];
} {
  const files = listSourceFiles(root);
  const matches = files.flatMap((file) =>
    scanForGateCopies(relative(root, file).split(sep).join("/"), readFileSync(file, "utf8")),
  );
  return { filesScanned: files.length, matches };
}

/** How a route meets the gate: its handler calls the shared gate, or why it need not. */
export type RouteGating = "shared-gate" | { readonly why: string };

const ANALYST_CASE = "The analyst's own case fields";
const IDENTITY = "Identity and membership, not collected data.";

/**
 * Every route of the API, file by file, classified by the D-10 route audit (2026-10-08).
 * A "shared-gate" route's handler must call the shared gate; any other states why it need
 * not. Every file under apps/api/src/routes is either here or in ROUTE_FILES_UNSCANNED, and
 * a route registered in one of these files fails the guard until it is classified.
 */
export const ROUTE_GATING: Readonly<Record<string, Readonly<Record<string, RouteGating>>>> = {
  "apps/api/src/routes/cases.ts": {
    "POST /api/v1/cases": { why: `${ANALYST_CASE}: title and description.` },
    "GET /api/v1/cases": {
      why: `${ANALYST_CASE} and a measured count of pins, which counts analyst actions and is never lowered (docs/PLAN.md, Phase 6a: cases are not gated).`,
    },
    "GET /api/v1/cases/:id": { why: `${ANALYST_CASE} and the measured pin count, as the list.` },
    "PATCH /api/v1/cases/:id": {
      why: `As the case read: changes ${ANALYST_CASE.toLowerCase()} and returns them with the measured pin count.`,
    },
    "POST /api/v1/cases/:id/pins": "shared-gate",
    "GET /api/v1/cases/:id/pins": "shared-gate",
    "DELETE /api/v1/cases/:id/pins/:pinId": {
      why: "Removes a pin and returns nothing; the pinned record is untouched.",
    },
  },
  "apps/api/src/routes/entities.ts": {
    "GET /api/v1/entities": "shared-gate",
    "GET /api/v1/entities/merge-candidates": "shared-gate",
    "GET /api/v1/entities/:id": "shared-gate",
    "GET /api/v1/relationships/:id": "shared-gate",
    "GET /api/v1/entity-merges": "shared-gate",
    "POST /api/v1/entity-merges": "shared-gate",
    "POST /api/v1/entity-merges/:id/undo": "shared-gate",
  },
  "apps/api/src/routes/explore.ts": {
    "GET /api/v1/graph": "shared-gate",
    "GET /api/v1/timeline": "shared-gate",
  },
  "apps/api/src/routes/evidence.ts": {
    "GET /api/v1/evidence/:id": "shared-gate",
    "GET /api/v1/evidence/:id/payload": "shared-gate",
  },
  // R1-b: a case's analysis rests on the case as it is now and on every run its
  // evidence came from (D-19); a stored one also on the records it read.
  "apps/api/src/routes/case-analyses.ts": {
    "POST /api/v1/cases/:id/analyses": "shared-gate",
    "GET /api/v1/cases/:id/analyses": "shared-gate",
    "GET /api/v1/case-analyses/:id": "shared-gate",
  },
  "apps/api/src/routes/reports.ts": {
    "POST /api/v1/runs/:id/reports": "shared-gate",
    "GET /api/v1/runs/:id/reports": "shared-gate",
    "GET /api/v1/reports/:id": "shared-gate",
    "GET /api/v1/reports/:id/export/:format": "shared-gate",
    "PUT /api/v1/settings/report-handling-marking": {
      why: "A tenant setting, typed by a member holding organization:update; no collected data.",
    },
  },
  "apps/api/src/routes/runs.ts": {
    "POST /api/v1/investigations/:id/runs": {
      why: "Returns the new run before any job exists (docs/PLAN.md, Phase 6a ruling).",
    },
    "GET /api/v1/investigations/:id/runs": {
      why: "Run ids, statuses and times: found and not found are both SUCCEEDED, so it shows collector health, not findings (docs/PLAN.md, Phase 6a ruling).",
    },
    "GET /api/v1/runs/:id": "shared-gate",
    "GET /api/v1/runs/:id/events": "shared-gate",
    "POST /api/v1/jobs/:id/replay": "shared-gate",
    "GET /api/v1/usage": {
      why: "The tenant's metering totals: aggregates across every collector (docs/PLAN.md, Phase 6a ruling).",
    },
  },
  "apps/api/src/routes/investigations.ts": {
    "POST /api/v1/investigations": { why: "The analyst's own title and target." },
    "GET /api/v1/investigations": { why: "The analyst's own titles and targets." },
    "GET /api/v1/investigations/:id": { why: "The analyst's own title and target." },
  },
  "apps/api/src/routes/estimates.ts": {
    "POST /api/v1/estimates": {
      why: "Plans from the catalogue and the tenant's entitlement; reads nothing collected.",
    },
  },
  "apps/api/src/routes/person.ts": {
    "POST /api/v1/person/search": {
      why: "Refused by its access declaration: the person:search permission's module needs the plan and approved vetting.",
    },
  },
  "apps/api/src/routes/api-keys.ts": {
    "POST /api/v1/api-keys": { why: "Issues a key a member names and scopes; no collected data." },
    "GET /api/v1/api-keys": { why: "The tenant's keys: names, permissions and dates." },
    "POST /api/v1/api-keys/:id/rotate": { why: "Replaces a key's secret; no collected data." },
    "POST /api/v1/api-keys/:id/revoke": { why: "Revokes a key; no collected data." },
  },
  "apps/api/src/routes/audit-log.ts": {
    "GET /api/v1/audit-log": {
      why: "Rows the access layer writes: action, outcome, actor and target id, never a request body, query or collected value (D-10 audit).",
    },
  },
  "apps/api/src/routes/collectors.ts": {
    "GET /api/v1/collectors": { why: "The collector catalogue and its availability." },
  },
  "apps/api/src/routes/credentials.ts": {
    "POST /api/v1/credentials": {
      why: "Stores a source credential; the secret is never returned.",
    },
    "GET /api/v1/credentials": { why: "Credential metadata only: provider, label and dates." },
    "POST /api/v1/credentials/:id/revoke": { why: "Revokes a credential; no collected data." },
  },
  "apps/api/src/routes/health.ts": {
    "GET /health": { why: "Liveness; no tenant data." },
  },
  "apps/api/src/routes/me.ts": {
    "GET /api/v1/me": { why: "The signed-in member, and the tenant's plan and vetting." },
  },
  "apps/api/src/routes/members.ts": {
    "GET /api/v1/members": { why: IDENTITY },
    "GET /api/v1/members/invitations": { why: IDENTITY },
    "POST /api/v1/members/invitations": { why: IDENTITY },
    "PATCH /api/v1/members/:userId": { why: IDENTITY },
    "DELETE /api/v1/members/:userId": { why: IDENTITY },
  },
  "apps/api/src/routes/scope-authorisations.ts": {
    "POST /api/v1/scope-authorisations": {
      why: "Records the analyst's own authorisation: target, authoriser and window.",
    },
    "GET /api/v1/scope-authorisations": { why: "The analyst-recorded authorisations." },
    "POST /api/v1/scope-authorisations/:id/revoke": { why: "Revokes an authorisation." },
  },
  "apps/api/src/routes/session.ts": {
    "GET /api/v1/session": { why: IDENTITY },
    "POST /api/v1/session/sign-in": { why: IDENTITY },
    "POST /api/v1/session/mfa/verify": { why: IDENTITY },
    "POST /api/v1/session/mfa/enrolment": { why: IDENTITY },
    "POST /api/v1/session/mfa/enrolment/confirm": { why: IDENTITY },
    "POST /api/v1/session/tenant": { why: IDENTITY },
    "POST /api/v1/session/sign-out": { why: IDENTITY },
  },
  "apps/api/src/routes/settings.ts": {
    "GET /api/v1/settings/retention": { why: "The tenant's retention setting." },
    "PUT /api/v1/settings/retention": { why: "The tenant's retention setting." },
  },
};

/**
 * Route files the scan does not read, and why: they register no route, or register by a
 * path that is not a literal (each such route is listed in route-access.test.ts).
 */
export const ROUTE_FILES_UNSCANNED: Readonly<Record<string, string>> = {
  "apps/api/src/routes/auth.ts":
    "Registers the identity provider's open endpoints in a loop over OPEN_IDENTITY_ENDPOINTS: identity, not collected data.",
  "apps/api/src/routes/openapi.ts": "Serves the generated OpenAPI document at OPENAPI_PATH.",
  "apps/api/src/routes/schemas.ts": "Shared schemas; registers no route.",
  "apps/api/src/routes/scope.ts": "The case-or-run scope helper; registers no route.",
};

const ROUTE_START = /\bapp\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g;
const ANY_REGISTRATION = /\bapp\.(?:get|post|put|patch|delete|head|options|all|route)\s*[<(]/g;
/** A call of the shared gate whose result is used: awaited, or assigned from an await. */
const SHARED_GATE_CALL = /\bawait\s+requirePersonAccess\s*\(|=\s*await\s+personLockFor\s*\(/;
/**
 * A route's access declaring one snapshot for its transaction (D-32): a gated
 * read and its probe must see the same data, whatever commits between them.
 */
const SNAPSHOT_DECLARED = /\baccess\s*:\s*\{[^{}]*\bsnapshot\s*:\s*true\b[^{}]*\}/;

/** After one of these (or at the start) a slash opens a regular expression, not a division. */
const REGEX_MAY_FOLLOW = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", ";", ""]);

/**
 * The code of a bracketed stretch, from just after its opening bracket to its matching
 * close, with comments removed and strings kept. Skips string, template and regular
 * expression literals, so brackets inside them do not count. Null when it never closes.
 */
export function bracketedCode(
  content: string,
  start: number,
  close: string,
): { readonly code: string; readonly end: number } | null {
  const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  const stack: string[] = [];
  let code = "";
  let previous = "";
  let index = start;
  const copyQuoted = (quote: string): boolean => {
    const from = index;
    index += 1;
    while (index < content.length && content.charAt(index) !== quote) {
      if (content.charAt(index) === "\\") index += 1;
      index += 1;
    }
    if (index >= content.length) return false;
    index += 1;
    code += content.slice(from, index);
    previous = quote;
    return true;
  };
  while (index < content.length) {
    const char = content.charAt(index);
    const next = content.charAt(index + 1);
    if (char === "/" && next === "/") {
      while (index < content.length && content.charAt(index) !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = content.indexOf("*/", index + 2);
      if (end === -1) return null;
      index = end + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      if (!copyQuoted(char)) return null;
      continue;
    }
    if (char === "/" && REGEX_MAY_FOLLOW.has(previous)) {
      const from = index;
      let inClass = false;
      index += 1;
      while (index < content.length) {
        const c = content.charAt(index);
        if (c === "\\") index += 1;
        else if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        else if (c === "\n") return null;
        index += 1;
      }
      index += 1;
      while (/[a-z]/i.test(content.charAt(index))) index += 1;
      code += content.slice(from, index);
      previous = "/";
      continue;
    }
    if (char === "`") {
      const from = index;
      index += 1;
      while (index < content.length && content.charAt(index) !== "`") {
        if (content.charAt(index) === "\\") index += 2;
        else if (content.charAt(index) === "$" && content.charAt(index + 1) === "{") {
          const inner = bracketedCode(content, index + 2, "}");
          if (inner === null) return null;
          index = inner.end + 1;
        } else index += 1;
      }
      if (index >= content.length) return null;
      index += 1;
      code += content.slice(from, index);
      previous = "`";
      continue;
    }
    const opened = OPEN[char];
    if (opened !== undefined) stack.push(opened);
    else if (char === ")" || char === "]" || char === "}") {
      if (stack.length === 0) return char === close ? { code, end: index } : null;
      if (stack.pop() !== char) return null;
    }
    code += char;
    if (!/\s/.test(char)) previous = char;
    index += 1;
  }
  return null;
}

/**
 * A file's routes registered with a literal path, by "METHOD path": the code of each
 * registration call alone, comments removed; null for a call the scan could not read.
 */
export function routeBlocks(content: string): Map<string, string | null> {
  const blocks = new Map<string, string | null>();
  for (const match of content.matchAll(ROUTE_START)) {
    const open = match.index + match[0].indexOf("(");
    const call = bracketedCode(content, open + 1, ")");
    blocks.set(
      `${(match[1] ?? "").toUpperCase()} ${match[2] ?? ""}`,
      call === null ? null : call.code,
    );
  }
  return blocks;
}

/** Each problem with one file's classification; none when every route is classified and gated as stated. */
export function routeGatingProblems(
  file: string,
  content: string,
  classified: Readonly<Record<string, RouteGating>>,
): string[] {
  const problems: string[] = [];
  const literal = [...content.matchAll(ROUTE_START)].length;
  if ([...content.matchAll(ANY_REGISTRATION)].length !== literal) {
    problems.push(
      `${file}: a route is registered without a literal path, so it cannot be classified`,
    );
  }
  const blocks = routeBlocks(content);
  for (const route of blocks.keys()) {
    if (!(route in classified)) problems.push(`${file}: ${route} is not classified`);
  }
  for (const [route, gating] of Object.entries(classified)) {
    const block = blocks.get(route);
    if (block === undefined) problems.push(`${file}: ${route} is classified but not registered`);
    else if (block === null) problems.push(`${file}: ${route} could not be read`);
    else if (gating === "shared-gate") {
      if (!SHARED_GATE_CALL.test(block)) {
        problems.push(`${file}: ${route} does not call the shared gate`);
      }
      // Every gated read runs on one snapshot (D-32), so its probe sees what it read.
      if (route.startsWith("GET ") && !SNAPSHOT_DECLARED.test(block)) {
        problems.push(`${file}: ${route} is a gated read without a snapshot (snapshot: true)`);
      }
    }
  }
  return problems;
}
