/**
 * `done` — the full quality gate. Built on the plan/apply seam (ADR 0027): a
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
  checkTestGroup,
  composeGatePlan,
  gatePlanToEngine,
  type JobGroup,
  planScopeGates,
  scopeGatesGroup,
  stageGroup,
} from "./plan.ts";
import { gateRunContext, runGroup } from "./execute.ts";
import {
  type AdminStateWriteAuthority,
  clearStandardMeasurements,
  pinValidatedTree,
  preflightAdminStateWrites,
  recordGateOutcome,
  recordStandardMeasurements,
} from "./receipt.ts";
import { sweepDueTempArtifacts } from "../../shared/temp_artifacts.ts";
import { buildGateReceipt } from "./receipt_render.ts";
import { cmdsInStage } from "./stages.ts";
import { buildStandardPlan, standardJobLabel } from "./standard_plan.ts";
import {
  buildStandardJobs,
  fmtRate,
  type ResolvedStandard,
} from "./standards.ts";
import { verifyTrunkLimits } from "./standard_limits.ts";
import {
  gateStandardsData,
  planStandardJobsFromConfig,
  resolveStandardActions,
  resolveStandardActionsFromConfig,
} from "./standards_gate.ts";
import type {
  GateStandard,
  StandardsLimitsData,
} from "../../shared/result_schemas.ts";
import {
  type StageSnapshot,
  strandedByStage,
  treeDriftDiagnostic,
  worktreeDirtyPaths,
} from "./tree_drift.ts";
import { renderFailureTail } from "./failure_tail.ts";
import { diagnosticOutputFields } from "./diagnostic_output.ts";
import { classifyScopes, PREVIEWABLE_MARKER } from "../scopes/scopes.ts";
import { couplingGateHints } from "../coupling/coupling.ts";
import { colorEnabled, makeOut, type Out, outSink } from "../output.ts";
import {
  assertMainMerged,
  detectSilentDivergence,
  missingIntegrationBranchWarning,
} from "../worktree/git.ts";
import {
  type Diagnostic,
  type DiscernResult,
  type FailedStage,
  previewResult,
  renderPlan,
} from "../../shared/result.ts";
import type { GateData } from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import { setupInProgressHint } from "../../shared/setup_state.ts";
import {
  checkGuidanceCurrent,
  type GuidanceDriftEntry,
} from "../guidance_render.ts";
import { checkSkillsCurrent, type SkillsDriftEntry } from "../../lib/skills.ts";
import {
  gitLsFilesCommand,
  type TrackedDiscernIgnoredArtifacts,
  trackedDiscernIgnoredArtifacts,
  trackedDiscernIgnoredArtifactsHint,
} from "../../lib/agent_gitignore.ts";
import {
  writePreflightDiagnostic,
  type WritePreflightFailure,
  writePreflightFailureMessage,
} from "../../shared/write_preflight.ts";

/**
 * The human die message for each {@link FailedStage}. A TOTAL record (not a switch
 * with a `default`), so a new failed-stage label is a COMPILE error here until it is
 * given a message — it can never silently fall through to a generic "a stage failed".
 * Only `done` looks a message up (its `check`/`test` are fused into `check/test`);
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
  tree_drift:
    "The gate left uncommitted changes on tracked files — commit the gate's own output (the diagnostic names the stage that produced it), then re-run.",
  tracked_artifacts:
    "Discern-managed ignored artifacts are tracked by Git — remove them from the index, run `discern refresh`, then re-run.",
  guidance:
    "Generated agent files are out of date — run `discern refresh` (edits belong in your [guidance].sources, not the generated file, which a refresh overwrites).",
  skills:
    "Materialized skills are out of date — run `discern refresh` (edits belong in your [skills].dir source, not the materialized copy, which a refresh overwrites).",
  merge:
    "Run `discern update` to bring the trunk in and re-materialize, then re-run `discern done`.",
  standards:
    "A [standards] limit failed verification against the trunk — a limit only tightens on a branch; the diagnostics name each standard and both values.",
  write_access:
    "Discern cannot write the state this gate will persist — grant this command the write access named in diagnostics, then re-run.",
};

/** The human die message for a failed stage. Exported so `accept` names the stage
 * the same way when it refuses to land a branch the gate rejected (ADR 0067). */
export function failMessage(stage: FailedStage): string {
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
async function guidanceDiagnostic(
  stale: GuidanceDriftEntry[],
): Promise<Diagnostic> {
  const files = stale.map((d) => d.path).join(", ");
  const outputFields = await diagnosticOutputFields(
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
    ...outputFields,
  };
}

/**
 * A diagnostic for stale MATERIALIZED skills: which dirs/skills drifted from the
 * effective set, and the `discern refresh` that re-materializes them. The skills
 * analog of {@link guidanceDiagnostic} — same redirect (edit the source, not the
 * generated copy), so the two generated-artifact failures read identically.
 */
async function skillsDiagnostic(
  stale: SkillsDriftEntry[],
): Promise<Diagnostic> {
  const dirs = [...new Set(stale.map((d) => d.dir))].join(", ");
  const outputFields = await diagnosticOutputFields(
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
    ...outputFields,
  };
}

async function trackedArtifactsDiagnostic(
  tracked: TrackedDiscernIgnoredArtifacts,
): Promise<Diagnostic> {
  const outputFields = await diagnosticOutputFields(
    `${trackedDiscernIgnoredArtifactsHint(tracked)}\n\n` +
      `Tracked paths:\n${tracked.paths.map((p) => `  - ${p}`).join("\n")}`,
  );
  return {
    tool: "tracked-artifacts",
    severity: "error",
    message: `discern-managed ignored artifacts are tracked by Git: ${
      tracked.paths.join(", ")
    }`,
    reproduce_cmd: gitLsFilesCommand(tracked.repairTargets),
    ...outputFields,
  };
}

/** Run the gate once: plan, apply, build the result. */
async function runGate(
  root: string,
  json: boolean,
  signal?: AbortSignal,
): Promise<
  {
    result: DiscernResult<GateData>;
    failedStage: FailedStage | null;
    cfg: DiscernConfig;
    out: Out;
    changed: string[];
  }
> {
  // Pin the tree identity FIRST — before any precondition or job reads it. A green
  // outcome vouches for THIS (HEAD, clean) pair; recordGateOutcome re-verifies the
  // pin at stamp time, so a commit made while the gate runs can never earn a receipt
  // naming a tree the jobs never read.
  const treePin = await pinValidatedTree(root);
  // Retention for the job output artifacts the run is about to create (ADR 0117)
  // — before jobs spawn, so the sweep can never sit on a job's kill path.
  await sweepDueTempArtifacts();
  const cfg = await loadConfig(root);
  // Human: gate narration + job output → stdout. --json:
  // quiet — the result envelope is the entire output (ADR 0030), so the runner
  // and the Out are silenced and nothing streams to any fd. The shared run context
  // (job RunOptions + the narration Out) is the one `prepare`/`test` use too.
  const { runOpts, out } = gateRunContext(root, cfg, json, signal);

  const results = new Map<string, JobResult>();
  let failedStage: FailedStage | null = null;
  let writeAuthority: AdminStateWriteAuthority | undefined;
  let writeAccessFailure: WritePreflightFailure | undefined;
  let writeAccessDiag: Diagnostic | undefined;

  // 1. Merge precondition — checked FIRST and fail-fast (ADR 0050). The merge-base
  //    relationship is invariant across the gate (finish never fetches or commits, so
  //    neither HEAD nor main moves), so checking here gives the SAME answer as checking
  //    last would — but a branch behind main must update and re-run regardless,
  //    which discards whatever the gate computed against the pre-integration tree.
  //    Front-loading it skips the expensive fix/build/check/test in exactly that case.
  //    No-op in the main checkout / outside a worktree (assertMainMerged self-skips),
  //    so the happy path pays one extra `merge-base --is-ancestor` and nothing more.
  const mainBranch = Deno.env.get("DISCERN_MAIN_BRANCH") ||
    cfg.repository.trunk;
  let mergeWarning: string | undefined;
  const merged = await assertMainMerged(root, mainBranch);
  if (merged.kind === "behind") {
    failedStage = "merge";
  } else if (merged.kind === "missing") {
    mergeWarning = missingIntegrationBranchWarning(merged.branch);
    out.warn(mergeWarning);
  }

  // 1a. The never-loosen verification (Tier 1, ADR 0133) — every configured
  //     [standards] limit against the trunk's committed copy, deletions included.
  //     Placed HERE, directly after the merge check: it is the cheapest
  //     precondition after it (one git read, milliseconds), it guards the very
  //     config every later job table was built from, and the merge check must
  //     precede it so the baseline is the freshest merged-in trunk copy. Not
  //     configurable — an escape hatch here would defeat the guarantee the
  //     product leads with. An unreadable trunk skips LOUDLY (a warning + the
  //     receipt discloses it); a trunk config that was fetched but does not
  //     parse fails hard; never a silent pass either way.
  const stdPlan = buildStandardPlan(cfg);
  let standardsLimits: StandardsLimitsData | undefined;
  let tier1Diagnostics: Diagnostic[] = [];
  let limitsWarning: string | undefined;
  if (failedStage === null) {
    const verification = await verifyTrunkLimits(
      root,
      mainBranch,
      stdPlan.standards,
    );
    tier1Diagnostics = verification.diagnostics;
    if (verification.blocking) {
      failedStage = "standards";
    }
    // With no standards anywhere (none configured, none on the trunk), the
    // verification is vacuous — carry nothing, so a standards-free project's
    // result stays byte-identical to before.
    if (
      stdPlan.standards.length > 0 ||
      verification.summary.status === "loosened" ||
      verification.summary.status === "parse_failed"
    ) {
      standardsLimits = verification.summary;
    }
    if (standardsLimits?.status === "unverified") {
      limitsWarning =
        `Standards limits are UNVERIFIED — the never-loosen check could not read the trunk (${
          standardsLimits.reason ?? "unknown"
        }). Fetch the trunk where the gate runs (in CI: \`git fetch origin ${mainBranch}:${mainBranch}\`) so limits are verified.`;
      out.warn(limitsWarning);
    }
  }

  // 1a-bis. Silent divergence: the gate is running in a PRISTINE worktree while
  //     the main checkout accumulates uncommitted changes — the signature of an
  //     agent that could not re-root and is editing the trunk while validating
  //     here. Advisory (a warning + hint, never a failure — the pre-existing-dirt
  //     case is legitimate), sharing status's wording via one helper.
  const divergenceWarning = await detectSilentDivergence(root, mainBranch);
  if (divergenceWarning !== undefined) {
    out.warn(divergenceWarning);
  }

  // 1b. Discern-owned ignored artifacts must not be tracked. A forced `git add -f`
  //     can put materialized skills or machine-local provider state into the index
  //     despite the canonical .gitignore block. Scoped to that block's enumerated
  //     rules, so the tracked-by-default compiled guidance files and a user's own
  //     files under a provider directory are never flagged.
  let trackedArtifactsDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const tracked = await trackedDiscernIgnoredArtifacts(root);
    if (tracked.paths.length > 0) {
      failedStage = "tracked_artifacts";
      trackedArtifactsDiag = await trackedArtifactsDiagnostic(tracked);
    }
  }

  // 1c. Generated-artifacts currency — guidance (ADR 0034) — also runs FIRST, as a
  //     fail-fast precondition beside the merge check (ADR 0056). Its verdict is
  //     invariant across the gate for the same reason the merge check's is: the gate
  //     never runs `discern refresh`, and its fix stage formats SOURCE code, never the
  //     guidance sources or the generated agent files those checks read —
  //     so checking here gives the same answer as checking last, while skipping the
  //     slow build/check∥test/scope-gate sweep when the only problem is stale drift the
  //     agent must `discern refresh` and re-run to clear regardless. Block a STALE agent
  //     file only (a MISSING one is tolerated: a tree that has not built them yet, or a
  //     project that deliberately keeps them untracked — see ADR 0034/0128).
  //     discern-allow-retrospective: "no longer matching" is the live drift this detects.
  let guidanceDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const stale = (await checkGuidanceCurrent(root, cfg))
      .filter((d) => d.reason === "stale");
    if (stale.length > 0) {
      failedStage = "guidance";
      guidanceDiag = await guidanceDiagnostic(stale);
    }
  }

  // 1d. Materialized-skills currency (ADR 0034, extended to skills) — the same
  //     fail-fast precondition for the skills dirs. STALE blocks; MISSING (the whole
  //     dir absent on a fresh checkout) and FOREIGN (an unmanaged drop-in) do not.
  let skillsDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const stale = (await checkSkillsCurrent(root, cfg))
      .filter((d) => d.reason === "stale");
    if (stale.length > 0) {
      failedStage = "skills";
      skillsDiag = await skillsDiagnostic(stale);
    }
  }

  // 1e. Write authority — a REAL create/write/rename/remove probe, not permission
  //     metadata. The gate may need to stamp or clear its gate/measurement state
  //     after every outcome, so prove that tiny late effect before any project job
  //     can consume minutes. The branded token is then required by every writer.
  //     A denial on an otherwise-runnable gate is therefore an immediate failure,
  //     with the exact path in diagnostics, rather than a green-but-unreceipted run
  //     that `accept` has to repeat. Existing cheap preconditions retain priority;
  //     when one already blocked, a successful probe merely lets its red outcome
  //     clear stale state, and a denied probe does not hide the actionable blocker.
  const writePreflight = await preflightAdminStateWrites(root);
  if (writePreflight.ok) {
    writeAuthority = writePreflight.authority;
  } else {
    writeAccessFailure = writePreflight;
    if (failedStage === null) {
      failedStage = "write_access";
      writeAccessDiag = writePreflightDiagnostic(
        writePreflight,
        "discern done",
      );
    }
  }

  // 2. Run the capability/check stage groups (fix → build → check∥test). These do
  //    not depend on the changed scopes, so they run before scope classification.
  //    ANY stage may mutate the tree — the fix stage by design, a build/test/scope
  //    gate by accident of wiring (a regenerated tracked artifact, a rewritten
  //    golden file) — so snapshot the working-tree dirty set before any group runs
  //    and again after each green group. The strand check (step 5) flags files a
  //    stage dirtied that were committed-clean at gate start — the uncommitted gate
  //    output a green result would otherwise hide (ADR 0047, extended by ADR 0148)
  //    — and the per-group snapshots attribute each strand to the stage that
  //    produced it. Snapshots are skipped once a stage has failed (the strand
  //    check only runs on an otherwise-green gate); an unreadable snapshot voids
  //    the check (fail-open: a missing snapshot must never fabricate a failure).
  const preGroups = [stageGroup(cfg, "fix"), stageGroup(cfg, "build")]
    .filter((g): g is JobGroup => g !== undefined);
  const dirtyAtStart = failedStage === null
    ? await worktreeDirtyPaths(root)
    : null;
  const stageSnapshots: StageSnapshot[] = [];
  let snapshotsValid = dirtyAtStart !== null;
  const snapshotAfter = async (stage: FailedStage): Promise<void> => {
    if (!snapshotsValid) {
      return;
    }
    const dirty = await worktreeDirtyPaths(root);
    if (dirty === null) {
      snapshotsValid = false;
      return;
    }
    stageSnapshots.push({ stage, dirty });
  };
  for (const group of preGroups) {
    if (failedStage !== null) {
      break;
    }
    if (!(await runGroup(group, results, runOpts, out))) {
      failedStage = group.stage;
      break;
    }
    await snapshotAfter(group.stage);
  }

  // 2a. Resolve the standards' gate actions AFTER the fix stage — a fixer's
  //     edits are changes an input-keyed replay must count — and only on the
  //     live path: when a precondition or an early stage already failed, the
  //     config-only resolution (measure/defer; replay is a run-time decision)
  //     keeps the report honest without claiming replays nothing verified.
  //     Zero cost when [standards] is empty: no jobs, no reads, no fields.
  const resolved: ResolvedStandard[] = stdPlan.standards.length === 0
    ? []
    : failedStage === null
    ? await resolveStandardActions(root, stdPlan.standards)
    : resolveStandardActionsFromConfig(stdPlan.standards);
  const gateStandards = buildStandardJobs(root, resolved);
  const checkTest = checkTestGroup(cfg, gateStandards.jobs);

  // 2b. The check∥test group — capabilities, checks, tests, AND the standards'
  //     measurement jobs, one parallel group under one scheduler (fail-fast,
  //     buffering, the per-job timeout). Replayed standards settle first: their
  //     synthesized results are seeded so the serialization reads them like any
  //     other outcome — and a replayed value the branch's own tightened limit
  //     now fails is a genuine gate failure.
  let replayFailure = false;
  if (failedStage === null && checkTest !== undefined) {
    for (const [label, result] of gateStandards.synthesized) {
      results.set(label, result);
      if (result.code !== 0) {
        replayFailure = true;
      }
    }
    if (
      !(await runGroup(
        checkTest,
        results,
        runOpts,
        out,
        gateStandards.evaluators,
      ))
    ) {
      failedStage = "check/test";
    } else if (replayFailure) {
      failedStage = "check/test";
    } else {
      await snapshotAfter("check/test");
    }
  }
  const stageGroups = checkTest !== undefined
    ? [...preGroups, checkTest]
    : preGroups;

  // 3. Classify the changed scopes AFTER the stage groups — preserving the gate's
  //    original timing, so a fix-stage edit is reflected and scope selection keeps
  //    its fail-open bias (it never runs FEWER gates than the post-fix tree warrants).
  //    Computed even when the merge precondition failed, so the result still lists the
  //    scopes (their gates serialize as skipped, like every other downstream step).
  const changed = await classifyScopes(root, cfg);
  const sgGroup = scopeGatesGroup(planScopeGates(cfg, changed));

  // 4. Scope gates (only when the stage groups passed).
  if (failedStage === null && sgGroup !== undefined) {
    if (!(await runGroup(sgGroup, results, runOpts, out))) {
      failedStage = "scope_gates";
    } else {
      await snapshotAfter("scope_gates");
    }
  }

  // 5. Strand detection (ADR 0034's sibling; ADR 0047, extended by ADR 0148): a
  //     stage may MUTATE the tree (the fix stage by design, any other by accident of
  //     wiring), but a clean gate must not hide uncommitted gate output. Flag only
  //     files that were CLEAN at finish-start and a stage left dirty — so a stage
  //     reworking the agent's own uncommitted edits (the inner loop) never trips,
  //     only one touching an already-COMMITTED file does — and name the stage that
  //     produced each strand. That stranded set is exactly what a final clean check
  //     must surface early — commit the gate's output before you finish.
  let treeDriftDiag: Diagnostic | undefined;
  if (failedStage === null && dirtyAtStart !== null && snapshotsValid) {
    const strands = strandedByStage(dirtyAtStart, stageSnapshots);
    if (strands.length > 0) {
      failedStage = "tree_drift";
      treeDriftDiag = await treeDriftDiagnostic(root, strands);
    }
  }

  // 6. Assemble the executed plan + result, attaching the agent-facing hints —
  //    the same next-step advice the human tail prints, promoted into the envelope.
  const plan = composeGatePlan(stageGroups, sgGroup, changed);
  const result = await buildGateResult(plan, results, failedStage);
  const jobOutputHints = result.hints ?? [];
  // 6a. The standards' envelope fields (ADR 0133): the per-standard outcomes and
  //     the Tier-1 verification, plus the measured value patched into each
  //     measured step's note — the receipt renders FROM these, never a second
  //     computation.
  const standardsData: GateStandard[] = gateStandardsData(
    resolved,
    gateStandards,
  );
  if (result.data !== undefined) {
    if (standardsData.length > 0) {
      result.data.standards = standardsData;
    }
    if (standardsLimits !== undefined) {
      result.data.standards_limits = standardsLimits;
    }
  }
  for (const o of standardsData) {
    if (o.measurement !== "measured" || o.value === undefined) {
      continue;
    }
    const step = (result.steps ?? []).find(
      (s) => s.step.label === standardJobLabel(o.name),
    );
    if (step !== undefined && step.step.note !== undefined) {
      step.step.note = `${step.step.note}, measured ${fmtRate(o.value)}`;
    }
  }
  // The fail-fast checks aren't plan-group jobs, so their diagnostics are attached
  // here, like the merge stage's failed_stage rides in `data` without a job entry.
  if (tier1Diagnostics.length > 0) {
    result.diagnostics = [
      ...tier1Diagnostics,
      ...(result.diagnostics ?? []),
    ];
  }
  if (trackedArtifactsDiag !== undefined) {
    result.diagnostics = [
      ...(result.diagnostics ?? []),
      trackedArtifactsDiag,
    ];
  }
  if (guidanceDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), guidanceDiag];
  }
  if (skillsDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), skillsDiag];
  }
  if (writeAccessDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), writeAccessDiag];
  }
  if (treeDriftDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), treeDriftDiag];
  }
  // The receipt (v1): a GREEN run over a CLEAN committed tree ahead of the trunk
  // renders the compact review summary from this very envelope — the artifact the
  // agent relays to its owner at the review moment. Built before the marker write so
  // the marker can store the markdown beside the sha it vouches for.
  const receipt = failedStage === null
    ? await buildGateReceipt(
      root,
      mainBranch,
      result.steps ?? [],
      standardsData,
      standardsLimits,
    )
    : undefined;
  // Record the measurement receipt (ADR 0112, extended by ADR 0133): a green
  // gate over a clean committed tree records every value it holds (measured or
  // replayed — a replayed value is a real measurement of an identical input
  // set), so an immediate `standards --pin` replays instead of re-measuring and
  // the next gate run has a baseline to replay against. Durations ride along so
  // a defer decision can be made from data. Fail-closed on red: a failing
  // standard's values must not stay reusable.
  if (failedStage === null) {
    const values: Record<string, number> = {};
    const durations: Record<string, number> = {};
    for (const o of standardsData) {
      if (
        o.value !== undefined &&
        (o.measurement === "measured" || o.measurement === "replayed")
      ) {
        values[o.name] = o.value;
        if (o.duration_s !== undefined) {
          durations[o.name] = o.duration_s;
        }
      }
    }
    if (Object.keys(values).length > 0 && writeAuthority !== undefined) {
      await recordStandardMeasurements(
        root,
        writeAuthority,
        values,
        treePin,
        durations,
      );
    }
  } else if (
    writeAuthority !== undefined &&
    standardsData.some(
      (o) =>
        o.verdict === "regressed" ||
        (o.measurement === "measured" && o.value === undefined),
    )
  ) {
    await clearStandardMeasurements(root, writeAuthority);
  }
  // Record the gate receipt (ADR 0067): a GREEN run over a CLEAN tree stamps the
  // HEAD pinned at gate start so `accept` can prove THIS tree already passed without
  // re-running the gate; a FAILED run clears any stale vouch. Write authority was a
  // fail-fast precondition; the writer remains best-effort only against a later
  // point-in-time failure, whose outcome rides in `data` for suppressed loggers.
  const gateReceipt: NonNullable<GateData["gate_receipt"]> =
    writeAuthority === undefined
      ? {
        status: "unavailable",
        ...(writeAccessFailure !== undefined
          ? {
            path: writeAccessFailure.path,
            reason: writePreflightFailureMessage(writeAccessFailure),
          }
          : { reason: "write authority was not established" }),
      }
      : await recordGateOutcome(
        root,
        writeAuthority,
        failedStage === null,
        treePin,
        receipt?.markdown,
      );
  // A stamp refused because HEAD moved mid-run also suppresses the rendered review
  // receipt: its git facts were gathered AFTER the move, so its markdown describes a
  // tree the gate never read — the hint tells the agent to re-run on the final commit.
  const emittedReceipt = gateReceipt.status === "skipped_head_moved"
    ? undefined
    : receipt;
  if (result.data !== undefined) {
    result.data.gate_receipt = gateReceipt;
    if (emittedReceipt !== undefined) {
      result.data.receipt = emittedReceipt;
    }
  }
  // Pre-setup, lead with the "setup unfinished" advisory (ADR 0065): finish runs
  // during setup, so a green gate here must not read as "done".
  const inProgress = setupInProgressHint(cfg.meta.bootstrapped);
  // The co-change advisory (ADR 0084), behind [coupling].in_gate (default off) — at the
  // TAIL, with strand detection, because it READS THE DIFF (dependency-bearing), never a
  // fail-fast precondition. Only on a GREEN, bootstrapped run: a half-set-up install
  // behaves as if coupling were off (its in-session setup must stay uncluttered), and a
  // failed gate is not the moment for an advisory. Best-effort and never blocking — it
  // touches only `hints`, so it can't move `ok` / the exit code / `failed_stage`.
  const couplingHints =
    failedStage === null && cfg.meta.bootstrapped && cfg.coupling.in_gate
      ? await couplingGateHints(root)
      : [];
  const receiptHint = gateReceiptHint(gateReceipt, failedStage);
  const deferredStandards = standardsData
    .filter((o) => o.measurement === "deferred")
    .map((o) => o.name);
  const hints = [
    ...(inProgress !== undefined ? [inProgress] : []),
    ...(mergeWarning !== undefined ? [mergeWarning] : []),
    ...(divergenceWarning !== undefined ? [divergenceWarning] : []),
    ...(limitsWarning !== undefined ? [limitsWarning] : []),
    ...(receiptHint !== undefined ? [receiptHint] : []),
    ...buildGateHints(
      cfg,
      changed,
      failedStage,
      emittedReceipt !== undefined,
      deferredStandards,
    ),
    ...jobOutputHints,
    ...couplingHints,
  ];
  if (hints.length > 0) {
    result.hints = hints;
  }
  return { result, failedStage, cfg, out, changed };
}

function gateReceiptHint(
  receipt: NonNullable<GateData["gate_receipt"]>,
  failedStage: FailedStage | null,
): string | undefined {
  const reason = receipt.reason !== undefined ? ` (${receipt.reason})` : "";
  if (failedStage === null) {
    switch (receipt.status) {
      case "recorded":
        return undefined;
      case "skipped_dirty":
        return `Gate passed, but no gate receipt was recorded because the worktree is dirty${reason}. Use \`discern prepare\` or \`discern test\` while iterating, then commit the intended final tree and re-run \`discern done\` on the clean HEAD before handoff or acceptance.`;
      case "skipped_head_moved":
        return `Gate passed, but no gate receipt was recorded because HEAD moved while the gate was running${reason} — the receipt can only vouch for the exact tree the gate tested. Re-run \`discern done\` on the final commit before handoff or acceptance.`;
      case "record_failed":
        return `Gate passed, but discern could not record the gate receipt${reason}; \`discern accept\` will re-run the gate unless a later \`discern done\` run records one.`;
      case "unavailable":
        return `Gate passed, but discern could not prepare the gate receipt${reason}; \`discern accept\` may need to re-run the gate.`;
      case "cleared":
      case "clear_failed":
        return undefined;
    }
  }
  if (receipt.status === "clear_failed") {
    return `The gate failed, and discern could not clear the previous gate receipt${reason}; re-run \`discern done\` after fixing the failure.`;
  }
  return undefined;
}

/**
 * The agent-facing "what next" hints for a finished gate — the SINGLE source of
 * the advice that rides in the `--json` envelope (`hints`) and is printed by the
 * human success tail. On a failure: where the project documents its known gate
 * failures (when a `gotchas_doc` is set). On success: update the docs, run any
 * deferred standards, view a previewable change.
 */
function buildGateHints(
  cfg: DiscernConfig,
  changed: string[],
  failedStage: FailedStage | null,
  receiptEmitted: boolean,
  deferredStandards: string[],
): string[] {
  if (failedStage !== null) {
    const doc = cfg.project.gotchas_doc;
    return doc !== ""
      ? [
        `If the failure above isn't self-explanatory, this project's known gate failures and their fixes are documented in ${doc}.`,
      ]
      : [];
  }
  const hints = receiptEmitted
    ? [
      "If this completes the task, relay the receipt to your owner and stop; run `discern accept` only once they accept.",
    ]
    : [];
  hints.push(
    "If you changed documented behaviour, update the docs to match before you finish.",
  );
  if (deferredStandards.length > 0) {
    hints.push(
      `${deferredStandards.length} standard(s) deferred from the gate (measure = "on-demand"): ${
        deferredStandards.join(", ")
      } — the never-loosen limit check still ran; measure them with \`discern standards\` as needed.`,
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
 * note, the receipt when one was emitted (the same markdown the envelope carries),
 * then the same `hints` the envelope carries (so human and machine agree). */
function printSuccessTail(
  cfg: DiscernConfig,
  out: Out,
  hints: string[],
  receiptMarkdown?: string,
): void {
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
  if (receiptMarkdown !== undefined) {
    out.raw(`\n${receiptMarkdown}\n\n`);
  }
  for (const hint of hints) {
    out.info(hint);
  }
}

/**
 * Print the gate plan without running it (`--dry-run`): the leading fail-fast
 * preconditions (the merge check, tracked-artifacts guard, then the guidance/skills
 * currency checks), the wired job groups, and the scope-gates selected for the
 * changed scopes. Honest — it lists "what would run"; it cannot predict which jobs
 * fail-fast would skip.
 */
async function dryRunGate(
  root: string,
  json: boolean,
): Promise<number> {
  const cfg = await loadConfig(root);
  const changed = await classifyScopes(root, cfg);
  const plan = buildGatePlan(cfg, changed, dryRunStandardJobs(cfg));
  const engine = gatePlanToEngine(plan);
  if (json) {
    // A preview is a DiscernResult carrying `plan` + `dry_run` (no `steps`).
    emitResult(previewResult("done", engine));
    return 0;
  }
  renderPlan(outSink(makeOut(colorEnabled())), engine);
  return 0;
}

/**
 * Compute the `done` {@link DiscernResult} without printing or exiting — the
 * entry point the MCP server (and any in-process caller) renders instead of the
 * CLI's stdout. `dryRun` returns the preview (the plan, nothing run); otherwise it
 * runs the gate, routing the human narration to stderr (json semantics) so a
 * caller owning stdout — like the MCP stdio channel — stays uncontaminated.
 * Aborting `signal` (the caller cancelling the call, or shutting down) tree-kills
 * the in-flight gate jobs and returns the run as failed-with-cancellations.
 */
export async function finishResult(
  root: string,
  opts: { dryRun?: boolean; signal?: AbortSignal } = {},
): Promise<DiscernResult<GateData>> {
  if (opts.dryRun ?? false) {
    const cfg = await loadConfig(root);
    const changed = await classifyScopes(root, cfg);
    return previewResult(
      "done",
      gatePlanToEngine(buildGatePlan(cfg, changed, dryRunStandardJobs(cfg))),
    );
  }
  return (await runGate(root, true, opts.signal)).result;
}

/** The standards jobs a `--dry-run` plan lists: the pure, config-only
 * resolution (measure or defer). A replay is a run-time decision over the tree
 * and the recorded baseline, which an honest plan cannot predict — a measured
 * standard listed here may still replay when the real run finds its inputs
 * untouched. */
function dryRunStandardJobs(
  cfg: DiscernConfig,
): ReturnType<typeof planStandardJobsFromConfig> {
  return planStandardJobsFromConfig(buildStandardPlan(cfg).standards);
}

/** Run `done`. Returns a process exit code. */
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
      verb: "done",
      headline: failMessage(failedStage),
      diagnostics: result.diagnostics ?? [],
    });
    return 1;
  }
  printSuccessTail(
    cfg,
    out,
    result.hints ?? [],
    result.data?.receipt?.markdown,
  );
  return 0;
}
