/** Shared types for the gate's job runner (the TS port of the shell jobs.sh). */

/** A unit of gate work: a labelled shell command. */
export interface Job {
  /** Stable label (a capability/check name, or `scope:<name>`). Carries no spaces. */
  label: string;
  /** The command string, run via `sh -c`. An empty string becomes the `:` no-op. */
  command: string;
}

/** The outcome of a job that produced a result (it ran, or was cancelled). */
export type JobStatus = "ok" | "failed";

/** The result of one job. A job with no result is "skipped" — finish's concern. */
export interface JobResult {
  label: string;
  status: JobStatus;
  /** Process exit code. A cancelled/killed sibling reports a non-zero code (1). */
  code: number;
  /** Whole-second wall-clock duration (integer, matching the shell's date math). */
  durationS: number;
  /**
   * The job's captured combined stdout+stderr (capped), present ONLY on a GENUINELY
   * failed job — the Tier-0 diagnostic payload finish lifts into
   * `DiscernResult.diagnostics` so an agent reads the error from the result instead
   * of re-running and scraping. Absent on a cancelled sibling (its output is noise).
   */
  output?: string;
  /** True when `output` was truncated to the capture cap (head + tail kept). */
  truncated?: boolean;
  /**
   * True when fail-fast tree-killed this job mid-run (a cancelled sibling, not a
   * real failure). It reports exit 1 like the shell, but it is NOT something to
   * fix — so finish excludes it from `diagnostics`.
   */
  cancelled?: boolean;
}

/** What a stage run returns: overall success plus the per-job results produced. */
export interface StageRunResult {
  /** True only when every job that ran exited 0. */
  ok: boolean;
  /**
   * Per-job results, in declaration order. runParallel returns one per input job
   * (a cancelled sibling included, as a failure); runSerial omits jobs after the
   * first failure (they never ran), so finish reports them as "skipped".
   */
  results: JobResult[];
}
