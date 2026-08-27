/** Explicit wall-clock and monotonic-time capabilities. */

/** Read milliseconds from the Unix epoch for records, leases, and expiry. */
export type WallNowFn = () => number;

/** Read monotonic milliseconds for durations that must ignore wall-clock jumps. */
export type MonotonicNowFn = () => number;

/** The two time domains available to host-facing code. */
export interface Clock {
  readonly wallNow: WallNowFn;
  readonly monotonicNow: MonotonicNowFn;
}

/** One direct host-clock operation retained inside the system clock. */
export interface ClockPrimitiveBoundary {
  readonly path: string;
  readonly enclosingFunction: string;
  readonly operation:
    | "Date.now"
    | "Date()"
    | "new Date()"
    | "performance.now";
  readonly reason: string;
}

/** Preserve stable literal ids while checking the registry shape. */
function defineClockPrimitiveBoundaries<
  const Boundaries extends Readonly<Record<string, ClockPrimitiveBoundary>>,
>(boundaries: Boundaries): Boundaries {
  return boundaries;
}

/** Every direct host-clock read; all other code receives this capability. */
export const CLOCK_PRIMITIVE_BOUNDARIES = defineClockPrimitiveBoundaries({
  "system-monotonic-clock-read": {
    path: "src/shared/clock.ts",
    enclosingFunction: "readSystemMonotonicTime",
    operation: "performance.now",
    reason:
      "The system clock adapts the host monotonic source for duration measurements that ignore wall-clock jumps.",
  },
  "system-wall-clock-read": {
    path: "src/shared/clock.ts",
    enclosingFunction: "readSystemWallTime",
    operation: "Date.now",
    reason:
      "The system clock adapts the host wall source for timestamps, expiry, and other civil-time decisions.",
  },
});

/** Adapt the host monotonic clock at the sole direct-read authority. */
function readSystemMonotonicTime(): number {
  return performance.now();
}

/** Adapt the host wall clock at the sole direct-read authority. */
function readSystemWallTime(): number {
  return Date.now();
}

/** Production clock backed by the host wall and monotonic time domains. */
export const SYSTEM_CLOCK: Clock = {
  wallNow: readSystemWallTime,
  monotonicNow: readSystemMonotonicTime,
};

/** Format one injected wall instant without performing another time read. */
export function wallTimeIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}
