/** Structural forcing functions for Discern's external terminal boundary. */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { AUTHORED_TS_FILES, REPO_ROOT } from "./repo_authored_paths.ts";

const TERMINAL_AUTHORITY = "src/lib/terminal.ts";
const TEXT_AUTHORITY = "src/lib/text.ts";
const RUNTIME_TS_FILES = AUTHORED_TS_FILES.filter((rel) =>
  !rel.startsWith("tests/")
);
const GATE_RUNTIME_TS_FILES = RUNTIME_TS_FILES.filter((rel) =>
  rel.startsWith("src/engine/gate/")
);

interface Finding {
  readonly file: string;
  readonly rule: string;
}

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

const GATE_PRESENTATION_OBSERVERS = new Set([
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

/** Find Gate-local observation of terminal presentation policy or dimensions. */
function gatePresentationProbeFindings(
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
    if (GATE_PRESENTATION_OBSERVERS.has(imported)) {
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
  "src/engine/improve/improve.ts": 48,
  "src/engine/jobs/runner.ts": 8,
  "src/engine/logbook/patterns.ts": 96,
  "src/engine/status/tty.ts": 45,
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

Deno.test("Gate source consumes terminal presentation facts without observing the process", async () => {
  const futureSibling = gatePresentationProbeFindings(
    "src/engine/gate/orbit_view.ts",
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
  assertEquals(futureSibling, [
    "direct-console-size-probe",
    "direct-stream-terminal-probe",
    "direct-terminal-environment-probe",
    "terminal-observer-access:terminalSize",
    "terminal-observer-import:terminalWidth",
  ]);

  const findings: Finding[] = [];
  for (const rel of GATE_RUNTIME_TS_FILES) {
    findings.push(
      ...gatePresentationProbeFindings(
        rel,
        await Deno.readTextFile(join(REPO_ROOT, rel)),
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
