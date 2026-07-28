/**
 * The gate's concurrency core: run labelled jobs concurrently (runParallel) or
 * one at a time (runSerial), buffered-and-grouped or streamed live, with
 * optional fail-fast cancellation. Results are returned in memory (no temp-file
 * side channel); `done` builds its
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
import { spawnJob, type SpawnOptions } from "./command.ts";
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
  /**
   * Per-command time budget in SECONDS (`[gate].timeout`), applied to EVERY job in
   * the run. A job that never exits within it is tree-killed and fails with a
   * timeout diagnostic — so the gate can't hang on a watch-mode runner or a dev
   * server. Omitted (the unit-test default) means no bound.
   */
  timeoutS?: number;
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
 * The spawn options for one job under a run: the run-level settings plus the
 * job's own overrides. The per-job `timeoutS` REPLACES the run-level budget for
 * that job alone (`0` disables the bound for it); every sibling keeps the
 * run-level budget. Shared by runParallel and runSerial so the override
 * semantics can't diverge between the two schedulers.
 */
function spawnOptions(
  job: Job,
  opts: RunOptions,
  signal: AbortSignal,
  stream: boolean,
  write: (chunk: Uint8Array) => void,
): SpawnOptions {
  const timeoutS = job.timeoutS ?? opts.timeoutS;
  return {
    cwd: opts.cwd,
    signal,
    stream,
    write,
    ...(timeoutS !== undefined ? { timeoutS } : {}),
    ...(job.keepOutput === true ? { keepOutput: true } : {}),
  };
}

/**
 * Apply a job's {@link Job.evaluate} verdict to its settled result. A cancelled
 * sibling or a timed-out job keeps its verdict — those failures are the
 * scheduler's, and re-judging them could hide a hang behind a green metric.
 */
async function evaluateResult(job: Job, result: JobResult): Promise<JobResult> {
  if (
    job.evaluate === undefined || result.cancelled === true ||
    result.timedOutAfterS !== undefined
  ) {
    return result;
  }
  return await job.evaluate(result);
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
 * rest are cancelled (tree-killed). Their non-zero exit keeps the stage red,
 * while banners and envelope steps label them `cancelled` rather than genuine
 * failures. Buffered output prints in declaration order once every job settles.
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
    const settled = await Promise.all(
      jobs.map((job) =>
        spawnJob(job, spawnOptions(job, opts, controller.signal, stream, write))
          .then(async (s) => {
            const result = await evaluateResult(job, s.result);
            if (opts.failFast && result.code !== 0) {
              controller.abort();
            }
            return { ...s, result };
          })
      ),
    );
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
      const s = await spawnJob(
        job,
        spawnOptions(job, opts, controller.signal, stream, write),
      );
      const result = await evaluateResult(job, s.result);
      if (!quiet) {
        write(banner(result, opts.color));
        if (!stream && s.output.length > 0) {
          write(s.output);
        }
      }
      results.push(result);
      if (result.code !== 0) {
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
