/**
 * Spawning one gate job: run an operator-supplied command string via `sh -c`
 * (preserving shell features — `&&`, pipes, globs, `$(...)` — that parsing to
 * argv would break), capture or stream its combined output, and support
 * cancellation by tree-killing the process group.
 *
 * Tree-kill uses the mechanism verified in the Phase-0a spike: a `detached`
 * child leads its own process group, so `Deno.kill(-pid, sig)` reaches the
 * grandchildren a shell command may fork. If the group signal is unavailable it
 * falls back to killing the direct child.
 */

import type { Job, JobResult } from "./types.ts";
import { JobOutputRecorder } from "./output_record.ts";
import { selfShimPath } from "../../shared/self_shim.ts";
import { shellCommand } from "../../shared/subprocess.ts";
import {
  KILL_GRACE_MS,
  KILLED_PIPE_GRACE_MS,
  killProcessTree,
} from "../process_signals.ts";

/** Options for spawning a single job. */
export interface SpawnOptions {
  /** Project root in which the configured command must execute. */
  cwd: string;
  /** Abort to cancel the job: it is tree-killed and resolves as a failure. */
  signal?: AbortSignal;
  /** Stream output live (line-prefixed) instead of buffering it. */
  stream: boolean;
  /** Sink for streamed lines (the runner passes the same sink it uses for banners). */
  write: (chunk: Uint8Array) => void;
  /**
   * Per-command time budget in SECONDS (`[gate].timeout`, or the job's own
   * `timeout` override). A job that has not exited within it is tree-killed and
   * resolves as a GENUINE failure carrying `timedOutAfterS` — so a watch-mode
   * runner or a hung dev server can never make the gate wait forever. Omitted or
   * `<= 0` means no bound (the unit-test default).
   */
  timeoutS?: number;
  /** Attach the captured output to the result even on a CLEAN exit — for a job
   * whose verdict is judged from its output rather than its exit code. */
  keepOutput?: boolean;
}

/** A finished job: its result plus captured output (buffered mode only). */
export interface SpawnedJob {
  result: JobResult;
  /** Combined stdout+stderr (buffered mode); empty when streaming. */
  output: Uint8Array;
}

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();

/**
 * Hard cap (bytes) on the buffer retained for the capture in STREAM mode, where
 * output isn't otherwise held in memory (the full stream is written to a temp
 * artifact). Split into a head and a tail window so a failed streamed job carries
 * both its first errors and its trailing summary; bounds worst-case memory on a
 * pathological stream.
 */
const STREAM_CAP_BYTES = 1_000_000;
const HEAD_CAP = STREAM_CAP_BYTES / 2;
const TAIL_CAP = STREAM_CAP_BYTES - HEAD_CAP;
/**
 * The environment every gate command inherits. `NO_COLOR`/`TERM=dumb` tell tools
 * they aren't on a terminal (so they emit plain, parseable output); `CI=1` is the
 * honest signal for what the gate is — a local CI run — and, decisively, flips the
 * ubiquitous watch-vs-single-run test runners into their single-run form, so a bare
 * `test = "<runner>"` doesn't enter watch mode and hang the gate waiting for edits.
 */
const CAPTURE_ENV: Record<string, string> = {
  NO_COLOR: "1",
  TERM: "dumb",
  CI: "1",
};

/**
 * The exit code a finished job reports. A job terminated by a signal — i.e. the
 * one fail-fast tree-killed mid-run — defaults to 1. A job that exited on its
 * own keeps its
 * real code, even when a *sibling's* failure aborted the stage only after this
 * job had already finished cleanly: the abort fires on every sibling, so keying
 * the code off the abort flag would mis-report an already-passed job as failed.
 */
export function finalCode(code: number, signal: Deno.Signal | null): number {
  return signal !== null ? 1 : code;
}

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
 * Iterate a child stream through an explicit reader registered in `readers`,
 * so the kill path can cancel a pending read (a `for await` over the stream
 * itself holds a private reader nothing else can reach).
 */
async function* readChunks(
  stream: ReadableStream<Uint8Array>,
  readers: Set<ReadableStreamDefaultReader<Uint8Array>>,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  readers.add(reader);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || value === undefined) {
        return;
      }
      yield value;
    }
  } finally {
    readers.delete(reader);
    reader.releaseLock();
  }
}

/**
 * Stream a child stream live, prefixing each line `── <label> │ …`.
 * `onChunk` (optional) receives each raw chunk so the caller can retain a capped
 * copy for the failure diagnostic without giving up live streaming.
 */
async function streamPrefixed(
  stream: AsyncIterable<Uint8Array>,
  label: string,
  write: (chunk: Uint8Array) => void,
  onChunk?: (chunk: Uint8Array) => void | Promise<void>,
): Promise<void> {
  const dec = new TextDecoder();
  const prefix = `── ${label} │ `;
  let buf = "";
  for await (const chunk of stream) {
    await onChunk?.(chunk);
    buf += dec.decode(chunk, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      write(ENCODER.encode(prefix + buf.slice(0, nl) + "\n"));
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
    }
  }
  if (buf.length > 0) {
    write(ENCODER.encode(prefix + buf + "\n"));
  }
}

/**
 * Run one job to completion. An empty command becomes the `:` no-op (exit 0).
 * A command that calls `exit N` exits its own
 * `sh -c` shell, so the recorded code is N — not a runner failure.
 */
export async function spawnJob(
  job: Job,
  opts: SpawnOptions,
): Promise<SpawnedJob> {
  const command = shellCommand(job.command);
  const start = performance.now();

  const child = new Deno.Command("sh", {
    args: ["-c", command],
    cwd: opts.cwd,
    // `discern` in a job command resolves to the engine running this gate,
    // whatever the ambient PATH holds (self_shim.ts).
    env: { ...CAPTURE_ENV, PATH: await selfShimPath() },
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    detached: true,
  }).spawn();
  const pid = child.pid;
  const outputRecorder = await JobOutputRecorder.create();

  // The readers draining the child's pipes, registered so the kill path can
  // cancel a read blocked on a pipe the tree-kill could not close.
  const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let pipeGraceTimer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = (): void => {
    killProcessTree(pid, "SIGTERM");
    // Escalate if it ignores SIGTERM; cleared once the process is reaped.
    killTimer = setTimeout(
      () => killProcessTree(pid, "SIGKILL"),
      KILL_GRACE_MS,
    );
    // Bound the drains: a descendant that escaped the process group (its own
    // session) survives the tree-kill holding the pipe write ends, so EOF may
    // never come. Give the pipes a grace to flush, then cancel the pending
    // reads so the job settles within its budget instead of waiting out the
    // escapee. `??=` so a second kill (abort + watchdog racing) keeps the
    // first deadline.
    pipeGraceTimer ??= setTimeout(() => {
      for (const reader of readers) {
        reader.cancel().catch(() => {
          // Already closed or errored — the drain has settled either way.
        });
      }
    }, KILLED_PIPE_GRACE_MS);
  };
  const signal = opts.signal;
  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  // Watchdog: a job that never exits within its budget is tree-killed — reusing the
  // SAME SIGTERM→SIGKILL escalation (`onAbort`) that fail-fast/external cancellation
  // uses — but recorded as a GENUINE timeout failure, not a cancelled sibling. Set
  // `timedOutAfterS` only when the timer actually fires, so its presence is the
  // "did it time out?" flag and the value is the budget the diagnostic reports.
  let timedOutAfterS: number | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const budgetS = opts.timeoutS;
  if (budgetS !== undefined && budgetS > 0) {
    timeoutTimer = setTimeout(() => {
      timedOutAfterS = budgetS;
      onAbort();
    }, budgetS * 1000);
  }

  // `chunks` holds the full output for the buffered human write + diagnostic
  // (buffered mode). In STREAM mode `chunks` stays empty and a byte-capped head +
  // tail window is retained instead, so a failed streamed job still carries a
  // diagnostic with both its first errors and its trailing summary.
  const chunks: Uint8Array[] = [];
  const headBuf: Uint8Array[] = [];
  let headBytes = 0;
  const tailBuf: Uint8Array[] = [];
  let tailBytes = 0;
  let elidedBytes = 0;
  const retainCapped = (c: Uint8Array): void => {
    if (headBytes < HEAD_CAP) {
      headBuf.push(c);
      headBytes += c.length;
      return;
    }
    tailBuf.push(c);
    tailBytes += c.length;
    while (
      tailBytes - (tailBuf[0]?.length ?? 0) >= TAIL_CAP && tailBuf.length > 1
    ) {
      const dropped = tailBuf.shift();
      if (dropped !== undefined) {
        tailBytes -= dropped.length;
        elidedBytes += dropped.length;
      }
    }
  };
  // Assemble the stream-mode capture: contiguous when it fit the head window (so
  // SARIF normalization still parses), head + tail with a marker once it overflowed.
  const streamCapture = (): string => {
    const head = DECODER.decode(concat(headBuf));
    if (tailBuf.length === 0) {
      return head;
    }
    return `${head}\n… ${elidedBytes} bytes elided …\n${
      DECODER.decode(concat(tailBuf))
    }`;
  };
  const drain = async (s: ReadableStream<Uint8Array>): Promise<void> => {
    const source = readChunks(s, readers);
    if (opts.stream) {
      await streamPrefixed(source, job.label, opts.write, async (chunk) => {
        retainCapped(chunk);
        await outputRecorder.write(chunk);
      });
    } else {
      for await (const c of source) {
        chunks.push(c);
        await outputRecorder.write(c);
      }
    }
  };
  await Promise.all([drain(child.stdout), drain(child.stderr)]);
  const status = await child.status;

  // Stop the watchdog the moment the job has settled (pipes drained AND the
  // process reaped), before any further awaits, so a job that finished within
  // budget isn't branded a timeout by a late-firing timer.
  if (timeoutTimer !== undefined) {
    clearTimeout(timeoutTimer);
  }
  if (killTimer !== undefined) {
    clearTimeout(killTimer);
  }
  if (pipeGraceTimer !== undefined) {
    clearTimeout(pipeGraceTimer);
  }
  if (signal) {
    signal.removeEventListener("abort", onAbort);
  }
  const outputSummary = await outputRecorder.finish();

  // A job killed mid-run keeps its real exit code via finalCode. "Cancelled" means
  // fail-fast aborted the run AND this job did not exit clean — keyed on the abort
  // signal, NOT the OS signal, so a sibling that TRAPS SIGTERM and exits non-zero is
  // still recognised as cancelled (not a genuine failure). The job that failed
  // FIRST built its result before its own `.then` fired the abort, so its
  // `signal.aborted` is still false → it is correctly NOT cancelled and keeps its
  // diagnostic. A job that finished clean (code 0) before an abort stays ok.
  const exitCode = finalCode(status.code, status.signal);
  // A fired watchdog is a genuine FAILURE even when the direct child exited 0:
  // a command that daemonized left work — and the job's output pipes — running
  // past the budget, and its own exit code would report ok, silently swallowing
  // the recorded timeout. Everything downstream (ok/failed, banners, fail-fast,
  // diagnostics) keys off `code`, so enforce the invariant at the producer:
  // timedOutAfterS present ⇒ code !== 0.
  const code = timedOutAfterS !== undefined && exitCode === 0 ? 1 : exitCode;
  // A timed-out job is a genuine failure, never a cancelled sibling: exclude it here
  // so it keeps its diagnostic even if a fail-fast/external abort also raced in.
  const cancelled = timedOutAfterS === undefined &&
    (opts.signal?.aborted ?? false) && code !== 0;
  const durationS = Math.round((performance.now() - start) / 1000);
  const result: JobResult = {
    label: job.label,
    status: code === 0 ? "ok" : "failed",
    code,
    durationS,
    ...outputSummary,
  };
  if (cancelled) {
    result.cancelled = true;
  }
  if (timedOutAfterS !== undefined) {
    result.timedOutAfterS = timedOutAfterS;
  }
  // Attach the FULL captured output on a GENUINE failure (not a cancelled sibling)
  // — or unconditionally for a keepOutput job, whose verdict is judged from the
  // output after it settles. Capping is deferred to the diagnostic layer so
  // structured normalization (SARIF) sees the whole output; only the Tier-0
  // fallback is capped.
  if ((code !== 0 && !cancelled) || opts.keepOutput === true) {
    const raw = opts.stream ? streamCapture() : DECODER.decode(concat(chunks));
    if (raw.length > 0) {
      result.output = raw;
    }
  }
  return {
    result,
    output: opts.stream ? new Uint8Array() : concat(chunks),
  };
}
