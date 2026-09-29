import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  assertCases,
  assertCasesAsync,
  assertNamedCases,
  assertNamedCasesAsync,
} from "./assert_cases.ts";

Deno.test("case matrices run every row and retain each named failure cause", () => {
  const first = new Error("first assertion");
  const last = new Error("last assertion");
  const visited: number[] = [];
  /** Record each row before its chosen assertion failure. */
  const check = (row: number): undefined => {
    visited.push(row);
    if (row === 1) throw first;
    if (row === 3) throw last;
  };
  for (
    const run of [
      () => assertCases([1, 2, 3], (row) => `row ${row}`, check),
      () =>
        assertNamedCases({
          "row 1": () => check(1),
          "row 2": () => check(2),
          "row 3": () => check(3),
        }),
    ]
  ) {
    visited.length = 0;
    const failure = assertThrows(
      run,
      AggregateError,
      "2 of 3 cases failed: row 1; row 3",
    );
    assertEquals(visited, [1, 2, 3]);
    assertEquals(failure.errors.map((error: Error) => error.cause), [
      first,
      last,
    ]);
  }
  assertThrows(
    () => assertCases([], String, () => {}),
    Error,
    "at least one row",
  );
  assertThrows(
    () => assertNamedCases({}),
    Error,
    "at least one row",
  );
  assertCases([1, 2], String, (row) => {
    assertEquals(row > 0, true);
  });
  assertNamedCases({
    positive: () => {
      assertEquals(1 > 0, true);
    },
  });
  const acceptsAsync: (() => Promise<void>) extends
    Parameters<typeof assertNamedCases>[0][string] ? true : false = false;
  assertEquals(acceptsAsync, false);
});

Deno.test("async case matrices await each observation and preserve later failures", async () => {
  const visited: string[] = [];
  const cause = new Error("observation failed");
  /** Mark both sides of an asynchronous observation before it may fail. */
  const check = async (row: number): Promise<void> => {
    visited.push(`start ${row}`);
    await Promise.resolve();
    visited.push(`finish ${row}`);
    if (row !== 2) throw cause;
  };
  for (
    const run of [
      () => assertCasesAsync([1, 2, 3], String, check),
      () =>
        assertNamedCasesAsync({
          "1": () => check(1),
          "2": () => check(2),
          "3": () => check(3),
        }),
    ]
  ) {
    visited.length = 0;
    const failure = await assertRejects(
      run,
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
  }
  await assertRejects(
    () =>
      assertCasesAsync([], String, async () => {
        await Promise.resolve();
      }),
    Error,
    "at least one row",
  );
  await assertRejects(
    () => assertNamedCasesAsync({}),
    Error,
    "at least one row",
  );
  await assertCasesAsync([1], String, async () => {
    await Promise.resolve();
  });
  const mixed: string[] = [];
  await assertNamedCasesAsync({
    synchronous: (): undefined => {
      mixed.push("synchronous");
    },
    asynchronous: async () => {
      await Promise.resolve();
      mixed.push("asynchronous");
    },
  });
  assertEquals(mixed, ["synchronous", "asynchronous"]);
});
