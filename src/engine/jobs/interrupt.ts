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

/** The interrupts that must reach in-flight gate jobs. SIGINT is the terminal's
 * Ctrl-C; SIGTERM the polite kill (a supervisor, an MCP client shutting the
 * server down); SIGHUP the controlling terminal closing. Windows supports only
 * SIGINT of these in Deno. */
export const INTERRUPT_SIGNALS: readonly Deno.Signal[] =
  Deno.build.os === "windows" ? ["SIGINT"] : ["SIGINT", "SIGTERM", "SIGHUP"];

/** Conventional 128+n exit codes, the fallback when re-raising is unsupported (a
 * self-signal that doesn't terminate — e.g. Windows, or under load once the
 * listener is torn down). Exported so the interrupt E2E asserts against the SAME
 * codes the fallback uses, rather than a hand-copied list. */
export const SIGNAL_EXIT_CODES: Partial<Record<Deno.Signal, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

const active = new Set<AbortController>();
const installed = new Map<Deno.Signal, () => void>();
let received: Deno.Signal | null = null;

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

function uninstall(): void {
  for (const [sig, handler] of installed) {
    Deno.removeSignalListener(sig, handler);
  }
  installed.clear();
}

/** Die the way the interrupt asked: re-raise with the default disposition
 * restored (correct WIFSIGNALED status), falling back to exit 128+n. */
function reraise(sig: Deno.Signal): never {
  try {
    Deno.kill(Deno.pid, sig);
  } catch {
    // Unsupported self-signal (e.g. Windows) — fall through to the exit code.
  }
  Deno.exit(SIGNAL_EXIT_CODES[sig] ?? 130);
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
      reraise(sig);
    }
  };
}
