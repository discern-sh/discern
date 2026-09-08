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
    const outcome = closing.then(() => "closed", () => "failed");
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
      await closing;
      assertEquals(signals, []);
    } else {
      await assertRejects(() => closing, Error, "timed out waiting");
      assertEquals(signals, ["SIGTERM"]);
    }
    assertEquals(scheduler.pending.size, 0);
  }
});
