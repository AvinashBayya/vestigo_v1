import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import plugin from "./fabrication-plugin.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

// The operators are assembled at runtime so this file does not itself contain
// the patterns it tests; the CI fabrication gate scans test files too.
const OR = "|" + "|";
const NULLISH = "?" + "?";

const noFabricatedFallback = plugin.rules["no-fabricated-fallback"];
const requireFabricationJustification = plugin.rules["require-fabrication-justification"];

// The typescript-eslint parser, so `as`, `!` and `satisfies` are real syntax,
// with JSX enabled so rendered fallbacks can be exercised.
const languageOptions = {
  parser: tseslint.parser,
  parserOptions: { ecmaFeatures: { jsx: true } },
};

describe("fabrication plugin", () => {
  it("is named for what it guards, not after a product", ({ expect }) => {
    expect(plugin.meta.name).toBe("fabrication");
    expect(Object.keys(plugin.rules).sort()).toEqual([
      "no-fabricated-fallback",
      "require-fabrication-justification",
    ]);
  });
});

new RuleTester({ languageOptions }).run("no-fabricated-fallback", noFabricatedFallback, {
  valid: [
    // Honest absence markers.
    `const rec = { status: item.status ${OR} "not reported" };`,
    `const rec = { status: item.status ${NULLISH} "unknown" };`,
    `const rec = { status: item.status ${OR} "-" };`,
    `const rec = { status: item.status ${NULLISH} "—" };`,
    `const rec = { status: item.status ${OR} "" };`,
    `const el = <td>{whois?.registrar ${OR} "not reported"}</td>;`,
    `function load() { try { return fetchCount(); } catch { return "unavailable"; } }`,

    // A clock seam named `now`, as a property or a bare identifier.
    `const at = deps.now ${NULLISH} new Date();`,
    `const at = now ${OR} new Date();`,

    // A caller-supplied parameter used whole is the caller's default.
    `function createWatchlist(name) { return { title: name ${OR} "New Watchlist" }; }`,
    `function describeTarget(target) { return { subject: target.trim() ${OR} "Unnamed subject" }; }`,
    `function stamp(at) { return { at: at ${NULLISH} new Date() }; }`,

    // Regression (legacy defect: `Date.now()` was never detected). With it now
    // detected, the clock-seam and parameter-default exemptions still hold, and
    // other static calls on `Date` are still not clock reads.
    `const at = deps.now ${NULLISH} Date.now();`,
    `const at = now ${OR} Date.now();`,
    `function stamp(at) { return { at: at ${OR} Date.now() }; }`,
    `const ms = row.ms ${NULLISH} Date.parse(raw);`,

    // Configuration reads.
    `const env = { logLevel: process.env.LOG_LEVEL ${OR} "Info" };`,
    `const base = import.meta.env.VITE_API_BASE ${NULLISH} "Same-origin";`,

    // Aggregation callbacks and Math.max / Math.min.
    `const total = rows.reduce((sum, r) => sum + (r.deaths ${OR} 0), 0);`,
    `rows.sort((a, b) => (b.views ${NULLISH} 0) - (a.views ${NULLISH} 0));`,
    `const peak = Math.max(...rows.map((r) => r.likes ${NULLISH} 0));`,

    // Options-object reads.
    `const rec = { mode: options.mode ${OR} "Standard" };`,
    `const rec = { tone: props.theme.tone ${NULLISH} "Neutral" };`,

    // Presentational JSX attributes and presentational property names.
    `const el = <Badge className={item.tone ${OR} "Neutral"} />;`,
    `const el = <Row title={item.kind ${OR} "Record"} />;`,
    `const rec = { text: item.label ${OR} "Details" };`,

    // A zero default whose name is not a measurement.
    `const rec = { retries: job.attempts ${NULLISH} 0 };`,

    // Out of scope: a log line, a lookup miss, a small literal on a failure path.
    `console.log(item.status ${OR} "Online");`,
    `const rec = { level: severityMap[k] ${OR} "low" };`,
    `function load() { try { return fetchCount(); } catch { return 1; } }`,
    `function load() { try { a(); } catch { b(); } if (x) return 5; return null; }`,

    // Options.
    {
      code: `function load() { try { return fetchCount(); } catch { return 4290; } }`,
      options: [{ checkCatchReturns: false }],
    },
    {
      code: `const at = deps.tick ${NULLISH} new Date();`,
      options: [{ clockSeamNames: ["tick"] }],
    },
  ],

  invalid: [
    // A. clock invention
    {
      code: `const rec = { date: item.pubDate ${OR} new Date().toISOString() };`,
      errors: [{ messageId: "fabricatedTimestamp", data: { left: "item.pubDate" } }],
    },
    {
      code: `const seenAt = row.seenAt ${NULLISH} new Date();`,
      errors: [{ messageId: "fabricatedTimestamp", data: { left: "row.seenAt" } }],
    },
    {
      code: `const rec = { ts: (item.ts as number | undefined) ${NULLISH} new Date().getTime() };`,
      errors: [
        { messageId: "fabricatedTimestamp", data: { left: "item.ts as number | undefined" } },
      ],
    },
    {
      // A property read off a parameter is an upstream record, not a default.
      code: `function toRecord(item) { return { date: item.pubDate ${OR} new Date() }; }`,
      errors: [{ messageId: "fabricatedTimestamp", data: { left: "item.pubDate" } }],
    },
    // Regression (legacy defect): `Date.now()` was peeled down to `Date` and
    // never flagged.
    {
      code: `const rec = { seenAt: item.seenAt ${NULLISH} Date.now() };`,
      errors: [{ messageId: "fabricatedTimestamp", data: { left: "item.seenAt" } }],
    },
    {
      code: `const rec = { seenAt: item.seenAt ${OR} Date.now() };`,
      errors: [{ messageId: "fabricatedTimestamp", data: { left: "item.seenAt" } }],
    },
    {
      code: `const rec = { seenAt: item.seenAt ${NULLISH} (Date.now() as number) };`,
      errors: [{ messageId: "fabricatedTimestamp", data: { left: "item.seenAt" } }],
    },
    {
      code: `const rec = { seenAt: item.seenAt ${OR} Date.now()! };`,
      errors: [{ messageId: "fabricatedTimestamp", data: { left: "item.seenAt" } }],
    },
    {
      code: `const rec = { seenAt: item.seenAt ${NULLISH} Date.now().toString() };`,
      errors: [{ messageId: "fabricatedTimestamp", data: { left: "item.seenAt" } }],
    },

    // B. literal-as-measurement
    {
      code: `const rec = { status: item.status ${OR} "online" };`,
      errors: [
        {
          messageId: "fabricatedString",
          data: { where: "record field", left: "item.status", value: "online" },
        },
      ],
    },
    {
      code: `const el = <td>{whois?.registrar ${OR} "[Registrar name]"}</td>;`,
      errors: [
        {
          messageId: "fabricatedString",
          data: { where: "rendered", left: "whois?.registrar", value: "[Registrar name]" },
        },
      ],
    },
    {
      code: `const el = <Tone tone={p.tone ${OR} "medium"} />;`,
      errors: [
        {
          messageId: "fabricatedString",
          data: { where: "rendered", left: "p.tone", value: "medium" },
        },
      ],
    },
    {
      code: `const hq = entity.address ${OR} entity.city ${OR} "Registered";`,
      errors: [
        {
          messageId: "fabricatedString",
          data: {
            where: "record field",
            left: `entity.address ${OR} entity.city`,
            value: "Registered",
          },
        },
      ],
    },
    {
      code: `const rec = { tone: m.tone! ${NULLISH} ("neutral" satisfies string) };`,
      errors: [
        {
          messageId: "fabricatedString",
          data: { where: "record field", left: "m.tone!", value: "neutral" },
        },
      ],
    },
    {
      code: `const rec = { tone: (m.tone as string) ${OR} ("medium" as const) };`,
      errors: [
        {
          messageId: "fabricatedString",
          data: { where: "record field", left: "m.tone as string", value: "medium" },
        },
      ],
    },
    {
      code: `const rec = { make: row.make ${OR} \`Motor Vehicle\` };`,
      errors: [
        {
          messageId: "fabricatedString",
          data: { where: "record field", left: "row.make", value: "Motor Vehicle" },
        },
      ],
    },
    {
      code: `const region = String(item.region ${NULLISH} "north");`,
      errors: [
        {
          messageId: "fabricatedString",
          data: { where: "record field", left: "item.region", value: "north" },
        },
      ],
    },
    {
      code: `const rec = { mode: options.mode ${OR} "Standard" };`,
      options: [{ optionsIdentifiers: ["cfg"] }],
      errors: [
        {
          messageId: "fabricatedString",
          data: { where: "record field", left: "options.mode", value: "Standard" },
        },
      ],
    },

    // C. zero flattening
    {
      code: `const rec = { deaths: (e.deaths_a ${OR} 0) + (e.deaths_b ${OR} 0) };`,
      errors: [
        { messageId: "fabricatedZero", data: { left: "e.deaths_a", what: "deaths_a" } },
        { messageId: "fabricatedZero", data: { left: "e.deaths_b", what: "deaths_b" } },
      ],
    },
    {
      code: `const point = { lat: Number(h.lat ${NULLISH} 0) };`,
      errors: [{ messageId: "fabricatedZero", data: { left: "h.lat", what: "lat" } }],
    },
    {
      code: `const rec = { confidence: raw.score ${NULLISH} 0 };`,
      errors: [{ messageId: "fabricatedZero", data: { left: "raw.score", what: "confidence" } }],
    },
    {
      code: `const count = parseInt(post.likes, 10) ${OR} 0;`,
      errors: [
        { messageId: "fabricatedZero", data: { left: "parseInt(post.likes, 10)", what: "likes" } },
      ],
    },
    {
      code: `const rec = { retries: job.attempts ${NULLISH} 0 };`,
      options: [{ measurementNames: "attempt" }],
      errors: [{ messageId: "fabricatedZero", data: { left: "job.attempts", what: "attempts" } }],
    },

    // D. invented literal on a failure path
    {
      code: `function load() { try { return fetchCount(); } catch { return 4290; } }`,
      errors: [{ messageId: "fabricatedFailureValue", data: { value: "4290" } }],
    },
    {
      code: `function status() { try { probe(); } catch (e) { log(e); } return "Active"; }`,
      errors: [{ messageId: "fabricatedFailureValue", data: { value: '"Active"' } }],
    },
  ],
});

// A real fabricated fallback on the line after each directive, so a disable of
// the fallback rule is always used and never reported as unused.
const FABRICATED = `const rec = { status: item.status ${OR} "online" };`;
const JUSTIFICATION = "status is an enumerated field of the upstream schema";

new RuleTester({
  languageOptions,
  plugins: { fabrication: plugin },
  rules: { "fabrication/no-fabricated-fallback": "error", "no-console": "error" },
}).run("require-fabrication-justification", requireFabricationJustification, {
  valid: [
    `// eslint-disable-next-line fabrication/no-fabricated-fallback -- ${JUSTIFICATION}\n${FABRICATED}`,
    `/* eslint-disable fabrication/no-fabricated-fallback -- ${JUSTIFICATION} */\n${FABRICATED}`,
    `${FABRICATED} // eslint-disable-line fabrication/no-fabricated-fallback -- ${JUSTIFICATION}`,
    // Exactly the minimum length.
    `// eslint-disable-next-line fabrication/no-fabricated-fallback -- ${"x".repeat(20)}\n${FABRICATED}`,
    // Disables of unrelated rules need no justification.
    "// eslint-disable-next-line no-console\nconsole.log(item);",
    {
      code: `// eslint-disable-next-line fabrication/no-fabricated-fallback -- short\n${FABRICATED}`,
      options: [{ minLength: 5 }],
    },
  ],
  invalid: [
    {
      code: `// eslint-disable-next-line fabrication/no-fabricated-fallback\n${FABRICATED}`,
      errors: [
        {
          messageId: "missing",
          data: { rule: "fabrication/no-fabricated-fallback", min: 20 },
          line: 1,
        },
      ],
    },
    {
      code: `// eslint-disable-next-line fabrication/no-fabricated-fallback -- trust me\n${FABRICATED}`,
      errors: [
        { messageId: "missing", data: { rule: "fabrication/no-fabricated-fallback", min: 20 } },
      ],
    },
    {
      code: `// eslint-disable-next-line fabrication/no-fabricated-fallback -- ${"x".repeat(19)}\n${FABRICATED}`,
      errors: [
        { messageId: "missing", data: { rule: "fabrication/no-fabricated-fallback", min: 20 } },
      ],
    },
    {
      code: `/* eslint-disable fabrication/no-fabricated-fallback */\n${FABRICATED}`,
      errors: [
        { messageId: "missing", data: { rule: "fabrication/no-fabricated-fallback", min: 20 } },
      ],
    },
    {
      code: `${FABRICATED} // eslint-disable-line no-console, fabrication/no-fabricated-fallback`,
      errors: [
        { messageId: "missing", data: { rule: "fabrication/no-fabricated-fallback", min: 20 } },
      ],
    },
    {
      // The bare name is recognised too. No rule is registered under it in
      // this repository, so ESLint also reports the directive's unknown rule.
      code: "/* eslint-disable no-fabricated-fallback */\nconst x = 1;",
      errors: [
        { message: "Definition for rule 'no-fabricated-fallback' was not found." },
        { messageId: "missing", data: { rule: "no-fabricated-fallback", min: 20 } },
      ],
    },
    {
      code: `// eslint-disable-next-line fabrication/no-fabricated-fallback -- short\n${FABRICATED}`,
      options: [{ minLength: 25 }],
      errors: [
        { messageId: "missing", data: { rule: "fabrication/no-fabricated-fallback", min: 25 } },
      ],
    },
  ],
});
