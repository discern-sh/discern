/**
 * Structural guard for discern-managed human output groups.
 *
 * A semantic boundary must be expressed through the shared grouping renderer or
 * grouped-prompt helper. Hand-emitting an empty line, importing a package prompt
 * outside the product adapter, or inventing a heading entry recreates the
 * permissive boundary that let composed views collapse into flat lists.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { TerminalIO } from "discern-design-system/cli/interactive";
import {
  populatedHumanOutputGroups,
  renderHumanOutputGroups,
} from "../src/shared/result.ts";
import { AUTHORED_DENO_FILES, REPO_ROOT } from "./repo_authored_paths.ts";
import { makeOut } from "../src/engine/output.ts";
import {
  groupedSelectOptions,
  withPromptBoundary,
} from "../src/lib/prompts.ts";

interface BoundaryFinding {
  readonly rule: string;
  readonly offset: number;
}

const INTERACTIVE_MODULE = "discern-design-system/cli/interactive";
const STATIC_CLI_MODULE = "discern-design-system/cli";

/** Find imports that can call a package prompt outside the product adapter.
 * The public `prompt*` naming convention defines the enrollment set, including
 * future package entry points and aliases this test has never seen. */
function directPromptFindings(source: string): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];
  for (const match of source.matchAll(/(["'])@cliffy\/prompt\1/g)) {
    findings.push({
      rule: "legacy-cliffy-prompt-import",
      offset: match.index ?? 0,
    });
  }

  const escapedModule = INTERACTIVE_MODULE.replaceAll("/", "\\/");
  const named = new RegExp(
    `(?:import|export)\\s*{([^}]*)}\\s*from\\s*(["'])${escapedModule}\\2`,
    "g",
  );
  for (const imported of source.matchAll(named)) {
    for (const part of imported[1]?.split(",") ?? []) {
      const names = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/);
      const importedName = names[0]?.trim() ?? "";
      if (/^prompt[A-Z]/.test(importedName)) {
        findings.push({
          rule: "direct-package-prompt-import",
          offset: imported.index ?? 0,
        });
        const localName = names.at(-1)?.trim() ?? importedName;
        const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const directCall = new RegExp(
          `\\b${escaped}(?:<[^>]+>)?\\s*\\(`,
          "g",
        );
        for (const call of source.matchAll(directCall)) {
          findings.push({
            rule: "direct-package-prompt-call",
            offset: call.index ?? 0,
          });
        }
        const identifier = new RegExp(`\\b${escaped}\\b`, "g");
        const importStart = imported.index ?? 0;
        const importEnd = importStart + imported[0].length;
        for (const use of source.matchAll(identifier)) {
          const offset = use.index ?? 0;
          if (offset >= importStart && offset < importEnd) continue;
          const prefix = source.slice(0, offset);
          if (!/(?:^|[^\w$.])productPrompt\s*\(\s*$/u.test(prefix)) {
            findings.push({
              rule: "unmediated-package-prompt-use",
              offset,
            });
          }
        }
      }
    }
  }

  const namespace = new RegExp(
    `import\\s*\\*\\s*as\\s*([A-Za-z_$][\\w$]*)\\s*from\\s*(["'])${escapedModule}\\2`,
    "g",
  );
  for (const imported of source.matchAll(namespace)) {
    const local = imported[1];
    if (local === undefined) continue;
    const call = new RegExp(`\\b${local}\\.prompt[A-Z][\\w$]*\\s*\\(`, "g");
    for (const match of source.matchAll(call)) {
      findings.push({
        rule: "direct-package-namespace-prompt",
        offset: match.index ?? 0,
      });
    }
  }

  const dynamicImport = new RegExp(
    `import\\(\\s*(["'])${escapedModule}\\1\\s*\\)`,
    "g",
  );
  for (const match of source.matchAll(dynamicImport)) {
    findings.push({
      rule: "dynamic-interactive-package-import",
      offset: match.index ?? 0,
    });
  }
  return findings;
}

/** Find a package-shaped heading assembled anywhere but the one adapter. */
function adHocHeadingFindings(source: string): BoundaryFinding[] {
  return [...source.matchAll(/(["'])group-heading\1/g)].map((match) => ({
    rule: "ad-hoc-prompt-heading",
    offset: match.index ?? 0,
  }));
}

/** Return one complete call expression, ignoring delimiters inside literals and
 * comments. The detector needs only the call's options, not a TypeScript AST. */
function callExpressionAt(
  source: string,
  callOffset: number,
  openOffset: number,
): string {
  let depth = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openOffset; index < source.length; index++) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth++;
    if (character !== ")") continue;
    depth--;
    if (depth === 0) return source.slice(callOffset, index + 1);
  }
  return source.slice(callOffset);
}

/** Package Heading calls nested in an existing composer must opt out of the
 * default leading line. Direct calls retain the package's top-level default. */
function packageHeadingBoundaryFindings(source: string): BoundaryFinding[] {
  const findings: BoundaryFinding[] = [];
  const escapedModule = STATIC_CLI_MODULE.replaceAll("/", "\\/");
  const named = new RegExp(
    `import\\s*{([^}]*)}\\s*from\\s*(["'])${escapedModule}\\2`,
    "g",
  );
  const localNames: string[] = [];
  for (const imported of source.matchAll(named)) {
    for (const part of imported[1]?.split(",") ?? []) {
      const names = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/u);
      const importedName = names[0]?.trim() ?? "";
      if (!/^render(?:[A-Z][\w$]*)?HeadingCli$/u.test(importedName)) continue;
      localNames.push(names.at(-1)?.trim() ?? importedName);
    }
  }

  for (const localName of localNames) {
    const escaped = localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const calls = new RegExp(`\\b${escaped}\\s*\\(`, "g");
    for (const match of source.matchAll(calls)) {
      const offset = match.index ?? 0;
      const openOffset = offset + match[0].lastIndexOf("(");
      const call = callExpressionAt(source, offset, openOffset);
      const leading = /\bleadingBlankLines\s*:\s*([^,}\n]+)/u.exec(call);
      if (leading !== null) {
        if (leading[1]?.trim() !== "0") {
          findings.push({
            rule: "package-heading-nonembedded-override",
            offset,
          });
        }
        continue;
      }
      const prefix = source.slice(Math.max(0, offset - 600), offset);
      const nested =
        /(?:\.(?:raw|line)\(\s*|\breturn\s*\[[^\]]*|\bitems\s*:\s*\[[^\]]*|renderHumanOutputGroups\([^)]*|\.group\([^;]*\);\s*\w+\.(?:raw|line)\(\s*)$/su
          .test(prefix);
      if (nested) {
        findings.push({
          rule: "package-heading-default-inside-owned-boundary",
          offset,
        });
      }
    }
  }
  return findings;
}

const MANUAL_BOUNDARY_RULES: readonly {
  readonly id: string;
  readonly pattern: RegExp;
}[] = [
  {
    id: "empty-console-line",
    pattern: /console\.(?:log|error|warn)\(\s*([\"'`])\1\s*\)/g,
  },
  {
    id: "escaped-newline-console-call",
    pattern: /console\.(?:log|error|warn)\(\s*(?:[\"']\\n|`\\n)/g,
  },
  {
    id: "double-newline-console-call",
    pattern: /console\.(?:log|error|warn)\([^;]*?\\n\\n[^;]*?\)/gs,
  },
  {
    id: "empty-output-call",
    pattern: /\.(?:line|humanLine)\(\s*\)/g,
  },
  {
    id: "empty-output-string",
    pattern: /\.(?:line|humanLine)\(\s*([\"'`])\1\s*\)/g,
  },
  {
    id: "escaped-newline-output-call",
    pattern: /\.(?:line|humanLine|raw)\(\s*(?:[\"']\\n|`\\n)/g,
  },
  {
    id: "double-newline-output-call",
    pattern: /\.(?:line|humanLine|raw)\([^;]*?\\n\\n[^;]*?\)/gs,
  },
  {
    id: "joined-line-output-call",
    pattern:
      /console\.(?:log|error|warn)\(\s*[^;]*?\.join\(\s*[\"']\\n[\"']\s*\)\s*\)/gs,
  },
];

/** Locate every manual output-boundary pattern with its rule and source offset. */
function manualBoundaryFindings(source: string): BoundaryFinding[] {
  return MANUAL_BOUNDARY_RULES.flatMap(({ id, pattern }) => {
    pattern.lastIndex = 0;
    return [...source.matchAll(pattern)].map((match) => ({
      rule: id,
      offset: match.index ?? 0,
    }));
  });
}

/** Convert a source offset to the one-based line number used in diagnostics. */
function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

Deno.test("human-output boundary detector rejects unrelated future siblings", () => {
  const synthetic = [
    'function orbit(writer: { raw(s: string): void }) { writer.raw("\\n"); }',
    'function canopy() { console.log(""); }',
    "function harbor(log: { line(): void }) { log.line(); }",
    'function estuary(lines: string[]) { console.log(lines.join("\\n")); }',
    'function inlet(log: { line(s: string): void }) { log.line(""); }',
    'function delta(writer: { raw(s: string): void }) { writer.raw("one\\n\\ntwo"); }',
    'function shoal() { console.error("\\n"); }',
    'function channel() { console.warn("one\\n\\ntwo"); }',
  ].join("\n");

  assertEquals(
    manualBoundaryFindings(synthetic).map((finding) => finding.rule).sort(),
    [
      "double-newline-console-call",
      "double-newline-output-call",
      "empty-console-line",
      "empty-output-call",
      "empty-output-string",
      "escaped-newline-console-call",
      "escaped-newline-output-call",
      "joined-line-output-call",
    ],
  );

  const promptSynthetic = [
    'import { Select } from "@cliffy/prompt";',
    `import { promptSelect as orbit, DenoTerminalIO } from "${INTERACTIVE_MODULE}";`,
    `import * as interactive from "${INTERACTIVE_MODULE}";`,
    'orbit({ label: "Fresh sibling", choices: [] });',
    'relay(orbit, { label: "Helper bypass", choices: [] });',
    'notproductPrompt(orbit, { label: "Near miss", choices: [] });',
    'adapter.productPrompt(orbit, { label: "Qualified near miss", choices: [] });',
    'interactive.promptFuture({ label: "Future sibling" });',
    `const future = await import("${INTERACTIVE_MODULE}"); future.promptFuture({});`,
  ].join("\n");
  assertEquals(
    directPromptFindings(promptSynthetic).map((finding) => finding.rule),
    [
      "legacy-cliffy-prompt-import",
      "direct-package-prompt-import",
      "direct-package-prompt-call",
      "unmediated-package-prompt-use",
      "unmediated-package-prompt-use",
      "unmediated-package-prompt-use",
      "unmediated-package-prompt-use",
      "direct-package-namespace-prompt",
      "dynamic-interactive-package-import",
    ],
  );
  assertEquals(
    directPromptFindings(
      `import { promptSelect as orbit } from "${INTERACTIVE_MODULE}";\n` +
        "productPrompt(orbit, options, runtime);",
    ).map((finding) => finding.rule),
    ["direct-package-prompt-import"],
  );
  assertEquals(
    directPromptFindings(
      `import { InlineFramePainter } from "${INTERACTIVE_MODULE}";\n` +
        "new InlineFramePainter({});",
    ),
    [],
  );
  assertEquals(
    adHocHeadingFindings(
      'const fake = { kind: "group-heading", id: "fake", value: "fake" };',
    ).map((finding) => finding.rule),
    ["ad-hoc-prompt-heading"],
  );

  const headingImport =
    `import { renderOrbitHeadingCli as future } from "${STATIC_CLI_MODULE}";\n`;
  assertEquals(
    packageHeadingBoundaryFindings(
      headingImport +
        'function grouped(out: Out, caps: Caps) { out.group("next"); out.raw(future({ text: "Next" }, caps)); }\n' +
        'function composed(caps: Caps) { return [future({ text: "Inside" }, caps)]; }\n' +
        'function top(caps: Caps) { return future({ text: "Top" }, caps); }\n' +
        'function embedded(caps: Caps) { return [future({ text: "Inside", leadingBlankLines: 0 }, caps)]; }\n' +
        'function custom(caps: Caps) { return future({ text: "Custom", leadingBlankLines: 2 }, caps); }',
    ).map((finding) => finding.rule),
    [
      "package-heading-default-inside-owned-boundary",
      "package-heading-default-inside-owned-boundary",
      "package-heading-nonembedded-override",
    ],
  );
});

Deno.test("the text grouping surface owns populated boundaries and identities", () => {
  const rendered = renderHumanOutputGroups([
    { id: "orbit", items: ["first\n", "second"] },
    { id: "canopy", label: "Canopy", items: [] },
    { id: "harbor", label: "Harbor", items: ["third"] },
  ], {
    leadingBoundary: true,
    renderLabel: (group) => group.label,
  });

  assertEquals(rendered, "\nfirst\nsecond\n\nHarbor\nthird");
  assertThrows(
    () => populatedHumanOutputGroups([{ id: " ", items: ["one"] }]),
    Error,
    "must not be blank",
  );
  assertThrows(
    () =>
      populatedHumanOutputGroups([
        { id: "orbit", items: ["one"] },
        { id: "orbit", items: ["two"] },
      ]),
    Error,
    "duplicate human output group id",
  );
  assertThrows(
    () =>
      populatedHumanOutputGroups([{
        id: "orbit",
        label: " ",
        items: ["one"],
      }]),
    Error,
    "label must not be blank",
  );
});

Deno.test("the live output grouping surface writes exactly one complete boundary", () => {
  const chunks: string[] = [];
  const errors: string[] = [];
  const out = makeOut(false, {
    stdout: (text) => chunks.push(text),
    stderr: (text) => errors.push(text),
  });

  out.group("leading");
  out.raw("first");
  out.group("second");
  out.group("same-boundary");
  out.raw("second\n");
  out.group("third");
  out.info("third");
  out.group("fourth", "Fourth");
  out.raw("fourth\n");
  assertThrows(
    () => out.group("invalid-label", " "),
    Error,
    "label must not be blank",
  );

  assertEquals(
    chunks.join(""),
    "first\n\nsecond\n\n→ third\n\n  ── Fourth\nfourth\n",
  );

  out.error("failure");
  out.group("failure-recovery", "Recovery");
  out.warn("fix it");
  assertEquals(
    errors.join(""),
    "✗ failure\n\n  ── Recovery\n! fix it\n",
  );
});

Deno.test("the live narration surface makes hostile caller facts inert but keeps raw bytes", () => {
  const chunks: string[] = [];
  const errors: string[] = [];
  const out = makeOut(false, {
    stdout: (text) => chunks.push(text),
    stderr: (text) => errors.push(text),
  });
  const hostile = "repo\x1b[31m\nbranch\x00\u0085\u202E";
  const safe = "repo␛[31m␊branch␀<U+0085><U+202E>";
  const hostileLabel = "repo\x1b[31m\x00\u0085\u202E";
  const safeLabel = "repo␛[31m␀<U+0085><U+202E>";

  out.info(hostile);
  out.ok(hostile);
  out.warn(hostile);
  out.error(hostile);
  out.heading(hostile);
  out.group("hostile-label", hostileLabel);

  assertEquals(
    chunks.join(""),
    `→ ${safe}\n✓ ${safe}\n\n${safe}\n\n  ── ${safeLabel}\n`,
  );
  assertEquals(errors.join(""), `! ${safe}\n✗ ${safe}\n`);

  out.raw(hostile);
  assertEquals(chunks.at(-1), hostile);
});

Deno.test("the prompt grouping surface gives every populated group a heading", () => {
  const options = groupedSelectOptions<string>([
    {
      id: "orbit",
      label: "Orbit",
      items: [{ name: "First", value: "first" }],
    },
    { id: "canopy", label: "Canopy", items: [] },
    {
      id: "harbor",
      label: "Harbor",
      items: [{ name: "Second", value: "second" }],
    },
  ]);

  assertEquals(
    JSON.stringify(options),
    JSON.stringify([
      { kind: "group-heading", id: "orbit", name: "Orbit" },
      { name: "First", value: "first" },
      { kind: "group-heading", id: "harbor", name: "Harbor" },
      { name: "Second", value: "second" },
    ]),
  );
});

Deno.test("the prompt grouping surface writes one leading boundary", () => {
  const writes: string[] = [];
  const rawTransitions: boolean[] = [];
  const target: TerminalIO = {
    isInteractive: () => true,
    capabilities: () => ({
      colorDepth: "none",
      columns: 60,
      unicode: true,
    }),
    size: () => ({ columns: 60, rows: 24 }),
    read: () => Promise.resolve(null),
    setRawMode: (enabled) => rawTransitions.push(enabled),
    write: (value) => writes.push(value),
  };
  const terminal = withPromptBoundary(target);

  terminal.setRawMode(true);
  terminal.write("? Fresh sibling");
  terminal.write("\n  First option");
  terminal.setRawMode(false);

  assertEquals(writes, ["\n", "? Fresh sibling", "\n  First option"]);
  assertEquals(rawTransitions, [true, false]);
  assertEquals(terminal.isInteractive(), true);
  assertEquals(terminal.capabilities(), target.capabilities());
  assertEquals(terminal.size(), target.size());
});

Deno.test("discern-managed human boundaries use the semantic grouping surface", async () => {
  const offenders: string[] = [];
  for (
    const rel of AUTHORED_DENO_FILES.filter((path) => path.startsWith("src/"))
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const finding of manualBoundaryFindings(source)) {
      offenders.push(
        `${rel}:${lineAt(source, finding.offset)} (${finding.rule})`,
      );
    }
    const promptFindings = directPromptFindings(source).filter((finding) =>
      !(rel === "src/lib/prompts.ts" &&
        finding.rule === "direct-package-prompt-import")
    );
    for (const finding of promptFindings) {
      offenders.push(
        `${rel}:${lineAt(source, finding.offset)} (${finding.rule})`,
      );
    }
    if (rel !== "src/lib/prompts.ts") {
      for (const finding of adHocHeadingFindings(source)) {
        offenders.push(
          `${rel}:${lineAt(source, finding.offset)} (${finding.rule})`,
        );
      }
    }
    for (const finding of packageHeadingBoundaryFindings(source)) {
      offenders.push(
        `${rel}:${lineAt(source, finding.offset)} (${finding.rule})`,
      );
    }
  }

  assert(
    offenders.length === 0,
    "Human output groups must go through the shared text/prompt grouping surfaces; " +
      `found:\n${offenders.join("\n")}`,
  );
});
