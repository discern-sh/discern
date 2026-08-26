/**
 * Structural guard for discern-managed human output groups.
 *
 * A semantic boundary must be expressed through the shared grouping renderer or
 * grouped-selection helper. Hand-emitting an empty line, importing a package request
 * outside the product adapter, or inventing a heading entry recreates the
 * permissive boundary that let composed views collapse into flat lists.
 *
 * The consolidated-output outlaw extends the same claim to the residue idioms:
 * `padEnd` alignment, narration glyphs outside the authority, direct console
 * presentation, and hand-emitted boundary newlines are illegal in shipped
 * `src/**` human surfaces, with exact named exceptions for protocol surfaces.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { TerminalIO } from "discern-design-system/cli/interactive";
import {
  populatedHumanOutputGroups,
  renderHumanOutputGroups,
} from "../src/shared/result.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import { makeOut } from "../src/engine/output.ts";
import {
  groupedSelectionEntries,
  withInteractionBoundary,
} from "../src/lib/terminal_interaction.ts";

interface BoundaryFinding {
  readonly rule: string;
  readonly offset: number;
}

const INTERACTIVE_MODULE = "discern-design-system/cli/interactive";
const STATIC_CLI_MODULE = "discern-design-system/cli";

/** Find imports that can call a package request outside the product adapter.
 * The public `request*` naming convention defines the enrollment set, including
 * future package entry points and aliases this test has never seen. */
function directRequestFindings(source: string): BoundaryFinding[] {
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
      if (/^request[A-Z]/.test(importedName)) {
        findings.push({
          rule: "direct-package-request-import",
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
            rule: "direct-package-request-call",
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
          if (!/(?:^|[^\w$.])runInteractionRequest\s*\(\s*$/u.test(prefix)) {
            findings.push({
              rule: "unmediated-package-request-use",
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
    const call = new RegExp(`\\b${local}\\.request[A-Z][\\w$]*\\s*\\(`, "g");
    for (const match of source.matchAll(call)) {
      findings.push({
        rule: "direct-package-namespace-request",
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
    rule: "ad-hoc-selection-heading",
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

// ── consolidated-output outlaw (ADR 0250, sink-ownership amendment) ──────────
// The narration authority (`src/lib/narration.ts`) and the aligned-listing
// policy (`renderAlignedRows`) are the only legal spellings for their jobs;
// these rules reject the residue idioms, with exact named exceptions for the
// protocol surfaces that legitimately stay bare.

/** Blank comments in place (offsets preserved) so prose cannot self-match. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, (match) => match.replace(/[^\n]/gu, " "))
    .replace(/\/\/[^\n]*/gu, (match) => " ".repeat(match.length));
}

const OUTPUT_IDIOM_RULES: readonly {
  readonly id: string;
  readonly pattern: RegExp;
}[] = [
  // Alignment belongs to renderAlignedRows (display-width aware); padding by
  // code units drifts on styled or wide text.
  { id: "padEnd-alignment", pattern: /\.padEnd\(/g },
  // The narration authority owns both retired and current line-prefix glyphs.
  {
    id: "narration-glyph-literal",
    pattern: /(["'`])(?:→|◮|✓|✗|✕) /g,
  },
  // Human presentation writes through the authority; console is protocol-only.
  {
    id: "direct-console-presentation",
    pattern: /console\.(?:log|error|warn)\(/g,
  },
  // The sink owns every boundary newline.
  { id: "boundary-newline-repeat", pattern: /(["'`])\\n\1\.repeat\(/g },
  {
    id: "writer-leading-newline",
    pattern: /\b(?:writeStdout|writeStderr)\(\s*(?:["']\\n|`\\n)/g,
  },
];

interface OutputIdiomException {
  readonly file: string;
  readonly rule: string;
  readonly count: number;
  readonly reason: string;
}

/** Protocol and document surfaces that legitimately bypass the authority.
 * Exact counts: a stale, moved, or grown population fails. */
const OUTPUT_IDIOM_EXCEPTIONS: readonly OutputIdiomException[] = [
  {
    file: "src/shared/emit.ts",
    rule: "direct-console-presentation",
    count: 1,
    reason: "The machine envelope chokepoint prints the one JSON result.",
  },
  {
    file: "src/lib/log.ts",
    rule: "direct-console-presentation",
    count: 2,
    reason: "The Logger authority's exact console-backed line writers.",
  },
  {
    file: "src/shared/third_party_codegen.ts",
    rule: "padEnd-alignment",
    count: 2,
    reason: "Generated NOTICE document columns over ASCII names and versions.",
  },
  {
    file: "src/shared/result.ts",
    rule: "padEnd-alignment",
    count: 2,
    reason:
      "Fixed ASCII disposition/outcome vocabulary, width-safe by construction.",
  },
  {
    file: "src/lib/artifact_ownership.ts",
    rule: "padEnd-alignment",
    count: 1,
    reason: "Generated Markdown table cells in a committed document.",
  },
  {
    file: "src/engine/desk/desk.ts",
    rule: "narration-glyph-literal",
    count: 1,
    reason: "The desk's muted command echo reuses the accent arrow glyph.",
  },
];

/** Locate outlawed output idioms in comment-stripped source. */
function outputIdiomFindings(source: string): BoundaryFinding[] {
  const code = codeOnly(source);
  return OUTPUT_IDIOM_RULES.flatMap(({ id, pattern }) => {
    pattern.lastIndex = 0;
    return [...code.matchAll(pattern)].map((match) => ({
      rule: id,
      offset: match.index ?? 0,
    }));
  });
}

/** One located idiom finding, ready for the offender report. */
interface LocatedIdiomFinding {
  readonly rule: string;
  readonly line: number;
}

/** Apply the exact exception table to per-file idiom findings; return the
 * uncovered residue. A count mismatch (stale, moved, or grown) fails here. */
function unappliedIdiomFindings(
  byFile: ReadonlyMap<string, readonly LocatedIdiomFinding[]>,
): string[] {
  const residue: string[] = [];
  const covered = new Set<string>();
  for (const entry of OUTPUT_IDIOM_EXCEPTIONS) {
    assert(
      entry.reason.trim() !== "",
      `${entry.file} exception needs a reason`,
    );
    const matched = (byFile.get(entry.file) ?? []).filter((finding) =>
      finding.rule === entry.rule
    ).length;
    assertEquals(
      matched,
      entry.count,
      `${entry.file} ${entry.rule} exception moved, became stale, or changed count`,
    );
    covered.add(`${entry.file} ${entry.rule}`);
  }
  for (const [file, findings] of byFile) {
    for (const finding of findings) {
      if (covered.has(`${file} ${finding.rule}`)) continue;
      residue.push(`${file}:${finding.line} (${finding.rule})`);
    }
  }
  return residue;
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

  const requestSynthetic = [
    'import { Select } from "@cliffy/prompt";',
    `import { requestSelection as orbit, DenoTerminalIO } from "${INTERACTIVE_MODULE}";`,
    `import * as interactive from "${INTERACTIVE_MODULE}";`,
    'orbit({ label: "Fresh sibling", choices: [] });',
    'relay(orbit, { label: "Helper bypass", choices: [] });',
    'notRunInteractionRequest(orbit, { label: "Near miss", choices: [] });',
    'adapter.runInteractionRequest(orbit, { label: "Qualified near miss", choices: [] });',
    'interactive.requestFuture({ label: "Future sibling" });',
    `const future = await import("${INTERACTIVE_MODULE}"); future.requestFuture({});`,
  ].join("\n");
  assertEquals(
    directRequestFindings(requestSynthetic).map((finding) => finding.rule),
    [
      "legacy-cliffy-prompt-import",
      "direct-package-request-import",
      "direct-package-request-call",
      "unmediated-package-request-use",
      "unmediated-package-request-use",
      "unmediated-package-request-use",
      "unmediated-package-request-use",
      "direct-package-namespace-request",
      "dynamic-interactive-package-import",
    ],
  );
  assertEquals(
    directRequestFindings(
      `import { requestSelection as orbit } from "${INTERACTIVE_MODULE}";\n` +
        "runInteractionRequest(orbit, options, runtime);",
    ).map((finding) => finding.rule),
    ["direct-package-request-import"],
  );
  assertEquals(
    directRequestFindings(
      `import { InlineFramePainter } from "${INTERACTIVE_MODULE}";\n` +
        "new InlineFramePainter({});",
    ),
    [],
  );
  assertEquals(
    adHocHeadingFindings(
      'const fake = { kind: "group-heading", id: "fake", value: "fake" };',
    ).map((finding) => finding.rule),
    ["ad-hoc-selection-heading"],
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
    "first\n\nsecond\n\n▸ third\n\n  ── Fourth\nfourth\n",
  );

  out.error("failure");
  out.group("failure-recovery", "Recovery");
  out.warn("fix it");
  assertEquals(
    errors.join(""),
    "✕ failure\n\n  ── Recovery\n! fix it\n",
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
    `▸ ${safe}\n✓ ${safe}\n\n${safe}\n\n  ── ${safeLabel}\n`,
  );
  assertEquals(errors.join(""), `! ${safe}\n✕ ${safe}\n`);

  out.raw(hostile);
  assertEquals(chunks.at(-1), hostile);
});

Deno.test("the selection grouping surface gives every populated group a heading", () => {
  const options = groupedSelectionEntries<string>([
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

Deno.test("the interaction grouping surface writes one leading boundary", () => {
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
  const terminal = withInteractionBoundary(target);

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
  const idiomFindings = new Map<string, LocatedIdiomFinding[]>();
  for (
    const rel of await structuralGuardScope({
      guard:
        "tests/human_output_grouping_test.ts#managed-human-output-boundaries",
      universe: "authored-deno",
      narrow: {
        reason:
          "Discern-managed human output is emitted by production modules beneath src; tests only exercise and plant shapes.",
        include: (path) => path.startsWith("src/"),
      },
    })
  ) {
    const source = await Deno.readTextFile(join(REPO_ROOT, rel));
    for (const finding of manualBoundaryFindings(source)) {
      offenders.push(
        `${rel}:${lineAt(source, finding.offset)} (${finding.rule})`,
      );
    }
    const located = outputIdiomFindings(source).map((finding) => ({
      rule: finding.rule,
      line: lineAt(source, finding.offset),
    }));
    if (located.length > 0) idiomFindings.set(rel, located);
    const requestFindings = directRequestFindings(source).filter((finding) =>
      !(rel === "src/lib/terminal_interaction.ts" &&
        finding.rule === "direct-package-request-import")
    );
    for (const finding of requestFindings) {
      offenders.push(
        `${rel}:${lineAt(source, finding.offset)} (${finding.rule})`,
      );
    }
    if (rel !== "src/lib/terminal_interaction.ts") {
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

  offenders.push(...unappliedIdiomFindings(idiomFindings));

  assert(
    offenders.length === 0,
    "Human output groups must go through the shared text/interaction grouping surfaces; " +
      `found:\n${offenders.join("\n")}`,
  );
});

Deno.test("the output-idiom detector rejects unrelated future siblings", () => {
  const synthetic = [
    "function orbit(rows: { name: string }[]) {",
    "  for (const row of rows) console.log(`  ${row.name.padEnd(20)}`);",
    "}",
    'function canopy() { console.error("✗ the file is missing."); }',
    'function harbor(out: { raw(s: string): void }) { out.raw("→ next"); }',
    'function estuary(n: number) { writeStdout("\\n".repeat(n)); }',
    'function inlet() { writeStderr("\\nSection heading"); }',
    "// a commented console.log(`✓ done`) never matches",
  ].join("\n");
  assertEquals(
    outputIdiomFindings(synthetic).map((finding) => finding.rule).sort(),
    [
      "boundary-newline-repeat",
      "direct-console-presentation",
      "direct-console-presentation",
      "narration-glyph-literal",
      "narration-glyph-literal",
      "padEnd-alignment",
      "writer-leading-newline",
      "writer-leading-newline",
    ],
  );
  assertEquals(
    outputIdiomFindings(
      'const mark = "✓";\nlog.error("state the condition");\n',
    ),
    [],
    "a bare data glyph and an authority call stay legal",
  );
});
