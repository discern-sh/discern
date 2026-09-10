/** Runner progress emission derives from settled reports and never schedules. */
import { assert, assertEquals } from "@std/assert";
import {
  focusedReproduceCommand,
  PartitionProgressReporter,
  reproduceInstrumentation,
} from "../scripts/test_partitions.ts";
import { parseProducerProgressLine } from "../src/engine/validation/progress_lines.ts";

/** One minimal native report with the given verdict mix. */
function report(cases: {
  readonly passed?: number;
  readonly failing?: readonly { name: string; message: string }[];
  readonly skipped?: number;
}): string {
  const passed = Array.from(
    { length: cases.passed ?? 0 },
    (_, index) =>
      `<testcase name="green ${index}" classname="./tests/green_test.ts" line="1" col="6"></testcase>`,
  );
  const failing = (cases.failing ?? []).map(({ name, message }) =>
    `<testcase name="${name}" classname="./tests/red_test.ts" line="7" col="6"><failure message="${message}">${message}</failure></testcase>`
  );
  const skipped = Array.from(
    { length: cases.skipped ?? 0 },
    (_, index) =>
      `<testcase name="quiet ${index}" classname="./tests/green_test.ts" line="9" col="11"><skipped/></testcase>`,
  );
  const total = passed.length + failing.length + skipped.length;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="deno test" tests="${total}" failures="${failing.length}" errors="0" time="0.1">\n<testsuite name="./tests/mixed_test.ts" tests="${total}" errors="0" failures="${failing.length}">\n${
    [...passed, ...failing, ...skipped].join("\n")
  }\n</testsuite>\n</testsuites>\n`;
}

Deno.test("partition progress snapshots carry counts, unknown-at-start results, and elapsed time", () => {
  const lines: string[] = [];
  let clock = 1_000;
  const reporter = new PartitionProgressReporter({
    total: 3,
    seed: 42,
    forwarded: ["test", "--parallel", "--shuffle=42"],
    sink: (line) => lines.push(line),
    now: () => clock,
  });
  reporter.begin();
  clock += 2_500;
  reporter.settled(report({ passed: 5 }));
  clock += 1_500;
  reporter.settled(report({ passed: 2, skipped: 1 }));
  const parsed = lines.map((line) => parseProducerProgressLine(line));
  assertEquals(parsed, [
    { units: { kind: "partitions", completed: 0, total: 3 }, elapsed_ms: 0 },
    {
      units: { kind: "partitions", completed: 1, total: 3 },
      results: { passed: 5, failed: 0, skipped: 0 },
      elapsed_ms: 2_500,
    },
    {
      units: { kind: "partitions", completed: 2, total: 3 },
      results: { passed: 7, failed: 0, skipped: 1 },
      elapsed_ms: 4_000,
    },
  ]);
});

Deno.test("a failing partition reports each failure with its focused seeded reproduction", () => {
  const lines: string[] = [];
  const reporter = new PartitionProgressReporter({
    total: 2,
    seed: 7,
    forwarded: [
      "test",
      "--shuffle=7",
      "--coverage=/tmp/profile",
      "--coverage-raw-data-only",
    ],
    sink: (line) => lines.push(line),
    now: () => 0,
  });
  reporter.settled(report({
    passed: 1,
    failing: [{ name: "alpha holds", message: "expected 2, got 3" }],
  }));
  const parsed = lines.map((line) => parseProducerProgressLine(line));
  const failure = parsed.find((line) => line?.failure !== undefined)?.failure;
  assertEquals(failure?.name, "alpha holds");
  assertEquals(failure?.message, "expected 2, got 3");
  assertEquals(failure?.file, "tests/red_test.ts");
  assertEquals(failure?.line, 7);
  assertEquals(
    failure?.reproduce,
    "deno task test tests/red_test.ts --filter 'alpha holds' --shuffle=7 " +
      "--coverage=/tmp/profile --coverage-raw-data-only",
  );
  const snapshot = parsed.at(-1);
  assertEquals(snapshot?.results, { passed: 1, failed: 1, skipped: 0 });
});

Deno.test("an unreadable or malformed partition report marks the counts partial", () => {
  const lines: string[] = [];
  const reporter = new PartitionProgressReporter({
    total: 2,
    forwarded: ["test"],
    sink: (line) => lines.push(line),
    now: () => 0,
  });
  reporter.settled(report({ passed: 4 }));
  reporter.settled(undefined);
  const last = parseProducerProgressLine(lines.at(-1) ?? "");
  assertEquals(last?.units, { kind: "partitions", completed: 2, total: 2 });
  assertEquals(last?.results, { passed: 4, failed: 0, skipped: 0 });
  assertEquals(last?.partial, true);
  const malformed: string[] = [];
  const second = new PartitionProgressReporter({
    total: 1,
    forwarded: ["test"],
    sink: (line) => malformed.push(line),
    now: () => 0,
  });
  second.settled("<not-a-report>");
  assertEquals(
    parseProducerProgressLine(malformed.at(-1) ?? "")?.partial,
    true,
  );
});

Deno.test("failure emission stays bounded while snapshot counts stay complete", () => {
  const lines: string[] = [];
  const reporter = new PartitionProgressReporter({
    total: 1,
    forwarded: ["test"],
    sink: (line) => lines.push(line),
    now: () => 0,
  });
  reporter.settled(report({
    failing: Array.from({ length: 40 }, (_, index) => ({
      name: `case ${index}`,
      message: "boom",
    })),
  }));
  const parsed = lines.map((line) => parseProducerProgressLine(line));
  assertEquals(
    parsed.filter((line) => line?.failure !== undefined).length,
    32,
  );
  assertEquals(parsed.at(-1)?.results?.failed, 40);
});

Deno.test("focused reproductions quote names and keep only instrumentation flags", () => {
  assertEquals(
    reproduceInstrumentation([
      "test",
      "--parallel",
      "--shuffle=9",
      "--coverage=cov",
      "--coverage-raw-data-only",
      "--reporter=junit",
    ]),
    ["--coverage=cov", "--coverage-raw-data-only"],
  );
  assertEquals(
    focusedReproduceCommand("name with 'quote'", undefined, undefined, []),
    "deno task test --filter 'name with '\\''quote'\\'''",
  );
  assert(
    focusedReproduceCommand("plain", "tests/a_test.ts", 3, [])
      .endsWith("tests/a_test.ts --filter plain --shuffle=3"),
  );
});
