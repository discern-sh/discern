/**
 * `discern doctor`'s **execution model** — the honest, annotated answer to "what
 * runs when I call verb X, in what order, which steps are mine vs discern's, and what
 * must be idempotent or fast" (ADR 0063).
 *
 * The golden rule is DERIVE-FROM-SSOT, never hand-write the sequence:
 *  - the gate verbs (`done` / `prepare` / `test` / `standards`) are pure functions
 *    of config, so their step lists are built by walking the REAL plan builders
 *    ({@link buildGatePlan}, {@link preparePlanGroups}, {@link stageGroup},
 *    {@link buildStandardPlan}) — a test asserts they are byte-derived, so they can
 *    never drift from what the gate actually runs;
 *  - `update` and `accept` use representative, config-derived inputs with their REAL
 *    pure plan projections. Runtime identities stay descriptive, while those ordered
 *    operation cores and project commands cannot drift from execution. Worktree verbs
 *    without a complete projection retain a config-derived conditional model.
 *
 * Two closed vocabularies pin the annotations so a new engine concept can't slip in
 * undocumented: {@link STEP_KIND_ANNOTATIONS} is TOTAL over `StepKind` (a new step
 * kind is a compile error until annotated), and {@link STAGE_HINTS} is total over
 * `Stage` (a new gate stage likewise). Both are the forcing functions the
 * fix-the-class discipline asks for, mirroring the gate's total failed-stage
 * remedy index in the hint registry.
 *
 * discern renders the facts and the expectations; it does NOT judge them. "Your slow
 * integration linter is wired into the fast inner loop" is a conclusion for the
 * *consuming* agent to draw from this model — not a verdict discern hands down.
 */

import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { Stage } from "../../shared/capabilities.ts";
import {
  type Actor,
  BUILT_IN_STEP_LABELS,
  type PlanStep,
  type StepKind,
  type StepLabel,
  verbatimStepLabel,
} from "../../shared/result.ts";
import type { ExecutionStep, VerbPlan } from "../../shared/result_schemas.ts";
import { resolveGeneratedGroups } from "../../shared/generated_artifacts.ts";
import {
  buildGatePlan,
  gatePlanToEngine,
  type PlannedJob,
  planStageJobs,
  preparePlanGroups,
  stageGroup,
} from "../gate/plan.ts";
import { buildStandardPlan, perNote } from "../gate/standard_plan.ts";
import { planStandardJobsFromConfig } from "../gate/standards_gate.ts";
import {
  acceptPlanToEngine,
  FULL_REFRESH_STEP_NOTE,
  updatePlanToEngine,
} from "../worktree/plan.ts";

// ── the annotation registries (the forcing functions) ───────────────────────

/** The per-kind annotation: who the command belongs to and the class-level
 * expectation the user reads. */
interface StepKindAnnotation {
  actor: Actor;
  hint: string;
}

/**
 * The hint registry — TOTAL over {@link StepKind}, so a newly-added engine step kind
 * is a COMPILE error here until it is given an actor + hint (the fix-the-class guard,
 * mirroring the hint registry's total failed-stage remedy index). The hint *text* is sourced from the
 * canonical prose (the `discern.toml` template comments, the worktree map pages, the
 * ADRs) and kept domain-neutral — this ships to every project, in every field. The
 * `job` kind's hint is the generic fallback; a real gate job is annotated with its
 * STAGE's hint ({@link STAGE_HINTS}) instead, which is the more specific truth.
 */
export const STEP_KIND_ANNOTATIONS: Record<StepKind, StepKindAnnotation> = {
  job: {
    actor: "project",
    hint:
      "A declared gate job; its stage decides when it runs and what is expected of it.",
  },
  "scope-gate": {
    actor: "project",
    hint:
      "A scope's own gate command. Runs only when that scope's paths changed (classification fails open: an unknown path runs more gates, never fewer).",
  },
  "merge-check": {
    actor: "discern",
    hint:
      "Built-in fail-fast precondition: the branch must already contain the latest trunk — the shared landing branch — before the gate spends time. A no-op in the main checkout.",
  },
  "standards-limits-check": {
    actor: "discern",
    hint:
      "Built-in fail-fast precondition: no [standards] limit may be loosened or deleted versus the trunk — always on, milliseconds. An unreadable trunk skips loudly; a fetched trunk config that does not parse fails.",
  },
  "tracked-artifacts-check": {
    actor: "discern",
    hint:
      "Built-in fail-fast precondition: discern-managed ignored artifacts must not be tracked by Git. Remove them from the index with `git rm --cached`, then refresh.",
  },
  "instructions-check": {
    actor: "discern",
    hint:
      "Built-in fail-fast precondition: the agent files must match their sources — run `discern refresh` if stale.",
  },
  "skills-check": {
    actor: "discern",
    hint:
      "Built-in fail-fast precondition: the materialized skills must match the effective set — run `discern refresh` if stale.",
  },
  "tracked-refresh-check": {
    actor: "discern",
    hint:
      "Built-in read-only precondition: the current refresh plan must have no pending tracked-file effect. Run `discern refresh`, review and commit the named paths, then rerun the gate.",
  },
  "resource-create": {
    actor: "project",
    hint:
      "Your `create` command for a per-worktree external resource. Runs once at setup (skipped when already provisioned) and is reconciled by its `ensure` command on re-entry. Author it idempotent and cwd-independent.",
  },
  "resource-destroy": {
    actor: "project",
    hint:
      "Your `destroy` command for a per-worktree external resource. Runs at accept/teardown AND at orphan GC (`worktree prune`); author it idempotent and cwd-independent, and set `gc = false` for a data-loss-sensitive resource you only want torn down explicitly.",
  },
  git: {
    actor: "discern",
    hint:
      "A built-in git mutation discern performs (branch, worktree removal, checkout, fast-forward, sweep); the note says which.",
  },
  "setup-step": {
    actor: "project",
    hint:
      "A one-shot `[worktree.setup].steps` command. Runs once at worktree creation, after the resources; a failure aborts setup. Skipped on re-entry.",
  },
  "repository-ensure": {
    actor: "project",
    hint:
      "A shared `[repository].ensure` command. Re-runs in every managed worktree pass and after a trunk landing, so it MUST be idempotent, checkout-agnostic, and fast when current. Post-landing failures are recorded and cannot roll back the landing.",
  },
  "checkout-clean-check": {
    actor: "discern",
    hint:
      "Built-in landing check: report tracked dirt present immediately after the fast-forward or introduced by repository ensure and smoke convergence. It never rolls back a completed landing.",
  },
  "setup-ensure": {
    actor: "project",
    hint:
      "A convergent `[worktree.setup].ensure` command. Re-runs on EVERY pass (create, session start, update) — MUST be idempotent; prefer fast-when-current. Fatal at creation, non-fatal on re-entry.",
  },
  env: {
    actor: "discern",
    hint:
      "Built-in: record the deterministic port, inherit env vars from the main checkout, and write resource handles into the worktree's `.env`.",
  },
  refresh: {
    actor: "discern",
    hint:
      "Built-in refresh work. The step note states whether it reconciles all artifacts or only checkout-local materializations.",
  },
  tidy: {
    actor: "discern",
    hint:
      "Built-in: canonically format one Markdown or TOML file in discern's configured surface.",
  },
  standard: {
    actor: "project",
    hint:
      'Your measurement command for a never-loosen metric. Runs inside `discern done`\'s parallel check/test group by default (replayed for free when its declared `inputs` are untouched; deferred to `discern standards` when measure = "on-demand"), and the limit is verified against the trunk on every gate run.',
  },
};

/**
 * The per-stage hint for a real gate job — TOTAL over {@link Stage}, so a new gate
 * stage is a compile error until annotated. A `job` step renders THIS hint (keyed by
 * its stage) rather than the generic `job` entry above, because the stage is what
 * tells a user the load-bearing expectation: the fix stage mutates and must be
 * committed; the check stage is the fast inner loop; tests are slow. Sourced from the
 * `[jobs]` comments in the config template and ADR 0047 (the strand check).
 */
export const STAGE_HINTS: Record<Stage, string> = {
  fix:
    "Mutating; runs first, serially (a later fixer may build on an earlier one's edits). Commit its output — the fix-stage strand check refuses to land a run that left fixer output uncommitted.",
  build: "Produces the artifacts that later stages read.",
  check:
    "Read-only; keep it fast — this is the inner loop you run constantly (`discern prepare`).",
  test: "The suite; slow — deliberately kept out of `discern prepare`.",
};

// ── step construction ────────────────────────────────────────────────────────

/** Overrides a caller can layer on a step's registry defaults. */
interface StepOverrides {
  note?: string;
  hint?: string;
  condition?: string;
}

/** Build one {@link ExecutionStep}, taking its actor + default hint from the
 * {@link STEP_KIND_ANNOTATIONS} registry and applying any overrides. Optional keys are
 * spread conditionally so an absent field is omitted, not set to `undefined`
 * (exactOptionalPropertyTypes). */
function step(
  kind: StepKind,
  label: StepLabel,
  o: StepOverrides = {},
): ExecutionStep {
  const ann = STEP_KIND_ANNOTATIONS[kind];
  return {
    kind,
    label,
    actor: ann.actor,
    hint: o.hint ?? ann.hint,
    ...(o.note !== undefined ? { note: o.note } : {}),
    ...(o.condition !== undefined ? { condition: o.condition } : {}),
  };
}

/** Annotate one planned gate job (declared job/scope-gate) — the shared
 * projection the `done`/`prepare`/`test` derivations all funnel through, so a job's
 * label, command (the note), and stage-specific hint come from the real plan. */
function annotateJob(job: PlannedJob): ExecutionStep {
  if (job.kind === "scope-gate") {
    const scope = job.label.replace(/^scope:/, "");
    return step("scope-gate", verbatimStepLabel(job.label), {
      note: job.command,
      condition: `when scope '${scope}' changed`,
    });
  }
  if (job.kind === "standard") {
    return step("standard", verbatimStepLabel(job.label), {
      note: job.willRun ? job.command : job.note ?? job.command,
      ...(job.willRun
        ? { condition: "unless its declared `inputs` are untouched (replayed)" }
        : {}),
    });
  }
  // A declared job's reportStage is always a real Stage (never "scope_gates").
  return step("job", verbatimStepLabel(job.label), {
    note: job.command,
    hint: STAGE_HINTS[job.reportStage as Stage],
  });
}

/** Annotate a step from a canonical engine plan. This is the shared bridge from
 * pure worktree/gate projections into doctor's actor-and-expectation model. */
function annotatePlanStep(
  planned: PlanStep,
  overrides: StepOverrides = {},
): ExecutionStep {
  const groupHint = planned.group === "Smoke"
    ? STAGE_HINTS.test
    : planned.group === "Generated artifacts"
    ? STAGE_HINTS.build
    : undefined;
  return step(planned.kind, planned.label, {
    ...(planned.note !== undefined ? { note: planned.note } : {}),
    ...(groupHint !== undefined ? { hint: groupHint } : {}),
    ...overrides,
  });
}

// ── gate verbs (byte-derived from the real plan builders) ───────────────────

/** `done` — the full gate. Walks the REAL {@link buildGatePlan}: the fail-fast
 * preconditions, then the fix → build → check∥test (standards included) →
 * scope-gate jobs. All scopes are passed as "changed" so every scope gate
 * renders (as conditional, not skipped); the standards jobs come from the same
 * config-only planner the dry-run uses (replay is a run-time decision). */
function finishVerb(cfg: DiscernConfig): VerbPlan {
  const plan = buildGatePlan(
    cfg,
    Object.keys(cfg.scopes),
    planStandardJobsFromConfig(buildStandardPlan(cfg).standards),
  );
  const jobs = plan.groups.flatMap((group) => group.jobs);
  let jobIndex = 0;
  const steps = gatePlanToEngine(plan).steps.map((planned) => {
    if (
      planned.kind === "job" || planned.kind === "scope-gate" ||
      planned.kind === "standard"
    ) {
      const job = jobs[jobIndex];
      jobIndex += 1;
      if (job !== undefined) {
        return annotateJob(job);
      }
    }
    if (planned.label === BUILT_IN_STEP_LABELS.trackedRefreshCheck) {
      return annotatePlanStep(planned, {
        hint:
          "Built-in initial read-only precondition: the current refresh plan must have no pending tracked-file effect. Run `discern refresh`, review and commit the named paths, then rerun the gate.",
      });
    }
    if (planned.label === BUILT_IN_STEP_LABELS.trackedRefreshProofBoundary) {
      return annotatePlanStep(planned, {
        hint:
          "Built-in final read-only check: repeat the current tracked refresh plan after every gate job, immediately before the result and Proof. A pending or unprovable effect prevents a green result.",
      });
    }
    return annotatePlanStep(planned);
  });
  return {
    verb: "done",
    when: "Before you call a change done — the full gate.",
    steps,
  };
}

/** `prepare` — the fast inner loop, from the real {@link preparePlanGroups} (fix,
 * then the `[generated]` regenerations, then check; no build jobs, no tests). */
function prepareVerb(cfg: DiscernConfig): VerbPlan {
  const steps = preparePlanGroups(cfg).flatMap((g) => g.jobs.map(annotateJob));
  return {
    verb: "prepare",
    when:
      "The fast inner loop while you iterate (fix, regenerate, then check; no build jobs, no tests).",
    steps,
  };
}

/** `test` — just the test stage, from the real {@link stageGroup}. */
function testVerb(cfg: DiscernConfig): VerbPlan {
  const group = stageGroup(cfg, "test");
  return {
    verb: "test",
    when: "The test suite on its own, outside the full gate.",
    steps: group === undefined ? [] : group.jobs.map(annotateJob),
  };
}

/** `standards` — each configured standard, from the real {@link buildStandardPlan}. */
function standardsVerb(cfg: DiscernConfig): VerbPlan {
  const steps = buildStandardPlan(cfg).standards.map((r) =>
    step("standard", verbatimStepLabel(r.name), {
      note: r.command !== "" ? r.command : "(no command configured)",
      condition: `${r.direction}, limit ${r.limit}${perNote(r.per, r.scale)}`,
    })
  );
  return {
    verb: "standards",
    when:
      "On demand — the full standalone measurement pass (always measures, never replays): deferred standards, pinning a gain, CI. The gate already measures the rest on every `discern done`.",
    steps,
  };
}

/** `tidy` — the embedded formatter's two closed surface classes. */
function tidyVerb(): VerbPlan {
  return {
    verb: "tidy",
    when:
      "Directly, or when the project's format job invokes it during the gate.",
    steps: [
      step("tidy", BUILT_IN_STEP_LABELS.configuredMarkdown, {
        condition: "when Markdown is selected and a target would change",
      }),
      step("tidy", BUILT_IN_STEP_LABELS.rootDiscernToml, {
        condition: "when TOML is selected and the root config would change",
      }),
    ],
  };
}

// ── worktree verbs (authored conditional model; user commands pulled live) ──

/** This project's declared resources, in document order. */
function resourceEntries(
  cfg: DiscernConfig,
): [string, DiscernConfig["worktree"]["resources"][string]][] {
  return Object.entries(cfg.worktree.resources);
}

/** `start` / `worktree create` — mint a fresh worktree and run its first-time setup.
 * Mirrors `createAndSetupWorktree` → `buildSetupPlan` (lifecycle.ts), reading the
 * resource / setup commands live from the config. */
function startVerb(cfg: DiscernConfig): VerbPlan {
  const steps: ExecutionStep[] = [
    step("git", BUILT_IN_STEP_LABELS.addWorktree, {
      note: "create the linked worktree on its agent/ branch",
    }),
    step("git", BUILT_IN_STEP_LABELS.ensureBranch, {
      note: "put the worktree on a named branch",
    }),
  ];
  for (const [name, r] of resourceEntries(cfg)) {
    if (r.create !== "" || r.destroy !== "") {
      steps.push(step("resource-create", verbatimStepLabel(name), {
        note: r.create !== "" ? r.create : "(no create command)",
        condition: "first setup only — re-entry runs `ensure` instead",
      }));
    }
  }
  if (cfg.worktree.inherit_env.length > 0) {
    steps.push(step("env", BUILT_IN_STEP_LABELS.inheritEnv, {
      note: cfg.worktree.inherit_env.join(", "),
    }));
  }
  if (cfg.worktree.port) {
    steps.push(step("env", BUILT_IN_STEP_LABELS.recordPort, {
      note: "deterministic dev-server port → .env",
    }));
  }
  for (const s of cfg.worktree.setup.steps) {
    steps.push(
      step("setup-step", verbatimStepLabel(s), {
        condition: "first setup only",
      }),
    );
  }
  for (const s of cfg.repository.ensure) {
    steps.push(step("repository-ensure", verbatimStepLabel(s)));
  }
  for (const s of cfg.worktree.setup.ensure) {
    steps.push(step("setup-ensure", verbatimStepLabel(s)));
  }
  steps.push(step("refresh", BUILT_IN_STEP_LABELS.completeRefresh, {
    note: FULL_REFRESH_STEP_NOTE,
  }));
  return {
    verb: "start",
    when:
      "When you begin a new line of work — create a fresh isolated worktree and set it up (also the WorktreeCreate hook's path).",
    steps,
  };
}

/** `worktree ensure` — the idempotent session-start convergence (lifecycle.ts
 * `worktreeEnsure`): reconcile resources declaring an `ensure`, then run shared
 * repository and linked-worktree convergence. A no-op outside a worktree. */
function ensureVerb(cfg: DiscernConfig): VerbPlan {
  const steps = [
    ...cfg.repository.ensure.map((s) =>
      step("repository-ensure", verbatimStepLabel(s), {
        condition: "converge this checkout on the tree",
      })
    ),
    ...cfg.worktree.setup.ensure.map((s) =>
      step("setup-ensure", verbatimStepLabel(s), {
        condition: "converge this worktree on its identity and tree",
      })
    ),
  ];
  return {
    verb: "worktree ensure",
    when:
      "On every linked-worktree session start — reconcile any resource declaring an `ensure`, then re-run checkout-shared and worktree-only convergence. Idempotent and a no-op in the main checkout.",
    steps,
  };
}

/** `update` — project the real update plan against representative runtime state;
 * config supplies every generated and convergence command. */
function updateVerb(cfg: DiscernConfig): VerbPlan {
  const projected = updatePlanToEngine({
    source: cfg.repository.trunk,
    fromOverride: false,
    worktreeBranch: "the worktree branch",
    behind: 1,
    alreadyUpdated: false,
    generatedGroups: resolveGeneratedGroups(cfg),
    refreshCompiledPaths: [],
    repositoryEnsureSteps: cfg.repository.ensure,
    worktreeEnsureSteps: cfg.worktree.setup.ensure,
  });
  const steps = projected.steps.map((planned) => {
    if (planned.label === BUILT_IN_STEP_LABELS.merge) {
      return annotatePlanStep(planned, {
        condition: "only when the branch does not already contain the source",
      });
    }
    if (
      planned.label === BUILT_IN_STEP_LABELS.autoResolveGeneratedConflicts
    ) {
      return annotatePlanStep(planned, {
        condition: "after a real merge, before regeneration",
      });
    }
    if (planned.label === BUILT_IN_STEP_LABELS.commitRegeneratedArtifacts) {
      return annotatePlanStep(planned, {
        hint:
          "Built-in convergence boundary: after a merge, commit successfully re-derived tracked paths whose bytes changed. Without a merge, report changed tracked refresh paths for review and an intentional commit; never create a bookkeeping commit.",
      });
    }
    return annotatePlanStep(planned);
  });
  return {
    verb: "update",
    when:
      "When bringing the trunk (or an explicit --from ref) into this branch. If there is nothing to merge, the complete refresh and convergence tail still runs.",
    steps,
  };
}

/** `accept` — land the branch on the trunk (lifecycle.ts
 * `executeAcceptPlan`), with the resource teardown expanded per declared
 * `destroy` (reverse order) so the `destroy` command a user wired is shown, not
 * hidden behind a generic step. */
function acceptVerb(cfg: DiscernConfig): VerbPlan {
  const destroyable = resourceEntries(cfg).filter(([, r]) => r.destroy !== "");
  const smokeSteps = planStageJobs(cfg, "test")
    .filter((job) => job.kind === "known" && /^smoke(?:#\d+)?$/.test(job.label))
    .map((job) => ({
      label: job.label,
      command: job.command,
      ...(job.timeoutS !== undefined ? { timeoutS: job.timeoutS } : {}),
    }));
  const projected = acceptPlanToEngine({
    worktreeBranch: "the worktree branch",
    worktreePath: "the worktree directory",
    mainRepo: "the trunk checkout",
    trunk: cfg.repository.trunk,
    proofNotes: cfg.repository.proof_notes,
    repositoryEnsureSteps: cfg.repository.ensure,
    smokeSteps,
    hasResources: destroyable.length > 0,
    ignoredFileChanges: {
      status: "unchanged",
      changed_roots: [],
      changed_total: 0,
      truncated: false,
    },
  });
  const steps = projected.steps.flatMap((planned): ExecutionStep[] => {
    if (
      planned.label === BUILT_IN_STEP_LABELS.trackedRefreshLandingBoundary
    ) {
      return [annotatePlanStep(planned, {
        hint:
          "Built-in landing-boundary check: after either a valid Proof or an in-process gate rerun, verify the current engine's complete tracked refresh plan again. A pending or unprovable effect refuses before the trunk moves.",
      })];
    }
    if (planned.kind === "resource-destroy" && destroyable.length > 0) {
      return [...destroyable].reverse().map(([name, resource]) =>
        step("resource-destroy", verbatimStepLabel(name), {
          note: resource.destroy,
          condition: "if the resource was provisioned (reverse-creation order)",
        })
      );
    }
    if (planned.kind === "resource-destroy") {
      return [annotatePlanStep(planned, {
        note: "no configured resource destroy command",
        condition: "skipped for this configuration",
      })];
    }
    if (planned.kind === "repository-ensure") {
      return [annotatePlanStep(planned, {
        condition: "in the trunk checkout after the fast-forward",
      })];
    }
    return [annotatePlanStep(planned)];
  });
  return {
    verb: "accept",
    when:
      "When the work is done and updated — prove the exact tree by a valid Proof or a full gate rerun, recheck tracked refresh convergence with the current engine, then fast-forward the trunk and clean up.",
    steps,
  };
}

/** `worktree prune` — the garbage-collection sweep (lifecycle.ts `worktreePrune`):
 * remove stale worktrees / dangling branches / orphan dirs, then reclaim the
 * resources of any worktree that vanished without a clean teardown. */
function pruneVerb(cfg: DiscernConfig): VerbPlan {
  const steps: ExecutionStep[] = [
    step("git", BUILT_IN_STEP_LABELS.removeWorktree, {
      condition: "for each stale worktree git no longer tracks",
    }),
    step("git", BUILT_IN_STEP_LABELS.deleteBranch, {
      condition: "for each fully-merged dangling branch",
    }),
    step("git", BUILT_IN_STEP_LABELS.reclaimOrphanDir, {
      condition: "for each orphan gitlinked directory",
    }),
  ];
  for (const [name, r] of resourceEntries(cfg)) {
    if (r.destroy !== "") {
      steps.push(step("resource-destroy", verbatimStepLabel(name), {
        note: r.destroy,
        condition: r.gc === false
          ? "never — gc = false (teardown-only; reclaimed only by an explicit accept/teardown)"
          : "if orphaned (its worktree vanished without a clean teardown)",
      }));
    }
  }
  return {
    verb: "worktree prune",
    when:
      "Housekeeping — sweep stale worktrees and reclaim resources orphaned by a worktree that vanished without a clean teardown.",
    steps,
  };
}

// ── assembly ─────────────────────────────────────────────────────────────────

/**
 * Build the full execution model from the typed config — one {@link VerbPlan} per
 * configurable verb, every verb unconditionally (ADR 0101: the subsystems are all
 * core, matching the real CLI/MCP verb surface).
 * Pure: a function of config alone, so `discern doctor` and the MCP `discern_doctor`
 * tool both serve exactly this.
 */
export function buildExecutionModel(cfg: DiscernConfig): VerbPlan[] {
  return [
    finishVerb(cfg),
    prepareVerb(cfg),
    testVerb(cfg),
    standardsVerb(cfg),
    tidyVerb(),
    startVerb(cfg),
    ensureVerb(cfg),
    updateVerb(cfg),
    acceptVerb(cfg),
    pruneVerb(cfg),
  ];
}
