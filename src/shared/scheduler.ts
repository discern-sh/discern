/** Explicit timer scheduling, cancellation, and non-security jitter capabilities. */

/** A host timeout token, paired only with timeout cancellation. */
export type TimeoutHandle =
  | number
  | ReturnType<typeof globalThis.setTimeout>;

/** A host interval token, paired only with interval cancellation. */
export type IntervalHandle =
  | number
  | ReturnType<typeof globalThis.setInterval>;

/** Own callback scheduling and cancellation as one lifecycle capability. */
export interface Scheduler {
  readonly scheduleTimeout: (
    callback: () => void,
    delayMs: number,
  ) => TimeoutHandle;
  readonly cancelTimeout: (handle: TimeoutHandle) => void;
  readonly scheduleInterval: (
    callback: () => void,
    intervalMs: number,
  ) => IntervalHandle;
  readonly cancelInterval: (handle: IntervalHandle) => void;
}

/** Select a non-security scheduling delay around one base interval. */
export type JitterFn = (delayMs: number) => number;

/** One direct host scheduler operation retained inside the system scheduler. */
export interface SchedulerPrimitiveBoundary {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly operation:
    | "clearInterval"
    | "clearTimeout"
    | "setInterval"
    | "setTimeout";
  readonly reason: string;
}

/** One direct pseudorandom read retained for non-security scheduling jitter. */
export interface JitterPrimitiveBoundary {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly operation: "Math.random";
  readonly reason: string;
}

/** Preserve stable literal ids while checking the scheduler registry shape. */
function defineSchedulerPrimitiveBoundaries<
  const Boundaries extends Readonly<Record<string, SchedulerPrimitiveBoundary>>,
>(boundaries: Boundaries): Boundaries {
  return boundaries;
}

/** Preserve stable literal ids while checking the jitter registry shape. */
function defineJitterPrimitiveBoundaries<
  const Boundaries extends Readonly<Record<string, JitterPrimitiveBoundary>>,
>(boundaries: Boundaries): Boundaries {
  return boundaries;
}

/** Every direct host timer operation; all other code receives a scheduler. */
export const SCHEDULER_PRIMITIVE_BOUNDARIES =
  defineSchedulerPrimitiveBoundaries({
    "browser-system-interval-cancel": {
      path: "site/pages/assets/scheduler.js",
      enclosingFunction: "cancelBrowserInterval",
      operation: "clearInterval",
      reason:
        "The browser system scheduler adapts host interval cancellation for explicitly owned repeating UI callbacks.",
    },
    "browser-system-interval-schedule": {
      path: "site/pages/assets/scheduler.js",
      enclosingFunction: "scheduleBrowserInterval",
      operation: "setInterval",
      reason:
        "The browser system scheduler adapts host interval scheduling for explicitly owned repeating UI callbacks.",
    },
    "browser-system-timeout-cancel": {
      path: "site/pages/assets/scheduler.js",
      enclosingFunction: "cancelBrowserTimeout",
      operation: "clearTimeout",
      reason:
        "The browser system scheduler adapts host timeout cancellation for explicitly owned one-shot UI callbacks.",
    },
    "browser-system-timeout-schedule": {
      path: "site/pages/assets/scheduler.js",
      enclosingFunction: "scheduleBrowserTimeout",
      operation: "setTimeout",
      reason:
        "The browser system scheduler adapts host timeout scheduling for explicitly owned one-shot UI callbacks.",
    },
    "system-interval-cancel": {
      path: "src/shared/scheduler.ts",
      enclosingFunction: "cancelSystemInterval",
      operation: "clearInterval",
      reason:
        "The system scheduler adapts host interval cancellation for explicitly owned repeating callbacks.",
    },
    "system-interval-schedule": {
      path: "src/shared/scheduler.ts",
      enclosingFunction: "scheduleSystemInterval",
      operation: "setInterval",
      reason:
        "The system scheduler adapts host interval scheduling for explicitly owned repeating callbacks.",
    },
    "system-timeout-cancel": {
      path: "src/shared/scheduler.ts",
      enclosingFunction: "cancelSystemTimeout",
      operation: "clearTimeout",
      reason:
        "The system scheduler adapts host timeout cancellation for explicitly owned one-shot callbacks.",
    },
    "system-timeout-schedule": {
      path: "src/shared/scheduler.ts",
      enclosingFunction: "scheduleSystemTimeout",
      operation: "setTimeout",
      reason:
        "The system scheduler adapts host timeout scheduling for explicitly owned one-shot callbacks.",
    },
  });

/** The sole direct pseudorandom read used for non-security scheduling jitter. */
export const JITTER_PRIMITIVE_BOUNDARIES = defineJitterPrimitiveBoundaries({
  "system-scheduling-jitter-read": {
    path: "src/shared/scheduler.ts",
    enclosingFunction: "systemSchedulingJitter",
    operation: "Math.random",
    reason:
      "The system jitter samples a bounded retry delay; it is not an entropy source for identifiers, keys, or uniqueness.",
  },
});

/** Schedule one host interval at the sole direct scheduling authority. */
function scheduleSystemInterval(
  callback: () => void,
  intervalMs: number,
): IntervalHandle {
  return globalThis.setInterval(callback, intervalMs);
}

/** Cancel one host interval at the sole direct cancellation authority. */
function cancelSystemInterval(handle: IntervalHandle): void {
  globalThis.clearInterval(handle);
}

/** Schedule one host timeout at the sole direct scheduling authority. */
function scheduleSystemTimeout(
  callback: () => void,
  delayMs: number,
): TimeoutHandle {
  return globalThis.setTimeout(callback, delayMs);
}

/** Cancel one host timeout at the sole direct cancellation authority. */
function cancelSystemTimeout(handle: TimeoutHandle): void {
  globalThis.clearTimeout(handle);
}

/** Production scheduler backed by the host timer APIs. */
export const SYSTEM_SCHEDULER: Scheduler = {
  scheduleTimeout: scheduleSystemTimeout,
  cancelTimeout: cancelSystemTimeout,
  scheduleInterval: scheduleSystemInterval,
  cancelInterval: cancelSystemInterval,
};

/**
 * Apply the fleet-slot retry policy to a supplied unit-interval sample.
 * This is scheduling variation only, never secure entropy.
 */
export function schedulingJitterDelay(
  delayMs: number,
  unitIntervalSample: number,
): number {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError("jitter delay must be a finite non-negative number");
  }
  if (
    !Number.isFinite(unitIntervalSample) || unitIntervalSample < 0 ||
    unitIntervalSample > 1
  ) {
    throw new RangeError("jitter sample must be in the closed unit interval");
  }
  return delayMs * (0.75 + unitIntervalSample * 0.5);
}

/** Sample the production non-security jitter source. */
function systemSchedulingJitter(delayMs: number): number {
  return schedulingJitterDelay(delayMs, Math.random());
}

/** Production scheduling jitter, deliberately separate from secure entropy. */
export const SYSTEM_JITTER: JitterFn = systemSchedulingJitter;
