/**
 * Tier-1 diagnostic normalization (ADR 0028): the SARIF auto-detector that turns a
 * failed gate command's machine output into structured {file,line,rule} findings.
 * Pure-unit here; the end-to-end wiring through `finish --json` lives in
 * `engine_finish_json_test.ts`.
 */

import { assert, assertEquals } from "@std/assert";
import {
  extractSarif,
  normalizeDiagnostics,
  sarifToDiagnostics,
} from "../src/engine/gate/diagnostics.ts";

const SARIF = JSON.stringify({
  version: "2.1.0",
  $schema: "https://json.schemastore.org/sarif-2.1.0.json",
  runs: [
    {
      tool: { driver: { name: "ESLint" } },
      results: [
        {
          ruleId: "no-unused-vars",
          level: "error",
          message: { text: "'x' is defined but never used." },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/foo.ts" },
                region: { startLine: 12, startColumn: 5 },
              },
            },
          ],
        },
        {
          ruleId: "eqeqeq",
          level: "warning",
          message: { text: "Expected '===' and instead saw '=='." },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/bar.ts" },
                region: { startLine: 3 },
              },
            },
          ],
        },
      ],
    },
  ],
});

Deno.test("extractSarif: recognizes a SARIF log, even with stderr noise around it", () => {
  assert(extractSarif(SARIF) !== undefined, "pure SARIF should be detected");
  const noisy = `Linting 3 files...\n${SARIF}\nDone (2 problems).\n`;
  assert(
    extractSarif(noisy) !== undefined,
    "SARIF embedded in stderr noise should still be detected",
  );
});

Deno.test("extractSarif: does NOT fire on incidental or non-SARIF JSON", () => {
  assertEquals(extractSarif("plain tool output, no json"), undefined);
  // Valid JSON, but not SARIF (no runs[] + no sarif marker) — must not misread.
  assertEquals(extractSarif('{"ok":false,"errors":["boom"]}'), undefined);
  // A `runs` array but no version/$schema marker — still rejected.
  assertEquals(extractSarif('{"runs":[]}'), undefined);
});

Deno.test("sarifToDiagnostics: one diagnostic per result, with file/line/col/rule/severity", () => {
  const sarif = extractSarif(SARIF);
  assert(sarif !== undefined, "fixture should be detected as SARIF");
  const diags = sarifToDiagnostics(sarif, "lint", "eslint --format sarif .");
  assert(diags !== undefined, "SARIF with results should produce diagnostics");
  assertEquals(diags.length, 2);

  const [first, second] = diags;
  assert(
    first !== undefined && second !== undefined,
    "expected two diagnostics",
  );

  assertEquals(first.tool, "lint");
  assertEquals(first.reproduce_cmd, "eslint --format sarif .");
  assertEquals(first.severity, "error");
  assertEquals(first.rule, "no-unused-vars");
  assertEquals(first.file, "src/foo.ts");
  assertEquals(first.line, 12);
  assertEquals(first.col, 5);
  assert(first.message.includes("never used"));

  assertEquals(second.severity, "warning"); // SARIF level "warning"
  assertEquals(second.line, 3);
  assertEquals(second.col, undefined); // startColumn omitted → no col
});

Deno.test("normalizeDiagnostics: returns undefined for unrecognized output (Tier-0 fallback)", () => {
  assertEquals(
    normalizeDiagnostics("error: something broke\n", "lint", "eslint ."),
    undefined,
  );
});
