/**
 * Process-wide interrupt watcher for gate runs — the piece that makes Ctrl-C /
 * SIGTERM actually stop the gate.
 *
 * Gate jobs are spawned `detached` so the runner can tree-kill their whole
 * process groups — but that same detachment removes the free signal delivery a
 * foreground child would get: the terminal's SIGINT goes to discern's process
 * group, never to the jobs'. Without this watcher, interrupting discern
 * mid-gate orphans every in-flight job (still burning CPU, still racing the
 * next run over shared build state).
 *
 * The watcher installs signal listeners only while at least one stage run is
 * in flight (refcounted): on an interrupt it aborts every active run's
 * controller — tree-killing the detached job groups — and, once the last run
 * has settled and reaped its children, re-raises the signal with the default
 * disposition restored, so the process dies with the conventional
 * killed-by-signal status. Stage runners own their child lifetime; native
 * completion owns the wider checkout lifetime through source return and
 * durable settlement. Nested owners share this same watcher.
 */

import { INTERRUPT_SIGNALS, reraiseInterrupt } from "../process_signals.ts";

export { INTERRUPT_SIGNALS, SIGNAL_EXIT_CODES } from "../process_signals.ts";

const active = new Set<AbortController>();
const installed = new Map<Deno.Signal, () => void>();
let received: Deno.Signal | null = null;

/** Install process-level signal handlers that fan cancellation into active jobs. */
function install(): void {
  if (installed.size > 0) {
    return;
  }
  for (const sig of INTERRUPT_SIGNALS) {
    const handler = (): void => {
      received = sig;
      for (const run of active) {
        run.abort();
      }
    };
    Deno.addSignalListener(sig, handler);
    installed.set(sig, handler);
  }
}

/** Remove shared signal handlers once no runner needs interruption fan-out. */
function uninstall(): void {
  for (const [sig, handler] of installed) {
    Deno.removeSignalListener(sig, handler);
  }
  installed.clear();
}

/**
 * Register a stage run's controller with the watcher for the run's lifetime.
 * Call the returned release once the run has settled (children reaped, results
 * rendered); if an interrupt arrived meanwhile, the release of the LAST active
 * run re-raises it — i.e. the process finishes reporting what was cancelled,
 * then dies with the signal's conventional status.
 */
export function trackRun(controller: AbortController): () => void {
  active.add(controller);
  install();
  return (): void => {
    active.delete(controller);
    if (active.size > 0) {
      return;
    }
    uninstall();
    const sig = received;
    received = null;
    if (sig !== null) {
      reraiseInterrupt(sig);
    }
  };
}

/** One locally owned cancellation controller registered with the process-wide
 * interrupt authority and optionally chained to an external caller signal. */
export interface TrackedRun {
  readonly signal: AbortSignal;
  /** Detach external input, then release OS-signal tracking. May re-raise a
   * pending signal, so callers run their own cleanup before this call. */
  release(): void;
}

/** Begin one locally controlled run, chaining optional external cancellation. */
export function beginTrackedRun(external?: AbortSignal): TrackedRun {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  if (external?.aborted) {
    onAbort();
  } else {
    external?.addEventListener("abort", onAbort, { once: true });
  }
  const releaseRun = trackRun(controller);
  return {
    signal: controller.signal,
    release: (): void => {
      external?.removeEventListener("abort", onAbort);
      releaseRun();
    },
  };
}

/** Keep signal ownership until the caller has settled its children and durable state. */
export async function withTrackedRun<T>(
  external: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const tracked = beginTrackedRun(external);
  try {
    return await operation(tracked.signal);
  } finally {
    tracked.release();
  }
}
