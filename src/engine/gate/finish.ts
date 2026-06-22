/**
 * `finish` — the full quality gate. Built on the plan/apply seam (ADR 0027): a
 * pure {@link GatePlan} (the job groups + scope-gates + merge check) is computed
 * first (`buildGatePlan`, from the typed config and the changed scopes), then a
 * thin executor applies it. `--dry-run` renders the plan and touches nothing;
 * `--json` SERIALIZES (plan, results) into the published report rather than
 * re-deriving it.
 *
 * The report shape is a published contract (ADR 0004) reproduced byte-for-shape:
 *
 *   { ok, jobs:[{name,kind,stage,status,duration_s}], scope_gates:[{scope,status,
 *     duration_s}], scopes_changed:[…], failed_stage }
 *
 * A no-op gate (nothing wired) → `jobs:[]`, `failed_stage:null`, `ok:true`. A job
 * whose stage aborted before it ran → `status:"skipped"`.
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { STAGES } from "../../shared/capabilities.ts";
import type { Job, JobResult } from "../jobs/types.ts";
import { type RunOptions, runParallel, runSerial } from "../jobs/runner.ts";
import {
  buildGatePlan,
  buildGateReport,
  type GatePlan,
  gatePlanToEngine,
  type GateReport,
} from "./plan.ts";
import { cmdsInStage } from "./stages.ts";
import { gotchasHint } from "./gotchas.ts";
import { changedScopes } from "../scopes/changed.ts";
import { byteWriter, colorEnabled, makeOut, type Out } from "../output.ts";
import { assertMainMerged } from "../worktree/git.ts";
import { outSink, planToJson, renderPlan } from "../plan/view.ts";

/** The outcome of applying a gate plan: the per-job results + the failed stage. */
interface GateExecution {
  results: Map<string, JobResult>;
  failedStage: string | null;
}

/**
 * Apply a gate plan — the thin executor. Walks the plan's groups in order, running
 * each group's firing jobs (serial for the mutating fix stage, parallel otherwise)
 * and stopping at the first group that fails. The merge check runs last, only when
 * every group passed (it self-skips outside a worktree). Owns every effect; the
 * plan and the report are pure.
 */
async function executeGatePlan(
  plan: GatePlan,
  root: string,
  cfg: DiscernConfig,
  runOpts: RunOptions,
  out: Out,
): Promise<GateExecution> {
  const results = new Map<string, JobResult>();
  const record = (rs: JobResult[]): void => {
    for (const r of rs) {
      results.set(r.label, r);
    }
  };
  let failedStage: string | null = null;

  for (const group of plan.groups) {
    const jobs: Job[] = group.jobs
      .filter((j) => j.willRun)
      .map((j) => ({ label: j.label, command: j.command }));
    if (jobs.length === 0) {
      continue; // a scope-gates group whose scopes are all unchanged
    }
    out.heading(group.heading);
    const r = group.mode === "serial"
      ? await runSerial(jobs, runOpts)
      : await runParallel(jobs, runOpts);
    record(r.results);
    if (!r.ok) {
      failedStage = group.stage;
      break;
    }
  }

  if (failedStage === null && plan.mergeCheck) {
    const mainBranch = Deno.env.get("MAIN_BRANCH") || cfg.project.main_branch;
    if ((await assertMainMerged(root, mainBranch)).kind === "behind") {
      failedStage = "merge";
    }
  }

  return { results, failedStage };
}

/** The human die message for each failed stage (matches the shell fail_phase). */
function failMessage(stage: string): string {
  switch (stage) {
    case "fix":
      return "The fix stage failed.";
    case "build":
      return "The build stage failed.";
    case "check/test":
      return "The check/test stage failed.";
    case "scope_gates":
      return "One or more scope gates failed.";
    case "merge":
      return "Integrate main, then re-run finish.";
    default:
      return "A gate stage failed.";
  }
}

/** Run the gate once: plan, apply, build the report. */
async function runGate(
  root: string,
  json: boolean,
): Promise<
  {
    report: GateReport;
    failedStage: string | null;
    cfg: DiscernConfig;
    out: Out;
    changed: string[];
  }
> {
  const cfg = await loadConfig(root);
  // Non-json: human output → stdout (matching the shell). --json: human → stderr,
  // leaving stdout for the single JSON object.
  const infoStream = json ? "stderr" : "stdout";
  const color = colorEnabled();
  const runOpts: RunOptions = {
    stream: cfg.gate.stream,
    // fail_fast defaults ON: abort the moment a job fails.
    failFast: cfg.gate.fail_fast,
    color,
    write: byteWriter(infoStream),
  };
  const out = makeOut(color, infoStream);

  // Read-only I/O at plan time: classify the changed scopes, then build the plan.
  const changed = await changedScopes(root, cfg);
  const plan = buildGatePlan(cfg, changed);

  const { results, failedStage } = await executeGatePlan(
    plan,
    root,
    cfg,
    runOpts,
    out,
  );

  return {
    report: buildGateReport(plan, results, failedStage),
    failedStage,
    cfg,
    out,
    changed,
  };
}

/** Print the informational success tail (non-`--json`). */
function printSuccessTail(
  cfg: DiscernConfig,
  out: Out,
  changed: string[],
): void {
  let unfilled = 0;
  for (const stage of STAGES) {
    if (cmdsInStage(cfg, stage) === ":") {
      unfilled++;
    }
  }
  if (unfilled === 4) {
    out.ok(
      "Gate passed — but no capability or check is wired, so nothing was actually checked (a no-op gate).",
    );
    out.warn(
      "Add [capabilities] (format/lint/typecheck/test/build) to discern.toml — or run `discern bootstrap`.",
    );
  } else {
    out.ok("Everything built and all checks passed.");
    if (unfilled > 0) {
      out.info(
        `${out.c.dim}note: ${unfilled} of 4 gate stages have no command yet.${out.c.reset}`,
      );
    }
    out.info(
      "If you changed something meaningful, update the docs to match before you finish.",
    );
  }
  if (Object.keys(cfg.ratchets).length > 0) {
    out.info(
      `Before pushing, hold the ratchets: ${out.c.bold}discern ratchets${out.c.reset} (slow, so not part of finish).`,
    );
  }
  if (
    (cfg.worktree.resources.dev_server?.create ?? "") !== "" &&
    changed.includes("previewable")
  ) {
    out.info(
      "A previewable change landed — start this worktree's dev server to view it.",
    );
  }
}

/**
 * Print the gate plan without running it (`--dry-run`): the wired job groups, the
 * scope-gates selected for the changed scopes, and the trailing merge check. Honest
 * — it lists "what would run"; it cannot predict which jobs fail-fast would skip.
 */
async function dryRunGate(
  root: string,
  json: boolean,
): Promise<number> {
  const cfg = await loadConfig(root);
  const changed = await changedScopes(root, cfg);
  const plan = buildGatePlan(cfg, changed);
  const engine = gatePlanToEngine(plan);
  if (json) {
    console.log(JSON.stringify({ dry_run: true, plan: planToJson(engine) }));
    return 0;
  }
  renderPlan(outSink(makeOut(colorEnabled())), engine);
  return 0;
}

/** Run `finish`. Returns a process exit code. */
export async function runFinish(
  root: string,
  opts: { json: boolean; dryRun?: boolean },
): Promise<number> {
  if (opts.dryRun ?? false) {
    return await dryRunGate(root, opts.json);
  }
  const { report, failedStage, cfg, out, changed } = await runGate(
    root,
    opts.json,
  );
  if (opts.json) {
    console.log(JSON.stringify(report));
    return failedStage === null ? 0 : 1;
  }
  if (failedStage !== null) {
    out.error(failMessage(failedStage));
    gotchasHint(cfg, root, out.color);
    return 1;
  }
  printSuccessTail(cfg, out, changed);
  return 0;
}
