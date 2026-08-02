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
 * killed-by-signal status. Living in the runner, it covers every caller — the
 * CLI gate verbs, setup's gate probes, accept's re-run, the MCP server —
 * with no per-entry-point wiring to forget.
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
