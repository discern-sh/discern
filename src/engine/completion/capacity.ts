/** Wait only for enforcing observations that identify a live release condition. */
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import type { CompletionBlocker } from "./protocol.ts";
import { type Scheduler, SYSTEM_SCHEDULER } from "../../shared/scheduler.ts";

/** One cancellable observation interval, always disposed before returning. */
async function capacityWake(
  signal: AbortSignal,
  scheduler: Scheduler,
): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      scheduler.cancelTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = scheduler.scheduleTimeout(finish, 100);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** No lock or reservation is acquired here. Every wake re-reads enforcing state. */
export async function waitForCompletionCapacity<T>(input: {
  readonly observe: () => Promise<T | CompletionBlocker>;
  readonly waiting: (value: T | CompletionBlocker) => boolean;
  readonly signal: AbortSignal;
  readonly scheduler?: Scheduler;
  readonly clock?: Clock;
  readonly onWaited?: (
    interval: { started_at: number; finished_at: number },
  ) => void;
  readonly onWait?: (value: T | CompletionBlocker) => void;
}): Promise<T | CompletionBlocker> {
  const scheduler = input.scheduler ?? SYSTEM_SCHEDULER;
  const clock = input.clock ?? SYSTEM_CLOCK;
  let started: number | undefined;
  let last: string | undefined;
  try {
    while (!input.signal.aborted) {
      const result = await input.observe();
      if (!input.waiting(result)) return result;
      started ??= clock.wallNow();
      const signature = JSON.stringify(result);
      if (signature !== last) input.onWait?.(result);
      last = signature;
      await capacityWake(input.signal, scheduler);
    }
    return {
      kind: "cancelled",
      reason:
        "Completion capacity wait was cancelled; no waiting actor acquired execution or landing authority.",
    };
  } finally {
    const finished = clock.wallNow();
    input.onWaited?.({
      started_at: started ?? finished,
      finished_at: finished,
    });
  }
}
