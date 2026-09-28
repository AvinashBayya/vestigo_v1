// @ts-check
/**
 * Local ESLint plugin: fabrication guards.
 *
 * CLAUDE.md §1, "Never fabricate data": a value that was not measured is
 * `null` and renders as an explicit absence. It is never a plausible guess,
 * never a default standing in for a missing timestamp, and a failure never
 * comes back as an invented result.
 *
 * Ported from the previous codebase's eslint-rules/no-fabricated-fallback.js
 * (docs/audit/INVENTORY.md verdict: KEEP). The fabricated values the audit
 * itemises (docs/audit/REPORT.md §4) recur in a handful of syntactic shapes,
 * and this file makes each of them a lint error. The examples are described
 * in words because the CI fabrication gate scans comments too:
 *
 *   A. Clock invention   `date: item.pubDate` OR-falling back to
 *                        `new Date().toISOString()`
 *   B. Literal-as-measurement
 *                        a WHOIS registrar field OR-falling back to a
 *                        hard-coded registrar name;
 *                        `status: item.status || "online"`
 *   C. Zero flattening   `deaths: (e.deaths_a` OR-falling back to zero `) + ...`
 *                        `lat: Number(h.lat` nullish-falling back to zero `)`
 *   D. Invented literal returned from a failure path
 *                        `} catch { } return 4290;`
 *
 * The rule works on the AST, not on text, and is deliberately built around an
 * ALLOW-list of honest absence markers: `x || "-"`, `x ?? "not reported"`,
 * `x || "none"` are how a value that was not measured is supposed to render,
 * and they must never be flagged.
 *
 * No runtime dependencies. Plain ESM, registered under the `fabrication`
 * plugin key by `createConfig` in ./index.js.
 */

/**
 * Node types. The rules run under espree and under @typescript-eslint/parser,
 * so besides ESTree they meet TypeScript expression wrappers and JSX nodes.
 * `estree` is not a direct dependency of this package, so its node union is
 * named through ESLint's own types; the TypeScript and JSX shapes declare only
 * the fields read here.
 *
 * @typedef {Parameters<import("eslint").SourceCode["getScope"]>[0]} EstreeNode
 * @typedef {{ type: "TSAsExpression" | "TSNonNullExpression" | "TSSatisfiesExpression", expression: AnyNode }} TsWrapperNode
 * @typedef {{ type: "JSXIdentifier", name: string }} JsxIdentifierNode
 * @typedef {{ type: "JSXNamespacedName", namespace: JsxIdentifierNode, name: JsxIdentifierNode }} JsxNamespacedNameNode
 * @typedef {{ type: "JSXExpressionContainer", expression: AnyNode }} JsxExpressionContainerNode
 * @typedef {{ type: "JSXAttribute", name: JsxIdentifierNode | JsxNamespacedNameNode }} JsxAttributeNode
 * @typedef {(EstreeNode | TsWrapperNode | JsxExpressionContainerNode | JsxAttributeNode) & { parent?: AnyNode | null }} AnyNode
 * @typedef {import("eslint").Rule.RuleContext} RuleContext
 * @typedef {import("eslint").Scope.Scope} Scope
 * @typedef {import("eslint").Scope.Variable} Variable
 */

/**
 * Rule options, matching each rule's `meta.schema`.
 *
 * @typedef {{ measurementNames?: string, clockSeamNames?: string[], configCallees?: string[], optionsIdentifiers?: string[], checkCatchReturns?: boolean }} FallbackOptions
 * @typedef {{ ruleNames?: string[], minLength?: number }} JustificationOptions
 */

// ─── Shared helpers ─────────────────────────────────────────────────────────

/**
 * A string that ANNOUNCES an absence rather than substituting for one.
 *
 * Deliberately generous: a false negative here is a fabrication that survives
 * one more review, a false positive is a developer who stops trusting the
 * rule. "Unknown botnet" and "No MX record found" are let through by this,
 * which is the price of never flagging "issuer not reported".
 */
const ABSENCE_MARKER =
  /\b(?:not\s+\w+|no\s+\w+|unknown|unavailable|unreported|unspecified|unmeasured|unassessed|uncollected|unresolved|unverified|unrated|unscored|undated|untitled|unnamed|unset|unplaceable|unattributed|unclassified|undetermined|undisclosed|unlisted|unparsed|withheld|redacted|missing|absent|none|nil|empty|pending|tbd|n\/a)\b/i;

/** "", "-", "—", "–", "?", "…", "--", "(none)" style placeholders. */
const PUNCTUATION_ONLY = /^[\s\p{P}\p{S}]*$/u;

/** @param {unknown} value */
function isHonestAbsenceString(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v === "" || PUNCTUATION_ONLY.test(v)) return true;
  return ABSENCE_MARKER.test(v);
}

/**
 * The string value of a Literal or a no-substitution template, else null.
 *
 * @param {AnyNode | null | undefined} node
 */
function staticString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((q) => q.value.cooked ?? "").join("");
  }
  return null;
}

/**
 * @param {AnyNode | null | undefined} node
 * @param {number} value
 */
function isNumericLiteral(node, value) {
  return node && node.type === "Literal" && typeof node.value === "number" && node.value === value;
}

/**
 * Strip parentheses / `as T` / `!` so the shape underneath is visible.
 *
 * @param {AnyNode | null | undefined} node
 */
function unwrap(node) {
  let n = node;
  while (
    n &&
    (n.type === "TSAsExpression" ||
      n.type === "TSNonNullExpression" ||
      n.type === "TSSatisfiesExpression" ||
      n.type === "ChainExpression")
  ) {
    n = n.expression;
  }
  return n;
}

const NUMERIC_COERCERS = new Set(["Number", "parseFloat", "parseInt"]);

/**
 * `Number(e.deaths_a)` -> `e.deaths_a`; anything else is returned as-is.
 *
 * @param {AnyNode | null | undefined} node
 */
function stripNumericCoercion(node) {
  let n = unwrap(node);
  while (
    n &&
    n.type === "CallExpression" &&
    n.callee.type === "Identifier" &&
    NUMERIC_COERCERS.has(n.callee.name) &&
    n.arguments.length > 0
  ) {
    n = unwrap(n.arguments[0]);
  }
  return n;
}

/**
 * Static property name of a member expression, else null.
 *
 * @param {AnyNode | null | undefined} node
 */
function memberName(node) {
  const n = unwrap(node);
  if (!n || n.type !== "MemberExpression") return null;
  if (!n.computed && n.property.type === "Identifier") return n.property.name;
  const s = staticString(n.property);
  return s;
}

/**
 * ESLint's SourceCode methods are typed for ESTree but accept any node the
 * configured parser produced, TypeScript and JSX nodes included.
 *
 * @param {AnyNode} node
 */
function asEstree(node) {
  return /** @type {EstreeNode} */ (node);
}

/**
 * Dotted source text of the left side, for the message.
 *
 * @param {RuleContext} context
 * @param {AnyNode} node
 */
function sourceOf(context, node) {
  const text = context.sourceCode.getText(asEstree(node)).replace(/\s+/g, " ");
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/**
 * True when the expression reads configuration rather than collected data.
 *
 * @param {RuleContext} context
 * @param {AnyNode} node
 * @param {readonly string[]} extraCallees
 */
function readsConfiguration(context, node, extraCallees) {
  const text = context.sourceCode.getText(asEstree(node));
  if (/\bprocess\s*\.\s*env\b/.test(text)) return true;
  if (/\bimport\s*\.\s*meta\s*\.\s*env\b/.test(text)) return true;
  if (/\b(?:local|session)Storage\s*\.\s*getItem\b/.test(text)) return true;
  const n = unwrap(node);
  if (n && n.type === "CallExpression") {
    const callee = n.callee.type === "Identifier" ? n.callee.name : memberName(n.callee);
    if (callee && extraCallees.includes(callee)) return true;
  }
  return false;
}

/**
 * True when the left side is a caller-supplied argument used WHOLE: a `name`
 * parameter falling back to a default title, or `target.trim()` falling back
 * to a default subject label.
 *
 * A property READ off a parameter (`item.status || "online"`) is NOT exempt:
 * that is a collector unpacking an upstream record, which is exactly the case
 * this rule exists for.
 *
 * @param {RuleContext} context
 * @param {AnyNode} node
 */
function isParameterDefault(context, node) {
  let n = unwrap(node);
  // allow one layer of string massaging: param.trim(), String(param)
  if (n && n.type === "CallExpression") {
    if (n.callee.type === "MemberExpression") n = unwrap(n.callee.object);
    else if (n.callee.type === "Identifier" && n.arguments.length === 1) n = unwrap(n.arguments[0]);
  }
  if (!n || n.type !== "Identifier") return false;
  const scope = context.sourceCode.getScope(asEstree(node));
  /** @type {Variable | null} */
  let ref = null;
  for (let s = /** @type {Scope | null} */ (scope); s && !ref; s = s.upper) {
    ref = s.variables.find((v) => v.name === n.name) ?? null;
  }
  if (!ref || ref.defs.length === 0) return false;
  return ref.defs.every((d) => d.type === "Parameter");
}

/**
 * Nearest enclosing callback that is an argument to `.reduce()` / `.sort()`.
 *
 * @param {AnyNode} node
 */
function insideAggregationCallback(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "ArrowFunctionExpression" || p.type === "FunctionExpression") {
      const call = p.parent;
      if (call && call.type === "CallExpression") {
        const name = memberName(call.callee);
        if (name && ["reduce", "reduceRight", "sort", "toSorted"].includes(name)) return true;
      }
    }
  }
  return false;
}

/**
 * Anywhere under Math.max / Math.min, where a nullish-to-zero default is the
 * classic harmless case.
 *
 * @param {AnyNode} node
 */
function insideMathExtreme(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "CallExpression" && p.callee.type === "MemberExpression") {
      const obj = p.callee.object;
      const name = memberName(p.callee);
      if (obj.type === "Identifier" && obj.name === "Math" && (name === "max" || name === "min")) {
        return true;
      }
    }
    if (p.type === "Program") break;
  }
  return false;
}

/**
 * Key of the object-literal property this expression is the value of.
 *
 * @param {AnyNode} node
 */
function enclosingPropertyKey(node) {
  for (let p = node.parent, child = node; p; child = p, p = p.parent) {
    if (p.type === "Property" && p.value === child) {
      if (!p.computed && p.key.type === "Identifier") return p.key.name;
      return staticString(p.key);
    }
    // only climb through value-shaped parents
    if (
      ![
        "BinaryExpression",
        "LogicalExpression",
        "UnaryExpression",
        "CallExpression",
        "TSAsExpression",
        "TSNonNullExpression",
        "ChainExpression",
        "ConditionalExpression",
      ].includes(p.type)
    ) {
      return null;
    }
  }
  return null;
}

/**
 * Where a fabricated STRING actually does damage: it becomes a field on a
 * record, or it is rendered. A `||` inside a log line, an error message or a
 * call argument is not a measurement, and flagging those was the single
 * largest source of noise when this rule was first run against the previous
 * codebase, most of it UI copy. Climbing stops at anything not on this list.
 */
const TRANSPARENT_PARENTS = new Set([
  "LogicalExpression",
  "ConditionalExpression",
  "TSAsExpression",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "ChainExpression",
]);

const COERCION_CALLEES = new Set(["String", "Number", "Boolean"]);

/** JSX attributes that carry presentation, not findings. */
const PRESENTATIONAL_ATTRS =
  /^(class|className|style|placeholder|alt|title|color|fill|stroke|key|id|role|type|variant|size|width|height|href|src|aria-.*|data-.*)$/;

/** Property reads whose value is a caption, not a measurement. */
const PRESENTATIONAL_NAMES = /(label|hint|caption|placeholder|colour|color|icon|tooltip|copy)$/i;

const DEFAULT_OPTIONS_IDENTIFIERS = ["opts", "options", "config", "cfg", "settings", "props"];

/**
 * "record field or rendered" | null.
 *
 * Returns the reason the expression is in scope, or null when it is not.
 *
 * @param {AnyNode} node
 */
function fabricationContext(node) {
  let child = node;
  for (let p = node.parent; p; child = p, p = p.parent) {
    if (p.type === "Property" && p.value === child) return "record field";
    if (p.type === "VariableDeclarator" && p.init === child) return "record field";
    if (p.type === "JSXExpressionContainer") {
      const holder = p.parent;
      if (holder && holder.type === "JSXAttribute") {
        const name =
          holder.name.type === "JSXIdentifier"
            ? holder.name.name
            : `${holder.name.namespace?.name}:${holder.name.name?.name}`;
        return PRESENTATIONAL_ATTRS.test(name) ? null : "rendered";
      }
      return "rendered";
    }
    if (
      p.type === "CallExpression" &&
      p.callee.type === "Identifier" &&
      COERCION_CALLEES.has(p.callee.name)
    ) {
      continue;
    }
    if (!TRANSPARENT_PARENTS.has(p.type)) return null;
  }
  return null;
}

const DEFAULT_MEASUREMENT_NAMES =
  "death|casualt|fatalit|killed|injur|wounded|latitude|longitude|(^|_)lat($|_)|(^|_)lon(g)?($|_)|coord|magnitude|confidence|^value$|^reading$|dose|cpm|usv|sievert|radiation|becquerel|temperature|likes|shares|retweets|upvotes|views|followers|subscribers|altitude|velocity|speed|casualties|flights|aircraft|strength|severity_score";

const DEFAULT_CLOCK_SEAMS = ["now", "nowMs", "clock", "currentTime", "timeSource"];

const DEFAULT_CONFIG_CALLEES = ["envValue", "getEnv", "env", "readEnv", "getConfig"];

// ─── Rule 1: no-fabricated-fallback ─────────────────────────────────────────

/** @type {import("eslint").Rule.RuleModule} */
const noFabricatedFallback = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid `||` / `??` fallbacks that substitute a plausible value for one that was never measured.",
    },
    schema: [
      {
        type: "object",
        properties: {
          measurementNames: { type: "string" },
          clockSeamNames: { type: "array", items: { type: "string" } },
          configCallees: { type: "array", items: { type: "string" } },
          optionsIdentifiers: { type: "array", items: { type: "string" } },
          checkCatchReturns: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      fabricatedTimestamp:
        "Fabricated timestamp: `{{left}}` falls back to the current clock, stamping the moment this code ran onto a record the source left undated. Use `null` and render it as undated. If this really is a clock seam, name the left side `now`.",
      fabricatedString:
        'Fabricated value ({{where}}): `{{left}}` falls back to the literal "{{value}}", which reads exactly like a measurement. Use `null`, or an explicit absence marker such as "not reported" / "unknown" / "-".',
      fabricatedZero:
        "Fabricated measurement: `{{left}}` falls back to 0, so an UNREPORTED {{what}} becomes a measured zero — a coordinate at 0,0, a casualty count of none, a reading classified normal. Use `null` and report the absence.",
      fabricatedFailureValue:
        "Invented value on a failure path: returning the literal `{{value}}` from a function that swallows an error hands the UI a number nothing measured. Return `null` (or throw) and let the caller render the failure.",
    },
  },

  create(context) {
    /** @type {FallbackOptions} */
    const opts = context.options[0] ?? {};
    const measurementRe = new RegExp(opts.measurementNames ?? DEFAULT_MEASUREMENT_NAMES, "i");
    const clockSeams = opts.clockSeamNames ?? DEFAULT_CLOCK_SEAMS;
    const configCallees = opts.configCallees ?? DEFAULT_CONFIG_CALLEES;
    const optionsIdentifiers = opts.optionsIdentifiers ?? DEFAULT_OPTIONS_IDENTIFIERS;
    const checkCatchReturns = opts.checkCatchReturns !== false;

    /**
     * `new Date()` / `Date.now()` / `new Date().toISOString()` and friends.
     *
     * @param {AnyNode | null | undefined} node
     */
    function isClockCall(node) {
      let n = unwrap(node);
      // peel `.toISOString()`, `.getTime()`, `.valueOf()`, but stop at a call on `Date` itself
      // Legacy defect: this loop peeled `Date.now()` to `Date` and never flagged it; fixed, with a regression test.
      while (
        n &&
        n.type === "CallExpression" &&
        n.callee.type === "MemberExpression" &&
        !(n.callee.object.type === "Identifier" && n.callee.object.name === "Date")
      ) {
        n = unwrap(n.callee.object);
      }
      n = unwrap(n);
      if (!n) return false;
      if (
        n.type === "NewExpression" &&
        n.callee.type === "Identifier" &&
        n.callee.name === "Date"
      ) {
        return n.arguments.length === 0;
      }
      if (n.type === "CallExpression" && n.callee.type === "MemberExpression") {
        const obj = n.callee.object;
        return obj.type === "Identifier" && obj.name === "Date" && memberName(n.callee) === "now";
      }
      return false;
    }

    return {
      LogicalExpression(node) {
        if (node.operator !== "||" && node.operator !== "??") return;
        const left = node.left;
        const right = unwrap(node.right);

        // ── A. clock invention ────────────────────────────────────────────
        if (isClockCall(right)) {
          const seam = memberName(left);
          const bare = left.type === "Identifier" ? left.name : null;
          if (
            (seam && clockSeams.includes(seam)) ||
            (bare && clockSeams.includes(bare)) ||
            isParameterDefault(context, left)
          ) {
            return;
          }
          context.report({
            node,
            messageId: "fabricatedTimestamp",
            data: { left: sourceOf(context, left) },
          });
          return;
        }

        // ── B. literal-as-measurement ─────────────────────────────────────
        const literal = staticString(right);
        if (literal !== null) {
          if (isHonestAbsenceString(literal)) return;
          if (readsConfiguration(context, left, configCallees)) return;

          // Only a NAMED property read is treated as collected data. A bare
          // `name` parameter falling back to a default title is a caller's
          // default; `map[k] || "low"` is a lookup miss; `item.status ||
          // "online"` is an unmeasured field dressed as a measurement, and
          // only the last of those is a lie. In a chain such as `a?.x` then
          // `b?.y` falling back to a status word, the operand that actually
          // ran out is the right-most one in the chain, not the whole chain.
          let probe = unwrap(left);
          while (probe && probe.type === "LogicalExpression") probe = unwrap(probe.right);
          const source = probe;
          if (!source || source.type !== "MemberExpression" || source.computed) return;
          const readName = memberName(source);
          if (!readName || PRESENTATIONAL_NAMES.test(readName)) return;
          let root = unwrap(source.object);
          while (root && root.type === "MemberExpression") root = unwrap(root.object);
          if (root && root.type === "Identifier" && optionsIdentifiers.includes(root.name)) return;

          const where = fabricationContext(node);
          if (!where) return;

          context.report({
            node,
            messageId: "fabricatedString",
            data: { left: sourceOf(context, left), value: literal, where },
          });
          return;
        }

        // ── C. zero flattening ────────────────────────────────────────────
        if (isNumericLiteral(right, 0)) {
          if (insideAggregationCallback(node) || insideMathExtreme(node)) return;
          const source = stripNumericCoercion(left);
          const readName = source
            ? (memberName(source) ?? (source.type === "Identifier" ? source.name : null))
            : null;
          const keyName = enclosingPropertyKey(node);
          const what = [readName, keyName].find((n) => n && measurementRe.test(n));
          if (!what) return;
          context.report({
            node,
            messageId: "fabricatedZero",
            data: { left: sourceOf(context, left), what },
          });
        }
      },

      // ── D. invented literal on a failure path ───────────────────────────
      ReturnStatement(node) {
        if (!checkCatchReturns) return;
        const arg = unwrap(node.argument);
        if (!arg || arg.type !== "Literal") return;
        const value = arg.value;
        const isSuspectNumber = typeof value === "number" && Math.abs(value) > 1;
        const isSuspectString =
          typeof value === "string" && value.trim() !== "" && !isHonestAbsenceString(value);
        if (!isSuspectNumber && !isSuspectString) return;

        // only inside a catch block, or after one in the same function body
        let inCatch = false;
        /** @type {AnyNode | null} */
        let fn = null;
        for (let p = /** @type {AnyNode | null | undefined} */ (node.parent); p; p = p.parent) {
          if (p.type === "CatchClause") inCatch = true;
          if (
            p.type === "FunctionDeclaration" ||
            p.type === "FunctionExpression" ||
            p.type === "ArrowFunctionExpression"
          ) {
            fn = p;
            break;
          }
        }
        if (!inCatch) {
          if (!fn || !fn.body || fn.body.type !== "BlockStatement") return;
          const hasTry = fn.body.body.some((s) => s.type === "TryStatement");
          const isTail = fn.body.body[fn.body.body.length - 1] === node;
          if (!hasTry || !isTail) return;
        }
        context.report({
          node,
          messageId: "fabricatedFailureValue",
          data: { value: typeof value === "string" ? `"${value}"` : String(value) },
        });
      },
    };
  },
};

// ─── Rule 2: require-fabrication-justification ──────────────────────────────

const DISABLE_DIRECTIVE = /^\s*eslint-disable(?:-next-line|-line)?\s+(.*)$/;

/** @type {import("eslint").Rule.RuleModule} */
const requireFabricationJustification = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Every eslint-disable of a fabrication rule must carry a `--` justification naming what the value really is.",
    },
    schema: [
      {
        type: "object",
        properties: {
          ruleNames: { type: "array", items: { type: "string" } },
          minLength: { type: "number" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missing:
        "Disabling `{{rule}}` needs a justification: append ` -- <why this value is measured, not invented>` (at least {{min}} characters) to the disable comment.",
    },
  },
  create(context) {
    /** @type {JustificationOptions} */
    const opts = context.options[0] ?? {};
    // The plugin-qualified id comes first so the message names the rule as it
    // is written in this repository; the bare name is still matched.
    const names = opts.ruleNames ?? [
      "fabrication/no-fabricated-fallback",
      "no-fabricated-fallback",
    ];
    const min = opts.minLength ?? 20;
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const m = DISABLE_DIRECTIVE.exec(comment.value);
          if (!m) continue;
          // The capture group always participates when the pattern matches, and
          // String#split always returns at least one element.
          const [rulePart, ...rest] = /** @type {[string, ...string[]]} */ (
            /** @type {string} */ (m[1]).split("--")
          );
          const mentioned = names.find((n) => rulePart.includes(n));
          if (!mentioned) continue;
          if (rest.join("--").trim().length >= min) continue;
          context.report({
            // ESLint attaches a location to every comment it hands a rule; the
            // ESTree type only marks it optional.
            loc: /** @type {import("eslint").AST.SourceLocation} */ (comment.loc),
            messageId: "missing",
            data: { rule: mentioned, min },
          });
        }
      },
    };
  },
};

/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: { name: "fabrication", version: "1.0.0" },
  rules: {
    "no-fabricated-fallback": noFabricatedFallback,
    "require-fabrication-justification": requireFabricationJustification,
  },
};

export default plugin;
