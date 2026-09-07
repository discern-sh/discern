/** Explicit callback delivery for tests of timer ownership, independent of host load. */
import { assert } from "@std/assert";
import type { Scheduler, TimeoutHandle } from "../src/shared/scheduler.ts";

export class ManualScheduler implements Scheduler {
  private next = 0;
  readonly pending = new Map<
    TimeoutHandle,
    { readonly callback: () => void; readonly delayMs: number }
  >();

  scheduleTimeout = (callback: () => void, delayMs: number): TimeoutHandle => {
    const handle = ++this.next;
    this.pending.set(handle, { callback, delayMs });
    return handle;
  };
  cancelTimeout = (handle: TimeoutHandle): void => {
    this.pending.delete(handle);
  };
  scheduleInterval = (): never => {
    throw new Error("This fixture owns one-shot timers only");
  };
  cancelInterval = (): never => {
    throw new Error("This fixture owns one-shot timers only");
  };

  /** Deliver one particular deadline, even when the injected clock is far beyond it. */
  fire(delayMs: number): void {
    const entry = [...this.pending].find(([, timer]) =>
      timer.delayMs === delayMs
    );
    assert(entry !== undefined, `expected a pending ${delayMs}ms timer`);
    this.pending.delete(entry[0]);
    entry[1].callback();
  }
}
