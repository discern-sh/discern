/**
 * The owned-child supervision boundary.
 *
 * {@link superviseSpawn} is the one interrupt lifecycle for a potentially
 * long-running child: scoped signal listeners for the child's lifetime, a
 * graceful signal to the child (its whole process group when it leads one),
 * SIGKILL escalation after a grace period, a group sweep once the leader is
 * reaped, and a re-raise so the engine dies with the conventional
 * killed-by-signal status. A signal delivered to the engine's PID therefore
 * stops and reaps the child's whole tree instead of orphaning it.
 *
 * {@link runOwnedChild} is its inherited-terminal caller: foreground children
 * stay in discern's terminal process group so interactions and terminal-generated
 * signals keep their normal behavior; off a terminal, the child leads a process
 * group that discern can stop as one tree. The logger-routed setup runner
 * (worktree/shell.ts) supervises its piped children through the same core.
 */

import {
  INTERRUPT_SIGNALS,
  KILL_GRACE_MS,
  killProcessTree,
  reraiseInterrupt,
  signalProcessGroup,
} from "./process_signals.ts";

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

/** Options for {@link superviseSpawn}. */
export interface SuperviseOptions {
  /**
   * The child is spawned `detached`, leading its own POSIX process group, so an
   * interrupt is delivered to — and swept from — its whole tree. False for an
   * interactive child, which must remain in the terminal's foreground group or
   * terminal reads can suspend it with SIGTTIN; there the terminal has already
   * delivered its signal to the foreground group, and the boundary only
   * forwards to the direct child (covering a supervisor that targeted
   * discern's PID alone).
   */
  readonly isolatedGroup: boolean;
  /** Keep this process alive after an interrupt once the child is reaped. */
  readonly resumeAfterInterrupt?: boolean;
}

/** A settled supervised run: what `settle` returned, and the interrupt (if any). */
export interface SupervisedRun<T> {
  readonly value: T;
  readonly interruptedBy: Deno.Signal | null;
}

/** Forward cancellation to the spawned process while tolerating an exited child. */
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

/**
 * Spawn a child and own its interrupt lifecycle until it has settled.
 *
 * `spawn` must create the child consistently with `isolatedGroup` (pass
 * `detached: isolatedGroup` to `Deno.Command`); `settle` drains whatever the
 * caller piped and reaps the child (awaits its status). `settle`'s
 * `interrupted` signal aborts the moment an interrupt arrives, so a caller
 * draining pipes can bound its wait for EOF — after the group is killed, only
 * a descendant that escaped into its own session can still hold the write
 * ends open.
 *
 * On an interrupt: the child (or its whole group) receives the same signal,
 * SIGKILL follows after {@link KILL_GRACE_MS} if it lingers, group survivors
 * are swept once the leader is reaped, and — unless `resumeAfterInterrupt` —
 * the signal is re-raised so this process dies with the conventional
 * killed-by-signal status.
 */
export async function superviseSpawn<T>(
  spawn: () => Deno.ChildProcess,
  settle: (child: Deno.ChildProcess, interrupted: AbortSignal) => Promise<T>,
  opts: SuperviseOptions,
): Promise<SupervisedRun<T>> {
  let child: Deno.ChildProcess | undefined;
  let interruptedBy: Deno.Signal | null = null;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const interruptController = new AbortController();
  const signalChild = (signal: Deno.Signal): void => {
    const runningChild = child;
    if (runningChild === undefined) return;
    if (opts.isolatedGroup) {
      killProcessTree(runningChild.pid, signal);
    } else {
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
      interruptController.abort();
    };
    Deno.addSignalListener(signal, handler);
    handlers.set(signal, handler);
  }

  let value: T;
  try {
    child = spawn();
    // A signal that arrived between listener install and the spawn found no
    // child to hit — deliver it now.
    if (interruptedBy !== null) signalChild(interruptedBy);
    value = await settle(child, interruptController.signal);
  } finally {
    if (killTimer !== undefined) clearTimeout(killTimer);
    // A non-interactive shell can exit from SIGINT while a background child
    // remains in the group with SIGINT ignored. The leader is reaped now, so
    // no cooperative cleanup remains to wait for; remove any group survivors.
    if (opts.isolatedGroup && interruptedBy !== null && child !== undefined) {
      signalProcessGroup(child.pid, "SIGKILL");
    }
    for (const [signal, handler] of handlers) {
      Deno.removeSignalListener(signal, handler);
    }
  }

  if (interruptedBy !== null && !(opts.resumeAfterInterrupt ?? false)) {
    reraiseInterrupt(interruptedBy);
  }
  return { value, interruptedBy };
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
  const run = await superviseSpawn(
    () =>
      new Deno.Command(command, {
        args: [...(opts.args ?? [])],
        ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
        ...(opts.env === undefined ? {} : { env: opts.env }),
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        detached: isolatedGroup,
      }).spawn(),
    (child) => child.status,
    {
      isolatedGroup,
      resumeAfterInterrupt: opts.resumeAfterInterrupt ?? false,
    },
  );
  return { status: run.value, interruptedBy: run.interruptedBy };
}
