/**
 * Run a project-supplied shell command (a `[worktree.setup].steps`/`ensure` entry,
 * a resource `create`/`destroy`/`ensure`) with the engine's automated-command output
 * convention: CAPTURE its output and surface it ONLY on failure. This is the single
 * source of that routing, shared by the setup/ensure runner (./lifecycle.ts) and the
 * resource runner (./resources.ts) so the two can never drift.
 *
 * It mirrors the gate's job convention (engine/jobs/command.ts): a SUCCESSFUL command
 * is silent — its output reaches neither the parent's stdout (which a caller may
 * reserve for a structured result, e.g. the `worktree create` hook's worktree path) nor
 * the `SessionStart` hook's stdout (which Claude Code injects as agent context, so a
 * chatty `vale sync`/`npm ci` would otherwise leak its progress bar into every
 * session). A FAILED command surfaces its captured output to STDERR — the diagnostic
 * channel — so the caller's failure narration carries the command's own output beside
 * it. In `--json` mode all output is discarded (the result envelope is the whole
 * program output; ADR 0030).
 *
 * These commands can run long (a dependency install, a database provision), so the
 * child runs under the owned-child supervision boundary (engine/owned_child.ts):
 * it leads its own process group, and a signal delivered to the engine's PID
 * stops and reaps its whole tree — then re-raises — instead of orphaning it
 * against a half-created worktree.
 */

import { byteWriter } from "../output.ts";
import type { Logger } from "../../lib/log.ts";
import { operationLockChildEnv } from "../../shared/operation_lock_context.ts";
import { spawnedByEnv } from "../../shared/invocation_context.ts";
import { bestEffort } from "../../shared/best_effort.ts";
import { detachPromise } from "../../shared/promise_effects.ts";
import { selfShimPath, SPAWN_FAILED } from "../../shared/subprocess.ts";
import { superviseSpawn } from "../owned_child.ts";
import {
  KILLED_PIPE_GRACE_MS,
  quiesceProcessGroup,
} from "../process_signals.ts";
import {
  type Scheduler,
  SYSTEM_SCHEDULER,
  type TimeoutHandle,
} from "../../shared/scheduler.ts";

const ENCODER = new TextEncoder();
const NEWLINE = 0x0a;

/** Concatenate captured output chunks into one buffer. */
function concat(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) {
    total += c.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Capture both child streams concurrently so a full pipe never blocks, reap
 * the direct child, quiesce its ordinary background descendants, then finish
 * the drains and report the exit code. Reads go through explicit readers so an
 * interrupt can bound the wait for EOF: once the child's group is killed, only
 * a descendant that escaped into its own session (a self-daemonizing tool) can
 * still hold the pipe write ends open, and after {@link KILLED_PIPE_GRACE_MS}
 * the pending reads are cancelled rather than waiting out the escapee.
 */
async function settleCaptured(
  child: Deno.ChildProcess,
  interrupted: AbortSignal,
  scheduler: Scheduler,
): Promise<number> {
  const chunks: Uint8Array[] = [];
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  let pipeGraceTimer: TimeoutHandle | undefined;
  const boundDrains = (): void => {
    pipeGraceTimer ??= scheduler.scheduleTimeout(() => {
      for (const reader of readers) {
        detachPromise(
          "worktree-shell-drain-cancel-detach",
          () =>
            bestEffort("worktree-shell-drain-cancel", async () => {
              await reader.cancel();
            }),
          globalThis.reportError,
        );
      }
    }, KILLED_PIPE_GRACE_MS);
  };
  const drain = async (s: ReadableStream<Uint8Array>): Promise<void> => {
    const reader = s.getReader();
    readers.add(reader);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done || value === undefined) {
          return;
        }
        chunks.push(value);
      }
    } finally {
      readers.delete(reader);
      reader.releaseLock();
    }
  };
  if (interrupted.aborted) {
    boundDrains();
  } else {
    interrupted.addEventListener("abort", boundDrains, { once: true });
  }
  const drained = Promise.all([drain(child.stdout), drain(child.stderr)]);
  const status = await child.status;
  if (!interrupted.aborted) {
    // A shell leader can exit 0 while an ordinary background child still owns
    // both the worktree and these pipes. Stop that detached group before
    // waiting for EOF, so success cannot outrun a command-owned writer.
    await quiesceProcessGroup(child.pid, scheduler);
  }
  try {
    await drained;
  } finally {
    if (pipeGraceTimer !== undefined) scheduler.cancelTimeout(pipeGraceTimer);
    interrupted.removeEventListener("abort", boundDrains);
  }
  const code = status.code;
  if (code !== 0 && !interrupted.aborted) {
    // Loud on failure: the captured output → STDERR, never the parent's stdout. A
    // trailing newline is added when the command omitted one, so the caller's next
    // narration line starts clean. An interrupted command stays quiet — the engine
    // is about to die by the re-raised signal, not diagnose the command.
    const out = concat(chunks);
    if (out.length > 0) {
      const write = byteWriter("stderr");
      write(out);
      if (out[out.length - 1] !== NEWLINE) {
        write(ENCODER.encode("\n"));
      }
    }
  }
  return code;
}

/**
 * Run `command` via `sh -c` in `cwd`, capturing its combined output and surfacing it
 * only when the command FAILS:
 *   - exit 0    → silent (the captured output is discarded — nothing reaches stdout or
 *                 stderr, so a healthy command never pollutes a reserved stdout or the
 *                 agent-context channel);
 *   - exit N≠0  → the captured output is written to STDERR (the diagnostic channel),
 *                 so the failure is debuggable next to the caller's own narration;
 *   - `--json`  → all output discarded, success or failure (ADR 0030).
 * `env` adds variables for the child. An empty/whitespace command is a `0` no-op. A
 * spawn failure resolves to `127` rather than throwing, so one bad command never
 * aborts a whole setup/teardown/prune. The child is never interactive (stdin is
 * null), so on POSIX it always leads its own process group and an interrupt to the
 * engine tree-kills the command with everything it forked, then re-raises.
 */
export async function runShellRouted(
  command: string,
  opts: {
    cwd: string;
    log: Logger;
    env?: Record<string, string>;
    scheduler?: Scheduler;
  },
): Promise<number> {
  if (command.trim() === "") {
    return 0;
  }
  const { cwd, log, env } = opts;
  const scheduler = opts.scheduler ?? SYSTEM_SCHEDULER;
  const quiet = log.json;
  const isolatedGroup = Deno.build.os !== "windows";
  // `discern` in an operator command resolves to the running engine, whatever
  // the ambient PATH holds (self_shim.ts).
  const childEnv = {
    ...env,
    ...operationLockChildEnv(),
    PATH: await selfShimPath(cwd, env?.PATH),
    ...spawnedByEnv(),
  };
  try {
    const run = await superviseSpawn(
      () =>
        new Deno.Command("sh", {
          args: ["-c", command],
          cwd,
          env: childEnv,
          stdin: "null",
          stdout: quiet ? "null" : "piped",
          stderr: quiet ? "null" : "piped",
          detached: isolatedGroup,
        }).spawn(),
      async (child, interrupted) =>
        quiet
          ? (await child.status).code
          : await settleCaptured(child, interrupted, scheduler),
      { isolatedGroup, resumeAfterInterrupt: false, scheduler },
    );
    return run.value;
  } catch {
    return SPAWN_FAILED; // could not spawn — treat as a failed (retryable) command
  }
}
