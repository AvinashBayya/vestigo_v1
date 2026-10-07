/**
 * R0 of the reclamation track (docs/MASTER-BUILD-SEQUENCE.md; the method is
 * docs/vapt/VAPT-REFERENCES.md, part 1d): bins every exported function and
 * class in the read-only legacy/ tree so R1 starts from a harvest list, not
 * from memory.
 *
 *   PURE                 no I/O, no clock, no randomness, no browser or process
 *                        state; deterministic. The harvest list.
 *   FABRICATION-FLAGGED  this repository's fabrication gate fires inside it:
 *                        the line patterns (fabrication.ts) or the AST rule
 *                        (eslint/fabrication-plugin.js), with legacy's own
 *                        disable comments ignored. Quarantine.
 *   IO-BOUND             network, disk, database or queue, directly or through
 *                        a function that is; or the clock, randomness or the
 *                        process environment, which break determinism the
 *                        same way and are ported the same way (injected).
 *   UI/DEAD              React (JSX, hooks), browser state (localStorage,
 *                        window, document), or exported and imported by
 *                        nothing in legacy/ (tests count as importers).
 *
 * Precedence, first that applies: UI/DEAD, FABRICATION-FLAGGED, IO-BOUND, PURE.
 * Reads source only; never imports or runs legacy code. Reference tooling: it
 * produces docs/reclamation/legacy-classification.md and ships nothing.
 */
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
import ts from "typescript";
import fabricationPlugin from "../eslint/fabrication-plugin.js";
import { scanSource } from "./fabrication.ts";

export const BINS = ["PURE", "FABRICATION-FLAGGED", "IO-BOUND", "UI/DEAD"] as const;
export type Bin = (typeof BINS)[number];

/** A source file, by its path from the repository root (always with forward slashes). */
export interface LegacyFile {
  readonly path: string;
  readonly text: string;
}

export interface Classified {
  readonly path: string;
  readonly name: string;
  readonly kind: "function" | "class" | "object";
  readonly line: number;
  readonly bin: Bin;
  readonly reason: string;
}

/** Modules whose use is I/O: network, disk, processes, databases, queues. */
const IO_MODULES =
  /^(?:node:)?(?:fs|fs\/promises|child_process|net|tls|dns|http|https|http2|dgram|worker_threads)$|^(?:pg|postgres|drizzle-orm.*|@prisma\/.*|prisma|ioredis|redis|bullmq|axios|undici|node-fetch|got|ws|better-sqlite3|sqlite3|@supabase\/.*|@neondatabase\/.*|@aws-sdk\/.*|nodemailer|puppeteer.*|playwright.*)$/;

/** Globals whose use is I/O or non-determinism, with what each means, in words. */
const IO_GLOBALS: Readonly<Record<string, string>> = {
  fetch: "calls fetch",
  XMLHttpRequest: "uses XMLHttpRequest",
  WebSocket: "opens a WebSocket",
  EventSource: "opens an EventSource",
  setTimeout: "schedules with setTimeout (the clock)",
  setInterval: "schedules with setInterval (the clock)",
};

/** Member reads that are I/O or non-determinism: `object.member`. */
const IO_MEMBERS: Readonly<Record<string, string>> = {
  "Date.now": "reads the clock (Date.now)",
  "performance.now": "reads the clock (performance.now)",
  "Math.random": "uses randomness (Math.random)",
  "crypto.randomUUID": "uses randomness (crypto.randomUUID)",
  "crypto.getRandomValues": "uses randomness (crypto.getRandomValues)",
  "crypto.randomBytes": "uses randomness (crypto.randomBytes)",
  "process.env": "reads the process environment",
};

/**
 * How much a cause matters when porting, strongest first: real I/O (network,
 * disk, database, queue) must be replaced; the environment must be passed in;
 * the clock and randomness must be injected.
 */
export function ioRank(reason: string): number {
  const cause = reason.replace(/^via [^:]+: /, "");
  if (/clock|randomness|setTimeout|setInterval/.test(cause)) return 2;
  if (/environment/.test(cause)) return 1;
  return 0;
}

/** The stronger of two causes (lower rank wins; the first found on a tie). */
const stronger = (current: string | null, offered: string): string =>
  current === null || ioRank(offered) < ioRank(current) ? offered : current;

/** Browser state that makes code UI-bound. */
const BROWSER_GLOBALS = new Set([
  "localStorage",
  "sessionStorage",
  "window",
  "document",
  "navigator",
]);

/** Files the framework loads by convention: their exports are used without an import. */
const ENTRY_POINTS = [
  /\/routes\//,
  /\/routeTree\.gen\.ts$/,
  /\/src\/(?:server|start|router)\.tsx?$/,
];

interface Decl {
  readonly file: string;
  readonly name: string;
  readonly kind: "function" | "class" | "object";
  readonly exported: boolean;
  /** Names it is exported as (`default` for a default export). */
  readonly exportedAs: string[];
  readonly line: number;
  readonly endLine: number;
  readonly node: ts.Node;
}

interface Binding {
  readonly module: string;
  /** The imported name, `default`, or `*` for a namespace import. */
  readonly imported: string;
}

interface Parsed {
  readonly file: LegacyFile;
  readonly source: ts.SourceFile;
  readonly decls: Decl[];
  readonly imports: Map<string, Binding>;
  /** Import specifiers that resolve inside legacy/, with what is taken from each. */
  readonly uses: { target: string; names: string[] | "*" }[];
  /** Every name declared at module level. */
  readonly declared: Set<string>;
  /** Exported constants that hold no function: data, not classified. */
  readonly plainExports: string[];
}

const lineOf = (source: ts.SourceFile, position: number) =>
  source.getLineAndCharacterOfPosition(position).line + 1;

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind) =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);

/** Resolves `@/x` and relative specifiers to a legacy file path; null for a package. */
export function resolveSpecifier(
  from: string,
  specifier: string,
  exists: (path: string) => boolean,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = `legacy/src/${specifier.slice(2)}`;
  else if (specifier.startsWith(".")) {
    const parts = from.split("/").slice(0, -1);
    for (const part of specifier.split("/")) {
      if (part === "..") parts.pop();
      else if (part !== ".") parts.push(part);
    }
    base = parts.join("/");
  } else return null;
  const stripped = base.replace(/\.(?:js|jsx|ts|tsx)$/, "");
  for (const candidate of [
    base,
    `${stripped}.ts`,
    `${stripped}.tsx`,
    `${stripped}/index.ts`,
    `${stripped}/index.tsx`,
  ]) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

function parse(file: LegacyFile, exists: (path: string) => boolean): Parsed {
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const decls: Decl[] = [];
  const imports = new Map<string, Binding>();
  const uses: Parsed["uses"] = [];
  const exportedLater = new Map<string, string[]>();
  const declared = new Set<string>();
  const plainExports: string[] = [];

  const add = (name: string, kind: Decl["kind"], node: ts.Node, exportedAs: string[]) => {
    decls.push({
      file: file.path,
      name,
      kind,
      exported: exportedAs.length > 0,
      exportedAs,
      line: lineOf(source, node.getStart(source)),
      endLine: lineOf(source, node.getEnd()),
      node,
    });
  };

  for (const statement of source.statements) {
    const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const module = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      const names: string[] = [];
      let whole = false;
      if (clause?.name) {
        imports.set(clause.name.text, { module, imported: "default" });
        names.push("default");
      }
      const bindings = clause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        imports.set(bindings.name.text, { module, imported: "*" });
        whole = true;
      } else if (bindings) {
        for (const element of bindings.elements) {
          const imported = (element.propertyName ?? element.name).text;
          imports.set(element.name.text, { module, imported });
          names.push(imported);
        }
      }
      const target = resolveSpecifier(file.path, module, exists);
      if (target !== null) uses.push({ target, names: whole ? "*" : names });
    } else if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      if (specifier && ts.isStringLiteral(specifier)) {
        // A re-export forwards the module's exports: counted as a use of them.
        const target = resolveSpecifier(file.path, specifier.text, exists);
        const clause = statement.exportClause;
        if (target !== null) {
          uses.push({
            target,
            names:
              clause && ts.isNamedExports(clause)
                ? clause.elements.map((e) => (e.propertyName ?? e.name).text)
                : "*",
          });
        }
      } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const local = (element.propertyName ?? element.name).text;
          exportedLater.set(local, [...(exportedLater.get(local) ?? []), element.name.text]);
        }
      }
    } else if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      const local = statement.expression.text;
      exportedLater.set(local, [...(exportedLater.get(local) ?? []), "default"]);
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      const name = statement.name.text;
      add(name, "function", statement, exported ? [isDefault ? "default" : name] : []);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      const name = statement.name.text;
      add(name, "class", statement, exported ? [isDefault ? "default" : name] : []);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declared.add(declaration.name.text);
        const init = declaration.initializer;
        if (!ts.isIdentifier(declaration.name) || init === undefined) continue;
        // A function held in a constant, possibly wrapped (memo(), forwardRef(), a cast).
        let inner: ts.Expression = init;
        while (
          ts.isCallExpression(inner) ||
          ts.isAsExpression(inner) ||
          ts.isParenthesizedExpression(inner)
        ) {
          if (ts.isCallExpression(inner)) {
            const fn = inner.arguments.find(
              (a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a),
            );
            if (fn === undefined) break;
            inner = fn;
          } else inner = inner.expression;
        }
        if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) {
          const name = declaration.name.text;
          add(name, "function", statement, exported ? [name] : []);
          continue;
        }
        // An object that holds functions (a collector definition, say) is binned as a unit.
        let object: ts.Expression = init;
        while (
          ts.isSatisfiesExpression(object) ||
          ts.isAsExpression(object) ||
          ts.isParenthesizedExpression(object)
        ) {
          object = object.expression;
        }
        const holdsFunctions =
          ts.isObjectLiteralExpression(object) &&
          object.properties.some(
            (property) =>
              ts.isMethodDeclaration(property) ||
              ts.isGetAccessorDeclaration(property) ||
              (ts.isPropertyAssignment(property) &&
                (ts.isArrowFunction(property.initializer) ||
                  ts.isFunctionExpression(property.initializer))),
          );
        if (holdsFunctions) {
          const name = declaration.name.text;
          add(name, "object", statement, exported ? [name] : []);
        } else if (exported) {
          plainExports.push(declaration.name.text);
        }
      }
    }
  }
  // `export { local as name }` and `export default local`, after their declarations.
  for (let index = 0; index < decls.length; index += 1) {
    const decl = decls[index];
    if (decl === undefined) continue;
    const later = exportedLater.get(decl.name);
    if (later !== undefined) {
      decls[index] = { ...decl, exported: true, exportedAs: [...decl.exportedAs, ...later] };
    }
  }
  for (const decl of decls) declared.add(decl.name);
  return { file, source, decls, imports, uses, declared, plainExports };
}

/** What a declaration's body touches, read off its syntax. */
interface Touches {
  readonly ui: string | null;
  readonly io: string | null;
  /** Identifiers it uses that may be other declarations or imports. */
  readonly names: Set<string>;
}

function touches(decl: Decl, parsed: Parsed): Touches {
  // Set inside the walk below; an object, so the closure's writes are visible here.
  const found: { ui: string | null; io: string | null } = { ui: null, io: null };
  const names = new Set<string>();
  // Names declared in the body or at module level shadow a global of the same
  // name: `const window = …` is a time window, not the browser's.
  const declared = new Set(parsed.declared);
  const collect = (node: ts.Node): void => {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name)
    ) {
      declared.add(node.name.text);
    }
    ts.forEachChild(node, collect);
  };
  collect(decl.node);
  const visit = (node: ts.Node): void => {
    if (
      found.ui === null &&
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node))
    ) {
      found.ui = "renders JSX";
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const callee = node.expression.text;
      if (found.ui === null && /^use[A-Z]/.test(callee)) found.ui = `uses a React hook (${callee})`;
    }
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "Date"
    ) {
      if (node.arguments === undefined || node.arguments.length === 0) {
        found.io = stronger(found.io, "reads the clock (new Date() with no argument)");
      }
    }
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const key = `${node.expression.text}.${node.name.text}`;
      const meaning = IO_MEMBERS[key];
      if (meaning !== undefined) found.io = stronger(found.io, meaning);
    }
    if (ts.isIdentifier(node)) {
      const text = node.text;
      const parent = node.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!isPropertyName) {
        const shadowed = declared.has(text) || parsed.imports.has(text);
        if (found.ui === null && BROWSER_GLOBALS.has(text) && !shadowed) {
          found.ui = `uses browser state (${text})`;
        }
        const global = IO_GLOBALS[text];
        if (global !== undefined && !shadowed) found.io = stronger(found.io, global);
        names.add(text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(decl.node, visit);
  // An imported I/O module used in the body.
  for (const name of names) {
    const binding = parsed.imports.get(name);
    if (binding !== undefined && IO_MODULES.test(binding.module)) {
      found.io = stronger(found.io, `uses ${binding.module} (${name})`);
      break;
    }
  }
  if (found.ui === null) {
    for (const name of names) {
      const binding = parsed.imports.get(name);
      if (binding !== undefined && /^(?:react|react-dom)(?:\/|$)/.test(binding.module)) {
        found.ui = `uses React (${name})`;
        break;
      }
    }
  }
  return { ui: found.ui, io: found.io, names };
}

/** Lines in the file where the fabrication gate fires, with the check that fired. */
export function fabricationLines(file: LegacyFile): Map<number, string> {
  const lines = new Map<number, string>();
  for (const match of scanSource(file.path, file.text)) {
    if (!lines.has(match.line)) lines.set(match.line, match.check);
  }
  const linter = new Linter({ configType: "flat" });
  const messages = linter.verify(
    file.text,
    [
      {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: { ecmaFeatures: { jsx: file.path.endsWith(".tsx") } },
        },
        plugins: { fabrication: fabricationPlugin },
        rules: { "fabrication/no-fabricated-fallback": "error" },
        // Legacy silenced the rule in places; the gate here has no escape hatch.
        linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
      },
    ],
    { filename: file.path },
  );
  for (const message of messages) {
    if (message.ruleId === "fabrication/no-fabricated-fallback" && !lines.has(message.line)) {
      lines.set(message.line, "no-fabricated-fallback");
    }
  }
  return lines;
}

/**
 * Bins every exported function and class in the given files. Imports between
 * the files decide what is dead, and carry I/O from callee to caller.
 */
export function classifyLegacy(files: readonly LegacyFile[]): Classified[] {
  return classifyLegacyWithData(files).classified;
}

/** The classification, and how many exported constants hold only data (not classified). */
export function classifyLegacyWithData(files: readonly LegacyFile[]): {
  readonly classified: Classified[];
  readonly plainExports: { readonly path: string; readonly name: string }[];
} {
  const paths = new Set(files.map((file) => file.path));
  const exists = (path: string) => paths.has(path);
  const parsed = files.map((file) => parse(file, exists));
  const byPath = new Map(parsed.map((entry) => [entry.file.path, entry]));

  // Who imports what: (file, exported name) → importers.
  const importers = new Map<string, Set<string>>();
  const wholeModule = new Map<string, Set<string>>();
  for (const entry of parsed) {
    for (const use of entry.uses) {
      if (use.names === "*") {
        wholeModule.set(
          use.target,
          (wholeModule.get(use.target) ?? new Set()).add(entry.file.path),
        );
      } else {
        for (const name of use.names) {
          const key = `${use.target}#${name}`;
          importers.set(key, (importers.get(key) ?? new Set()).add(entry.file.path));
        }
      }
    }
  }
  const importersOf = (decl: Decl) => {
    const found = new Set(wholeModule.get(decl.file) ?? []);
    for (const name of decl.exportedAs)
      for (const by of importers.get(`${decl.file}#${name}`) ?? []) found.add(by);
    found.delete(decl.file);
    return found;
  };

  // Direct signals, then I/O carried from callee to caller to a fixed point.
  const info = new Map<Decl, Touches & { io: string | null }>();
  const declsByFile = new Map<string, Map<string, Decl>>();
  for (const entry of parsed) {
    const local = new Map<string, Decl>();
    for (const decl of entry.decls) {
      local.set(decl.name, decl);
      info.set(decl, touches(decl, entry));
    }
    declsByFile.set(entry.file.path, local);
  }
  const exportedDecl = (file: string, name: string): Decl | undefined =>
    byPath.get(file)?.decls.find((decl) => decl.exportedAs.includes(name));

  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of parsed) {
      for (const decl of entry.decls) {
        const own = info.get(decl);
        if (own === undefined || (own.io !== null && ioRank(own.io) === 0)) continue;
        for (const name of own.names) {
          if (name === decl.name) continue;
          let callee = declsByFile.get(entry.file.path)?.get(name);
          let where = "this file";
          const binding = entry.imports.get(name);
          if (callee === undefined && binding !== undefined && binding.imported !== "*") {
            const target = resolveSpecifier(entry.file.path, binding.module, exists);
            if (target !== null) {
              callee = exportedDecl(target, binding.imported);
              where = target.replace(/^legacy\//, "");
            }
          }
          const calleeIo = callee === undefined ? null : info.get(callee)?.io;
          if (callee !== undefined && calleeIo != null) {
            // The root cause travels with the chain: "via a (x.ts): calls fetch".
            const cause = calleeIo.replace(/^via [^:]+: /, "");
            const offered = `via ${callee.name} (${where}): ${cause}`;
            if (own.io === null || ioRank(offered) < ioRank(own.io)) {
              info.set(decl, { ...own, io: offered });
              changed = true;
              break;
            }
          }
        }
      }
    }
  }

  const results: Classified[] = [];
  for (const entry of parsed) {
    const fabricated = fabricationLines(entry.file);
    for (const decl of entry.decls) {
      if (!decl.exported) continue;
      const own = info.get(decl);
      if (own === undefined) continue;
      const by = importersOf(decl);
      const entryPoint = ENTRY_POINTS.some((pattern) => pattern.test(decl.file));
      const onlyTests = by.size > 0 && [...by].every((path) => path.startsWith("legacy/tests/"));
      const flagged = [...fabricated].filter(([line]) => line >= decl.line && line <= decl.endLine);
      const name = decl.exportedAs.includes("default") ? `default (${decl.name})` : decl.name;
      const base = { path: decl.file, name, kind: decl.kind, line: decl.line };
      if (own.ui !== null) {
        results.push({ ...base, bin: "UI/DEAD", reason: own.ui });
      } else if (by.size === 0 && !entryPoint) {
        results.push({ ...base, bin: "UI/DEAD", reason: "no legacy module or test imports it" });
      } else if (flagged.length > 0) {
        const [first] = flagged;
        const checks = [...new Set(flagged.map(([, check]) => check))].join(", ");
        results.push({
          ...base,
          bin: "FABRICATION-FLAGGED",
          reason: `gate fires ${String(flagged.length)}× (${checks}), first at line ${String(first?.[0])}`,
        });
      } else if (own.io !== null) {
        results.push({ ...base, bin: "IO-BOUND", reason: own.io });
      } else {
        results.push({
          ...base,
          bin: "PURE",
          reason: onlyTests
            ? "deterministic; imported only by tests"
            : "deterministic: no I/O, clock, randomness, browser or process state",
        });
      }
    }
  }
  return {
    classified: results.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line),
    plainExports: parsed.flatMap((entry) =>
      entry.plainExports.map((name) => ({ path: entry.file.path, name })),
    ),
  };
}
