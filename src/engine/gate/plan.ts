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
import { isFeatureEnabled } from "../../shared/features.ts";
import type { Stage } from "../../shared/capabilities.ts";
import { jobsInStage } from "./stages.ts";
import { normalizeDiagnostics } from "./diagnostics.ts";
import type { GateData } from "../../shared/result_schemas.ts";
import type { JobResult } from "../jobs/types.ts";
import {
  capText,
  type Diagnostic,
  type DiscernResult,
  type EnginePlan,
  type FailedStage,
  type PlanStep,
  type StepKind,
  type StepOutcome,
  type StepResult,
} from "../../shared/result.ts";

/**
 * A gate job as planned: the command to run plus the metadata the ADR-0004 report
 * needs. `willRun` is false only for a configured-but-unchanged scope gate (listed
 * and reported as skipped); capabilities and checks are always planned to run —
 * fail-fast skips can't be predicted at plan time (the dry-run honesty rule).
 */
export interface PlannedJob {
  label: string;
  command: string;
  kind: "capability" | "check" | "scope-gate";
  /** The stage reported in `jobs[].stage` (a real STAGE), or "scope_gates". */
  reportStage: Stage | "scope_gates";
  willRun: boolean;
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
  /** The generated-artifacts currency check runs as a fail-fast precondition, beside
   * the merge check (ADR 0034, front-loaded by ADR 0056); true when the `guidance`
   * feature is on. Blocks on a STALE agent file. */
  guidanceCheck: boolean;
  /** The materialized-skills currency check (ADR 0034, extended to skills); true
   * when the `skills` feature is on. A fail-fast precondition like guidance; blocks
   * on a STALE skills dir. */
  skillsCheck: boolean;
  /** The merge check runs FIRST, as a fail-fast precondition (ADR 0050); it self-skips
   * in the main checkout. Always true (the field gates its plan-listing, not its run). */
  mergeCheck: boolean;
  scopesChanged: string[];
}

/**
 * The capability/check jobs for a real gate stage (fix|build|check|test), as
 * planned jobs. Pure: derived from the typed config alone.
 */
export function planStageJobs(cfg: DiscernConfig, stage: Stage): PlannedJob[] {
  return jobsInStage(cfg, stage).map((j) => ({
    label: j.label,
    command: j.command,
    kind: j.kind,
    reportStage: stage,
    willRun: true,
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
    const command = toCommand(spec.gate);
    if (command === "") {
      continue;
    }
    out.push({
      label: `scope:${scope}`,
      command,
      kind: "scope-gate",
      reportStage: "scope_gates",
      willRun: changed.includes(scope),
    });
  }
  return out;
}

/**
 * Display metadata for a single stage's job group — the runner heading, the dry-run
 * label, and how the stage's jobs are scheduled. The fix stage is serial (a later
 * fixer may depend on an earlier one's edits); the rest run in parallel. `finish`
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
 * `prepare` (fix + check) and `discern test` (test) compose directly; `finish` uses
 * it for fix and build, and runs check∥test as one combined group.
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
 * The combined check∥test group `finish` runs — both stages' jobs in ONE parallel
 * group, so the read-only checks and the tests overlap. (`prepare` runs the check
 * stage alone; `discern test` runs the test stage alone — each via {@link
 * stageGroup}.)
 */
export function checkTestGroup(cfg: DiscernConfig): JobGroup | undefined {
  const jobs = [...planStageJobs(cfg, "check"), ...planStageJobs(cfg, "test")];
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
 * The capability/check job groups — fix (serial) → build → check∥test — derived
 * from the typed config alone. These are independent of the changed scopes, so the
 * executor can run them BEFORE classifying scopes (preserving the gate's original
 * timing, where a fix-stage edit is reflected in the scope classification).
 */
export function buildStageGroups(cfg: DiscernConfig): JobGroup[] {
  const groups: JobGroup[] = [];
  const fix = stageGroup(cfg, "fix");
  if (fix !== undefined) {
    groups.push(fix);
  }
  const build = stageGroup(cfg, "build");
  if (build !== undefined) {
    groups.push(build);
  }
  const checkTest = checkTestGroup(cfg);
  if (checkTest !== undefined) {
    groups.push(checkTest);
  }
  return groups;
}

/**
 * The prepare job groups — the fast inner loop: the fix stage (serial), then the
 * check stage. No build, no tests (those belong to the full `discern finish`). Pure:
 * derived from the typed config alone, so `discern prepare` and `discern doctor`'s
 * execution model both read this ONE composition rather than re-listing it.
 */
export function preparePlanGroups(cfg: DiscernConfig): JobGroup[] {
  const groups: JobGroup[] = [];
  const fix = stageGroup(cfg, "fix");
  if (fix !== undefined) {
    groups.push(fix);
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
  guidanceCheck: boolean,
  skillsCheck: boolean,
): GatePlan {
  return {
    groups: scopeGates === undefined
      ? stageGroups
      : [...stageGroups, scopeGates],
    guidanceCheck,
    skillsCheck,
    mergeCheck: true,
    scopesChanged: changed,
  };
}

/**
 * Build the full gate plan from the typed config and the changed scopes (already
 * classified by the caller — the only read-only I/O). Pure given those inputs, so
 * the whole "what would the gate run" decision is unit-testable without a
 * subprocess. Mirrors the gate's order: the leading fail-fast preconditions — the
 * merge check (ADR 0050) then the guidance/skills currency checks (ADR 0056) — then
 * fix (serial) → build → check∥test → scope-gates. Used by `--dry-run` (which
 * classifies scopes once, read-only); the apply path classifies scopes AFTER the
 * stage groups run and {@link composeGatePlan}s the same shape.
 */
export function buildGatePlan(cfg: DiscernConfig, changed: string[]): GatePlan {
  return composeGatePlan(
    buildStageGroups(cfg),
    scopeGatesGroup(planScopeGates(cfg, changed)),
    changed,
    isFeatureEnabled(cfg, "guidance"),
    isFeatureEnabled(cfg, "skills"),
  );
}

// ── the `finish` result (a DiscernResult serialization of plan + results) ───────

/** The finish-specific `data` payload on its {@link DiscernResult}. The shape is
 * defined once as `GateDataSchema` in `result_schemas.ts` (the SSOT the MCP
 * `outputSchema` advertises); re-exported here for the gate code and tests that
 * build or read it. Typing `buildGateResult`'s `data` as this makes any drift from
 * the schema a compile error. */
export type { GateData };

/**
 * A step's outcome from its result: absent (its stage aborted before it) OR
 * fail-fast-cancelled → `skipped` (neither is a failure to fix); a clean exit →
 * `ok`; anything else → `failed`.
 */
function stepOutcome(r: JobResult | undefined): StepOutcome {
  if (r === undefined || r.cancelled === true) {
    return "skipped";
  }
  return r.code === 0 ? "ok" : "failed";
}

/**
 * Serialize executed job groups into {@link StepResult}s + {@link Diagnostic}s — the
 * projection shared by `finish`, `prepare`, and `discern test`. Each capability/
 * check/scope-gate job becomes a step (looked up by label; missing → skipped), in
 * plan order. A genuine failure that captured output yields a Tier-0 diagnostic (the
 * command to reproduce it + its captured output), or — when the FULL captured output
 * is a recognized machine format (SARIF) — one Tier-1 diagnostic per finding
 * (file/line/rule). A fail-fast-cancelled sibling is neither failed nor diagnosed
 * (it wasn't a real failure, just killed mid-run).
 */
export function serializeJobSteps(
  groups: JobGroup[],
  results: Map<string, JobResult>,
): { steps: StepResult[]; diagnostics: Diagnostic[] } {
  const steps: StepResult[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const group of groups) {
    for (const j of group.jobs) {
      const r = results.get(j.label);
      const kind: StepKind = j.kind === "scope-gate" ? "scope-gate" : "job";
      steps.push({
        step: {
          kind,
          label: j.label,
          disposition: j.willRun ? "run" : "skip",
          note: j.willRun ? j.command : "scope unchanged",
          group: group.display,
        },
        outcome: stepOutcome(r),
        durationS: r === undefined ? 0 : r.durationS,
      });
      if (r !== undefined && r.code !== 0 && r.cancelled !== true) {
        const normalized = r.output !== undefined
          ? normalizeDiagnostics(r.output, j.label, j.command)
          : undefined;
        if (normalized !== undefined) {
          diagnostics.push(...normalized);
        } else {
          const capped = r.output !== undefined ? capText(r.output) : undefined;
          diagnostics.push({
            tool: j.label,
            severity: "error",
            message: `${j.label} failed (exit ${r.code})`,
            reproduce_cmd: j.command,
            output: capped?.text,
            truncated: capped?.truncated === true ? true : undefined,
          });
        }
      }
    }
  }
  return { steps, diagnostics };
}

/**
 * Build the `finish` {@link DiscernResult} by SERIALIZING the plan it executed plus
 * the per-job results — not by re-deriving from config. The steps + diagnostics are
 * the shared {@link serializeJobSteps} projection (so the dry-run plan and the
 * executed result agree); the gate's own concerns (which stage failed, which scopes
 * changed) ride in `data`.
 */
export function buildGateResult(
  plan: GatePlan,
  results: Map<string, JobResult>,
  failedStage: FailedStage | null,
): DiscernResult<GateData> {
  const { steps, diagnostics } = serializeJobSteps(plan.groups, results);
  const data: GateData = {
    failed_stage: failedStage,
    scopes_changed: plan.scopesChanged,
  };
  return {
    ok: failedStage === null,
    verb: "finish",
    steps,
    diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    data,
  };
}

// ── projection to the shared renderer (the `--dry-run` listing) ─────────────────

/**
 * Project a gate plan onto the common {@link EnginePlan} the shared renderer
 * prints. Leading `gate` steps stand for the fail-fast preconditions — the merge
 * check (ADR 0050) then the guidance/skills currency checks (ADR 0056) — followed by
 * each job grouped under its stage, a firing job `run`, an unchanged scope gate
 * `skip`. Honest by construction: capabilities/checks render as "run" — fail-fast may
 * still skip some, which a plan cannot predict.
 */
export function gatePlanToEngine(plan: GatePlan): EnginePlan {
  const steps: PlanStep[] = [];
  if (plan.mergeCheck) {
    steps.push({
      kind: "merge-check",
      label: "merge-check",
      disposition: "gate",
      note:
        "verify this branch contains the integration branch before running the gate (no-op in the main checkout)",
    });
  }
  if (plan.guidanceCheck) {
    steps.push({
      kind: "guidance-check",
      label: "guidance-check",
      disposition: "gate",
      note:
        "verify the generated agent files match their sources (`discern refresh` if stale)",
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
  for (const group of plan.groups) {
    for (const j of group.jobs) {
      steps.push({
        kind: j.kind === "scope-gate" ? "scope-gate" : "job",
        label: j.label,
        disposition: j.willRun ? "run" : "skip",
        note: j.willRun ? j.command : "scope unchanged",
        group: group.display,
      });
    }
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
