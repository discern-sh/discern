/** Shared process-signal primitives for every owned subprocess boundary. */

/** Catchable shutdown signals. Windows exposes only SIGINT through Deno. */
export const INTERRUPT_SIGNALS: readonly Deno.Signal[] =
  Deno.build.os === "windows" ? ["SIGINT"] : ["SIGINT", "SIGTERM", "SIGHUP"];

/** Conventional shell exit codes when re-raising a signal cannot terminate. */
export const SIGNAL_EXIT_CODES: Partial<Record<Deno.Signal, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

/** Signal only the process group led by `pid`; return false when it is gone. */
export function signalProcessGroup(
  pid: number,
  signal: Deno.Signal,
): boolean {
  try {
    Deno.kill(-pid, signal);
    return true;
  } catch {
    return false;
  }
}

/** Signal a process group, falling back to its direct child. */
export function killProcessTree(pid: number, signal: Deno.Signal): void {
  if (!signalProcessGroup(pid, signal)) {
    try {
      Deno.kill(pid, signal);
    } catch {
      // The process has already exited.
    }
  }
}

/** Restore conventional killed-by-signal status after owned children settle. */
export function reraiseInterrupt(signal: Deno.Signal): never {
  try {
    Deno.kill(Deno.pid, signal);
  } catch {
    // Unsupported self-signal. Use the conventional 128+n fallback below.
  }
  Deno.exit(SIGNAL_EXIT_CODES[signal] ?? 130);
}
