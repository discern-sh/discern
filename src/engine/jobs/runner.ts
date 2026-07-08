/**
 * The gate's concurrency core: run labelled jobs concurrently (runParallel) or
 * one at a time (runSerial), buffered-and-grouped or streamed live, with
 * optional fail-fast cancellation. Results are returned in memory (no temp-file
 * side channel); `finish` builds its
 * `--json` report from the returned `JobResult[]`.
 *
 * Every run is cancellable from outside: an external `signal` (an MCP client
 * cancelling its request, the MCP server shutting down) aborts the run's own
 * controller, tree-killing every in-flight job exactly as a fail-fast sibling
 * failure would. Jobs are spawned `detached` (their own process groups), so no
 * cancellation reaches them except through that controller — which is why every
 * shutdown path must funnel into it.
 *
 * The per-job status line format is `── <label> ─ ok` /
 * `── <label> ─ FAILED (exit N)`, with the stream-mode
 * line prefix `── <label> │ …`. Human output goes to the sink (stderr by
 * default), keeping `--json` stdout clean for the report.
 */

import type { Job, JobResult, StageRunResult } from "./types.ts";
import { spawnJob } from "./command.ts";
import { trackRun } from "./interrupt.ts";

/** How a stage run presents and schedules its jobs. */
export interface RunOptions {
  /** Resolved project root in which every configured job executes. */
  cwd: string;
  /** Stream each job's output live (line-prefixed) instead of buffering it. */
  stream: boolean;
  /** Cancel in-flight siblings the moment one job fails (on by default in finish). */
  failFast: boolean;
  /**
   * External cancellation: aborting it tree-kills every in-flight job and ends
   * the run. A job killed this way reports `cancelled`, like a fail-fast-killed
   * sibling; jobs not yet started never start.
   */
  signal?: AbortSignal;
  /** Whether colour is enabled for the status banners. */
  color: boolean;
  /** Sink for human output (banners + buffered job output). Default: stderr. */
  write?: (chunk: Uint8Array) => void;
  /**
   * Suppress ALL output — banners AND job output — under `--json`, where the
   * result envelope is the entire program output (ADR 0030). Jobs still run and a
   * genuine failure's output is still captured for its diagnostic; only the live
   * writing is withheld. Forces buffered capture so `spawnJob` cannot stream-write
   * either.
   */
  quiet?: boolean;
}

const ENCODER = new TextEncoder();

/** Write a buffer fully to stderr (the default human-output sink). */
function defaultWrite(chunk: Uint8Array): void {
  let n = 0;
  while (n < chunk.length) {
    n += Deno.stderr.writeSync(chunk.subarray(n));
  }
}

interface Palette {
  dim: string;
  reset: string;
  green: string;
  red: string;
}
const ON: Palette = {
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
};
const OFF: Palette = { dim: "", reset: "", green: "", red: "" };

/** Render the per-job status line. A fail-fast-cancelled sibling is labelled
 * `cancelled`, not `FAILED` — it wasn't a real failure, just killed mid-run. */
function banner(result: JobResult, color: boolean): Uint8Array {
  const c = color ? ON : OFF;
  const tail = result.code === 0
    ? `${c.green}ok${c.reset}`
    : result.cancelled === true
    ? `${c.dim}cancelled${c.reset}`
    : `${c.red}FAILED (exit ${result.code})${c.reset}`;
  return ENCODER.encode(`${c.dim}── ${result.label} ─${c.reset} ${tail}\n`);
}

/**
 * Funnel an optional external signal into the run's own controller, so a single
 * abort source reaches `spawnJob`'s tree-kill. Returns the detach to call once
 * the run settles (an already-aborted external cancels the run before any job
 * starts).
 */
function chainExternal(
  controller: AbortController,
  external: AbortSignal | undefined,
): () => void {
  if (external === undefined) {
    return (): void => {};
  }
  const onAbort = (): void => controller.abort();
  if (external.aborted) {
    onAbort();
    return (): void => {};
  }
  external.addEventListener("abort", onAbort, { once: true });
  return (): void => external.removeEventListener("abort", onAbort);
}

/**
 * Run labelled jobs concurrently. With fail-fast, the moment one job fails the
 * rest are cancelled (tree-killed) and reported as failures (a killed sibling
 * defaults to exit 1). Banners and
 * buffered output print in declaration order once every job has settled.
 */
export async function runParallel(
  jobs: Job[],
  opts: RunOptions,
): Promise<StageRunResult> {
  const write = opts.write ?? defaultWrite;
  // Quiet (--json): withhold every write and force buffered capture so spawnJob
  // can't stream-write either. Failure output is still captured for diagnostics.
  const quiet = opts.quiet ?? false;
  const stream = quiet ? false : opts.stream;
  if (jobs.length === 0) {
    return { ok: true, results: [] };
  }
  const controller = new AbortController();
  const detach = chainExternal(controller, opts.signal);
  const release = trackRun(controller);
  try {
    const settled = await Promise.all(jobs.map((job) =>
      spawnJob(job, {
        cwd: opts.cwd,
        signal: controller.signal,
        stream,
        write,
      }).then((s) => {
        if (opts.failFast && s.result.code !== 0) {
          controller.abort();
        }
        return s;
      })
    ));
    if (!quiet) {
      for (const s of settled) {
        write(banner(s.result, opts.color));
        if (!stream && s.output.length > 0) {
          write(s.output);
        }
      }
    }
    const results = settled.map((s) => s.result);
    return { ok: results.every((r) => r.code === 0), results };
  } finally {
    detach();
    // May re-raise a pending OS interrupt (dying with its conventional status)
    // once this was the last active run — after the banners above, so the user
    // still sees what was cancelled.
    release();
  }
}

/**
 * Run labelled jobs one at a time, in order, stopping at the first failure (the
 * mutating fix stage: a later fixer may depend on an earlier one's edits, so a
 * failure must not let a later one act on a broken tree). Jobs after the failure
 * never run and are absent from `results`, so finish reports them as "skipped".
 */
export async function runSerial(
  jobs: Job[],
  opts: RunOptions,
): Promise<StageRunResult> {
  const write = opts.write ?? defaultWrite;
  const quiet = opts.quiet ?? false;
  const stream = quiet ? false : opts.stream;
  const controller = new AbortController();
  const detach = chainExternal(controller, opts.signal);
  const release = trackRun(controller);
  const results: JobResult[] = [];
  let ok = true;
  try {
    for (const job of jobs) {
      // An abort between jobs stops the loop before the next spawn; jobs never
      // started are absent from `results`, so finish reports them as "skipped".
      if (controller.signal.aborted) {
        ok = false;
        break;
      }
      const s = await spawnJob(job, {
        cwd: opts.cwd,
        signal: controller.signal,
        stream,
        write,
      });
      if (!quiet) {
        write(banner(s.result, opts.color));
        if (!stream && s.output.length > 0) {
          write(s.output);
        }
      }
      results.push(s.result);
      if (s.result.code !== 0) {
        ok = false;
        break;
      }
    }
    return { ok, results };
  } finally {
    detach();
    release();
  }
}
