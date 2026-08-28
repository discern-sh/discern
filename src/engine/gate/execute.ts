/**
 * The gate's **job-group executor** — the thin effectful layer between the pure
 * plan ({@link JobGroup}s, built in `plan.ts`) and the {@link DiscernResult} the
 * verbs return. One place runs a group's jobs (serial for the mutating fix stage,
 * parallel otherwise) and one place walks an ordered group list stopping at the
 * first failure, so `done`, `prepare`, and `test` all execute jobs identically —
 * the same job runner, the same banners, the same captured-output diagnostics.
 *
 * `done` composes more on top (scope-gate selection, the instructions/merge checks),
 * so it drives {@link runGroup} itself; `prepare`/`test` are exactly "run these
 * groups, serialize the result" and use {@link runJobGroups} wholesale.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import { bestEffortSync } from "../../shared/best_effort.ts";
import {
  GATE_TIMEOUT_KEY,
  type Job,
  type JobResult,
  type JobTimeout,
} from "../jobs/types.ts";
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

const ENCODER = new TextEncoder();

/** The caller-owned Gate surface before project policy is applied. */
export type GateOutputSurface =
  | { readonly kind: "quiet-result"; readonly terminal?: TerminalContext }
  | {
    readonly kind: "human";
    readonly plain: boolean;
    readonly terminal: TerminalContext;
  };

/** The resolved presentation authority for every Gate-family run. */
export type GateOutputMode =
  | { readonly kind: "quiet-result"; readonly terminal: TerminalContext }
  | {
    readonly kind: "live-frame";
    readonly terminal: TerminalContext;
    readonly ttyWidth: number;
  }
  | {
    readonly kind: "static-streamed";
    readonly terminal: TerminalContext;
    readonly ttyWidth?: number;
  }
  | {
    readonly kind: "static-grouped";
    readonly terminal: TerminalContext;
    readonly ttyWidth?: number;
  };

/** Runner retention stays explicit and separate from terminal presentation. */
export type GateCaptureMode = "buffered-full" | "streamed-capped";

/** One shared decision consumed by done, prepare, test, and composite callers. */
export interface GateRunPolicy {
  readonly output: GateOutputMode;
  readonly capture: GateCaptureMode;
}

/** Resolve terminal presentation and child capture once at the shared boundary. */
export function resolveGateRunPolicy(
  staticStream: boolean,
  surface: GateOutputSurface,
): GateRunPolicy {
  const terminal = surface.terminal ?? terminalContext();
  if (surface.kind === "quiet-result") {
    return {
      output: { kind: "quiet-result", terminal },
      capture: "buffered-full",
    };
  }
  const ttyWidth = terminal.stdoutIsTerminal
    ? terminal.size.columns
    : undefined;
  const live = ttyWidth !== undefined && !surface.plain &&
    !terminal.ciRequestsStaticOutput &&
    terminal.capabilities.ansiControl !== false;
  if (live) {
    return {
      output: { kind: "live-frame", terminal, ttyWidth },
      capture: "buffered-full",
    };
  }
  const output = {
    kind: staticStream ? "static-streamed" : "static-grouped",
    terminal,
    ...(ttyWidth === undefined ? {} : { ttyWidth }),
  } as const;
  return {
    output,
    capture: staticStream ? "streamed-capped" : "buffered-full",
  };
}

/** Width available to a terminal result table, if stdout is a terminal. */
export function gateOutputTtyWidth(policy: GateRunPolicy): number | undefined {
  return policy.output.kind === "quiet-result"
    ? undefined
    : policy.output.ttyWidth;
}

/** Whether the package activity frame owns the run's live projection. */
export function gateOutputIsLive(policy: GateRunPolicy): boolean {
  return policy.output.kind === "live-frame";
}

/** Buffered human transcript held while a replaceable live frame owns stdout. */
interface DeferredHumanRun {
  readonly out: Out;
  readonly write: (chunk: Uint8Array) => void;
  /** Flush once below the live region; a failed write is latched and reported. */
  flush(): boolean;
}

/** Preserve ordinary headings, banners, and raw child bytes until finalization. */
function deferredHumanRun(
  color: boolean,
  terminal: TerminalContext,
): DeferredHumanRun {
  const chunks: Uint8Array[] = [];
  const destination = byteWriter("stdout");
  let flushed = false;
  const appendBytes = (chunk: Uint8Array): void => {
    if (flushed || chunk.length === 0) return;
    chunks.push(chunk.slice());
  };
  const appendText = (text: string): void => appendBytes(ENCODER.encode(text));
  return {
    out: makeOut(color, {
      terminal,
      stdout: appendText,
      stderr: appendText,
    }),
    write: appendBytes,
    flush: (): boolean => {
      if (flushed) return true;
      flushed = true;
      let delivered = false;
      bestEffortSync("gate-live-output-flush", () => {
        for (const chunk of chunks) destination(chunk);
        delivered = true;
      });
      chunks.length = 0;
      return delivered;
    },
  };
}

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
    .filter((j) => j.willRun && j.runsProcess !== false)
    .map((j) => {
      const evaluate = evaluators?.get(j.label);
      return {
        label: j.label,
        command: j.command,
        ...(j.timeout !== undefined ? { timeout: j.timeout } : {}),
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

/** The run-level time budget every gate job inherits, paired with the config
 * key that set it so a fired watchdog can name its source. */
export function gateTimeoutBudget(cfg: DiscernConfig): JobTimeout {
  return { seconds: cfg.gate.timeout, key: GATE_TIMEOUT_KEY };
}

/**
 * The run context every gate verb shares: the {@link RunOptions} for the job runner
 * and the {@link Out} for its narration, derived once from the resolved project root,
 * config, and JSON flag. The root is carried as the runner's required cwd: a nested
 * CLI invocation or long-lived MCP server must never leak its process cwd into the
 * project's commands. Human runs normally stream banners + job output to stdout.
 * A live presentation defers that ordinary transcript until it has left the
 * replaceable region. `--json`/MCP quiet both — the result envelope is the entire
 * output (ADR 0030) — while a failure's output remains captured for its diagnostic.
 * An optional `signal` rides into the RunOptions so an external
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
  policy: GateRunPolicy,
  signal?: AbortSignal,
): {
  runOpts: RunOptions;
  out: Out;
  runOut: Out;
  flushDeferredOutput: () => boolean;
  slots: TestRunSlots | undefined;
} {
  const terminal = policy.output.terminal;
  const color = terminal.color;
  const quietResult = policy.output.kind === "quiet-result";
  const liveFrame = policy.output.kind === "live-frame";
  const deferred = liveFrame ? deferredHumanRun(color, terminal) : undefined;
  const out = makeOut(color, { quiet: quietResult, terminal });
  return {
    runOpts: {
      cwd: root,
      stream: policy.capture === "streamed-capped",
      failFast: cfg.gate.fail_fast,
      timeout: gateTimeoutBudget(cfg),
      ...(signal !== undefined ? { signal } : {}),
      color,
      terminal,
      write: deferred?.write ?? byteWriter("stdout"),
      quiet: quietResult || liveFrame,
    },
    out,
    runOut: deferred?.out ?? out,
    flushDeferredOutput: deferred?.flush ?? (() => true),
    slots: buildTestRunSlots(root, cfg),
  };
}
