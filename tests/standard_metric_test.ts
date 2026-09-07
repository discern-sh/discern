/**
 * Unit guard for the shared finite standard metric protocol.
 *
 * `DISCERN_METRIC <name> <value>` is a public contract a project's standard command
 * emits (README, the config reference, the JSON schema, the seed template), so the
 * parser is pinned against the shapes that contract allows — and the ones it must
 * reject — rather than re-deriving them from the implementation. The marker may sit
 * anywhere on a line outside recognized diagnostic reports, the last emission
 * wins, and a value is read only from a
 * genuine marker token (not a coincidental number elsewhere in the output).
 */

import { assertEquals, assertThrows } from "@std/assert";
import { DIAGNOSTIC_FORMATS } from "../src/engine/gate/diagnostics.ts";
import { readMetrics } from "../src/engine/validation/metrics.ts";

const cases: Array<{
  name: string;
  output: string;
  metric: string;
  want: number | undefined;
}> = [
  {
    name: "clean single line",
    output: "DISCERN_METRIC coverage 85",
    metric: "coverage",
    want: 85,
  },
  {
    name: "marker mid-line, with surrounding text",
    output: "result: DISCERN_METRIC coverage 85 (ok)",
    metric: "coverage",
    want: 85,
  },
  {
    name: "last line wins across emissions",
    output: "DISCERN_METRIC coverage 80\nDISCERN_METRIC coverage 91",
    metric: "coverage",
    want: 91,
  },
  {
    name: "last wins within a single line",
    output: "DISCERN_METRIC coverage 1 DISCERN_METRIC coverage 2",
    metric: "coverage",
    want: 2,
  },
  {
    name: "decimal value is finite",
    output: "DISCERN_METRIC ratio 0.5",
    metric: "ratio",
    want: 0.5,
  },
  {
    name: "wrong metric name is ignored",
    output: "DISCERN_METRIC other 9",
    metric: "coverage",
    want: undefined,
  },
  {
    name: "a metric name the query is only a prefix of does not match",
    output: "DISCERN_METRIC coverage_pct 9",
    metric: "coverage",
    want: undefined,
  },
  {
    name: "no marker, only a trailing percentage",
    output: "Total coverage: 90%",
    metric: "coverage",
    want: undefined,
  },
  {
    name: "marker as a substring of a larger token does not match",
    output: "XDISCERN_METRIC coverage 5",
    metric: "coverage",
    want: undefined,
  },
  {
    name: "tab-separated marker",
    output: "DISCERN_METRIC\tcoverage\t77",
    metric: "coverage",
    want: 77,
  },
  {
    name: "empty output",
    output: "",
    metric: "coverage",
    want: undefined,
  },
];

for (const c of cases) {
  Deno.test(`readMetrics: ${c.name}`, () => {
    assertEquals(readMetrics(c.output)[c.metric], c.want);
  });
}

const diagnosticReports = {
  sarif: (message: string): string =>
    JSON.stringify({
      version: "2.1.0",
      runs: [{
        results: [{ message: { text: `example ${message} (quoted)` } }],
      }],
    }),
  "junit-xml": (message: string): string =>
    `<testsuites><testsuite name="fixture"><testcase name="scenario ${message} (quoted)">` +
    `<system-out><![CDATA[example ${message} (quoted)]]></system-out>` +
    "</testcase></testsuite></testsuites>",
} satisfies Record<
  typeof DIAGNOSTIC_FORMATS[number]["id"],
  (message: string) => string
>;

for (const format of DIAGNOSTIC_FORMATS) {
  Deno.test(`readMetrics: ${format.label} payloads cannot supply or corrupt readings`, () => {
    const report = diagnosticReports[format.id];
    for (const token of ["91", "40)", "NaN"]) {
      const payload = report(`DISCERN_METRIC unrelated ${token}`);
      assertEquals(readMetrics(payload), {});
      assertEquals(
        readMetrics(
          `DISCERN_METRIC unrelated 3\n${payload}\n` +
            "result: DISCERN_METRIC population 4 (ok)",
        ),
        { unrelated: 3, population: 4 },
      );
      assertThrows(() =>
        readMetrics(`${payload}\nDISCERN_METRIC unrelated ${token}oops`)
      );
    }
  });
}

Deno.test("readMetrics: unrecognized or incomplete reports retain strict marker validation", () => {
  for (
    const output of [
      '<testsuite name="unfinished DISCERN_METRIC missing NaN',
      JSON.stringify({ message: "example DISCERN_METRIC missing NaN" }),
    ]
  ) assertThrows(() => readMetrics(output));
});
