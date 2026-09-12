/** A fresh runtime fixes coldness and callback order independently of the suite seed. */
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { loadModule } from "../../../src/shared/module_loading.ts";
import {
  currentOperationLocks,
  runWithOperationLocks,
} from "../../../src/shared/operation_lock_context.ts";
import {
  emitCompletionProgress,
  withCompletionObserver,
} from "../../../src/engine/completion/events.ts";
import { caller, state } from "./state.ts";

Deno.test("cold modules belong to the process and continuations retain their own capabilities", async () => {
  await Promise.all(["left", "right"].map(async (owner) => {
    const held = {
      leases: new Map(),
      boundaries: new Set<"checkout">(),
      completionExecution: true,
    };
    let observed = 0;
    await caller.run(
      owner,
      () =>
        runWithOperationLocks(held, () =>
          withCompletionObserver(() => {
            observed++;
          }, async () => {
            const cold = await loadModule(() => import("./probe.ts"));
            const warm = await loadModule(() => import("./probe.ts"));
            assertStrictEquals(cold, warm);
            assertEquals(cold.value, 43);
            await assertRejects(
              () => loadModule(() => import("./rejected.ts")),
              Error,
              "Module evaluation rejected",
            );
            assertStrictEquals(currentOperationLocks(), held);
            assertEquals(caller.getStore(), owner);
            assertEquals(observed, 0);
            emitCompletionProgress({
              phase: "pending",
              state: "caller",
              candidate_id: null,
              reason: owner,
            });
          })),
    );
    assertEquals(observed, 1);
  }));
  assertEquals(state.evaluations, 1);
});

Deno.test("an unrelated callback has no completed invocation context", () => {
  assertEquals(currentOperationLocks(), undefined);
  assertEquals(caller.getStore(), undefined);
});
