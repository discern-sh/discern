/** Architectural guard for contract-validated JSON decoding in tests. */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const DECODER = "tests/decode_cli_result.ts";
const RAW_JSON_PARSE = ["JSON", ".parse", "("].join("");

/** Locate direct JSON parse calls while leaving the validating decoder exempt. */
function rawJsonParseFindings(path: string, source: string): string[] {
  if (path === DECODER) return [];
  const findings: string[] = [];
  for (const [index, line] of source.split("\n").entries()) {
    let offset = 0;
    while (offset < line.length) {
      const found = line.indexOf(RAW_JSON_PARSE, offset);
      if (found < 0) break;
      findings.push(`${path}:${index + 1}:${found + 1}`);
      offset = found + RAW_JSON_PARSE.length;
    }
  }
  return findings;
}

Deno.test("the raw-parse guard catches ordinary tests and executable fixtures", () => {
  const directParse = ["const decoded = JSON", ".parse", "(text);\n"].join("");
  assertEquals(
    rawJsonParseFindings("tests/future_test.ts", directParse),
    ["tests/future_test.ts:1:17"],
  );
  assertEquals(
    rawJsonParseFindings("tests/fixtures/future_runner.ts", directParse),
    ["tests/fixtures/future_runner.ts:1:17"],
  );
  assertEquals(rawJsonParseFindings(DECODER, directParse), []);
});

Deno.test("test JSON crosses the validating decoder boundary", async () => {
  const offenders: string[] = [];
  for (
    const rel of await structuralGuardScope({
      guard: "tests/raw_json_parse_guard_test.ts#validated-test-json",
      universe: {
        kind: "specialized",
        name: "test TypeScript including executable fixture paths",
        extensions: [".ts", ".tsx"],
        reason:
          "AUTHORED_TS_FILES deliberately excludes fixtures, but executable test fixtures also consume JSON.",
      },
      narrow: {
        reason:
          "Test and executable-fixture JSON must validate at decode time; runtime boundaries use their own decoder.",
        include: (path) => path.startsWith("tests/"),
      },
    })
  ) {
    offenders.push(...rawJsonParseFindings(
      rel,
      await Deno.readTextFile(join(REPO_ROOT, rel)),
    ));
  }
  assertEquals(
    offenders,
    [],
    "direct test JSON parsing bypasses contract validation; use decodeCliResult for discern stdout or decodeWith for fixtures and sidecars",
  );
});
