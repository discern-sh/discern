/**
 * The gate's **job-group executor** — the thin effectful layer between the pure
 * plan ({@link JobGroup}s, built in `plan.ts`) and the {@link DiscernResult} the
 * verbs return. One place runs a group's jobs (serial for the mutating fix stage,
 * parallel otherwise) and one place walks an ordered group list stopping at the
 * first failure, so `finish`, `prepare`, and `test` all execute jobs identically —
 * the same job runner, the same banners, the same captured-output diagnostics.
 *
 * `finish` composes more on top (scope-gate selection, the guidance/merge checks),
 * so it drives {@link runGroup} itself; `prepare`/`test` are exactly "run these
 * groups, serialize the result" and use {@link runJobGroups} wholesale.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { Job, JobResult } from "../jobs/types.ts";
import { type RunOptions, runParallel, runSerial } from "../jobs/runner.ts";
import { byteWriter, colorEnabled, makeOut, type Out } from "../output.ts";
import type { FailedStage } from "../../shared/result.ts";
import { buildStageGroups, type JobGroup } from "./plan.ts";
import { fixDriftPaths, worktreeDirtyPaths } from "./fix_drift.ts";

/**
 * Run one job group — the thin per-group executor. Runs the group's firing jobs
 * (serial for the mutating fix stage, parallel otherwise), records their results
 * into `results`, and returns whether the group passed. A group with no firing job
 * (e.g. a scope-gates group whose scopes are all unchanged) is a clean pass with no
 * heading.
 */
export async function runGroup(
  group: JobGroup,
  results: Map<string, JobResult>,
  runOpts: RunOptions,
  out: Out,
): Promise<boolean> {
  const jobs: Job[] = group.jobs
    .filter((j) => j.willRun)
    .map((j) => ({ label: j.label, command: j.command }));
  if (jobs.length === 0) {
    return true;
  }
  out.heading(group.heading);
  const r = group.mode === "serial"
    ? await runSerial(jobs, runOpts)
    : await runParallel(jobs, runOpts);
  for (const res of r.results) {
    results.set(res.label, res);
  }
  return r.ok;
}

/** The outcome of running an ordered group list: the per-job results and which
 * group's stage failed (null when every group passed). */
export interface StagesRun {
  results: Map<string, JobResult>;
  /** The `stage` of the first group that failed, or null. */
  failedStage: FailedStage | null;
}

/**
 * Run an ordered list of job groups, stopping at the first group that fails — the
 * shared inner loop behind `prepare` and `test`. `finish` does not use this (it
 * interleaves scope classification between the stage groups and the scope gates),
 * but it runs each group through the same {@link runGroup}.
 */
export async function runJobGroups(
  groups: JobGroup[],
  runOpts: RunOptions,
  out: Out,
): Promise<StagesRun> {
  const results = new Map<string, JobResult>();
  let failedStage: FailedStage | null = null;
  for (const group of groups) {
    if (!(await runGroup(group, results, runOpts, out))) {
      failedStage = group.stage;
      break;
    }
  }
  return { results, failedStage };
}

/**
 * The run context every gate verb shares: the {@link RunOptions} for the job runner
 * and the {@link Out} for its narration, derived once from the config and the JSON
 * flag. Human runs stream banners + job output to stdout;
 * `--json`/MCP runs go quiet — the result envelope is the entire output (ADR 0030),
 * so the runner and the Out are silenced while jobs still run and a failure's output
 * is still captured for its diagnostic.
 */
export function gateRunContext(
  cfg: DiscernConfig,
  json: boolean,
): { runOpts: RunOptions; out: Out } {
  const color = colorEnabled();
  return {
    runOpts: {
      stream: cfg.gate.stream,
      failFast: cfg.gate.fail_fast,
      color,
      write: byteWriter("stdout"),
      quiet: json,
    },
    out: makeOut(color, { quiet: json }),
  };
}

/**
 * Run the configured fix-stage fixers and report any STRANDED output — committed-clean
 * files the fixers dirtied (`D1 \ D0`), the same signal {@link fixDriftPaths} defines for
 * `finish`. This is the guard behind `discern graduate` (ADR 0061): a branch that is NOT at
 * the fixers' fixed point must not land on `main`. `finish` already enforces this — but an
 * agent that skips `finish` on a "trivial" docs edit (running only a scope gate, e.g. a prose
 * LINTER like Vale, which lints but never FORMATS) commits unformatted Markdown, and
 * `graduate --to trunk` fast-forwards it onto `main` LOCALLY, where CI's trailing
 * `git diff --exit-code` never runs. Re-running the fixers at the landing boundary brings
 * that property local.
 *
 * Runs in `root` — the worktree, the process cwd, exactly as `finish`'s fix stage does — and
 * QUIET (graduate narrates through its own logger, not the job banners). Snapshots use
 * {@link worktreeDirtyPaths} (tracked-only); a snapshot git cannot take fails OPEN to
 * `stranded: []` (a missing snapshot must never fabricate a refusal). `fixFailed` is true when
 * a fixer command itself exits non-zero, so the caller can refuse a broken fixer too. A
 * project with no fix stage is a clean no-op.
 */
export async function detectFixStageStrand(
  cfg: DiscernConfig,
  root: string,
): Promise<{ fixFailed: boolean; stranded: string[] }> {
  const fixGroups = buildStageGroups(cfg).filter((g) => g.stage === "fix");
  if (fixGroups.length === 0) {
    return { fixFailed: false, stranded: [] };
  }
  const before = await worktreeDirtyPaths(root);
  // Quiet (json=true): the fixer banners would be noise beside graduate's own narration.
  const { runOpts, out } = gateRunContext(cfg, true);
  const results = new Map<string, JobResult>();
  for (const group of fixGroups) {
    if (!(await runGroup(group, results, runOpts, out))) {
      return { fixFailed: true, stranded: [] };
    }
  }
  const after = await worktreeDirtyPaths(root);
  const stranded = before !== null && after !== null
    ? fixDriftPaths(before, after)
    : [];
  return { fixFailed: false, stranded };
}
