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
import { capabilityList, STAGES } from "../../shared/capabilities.ts";
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
import {
  fixDriftDiagnostic,
  fixDriftPaths,
  worktreeDirtyPaths,
} from "./fix_drift.ts";
import { renderFailureTail } from "./failure_tail.ts";
import { changedScopes, PREVIEWABLE_MARKER } from "../scopes/changed.ts";
import { colorEnabled, makeOut, type Out, outSink } from "../output.ts";
import { assertMainMerged } from "../worktree/git.ts";
import {
  capText,
  type Diagnostic,
  type DiscernResult,
  type FailedStage,
  previewResult,
  renderPlan,
} from "../../shared/result.ts";
import type { GateData } from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import { isFeatureEnabled } from "../../shared/features.ts";
import { setupInProgressHint } from "../../shared/setup_state.ts";
import {
  checkGuidanceCurrent,
  type GuidanceDriftEntry,
} from "../guidance_render.ts";
import { checkSkillsCurrent, type SkillsDriftEntry } from "../../lib/skills.ts";

/**
 * The human die message for each {@link FailedStage}. A TOTAL record (not a switch
 * with a `default`), so a new failed-stage label is a COMPILE error here until it is
 * given a message — it can never silently fall through to a generic "a stage failed".
 * Only `finish` looks a message up (its `check`/`test` are fused into `check/test`);
 * `prepare`/`test` print their own inline headline, so the `check`/`test` entries
 * exist for vocabulary completeness rather than a current caller.
 */
const FAIL_MESSAGES: Record<FailedStage, string> = {
  fix: "The fix stage failed.",
  build: "The build stage failed.",
  check: "The check stage failed.",
  test: "The test stage failed.",
  "check/test": "The check/test stage failed.",
  scope_gates: "One or more scope gates failed.",
  fix_drift:
    "The fix stage left uncommitted changes — commit the formatter's output, then re-run.",
  guidance:
    "Generated agent files are out of date — run `discern refresh` (edits belong in your [guidance].sources, not the generated file, which a refresh overwrites).",
  skills:
    "Materialized skills are out of date — run `discern refresh` (edits belong in your [skills].dir source, not the materialized copy, which a refresh overwrites).",
  merge:
    "Run `discern integrate` to bring the trunk in and re-materialize, then re-run finish.",
};

/** The human die message for a failed stage. */
function failMessage(stage: FailedStage): string {
  return FAIL_MESSAGES[stage];
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

/**
 * A diagnostic for stale MATERIALIZED skills: which dirs/skills drifted from the
 * effective set, and the `discern refresh` that re-materializes them. The skills
 * analog of {@link guidanceDiagnostic} — same redirect (edit the source, not the
 * generated copy), so the two generated-artifact failures read identically.
 */
function skillsDiagnostic(stale: SkillsDriftEntry[]): Diagnostic {
  const dirs = [...new Set(stale.map((d) => d.dir))].join(", ");
  const capped = capText(
    `Materialized skills are out of date in: ${dirs}.\n` +
      "Run `discern refresh` to re-materialize them. If you meant to change a skill, " +
      "edit its source under [skills].dir (or `discern skills eject` a bundled one) — a " +
      "direct edit to a materialized copy is overwritten on the next refresh.\n\n" +
      stale.map((d) => `  • ${d.detail}`).join("\n"),
  );
  return {
    tool: "skills",
    severity: "error",
    message: `materialized skills out of date: ${dirs}`,
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
    result: DiscernResult<GateData>;
    failedStage: FailedStage | null;
    cfg: DiscernConfig;
    out: Out;
    changed: string[];
  }
> {
  const cfg = await loadConfig(root);
  // Human: gate narration + job output → stdout. --json:
  // quiet — the result envelope is the entire output (ADR 0030), so the runner
  // and the Out are silenced and nothing streams to any fd. The shared run context
  // (job RunOptions + the narration Out) is the one `prepare`/`test` use too.
  const { runOpts, out } = gateRunContext(cfg, json);

  const results = new Map<string, JobResult>();
  let failedStage: FailedStage | null = null;

  // 1. Merge precondition — checked FIRST and fail-fast (ADR 0050). The merge-base
  //    relationship is invariant across the gate (finish never fetches or commits, so
  //    neither HEAD nor main moves), so checking here gives the SAME answer as checking
  //    last would — but a branch behind main must integrate and re-run regardless,
  //    which discards whatever the gate computed against the pre-integration tree.
  //    Front-loading it skips the expensive fix/build/check/test in exactly that case.
  //    No-op in the main checkout / outside a worktree (assertMainMerged self-skips),
  //    so the happy path pays one extra `merge-base --is-ancestor` and nothing more.
  const mainBranch = Deno.env.get("MAIN_BRANCH") || cfg.project.main_branch;
  if ((await assertMainMerged(root, mainBranch)).kind === "behind") {
    failedStage = "merge";
  }

  // 1b. Generated-artifacts currency — guidance (ADR 0034) — also runs FIRST, as a
  //     fail-fast precondition beside the merge check (ADR 0056). Its verdict is
  //     invariant across the gate for the same reason the merge check's is: the gate
  //     never runs `discern refresh`, and its fix stage formats SOURCE code, never the
  //     guidance sources or the gitignored generated agent files those checks read —
  //     so checking here gives the same answer as checking last, while skipping the
  //     slow build/check∥test/scope-gate sweep when the only problem is stale drift the
  //     agent must `discern refresh` and re-run to clear regardless. Block a STALE agent
  //     file only (a MISSING one is the legitimate fresh-checkout state — see ADR 0034).
  //     discern-allow-retrospective: "no longer matching" is the live drift this detects.
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

  // 1c. Materialized-skills currency (ADR 0034, extended to skills) — the same
  //     fail-fast precondition for the skills dirs. STALE blocks; MISSING (the whole
  //     dir absent on a fresh checkout) and FOREIGN (an unmanaged drop-in) do not.
  const skillsOn = isFeatureEnabled(cfg, "skills");
  let skillsDiag: Diagnostic | undefined;
  if (failedStage === null && skillsOn) {
    const stale = (await checkSkillsCurrent(root, cfg))
      .filter((d) => d.reason === "stale");
    if (stale.length > 0) {
      failedStage = "skills";
      skillsDiag = skillsDiagnostic(stale);
    }
  }

  // 2. Run the capability/check stage groups (fix → build → check∥test). These do
  //    not depend on the changed scopes, so they run before scope classification. The
  //    fix stage MUTATES the tree; snapshot the working-tree dirty set immediately
  //    before and after it so the strand check (step 5) can flag a fixer that reformatted
  //    a committed-clean file — the uncommitted fixer output a green gate would otherwise
  //    hide until graduate (ADR 0047). Skip the snapshots when no fix stage is wired, or
  //    when a fail-fast precondition (the merge or a currency check) already failed
  //    (nothing downstream runs).
  const stageGroups = buildStageGroups(cfg);
  const hasFix = stageGroups.some((g) => g.stage === "fix");
  const dirtyBeforeFix = hasFix && failedStage === null
    ? await worktreeDirtyPaths(root)
    : null;
  let dirtyAfterFix: Set<string> | null = null;
  for (const group of stageGroups) {
    if (failedStage !== null) {
      break;
    }
    if (!(await runGroup(group, results, runOpts, out))) {
      failedStage = group.stage;
      break;
    }
    if (group.stage === "fix") {
      dirtyAfterFix = await worktreeDirtyPaths(root);
    }
  }

  // 3. Classify the changed scopes AFTER the stage groups — preserving the gate's
  //    original timing, so a fix-stage edit is reflected and scope selection keeps
  //    its fail-open bias (it never runs FEWER gates than the post-fix tree warrants).
  //    Computed even when the merge precondition failed, so the result still lists the
  //    scopes (their gates serialize as skipped, like every other downstream step).
  const changed = await changedScopes(root, cfg);
  const sgGroup = scopeGatesGroup(planScopeGates(cfg, changed));

  // 4. Scope gates (only when the stage groups passed).
  if (failedStage === null && sgGroup !== undefined) {
    if (!(await runGroup(sgGroup, results, runOpts, out))) {
      failedStage = "scope_gates";
    }
  }

  // 5. Fix-stage strand detection (ADR 0034's sibling, ADR 0047): the fix stage may
  //     MUTATE the tree (that's its job), but a clean gate must not hide uncommitted
  //     fixer output. Flag only files that were CLEAN at finish-start and the fix stage
  //     dirtied (D1 \ D0) — so a fixer reworking the agent's own uncommitted edits (the
  //     inner loop) never trips, only one reformatting an already-COMMITTED file does.
  //     That stranded set is exactly what graduate would otherwise scoop up staged-but-
  //     uncommitted in the main checkout — commit the fixer output before you finish.
  let fixDriftDiag: Diagnostic | undefined;
  if (
    failedStage === null && dirtyBeforeFix !== null && dirtyAfterFix !== null
  ) {
    const stranded = fixDriftPaths(dirtyBeforeFix, dirtyAfterFix);
    if (stranded.length > 0) {
      failedStage = "fix_drift";
      fixDriftDiag = await fixDriftDiagnostic(root, stranded);
    }
  }

  // 6. Assemble the executed plan + result, attaching the agent-facing hints —
  //    the same next-step advice the human tail prints, promoted into the envelope.
  const plan = composeGatePlan(
    stageGroups,
    sgGroup,
    changed,
    guidanceOn,
    skillsOn,
  );
  const result = buildGateResult(plan, results, failedStage);
  // The currency checks aren't plan-group jobs, so their diagnostics (the diff / the
  // drift list + the `discern refresh` reproduce command) are attached here, like the
  // merge stage's failed_stage rides in `data` without a job entry.
  if (guidanceDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), guidanceDiag];
  }
  if (skillsDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), skillsDiag];
  }
  if (fixDriftDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), fixDriftDiag];
  }
  // Pre-setup, lead with the "setup unfinished" advisory (ADR 0065): finish runs
  // during setup, so a green gate here must not read as "done".
  const inProgress = setupInProgressHint(cfg.meta.bootstrapped);
  const hints = [
    ...(inProgress !== undefined ? [inProgress] : []),
    ...buildGateHints(cfg, changed, failedStage),
  ];
  if (hints.length > 0) {
    result.hints = hints;
  }
  return { result, failedStage, cfg, out, changed };
}

/**
 * The agent-facing "what next" hints for a finished gate — the SINGLE source of
 * the advice that rides in the `--json` envelope (`hints`) and is printed by the
 * human success tail. On a failure: where the project documents its known gate
 * failures (when a `gotchas_doc` is set). On success: update the docs, check the
 * ratchets, view a previewable change.
 */
function buildGateHints(
  cfg: DiscernConfig,
  changed: string[],
  failedStage: FailedStage | null,
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
      "Before pushing, check the ratchets with `discern ratchets` (slow, so not part of finish).",
    );
  }
  if (
    (cfg.worktree.resources.dev_server?.create ?? "") !== "" &&
    changed.includes(PREVIEWABLE_MARKER)
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
  if (unfilled === STAGES.length) {
    out.ok(
      "Gate passed — but no capability or check is wired, so nothing was actually checked (a no-op gate).",
    );
    out.warn(
      `Add [capabilities] (${capabilityList()}) to discern.toml so the gate has something to run.`,
    );
  } else {
    out.ok("Everything built and all checks passed.");
    if (unfilled > 0) {
      out.info(
        `${out.c.dim}note: ${unfilled} of ${STAGES.length} gate stages have no command yet.${out.c.reset}`,
      );
    }
  }
  for (const hint of hints) {
    out.info(hint);
  }
}

/**
 * Print the gate plan without running it (`--dry-run`): the leading fail-fast
 * preconditions (the merge check, then the guidance/skills currency checks), the
 * wired job groups, and the scope-gates selected for the changed scopes. Honest —
 * it lists "what would run"; it cannot predict which jobs fail-fast would skip.
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
 * Compute the `finish` {@link DiscernResult} without printing or exiting — the
 * entry point the MCP server (and any in-process caller) renders instead of the
 * CLI's stdout. `dryRun` returns the preview (the plan, nothing run); otherwise it
 * runs the gate, routing the human narration to stderr (json semantics) so a
 * caller owning stdout — like the MCP stdio channel — stays uncontaminated.
 */
export async function finishResult(
  root: string,
  opts: { dryRun?: boolean } = {},
): Promise<DiscernResult<GateData>> {
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
    renderFailureTail(out, {
      cfg,
      root,
      verb: "finish",
      headline: failMessage(failedStage),
      diagnostics: result.diagnostics ?? [],
    });
    return 1;
  }
  printSuccessTail(cfg, out, result.hints ?? []);
  return 0;
}
