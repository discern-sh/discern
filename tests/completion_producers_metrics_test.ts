import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  compareValueToLimit,
  readMetrics,
  standardReading,
} from "../src/engine/validation/metrics.ts";

import { RECORD_ENTRY_SCHEMAS } from "../src/shared/config_schema.ts";

Deno.test("required consumers reject malformed, absent and non-finite measurements", () => {
  for (const token of ["NaN", "Infinity", "1e999", "-Infinity", "oops"]) {
    assertThrows(() => readMetrics(`DISCERN_METRIC novel ${token}`));
  }
  assertThrows(() => standardReading({ metric: "novel", scale: 1 }, {}, null));
  assertThrows(() =>
    standardReading(
      {
        metric: "novel",
        scale: 1,
        per: { kind: "metric", metric: "population" },
      },
      { novel: 1, population: 0 },
      null,
    )
  );
  assertEquals(
    standardReading(
      {
        metric: "novel",
        scale: 100,
        per: { kind: "metric", metric: "population" },
      },
      readMetrics("DISCERN_METRIC novel 3\nDISCERN_METRIC population 4"),
      null,
    ),
    75,
  );
});

Deno.test("every standard direction routes a breach through repair and informed owner agreement", () => {
  for (
    const direction of RECORD_ENTRY_SCHEMAS.standards.shape.direction.options
  ) {
    const value = direction === "up" ? 9 : 11;
    const verdict = compareValueToLimit(
      { name: "example", metric: "reading", direction, limit: 10 },
      value,
      String(value),
      "",
    );
    assertEquals(verdict.held, false);
    assertEquals(verdict.value, value);
    const reason = verdict.reason;
    assert(reason !== undefined);
    const repair = reason.indexOf(
      "try reasonable remedies within the authorized task",
    );
    const tradeoff = reason.indexOf("supported alternatives");
    const consent = reason.indexOf("After owner agreement");
    const proposal = reason.indexOf("discern standards propose example");
    assert(
      repair >= 0 && repair < tradeoff && tradeoff < consent &&
        consent < proposal,
      reason,
    );
    assertStringIncludes(reason, "Keep unrelated changes out of the remedy");
    assertEquals(
      compareValueToLimit(
        { name: "example", metric: "reading", direction, limit: 10 },
        10,
        "10",
        "",
      ).reason,
      undefined,
      "a held limit must not request an owner decision",
    );
  }
});
