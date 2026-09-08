/** Child receipts do not recursively enroll their own publication work. */
import { assert, assertEquals } from "@std/assert";
import {
  planExecutionChild,
  withExecutionChildren,
} from "../src/shared/execution_child_context.ts";

Deno.test("child receipt callbacks exclude themselves while preserving concurrent observers", async () => {
  await Promise.all(["first", "second"].map(async (name) => {
    const calls: string[] = [];
    let planning = false;
    await withExecutionChildren({
      planned: async () => {
        assert(!planning, "receipt publication must not enroll another child");
        planning = true;
        assertEquals(await planExecutionChild(), undefined);
        planning = false;
        calls.push(name + ":planned");
        return {
          started: async (pid, isolated) => {
            assertEquals([pid, isolated], [7, true]);
            assertEquals(await planExecutionChild(), undefined);
            calls.push(name + ":started");
          },
          settled: async () => {
            assertEquals(await planExecutionChild(), undefined);
            calls.push(name + ":settled");
          },
        };
      },
    }, async () => {
      for (let child = 0; child < 2; child++) {
        const ticket = await planExecutionChild();
        assert(ticket !== undefined);
        await ticket.started(7, true);
        await ticket.settled();
      }
    });
    assertEquals(
      calls,
      ["planned", "started", "settled", "planned", "started", "settled"].map((
        phase,
      ) => name + ":" + phase),
    );
  }));
  assertEquals(await planExecutionChild(), undefined);
});
