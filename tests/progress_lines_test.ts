/** The producer progress protocol validates completely or ignores the line. */
import { assertEquals } from "@std/assert";
import {
  formatProducerProgressLine,
  parseProducerProgressLine,
  type ProducerProgressReport,
} from "../src/engine/validation/progress_lines.ts";

Deno.test("progress lines round-trip through the shared formatter", () => {
  const reports: ProducerProgressReport[] = [
    { units: { kind: "partitions", completed: 3, total: 8 } },
    { units: { kind: "partitions", completed: 3, total: null } },
    { results: { passed: 120, failed: 1, skipped: 2 } },
    { results: { failed: 1 } },
    { active: ["tests/alpha_test.ts", "tests/beta_test.ts"] },
    { elapsed_ms: 45_210 },
    {
      units: { kind: "partitions", completed: 7, total: 8 },
      results: { passed: 300, failed: 2, skipped: 0 },
      active: [],
      elapsed_ms: 91_000,
      failure: {
        name: "alpha keeps its invariant",
        message: "expected 2, got 3",
        file: "tests/alpha_test.ts",
        line: 42,
        reproduce: "deno task test tests/alpha_test.ts --shuffle=7",
      },
    },
  ];
  for (const report of reports) {
    assertEquals(
      parseProducerProgressLine(formatProducerProgressLine(report)),
      report,
    );
  }
});

Deno.test("progress lines tolerate surrounding text and unknown keys", () => {
  assertEquals(
    parseProducerProgressLine(
      '  worker-3 DISCERN_PROGRESS {"units":{"kind":"files","completed":1,"total":2},"vendor_extra":true}',
    ),
    { units: { kind: "files", completed: 1, total: 2 } },
  );
  // An omitted total is the same unknown fact as an explicit null.
  assertEquals(
    parseProducerProgressLine(
      'DISCERN_PROGRESS {"units":{"kind":"files","completed":1}}',
    ),
    { units: { kind: "files", completed: 1, total: null } },
  );
  // Empty result counts are the same unknown fact as absent ones; the rest
  // of the line still stands instead of being dropped with them.
  assertEquals(
    parseProducerProgressLine(
      'DISCERN_PROGRESS {"units":{"kind":"files","completed":0,"total":4},"results":{}}',
    ),
    { units: { kind: "files", completed: 0, total: 4 } },
  );
});

Deno.test("a malformed report is ignored whole, never accepted in part", () => {
  const rejected = [
    "ordinary producer text",
    "DISCERN_PROGRESS",
    "DISCERN_PROGRESS not-json",
    'DISCERN_PROGRESS ["array"]',
    "DISCERN_PROGRESS {}",
    'DISCERN_PROGRESS {"vendor_only":1}',
    'DISCERN_PROGRESS {"units":{"kind":"files"}}',
    'DISCERN_PROGRESS {"units":{"kind":"files","completed":-1,"total":2}}',
    'DISCERN_PROGRESS {"units":{"kind":"files","completed":1.5,"total":2}}',
    'DISCERN_PROGRESS {"units":{"kind":"files","completed":1,"total":2},"results":{"passed":"many"}}',
    'DISCERN_PROGRESS {"results":{}}',
    'DISCERN_PROGRESS {"active":"tests/alpha_test.ts"}',
    'DISCERN_PROGRESS {"active":[1]}',
    'DISCERN_PROGRESS {"elapsed_ms":-4}',
    'DISCERN_PROGRESS {"failure":{"name":"x"}}',
    'DISCERN_PROGRESS {"failure":{"name":"x","message":"m","line":"12"}}',
    'DISCERN_PROGRESS {"units":{"kind":"files","completed":1,"total":2}} trailing',
  ];
  for (const line of rejected) {
    assertEquals(parseProducerProgressLine(line), undefined, line);
  }
});

Deno.test("oversized lines and oversized messages stay bounded", () => {
  const huge = `DISCERN_PROGRESS {"active":["${"x".repeat(20_000)}"]}`;
  assertEquals(parseProducerProgressLine(huge), undefined);
  const long = "m".repeat(5_000);
  const parsed = parseProducerProgressLine(
    `DISCERN_PROGRESS {"failure":{"name":"n","message":${
      JSON.stringify(long)
    }}}`,
  );
  assertEquals(parsed?.failure?.message.length, 4097);
  assertEquals(parsed?.failure?.message.endsWith("…"), true);
});
