/** Wait lifecycles shared by capacity acquisition, condition watches, and coordination. */
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import type { ProgressWait } from "../../shared/result_schemas.ts";
import { emitCompletionWait } from "./events.ts";

export type WaitDetails = Pick<
  ProgressWait,
  "kind" | "reason" | "next" | "capacity" | "condition"
>;
export type WaitEndState = Exclude<ProgressWait["state"], "waiting">;
export interface ProgressWaitScope {
  /** Start only after observing a real unmet condition; refresh after later observations. */
  update(details: WaitDetails): void;
  end(state: WaitEndState, reason: string, next: string): void;
}

/** Unchanged observations may refresh a long wait, without a timer or extra polling. */
export const WAIT_NOTICE_INTERVAL_MS = 30_000;

/** The owning operation closes its wait even on interruption or a thrown error. */
export async function withProgressWait<T>(
  operation: (wait: ProgressWaitScope) => Promise<T>,
  options: { readonly clock?: Clock; readonly signal?: AbortSignal } = {},
): Promise<T> {
  const clock = options.clock ?? SYSTEM_CLOCK;
  let current: ProgressWait | undefined;
  let started = 0;
  let lastNotice = 0;
  let previous = "";
  const scope: ProgressWaitScope = {
    update(details): void {
      if (current !== undefined && current.state !== "waiting") return;
      const now = clock.monotonicNow();
      const key = JSON.stringify(details);
      if (
        current !== undefined && key === previous &&
        now - lastNotice < WAIT_NOTICE_INTERVAL_MS
      ) return;
      if (current === undefined) started = now;
      previous = key;
      lastNotice = now;
      current = {
        ...details,
        id: current?.id ?? SYSTEM_SECURE_ENTROPY.uuid(),
        state: "waiting",
        started_at: current?.started_at ?? clock.wallNow(),
        updated_at: clock.wallNow(),
        elapsed_ms: Math.max(0, Math.round(now - started)),
      };
      emitCompletionWait(current);
    },
    end(state, reason, next): void {
      if (current === undefined || current.state !== "waiting") return;
      current = {
        ...current,
        state,
        reason,
        next,
        updated_at: clock.wallNow(),
        finished_at: clock.wallNow(),
        elapsed_ms: Math.max(0, Math.round(clock.monotonicNow() - started)),
      };
      emitCompletionWait(current);
    },
  };
  try {
    const result = await operation(scope);
    if (options.signal?.aborted === true) {
      scope.end(
        "cancelled",
        "Waiting was cancelled.",
        "The operation will not resume automatically.",
      );
    } else {
      scope.end(
        "resumed",
        "Waiting has ended; the operation can continue.",
        "No action is needed.",
      );
    }
    return result;
  } catch (error) {
    scope.end(
      options.signal?.aborted === true ? "cancelled" : "failed",
      "Waiting stopped before the operation could continue.",
      "Follow the operation's reported recovery action.",
    );
    throw error;
  }
}

/** Reading an old or interrupted record never turns its last observation into live work. */
export function readWait(
  wait: ProgressWait,
  now: number,
  live: boolean,
): ProgressWait {
  return wait.state === "waiting" && live
    ? {
      ...wait,
      elapsed_ms: wait.elapsed_ms + Math.max(0, now - wait.updated_at),
    }
    : wait;
}

/** Human-scale duration, retaining seconds through a minutes-long wait. */
export function waitDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  return seconds < 60
    ? `${seconds} s`
    : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** The same current facts and next action reach live output and reconnect readings. */
export function progressWaitSentence(wait: ProgressWait, live = true): string {
  if (wait.state === "waiting" && !live) {
    return `Last recorded wait: ${wait.reason} Wait observed for ${
      waitDuration(wait.elapsed_ms)
    }. Automatic resumption is not confirmed.`;
  }
  const capacity = wait.state === "waiting" && wait.capacity !== undefined
    ? ` At the latest capacity check, ${wait.capacity.in_use} of ${wait.capacity.limit} concurrent ${
      wait.capacity.limit === 1 ? "run was" : "runs were"
    } in progress.`
    : "";
  const elapsed = wait.state === "waiting" ? "Waiting so far" : "Waited";
  if (!live && (wait.state === "resumed" || wait.state === "unavailable")) {
    return `Recorded wait outcome: ${wait.reason} Waited: ${
      waitDuration(wait.elapsed_ms)
    }.`;
  }
  return `${wait.reason}${capacity} ${elapsed}: ${
    waitDuration(wait.elapsed_ms)
  }. ${wait.next}`;
}
