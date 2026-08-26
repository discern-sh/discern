/** Shared process-signal primitives for every owned subprocess boundary. */

import { signalProcessGroup } from "../shared/process_group.ts";
import { bestEffortSync } from "../shared/best_effort.ts";
export {
  OWNED_DESCENDANT_GRACE_MS,
  quiesceProcessGroup,
  signalProcessGroup,
} from "../shared/process_group.ts";

/** Catchable shutdown signals. Windows exposes only SIGINT through Deno. */
export const INTERRUPT_SIGNALS: readonly Deno.Signal[] =
  Deno.build.os === "windows" ? ["SIGINT"] : ["SIGINT", "SIGTERM", "SIGHUP"];

/** Conventional shell exit codes when re-raising a signal cannot terminate. */
export const SIGNAL_EXIT_CODES: Partial<Record<Deno.Signal, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

/** How long an interrupted child may honor the graceful signal before the
 * owning boundary escalates to SIGKILL. */
export const KILL_GRACE_MS = 2_000;

/**
 * How long after a kill the drains of a killed child's pipes may keep waiting
 * for EOF before pending reads are cancelled. Longer than the SIGTERM→SIGKILL
 * escalation ({@link KILL_GRACE_MS}), so a child that catches SIGTERM and exits
 * slowly still flushes its output and closes its pipes naturally; only a pipe
 * held by a process the tree-kill cannot reach — a descendant that re-parented
 * into its own session (a self-daemonizing tool) — is clipped. Without this
 * bound, such an escapee keeps the write ends open and a drain-to-EOF would
 * block for the daemon's whole lifetime.
 */
export const KILLED_PIPE_GRACE_MS = 2_500;

/** Signal a process group, falling back to its direct child. */
export function killProcessTree(pid: number, signal: Deno.Signal): void {
  if (!signalProcessGroup(pid, signal)) {
    bestEffortSync("process-tree-direct-signal", () => Deno.kill(pid, signal));
  }
}

/** Restore conventional killed-by-signal status after owned children settle. */
export function reraiseInterrupt(signal: Deno.Signal): never {
  bestEffortSync("process-self-signal", () => Deno.kill(Deno.pid, signal));
  Deno.exit(SIGNAL_EXIT_CODES[signal] ?? 130);
}
