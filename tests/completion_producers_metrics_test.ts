import { assertEquals, assertThrows } from "@std/assert";
import {
  readMetrics,
  standardReading,
} from "../src/engine/validation/metrics.ts";

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
