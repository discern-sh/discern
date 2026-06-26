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
import { shellCommand } from "../../shared/subprocess.ts";

/** Options for spawning a single job. */
export interface SpawnOptions {
  /** Abort to cancel the job: it is tree-killed and resolves as a failure. */
  signal?: AbortSignal;
  /** Stream output live (line-prefixed) instead of buffering it. */
  stream: boolean;
  /** Sink for streamed lines (the runner passes the same sink it uses for banners). */
  write: (chunk: Uint8Array) => void;
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
 * output isn't otherwise held in memory. Split into a head and a tail window so a
 * failed streamed job carries both its first errors and its trailing summary;
 * bounds worst-case memory on a pathological stream.
 */
const STREAM_CAP_BYTES = 1_000_000;
const HEAD_CAP = STREAM_CAP_BYTES / 2;
const TAIL_CAP = STREAM_CAP_BYTES - HEAD_CAP;

/** Signal an entire process group, falling back to the direct child. */
export function killTree(pid: number, sig: Deno.Signal): void {
  try {
    Deno.kill(-pid, sig); // negative pid → the whole process group (reaches grandchildren)
  } catch {
    try {
      Deno.kill(pid, sig);
    } catch {
      // already gone — nothing to signal
    }
  }
}

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
 * Stream a child stream live, prefixing each line `── <label> │ …`.
 * `onChunk` (optional) receives each raw chunk so the caller can retain a capped
 * copy for the failure diagnostic without giving up live streaming.
 */
async function streamPrefixed(
  stream: ReadableStream<Uint8Array>,
  label: string,
  write: (chunk: Uint8Array) => void,
  onChunk?: (chunk: Uint8Array) => void,
): Promise<void> {
  const dec = new TextDecoder();
  const prefix = `── ${label} │ `;
  let buf = "";
  for await (const chunk of stream) {
    onChunk?.(chunk);
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
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    detached: true,
  }).spawn();
  const pid = child.pid;

  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = (): void => {
    killTree(pid, "SIGTERM");
    // Escalate if it ignores SIGTERM; cleared once the process is reaped.
    killTimer = setTimeout(() => killTree(pid, "SIGKILL"), 2000);
  };
  const signal = opts.signal;
  if (signal) {
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
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
    if (opts.stream) {
      await streamPrefixed(s, job.label, opts.write, retainCapped);
    } else {
      for await (const c of s) {
        chunks.push(c);
      }
    }
  };
  await Promise.all([drain(child.stdout), drain(child.stderr)]);
  const status = await child.status;

  if (killTimer !== undefined) {
    clearTimeout(killTimer);
  }
  if (signal) {
    signal.removeEventListener("abort", onAbort);
  }

  // A job killed mid-run keeps its real exit code via finalCode. "Cancelled" means
  // fail-fast aborted the run AND this job did not exit clean — keyed on the abort
  // signal, NOT the OS signal, so a sibling that TRAPS SIGTERM and exits non-zero is
  // still recognised as cancelled (not a genuine failure). The job that failed
  // FIRST built its result before its own `.then` fired the abort, so its
  // `signal.aborted` is still false → it is correctly NOT cancelled and keeps its
  // diagnostic. A job that finished clean (code 0) before an abort stays ok.
  const code = finalCode(status.code, status.signal);
  const cancelled = (opts.signal?.aborted ?? false) && code !== 0;
  const durationS = Math.round((performance.now() - start) / 1000);
  const result: JobResult = {
    label: job.label,
    status: code === 0 ? "ok" : "failed",
    code,
    durationS,
  };
  if (cancelled) {
    result.cancelled = true;
  }
  // Attach the FULL captured output on a GENUINE failure (not a cancelled sibling).
  // Capping is deferred to the diagnostic layer so structured normalization (SARIF)
  // sees the whole output; only the Tier-0 fallback is capped.
  if (code !== 0 && !cancelled) {
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
