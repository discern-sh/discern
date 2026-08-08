/**
 * The gate's **pure planning core** — "given the typed config and the changed
 * scopes, which jobs and scope-gates run." Everything here is a pure function of
 * its arguments: no subprocess, no git, no filesystem. The effectful executor
 * lives in `finish.ts`; the read-only I/O (loading config, classifying changed
 * scopes) is the caller's, passed in as arguments.
 *
 * The plan carries the gate's stages as DATA — an ordered list of {@link JobGroup}
 * — not baked into the type. The current gate unrolls `fix → build → check∥test →
 * scope-gates` by hand; a future change will resolve a `needs`/`provides` DAG by
 * topological sort and PRODUCE this same `GatePlan` (a different `groups` list),
 * so the executor and the report never need to know which produced it.
 */

import { type DiscernConfig, toCommand } from "../../shared/config_schema.ts";
import type { Stage } from "../../shared/capabilities.ts";
import { jobsInStage } from "./stages.ts";
import { diagnosticOutputFields } from "./diagnostic_output.ts";
import { normalizeDiagnostics } from "./diagnostics.ts";
import type { GateData } from "../../shared/result_schemas.ts";
import type { JobResult } from "../jobs/types.ts";
import {
  fire,
  type FiredHint,
  gateFailureRemedy,
  HINTS,
  hintTexts,
} from "../../shared/hints.ts";
import { expandMapDirReference } from "../../shared/map_path.ts";
import type {
  Diagnostic,
  DiscernResult,
  EnginePlan,
  FailedStage,
  PlanStep,
  StepKind,
  StepOutcome,
  StepResult,
} from "../../shared/result.ts";

const LOUD_SUCCESS_ERROR_LIKE_LINES = 10;

/** Labels distinguish the gate's initial refresh convergence check from the
 * repeated check that binds the final proof to the post-job tree. */
export const TRACKED_REFRESH_CHECK_LABEL = "tracked-refresh-check";
export const TRACKED_REFRESH_PROOF_CHECK_LABEL =
  "tracked-refresh-check (proof boundary)";

/**
 * A gate job as planned: the command to run plus the metadata the ADR-0004 report
 * needs. `willRun` is false for a configured-but-unchanged scope gate and for a
 * standard whose measurement is replayed or deferred (each listed and reported
 * with its `note`); declared jobs are always planned to run —
 * fail-fast skips can't be predicted at plan time (the dry-run honesty rule).
 */
export interface PlannedJob {
  label: string;
  command: string;
  kind: "known" | "custom" | "generated" | "scope-gate" | "standard";
  /** The stage reported in `jobs[].stage` (a real STAGE), or "scope_gates". */
  reportStage: Stage | "scope_gates";
  willRun: boolean;
  /** Per-job `timeout` override, replacing the global `[gate].timeout` for this
   * job only (`0` disables the bound for it). */
  timeoutS?: number;
  /** Overrides the serialized step note (the default is the command when the job
   * runs) — a standard's measurement note, a replay/deferral explanation. */
  note?: string;
}

/**
 * A scheduled group of jobs — the unit the executor walks. A future needs/provides
 * resolver produces these (topological layers) instead of the hand-unroll.
 */
export interface JobGroup {
  /** The {@link FailedStage} label this group reports when it fails (fix | build |
   * check | test | check/test | scope_gates). */
  stage: FailedStage;
  /** How the group's jobs are scheduled. */
  mode: "serial" | "parallel";
  /** The heading shown while the group runs (the current finish narration). */
  heading: string;
  /** A short label for the dry-run plan listing. */
  display: string;
  jobs: PlannedJob[];
}

/**
 * A pure, inspectable description of one gate run: the ordered job groups, whether
 * the merge check fires, and the scopes the branch changed. Built before any job
 * spawns; executed by `executeGatePlan`; serialized to the ADR-0004 report.
 */
export interface GatePlan {
  groups: JobGroup[];
  /** The never-loosen verification of [standards] limits against the trunk runs as
   * a fail-fast precondition directly after the merge check (ADR 0133) — vacuous
   * when neither the branch nor the trunk configures a standard. Always true (the
   * field gates its plan-listing, not its run). */
  standardsLimitsCheck: boolean;
  /** The generated-artifacts currency check runs as a fail-fast precondition, beside
   * the merge check (ADR 0034, front-loaded by ADR 0056). Blocks on a STALE agent
   * file. Always true (the field gates its plan-listing, not its run). */
  guidanceCheck: boolean;
  /** The materialized-skills currency check (ADR 0034, extended to skills). A
   * fail-fast precondition like guidance; blocks on a STALE skills dir. Always true
   * (the field gates its plan-listing, not its run). */
  skillsCheck: boolean;
  /** The complete tracked-refresh plan must be empty before and after gate jobs. */
  trackedRefreshCheck: boolean;
  /** The merge check runs FIRST, as a fail-fast precondition (ADR 0050); it self-skips
   * in the main checkout. Always true (the field gates its plan-listing, not its run). */
  mergeCheck: boolean;
  /** The tracked-artifacts guard runs as a fail-fast precondition after the merge check.
   * It blocks when a discern-managed ignored artifact was force-added to Git. */
  trackedArtifactsCheck: boolean;
  scopesChanged: string[];
}

/**
 * The declared jobs for a real gate stage (fix|build|check|test), as
 * planned jobs. Pure: derived from the typed config alone.
 */
export function planStageJobs(cfg: DiscernConfig, stage: Stage): PlannedJob[] {
  return jobsInStage(cfg, stage).map((j) => ({
    label: j.label,
    command: j.command,
    kind: j.kind,
    reportStage: stage,
    willRun: true,
    ...(j.timeoutS !== undefined ? { timeoutS: j.timeoutS } : {}),
  }));
}

/**
 * The scope-gate jobs, in declared order — every scope with a non-empty gate,
 * marked `willRun` only when its scope is among `changed`. Pure: config + the
 * changed-scope list (the read-only classification is the caller's). This is the
 * scope-gate SELECTION logic, unit-tested with zero I/O.
 */
export function planScopeGates(
  cfg: DiscernConfig,
  changed: string[],
): PlannedJob[] {
  const out: PlannedJob[] = [];
  for (const [scope, spec] of Object.entries(cfg.scopes)) {
    const command = expandMapDirReference(
      toCommand(spec.gate),
      cfg.map.dir,
    );
    if (command === "") {
      continue;
    }
    out.push({
      label: `scope:${scope}`,
      command,
      kind: "scope-gate",
      reportStage: "scope_gates",
      willRun: changed.includes(scope),
      ...(spec.timeout !== undefined ? { timeoutS: spec.timeout } : {}),
    });
  }
  return out;
}

/**
 * Display metadata for a single stage's job group — the runner heading, the dry-run
 * label, and how the stage's jobs are scheduled. The fix stage is serial (a later
 * fixer may depend on an earlier one's edits); the rest run in parallel. `done`
 * runs check and test as ONE combined group ({@link checkTestGroup}), so these
 * check/test headings are used only by `prepare` (check) and `discern test` (test).
 */
const STAGE_GROUP_META: Record<
  Stage,
  { mode: "serial" | "parallel"; heading: string; display: string }
> = {
  fix: { mode: "serial", heading: "Applying fixers...", display: "Fix" },
  build: {
    mode: "parallel",
    heading: "Building artifacts...",
    display: "Build",
  },
  check: { mode: "parallel", heading: "Checking...", display: "Check" },
  test: { mode: "parallel", heading: "Running tests...", display: "Test" },
};

/**
 * A single stage's job group, or undefined when the stage has no real job. The unit
 * `prepare` (fix, generated, check) and `discern test` (test) compose directly;
 * `done` uses it for fix and build, and runs check∥test as one combined group.
 */
export function stageGroup(
  cfg: DiscernConfig,
  stage: Stage,
): JobGroup | undefined {
  const jobs = planStageJobs(cfg, stage);
  if (jobs.length === 0) {
    return undefined;
  }
  const meta = STAGE_GROUP_META[stage];
  return {
    stage,
    mode: meta.mode,
    heading: meta.heading,
    display: meta.display,
    jobs,
  };
}

/**
 * The combined check∥test group `done` runs — both stages' jobs, plus the
 * standards' measurement jobs, in ONE parallel group, so the read-only checks,
 * the tests, and the measurements all overlap (never a serial tail). (`prepare`
 * runs the check stage alone; `discern test` runs the test stage alone — each
 * via {@link stageGroup} — so neither ever measures a standard.)
 */
export function checkTestGroup(
  cfg: DiscernConfig,
  standardJobs: PlannedJob[] = [],
): JobGroup | undefined {
  const jobs = [
    ...planStageJobs(cfg, "check"),
    ...planStageJobs(cfg, "test"),
    ...standardJobs,
  ];
  if (jobs.length === 0) {
    return undefined;
  }
  return {
    stage: "check/test",
    mode: "parallel",
    heading: "Checking and testing...",
    display: "Check & test",
    jobs,
  };
}

/**
 * The check/test portion of the `done` plan, shaped by the fleet test-run cap.
 * Uncapped (`[gate].concurrent_test_runs = 0`, the default): the one combined
 * check∥test group ({@link checkTestGroup}) — byte-identical to the plan before
 * the cap existed. Capped: the check stage runs first as its own group, then
 * the tests and standard measurements follow as one group, which is the unit
 * that holds a fleet slot. The split trades the check∥test overlap (seconds —
 * the check stage is lint and typecheck) for the fail-fast guarantee the cap
 * requires: a broken check must fail before the run queues for a slot.
 */
export function checkTestGroups(
  cfg: DiscernConfig,
  standardJobs: PlannedJob[] = [],
): JobGroup[] {
  if (cfg.gate.concurrent_test_runs <= 0) {
    const combined = checkTestGroup(cfg, standardJobs);
    return combined === undefined ? [] : [combined];
  }
  const groups: JobGroup[] = [];
  const check = stageGroup(cfg, "check");
  if (check !== undefined) {
    groups.push(check);
  }
  const testJobs = [...planStageJobs(cfg, "test"), ...standardJobs];
  if (testJobs.length > 0) {
    groups.push({
      stage: "test",
      mode: "parallel",
      heading: standardJobs.length > 0
        ? "Running tests and measuring standards..."
        : STAGE_GROUP_META.test.heading,
      display: standardJobs.length > 0 ? "Test & standards" : "Test",
      jobs: testJobs,
    });
  }
  return groups;
}

/**
 * The stages whose job groups run BEFORE `done`'s strand checkpoint — the
 * tree-mutating pre-groups (fix by design, build by wiring). The checkpoint
 * sits after ALL of them, never between: a later pre-group may consume or
 * restore an earlier one's edits, so convergence is judged once, on their
 * combined result.
 */
export const PRE_CHECKPOINT_STAGES: readonly Stage[] = ["fix", "build"];

/**
 * The pre-checkpoint job groups — fix (serial), then build — the single
 * derivation `done`'s executor and {@link buildStageGroups} both consume, so
 * the dry-run plan and the executed gate can never disagree on what runs
 * before the strand checkpoint.
 */
export function preCheckpointGroups(cfg: DiscernConfig): JobGroup[] {
  return PRE_CHECKPOINT_STAGES
    .map((stage) => stageGroup(cfg, stage))
    .filter((g): g is JobGroup => g !== undefined);
}

/**
 * The declared-job groups — fix (serial) → build → check∥test — derived
 * from the typed config alone. These are independent of the changed scopes, so the
 * executor can run them BEFORE classifying scopes (preserving the gate's original
 * timing, where a fix-stage edit is reflected in the scope classification).
 * `standardJobs` (when `[standards]` is configured) join the check∥test group;
 * with none, the plan is byte-identical to a standards-free gate — zero cost.
 * The check/test portion comes from {@link checkTestGroups}, so the dry-run
 * plan and the executed gate agree on whether the fleet test-run cap splits it.
 */
export function buildStageGroups(
  cfg: DiscernConfig,
  standardJobs: PlannedJob[] = [],
): JobGroup[] {
  return [...preCheckpointGroups(cfg), ...checkTestGroups(cfg, standardJobs)];
}

/** The display label of the `[generated]` regeneration group `prepare` runs —
 * exported so prepare's summary can recognize it without matching a literal. */
export const GENERATED_GROUP_DISPLAY = "Generated";

/**
 * The `[generated]` regeneration jobs as their own group — the mutating subset of
 * the build stage. Declared deterministic and fast, they belong in the inner loop:
 * running them there leaves every committed artifact current before the final
 * commit, so the full gate's build stage cannot dirty an already-committed tree
 * (a `tree_drift` failure that costs a second full run). `done` is unchanged — it
 * keeps running these jobs inside its build stage via {@link stageGroup}.
 */
export function generatedGroup(cfg: DiscernConfig): JobGroup | undefined {
  const jobs = planStageJobs(cfg, "build").filter((j) =>
    j.kind === "generated"
  );
  if (jobs.length === 0) {
    return undefined;
  }
  return {
    stage: "build",
    mode: "parallel",
    heading: "Regenerating artifacts...",
    display: GENERATED_GROUP_DISPLAY,
    jobs,
  };
}

/**
 * The prepare job groups — the fast inner loop: the fix stage (serial), then the
 * `[generated]` regenerations ({@link generatedGroup}), then the check stage. No
 * build jobs, no tests (those belong to the full `discern done`). Pure: derived
 * from the typed config alone, so `discern prepare` and `discern doctor`'s
 * execution model both read this ONE composition rather than re-listing it.
 */
export function preparePlanGroups(cfg: DiscernConfig): JobGroup[] {
  const groups: JobGroup[] = [];
  const fix = stageGroup(cfg, "fix");
  if (fix !== undefined) {
    groups.push(fix);
  }
  const generated = generatedGroup(cfg);
  if (generated !== undefined) {
    groups.push(generated);
  }
  const check = stageGroup(cfg, "check");
  if (check !== undefined) {
    groups.push(check);
  }
  return groups;
}

/**
 * The scope-gates group for the changed scopes, or undefined when no scope
 * declares a gate. The group holds EVERY configured gate (firing ones `willRun`,
 * unchanged ones not) so the report and the dry-run listing see them all; the
 * executor runs only the firing ones.
 */
export function scopeGatesGroup(jobs: PlannedJob[]): JobGroup | undefined {
  if (jobs.length === 0) {
    return undefined;
  }
  return {
    stage: "scope_gates",
    mode: "parallel",
    heading: "Running gates for changed scopes...",
    display: "Scope gates",
    jobs,
  };
}

/**
 * Assemble a gate plan from its stage groups, an optional scope-gates group, and
 * the changed scopes. The SINGLE composition both paths route through — the
 * `--dry-run` planner ({@link buildGatePlan}) and the apply executor (which
 * classifies scopes AFTER the stage groups run) — so a new group can't be added to
 * one path and forgotten in the other.
 */
export function composeGatePlan(
  stageGroups: JobGroup[],
  scopeGates: JobGroup | undefined,
  changed: string[],
): GatePlan {
  return {
    groups: scopeGates === undefined
      ? stageGroups
      : [...stageGroups, scopeGates],
    standardsLimitsCheck: true,
    guidanceCheck: true,
    skillsCheck: true,
    trackedRefreshCheck: true,
    mergeCheck: true,
    trackedArtifactsCheck: true,
    scopesChanged: changed,
  };
}

/**
 * Build the full gate plan from the typed config and the changed scopes (already
 * classified by the caller — the only read-only I/O). Pure given those inputs, so
 * the whole "what would the gate run" decision is unit-testable without a
 * subprocess. Mirrors the gate's order: the leading fail-fast preconditions — the
 * merge check (ADR 0050), tracked-artifacts guard, then the guidance/skills
 * currency checks (ADR 0056) — then fix (serial) → build → check∥test →
 * scope-gates. Used by `--dry-run` (which
 * classifies scopes once, read-only); the apply path classifies scopes AFTER the
 * stage groups run and {@link composeGatePlan}s the same shape.
 */
export function buildGatePlan(
  cfg: DiscernConfig,
  changed: string[],
  standardJobs: PlannedJob[] = [],
): GatePlan {
  return composeGatePlan(
    buildStageGroups(cfg, standardJobs),
    scopeGatesGroup(planScopeGates(cfg, changed)),
    changed,
  );
}

// ── the `done` result (a DiscernResult serialization of plan + results) ───────

/** The finish-specific `data` payload on its {@link DiscernResult}. The shape is
 * defined once as `GateDataSchema` in `result_schemas.ts` (the SSOT the MCP
 * `outputSchema` advertises); re-exported here for the gate code and tests that
 * build or read it. Typing `buildGateResult`'s `data` as this makes any drift from
 * the schema a compile error. */
export type { GateData };

/**
 * A step's outcome from its result: absent (its stage aborted before it) →
 * `skipped`; fail-fast-cancelled → `cancelled` (not a failure to fix); a clean
 * exit → `ok`; anything else → `failed`.
 */
function stepOutcome(r: JobResult | undefined): StepOutcome {
  if (r === undefined) {
    return "skipped";
  }
  if (r.cancelled === true) {
    return "cancelled";
  }
  return r.code === 0 ? "ok" : "failed";
}

/** Fire the advisory for a passing job whose error-like output still needs inspection. */
function loudSuccessHint(
  job: PlannedJob,
  result: JobResult,
): FiredHint | undefined {
  if (
    result.code !== 0 ||
    result.errorLikeLines < LOUD_SUCCESS_ERROR_LIKE_LINES
  ) {
    return undefined;
  }
  return fire(HINTS["gate-job-loud-success"], {
    label: job.label,
    errorLikeLines: result.errorLikeLines,
    outputLines: result.outputLines,
    outputPath: result.outputPath,
  });
}

/** Check whether the plan contains an executable formatter or fixer. */
function hasFixStageJob(groups: JobGroup[]): boolean {
  return groups.some((g) => g.stage === "fix" && g.jobs.some((j) => j.willRun));
}

/** Identify the fix-stage job that can repair a failed check when one exists. */
function fixAvailableFor(
  job: PlannedJob,
  fixStageWired: boolean,
): true | undefined {
  return fixStageWired && job.kind !== "scope-gate" &&
      job.reportStage !== "fix"
    ? true
    : undefined;
}

/** Annotate a failed check with the matching fix command without changing its verdict. */
function withFixAvailable(
  diagnostics: Diagnostic[],
  fixAvailable: true | undefined,
): Diagnostic[] {
  return fixAvailable === true
    ? diagnostics.map((d) => ({ ...d, fix_available: true }))
    : diagnostics;
}

/**
 * The one-line message for a Tier-0 (unstructured) job failure, keyed off the
 * OUTCOME, never off which tool produced it:
 *  - a job the watchdog tree-killed for never exiting (`timedOutAfterS`) names the
 *    usual culprit (a watch-mode runner / hung dev server) and the two ways out;
 *  - exit 127 is the shell's "command not found" — in a fresh worktree the giveaway
 *    is an untracked tool/dependency dir that never got converged, so the hint points
 *    at checkout-shared `[repository].ensure` rather than leaving a bare
 *    `sh: <cmd>: not found`;
 *  - everything else reports its exit code.
 *
 * Exported for the seeded-matcher drift guard: the gotchas traps that match on
 * this evidence replay the real strings from here, so a reword fails the gate
 * until the matchers move with it.
 */
export function jobFailureMessage(label: string, r: JobResult): string {
  if (r.timedOutAfterS !== undefined) {
    return `${label} timed out after ${r.timedOutAfterS}s and was killed — the command (or a background process it left holding its output stream) never finished within the budget. A watch-mode test runner, a dev server that never exits, or a tool that daemonizes mid-run will hang the gate; wire it in its single-run (CI) form, or give a legitimately long-running command a bigger budget — a \`timeout\` on its own config entry, or the global [gate].timeout.`;
  }
  if (r.failureMessage !== undefined) {
    return r.failureMessage;
  }
  if (r.code === 127) {
    return `${label} failed (exit 127) — command not found. If it works in the main checkout, note that a fresh worktree starts without the untracked tool and dependency directories the main checkout has; converge checkout-shared dependencies via [repository].ensure.`;
  }
  return `${label} failed (exit ${r.code})`;
}

/**
 * Serialize executed job groups into {@link StepResult}s + {@link Diagnostic}s — the
 * projection shared by `done`, `prepare`, and `discern test`. Each declared job
 * or scope-gate job becomes a step (looked up by label; missing → skipped), in
 * plan order. A genuine failure that captured output yields a Tier-0 diagnostic (the
 * command to reproduce it + its captured output), or — when the FULL captured output
 * is a recognized machine format (SARIF, JUnit XML) — one Tier-1 diagnostic per finding
 * (file/line/rule). A fail-fast-cancelled sibling is neither failed nor diagnosed
 * (it wasn't a real failure, just killed mid-run).
 */
export async function serializeJobSteps(
  groups: JobGroup[],
  results: Map<string, JobResult>,
): Promise<
  { steps: StepResult[]; diagnostics: Diagnostic[]; hints: FiredHint[] }
> {
  const steps: StepResult[] = [];
  const diagnostics: Diagnostic[] = [];
  const hints: FiredHint[] = [];
  const fixStageWired = hasFixStageJob(groups);
  for (const group of groups) {
    for (const j of group.jobs) {
      const r = results.get(j.label);
      const kind: StepKind = j.kind === "scope-gate"
        ? "scope-gate"
        : j.kind === "standard"
        ? "standard"
        : "job";
      steps.push({
        step: {
          kind,
          label: j.label,
          disposition: j.willRun ? "run" : "skip",
          note: j.note ?? (j.willRun ? j.command : "scope unchanged"),
          group: group.display,
        },
        outcome: stepOutcome(r),
        durationS: r === undefined ? 0 : r.durationS,
        outputPath: r?.outputPath,
        outputLines: r?.outputLines,
        errorLikeLines: r?.errorLikeLines,
      });
      if (r !== undefined) {
        const hint = loudSuccessHint(j, r);
        if (hint !== undefined) {
          hints.push(hint);
        }
      }
      if (r !== undefined && r.code !== 0 && r.cancelled !== true) {
        const fixAvailable = fixAvailableFor(j, fixStageWired);
        // A timed-out job is a hang, not a tool diagnostic — never format-normalize
        // it; its plain-language message (below) names the likely cause instead.
        // An evaluated verdict (`failureMessage`) IS the diagnostic — its output
        // is evidence, not a machine format to parse.
        const normalized = r.timedOutAfterS === undefined &&
            r.failureMessage === undefined && r.output !== undefined
          ? normalizeDiagnostics(r.output, j.label, j.command)
          : undefined;
        if (normalized !== undefined) {
          diagnostics.push(...withFixAvailable(normalized, fixAvailable));
        } else {
          const outputFields = r.output !== undefined
            ? await diagnosticOutputFields(r.output)
            : undefined;
          diagnostics.push({
            tool: j.label,
            severity: "error",
            message: jobFailureMessage(j.label, r),
            reproduce_cmd: j.command,
            ...(fixAvailable === true ? { fix_available: true } : {}),
            ...outputFields,
          });
        }
      }
    }
  }
  return { steps, diagnostics, hints };
}

/**
 * Build the `done` {@link DiscernResult} by SERIALIZING the plan it executed plus
 * the per-job results — not by re-deriving from config. The steps + diagnostics are
 * the shared {@link serializeJobSteps} projection (so the dry-run plan and the
 * executed result agree); the gate's own concerns (which stage failed, which scopes
 * changed) ride in `data`.
 */
export async function buildGateResult(
  plan: GatePlan,
  results: Map<string, JobResult>,
  failedStage: FailedStage | null,
): Promise<DiscernResult<GateData>> {
  return (await buildGateResultWithHints(plan, results, failedStage)).result;
}

/** The gate result plus its in-process fired hints for finish's final assembly. */
export async function buildGateResultWithHints(
  plan: GatePlan,
  results: Map<string, JobResult>,
  failedStage: FailedStage | null,
  failureRemedies?: readonly FiredHint[],
): Promise<{
  result: DiscernResult<GateData>;
  firedHints: FiredHint[];
}> {
  const { steps, diagnostics, hints } = await serializeJobSteps(
    plan.groups,
    results,
  );
  const data: GateData = {
    failed_stage: failedStage,
    scopes_changed: plan.scopesChanged,
  };
  const firedHints = failedStage === null
    ? hints
    : [...(failureRemedies ?? [gateFailureRemedy(failedStage)]), ...hints];
  return {
    result: {
      ok: failedStage === null,
      verb: "done",
      steps,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
      hints: firedHints.length > 0 ? hintTexts(firedHints) : undefined,
      data,
    },
    firedHints,
  };
}

// ── projection to the shared renderer (the `--dry-run` listing) ─────────────────

/**
 * Project a gate plan onto the common {@link EnginePlan} the shared renderer
 * prints. Leading `gate` steps stand for the fail-fast preconditions — the merge
 * check (ADR 0050), tracked-artifacts guard, then the guidance/skills and complete
 * tracked-refresh currency checks — followed by each job grouped under its stage, a firing job
 * `run`, an unchanged scope gate `skip`. Honest by construction:
 * declared jobs render as "run" — fail-fast may still skip some, which a
 * plan cannot predict.
 */
export function gatePlanToEngine(plan: GatePlan): EnginePlan {
  const steps: PlanStep[] = [];
  if (plan.mergeCheck) {
    steps.push({
      kind: "merge-check",
      label: "merge-check",
      disposition: "gate",
      note:
        "verify this branch contains the trunk — the shared landing branch — before running the gate (no-op in the main checkout)",
    });
  }
  if (plan.standardsLimitsCheck) {
    steps.push({
      kind: "standards-limits-check",
      label: "standards-limits-check",
      disposition: "gate",
      note:
        "verify no [standards] limit loosened or vanished versus the trunk (vacuous when none are configured)",
    });
  }
  if (plan.trackedArtifactsCheck) {
    steps.push({
      kind: "tracked-artifacts-check",
      label: "tracked-artifacts-check",
      disposition: "gate",
      note:
        "verify discern-managed ignored artifacts are not tracked by Git (`git rm --cached` if tracked)",
    });
  }
  if (plan.guidanceCheck) {
    steps.push({
      kind: "guidance-check",
      label: "guidance-check",
      disposition: "gate",
      note:
        "verify the agent files match their sources (`discern refresh` if stale)",
    });
  }
  if (plan.skillsCheck) {
    steps.push({
      kind: "skills-check",
      label: "skills-check",
      disposition: "gate",
      note:
        "verify the materialized skills match the effective set (`discern refresh` if stale)",
    });
  }
  if (plan.trackedRefreshCheck) {
    steps.push({
      kind: "tracked-refresh-check",
      label: TRACKED_REFRESH_CHECK_LABEL,
      disposition: "gate",
      note:
        "verify `discern refresh` has no pending effect on tracked files (run refresh, review, and commit if it does)",
    });
  }
  for (const group of plan.groups) {
    for (const j of group.jobs) {
      steps.push({
        kind: j.kind === "scope-gate"
          ? "scope-gate"
          : j.kind === "standard"
          ? "standard"
          : "job",
        label: j.label,
        disposition: j.willRun ? "run" : "skip",
        note: j.note ?? (j.willRun ? j.command : "scope unchanged"),
        group: group.display,
      });
    }
  }
  if (plan.trackedRefreshCheck) {
    steps.push({
      kind: "tracked-refresh-check",
      label: TRACKED_REFRESH_PROOF_CHECK_LABEL,
      disposition: "gate",
      note:
        "repeat the tracked refresh plan after every gate job, immediately before issuing the result and proof",
    });
  }
  const changed = plan.scopesChanged.length > 0
    ? plan.scopesChanged.join(", ")
    : "(none)";
  return {
    title: "Gate plan",
    details: [`scopes changed: ${changed}`],
    steps,
  };
}
