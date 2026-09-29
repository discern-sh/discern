import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { assertCases, assertCasesAsync } from "./assert_cases.ts";

Deno.test("case matrices run every row and retain each named failure cause", () => {
  const first = new Error("first assertion");
  const last = new Error("last assertion");
  const visited: number[] = [];
  const failure = assertThrows(
    () =>
      assertCases([1, 2, 3], (row) => `row ${row}`, (row) => {
        visited.push(row);
        if (row === 1) throw first;
        if (row === 3) throw last;
      }),
    AggregateError,
    "2 of 3 cases failed: row 1; row 3",
  );
  assertEquals(visited, [1, 2, 3]);
  assertEquals(failure.errors.map((error: Error) => error.cause), [
    first,
    last,
  ]);
  assertThrows(
    () => assertCases([], String, () => {}),
    Error,
    "at least one row",
  );
  assertCases([1, 2], String, (row) => {
    assertEquals(row > 0, true);
  });
});

Deno.test("async case matrices await each observation and preserve later failures", async () => {
  const visited: string[] = [];
  const cause = new Error("observation failed");
  const failure = await assertRejects(
    () =>
      assertCasesAsync([1, 2, 3], String, async (row) => {
        visited.push(`start ${row}`);
        await Promise.resolve();
        visited.push(`finish ${row}`);
        if (row !== 2) throw cause;
      }),
    AggregateError,
    "2 of 3 cases failed: 1; 3",
  );
  assertEquals(visited, [
    "start 1",
    "finish 1",
    "start 2",
    "finish 2",
    "start 3",
    "finish 3",
  ]);
  assertEquals(failure.errors.map((error: Error) => error.cause), [
    cause,
    cause,
  ]);
  await assertRejects(
    () =>
      assertCasesAsync([], String, async () => {
        await Promise.resolve();
      }),
    Error,
    "at least one row",
  );
  await assertCasesAsync([1], String, async () => {
    await Promise.resolve();
  });
});
