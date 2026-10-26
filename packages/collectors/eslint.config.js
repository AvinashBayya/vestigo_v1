import { createConfig } from "@repo/config/eslint";

const BUN = {
  paths: [{ name: "bun", message: "Node only: do not import Bun modules." }],
  patterns: [{ group: ["bun:*"], message: "Node only: do not import Bun modules." }],
};

/** A collector is a pure function of (target, credentials, fetcher): no database, no infrastructure. */
const NO_DATABASE = [
  {
    name: "@repo/db",
    message: "Collectors never touch the database; osint-engine writes evidence.",
  },
  {
    name: "@repo/integrations",
    message: "Collectors get credentials and limits injected, not clients.",
  },
  { name: "pg", message: "Collectors never touch the database." },
  { name: "drizzle-orm", message: "Collectors never touch the database." },
  { name: "ioredis", message: "Collectors get a rate limiter injected, not a Redis client." },
];

/** Every outbound call goes through src/fetcher, which enforces SSRF, timeouts and rate limits. */
const NO_NETWORK = ["http", "https", "net", "tls", "dgram", "http2", "dns"].flatMap((module) => [
  { name: `node:${module}`, message: "Outbound calls go through the collector fetcher only." },
  { name: module, message: "Outbound calls go through the collector fetcher only." },
]);

/**
 * A failure must never read as "nothing found". The previous codebase's
 * contact-email module had five `catch { return null }` sites that made a
 * failed lookup indistinguishable from an empty one (docs/audit/COLLECTORS.md
 * row 16). No catch block or .catch() handler in collector code may return an
 * empty value: throw a typed error instead, and the runtime reports it.
 */
const EMPTY_VALUES = [
  "Literal[raw='null']",
  "Literal[raw='0']",
  "Literal[raw='false']",
  "Literal[value='']",
  "ArrayExpression[elements.length=0]",
  "ObjectExpression[properties.length=0]",
  "Identifier[name='undefined']",
];
const CATCH_CONTEXTS = [
  "CatchClause ReturnStatement",
  "CallExpression[callee.property.name='catch'] > :function ReturnStatement",
  "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression",
];
const NO_EMPTY_ON_FAILURE = [
  ...CATCH_CONTEXTS.flatMap((context) =>
    EMPTY_VALUES.map((value) => ({
      selector: `${context} > ${value}`,
      message: "A failure is never an empty result: throw a typed error instead.",
    })),
  ),
  {
    selector: "CatchClause ReturnStatement:not([argument])",
    message: "A failure is never an empty result: throw a typed error instead.",
  },
];

/**
 * The replay grant lets a runtime replay recorded answers for an UNVERIFIED
 * source. Only the fixture harness (src/testing.ts) may take it: nothing a
 * deployment builds can, so no product path runs an UNVERIFIED source.
 */
const REPLAY_GRANT = {
  group: ["**/runtime", "**/runtime.ts", "**/runtime.js"],
  importNames: ["replayRecordedAnswers"],
  message: "Only the fixture harness (src/testing.ts) may let a runtime replay recorded answers.",
};

const RESTRICTED_GLOBALS = [
  { name: "Bun", message: "Node only: Bun globals are not available at runtime." },
];

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // Configuration reaches collectors by injection only. In particular no
    // credential can come from the environment: the tenant vault is the only source.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message:
            "Collectors never read the environment; credentials come only from the tenant vault.",
        },
      ],
      "no-restricted-syntax": ["error", ...NO_EMPTY_ON_FAILURE],
    },
  },
  {
    files: ["src/**/*.ts"],
    ignores: ["src/fetcher/**", "src/testing.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...BUN.paths, ...NO_DATABASE, ...NO_NETWORK],
          patterns: [
            ...BUN.patterns,
            {
              group: ["**/testing", "**/testing.ts", "**/testing.js"],
              message: "The fixture harness is for tests only; nothing in src/ may use it.",
            },
            REPLAY_GRANT,
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...RESTRICTED_GLOBALS,
        { name: "fetch", message: "Outbound calls go through the collector fetcher only." },
        {
          name: "XMLHttpRequest",
          message: "Outbound calls go through the collector fetcher only.",
        },
        { name: "WebSocket", message: "Outbound calls go through the collector fetcher only." },
      ],
    },
  },
  {
    // The fixture harness (@repo/collectors/testing): a loopback server that
    // answers tests with recorded fixtures. It contacts nothing; the fetcher
    // still checks every destination before its socket reaches the server.
    files: ["src/testing.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [...BUN.paths, ...NO_DATABASE], patterns: BUN.patterns },
      ],
    },
  },
  {
    files: ["src/fetcher/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [...BUN.paths, ...NO_DATABASE], patterns: [...BUN.patterns, REPLAY_GRANT] },
      ],
      "no-restricted-globals": [
        "error",
        ...RESTRICTED_GLOBALS,
        { name: "fetch", message: "The fetcher uses node:http(s) with a pinned, checked address." },
      ],
    },
  },
];
