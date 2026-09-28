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

const RESTRICTED_GLOBALS = [
  { name: "Bun", message: "Node only: Bun globals are not available at runtime." },
];

export default [
  ...createConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["src/**/*.ts"],
    ignores: ["src/fetcher/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [...BUN.paths, ...NO_DATABASE, ...NO_NETWORK], patterns: BUN.patterns },
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
    files: ["src/fetcher/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [...BUN.paths, ...NO_DATABASE], patterns: BUN.patterns },
      ],
      "no-restricted-globals": [
        "error",
        ...RESTRICTED_GLOBALS,
        { name: "fetch", message: "The fetcher uses node:http(s) with a pinned, checked address." },
      ],
    },
  },
];
