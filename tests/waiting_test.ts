import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { FakeTime } from "@std/testing/time";
import { realDelay, waitUntil } from "./waiting.ts";

Deno.test("waitUntil succeeds without scheduling when the condition is immediate", async () => {
  let calls = 0;
  await waitUntil(() => {
    calls++;
    return true;
  }, "the immediate condition");
  assertEquals(calls, 1);
});

Deno.test("waitUntil progresses an eventual condition through fake scheduler time", async () => {
  using time = new FakeTime(1_000);
  const readyAt = Date.now() + 25;
  const pending = waitUntil(
    () => Date.now() >= readyAt,
    "the fake-time condition",
    { timeoutMs: 100, intervalMs: 10 },
  );
  await time.tickAsync(30);
  await pending;
});

Deno.test("waitUntil timeout names the condition and bounded timing evidence", async () => {
  using time = new FakeTime(2_000);
  const pending = assertRejects(
    () =>
      waitUntil(() => false, "the missing marker", {
        timeoutMs: 25,
        intervalMs: 10,
      }),
    Error,
  );
  await time.tickAsync(25);
  const error = await pending;
  assertStringIncludes(error.message, "the missing marker");
  assertStringIncludes(error.message, "budget 25ms");
  assertStringIncludes(error.message, "interval 10ms");
  assertStringIncludes(error.message, "attempts)");
});

Deno.test("waitUntil reports a thrown condition with its original cause", async () => {
  const cause = new Error("probe failed");
  const error = await assertRejects(
    () =>
      waitUntil(() => {
        throw cause;
      }, "the fallible probe"),
    Error,
    "condition 'the fallible probe' threw on attempt 1 after 0ms",
  );
  assertEquals(error.cause, cause);
});

Deno.test("realDelay follows the test scheduler without spending wall time", async () => {
  using time = new FakeTime(3_000);
  let settled = false;
  const pending = realDelay("waiting-real-delay-fake-time", 25).then(() => {
    settled = true;
  });
  await time.tickAsync(24);
  assertEquals(settled, false);
  await time.tickAsync(1);
  await pending;
  assertEquals(settled, true);
});
