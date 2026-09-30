/** Execution budgets protect real calls without introducing another costly journey. */
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { countedCalls } from "./counted_calls.ts";

Deno.test("call budgets reject repetition before effects and preserve observation boundaries", async () => {
  let effects = 0;
  const calls = countedCalls((value: number): Promise<number> => {
    effects++;
    return Promise.resolve(value);
  });
  const alias = calls.run;
  await assertRejects(
    () =>
      calls.expectCalls(1, async () => {
        assertEquals(await alias(7), 7);
        await alias(8);
      }),
    Error,
    "extra execution",
  );
  assertEquals(effects, 1);
  await assertRejects(
    () =>
      calls.expectCalls(0, async () => {
        await alias(9);
      }),
    Error,
    "extra execution",
  );
  assertEquals(effects, 1);
  await assertRejects(
    () => calls.expectCalls(1, async () => {}),
    Error,
    "every required call",
  );
  const failure = new Error("body failed");
  assertStrictEquals(
    await assertRejects(() =>
      calls.expectCalls(1, () => Promise.reject(failure))
    ),
    failure,
  );
  // Both observations remain open together; neither inherits the other's calls.
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await Promise.all([
    calls.expectCalls(1, async () => {
      await barrier;
      await alias(1);
    }),
    calls.expectCalls(2, async () => {
      await alias(2);
      release?.();
      await alias(3);
    }),
  ]);
  await calls.expectCalls(2, async () => {
    await calls.expectCalls(1, async () => {
      await alias(4);
    });
    await alias(5);
  });
  await calls.expectCalls(1, async () => {
    await assertRejects(
      () =>
        calls.expectCalls(0, async () => {
          await alias(11);
        }),
      Error,
      "extra execution",
    );
    await alias(12);
  });
  let requested = 0;
  await calls.expectCalls(() => requested, async () => {
    requested++;
    await alias(6);
    requested++;
    await alias(7);
  });
  // Leaving a scope restores unrestricted calls, including after failures.
  await alias(10);
  assertEquals(effects, 10);
});
