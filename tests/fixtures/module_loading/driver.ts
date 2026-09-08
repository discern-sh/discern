/** A fresh runtime fixes coldness and callback order independently of the suite seed. */
import { assert, assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { loadModule } from "../../../src/shared/module_loading.ts";
import {
  currentOperationLocks,
  runWithOperationLocks,
} from "../../../src/shared/operation_lock_context.ts";
import {
  planExecutionChild,
  withExecutionChildren,
} from "../../../src/shared/execution_child_context.ts";
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
    let planned = 0;
    let observed = 0;
    const delivered: unknown[] = [];
    const ticket = {
      started: async (pid: number, isolated: boolean) => {
        assertEquals(caller.getStore(), owner);
        assertEquals(await planExecutionChild(), undefined);
        delivered.push(["started", pid, isolated]);
      },
      settled: async () => {
        assertEquals(caller.getStore(), owner);
        assertEquals(await planExecutionChild(), undefined);
        delivered.push(["settled"]);
      },
    };
    await caller.run(
      owner,
      () =>
        runWithOperationLocks(held, () =>
          withExecutionChildren({
            planned: () => {
              planned++;
              return Promise.resolve(ticket);
            },
          }, () =>
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
              assertEquals(planned, 0);
              assertEquals(observed, 0);
              const child = await planExecutionChild();
              assert(child !== undefined);
              await child.started(42, true);
              await child.settled();
              emitCompletionProgress({
                phase: "pending",
                state: "caller",
                candidate_id: null,
                reason: owner,
              });
            }))),
    );
    assertEquals(planned, 1);
    assertEquals(observed, 1);
    assertEquals(delivered, [["started", 42, true], ["settled"]]);
  }));
  assertEquals(state.evaluations, 1);
});

Deno.test("an unrelated callback has no completed invocation context", async () => {
  assertEquals(currentOperationLocks(), undefined);
  assertEquals(caller.getStore(), undefined);
  assertEquals(await planExecutionChild(), undefined);
});
