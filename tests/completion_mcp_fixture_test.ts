import { assertEquals, assertRejects } from "@std/assert";
import { CompletionMcpPeer } from "./completion_mcp_fixture.ts";
import { ManualScheduler } from "./manual_scheduler.ts";
import { settlePending, TEST_PROCESS_TIMEOUT_MS } from "./waiting.ts";

Deno.test("MCP peer shutdown allows ordinary process settlement and still bounds a stuck server", async () => {
  for (const completes of [true, false]) {
    const status = Promise.withResolvers<Deno.CommandStatus>();
    const firstTurn = Promise.withResolvers<void>();
    const nextTurn = Promise.withResolvers<void>();
    const scheduler = new ManualScheduler();
    const schedule = scheduler.scheduleTimeout;
    let turns = 0;
    scheduler.scheduleTimeout = (callback, delayMs) => {
      const handle = schedule(callback, delayMs);
      (turns++ === 0 ? firstTurn : nextTurn).resolve();
      return handle;
    };
    let now = 0;
    const clock = { wallNow: () => now, monotonicNow: () => now };
    const signals: Deno.Signal[] = [];
    const peer = new CompletionMcpPeer(
      {
        stdin: new WritableStream<Uint8Array>(),
        stdout: new ReadableStream<Uint8Array<ArrayBuffer>>({
          start: (controller) => controller.close(),
        }),
        stderr: new ReadableStream<Uint8Array<ArrayBuffer>>({
          start: (controller) => controller.close(),
        }),
        status: status.promise,
        kill: (signal = "SIGTERM") => {
          signals.push(signal);
          status.resolve({ success: false, code: 143, signal });
        },
      },
      (pending, description, options) =>
        settlePending(pending, description, { ...options, clock, scheduler }),
    );
    const closing = peer[Symbol.asyncDispose]();
    let completed = false;
    const outcome = closing.then(() => "closed", () => "failed").finally(() => {
      completed = true;
    });
    await firstTurn.promise;
    now = completes ? TEST_PROCESS_TIMEOUT_MS / 2 : TEST_PROCESS_TIMEOUT_MS;
    scheduler.fire(10);
    if (completes) {
      assertEquals(
        await Promise.race([nextTurn.promise.then(() => "waiting"), outcome]),
        "waiting",
      );
      assertEquals(signals, []);
      status.resolve({ success: true, code: 0, signal: null });
      now += 10;
      scheduler.fire(10);
      for (let turn = 0; turn < 100 && !completed; turn++) {
        await Promise.resolve();
        if (scheduler.pending.size > 0) scheduler.fire(10);
      }
      assertEquals(completed, true);
      await closing;
      assertEquals(signals, []);
    } else {
      for (let turn = 0; turn < 100 && !completed; turn++) {
        await Promise.resolve();
        if (scheduler.pending.size > 0) scheduler.fire(10);
      }
      assertEquals(completed, true);
      await assertRejects(() => closing, Error, "timed out waiting");
      assertEquals(signals, ["SIGKILL"]);
    }
    assertEquals(scheduler.pending.size, 0);
  }
});

Deno.test("MCP teardown bounds blocked input, inherited output, and an unresponsive killed peer", async () => {
  for (const blocked of ["input", "output", "status"] as const) {
    const status = Promise.withResolvers<Deno.CommandStatus>();
    const closingInput = Promise.withResolvers<void>();
    const entered = Promise.withResolvers<void>();
    const timedOut = Promise.withResolvers<never>();
    const signals: Deno.Signal[] = [];
    const budgets: number[] = [];
    const peer = new CompletionMcpPeer({
      stdin: new WritableStream<Uint8Array>({
        close: () => blocked === "input" ? closingInput.promise : undefined,
      }),
      stdout: new ReadableStream<Uint8Array<ArrayBuffer>>({
        start: (controller) => {
          if (blocked !== "output") controller.close();
        },
      }),
      stderr: new ReadableStream<Uint8Array<ArrayBuffer>>({
        start: (controller) => controller.close(),
      }),
      status: status.promise,
      kill: (signal = "SIGTERM") => {
        signals.push(signal);
        if (blocked !== "status") {
          status.resolve({ success: false, code: 137, signal });
        }
      },
    }, async (pending, _description, options) => {
      budgets.push(options.timeoutMs ?? 0);
      if (budgets.length === 1) {
        entered.resolve();
        return await Promise.race([pending, timedOut.promise]);
      }
      // A stuck OS or stream is a second bounded failure, never an endless await.
      throw new Error("forced cleanup expired");
    });
    if (blocked !== "status") {
      status.resolve({ success: true, code: 0, signal: null });
    }
    const closing = peer[Symbol.asyncDispose]();
    const rejected = assertRejects(
      () => closing,
      AggregateError,
      "forced cleanup failed",
    );
    await entered.promise;
    timedOut.reject(new Error("fixture allowance expired"));
    await rejected;
    assertEquals(signals, ["SIGKILL"]);
    assertEquals(budgets, [TEST_PROCESS_TIMEOUT_MS, 1_000]);
    closingInput.resolve();
    status.resolve({ success: false, code: 137, signal: "SIGKILL" });
  }
});
