/// <reference lib="deno.unstable" />

/** Structural forcing functions for Discern's external terminal boundary. */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import {
  AUTHORED_DENO_FILES,
  AUTHORED_TS_FILES,
  REPO_ROOT,
} from "./repo_authored_paths.ts";

const TERMINAL_AUTHORITY = "src/lib/terminal.ts";
const TEXT_AUTHORITY = "src/lib/text.ts";
const RUNTIME_TS_FILES = AUTHORED_TS_FILES.filter((rel) =>
  !rel.startsWith("tests/")
);
const RUNTIME_DENO_FILES = AUTHORED_DENO_FILES.filter((rel) =>
  !rel.startsWith("tests/")
);
const PROMPT_AUTHORITY = "src/lib/prompts.ts";
const PAINTER_AUTHORITY = "src/lib/terminal_painter.ts";
const INTERACTIVE_MODULE = "discern-design-system/cli/interactive";

/** Every migrated supervisory presentation tree, enrolled from authored source. */
function consumesExplicitPresentationFacts(
  rel: string,
  source = "",
): boolean {
  return rel.startsWith("src/engine/gate/") ||
    rel.startsWith("src/engine/status/") ||
    rel.startsWith("src/engine/improve/") ||
    rel === "src/engine/logbook/patterns.ts" ||
    (rel.startsWith("src/engine/logbook/") &&
      publicCliImports(source).some((name) => name.startsWith("render")));
}

interface Finding {
  readonly file: string;
  readonly rule: string;
  readonly authority?: string;
}

type SourceUniverse = ReadonlyMap<string, string>;

/** Remove comments so detector fixtures and architecture prose do not self-match. */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

/** Extract named imports from the configured public CLI alias. */
function publicCliImports(source: string): string[] {
  const imports: string[] = [];
  for (
    const match of source.matchAll(
      /import\s*\{([\s\S]*?)\}\s*from\s*["']discern-design-system\/cli["']/gu,
    )
  ) {
    for (const part of (match[1] ?? "").split(",")) {
      const imported = part.trim().replace(/^type\s+/u, "").split(
        /\s+as\s+/u,
      )[0]
        ?.trim();
      if (imported !== undefined && imported !== "") imports.push(imported);
    }
  }
  return imports;
}

interface ImportBinding {
  readonly dependency: string;
  readonly imported: string;
  readonly local: string;
}

interface FunctionFacts {
  readonly calls: Set<string>;
  clock: boolean;
  renders: boolean;
}

interface SourceFacts {
  readonly functions: Map<string, FunctionFacts>;
  readonly imports: ImportBinding[];
  readonly outViolations: number;
  readonly publicRenderer: boolean;
}

/** Resolve a node's stable binding name, including block-bodied arrow helpers. */
function functionName(node: Deno.lint.Node): string | undefined {
  if (node.type === "FunctionDeclaration") return node.id?.name;
  if (
    node.type !== "ArrowFunctionExpression" &&
    node.type !== "FunctionExpression"
  ) return undefined;
  if (node.parent.type !== "VariableDeclarator") return node.id?.name;
  return node.parent.id.type === "Identifier" ? node.parent.id.name : undefined;
}

/** Nearest named function containing an AST node. */
function enclosingFunction(
  context: Deno.lint.RuleContext,
  node: Deno.lint.Node,
): string | undefined {
  return context.sourceCode.getAncestors(node).toReversed().flatMap((
    ancestor,
  ) => functionName(ancestor) ?? [])[0];
}

/** Identifier-like property name used by the two structural call checks. */
function propertyName(node: Deno.lint.Node): string | undefined {
  if (node.type === "Identifier") return node.name;
  return node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : undefined;
}

/** Whether makeOut receives one context as both colour and terminal policy. */
function carriesExplicitContext(node: Deno.lint.CallExpression): boolean {
  const color = node.arguments[0];
  if (
    color?.type !== "MemberExpression" ||
    color.object.type !== "Identifier" ||
    propertyName(color.property) !== "color"
  ) return false;
  const context = color.object.name;
  const options = node.arguments[1];
  if (options?.type !== "ObjectExpression") return false;
  return options.properties.some((property) =>
    property.type === "Property" && propertyName(property.key) === "terminal" &&
    property.value.type === "Identifier" && property.value.name === context
  );
}

/** Parse one authored module through Deno's TypeScript AST, not a text grammar. */
function sourceFacts(rel: string, source: string): SourceFacts {
  const functions = new Map<string, FunctionFacts>();
  const imports: ImportBinding[] = [];
  const publicRenderers = new Set<string>();
  const outputBuilders = new Set<string>();
  let publicRenderer = false;
  let outViolations = 0;
  const factsFor = (name: string): FunctionFacts => {
    const existing = functions.get(name);
    if (existing !== undefined) return existing;
    const created = { calls: new Set<string>(), clock: false, renders: false };
    functions.set(name, created);
    return created;
  };
  const plugin = {
    name: "discern-explicit-presentation-facts",
    rules: {
      collect: {
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          const register = (node: Deno.lint.Node): void => {
            const name = functionName(node);
            if (name !== undefined) factsFor(name);
          };
          const markClock = (node: Deno.lint.Node): void => {
            const name = enclosingFunction(context, node);
            if (name !== undefined) factsFor(name).clock = true;
          };
          return {
            ImportDeclaration(node): void {
              if (node.importKind === "type") return;
              const specifier = node.source.value;
              const dependency = specifier.startsWith(".")
                ? normalize(join(dirname(rel), specifier)).replaceAll("\\", "/")
                : undefined;
              for (const imported of node.specifiers) {
                if (
                  imported.type !== "ImportSpecifier" ||
                  imported.importKind === "type"
                ) continue;
                const original = propertyName(imported.imported);
                if (original === undefined) continue;
                if (
                  specifier === "discern-design-system/cli" &&
                  original.startsWith("render")
                ) {
                  publicRenderer = true;
                  publicRenderers.add(imported.local.name);
                }
                if (dependency !== undefined) {
                  imports.push({
                    dependency,
                    imported: original,
                    local: imported.local.name,
                  });
                  if (
                    original === "makeOut" &&
                    /(?:^|\/)engine\/output\.ts$/u.test(dependency)
                  ) outputBuilders.add(imported.local.name);
                }
              }
            },
            FunctionDeclaration: register,
            FunctionExpression: register,
            ArrowFunctionExpression: register,
            CallExpression(node): void {
              const name = enclosingFunction(context, node);
              if (node.callee.type === "Identifier") {
                if (name !== undefined) {
                  const facts = factsFor(name);
                  facts.calls.add(node.callee.name);
                  if (publicRenderers.has(node.callee.name)) {
                    facts.renders = true;
                  }
                }
                if (
                  outputBuilders.has(node.callee.name) &&
                  !carriesExplicitContext(node)
                ) outViolations++;
              }
              if (
                node.arguments.length === 0 &&
                node.callee.type === "MemberExpression" &&
                node.callee.object.type === "Identifier" &&
                node.callee.object.name === "Date" &&
                propertyName(node.callee.property) === "now"
              ) markClock(node);
            },
            NewExpression(node): void {
              if (
                node.arguments.length === 0 &&
                node.callee.type === "Identifier" && node.callee.name === "Date"
              ) markClock(node);
            },
          };
        },
      },
    },
  } satisfies Deno.lint.Plugin;
  Deno.lint.runPlugin(plugin, rel, source);
  return { functions, imports, outViolations, publicRenderer };
}

/** Parse the authored universe once for enrollment and call-graph traversal. */
function presentationSourceFacts(
  sources: SourceUniverse,
): ReadonlyMap<string, SourceFacts> {
  return new Map(
    [...sources].map(([rel, source]) => [rel, sourceFacts(rel, source)]),
  );
}

/**
 * Package-backed supervisory views, plus their engine-side importers. Gate is a
 * predecessor-owned presentation boundary; this 2B guard covers every other
 * current or future engine view that imports a public package render function.
 */
function explicitPresentationFactFiles(
  sources: SourceUniverse,
  facts = presentationSourceFacts(sources),
): {
  readonly views: ReadonlySet<string>;
  readonly entrypoints: ReadonlySet<string>;
} {
  const views = new Set(
    [...facts].flatMap(([rel, source]) =>
      rel.startsWith("src/engine/") &&
        !rel.startsWith("src/engine/gate/") &&
        source.publicRenderer
        ? [rel]
        : []
    ),
  );
  const entrypoints = new Set(views);
  for (const [rel, source] of facts) {
    if (
      entrypoints.has(rel) || !rel.startsWith("src/engine/") ||
      rel.startsWith("src/engine/gate/")
    ) continue;
    if (
      source.imports.some((binding) => views.has(binding.dependency))
    ) {
      entrypoints.add(rel);
    }
  }
  return { views, entrypoints };
}

interface FunctionRef {
  readonly file: string;
  readonly name: string;
}

/** Find no-argument clocks reachable through named presentation calls/imports. */
function presentationClockFindings(
  views: ReadonlySet<string>,
  facts: ReadonlyMap<string, SourceFacts>,
): Finding[] {
  const pending: FunctionRef[] = [];
  for (const rel of views) {
    for (const [name, fn] of facts.get(rel)?.functions ?? []) {
      if (/^(?:render|present)/u.test(name) || fn.renders) {
        pending.push({ file: rel, name });
      }
    }
  }
  const reached = new Set<string>();
  const findings: Finding[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    const key = `${current.file}#${current.name}`;
    if (reached.has(key)) continue;
    reached.add(key);
    const source = facts.get(current.file);
    if (source === undefined) continue;
    const fn = source.functions.get(current.name);
    if (fn === undefined) continue;
    if (fn.clock) {
      findings.push({
        file: current.file,
        rule: `hidden-presentation-clock:${current.name}`,
      });
    }
    for (const call of fn.calls) {
      if (source.functions.has(call)) {
        pending.push({ file: current.file, name: call });
      }
    }
    for (const binding of source.imports) {
      if (fn.calls.has(binding.local)) {
        pending.push({ file: binding.dependency, name: binding.imported });
      }
    }
  }
  return findings;
}

/** Enumerate missing time/context facts across the dynamic presentation graph. */
function explicitPresentationFactFindings(
  sources: SourceUniverse,
): Finding[] {
  const facts = presentationSourceFacts(sources);
  const enrolled = explicitPresentationFactFiles(sources, facts);
  const findings = presentationClockFindings(enrolled.views, facts);
  for (const rel of enrolled.entrypoints) {
    for (let i = 0; i < (facts.get(rel)?.outViolations ?? 0); i++) {
      findings.push({ file: rel, rule: "output-context-not-explicit" });
    }
  }
  return findings;
}

const PROCESS_CAPABILITY_RULES = [
  {
    id: "package-capability-detector",
    pattern: /\bdetectTerminalCapabilities\b/u,
  },
  {
    id: "Deno-console-size",
    pattern: /\bDeno\.consoleSize\b/u,
  },
  {
    id: "terminal-environment-read",
    pattern:
      /\b(?:Deno\.)?env\.get\(\s*["'](?:TERM|COLORTERM|LC_ALL|LC_CTYPE|LANG|NO_COLOR|COLUMNS|LINES)["']/u,
  },
  {
    id: "Node-terminal-environment-read",
    pattern:
      /\bprocess\.env(?:\.|\[\s*["'])(?:TERM|COLORTERM|LC_ALL|LC_CTYPE|LANG|NO_COLOR|COLUMNS|LINES)\b/u,
  },
] as const;

const TERMINAL_ONLY_IMPORTS = new Set([
  "deriveTerminalTheme",
  "detectTerminalCapabilities",
  "styleText",
  "terminalThemeColor",
  "terminalThemes",
  "terminalToneColor",
]);

const TEXT_ONLY_IMPORTS = new Set([
  "graphemeWidth",
  "measureText",
  "padText",
  "stripAnsi",
  "truncateText",
  "wrapText",
]);

/** Find process probes or low-level package imports outside their authorities. */
function authorityFindings(rel: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const code = codeOnly(source);
  if (rel !== TERMINAL_AUTHORITY) {
    for (const rule of PROCESS_CAPABILITY_RULES) {
      if (rule.pattern.test(code)) findings.push({ file: rel, rule: rule.id });
    }
    if (
      /import\s*\*\s*as\s+\w+\s*from\s*["']discern-design-system\/cli["']/u
        .test(code)
    ) {
      findings.push({ file: rel, rule: "CLI-namespace-import" });
    }
  }
  for (const imported of publicCliImports(code)) {
    if (rel !== TERMINAL_AUTHORITY && TERMINAL_ONLY_IMPORTS.has(imported)) {
      findings.push({ file: rel, rule: `terminal-import:${imported}` });
    }
    if (rel !== TEXT_AUTHORITY && TEXT_ONLY_IMPORTS.has(imported)) {
      findings.push({ file: rel, rule: `text-import:${imported}` });
    }
  }
  return findings;
}

/** Find imports that substitute package source for a documented public export. */
function packageSourceImportFindings(rel: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const specifiers = [...source.matchAll(
    /(?:from\s*|import\s*\(\s*)["']([^"']+)["']/gu,
  )].flatMap((match) => match[1] === undefined ? [] : [match[1]]);
  for (const specifier of specifiers) {
    if (
      /(?:^|\/)discern-design-system\/src(?:\/|$)/u.test(specifier) ||
      /@discern-sh\/design-system(?:@[^/]*)?\/src(?:\/|$)/u.test(specifier) ||
      specifier.includes("/Users/jack/Sites/discern-design-system/")
    ) {
      findings.push({ file: rel, rule: `package-source:${specifier}` });
    }
  }
  return findings;
}

/** Find presentation imports whose only remaining owner is Cliffy's parser. */
function cliffyPresentationFindings(rel: string, source: string): Finding[] {
  const code = codeOnly(source);
  return [...code.matchAll(
    /(?:from\s*|import\s*(?:\(\s*)?)["'](@cliffy\/(?:ansi(?:\/colors)?|table))["']/gu,
  )].map((match) => ({
    file: rel,
    rule: `cliffy-presentation:${match[1] ?? "unknown"}`,
  }));
}

/** Extract every static module specifier, including side-effect and dynamic imports. */
function moduleSpecifiers(source: string): string[] {
  const code = codeOnly(source);
  return [
    ...code.matchAll(
      /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/gu,
    ),
  ].flatMap((match) => match[1] === undefined ? [] : [match[1]]);
}

/** Cliffy's command parser is the sole legal authored Cliffy import. */
function cliffyImportFindings(rel: string, source: string): Finding[] {
  return moduleSpecifiers(source).flatMap((specifier) =>
    specifier.startsWith("@cliffy/") && specifier !== "@cliffy/command"
      ? [{ file: rel, rule: `retired-cliffy-import:${specifier}` }]
      : []
  );
}

/**
 * Text-bearing leaves in the published 0.12.1 `*CliProps` contracts and their
 * exported nested row shapes. Generic future renderer names deliberately
 * inherit this vocabulary; a package upgrade must re-audit the public types.
 */
const COMPONENT_TEXT_PROPS = new Set([
  "accent",
  "action",
  "activeValue",
  "annotation",
  "answer",
  "asciiIcon",
  "aside",
  "attribution",
  "audience",
  "author",
  "authorRole",
  "authority",
  "bio",
  "body",
  "branch",
  "brand",
  "caption",
  "citation",
  "citeUrl",
  "code",
  "command",
  "completion",
  "completionCriterion",
  "completionLabel",
  "complexity",
  "consequences",
  "content",
  "context",
  "control",
  "correction",
  "current",
  "date",
  "dateLabel",
  "decision",
  "definition",
  "description",
  "detail",
  "details",
  "duration",
  "evidence",
  "expectedResult",
  "expectedResultLabel",
  "expectedState",
  "explanation",
  "eyebrow",
  "fact",
  "failureNote",
  "feature",
  "featureLabel",
  "filename",
  "first",
  "firstLabel",
  "focusedValue",
  "footer",
  "header",
  "hint",
  "href",
  "icon",
  "id",
  "identifier",
  "impact",
  "index",
  "initials",
  "kicker",
  "label",
  "language",
  "leadingIcon",
  "lede",
  "machineReadable",
  "mediaDescription",
  "message",
  "meta",
  "metric",
  "metricLabel",
  "middle",
  "name",
  "navigation",
  "navigationLabel",
  "nextAction",
  "nextLabel",
  "note",
  "origin",
  "outcome",
  "output",
  "path",
  "persona",
  "placeholder",
  "platform",
  "prerequisites",
  "presenceLabel",
  "previousLabel",
  "progress",
  "prompt",
  "provenance",
  "question",
  "quote",
  "rail",
  "railLabel",
  "rawDetail",
  "rawLabel",
  "reading",
  "reason",
  "recovery",
  "recoveryLabel",
  "reproductionCommand",
  "requirement",
  "retryCommand",
  "returnLabel",
  "role",
  "rule",
  "scope",
  "second",
  "secondLabel",
  "separator",
  "sigil",
  "source",
  "speaker",
  "stampLabel",
  "standfirst",
  "stateLabel",
  "statusLabel",
  "subtitle",
  "summary",
  "tagline",
  "term",
  "text",
  "title",
  "toDarkLabel",
  "toLightLabel",
  "trailingIcon",
  "value",
  "visual",
  "workingDirectory",
]);

/** Published containers whose inline producers have nested text-bearing rows. */
const COMPONENT_CONTAINER_PROPS = new Set([
  "actions",
  "authors",
  "blocks",
  "checks",
  "choices",
  "columns",
  "counts",
  "entries",
  "items",
  "legend",
  "links",
  "meta",
  "nodes",
  "people",
  "prerequisites",
  "rows",
  "sections",
  "stats",
  "steps",
  "turns",
]);

/** Unwrap TypeScript-only expression wrappers before a static safe-text check. */
function unwrappedExpression(node: Deno.lint.Node): Deno.lint.Node {
  if (
    node.type === "TSAsExpression" || node.type === "TSTypeAssertion" ||
    node.type === "TSNonNullExpression"
  ) {
    return unwrappedExpression(node.expression);
  }
  if (node.type === "ChainExpression") {
    return unwrappedExpression(node.expression);
  }
  return node;
}

/** True only when static syntax proves a product-text expression can carry data. */
function staticallyUnsafeProductText(
  candidate: Deno.lint.Node,
  sanitizers: ReadonlySet<string>,
): boolean {
  const node = unwrappedExpression(candidate);
  if (node.type === "Identifier") return true;
  if (node.type === "MemberExpression") return true;
  if (node.type === "TemplateLiteral") return node.expressions.length > 0;
  if (node.type === "BinaryExpression" || node.type === "LogicalExpression") {
    return staticallyUnsafeProductText(node.left, sanitizers) ||
      staticallyUnsafeProductText(node.right, sanitizers);
  }
  if (node.type === "ConditionalExpression") {
    return staticallyUnsafeProductText(node.consequent, sanitizers) ||
      staticallyUnsafeProductText(node.alternate, sanitizers);
  }
  if (node.type === "CallExpression") {
    if (node.callee.type === "Identifier" && sanitizers.has(node.callee.name)) {
      return false;
    }
    const calleeUnsafe = node.callee.type === "MemberExpression" &&
      (staticallyUnsafeProductText(node.callee.object, sanitizers) ||
        (node.callee.computed &&
          staticallyUnsafeProductText(node.callee.property, sanitizers)));
    return calleeUnsafe ||
      node.arguments.some((argument) =>
        argument.type === "SpreadElement" ||
        staticallyUnsafeProductText(argument, sanitizers)
      );
  }
  return false;
}

/** Whether one leaf is visibly crossed through the named safe-text adapter. */
function isSanitizedProductText(
  node: Deno.lint.Node,
  sanitizers: ReadonlySet<string>,
): boolean {
  const expression = unwrappedExpression(node);
  return expression.type === "CallExpression" &&
    expression.callee.type === "Identifier" &&
    sanitizers.has(expression.callee.name);
}

/** Inspect one declared Component container, failing closed on opaque data. */
function unsafeComponentContainer(
  node: Deno.lint.Node,
  sanitizers: ReadonlySet<string>,
  path: string,
  renderer: string,
): string[] {
  const expression = unwrappedExpression(node);
  if (
    expression.type === "ObjectExpression" ||
    expression.type === "ArrayExpression"
  ) return unsafeComponentProps(expression, sanitizers, path, renderer);
  if (expression.type === "ConditionalExpression") {
    return [expression.consequent, expression.alternate].flatMap((branch) =>
      unsafeComponentContainer(branch, sanitizers, path, renderer)
    );
  }
  if (expression.type === "LogicalExpression") {
    return [expression.left, expression.right].flatMap((branch) =>
      unsafeComponentContainer(branch, sanitizers, path, renderer)
    );
  }
  const mapped = inlineMapResults(expression);
  if (mapped !== undefined) {
    return mapped.length === 0
      ? [`${path}.<opaque-map>`]
      : mapped.flatMap((result) =>
        isSanitizedProductText(result, sanitizers)
          ? []
          : unsafeComponentContainer(result, sanitizers, path, renderer)
      );
  }
  if (expression.type === "Literal" && expression.value === null) return [];
  return [`${path}.<opaque-container>`];
}

/** Direct values returned by one inline mapping callback. */
function inlineCallbackResults(node: Deno.lint.Node): Deno.lint.Node[] {
  const callback = unwrappedExpression(node);
  if (
    callback.type !== "ArrowFunctionExpression" &&
    callback.type !== "FunctionExpression"
  ) return [];
  if (callback.body.type !== "BlockStatement") return [callback.body];
  return callback.body.body.flatMap((statement) =>
    statement.type === "ReturnStatement" && statement.argument !== null
      ? [statement.argument]
      : []
  );
}

/** Values returned by an inline `.map` producer, or undefined for other calls. */
function inlineMapResults(node: Deno.lint.Node): Deno.lint.Node[] | undefined {
  const expression = unwrappedExpression(node);
  if (
    expression.type !== "CallExpression" ||
    expression.callee.type !== "MemberExpression" ||
    propertyName(expression.callee.property) !== "map"
  ) return undefined;
  const callback = expression.arguments[0];
  if (callback === undefined || callback.type === "SpreadElement") return [];
  return inlineCallbackResults(callback);
}

/** Distinguish published text/container key collisions from their static shape. */
function staticallyContainerShaped(node: Deno.lint.Node): boolean {
  const expression = unwrappedExpression(node);
  if (
    expression.type === "ObjectExpression" ||
    expression.type === "ArrayExpression" ||
    inlineMapResults(expression) !== undefined
  ) return true;
  if (expression.type === "ConditionalExpression") {
    return staticallyContainerShaped(expression.consequent) ||
      staticallyContainerShaped(expression.alternate);
  }
  if (expression.type === "LogicalExpression") {
    return staticallyContainerShaped(expression.left) ||
      staticallyContainerShaped(expression.right);
  }
  return false;
}

/** Inspect one spread value, failing closed only when its keys are opaque. */
function unsafeComponentSpread(
  node: Deno.lint.Node,
  sanitizers: ReadonlySet<string>,
  path: string,
  renderer: string,
): string[] {
  const expression = unwrappedExpression(node);
  if (
    expression.type === "ObjectExpression" ||
    expression.type === "ArrayExpression"
  ) return unsafeComponentProps(expression, sanitizers, path, renderer);
  if (expression.type === "ConditionalExpression") {
    return [expression.consequent, expression.alternate].flatMap((branch) =>
      unsafeComponentSpread(branch, sanitizers, path, renderer)
    );
  }
  if (expression.type === "LogicalExpression") {
    const branches = expression.operator === "&&"
      ? [expression.right]
      : [expression.left, expression.right];
    return branches.flatMap((branch) =>
      unsafeComponentSpread(branch, sanitizers, path, renderer)
    );
  }
  const mapped = inlineMapResults(expression);
  if (mapped !== undefined && mapped.length > 0) {
    return mapped.flatMap((result) =>
      unsafeComponentProps(result, sanitizers, path, renderer)
    );
  }
  if (expression.type === "Literal") return [];
  return [`${path === "" ? "" : `${path}.`}<spread>`];
}

/** Inspect nested Component props for facts statically proven to bypass safe text. */
function unsafeComponentProps(
  node: Deno.lint.Node,
  sanitizers: ReadonlySet<string>,
  path = "",
  renderer = "",
): string[] {
  const expression = unwrappedExpression(node);
  if (expression.type === "ConditionalExpression") {
    return [expression.consequent, expression.alternate].flatMap((branch) =>
      unsafeComponentProps(branch, sanitizers, path, renderer)
    );
  }
  if (expression.type === "LogicalExpression") {
    return [expression.left, expression.right].flatMap((branch) =>
      unsafeComponentProps(branch, sanitizers, path, renderer)
    );
  }
  const mapped = inlineMapResults(expression);
  if (mapped !== undefined) {
    return mapped.length === 0
      ? [`${path === "" ? "" : `${path}.`}<opaque-map>`]
      : mapped.flatMap((result) =>
        unsafeComponentProps(result, sanitizers, path, renderer)
      );
  }
  if (expression.type === "ArrayExpression") {
    return expression.elements.flatMap((element) =>
      element === null
        ? []
        : element.type === "SpreadElement"
        ? unsafeComponentSpread(element.argument, sanitizers, path, renderer)
        : isSanitizedProductText(element, sanitizers)
        ? []
        : unsafeComponentContainer(element, sanitizers, path, renderer)
    );
  }
  if (expression.type !== "ObjectExpression") return [];
  const findings: string[] = [];
  for (const property of expression.properties) {
    if (property.type === "SpreadElement") {
      findings.push(
        ...unsafeComponentSpread(
          property.argument,
          sanitizers,
          path,
          renderer,
        ),
      );
      continue;
    }
    const key = propertyName(property.key);
    if (key === undefined) continue;
    const nextPath = path === "" ? key : `${path}.${key}`;
    const textProp = COMPONENT_TEXT_PROPS.has(key);
    const containerProp = COMPONENT_CONTAINER_PROPS.has(key);
    const containerShaped = containerProp &&
      staticallyContainerShaped(property.value);
    if (
      textProp && (!containerProp || !containerShaped) &&
      !(renderer === "renderStandardMeterCli" && nextPath === "value") &&
      staticallyUnsafeProductText(property.value, sanitizers)
    ) {
      findings.push(nextPath);
    }
    if (containerProp && (!textProp || containerShaped)) {
      findings.push(
        ...unsafeComponentContainer(
          property.value,
          sanitizers,
          nextPath,
          renderer,
        ),
      );
    } else {
      findings.push(
        ...unsafeComponentProps(property.value, sanitizers, nextPath, renderer),
      );
    }
  }
  return findings;
}

/** A renderer's top-level props must expose a statically inspectable shape. */
function inspectableComponentProps(node: Deno.lint.Node): boolean {
  const expression = unwrappedExpression(node);
  if (expression.type === "ObjectExpression") return true;
  if (expression.type === "ConditionalExpression") {
    return inspectableComponentProps(expression.consequent) &&
      inspectableComponentProps(expression.alternate);
  }
  if (expression.type === "LogicalExpression") {
    return inspectableComponentProps(expression.left) &&
      inspectableComponentProps(expression.right);
  }
  return false;
}

/**
 * Parse language-agnostic terminal boundaries through Deno's AST: package
 * prompt/painter ownership, process probes, local control literals, palette
 * shapes, and statically provable Component safe-text bypasses.
 */
function structuralTerminalFindings(rel: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const renderers = new Map<string, string>();
  const sanitizers = new Set<string>();
  const multilineSanitizers = new Set<string>();
  if (rel === "src/engine/gate/presentation.ts") {
    sanitizers.add("safeLine");
    sanitizers.add("safeMultiline");
  }
  const add = (rule: string, node: Deno.lint.Node): void => {
    findings.push({
      file: rel,
      rule,
      authority: enclosingFunctionFromNode(node),
    });
  };
  let activeContext: Deno.lint.RuleContext | undefined;
  const enclosingFunctionFromNode = (node: Deno.lint.Node): string => {
    if (activeContext === undefined) return "<module>";
    return enclosingFunction(activeContext, node) ?? "<module>";
  };
  const plugin = {
    name: "discern-terminal-outlaw",
    rules: {
      collect: {
        create(context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          activeContext = context;
          return {
            ImportDeclaration(node): void {
              const specifier = node.source.value;
              if (specifier === "discern-design-system/cli") {
                if (
                  node.specifiers.some((entry) =>
                    entry.type === "ImportNamespaceSpecifier"
                  )
                ) add("package-cli-namespace-import", node);
                for (const entry of node.specifiers) {
                  if (entry.type !== "ImportSpecifier") continue;
                  const imported = propertyName(entry.imported);
                  if (imported === undefined) continue;
                  if (/^render[A-Z].*Cli$/u.test(imported)) {
                    renderers.set(entry.local.name, imported);
                  }
                }
              }
              if (specifier === INTERACTIVE_MODULE) {
                if (
                  node.specifiers.some((entry) =>
                    entry.type === "ImportNamespaceSpecifier"
                  )
                ) add("package-interactive-namespace-import", node);
                for (const entry of node.specifiers) {
                  if (entry.type !== "ImportSpecifier") continue;
                  const imported = propertyName(entry.imported);
                  if (imported === undefined) continue;
                  if (
                    /^prompt[A-Z]/u.test(imported) && rel !== PROMPT_AUTHORITY
                  ) {
                    add(`package-prompt-import:${imported}`, node);
                  }
                  if (imported === "InlineFramePainter") {
                    add("package-inline-painter-import", node);
                  }
                  if (imported === "TerminalIO") {
                    add("package-terminal-io-import", node);
                  }
                }
              }
              if (
                /(?:^|\/)terminal\.ts$/u.test(specifier) ||
                specifier === "discern-design-system/cli"
              ) {
                for (const entry of node.specifiers) {
                  if (entry.type !== "ImportSpecifier") continue;
                  const imported = propertyName(entry.imported);
                  if (
                    imported === "terminalLine" ||
                    imported === "terminalMultiline"
                  ) sanitizers.add(entry.local.name);
                  if (imported === "terminalMultiline") {
                    multilineSanitizers.add(entry.local.name);
                  }
                }
              }
            },
            ImportExpression(node): void {
              if (
                node.source.type === "Literal" &&
                node.source.value === INTERACTIVE_MODULE
              ) add("dynamic-interactive-package-import", node);
            },
            VariableDeclarator(node): void {
              if (
                node.id.type === "Identifier" &&
                node.init?.type === "Identifier" &&
                renderers.has(node.init.name)
              ) {
                renderers.set(
                  node.id.name,
                  renderers.get(node.init.name) ?? node.init.name,
                );
              }
            },
            Literal(node): void {
              if (
                typeof node.value === "string" && node.value.includes("\x1b")
              ) {
                add("raw-terminal-control-literal", node);
              }
            },
            TemplateElement(node): void {
              if (
                node.cooked.includes("\x1b") || node.raw.includes("\x1b")
              ) {
                add("raw-terminal-control-literal", node);
              }
            },
            NewExpression(node): void {
              if (
                node.callee.type === "Identifier" &&
                node.callee.name === "InlineFramePainter"
              ) add("direct-inline-painter-construction", node);
            },
            CallExpression(node): void {
              const callee = context.sourceCode.getText(node.callee);
              if (
                node.callee.type === "MemberExpression" &&
                propertyName(node.callee.property) ===
                  "terminalSafeMultilineError"
              ) {
                const message = node.arguments[0];
                if (
                  message?.type !== "CallExpression" ||
                  message.callee.type !== "Identifier" ||
                  !multilineSanitizers.has(message.callee.name)
                ) add("unsafe-terminal-safe-multiline-error", node);
              }
              if (callee === "Deno.consoleSize") {
                add("process-console-size-probe", node);
              }
              if (/^Deno\.(?:stdin|stdout|stderr)\.isTerminal$/u.test(callee)) {
                add("process-stream-terminal-probe", node);
              }
              if (
                /(?:^|\.)env\.get$/u.test(callee) &&
                node.arguments.some((argument) =>
                  argument.type === "Literal" &&
                  typeof argument.value === "string" &&
                  /^(?:CI|TERM|COLORTERM|LC_ALL|LC_CTYPE|LANG|NO_COLOR|COLUMNS|LINES)$/u
                    .test(argument.value)
                )
              ) add("process-terminal-environment-probe", node);
              if (
                callee === "String.fromCharCode" &&
                node.arguments.some((argument) =>
                  argument.type === "Literal" && argument.value === 27
                )
              ) add("constructed-terminal-control", node);
              if (
                node.callee.type === "Identifier" &&
                renderers.has(node.callee.name)
              ) {
                const props = node.arguments[0];
                if (props?.type === "SpreadElement") {
                  add("unsafe-component-text:<props-spread>", node);
                } else if (
                  props !== undefined && !inspectableComponentProps(props)
                ) {
                  add("unsafe-component-text:<opaque-props>", node);
                } else if (props !== undefined) {
                  for (
                    const prop of unsafeComponentProps(
                      props,
                      sanitizers,
                      "",
                      renderers.get(node.callee.name) ?? node.callee.name,
                    )
                  ) {
                    add(`unsafe-component-text:${prop}`, node);
                  }
                }
              }
            },
            FunctionDeclaration(node): void {
              const text = context.sourceCode.getText(node);
              const styleKeys = new Set(
                [...text.matchAll(
                  /\b(reset|bold|dim|red|green|yellow|cyan)\s*(?=[:,=])/gu,
                )].flatMap((match) => match[1] ?? []),
              );
              if (styleKeys.has("reset") && styleKeys.size >= 3) {
                add("palette-prefix-factory", node);
              }
            },
          };
        },
      },
    },
  } satisfies Deno.lint.Plugin;
  Deno.lint.runPlugin(plugin, rel, source);
  return findings;
}

/** Find TypeScript-only declarations that restore a raw Out/Logger style API. */
function legacyTypeApiFindings(rel: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const plugin = {
    name: "discern-terminal-type-outlaw",
    rules: {
      collect: {
        create(_context: Deno.lint.RuleContext): Deno.lint.LintVisitor {
          return {
            TSInterfaceDeclaration(node): void {
              if (node.id.name !== "Out") return;
              for (const member of node.body.body) {
                if (
                  member.type === "TSPropertySignature" &&
                  propertyName(member.key) === "c"
                ) {
                  findings.push({ file: rel, rule: "out-palette-member" });
                }
              }
            },
            ClassDeclaration(node): void {
              if (node.id?.name !== "Logger") return;
              for (const member of node.body.body) {
                if (
                  member.type === "MethodDefinition" &&
                  /^(?:bold|dim|red|green|yellow|cyan)$/u.test(
                    propertyName(member.key) ?? "",
                  )
                ) {
                  findings.push({
                    file: rel,
                    rule: "logger-inline-style-member",
                  });
                }
              }
            },
          };
        },
      },
    },
  } satisfies Deno.lint.Plugin;
  Deno.lint.runPlugin(plugin, rel, source);
  return findings;
}

const TRIANGLE_CYCLE_GLYPHS = ["◢", "◣", "◤", "◥", "▴", "▸", "▾", "◂"];

/** Find a copied directional glyph cycle instead of the package registry. */
function copiedTriangleCycleFindings(rel: string, source: string): Finding[] {
  const code = codeOnly(source);
  const present = TRIANGLE_CYCLE_GLYPHS.filter((glyph) => code.includes(glyph));
  return present.length >= 4
    ? [{ file: rel, rule: "copied-triangle-glyph-cycle" }]
    : [];
}

interface DenoConfigShape {
  readonly imports?: Readonly<Record<string, string>>;
}

interface DenoLockModule {
  readonly dependencies?: readonly string[];
}

interface DenoLockShape {
  readonly specifiers?: Readonly<Record<string, string>>;
  readonly jsr?: Readonly<Record<string, DenoLockModule>>;
  readonly workspace?: { readonly dependencies?: readonly string[] };
}

/** Return the package name from one JSR specifier, without its version/export. */
function jsrPackageName(specifier: string): string | undefined {
  const match = /^jsr:(@[^/]+\/[^@/]+|[^@/]+)/u.exec(specifier);
  return match?.[1];
}

/** Return the package name from one resolved lock node. */
function lockPackageName(node: string): string {
  const match = /^(@[^/]+\/[^@/]+|[^@/]+)@/u.exec(node);
  return match?.[1] ?? node;
}

/** Resolve a dependency specifier to its unique lock node through specifiers. */
function dependencyNode(
  dependency: string,
  lock: DenoLockShape,
): string | undefined {
  const name = jsrPackageName(dependency);
  if (name === undefined) return undefined;
  const version = lock.specifiers?.[dependency];
  if (version !== undefined) return `${name}@${version}`;
  const candidates = Object.keys(lock.jsr ?? {}).filter((node) =>
    lockPackageName(node) === name
  );
  return candidates.length === 1 ? candidates[0] : undefined;
}

/**
 * Prove Cliffy has one authored dependency root and every retained Cliffy node
 * belongs to the transitive closure of that command parser root.
 */
function cliffyGraphFindings(
  config: DenoConfigShape,
  lock: DenoLockShape,
): Finding[] {
  const findings: Finding[] = [];
  const commandAlias = config.imports?.["@cliffy/command"];
  for (const [alias, target] of Object.entries(config.imports ?? {})) {
    const targetName = jsrPackageName(target);
    const aliasName = alias.startsWith("@cliffy/") ? alias : undefined;
    if (
      (targetName?.startsWith("@cliffy/") ?? false) ||
      (aliasName?.startsWith("@cliffy/") ?? false)
    ) {
      if (alias !== "@cliffy/command" || targetName !== "@cliffy/command") {
        findings.push({
          file: "deno.json",
          rule: `direct-cliffy-alias:${alias}->${targetName ?? target}`,
        });
      }
    }
  }
  if (jsrPackageName(commandAlias ?? "") !== "@cliffy/command") {
    findings.push({ file: "deno.json", rule: "missing-command-root" });
  }
  const roots = (lock.workspace?.dependencies ?? []).filter((dependency) =>
    jsrPackageName(dependency)?.startsWith("@cliffy/")
  );
  for (const root of roots) {
    const name = jsrPackageName(root);
    if (name !== "@cliffy/command") {
      findings.push({
        file: "deno.lock",
        rule: `direct-cliffy-workspace-root:${name ?? root}`,
      });
    }
  }
  if (
    roots.filter((root) => jsrPackageName(root) === "@cliffy/command")
      .length !== 1
  ) {
    findings.push({ file: "deno.lock", rule: "command-root-cardinality" });
  }

  const commandRoot = roots.find((root) =>
    jsrPackageName(root) === "@cliffy/command"
  );
  const initial = commandRoot === undefined
    ? undefined
    : dependencyNode(commandRoot, lock);
  const reachable = new Set<string>();
  const pending = initial === undefined ? [] : [initial];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined || reachable.has(node)) continue;
    reachable.add(node);
    for (const dependency of lock.jsr?.[node]?.dependencies ?? []) {
      const child = dependencyNode(dependency, lock);
      if (child !== undefined) pending.push(child);
    }
  }
  for (const node of Object.keys(lock.jsr ?? {})) {
    if (
      lockPackageName(node).startsWith("@cliffy/") && !reachable.has(node)
    ) {
      findings.push({
        file: "deno.lock",
        rule: `cliffy-node-outside-command-closure:${node}`,
      });
    }
  }
  for (const [specifier, version] of Object.entries(lock.specifiers ?? {})) {
    const name = jsrPackageName(specifier);
    if (name?.startsWith("@cliffy/") !== true) continue;
    const node = `${name}@${version}`;
    if (!reachable.has(node)) {
      findings.push({
        file: "deno.lock",
        rule: `cliffy-specifier-outside-command-closure:${specifier}->${node}`,
      });
    }
  }
  return findings;
}

interface ExactOutlawException {
  readonly file: string;
  readonly rule: string;
  readonly authority: string;
  readonly count: number;
  readonly reason: string;
}

const EXACT_OUTLAW_EXCEPTIONS: readonly ExactOutlawException[] = [
  {
    file: "src/lib/markdown.ts",
    rule: "raw-terminal-control-literal",
    authority: "osc8",
    count: 1,
    reason: "The central Markdown boundary owns the OSC-8 hyperlink protocol.",
  },
  {
    file: "src/engine/desk/desk.ts",
    rule: "raw-terminal-control-literal",
    authority: "clearBoard",
    count: 1,
    reason:
      "Desk owns one full-screen clear/home product effect on an admitted TTY.",
  },
  {
    file: "src/engine/mcp/version_check.ts",
    rule: "constructed-terminal-control",
    authority: "<module>",
    count: 1,
    reason:
      "Parses raw subprocess version output; it never emits the constructed SGR regex.",
  },
  {
    file: TERMINAL_AUTHORITY,
    rule: "process-stream-terminal-probe",
    authority: "productionTerminalContext",
    count: 1,
    reason: "The production terminal adapter snapshots stdout attachment once.",
  },
  {
    file: TERMINAL_AUTHORITY,
    rule: "process-console-size-probe",
    authority: "productionTerminalContext",
    count: 1,
    reason: "The production terminal adapter snapshots the viewport once.",
  },
  {
    file: TERMINAL_AUTHORITY,
    rule: "process-console-size-probe",
    authority: "terminalSize",
    count: 1,
    reason:
      "The retained dimension facade delegates its default observation here.",
  },
  {
    file: PROMPT_AUTHORITY,
    rule: "process-stream-terminal-probe",
    authority: "canPrompt",
    count: 2,
    reason:
      "The product prompt choke point alone admits interactive stdin/stdout.",
  },
  {
    file: PROMPT_AUTHORITY,
    rule: "process-terminal-environment-probe",
    authority: "interactionAllowed",
    count: 1,
    reason:
      "The product prompt choke point alone applies the CI interaction veto.",
  },
  {
    file: "src/engine/owned_child.ts",
    rule: "process-stream-terminal-probe",
    authority: "runOwnedChild",
    count: 1,
    reason: "Job control selects process-group ownership, not presentation.",
  },
  {
    file: "src/lib/worktree_hooks.ts",
    rule: "process-stream-terminal-probe",
    authority: "worktreeCreateHook",
    count: 1,
    reason: "The hook validates its stdin protocol before reading JSON.",
  },
  {
    file: "src/lib/worktree_hooks.ts",
    rule: "process-stream-terminal-probe",
    authority: "worktreeRemoveHook",
    count: 1,
    reason: "The hook validates its stdin protocol before reading JSON.",
  },
  {
    file: "src/engine/logbook/cli.ts",
    rule: "process-stream-terminal-probe",
    authority: "cliDriverFacts",
    count: 1,
    reason:
      "Logbook records raw driver evidence without deciding presentation.",
  },
  {
    file: "src/engine/logbook/cli.ts",
    rule: "process-terminal-environment-probe",
    authority: "cliDriverFacts",
    count: 1,
    reason:
      "Logbook records the raw CI driver fact without deciding presentation.",
  },
  {
    file: "src/engine/mcp/server.ts",
    rule: "process-terminal-environment-probe",
    authority: "mcpDriverFacts",
    count: 1,
    reason:
      "Logbook records the MCP driver's raw CI fact without terminal presentation.",
  },
  {
    file: PROMPT_AUTHORITY,
    rule: "package-terminal-io-import",
    authority: "<module>",
    count: 1,
    reason:
      "The product prompt choke point owns the package prompt IO lifecycle.",
  },
  {
    file: PAINTER_AUTHORITY,
    rule: "package-terminal-io-import",
    authority: "<module>",
    count: 1,
    reason:
      "The single painter adapter implements package IO for cursor effects.",
  },
  {
    file: PAINTER_AUTHORITY,
    rule: "package-inline-painter-import",
    authority: "<module>",
    count: 1,
    reason: "The single painter adapter constructs package inline frames.",
  },
  {
    file: PAINTER_AUTHORITY,
    rule: "direct-inline-painter-construction",
    authority: "createInlineFramePainter",
    count: 1,
    reason:
      "All Discern painters cross this one package construction boundary.",
  },
];

/** Apply exact, named exceptions; stale, moved, or increased populations fail. */
function unappliedOutlawFindings(findings: readonly Finding[]): Finding[] {
  return unappliedOutlawFindingsWithExceptions(
    findings,
    EXACT_OUTLAW_EXCEPTIONS,
  );
}

/** Apply a supplied exact exception set, used to discriminate its failure path. */
function unappliedOutlawFindingsWithExceptions(
  findings: readonly Finding[],
  exceptions: readonly ExactOutlawException[],
): Finding[] {
  const exempt = new Set<number>();
  for (const entry of exceptions) {
    assert(
      entry.reason.trim() !== "",
      `${entry.file}:${entry.rule} needs a reason`,
    );
    assert(Number.isSafeInteger(entry.count) && entry.count > 0);
    const matched = findings.flatMap((finding, index) =>
      finding.file === entry.file && finding.rule === entry.rule &&
        finding.authority === entry.authority
        ? [index]
        : []
    );
    assertEquals(
      matched.length,
      entry.count,
      `${entry.file}:${entry.authority} ${entry.rule} exception moved, became stale, or changed count`,
    );
    for (const index of matched) exempt.add(index);
  }
  return findings.filter((_finding, index) => !exempt.has(index));
}

const GENERIC_WIDTH_RULES = [
  { id: "Intl-Segmenter", pattern: /\bIntl\.Segmenter\b/u },
  { id: "extended-pictographic", pattern: /Extended_Pictographic/u },
  { id: "emoji-presentation", pattern: /Emoji_Presentation/u },
  {
    id: "wide-code-point-helper",
    pattern: /\b(?:isWideCodePoint|fullWidthCodePoint|wideCodePoint)\b/u,
  },
  { id: "local-grapheme-width", pattern: /\bfunction\s+graphemeWidth\s*\(/u },
  {
    id: "wide-code-point-table",
    pattern: /0x1100[\s\S]{0,400}0x115f/iu,
  },
] as const;

/** Find a second generic grapheme/display-width implementation. */
function genericWidthFindings(rel: string, source: string): Finding[] {
  const code = codeOnly(source);
  return GENERIC_WIDTH_RULES.filter((rule) => rule.pattern.test(code)).map(
    (rule) => ({ file: rel, rule: rule.id }),
  );
}

const PRESENTATION_OBSERVERS = new Set([
  "productionTerminalContext",
  "resolveTerminalContext",
  "terminalSize",
  "terminalWidth",
]);

/** Extract original named imports from one relative module, including aliases. */
function relativeNamedImports(source: string, module: RegExp): string[] {
  const imports: string[] = [];
  for (
    const match of source.matchAll(
      /import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/gu,
    )
  ) {
    if (!module.test(match[2] ?? "")) continue;
    for (const part of (match[1] ?? "").split(",")) {
      const imported = part.trim().replace(/^type\s+/u, "").split(
        /\s+as\s+/u,
      )[0]?.trim();
      if (imported !== undefined && imported !== "") imports.push(imported);
    }
  }
  return imports;
}

/** Find local observation of terminal presentation policy or dimensions. */
function presentationProbeFindings(
  rel: string,
  source: string,
): Finding[] {
  const findings: Finding[] = [];
  const code = codeOnly(source);
  if (/\bDeno\.(?:stdin|stdout|stderr)\.isTerminal\s*\(/u.test(code)) {
    findings.push({ file: rel, rule: "direct-stream-terminal-probe" });
  }
  if (/\bDeno\.consoleSize\s*\(/u.test(code)) {
    findings.push({ file: rel, rule: "direct-console-size-probe" });
  }
  for (const match of code.matchAll(/\bDeno\.env\.get\s*\(([^)]*)\)/gu)) {
    const argument = match[1] ?? "";
    if (
      /["'](?:CI|TERM|COLORTERM|LC_ALL|LC_CTYPE|LANG|NO_COLOR|COLUMNS|LINES)["']/u
        .test(argument) ||
      /\b(?:CI|TERM|COLORTERM|LC_ALL|LC_CTYPE|LANG|NO_COLOR|COLUMNS|LINES)\b/u
        .test(argument)
    ) {
      findings.push({ file: rel, rule: "direct-terminal-environment-probe" });
    }
  }
  const terminalImports = relativeNamedImports(
    code,
    /(?:^|\/)lib\/(?:terminal|text)\.ts$/u,
  );
  for (const imported of terminalImports) {
    if (PRESENTATION_OBSERVERS.has(imported)) {
      findings.push({
        file: rel,
        rule: `terminal-observer-import:${imported}`,
      });
    }
  }
  for (
    const match of code.matchAll(
      /\.\s*(productionTerminalContext|resolveTerminalContext|terminalSize|terminalWidth)\s*\(/gu,
    )
  ) {
    findings.push({
      file: rel,
      rule: `terminal-observer-access:${match[1] ?? "unknown"}`,
    });
  }
  return findings;
}

const LEGACY_PALETTE_PATTERN =
  /\b(?:out\.c|c)\.(?:reset|bold|dim|red|green|yellow|cyan)\b/gu;
Deno.test("terminal boundary detectors reject unrelated future source", () => {
  assertEquals(
    authorityFindings(
      "src/engine/orbit/view.ts",
      [
        'import { detectTerminalCapabilities, measureText } from "discern-design-system/cli";',
        'const term = Deno.env.get("TERM");',
        "const size = Deno.consoleSize();",
      ].join("\n"),
    ).map((finding) => finding.rule).toSorted(),
    [
      "Deno-console-size",
      "package-capability-detector",
      "terminal-environment-read",
      "terminal-import:detectTerminalCapabilities",
      "text-import:measureText",
    ],
  );
  assertEquals(
    packageSourceImportFindings(
      "src/engine/orbit/view.ts",
      'import { renderBadgeCli } from "../../../../discern-design-system/src/cli/mod.ts";',
    ).length,
    1,
  );
  assertEquals(
    cliffyPresentationFindings(
      "src/engine/orbit/view.ts",
      'import { colors } from "@cliffy/ansi/colors";\n' +
        'import { Table } from "@cliffy/table";',
    ).map((finding) => finding.rule),
    [
      "cliffy-presentation:@cliffy/ansi/colors",
      "cliffy-presentation:@cliffy/table",
    ],
  );
  assertEquals(
    genericWidthFindings(
      "src/engine/orbit/view.ts",
      "const segmenter = new Intl.Segmenter();\n" +
        "function graphemeWidth(value: string) { return value.length; }\n" +
        "const pictograph = /Extended_Pictographic/u;",
    ).map((finding) => finding.rule).toSorted(),
    ["Intl-Segmenter", "extended-pictographic", "local-grapheme-width"],
  );
});

Deno.test("explicit presentation-fact detector rejects an unrelated future view", () => {
  const future = new Map<string, string>([
    [
      "src/engine/forecast/view.ts",
      [
        'import { renderStatCli as drawMetric } from "discern-design-system/cli";',
        'import { colorEnabled as pickColour, makeOut as assemble } from "../output.ts";',
        'import { sampleEpoch as ageOf } from "./clock.ts";',
        "export const displayForecast = (",
        "  metric: { readonly value: string },",
        "): void => {",
        "  const out = assemble(pickColour());",
        "  out.raw(drawMetric({ label: String(ageOf()), value: metric.value }, {}));",
        "};",
        "export function planForecastArchive(): Date {",
        "  return new Date();",
        "}",
      ].join("\n"),
    ],
    [
      "src/engine/forecast/clock.ts",
      [
        "export const sampleEpoch = (): number => {",
        "  return Date.now();",
        "};",
      ].join("\n"),
    ],
  ]);
  const enrolled = explicitPresentationFactFiles(future);
  assertEquals([...enrolled.views], ["src/engine/forecast/view.ts"]);
  assertEquals([...enrolled.entrypoints], ["src/engine/forecast/view.ts"]);
  assertEquals(
    explicitPresentationFactFindings(future).map((finding) => finding.rule)
      .toSorted(),
    [
      "hidden-presentation-clock:sampleEpoch",
      "output-context-not-explicit",
    ],
  );
  assertEquals(
    explicitPresentationFactFindings(
      new Map([[
        "src/engine/forecast/view.ts",
        [
          'import { renderStatCli as drawMetric } from "discern-design-system/cli";',
          'import { makeOut as assemble } from "../output.ts";',
          "export const displayForecast = (terminal: TerminalContext): void => {",
          "  const out = assemble(",
          "    terminal.color,",
          "    {",
          "      terminal,",
          "      stdout: (text) => sink({ text, nested: [wrap(text, ')')] }),",
          "    },",
          "  );",
          "  out.raw(drawMetric({ label: 'Forecast', value: '1' }, {}));",
          "};",
        ].join("\n"),
      ]]),
    ),
    [],
  );
});

Deno.test("package-backed supervisory views receive explicit time and terminal facts", async () => {
  const sources = new Map<string, string>();
  for (const rel of RUNTIME_TS_FILES) {
    sources.set(rel, await Deno.readTextFile(join(REPO_ROOT, rel)));
  }
  const enrolled = explicitPresentationFactFiles(sources);
  for (
    const rel of [
      "src/engine/status/tty.ts",
      "src/engine/status/status.ts",
      "src/engine/improve/improve.ts",
      "src/engine/logbook/patterns.ts",
    ]
  ) {
    assert(enrolled.entrypoints.has(rel), `${rel} must auto-enrol`);
  }
  assertEquals(explicitPresentationFactFindings(sources), []);
});

Deno.test("authored runtime source cannot bypass terminal and text authorities", async () => {
  const findings: Finding[] = [];
  for (const rel of RUNTIME_TS_FILES) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    findings.push(
      ...authorityFindings(rel, source),
      ...packageSourceImportFindings(rel, source),
      ...cliffyPresentationFindings(rel, source),
      ...genericWidthFindings(rel, source),
    );
  }
  assertEquals(findings, []);
});

Deno.test("migrated supervisory source consumes terminal presentation facts without observing the process", async () => {
  for (
    const [futureSibling, source] of [
      ["src/engine/gate/orbit_view.ts", ""],
      ["src/engine/status/orbit_view.ts", ""],
      ["src/engine/improve/orbit_view.ts", ""],
      ["src/engine/logbook/patterns.ts", ""],
      [
        "src/engine/logbook/orbit_view.ts",
        'import { renderReceiptCli } from "discern-design-system/cli";',
      ],
    ] as const
  ) {
    assert(
      consumesExplicitPresentationFacts(futureSibling, source),
      futureSibling,
    );
  }
  assert(!consumesExplicitPresentationFacts("src/engine/orbit/view.ts"));

  const futureFindings = presentationProbeFindings(
    "src/engine/status/orbit_view.ts",
    [
      'import { terminalWidth as viewport } from "../../lib/terminal.ts";',
      'import * as display from "../../lib/text.ts";',
      'const automated = Deno.env.get("CI");',
      "const attached = Deno.stdout.isTerminal();",
      "const dimensions = Deno.consoleSize();",
      "const fallback = display.terminalSize();",
      "Deno.stdout.writeSync(new Uint8Array());",
      "const trunk = Deno.env.get(DISCERN_ENVIRONMENT_VARIABLES.trunk);",
    ].join("\n"),
  ).map((finding) => finding.rule).toSorted();
  assertEquals(futureFindings, [
    "direct-console-size-probe",
    "direct-stream-terminal-probe",
    "direct-terminal-environment-probe",
    "terminal-observer-access:terminalSize",
    "terminal-observer-import:terminalWidth",
  ]);

  const findings: Finding[] = [];
  for (const rel of RUNTIME_TS_FILES) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    if (!consumesExplicitPresentationFacts(rel, source)) continue;
    findings.push(
      ...presentationProbeFindings(
        rel,
        source,
      ),
    );
  }
  assertEquals(findings, []);
});

Deno.test("the 84-use legacy palette census reached permanent zero", async () => {
  const census: Record<string, number> = {};
  for (const rel of RUNTIME_TS_FILES) {
    const code = codeOnly(await Deno.readTextFile(join(REPO_ROOT, rel)));
    const count = [...code.matchAll(LEGACY_PALETTE_PATTERN)].length;
    if (count > 0) census[rel] = count;
  }
  assertEquals(census, {});
  assertEquals(
    [
      ...codeOnly("const c = out.c; c.red + c.reset").matchAll(
        LEGACY_PALETTE_PATTERN,
      ),
    ].length,
    2,
  );
});

Deno.test("terminal outlaw rejects future package, painter, palette, glyph, and safe-text bypasses", () => {
  const source = [
    'import { Table } from "@cliffy/table";',
    `import { InlineFramePainter, type TerminalIO, promptFuture as ask } from "${INTERACTIVE_MODULE}";`,
    'import { renderOrbitCli as future, renderResultSummaryCli as draw } from "discern-design-system/cli";',
    'import { terminalLine as safe } from "../../lib/terminal.ts";',
    'const dynamic = import("@cliffy/prompt");',
    `const interactive = await import("${INTERACTIVE_MODULE}"); interactive.promptFuture({});`,
    'const term = Deno.env.get("TERM");',
    'const noColor = Deno.env.get("NO_COLOR");',
    "const size = Deno.consoleSize();",
    "const tty = Deno.stdout.isTerminal();",
    'const sgr = "\\x1b[31m";',
    "const sgrTemplate = `\\x1b[32m`;",
    'const cycle = ["◢", "◣", "◤", "◥"];',
    'function orbitPalette() { return { reset: "", red: "", green: "", cyan: "" }; }',
    "new InlineFramePainter({} as TerminalIO);",
    'ask({ label: "Future" });',
    "draw({ fact: row.path, counts: [{ label: meta.name, value: `${meta.value}` }] }, {});",
    "const alias = draw;",
    "const fact = row.path;",
    "alias({ fact }, {});",
    "alias({ fact: String(row.path) }, {});",
    'alias({ fact: terminal.role(row.path, "muted") }, {});',
    "alias({ fact: helper(row.path) }, {});",
    "draw({ ...row }, {});",
    "draw({ counts: [{ ...row }] }, {});",
    "draw(row, {});",
    "draw(makeProps(row), {});",
    "log.terminalSafeMultilineError(row.message);",
    "class OrbitLog { errorMultiline(message) { return message; } }",
    "new OrbitLog().errorMultiline(row.message);",
    "future({ rows: records.map((record) => ({ label: record.name })) }, {});",
    "future({ rows }, {});",
    "future({ rows: model.rows }, {});",
    "future({ rows: condition ? rows : [] }, {});",
    "future({ rows: safe(model.rows) }, {});",
    "future({ body: row.body, explanation: row.explanation, checks: [{ stateLabel: row.stateLabel }], subtitle: row.subtitle, details: row.details }, {});",
    "draw({ fact: safe(row.path) }, {});",
  ].join("\n");
  const rules = [
    ...cliffyImportFindings("src/engine/orbit/view.ts", source),
    ...structuralTerminalFindings("src/engine/orbit/view.ts", source),
    ...copiedTriangleCycleFindings("src/engine/orbit/view.ts", source),
  ].map((finding) => finding.rule);
  for (
    const expected of [
      "retired-cliffy-import:@cliffy/table",
      "retired-cliffy-import:@cliffy/prompt",
      "package-inline-painter-import",
      "package-terminal-io-import",
      "package-prompt-import:promptFuture",
      "dynamic-interactive-package-import",
      "direct-inline-painter-construction",
      "process-terminal-environment-probe",
      "process-console-size-probe",
      "process-stream-terminal-probe",
      "raw-terminal-control-literal",
      "palette-prefix-factory",
      "copied-triangle-glyph-cycle",
      "unsafe-component-text:fact",
      "unsafe-component-text:counts.label",
      "unsafe-component-text:counts.value",
      "unsafe-component-text:<spread>",
      "unsafe-component-text:counts.<spread>",
      "unsafe-component-text:<opaque-props>",
      "unsafe-component-text:rows.label",
      "unsafe-component-text:rows.<opaque-container>",
      "unsafe-component-text:body",
      "unsafe-component-text:explanation",
      "unsafe-component-text:checks.stateLabel",
      "unsafe-component-text:subtitle",
      "unsafe-component-text:details",
      "unsafe-terminal-safe-multiline-error",
    ]
  ) assert(rules.includes(expected), `missing synthetic ${expected}`);
  assertEquals(
    rules.filter((rule) => rule === "unsafe-component-text:fact").length,
    5,
    "member, identifier, String(), terminal.role(), and helper() bypasses fail; safe() passes",
  );
  assertEquals(
    rules.filter((rule) =>
      rule === "unsafe-component-text:rows.<opaque-container>"
    ).length,
    4,
    "identifier, member, conditional identifier, and sanitizer-call containers fail closed",
  );
  assertEquals(
    rules.filter((rule) => rule === "unsafe-component-text:<opaque-props>")
      .length,
    2,
    "direct and helper-produced opaque top-level props both fail",
  );
  assertEquals(
    rules.filter((rule) => rule === "raw-terminal-control-literal").length,
    2,
    "ordinary string and template SGR literals both fail",
  );
  assertEquals(
    rules.filter((rule) => rule === "unsafe-terminal-safe-multiline-error")
      .length,
    1,
    "the Logger-specific unsafe call fails while an unrelated method does not",
  );

  assertEquals(
    structuralTerminalFindings(
      "src/engine/orbit/view.ts",
      [
        'import { renderDiagnosticCli as paint } from "discern-design-system/cli";',
        'import { terminalMultiline as safeMany } from "../../lib/terminal.ts";',
        'paint({ message: safeMany(row.message), context: "static" }, {});',
        "log.terminalSafeMultilineError(safeMany(row.message));",
        'paint({ ...{ body: safeMany(row.body) }, counts: [...[{ label: "Count", value: "1" }]] }, {});',
        'paint({ ...(condition ? {} : { nextAction: safeMany(row.nextAction) }), counts: [...(condition ? [] : [{ label: "Count", value: "1" }])] }, {});',
        "paint({ rows: records.map((record) => ({ label: safeMany(record.name) })) }, {});",
      ].join("\n"),
    ).filter((finding) => finding.rule.startsWith("unsafe-component-text:")),
    [],
  );
});

Deno.test("terminal outlaw TypeScript member detector is direct-member aware", () => {
  const source = [
    "interface Out { c: OrbitPalette; raw(value: string): void }",
    "class Logger { dim(value: string): string { return value; } }",
    "function later() { const c = 1; return { dim() {} }; }",
  ].join("\n");
  assertEquals(
    legacyTypeApiFindings("src/engine/orbit.ts", source).map((finding) =>
      finding.rule
    ),
    ["out-palette-member", "logger-inline-style-member"],
  );
  assertEquals(
    legacyTypeApiFindings(
      "src/engine/orbit.ts",
      "interface Out { raw(value: string): void }\n" +
        "class Logger { line(value: string): void {} }\n" +
        "function later() { const c = 1; return { dim() {} }; }",
    ),
    [],
  );
});

Deno.test("Cliffy lock law retains only the command-owned transitive closure", () => {
  const config: DenoConfigShape = {
    imports: { "@cliffy/command": "jsr:@cliffy/command@^1" },
  };
  const lock: DenoLockShape = {
    specifiers: {
      "jsr:@cliffy/command@^1": "1.2.1",
      "jsr:@cliffy/table": "1.2.1",
    },
    jsr: {
      "@cliffy/command@1.2.1": {
        dependencies: ["jsr:@cliffy/table"],
      },
      "@cliffy/table@1.2.1": {},
    },
    workspace: { dependencies: ["jsr:@cliffy/command@^1"] },
  };
  assertEquals(cliffyGraphFindings(config, lock), []);
  const rootedTable: DenoLockShape = {
    ...lock,
    workspace: {
      dependencies: ["jsr:@cliffy/command@^1", "jsr:@cliffy/table"],
    },
  };
  assert(
    cliffyGraphFindings(config, rootedTable).some((finding) =>
      finding.rule === "direct-cliffy-workspace-root:@cliffy/table"
    ),
  );
  const orphanPrompt: DenoLockShape = {
    ...lock,
    jsr: { ...lock.jsr, "@cliffy/prompt@1.2.1": {} },
  };
  assert(
    cliffyGraphFindings(config, orphanPrompt).some((finding) =>
      finding.rule ===
        "cliffy-node-outside-command-closure:@cliffy/prompt@1.2.1"
    ),
  );
  const specifierOnlyPrompt: DenoLockShape = {
    ...lock,
    specifiers: {
      ...lock.specifiers,
      "jsr:@cliffy/prompt@^1": "1.2.1",
    },
  };
  assert(
    cliffyGraphFindings(config, specifierOnlyPrompt).some((finding) =>
      finding.rule ===
        "cliffy-specifier-outside-command-closure:jsr:@cliffy/prompt@^1->@cliffy/prompt@1.2.1"
    ),
  );
  assert(
    cliffyGraphFindings(
      {
        imports: {
          ...config.imports,
          "@cliffy/table": "jsr:@cliffy/table@^1",
        },
      },
      lock,
    ).some((finding) =>
      finding.rule ===
        "direct-cliffy-alias:@cliffy/table->@cliffy/table"
    ),
  );
  assert(
    cliffyGraphFindings(
      {
        imports: {
          ...config.imports,
          "legacy-parser": "jsr:@cliffy/command@^1",
        },
      },
      lock,
    ).some((finding) =>
      finding.rule ===
        "direct-cliffy-alias:legacy-parser->@cliffy/command"
    ),
  );
});

Deno.test("exact terminal exceptions reject a second violation in an exempt authority", () => {
  const markdownException = EXACT_OUTLAW_EXCEPTIONS.filter((entry) =>
    entry.file === "src/lib/markdown.ts"
  );
  assertEquals(markdownException.length, 1);
  const baseline = [{
    file: "src/lib/markdown.ts",
    rule: "raw-terminal-control-literal",
    authority: "osc8",
  }];
  assertEquals(
    unappliedOutlawFindingsWithExceptions(baseline, markdownException),
    [],
  );
  assertThrows(
    () =>
      unappliedOutlawFindingsWithExceptions(
        [...baseline, ...baseline],
        markdownException,
      ),
    Error,
    "src/lib/markdown.ts:osc8 raw-terminal-control-literal exception moved, became stale, or changed count",
  );
});

Deno.test("authored terminal outlaw is zero and exceptions remain exact", async () => {
  const findings: Finding[] = [];
  for (const rel of RUNTIME_DENO_FILES) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    findings.push(
      ...cliffyImportFindings(rel, source),
      ...authorityFindings(rel, source),
      ...packageSourceImportFindings(rel, source),
      ...genericWidthFindings(rel, source),
      ...structuralTerminalFindings(rel, source),
      ...copiedTriangleCycleFindings(rel, source),
    );
  }
  for (const rel of RUNTIME_TS_FILES) {
    findings.push(...legacyTypeApiFindings(
      rel,
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    ));
  }
  assertEquals(unappliedOutlawFindings(findings), []);

  const config = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "deno.json")),
  ) as DenoConfigShape;
  const lock = JSON.parse(
    await Deno.readTextFile(join(REPO_ROOT, "deno.lock")),
  ) as DenoLockShape;
  assertEquals(cliffyGraphFindings(config, lock), []);

  const compiledHelper = await Deno.readTextFile(
    join(REPO_ROOT, "scripts/use_compiled_build.ts"),
  );
  assertEquals(
    structuralTerminalFindings(
      "scripts/use_compiled_build.ts",
      compiledHelper,
    ).filter((finding) =>
      finding.rule.includes("terminal-control") ||
      finding.rule.includes("process-") ||
      finding.rule.includes("painter")
    ),
    [],
    "the maintainer-only compiled-build warning remains deliberately plain",
  );
});
