/// <reference lib="deno.unstable" />

/** Structural forcing functions for Discern's external terminal boundary. */

import { assert, assertEquals } from "@std/assert";
import { dirname, join, normalize } from "@std/path";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

const TERMINAL_AUTHORITY = "src/lib/terminal.ts";
const TEXT_AUTHORITY = "src/lib/text.ts";
const RUNTIME_TS_FILES = AUTHORED_TS_FILES.filter((rel) =>
  !rel.startsWith("tests/")
);

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
const LEGACY_PALETTE_CENSUS: Readonly<Record<string, number>> = {
  "src/engine/coupling/coupling.ts": 31,
  "src/engine/desk/desk.ts": 54,
  "src/engine/gate/finish.ts": 2,
  "src/engine/gate/gotchas.ts": 6,
  "src/engine/jobs/runner.ts": 8,
};

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

Deno.test("the generated 3A palette compatibility facade has an exact census", async () => {
  const census: Record<string, number> = {};
  for (const rel of RUNTIME_TS_FILES) {
    if (rel === "src/engine/output.ts") continue;
    const code = codeOnly(await Deno.readTextFile(join(REPO_ROOT, rel)));
    const count = [...code.matchAll(LEGACY_PALETTE_PATTERN)].length;
    if (count > 0) census[rel] = count;
  }
  assertEquals(census, LEGACY_PALETTE_CENSUS);
  assert(Object.values(census).reduce((sum, count) => sum + count, 0) > 0);
});
