/**
 * Tier-1 diagnostic normalization (ADR 0028): the SARIF and JUnit XML
 * auto-detectors that turn a failed gate command's tool output into
 * structured {file,line,rule} findings. Pure-unit here; the end-to-end wiring
 * through `done --json` lives in `engine_done_json_test.ts`.
 */

import { assert, assertEquals } from "@std/assert";
import {
  extractJunit,
  extractSarif,
  junitToDiagnostics,
  normalizeDiagnostics,
  sarifToDiagnostics,
} from "../src/engine/gate/diagnostics.ts";
import { normalizableJobOutput } from "../src/engine/gate/diagnostic_output.ts";
import { captureElisionMarker } from "../src/engine/jobs/command.ts";
import { withTempDir } from "./helpers.ts";

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

Deno.test("normalizeDiagnostics: empty SARIF returns undefined so Tier-0 fallback survives", () => {
  const emptySarif = JSON.stringify({
    version: "2.1.0",
    runs: [{ results: [] }],
  });
  assertEquals(
    normalizeDiagnostics(emptySarif, "lint", "eslint --format sarif ."),
    undefined,
  );
});

// A report in the shape Deno's junit reporter emits: suite name and classname
// carry the file path, line/col ride as attributes, the failure message is an
// escaped attribute, and stderr noise surrounds the document.
const JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="test run" tests="3" failures="1" errors="1" time="0.4">
    <testsuite name="./tests/upload_test.ts" tests="2" disabled="0" errors="0" failures="1">
        <testcase name="retries once" classname="./tests/upload_test.ts" time="0.01" line="4" col="6">
        </testcase>
        <testcase name="maps a -&gt; b &amp; escapes &quot;quotes&quot;" classname="./tests/upload_test.ts" time="0.02" line="9" col="6">
            <failure message="Uncaught AssertionError: Values are not equal: one is not two">AssertionError: Values are not equal
    at file:///tests/upload_test.ts:9:35</failure>
        </testcase>
    </testsuite>
    <testsuite name="com.example.parser" tests="1" disabled="0" errors="1" failures="0">
        <testcase name="parses" classname="com.example.ParserTest" time="0.10">
            <error><![CDATA[java.lang.IllegalStateException: boom <unexpected>]]></error>
        </testcase>
    </testsuite>
</testsuites>`;

Deno.test("extractJunit: recognizes a JUnit report, even with runner noise around it", () => {
  assert(extractJunit(JUNIT) !== undefined, "pure JUnit should be detected");
  const noisy =
    `Check file:///tests/upload_test.ts\n${JUNIT}\nerror: Test failed\n`;
  const sliced = extractJunit(noisy);
  assert(sliced !== undefined, "JUnit embedded in noise should be detected");
  assert(
    sliced.startsWith("<testsuites") && sliced.endsWith("</testsuites>"),
    "the slice should span exactly the XML document",
  );
});

Deno.test("extractJunit: does NOT fire on plain text or tagless mentions", () => {
  assertEquals(extractJunit("3 tests failed, see above"), undefined);
  assertEquals(
    extractJunit("the testsuite keyword alone, with no XML element"),
    undefined,
  );
  // An open tag with no close tag is rejected rather than half-read.
  assertEquals(extractJunit('<testsuite name="x">'), undefined);
});

Deno.test("junitToDiagnostics: one diagnostic per failing case, with file/line/col/rule", () => {
  const xml = extractJunit(JUNIT);
  assert(xml !== undefined, "fixture should be detected as JUnit");
  const diags = junitToDiagnostics(xml, "test", "deno task test");
  assert(diags !== undefined, "failing cases should produce diagnostics");
  assertEquals(diags.length, 2);

  const [failed, errored] = diags;
  assert(failed !== undefined && errored !== undefined, "expected two");

  assertEquals(failed.tool, "test");
  assertEquals(failed.reproduce_cmd, "deno task test");
  assertEquals(failed.severity, "error");
  // The passing sibling case contributed nothing; the failing case's identity
  // is fully attributed, with entities decoded and the `./` prefix dropped.
  assertEquals(failed.file, "tests/upload_test.ts");
  assertEquals(failed.line, 9);
  assertEquals(failed.col, 6);
  assertEquals(failed.rule, 'maps a -> b & escapes "quotes"');
  assert(failed.message.includes("one is not two"));

  // The errored case: dotted classname is a language identifier, not a path,
  // and its suite name isn't path-like either — so no file is invented; the
  // CDATA body supplies the message when the message attribute is absent.
  assertEquals(errored.file, undefined);
  assertEquals(errored.rule, "parses");
  assert(errored.message.includes("boom <unexpected>"));
});

Deno.test("junitToDiagnostics: decodes XML text without decoding literal CDATA", () => {
  const mixed = `<testsuite name="./tests/mixed_test.ts">
    <testcase name="keeps literal entities">
      <failure>outside &lt;decoded&gt; <![CDATA[inside &lt;literal&gt;]]> &amp; tail</failure>
    </testcase>
  </testsuite>`;
  const diags = junitToDiagnostics(mixed, "test", "deno task test");
  assert(diags !== undefined, "the failing case should produce a diagnostic");
  assertEquals(
    diags[0]?.message,
    "outside <decoded> inside &lt;literal&gt; & tail",
  );
});

Deno.test("junitToDiagnostics: an all-green report returns undefined so Tier-0 fallback survives", () => {
  const green = `<testsuites tests="1" failures="0" errors="0">
    <testsuite name="./tests/ok_test.ts" tests="1" failures="0">
        <testcase name="passes" classname="./tests/ok_test.ts" time="0.01"></testcase>
    </testsuite>
</testsuites>`;
  assertEquals(junitToDiagnostics(green, "test", "deno task test"), undefined);
  assertEquals(
    normalizeDiagnostics(green, "test", "deno task test"),
    undefined,
  );
});

Deno.test("normalizeDiagnostics: JUnit output routes through the JUnit tier", () => {
  const diags = normalizeDiagnostics(JUNIT, "test", "deno task test");
  assert(diags !== undefined, "JUnit should normalize");
  assertEquals(diags.length, 2);
});

Deno.test("normalization reads the complete capture when the window elided the failing cases", async () => {
  await withTempDir(async (dir) => {
    const failing = (name: string): string =>
      `<testcase name="${name}" classname="./tests/${name}_test.ts" line="7" col="6"><failure message="Uncaught AssertionError: ${name}">boom</failure></testcase>`;
    const green = (i: number): string =>
      `<testcase name="ok ${i}" classname="./tests/ok_test.ts" line="1" col="1"/>`;
    const early = Array.from({ length: 200 }, (_, i) => green(i)).join("\n");
    const late = Array.from({ length: 200 }, (_, i) => green(1000 + i)).join(
      "\n",
    );
    const report =
      `<testsuites><testsuite name="./tests/x_test.ts">\n${early}\n${
        failing("first")
      }\n${failing("second")}\n${late}\n</testsuite></testsuites>`;
    const path = `${dir}/capture.log`;
    await Deno.writeTextFile(path, report);
    // The window a capture larger than its cap keeps — head, marker, tail —
    // with every failing case fallen in between.
    const window = `${report.slice(0, early.length + 40)}${
      captureElisionMarker(report.length)
    }${report.slice(-late.length)}`;
    assertEquals(normalizeDiagnostics(window, "test", "run tests"), undefined);
    assertEquals(
      await normalizableJobOutput({ output: window, outputPath: path }),
      report,
    );
    const complete = await normalizableJobOutput({
      output: window,
      outputPath: path,
    });
    assertEquals(
      normalizeDiagnostics(complete ?? "", "test", "run tests")?.map((d) =>
        d.rule
      ),
      ["first", "second"],
    );
    // A window that elided nothing is complete; the artifact is never read.
    assertEquals(
      await normalizableJobOutput({
        output: "plain",
        outputPath: `${dir}/missing.log`,
      }),
      "plain",
    );
    // A window whose artifact is gone still normalizes what it kept.
    assertEquals(
      await normalizableJobOutput({
        output: window,
        outputPath: `${dir}/missing.log`,
      }),
      window,
    );
  });
});
