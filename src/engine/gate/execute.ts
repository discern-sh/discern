/**
 * The gate's **job-group executor** — the thin effectful layer between the pure
 * plan ({@link JobGroup}s, built in `plan.ts`) and the {@link DiscernResult} the
 * verbs return. One place runs a group's jobs (serial for the mutating fix stage,
 * parallel otherwise) and one place walks an ordered group list stopping at the
 * first failure, so `done`, `prepare`, and `test` all execute jobs identically —
 * the same job runner, the same banners, the same captured-output diagnostics.
 *
 * `done` composes more on top (scope-gate selection, the guidance/merge checks),
 * so it drives {@link runGroup} itself; `prepare`/`test` are exactly "run these
 * groups, serialize the result" and use {@link runJobGroups} wholesale.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { Job, JobResult } from "../jobs/types.ts";
import { type RunOptions, runParallel, runSerial } from "../jobs/runner.ts";
import { byteWriter, makeOut, type Out } from "../output.ts";
import { type TerminalContext, terminalContext } from "../../lib/terminal.ts";
import type { FailedStage } from "../../shared/result.ts";
import type { JobGroup } from "./plan.ts";
import {
  buildTestRunSlots,
  groupNeedsTestSlot,
  type TestRunSlots,
} from "./test_slots.ts";
import { TEST_RUN_SLOT_ENV, TEST_RUN_SLOT_VALUE } from "../test_run_slots.ts";

/** A post-settle verdict for one gate job, keyed by label — how a standard's
 * measurement rewrites its job result from the captured output (see
 * {@link import("../jobs/types.ts").Job.evaluate}). */
export type JobEvaluators = Map<
  string,
  (result: JobResult) => Promise<JobResult>
>;

/**
 * Run one job group — the thin per-group executor. Runs the group's firing jobs
 * (serial for the mutating fix stage, parallel otherwise), records their results
 * into `results`, and returns whether the group passed. A group with no firing job
 * (e.g. a scope-gates group whose scopes are all unchanged) is a clean pass with no
 * heading. `evaluators` attaches a post-settle verdict to the jobs it names (their
 * output is retained so the verdict can read it).
 *
 * `slots` is the run's fleet test-run cap ([gate].concurrent_test_runs), built
 * by {@link gateRunContext}: a group carrying a firing test-stage job or a
 * standard's measurement ({@link groupNeedsTestSlot} — derived from the group's
 * jobs, never from the calling verb) first acquires one slot and releases it
 * when the group settles. The parameter is required so a new call site has to
 * say `undefined` out loud to opt a run out of the cap.
 */
export async function runGroup(
  group: JobGroup,
  results: Map<string, JobResult>,
  runOpts: RunOptions,
  out: Out,
  slots: TestRunSlots | undefined,
  evaluators?: JobEvaluators,
): Promise<boolean> {
  const jobs: Job[] = group.jobs
    .filter((j) => j.willRun)
    .map((j) => {
      const evaluate = evaluators?.get(j.label);
      return {
        label: j.label,
        command: j.command,
        ...(j.timeoutS !== undefined ? { timeoutS: j.timeoutS } : {}),
        ...(evaluate !== undefined ? { evaluate, keepOutput: true } : {}),
      };
    });
  if (jobs.length === 0) {
    return true;
  }
  // Tripwire: `results` is keyed by label, and the serialized report looks each
  // planned job up by label — a duplicate would silently overwrite one job's
  // outcome with its sibling's (losing the genuine failure's diagnostics).
  // Labels are unique by construction (declared jobs share one namespace; scope
  // gates are prefixed `scope:`; list expansions
  // carry `#`), so a collision here is an engine bug — fail loudly, before
  // anything runs, rather than report a corrupted result.
  const seen = new Set(results.keys());
  for (const job of jobs) {
    if (seen.has(job.label)) {
      throw new Error(
        `internal error: duplicate gate job label "${job.label}" — job results are keyed by label, so two jobs sharing one would overwrite each other's outcome`,
      );
    }
    seen.add(job.label);
  }
  // The fleet test-run cap: a capped group waits for a slot BEFORE its heading
  // prints (the wait line explains the pause), and releases when it settles —
  // pass or fail — so a red suite frees the machine for the next run.
  const accountsForTestRun = slots !== undefined && groupNeedsTestSlot(group);
  const hold = accountsForTestRun
    ? await slots.acquire(out, runOpts.signal)
    : undefined;
  // The marker records the accounting decision, not a successfully held lock.
  // Keep it set after fail-open so a wrapped job does not probe the same broken
  // slot surface again and turn a deliberate fallback into a second wait.
  const groupRunOpts: RunOptions = accountsForTestRun
    ? {
      ...runOpts,
      env: {
        ...(runOpts.env ?? {}),
        [TEST_RUN_SLOT_ENV]: TEST_RUN_SLOT_VALUE,
      },
    }
    : runOpts;
  try {
    out.heading(group.heading);
    const r = group.mode === "serial"
      ? await runSerial(jobs, groupRunOpts)
      : await runParallel(jobs, groupRunOpts);
    for (const res of r.results) {
      results.set(res.label, res);
    }
    return r.ok;
  } finally {
    hold?.release();
  }
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
 * shared inner loop behind `prepare` and `test`. `done` does not use this (it
 * interleaves scope classification between the stage groups and the scope gates),
 * but it runs each group through the same {@link runGroup}.
 */
export async function runJobGroups(
  groups: JobGroup[],
  runOpts: RunOptions,
  out: Out,
  slots: TestRunSlots | undefined,
): Promise<StagesRun> {
  const results = new Map<string, JobResult>();
  let failedStage: FailedStage | null = null;
  for (const group of groups) {
    if (!(await runGroup(group, results, runOpts, out, slots))) {
      failedStage = group.stage;
      break;
    }
  }
  return { results, failedStage };
}

/**
 * The run context every gate verb shares: the {@link RunOptions} for the job runner
 * and the {@link Out} for its narration, derived once from the resolved project root,
 * config, and JSON flag. The root is carried as the runner's required cwd: a nested
 * CLI invocation or long-lived MCP server must never leak its process cwd into the
 * project's commands. Human runs normally stream banners + job output to stdout.
 * A compact presentation may quiet that runner while retaining the human
 * {@link Out} for its final summary. `--json`/MCP quiet both — the result envelope
 * is the entire output (ADR 0030) — while a failure's output remains captured for
 * its diagnostic. An optional `signal` rides into the RunOptions so an external
 * caller (an MCP client cancelling its request, the server shutting down) can
 * tree-kill the in-flight jobs.
 *
 * `slots` is the run's fleet test-run cap ([gate].concurrent_test_runs) —
 * undefined when uncapped (the default). Building it here is what enrols every
 * gate verb: any run whose context comes from this one place carries the cap,
 * and {@link runGroup} decides per group whether to draw on it.
 */
export function gateRunContext(
  root: string,
  cfg: DiscernConfig,
  json: boolean,
  signal?: AbortSignal,
  presentation: {
    quietHumanRun?: boolean;
    terminal?: TerminalContext;
  } = {},
): { runOpts: RunOptions; out: Out; slots: TestRunSlots | undefined } {
  const terminal = presentation.terminal ?? terminalContext();
  const color = terminal.color;
  const quietRun = json || (presentation.quietHumanRun ?? false);
  return {
    runOpts: {
      cwd: root,
      stream: cfg.gate.stream,
      failFast: cfg.gate.fail_fast,
      timeoutS: cfg.gate.timeout,
      ...(signal !== undefined ? { signal } : {}),
      color,
      terminal,
      write: byteWriter("stdout"),
      quiet: quietRun,
    },
    out: makeOut(color, { quiet: json, terminal }),
    slots: buildTestRunSlots(root, cfg),
  };
}
