/**
 * Architectural closed-set guard for the hint registry (ADR 0172): every
 * advisory string enters `hints[]` through the registry.
 *
 * The live scan discovers every TypeScript source under `src/`. The synthetic
 * controls prove the detector rejects a fresh-named future sibling before the
 * clean tree is trusted to pass.
 */

import { assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { join, relative } from "@std/path";
import { inlineHintLiterals } from "./hint_scan.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const SRC = join(REPO_ROOT, "src");
const REGISTRY = join(SRC, "shared/hints.ts");

Deno.test("hint guard: inline literals are rejected at hints[] and FiredHint construction", () => {
  const source = [
    'const result = { hints: ["Fresh advisory."] };',
    "hints.push(`Another ${name}.`);",
    "const fired: FiredHint = {",
    '  id: "fresh-name",',
    '  text: "Fresh fired hint.",',
    "};",
  ].join("\n");
  assertEquals(
    inlineHintLiterals(source),
    [
      { text: "Fresh advisory.", line: 1, sink: "hints[]" },
      { text: "Another ${name}.", line: 2, sink: "hints[]" },
      { text: "fresh-name", line: 4, sink: "FiredHint" },
      { text: "Fresh fired hint.", line: 5, sink: "FiredHint" },
    ],
  );
});

Deno.test("hint guard: registry lookups and unrelated string arrays stay legal", () => {
  const source = [
    'const result = { hints: hintTexts([fire(HINTS["known-hint"])]) };',
    'const labels = ["plain data", "still plain data"];',
  ].join("\n");
  assertEquals(inlineHintLiterals(source), []);
});

Deno.test("no string literal reaches hints[] or FiredHint construction outside the registry", async () => {
  const offenders: string[] = [];
  for await (
    const entry of walk(SRC, { includeDirs: false, exts: [".ts"] })
  ) {
    if (entry.path === REGISTRY) continue;
    const source = await Deno.readTextFile(entry.path);
    const rel = relative(REPO_ROOT, entry.path);
    for (const finding of inlineHintLiterals(source)) {
      offenders.push(
        `${rel}:${finding.line} ${finding.sink} contains ${
          JSON.stringify(finding.text)
        }`,
      );
    }
  }
  assertEquals(
    offenders,
    [],
    "hint prose must come from src/shared/hints.ts — register the template, " +
      `then fire it at the call site:\n  ${offenders.join("\n  ")}`,
  );
});
