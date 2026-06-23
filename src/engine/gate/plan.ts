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
import type { JobResult } from "../jobs/types.ts";
import type {
  Diagnostic,
  DiscernResult,
  EnginePlan,
  PlanStep,
  StepKind,
  StepOutcome,
  StepResult,
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
  /** The failed-stage label for this group (fix | build | check/test | scope_gates). */
  stage: string;
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
  /** The merge check runs last (it self-skips in the main checkout). */
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
 * The capability/check job groups — fix (serial) → build → check∥test — derived
 * from the typed config alone. These are independent of the changed scopes, so the
 * executor can run them BEFORE classifying scopes (preserving the gate's original
 * timing, where a fix-stage edit is reflected in the scope classification).
 */
export function buildStageGroups(cfg: DiscernConfig): JobGroup[] {
  const groups: JobGroup[] = [];

  const fix = planStageJobs(cfg, "fix");
  if (fix.length > 0) {
    groups.push({
      stage: "fix",
      mode: "serial",
      heading: "Applying fixers...",
      display: "Fix",
      jobs: fix,
    });
  }

  const build = planStageJobs(cfg, "build");
  if (build.length > 0) {
    groups.push({
      stage: "build",
      mode: "parallel",
      heading: "Building artifacts...",
      display: "Build",
      jobs: build,
    });
  }

  const checkTest = [
    ...planStageJobs(cfg, "check"),
    ...planStageJobs(cfg, "test"),
  ];
  if (checkTest.length > 0) {
    groups.push({
      stage: "check/test",
      mode: "parallel",
      heading: "Checking and testing...",
      display: "Check & test",
      jobs: checkTest,
    });
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
    mergeCheck: true,
    scopesChanged: changed,
  };
}

/**
 * Build the full gate plan from the typed config and the changed scopes (already
 * classified by the caller — the only read-only I/O). Pure given those inputs, so
 * the whole "what would the gate run" decision is unit-testable without a
 * subprocess. Mirrors the gate's order: fix (serial) → build → check∥test →
 * scope-gates, then a trailing merge check. Used by `--dry-run` (which classifies
 * scopes once, read-only); the apply path classifies scopes AFTER the stage groups
 * run and {@link composeGatePlan}s the same shape.
 */
export function buildGatePlan(cfg: DiscernConfig, changed: string[]): GatePlan {
  return composeGatePlan(
    buildStageGroups(cfg),
    scopeGatesGroup(planScopeGates(cfg, changed)),
    changed,
  );
}

// ── the `finish` result (a DiscernResult serialization of plan + results) ───────

/** The finish-specific `data` payload on its {@link DiscernResult}. */
export interface GateData {
  /** The stage that failed (`fix`|`build`|`check/test`|`scope_gates`|`merge`), or null. */
  failed_stage: string | null;
  /** The scopes the branch changed (drives which scope gates fired). */
  scopes_changed: string[];
}

/** A step's outcome from its result (absent = its stage aborted before it → skipped). */
function stepOutcome(r: JobResult | undefined): StepOutcome {
  if (r === undefined) {
    return "skipped";
  }
  return r.code === 0 ? "ok" : "failed";
}

/**
 * Build the `finish` {@link DiscernResult} by SERIALIZING the plan it executed plus
 * the per-job results — not by re-deriving from config. Each capability/check/scope-
 * gate job becomes a {@link StepResult} (looked up by label; missing → skipped), in
 * plan order, so the same projection feeds both the dry-run plan and the executed
 * result. A failed job that captured output yields a Tier-0 {@link Diagnostic} —
 * the structured "why" carrying the command to reproduce it and its output. The
 * gate's own concerns (which stage failed, which scopes changed) ride in `data`.
 */
export function buildGateResult(
  plan: GatePlan,
  results: Map<string, JobResult>,
  failedStage: string | null,
): DiscernResult {
  const steps: StepResult[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const group of plan.groups) {
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
      // A genuine failure earns a Tier-0 diagnostic — even with no captured output,
      // its `reproduce_cmd` alone moves the agent off "re-run and scrape". A
      // fail-fast-cancelled sibling is excluded: it's not a failure to fix.
      if (r !== undefined && r.code !== 0 && r.cancelled !== true) {
        diagnostics.push({
          tool: j.label,
          severity: "error",
          message: `${j.label} failed (exit ${r.code})`,
          reproduce_cmd: j.command,
          output: r.output,
          truncated: r.truncated,
        });
      }
    }
  }
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
 * prints. Each job becomes a step grouped by its stage; a firing job is `run`, an
 * unchanged scope gate is `skip`. A trailing `gate` step stands for the merge
 * check. Honest by construction: capabilities/checks render as "run" — fail-fast
 * may still skip some, which a plan cannot predict.
 */
export function gatePlanToEngine(plan: GatePlan): EnginePlan {
  const steps: PlanStep[] = [];
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
  if (plan.mergeCheck) {
    steps.push({
      kind: "merge-check",
      label: "merge-check",
      disposition: "gate",
      note:
        "verify this branch contains the integration branch (no-op in main)",
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
