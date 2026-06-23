/**
 * `finish` — the full quality gate. Built on the plan/apply seam (ADR 0027): a
 * pure {@link GatePlan} (the job groups + scope-gates + merge check) is computed
 * first (`buildGatePlan`, from the typed config and the changed scopes), then a
 * thin executor applies it. `--dry-run` renders the plan and touches nothing;
 * `--json` SERIALIZES (plan, results) into the result rather than re-deriving it.
 *
 * The result is the universal {@link DiscernResult} envelope (ADR 0028) every verb
 * returns: each capability/check/scope-gate is a `steps[]` entry, a genuine failure
 * also yields a `diagnostics[]` entry (the command to reproduce it + its captured
 * output, or — for a SARIF-emitting tool — normalized file/line/rule findings), and
 * the gate's own `failed_stage`/`scopes_changed` ride in `data`. Human text and
 * `--json` are two renderings of that one object; {@link finishResult} returns it
 * unrendered for the MCP server. A job whose stage aborted before it ran →
 * `outcome:"skipped"`.
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { STAGES } from "../../shared/capabilities.ts";
import type { Job, JobResult } from "../jobs/types.ts";
import { type RunOptions, runParallel, runSerial } from "../jobs/runner.ts";
import {
  buildGatePlan,
  buildGateResult,
  buildStageGroups,
  composeGatePlan,
  gatePlanToEngine,
  type JobGroup,
  planScopeGates,
  scopeGatesGroup,
} from "./plan.ts";
import { cmdsInStage } from "./stages.ts";
import { gotchasHint } from "./gotchas.ts";
import { changedScopes } from "../scopes/changed.ts";
import {
  byteWriter,
  colorEnabled,
  makeOut,
  type Out,
  outSink,
} from "../output.ts";
import { assertMainMerged } from "../worktree/git.ts";
import {
  type Diagnostic,
  type DiscernResult,
  previewResult,
  renderPlan,
  serializeResult,
} from "../../shared/result.ts";

/**
 * Run one job group — the thin per-group executor. Runs the group's firing jobs
 * (serial for the mutating fix stage, parallel otherwise), records their results,
 * and returns whether the group passed. A group with no firing job (e.g. a
 * scope-gates group whose scopes are all unchanged) is a clean pass with no
 * heading.
 */
async function runGroup(
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

/** Run the gate once: plan, apply, build the result. */
async function runGate(
  root: string,
  json: boolean,
): Promise<
  {
    result: DiscernResult;
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

  const results = new Map<string, JobResult>();
  let failedStage: string | null = null;

  // 1. Run the capability/check stage groups (fix → build → check∥test). These do
  //    not depend on the changed scopes, so they run first.
  const stageGroups = buildStageGroups(cfg);
  for (const group of stageGroups) {
    if (!(await runGroup(group, results, runOpts, out))) {
      failedStage = group.stage;
      break;
    }
  }

  // 2. Classify the changed scopes AFTER the stage groups — preserving the gate's
  //    original timing, so a fix-stage edit is reflected and scope selection keeps
  //    its fail-open bias (it never runs FEWER gates than the post-fix tree warrants).
  const changed = await changedScopes(root, cfg);
  const sgGroup = scopeGatesGroup(planScopeGates(cfg, changed));

  // 3. Scope gates (only when the stage groups passed).
  if (failedStage === null && sgGroup !== undefined) {
    if (!(await runGroup(sgGroup, results, runOpts, out))) {
      failedStage = "scope_gates";
    }
  }

  // 4. Merge check (no-op in the main checkout / outside a worktree).
  if (failedStage === null) {
    const mainBranch = Deno.env.get("MAIN_BRANCH") || cfg.project.main_branch;
    if ((await assertMainMerged(root, mainBranch)).kind === "behind") {
      failedStage = "merge";
    }
  }

  // 5. Assemble the executed plan and serialize it into the result.
  const plan = composeGatePlan(stageGroups, sgGroup, changed);
  return {
    result: buildGateResult(plan, results, failedStage),
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
    // A preview is a DiscernResult carrying only `plan` (no `steps`): nothing ran.
    console.log(
      JSON.stringify(
        serializeResult({ ok: true, verb: "finish", plan: engine }),
      ),
    );
    return 0;
  }
  renderPlan(outSink(makeOut(colorEnabled())), engine);
  return 0;
}

/**
 * Render the structured failures block (human mode) — a clean list of each failed
 * tool with its location (Tier 1, when parsed) and the exact command to reproduce
 * it in isolation. The full tool output already streamed above; this is the
 * scannable "what to fix and how to re-run it" summary, the human mirror of the
 * `diagnostics[]` an agent reads from `--json`.
 */
function renderFailures(out: Out, diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) {
    return;
  }
  const c = out.c;
  out.heading(`Failures (${diagnostics.length})`);
  for (const d of diagnostics) {
    const loc = d.file !== undefined
      ? ` ${c.dim}${d.file}${
        d.line !== undefined ? `:${d.line}` : ""
      }${c.reset}`
      : "";
    out.raw(
      `  ${c.red}✗${c.reset} ${d.tool}${loc} ${c.dim}—${c.reset} ${d.message}\n`,
    );
    out.raw(`    ${c.dim}reproduce:${c.reset} ${d.reproduce_cmd}\n`);
  }
}

/**
 * Compute the `finish` {@link DiscernResult} without printing or exiting — the
 * entry point the MCP server (and any in-process caller) renders instead of the
 * CLI's stdout. `dryRun` returns the preview (the plan, nothing run); otherwise it
 * runs the gate, routing the human narration to stderr (json semantics) so a
 * caller owning stdout — like the MCP stdio channel — stays uncontaminated.
 */
export async function finishResult(
  root: string,
  opts: { dryRun?: boolean } = {},
): Promise<DiscernResult> {
  if (opts.dryRun ?? false) {
    const cfg = await loadConfig(root);
    const changed = await changedScopes(root, cfg);
    return previewResult(
      "finish",
      gatePlanToEngine(buildGatePlan(cfg, changed)),
    );
  }
  return (await runGate(root, true)).result;
}

/** Run `finish`. Returns a process exit code. */
export async function runFinish(
  root: string,
  opts: { json: boolean; dryRun?: boolean },
): Promise<number> {
  if (opts.dryRun ?? false) {
    return await dryRunGate(root, opts.json);
  }
  const { result, failedStage, cfg, out, changed } = await runGate(
    root,
    opts.json,
  );
  if (opts.json) {
    console.log(JSON.stringify(serializeResult(result)));
    return failedStage === null ? 0 : 1;
  }
  if (failedStage !== null) {
    renderFailures(out, result.diagnostics ?? []);
    out.error(failMessage(failedStage));
    gotchasHint(cfg, root, out.color);
    return 1;
  }
  printSuccessTail(cfg, out, changed);
  return 0;
}
