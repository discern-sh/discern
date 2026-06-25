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
import type { JobResult } from "../jobs/types.ts";
import {
  buildGatePlan,
  buildGateResult,
  buildStageGroups,
  composeGatePlan,
  gatePlanToEngine,
  planScopeGates,
  scopeGatesGroup,
} from "./plan.ts";
import { gateRunContext, runGroup } from "./execute.ts";
import { cmdsInStage } from "./stages.ts";
import { gotchasHint } from "./gotchas.ts";
import { changedScopes } from "../scopes/changed.ts";
import { colorEnabled, makeOut, type Out, outSink } from "../output.ts";
import { assertMainMerged } from "../worktree/git.ts";
import {
  capText,
  type Diagnostic,
  type DiscernResult,
  previewResult,
  renderPlan,
} from "../../shared/result.ts";
import { emitResult } from "../../shared/emit.ts";
import { isFeatureEnabled } from "../../shared/features.ts";
import {
  checkGuidanceCurrent,
  type GuidanceDriftEntry,
} from "../guidance_render.ts";

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
    case "guidance":
      return "Generated agent files are out of date — run `discern refresh`.";
    case "merge":
      return "Integrate main, then re-run finish.";
    default:
      return "A gate stage failed.";
  }
}

/**
 * A compact, plain-text summary of how a stale generated file differs from what
 * `discern refresh` would write — the non-blank lines present in the file but NOT
 * in the recompiled body (what a refresh would remove, a hand-edit included).
 * Bounded so it never floods the diagnostic.
 */
function driftDiff(entry: GuidanceDriftEntry): string {
  const expected = new Set(entry.expected.split("\n"));
  const added = (entry.actual ?? "").split("\n")
    .filter((l) => l.trim() !== "" && !expected.has(l));
  const shown = added.slice(0, 12).map((l) => `  + ${l}`);
  if (added.length > shown.length) {
    shown.push(`  … and ${added.length - shown.length} more line(s)`);
  }
  const head =
    `${entry.path}: differs from what \`discern refresh\` would write.`;
  return added.length > 0
    ? `${head}\n  These lines are in the file but not the recompiled output (a refresh removes them):\n${
      shown.join("\n")
    }`
    : `${head}\n  (the file is missing content a refresh would restore.)`;
}

/**
 * The Tier-0 {@link Diagnostic} for a stale generated agent file: the `discern
 * refresh` reproduce command, the redirect (edits belong in `[guidance].sources`,
 * not the generated file), and a capped diff of what a refresh would change — the
 * rescue, since the untracked file has no `git diff` to fall back on.
 */
function guidanceDiagnostic(stale: GuidanceDriftEntry[]): Diagnostic {
  const files = stale.map((d) => d.path).join(", ");
  const capped = capText(
    `Generated agent files are out of date: ${files}.\n` +
      "Run `discern refresh` to regenerate them. If you meant to change the " +
      "guidance, edit your [guidance].sources (e.g. guidance.md) instead — a direct " +
      "edit to a generated file is overwritten on the next refresh.\n\n" +
      stale.map(driftDiff).join("\n\n"),
  );
  return {
    tool: "guidance",
    severity: "error",
    message: `generated agent file(s) out of date: ${files}`,
    reproduce_cmd: "discern refresh",
    output: capped.text,
    truncated: capped.truncated === true ? true : undefined,
  };
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
  // Human: gate narration + job output → stdout (matching the shell). --json:
  // quiet — the result envelope is the entire output (ADR 0030), so the runner
  // and the Out are silenced and nothing streams to any fd. The shared run context
  // (job RunOptions + the narration Out) is the one `prepare`/`test` use too.
  const { runOpts, out } = gateRunContext(cfg, json);

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

  // 4. Generated-artifacts currency (ADR 0034): block a STALE agent file — one
  //    present but no longer matching what `discern refresh` would write (a
  //    hand-edit, or an un-refreshed source/config change). A MISSING file is not a
  //    failure here: an untracked artifact is legitimately absent on a fresh
  //    checkout, so blocking it would red-light first-run CI. Gated on `guidance`.
  const guidanceOn = isFeatureEnabled(cfg, "guidance");
  let guidanceDiag: Diagnostic | undefined;
  if (failedStage === null && guidanceOn) {
    const stale = (await checkGuidanceCurrent(root, cfg))
      .filter((d) => d.reason === "stale");
    if (stale.length > 0) {
      failedStage = "guidance";
      guidanceDiag = guidanceDiagnostic(stale);
    }
  }

  // 5. Merge check (no-op in the main checkout / outside a worktree).
  if (failedStage === null) {
    const mainBranch = Deno.env.get("MAIN_BRANCH") || cfg.project.main_branch;
    if ((await assertMainMerged(root, mainBranch)).kind === "behind") {
      failedStage = "merge";
    }
  }

  // 6. Assemble the executed plan + result, attaching the agent-facing hints —
  //    the same next-step advice the human tail prints, promoted into the envelope.
  const plan = composeGatePlan(stageGroups, sgGroup, changed, guidanceOn);
  const result = buildGateResult(plan, results, failedStage);
  // The guidance check isn't a plan-group job, so its diagnostic (the diff + the
  // `discern refresh` reproduce command) is attached here, like the merge stage's
  // failed_stage rides in `data` without a job entry.
  if (guidanceDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), guidanceDiag];
  }
  const hints = buildGateHints(cfg, changed, failedStage);
  if (hints.length > 0) {
    result.hints = hints;
  }
  return { result, failedStage, cfg, out, changed };
}

/**
 * The agent-facing "what next" hints for a finished gate — the SINGLE source of
 * the advice that rides in the `--json` envelope (`hints`) and is printed by the
 * human success tail. On a failure: where the project documents its known gate
 * failures (when a `gotchas_doc` is set). On success: update the docs, hold the
 * ratchets, view a previewable change.
 */
function buildGateHints(
  cfg: DiscernConfig,
  changed: string[],
  failedStage: string | null,
): string[] {
  if (failedStage !== null) {
    const doc = cfg.project.gotchas_doc;
    return doc !== ""
      ? [
        `If the failure above isn't self-explanatory, this project's known gate failures and their fixes are documented in ${doc}.`,
      ]
      : [];
  }
  const hints = [
    "If you changed documented behaviour, update the docs to match before you finish.",
  ];
  if (Object.keys(cfg.ratchets).length > 0) {
    hints.push(
      "Before pushing, hold the ratchets with `discern ratchets` (slow, so not part of finish).",
    );
  }
  if (
    (cfg.worktree.resources.dev_server?.create ?? "") !== "" &&
    changed.includes("previewable")
  ) {
    hints.push(
      "A previewable change landed — start this worktree's dev server to view it.",
    );
  }
  return hints;
}

/** Print the informational success tail (non-`--json`): the pass line + gate-health
 * note, then the same `hints` the envelope carries (so human and machine agree). */
function printSuccessTail(cfg: DiscernConfig, out: Out, hints: string[]): void {
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
      "Add [capabilities] (format/lint/typecheck/test/build) to discern.toml so the gate has something to run.",
    );
  } else {
    out.ok("Everything built and all checks passed.");
    if (unfilled > 0) {
      out.info(
        `${out.c.dim}note: ${unfilled} of 4 gate stages have no command yet.${out.c.reset}`,
      );
    }
  }
  for (const hint of hints) {
    out.info(hint);
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
    // A preview is a DiscernResult carrying `plan` + `dry_run` (no `steps`).
    emitResult(previewResult("finish", engine));
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
  const { result, failedStage, cfg, out } = await runGate(root, opts.json);
  if (opts.json) {
    emitResult(result);
    return failedStage === null ? 0 : 1;
  }
  if (failedStage !== null) {
    renderFailures(out, result.diagnostics ?? []);
    out.error(failMessage(failedStage));
    gotchasHint(cfg, root, out.color);
    return 1;
  }
  printSuccessTail(cfg, out, result.hints ?? []);
  return 0;
}
