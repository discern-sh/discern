/**
 * Spawning one gate job: run an operator-supplied command string via `sh -c`
 * (preserving shell features — `&&`, pipes, globs, `$(...)` — that parsing to
 * argv would break), capture or stream its combined output, and support
 * cancellation by tree-killing the process group.
 *
 * Tree-kill uses the mechanism verified in the Phase-0a spike: a `detached`
 * child leads its own process group, so `Deno.kill(-pid, sig)` reaches the
 * grandchildren a shell command may fork. If the group signal is unavailable it
 * falls back to killing the direct child — the shell engine's best-effort
 * behaviour, so no regression.
 */

import type { Job, JobResult } from "./types.ts";

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
 * one fail-fast tree-killed mid-run — defaults to 1, matching the shell runner
 * whose killed siblings recorded exit 1. A job that exited on its own keeps its
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

/** Stream a child stream live, prefixing each line `── <label> │ …` (per the shell). */
async function streamPrefixed(
  stream: ReadableStream<Uint8Array>,
  label: string,
  write: (chunk: Uint8Array) => void,
): Promise<void> {
  const dec = new TextDecoder();
  const prefix = `── ${label} │ `;
  let buf = "";
  for await (const chunk of stream) {
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
 * Run one job to completion. An empty command becomes the `:` no-op (exit 0),
 * exactly as the shell runner did. A command that calls `exit N` exits its own
 * `sh -c` shell, so the recorded code is N — not a runner failure.
 */
export async function spawnJob(
  job: Job,
  opts: SpawnOptions,
): Promise<SpawnedJob> {
  const command = job.command.length > 0 ? job.command : ":";
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

  const chunks: Uint8Array[] = [];
  const drain = async (s: ReadableStream<Uint8Array>): Promise<void> => {
    if (opts.stream) {
      await streamPrefixed(s, job.label, opts.write);
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

  // A job killed mid-run (terminated by a signal) reports 1 like the shell; one
  // that exited on its own keeps its real code — even if a sibling's failure
  // aborted the stage after this job had already finished.
  const code = finalCode(status.code, status.signal);
  const durationS = Math.round((performance.now() - start) / 1000);
  return {
    result: {
      label: job.label,
      status: code === 0 ? "ok" : "failed",
      code,
      durationS,
    },
    output: opts.stream ? new Uint8Array() : concat(chunks),
  };
}
