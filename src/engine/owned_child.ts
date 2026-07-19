/**
 * The single inherited-terminal subprocess boundary.
 *
 * Foreground children stay in discern's terminal process group so prompts and
 * terminal-generated signals keep their normal behavior. Off a terminal, the
 * child leads a process group that discern can stop as one tree. Scoped signal
 * listeners keep the wrapper alive until the child has settled and been reaped.
 */

import {
  INTERRUPT_SIGNALS,
  killProcessTree,
  reraiseInterrupt,
  signalProcessGroup,
} from "./process_signals.ts";

const KILL_GRACE_MS = 2_000;

export interface OwnedChildOptions {
  /** Arguments passed to the executable without a shell. */
  readonly args?: readonly string[];
  /** Child working directory. */
  readonly cwd?: string;
  /** Environment values added to the inherited environment. */
  readonly env?: Record<string, string>;
  /** Keep this process alive after an interrupt once the child is reaped. */
  readonly resumeAfterInterrupt?: boolean;
}

export interface OwnedChildResult {
  readonly status: Deno.CommandStatus;
  readonly interruptedBy: Deno.Signal | null;
}

function signalDirectChild(
  child: Deno.ChildProcess,
  signal: Deno.Signal,
): void {
  try {
    child.kill(signal);
  } catch {
    // The direct child has already exited.
  }
}

/** Run arbitrary user code with inherited terminal streams and owned cleanup. */
export async function runOwnedChild(
  command: string,
  opts: OwnedChildOptions = {},
): Promise<OwnedChildResult> {
  // A detached POSIX child leads a process group, which makes descendants
  // reachable through a negative PID. An interactive child must remain in the
  // terminal's foreground group or terminal reads can suspend it with SIGTTIN.
  const isolatedGroup = Deno.build.os !== "windows" &&
    !Deno.stdin.isTerminal();
  let child: Deno.ChildProcess | undefined;
  let interruptedBy: Deno.Signal | null = null;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const signalChild = (signal: Deno.Signal): void => {
    const runningChild = child;
    if (runningChild === undefined) return;
    if (isolatedGroup) {
      killProcessTree(runningChild.pid, signal);
    } else {
      // A terminal-generated signal already reached the foreground child.
      // Forwarding also covers a supervisor that targeted discern's PID only.
      signalDirectChild(runningChild, signal);
    }
  };
  const handlers = new Map<Deno.Signal, () => void>();
  for (const signal of INTERRUPT_SIGNALS) {
    const handler = (): void => {
      interruptedBy ??= signal;
      signalChild(signal);
      killTimer ??= setTimeout(() => {
        signalChild("SIGKILL");
      }, KILL_GRACE_MS);
    };
    Deno.addSignalListener(signal, handler);
    handlers.set(signal, handler);
  }

  let status: Deno.CommandStatus;
  try {
    child = new Deno.Command(command, {
      args: [...(opts.args ?? [])],
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
      ...(opts.env === undefined ? {} : { env: opts.env }),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      detached: isolatedGroup,
    }).spawn();
    if (interruptedBy !== null) signalChild(interruptedBy);
    status = await child.status;
  } finally {
    if (killTimer !== undefined) clearTimeout(killTimer);
    // A non-interactive shell can exit from SIGINT while a background child
    // remains in the group with SIGINT ignored. The leader is reaped now, so
    // no cooperative cleanup remains to wait for; remove any group survivors.
    if (isolatedGroup && interruptedBy !== null && child !== undefined) {
      signalProcessGroup(child.pid, "SIGKILL");
    }
    for (const [signal, handler] of handlers) {
      Deno.removeSignalListener(signal, handler);
    }
  }

  if (interruptedBy !== null && !(opts.resumeAfterInterrupt ?? false)) {
    reraiseInterrupt(interruptedBy);
  }
  return { status, interruptedBy };
}
