/** Shared types for the gate's job runner. */

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
  /** Whole-second wall-clock duration (integer). */
  durationS: number;
  /** Best-effort path to the job's full combined stdout+stderr capture. */
  outputPath?: string;
  /** Count of lines the job printed to stdout+stderr. */
  outputLines: number;
  /** Count of output lines that look like compiler/linter diagnostics. */
  errorLikeLines: number;
  /**
   * The job's FULL captured combined stdout+stderr (uncapped — stream mode keeps a
   * head+tail window), present ONLY on a GENUINELY failed job. finish normalizes it
   * (SARIF) or caps it into a Tier-0 `DiscernResult.diagnostics` entry, so an agent
   * reads the error from the result instead of re-running and scraping. Absent on a
   * cancelled sibling (its output is noise).
   */
  output?: string;
  /**
   * True when fail-fast aborted the run and this job did not exit clean — a
   * cancelled sibling, NOT a real failure (even one that trapped SIGTERM and exited
   * non-zero). It is excluded from `diagnostics` and reported as `skipped`.
   */
  cancelled?: boolean;
  /**
   * The per-command time budget (seconds) this job blew through: present ONLY when
   * the job was tree-killed by the gate's watchdog for never exiting (`[gate].timeout`).
   * A GENUINE failure (not a cancelled sibling), it carries the budget so the
   * diagnostic can name it. Presence, not the value, is the "did it time out?" flag —
   * and it forces a non-zero `code`, even when the direct child exited clean (a
   * command that daemonized), so no consumer keying off `code` can report it ok.
   */
  timedOutAfterS?: number;
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
