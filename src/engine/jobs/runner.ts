/**
 * The gate's concurrency core: run labelled jobs concurrently (runParallel) or
 * one at a time (runSerial), buffered-and-grouped or streamed live, with
 * optional fail-fast cancellation. The TS port of the shell `lib/jobs.sh` —
 * results are returned in memory (no temp-file side channel); `finish` builds its
 * `--json` report from the returned `JobResult[]`.
 *
 * The per-job status line format is preserved exactly (the shell tests assert
 * it): `── <label> ─ ok` / `── <label> ─ FAILED (exit N)`, with the stream-mode
 * line prefix `── <label> │ …`. Human output goes to the sink (stderr by
 * default), keeping `--json` stdout clean for the report.
 */

import type { Job, JobResult, StageRunResult } from "./types.ts";
import { spawnJob } from "./command.ts";

/** How a stage run presents and schedules its jobs. */
export interface RunOptions {
  /** Stream each job's output live (line-prefixed) instead of buffering it. */
  stream: boolean;
  /** Cancel in-flight siblings the moment one job fails (on by default in finish). */
  failFast: boolean;
  /** Whether colour is enabled for the status banners. */
  color: boolean;
  /** Sink for human output (banners + buffered job output). Default: stderr. */
  write?: (chunk: Uint8Array) => void;
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
 * Run labelled jobs concurrently. With fail-fast, the moment one job fails the
 * rest are cancelled (tree-killed) and reported as failures — matching the shell,
 * which aggregates every job (a killed sibling defaults to exit 1). Banners and
 * buffered output print in declaration order once every job has settled.
 */
export async function runParallel(
  jobs: Job[],
  opts: RunOptions,
): Promise<StageRunResult> {
  const write = opts.write ?? defaultWrite;
  if (jobs.length === 0) {
    return { ok: true, results: [] };
  }
  const controller = new AbortController();
  const settled = await Promise.all(jobs.map((job) =>
    spawnJob(job, {
      signal: controller.signal,
      stream: opts.stream,
      write,
    }).then((s) => {
      if (opts.failFast && s.result.code !== 0) {
        controller.abort();
      }
      return s;
    })
  ));
  for (const s of settled) {
    write(banner(s.result, opts.color));
    if (!opts.stream && s.output.length > 0) {
      write(s.output);
    }
  }
  const results = settled.map((s) => s.result);
  return { ok: results.every((r) => r.code === 0), results };
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
  const results: JobResult[] = [];
  let ok = true;
  for (const job of jobs) {
    const s = await spawnJob(job, { stream: opts.stream, write });
    write(banner(s.result, opts.color));
    if (!opts.stream && s.output.length > 0) {
      write(s.output);
    }
    results.push(s.result);
    if (s.result.code !== 0) {
      ok = false;
      break;
    }
  }
  return { ok, results };
}
