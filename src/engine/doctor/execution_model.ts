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
 *  - the worktree verbs' plans need live runtime state (a resolved worktree identity,
 *    the ledger), so they can't render statically here. For those we author a small
 *    CONDITIONAL model that mirrors the lifecycle executor, pulling the *user*
 *    commands (resource `create`/`destroy`/`ensure`, `[worktree.setup]` steps) LIVE
 *    from the config so the command text can't go stale.
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
import type { Actor, StepKind } from "../../shared/result.ts";
import type { ExecutionStep, VerbPlan } from "../../shared/result_schemas.ts";
import {
  buildGatePlan,
  type PlannedJob,
  planStageJobs,
  preparePlanGroups,
  stageGroup,
} from "../gate/plan.ts";
import { buildStandardPlan, perNote } from "../gate/standard_plan.ts";
import { planStandardJobsFromConfig } from "../gate/standards_gate.ts";

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
  "guidance-check": {
    actor: "discern",
    hint:
      "Built-in fail-fast precondition: the agent files must match their sources — run `discern refresh` if stale.",
  },
  "skills-check": {
    actor: "discern",
    hint:
      "Built-in fail-fast precondition: the materialized skills must match the effective set — run `discern refresh` if stale.",
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
      "Built-in post-convergence check: report if a repository ensure command changed tracked files. It never rolls back a completed landing.",
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
    hint: "Built-in: recompile the agent files and re-materialize the skills.",
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
  label: string,
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
    return step("scope-gate", job.label, {
      note: job.command,
      condition: `when scope '${scope}' changed`,
    });
  }
  if (job.kind === "standard") {
    return step("standard", job.label, {
      note: job.willRun ? job.command : job.note ?? job.command,
      ...(job.willRun
        ? { condition: "unless its declared `inputs` are untouched (replayed)" }
        : {}),
    });
  }
  // A declared job's reportStage is always a real Stage (never "scope_gates").
  return step("job", job.label, {
    note: job.command,
    hint: STAGE_HINTS[job.reportStage as Stage],
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
  const steps: ExecutionStep[] = [];
  if (plan.mergeCheck) {
    steps.push(step("merge-check", "merge-check"));
  }
  if (plan.standardsLimitsCheck) {
    steps.push(step("standards-limits-check", "standards-limits-check"));
  }
  if (plan.trackedArtifactsCheck) {
    steps.push(step("tracked-artifacts-check", "tracked-artifacts-check"));
  }
  if (plan.guidanceCheck) {
    steps.push(step("guidance-check", "guidance-check"));
  }
  if (plan.skillsCheck) {
    steps.push(step("skills-check", "skills-check"));
  }
  for (const group of plan.groups) {
    for (const job of group.jobs) {
      steps.push(annotateJob(job));
    }
  }
  return {
    verb: "done",
    when: "Before you call a change done — the full gate.",
    steps,
  };
}

/** `prepare` — the fast inner loop, from the real {@link preparePlanGroups} (fix then
 * check; no build, no tests). */
function prepareVerb(cfg: DiscernConfig): VerbPlan {
  const steps = preparePlanGroups(cfg).flatMap((g) => g.jobs.map(annotateJob));
  return {
    verb: "prepare",
    when:
      "The fast inner loop while you iterate (fix, then check; no build, no tests).",
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
    step("standard", r.name, {
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
    step("git", "add-worktree", {
      note: "create the linked worktree on its agent/ branch",
    }),
    step("git", "ensure-branch", {
      note: "put the worktree on a named branch",
    }),
  ];
  for (const [name, r] of resourceEntries(cfg)) {
    if (r.create !== "" || r.destroy !== "") {
      steps.push(step("resource-create", name, {
        note: r.create !== "" ? r.create : "(no create command)",
        condition: "first setup only — re-entry runs `ensure` instead",
      }));
    }
  }
  if (cfg.worktree.inherit_env.length > 0) {
    steps.push(step("env", "inherit-env", {
      note: cfg.worktree.inherit_env.join(", "),
    }));
  }
  if (cfg.worktree.port) {
    steps.push(step("env", "record-port", {
      note: "deterministic dev-server port → .env",
    }));
  }
  for (const s of cfg.worktree.setup.steps) {
    steps.push(step("setup-step", s, { condition: "first setup only" }));
  }
  for (const s of cfg.repository.ensure) {
    steps.push(step("repository-ensure", s));
  }
  for (const s of cfg.worktree.setup.ensure) {
    steps.push(step("setup-ensure", s));
  }
  steps.push(step("refresh", "refresh agent files", {
    note: "recompile agent files + materialize skills",
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
      step("repository-ensure", s, {
        condition: "converge this checkout on the tree",
      })
    ),
    ...cfg.worktree.setup.ensure.map((s) =>
      step("setup-ensure", s, {
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

/** `update` — bring the integration branch in and re-materialize (lifecycle.ts
 * `executeUpdatePlan`), then converge the worktree on the merged tree. */
function updateVerb(cfg: DiscernConfig): VerbPlan {
  const steps: ExecutionStep[] = [
    step("git", "merge", {
      note: "merge the trunk into this branch",
    }),
    step("refresh", "refresh agent files", {
      note: "re-materialize agent files + skills",
    }),
  ];
  for (const s of cfg.repository.ensure) {
    steps.push(
      step("repository-ensure", s, {
        condition: "converge on the merged tree",
      }),
    );
  }
  for (const s of cfg.worktree.setup.ensure) {
    steps.push(
      step("setup-ensure", s, { condition: "converge on the merged tree" }),
    );
  }
  return {
    verb: "update",
    when:
      "When the branch is behind the trunk (the gate's merge check points here). A no-op when already up to date.",
    steps,
  };
}

/** `accept` — land the branch on the trunk (lifecycle.ts
 * `executeAcceptPlan`), with the resource teardown expanded per declared
 * `destroy` (reverse order) so the `destroy` command a user wired is shown, not
 * hidden behind a generic step. */
function acceptVerb(cfg: DiscernConfig): VerbPlan {
  const steps: ExecutionStep[] = [];
  steps.push(step("git", "fast-forward-trunk", {
    note: "fast-forward the trunk to the branch tip",
  }));
  steps.push(step("refresh", "refresh agent files", {
    note: "re-materialize agent files + skills in the trunk checkout",
  }));
  for (const s of cfg.repository.ensure) {
    steps.push(step("repository-ensure", s, {
      condition: "in the trunk checkout after the fast-forward",
    }));
  }
  for (const job of planStageJobs(cfg, "test")) {
    if (job.kind === "known" && /^smoke(?:#\d+)?$/.test(job.label)) {
      steps.push(annotateJob(job));
    }
  }
  steps.push(step("checkout-clean-check", "check trunk checkout", {
    note: "report tracked files changed by post-landing convergence",
  }));
  const destroyable = resourceEntries(cfg).filter(([, r]) => r.destroy !== "");
  for (const [name, r] of destroyable.reverse()) {
    steps.push(step("resource-destroy", name, {
      note: r.destroy,
      condition: "if the resource was provisioned (reverse-creation order)",
    }));
  }
  steps.push(step("git", "remove-worktree", {
    note: "remove the worktree directory",
  }));
  steps.push(step("git", "delete-branch", {
    note: "delete the now-merged branch",
  }));
  return {
    verb: "accept",
    when:
      "When the work is done and updated — fast-forward the trunk to the branch and delete the now-merged branch. First validates the exact tree against the whole gate, skipped when a gate receipt proves the current HEAD already passed.",
    steps,
  };
}

/** `worktree prune` — the garbage-collection sweep (lifecycle.ts `worktreePrune`):
 * remove stale worktrees / dangling branches / orphan dirs, then reclaim the
 * resources of any worktree that vanished without a clean teardown. */
function pruneVerb(cfg: DiscernConfig): VerbPlan {
  const steps: ExecutionStep[] = [
    step("git", "remove-worktree", {
      condition: "for each stale worktree git no longer tracks",
    }),
    step("git", "delete-branch", {
      condition: "for each fully-merged dangling branch",
    }),
    step("git", "reclaim-orphan-dir", {
      condition: "for each orphan gitlinked directory",
    }),
  ];
  for (const [name, r] of resourceEntries(cfg)) {
    if (r.destroy !== "") {
      steps.push(step("resource-destroy", name, {
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
    startVerb(cfg),
    ensureVerb(cfg),
    updateVerb(cfg),
    acceptVerb(cfg),
    pruneVerb(cfg),
  ];
}
