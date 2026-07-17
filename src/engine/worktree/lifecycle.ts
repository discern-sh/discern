/**
 * The worktree lifecycle entry points — worktree setup, ensure, accept,
 * teardown, and prune. These compose the identity, resource, and git layers into
 * the operations the dispatcher exposes as `discern worktree setup`, `discern accept`,
 * and the `worktree` command group.
 *
 * Per-worktree external resources ([worktree.resources.<name>].create/destroy)
 * are project-supplied command strings run via `sh -c` after `@…@` token
 * expansion (see ./resources.ts). They are created once at setup (a `required`
 * create is fatal — a broken setup must be loud), destroyed once at teardown
 * (best-effort — a hiccup must never strand a worktree; a later prune is the
 * backstop), and reclaimed by prune when a worktree vanishes without a clean
 * teardown. [worktree.setup].steps run once at creation, stopping at the first
 * failure; [repository].ensure re-runs checkout-generic convergence on every
 * pass and after landing, while [worktree.setup].ensure re-runs only in linked
 * worktrees for identity-dependent convergence.
 */

import { basename, isAbsolute, join, relative, resolve } from "@std/path";
import { type Logger, loggerSink } from "../../lib/log.ts";
import { canPrompt, confirmProceed } from "../../lib/prompts.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import {
  deriveIdentity,
  generateWorktreeId,
  IdentityError,
  type IdentitySettings,
  loadIdentitySettings,
  resolveWorktreeId,
  resourceForId,
  worktreeBase,
  type WorktreeField,
  type WorktreeIdentity,
} from "./identity.ts";
import { writeEnvVar } from "./env_file.ts";
import {
  hasIgnoredFileChanges,
  inspectIgnoredFileChanges,
  recordIgnoredFileBaseline,
} from "./ignored.ts";
import { runShellRouted } from "./shell.ts";
import {
  type JobGroup,
  planStageJobs,
  serializeJobSteps,
} from "../gate/plan.ts";
import { gateRunContext, runJobGroups } from "../gate/execute.ts";
import { type GitResult, runGit } from "../../shared/subprocess.ts";
import { parsePorcelainZ } from "../../shared/git_paths.ts";
import { AWAITING_CONSENT_SLUG } from "../../shared/consent.ts";
import {
  classifyOrphans,
  createResources,
  destroyResources,
  ensureResources,
  entriesForWorktree,
  gcPlannedOrphanResources,
  type GcResult,
  type LedgerItem,
  listEntries,
  readResourceSpecs,
  recordResourceEnv,
} from "./resources.ts";
import {
  type AcceptPlan,
  acceptPlanToEngine,
  type DropPlan,
  dropPlanToEngine,
  type PrunePlan,
  prunePlanIsEmpty,
  prunePlanToEngine,
  type SetupPlan,
  setupPlanToEngine,
  type SetupStepDesc,
  startPlanToEngine,
  type TeardownPlan,
  teardownPlanToEngine,
  type UpdatePlan,
  updatePlanToEngine,
} from "./plan.ts";
import {
  appliedResult,
  type Diagnostic,
  type DiscernResult,
  type EnginePlan,
  previewResult,
  renderPlan,
  renderStepResults,
  type StepOutcome,
  type StepResult,
} from "../../shared/result.ts";
import type {
  AcceptData,
  GateData,
  StartData,
  UpdateData,
} from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import {
  addWorktree,
  assertInWorktree,
  assertMainMerged,
  assertNotInWorktree,
  branchIsMerged,
  ensureWorktreeBranch,
  hasAnyCommit,
  hasUncommittedTrackedChanges,
  inheritMainEnvVars,
  integrationBranch,
  integrationDelta,
  listWorktreeFleet,
  liveWorktreeGitKeys,
  liveWorktreePaths,
  localBranchExists,
  mainRepoPath,
  missingIntegrationBranchWarning,
  overlapPaths,
  pruneGitWorktrees,
  pruneStaleWorktreeMetadata,
  readySentinelPath,
  refMergedState,
  registeredWorktreeRecord,
  removeWorktreeSafely,
  repoToplevel,
  resolveCommitRef,
  resolveCommonGitDir,
  resolveIntegrationAnchors,
  scanGitWorktreesForPrune,
  scanOrphanWorktreesForSweep,
  sweepOrphanWorktrees,
  updateMain,
  WorktreeGitError,
  worktreeGitKey,
  worktreeSetupComplete,
} from "./git.ts";

// worktree setup recompiles the agent guidance as its final step — which also
// materializes skills into .claude/skills/ inside the freshly created worktree (a
// linked worktree does not inherit that gitignored directory from the main checkout).
import { compileGuidelines, guidanceRefreshSucceeded } from "../guidelines.ts";
import { resolveTemplatesDir } from "../../lib/paths.ts";
// accept validates the exact tree it lands by running the full gate at the landing
// boundary (ADR 0067) — fast-pathed by a gate receipt when nothing changed since
// the agent's own `done`, so a clean-merging but gate-breaking `update` (or any
// tree never run through `done`) cannot fast-forward onto the trunk unvalidated.
import { failMessage, finishResult } from "../gate/finish.ts";
import { inspectGateReceipt, pinValidatedTree } from "../gate/receipt.ts";
// update classifies the merge's incoming files into the project's scopes for its
// "what landed beneath you" summary (ADR 0064), via the same matcher the gate uses.
import { scopesForPaths } from "../scopes/scopes.ts";

/** Context shared by every lifecycle operation. */
export interface LifecycleContext {
  /** The project root (holds `discern.toml`). */
  root: string;
  /** The parsed project config. */
  config: DiscernConfig;
  /** The logger for human output. */
  log: Logger;
  /** The directory the operation runs from (default: the project root). */
  cwd: string;
}

/** Build a lifecycle context, loading config from `root`. `cwd` defaults to `root`. */
export async function lifecycleContext(
  root: string,
  log: Logger,
  cwd: string = root,
): Promise<LifecycleContext> {
  return { root, config: await loadConfig(root), log, cwd };
}

/** Flags shared by every effectful worktree verb: preview-only and machine output. */
export interface WorktreeOpOptions {
  /** Show the plan and touch nothing. */
  dryRun?: boolean;
  /** Emit a machine-readable (plan, results) object on stdout. */
  json?: boolean;
  /** Render the human apply summary (internal protocol callers may reserve stdout). */
  humanApplySummary?: boolean;
}

/** `accept`'s flags: the worktree-verb set plus the landing consent attestation
 * (ADR 0134). `confirmed` asserts the owner has accepted this landing, or gave
 * standing pre-authorization; absent (and not a dry-run), acceptance refuses
 * read-only. It lives on accept alone — the other worktree verbs are not
 * consent-gated. */
export interface AcceptOpOptions extends WorktreeOpOptions {
  confirmed?: boolean;
}

/**
 * Emit a built plan as a `--dry-run` — human listing (through the shared renderer)
 * or, in `--json` mode, the plan JSON on stdout. Touches nothing. The single fork
 * every worktree verb funnels its dry-run through.
 */
function emitDryRun(
  ctx: LifecycleContext,
  verb: string,
  plan: EnginePlan,
  json: boolean,
): void {
  if (json) {
    emitResult(previewResult(verb, plan));
    return;
  }
  renderPlan(loggerSink(ctx.log), plan);
}

function applyResultTitle(verb: string): string {
  switch (verb) {
    case "start":
      return "Start results";
    case "update":
      return "Update results";
    case "accept":
      return "Acceptance results";
    case "worktree setup":
      return "Worktree setup results";
    case "worktree teardown":
      return "Worktree teardown results";
    case "worktree prune":
      return "Worktree prune results";
    default:
      return `${verb} results`;
  }
}

interface WorktreeResultRenderHooks<TData> {
  afterPlan?: ((result: DiscernResult<TData>) => void) | undefined;
  afterApply?: ((result: DiscernResult<TData>) => void) | undefined;
}

/**
 * Render one result object on the requested surface. Dry-runs use the shared plan
 * renderer; applies use the shared StepResult renderer, so the human summary and
 * `--json` agree on the settled step list.
 */
function emitOrRenderWorktreeResult<TData>(
  ctx: LifecycleContext,
  result: DiscernResult<TData>,
  json: boolean,
  hooks: WorktreeResultRenderHooks<TData> = {},
): void {
  if (json) {
    emitResult(result);
    return;
  }
  if (result.dry_run === true && result.plan !== undefined) {
    renderPlan(loggerSink(ctx.log), result.plan);
    hooks.afterPlan?.(result);
    return;
  }
  renderStepResults(loggerSink(ctx.log), {
    title: applyResultTitle(result.verb),
    steps: result.steps ?? [],
  });
  hooks.afterApply?.(result);
}

/** Resolve this worktree's full identity (and the settings it derived from) from
 * the context's cwd. */
async function resolveContextIdentity(
  ctx: LifecycleContext,
): Promise<{ identity: WorktreeIdentity; settings: IdentitySettings }> {
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  return { identity: deriveIdentity(id, settings), settings };
}

/**
 * Tear down this worktree's external resources — every ledger entry for this
 * worktree, destroyed in reverse creation order. Best-effort and non-fatal: a
 * teardown hiccup must never strand a worktree (a later `worktree prune` is the
 * backstop). A no-op when nothing was created. Run from inside the worktree (so
 * `@dir@`-bearing destroys still resolve).
 */
async function teardownResources(
  ctx: LifecycleContext,
): Promise<{ destroyed: string[]; failed: string[] }> {
  const { entries } = await buildTeardownPlan(ctx);
  return await destroyResources(ctx, entries);
}

/** Read this worktree's teardown plan — the ledger entries it would destroy, in
 * destruction order. Read-only; `[]` when the git identity can't be resolved. */
async function buildTeardownPlan(ctx: LifecycleContext): Promise<TeardownPlan> {
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  const gitKey = await worktreeGitKey(ctx.cwd);
  if (commonGitDir === undefined || gitKey === undefined) {
    return { entries: [] };
  }
  return { entries: await entriesForWorktree(commonGitDir, gitKey) };
}

// The per-worktree ready sentinel (`discern-worktree-ready`) lives in the git
// layer now — `readySentinelPath` / `worktreeSetupComplete` — shared with
// status's broken-worktree flag, so "is this worktree configured?" has one read.

/** Record the deterministic port in this worktree's env files, or report it. */
async function recordPort(
  ctx: LifecycleContext,
  identity: WorktreeIdentity,
): Promise<void> {
  if (!ctx.config.worktree.port) {
    return;
  }
  const port = String(identity.port);
  const wrote = await writeEnvVar(
    ctx.cwd,
    "DISCERN_WORKTREE_PORT",
    port,
    ctx.config.worktree.env_files,
  );
  ctx.log.ok(
    wrote
      ? `Worktree dev-server port: ${port} (recorded in the worktree's env file).`
      : `Worktree dev-server port: ${port} (read it via: discern identity --port).`,
  );
}

/**
 * Build the worktree-setup plan: the steps setup would perform, derived from the
 * config and the resolved identity. Read-only — it resolves the branch name
 * without creating it, so a `--dry-run` preview touches nothing.
 */
async function buildSetupPlan(ctx: LifecycleContext): Promise<SetupPlan> {
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  const current = (await makeGitRunner(ctx)(["branch", "--show-current"]))
    .stdout.trim();
  const branch = current !== "" ? current : identity.branch;

  const steps: SetupStepDesc[] = [
    { kind: "git", label: "ensure-branch", note: branch },
  ];
  if (ctx.config.worktree.inherit_env.length > 0) {
    steps.push({
      kind: "env",
      label: "inherit-env",
      note: ctx.config.worktree.inherit_env.join(", "),
    });
  }
  for (const spec of readResourceSpecs(ctx.config)) {
    if (spec.create !== "" || spec.destroy !== "") {
      steps.push({
        kind: "resource-create",
        label: spec.name,
        note: resourceForId(settings.slug, id, spec.name),
      });
    }
  }
  if (ctx.config.worktree.port) {
    steps.push({
      kind: "env",
      label: "record-port",
      note: String(identity.port),
    });
  }
  for (const step of ctx.config.worktree.setup.steps) {
    steps.push({ kind: "setup-step", label: step });
  }
  for (const step of ctx.config.repository.ensure) {
    steps.push({ kind: "repository-ensure", label: step });
  }
  for (const step of ctx.config.worktree.setup.ensure) {
    steps.push({ kind: "setup-ensure", label: step });
  }
  steps.push({ kind: "refresh", label: "refresh agent files" });
  return { branch, steps };
}

/**
 * Map the EXECUTED setup plan to `--json` results — recording what actually
 * happened, not a synthesized all-`ok`. A fatal step (a required resource, a
 * `setup.steps` non-zero exit, a fresh-creation `setup.ensure` failure) throws
 * before this is reached; the steps that warn-and-continue are reported honestly: a
 * non-required resource whose create failed, an agent-file refresh that threw, or a
 * re-entry `setup.ensure` command that exited non-zero, is `failed`, not `ok`. The
 * plan is the one built before execution (never re-derived), so the reported steps
 * can't drift from what the dry-run previewed.
 */
function setupResults(
  plan: SetupPlan,
  failedResources: string[],
  refreshOk: boolean,
  repositoryEnsureOutcomes: StepOutcome[],
  worktreeEnsureOutcomes: StepOutcome[],
): StepResult[] {
  let repositoryEnsureIndex = 0;
  let worktreeEnsureIndex = 0;
  return plan.steps.map((s) => {
    const repositoryEnsureOutcome = s.kind === "repository-ensure"
      ? repositoryEnsureOutcomes[repositoryEnsureIndex++]
      : undefined;
    const worktreeEnsureOutcome = s.kind === "setup-ensure"
      ? worktreeEnsureOutcomes[worktreeEnsureIndex++]
      : undefined;
    const failed = (s.kind === "resource-create" &&
      failedResources.includes(s.label)) ||
      repositoryEnsureOutcome === "failed" ||
      worktreeEnsureOutcome === "failed" ||
      (s.kind === "refresh" && !refreshOk);
    return {
      step: { kind: s.kind, label: s.label, disposition: "run", note: s.note },
      outcome: failed ? "failed" : "ok",
    };
  });
}

/**
 * Run one ordered bucket of convergent checkout commands. `[repository].ensure`
 * is safe in any checkout; `[worktree.setup].ensure` may depend on a linked
 * worktree's identity and never reaches the main checkout. Both share the same
 * shell runner with one-shot worktree `steps`. `fatal` selects the failure
 * contract: at a fresh creation a non-zero exit is fatal (a worktree that cannot
 * ready its environment is broken — abort loudly,
 * exactly like a `steps` failure); on a re-entry or update it is recorded and the
 * run continues (never undo a completed merge or break session start over a
 * convergence hiccup — the gate is the backstop). Returns one outcome per command,
 * preserving duplicate commands as distinct executions. A no-op when none are declared.
 */
async function runEnsureCommands(
  ctx: LifecycleContext,
  commands: string[],
  opts: {
    fatal: boolean;
    cwd: string;
    scope: "repository" | "worktree";
  },
): Promise<StepOutcome[]> {
  const outcomes: StepOutcome[] = [];
  for (const step of commands) {
    const label = opts.scope === "repository"
      ? "Repository ensure step"
      : "Worktree ensure step";
    ctx.log.info(`${label}: ${step}`);
    const code = await runShellRouted(step, { cwd: opts.cwd, log: ctx.log });
    if (code !== 0) {
      if (opts.fatal) {
        throw new WorktreeGitError(
          `The ${opts.scope} ensure step failed: ${step}. Fix that command or its ` +
            `prerequisites, then re-run \`discern worktree setup\`.`,
        );
      }
      ctx.log.warn(`${label} failed (continuing): ${step}`);
      outcomes.push("failed");
    } else {
      outcomes.push("ok");
    }
  }
  return outcomes;
}

/** Shared checkout convergence, safe in a linked worktree or the main checkout. */
async function runRepositoryEnsureSteps(
  ctx: LifecycleContext,
  opts: { fatal: boolean; cwd?: string },
): Promise<StepOutcome[]> {
  return await runEnsureCommands(ctx, ctx.config.repository.ensure, {
    fatal: opts.fatal,
    cwd: opts.cwd ?? ctx.cwd,
    scope: "repository",
  });
}

/** Worktree-identity-dependent convergence; never called in the main checkout. */
async function runWorktreeEnsureSteps(
  ctx: LifecycleContext,
  opts: { fatal: boolean },
): Promise<StepOutcome[]> {
  return await runEnsureCommands(ctx, ctx.config.worktree.setup.ensure, {
    fatal: opts.fatal,
    cwd: ctx.cwd,
    scope: "worktree",
  });
}

/**
 * Set up a linked worktree — the `worktree setup` command. Asserts the worktree
 * precondition, ensures a named branch, provisions the per-worktree resources (a
 * `required` create is fatal), inherits env vars, records the port + resource
 * handles into `.env`, runs the one-shot `[worktree.setup].steps`, then
 * checkout-shared `[repository].ensure`, then linked-worktree-only
 * `[worktree.setup].ensure`. It refreshes the agent files and drops the ready
 * sentinel. Throws on a fatal step. `--dry-run` shows the plan and touches nothing.
 *
 * Idempotent: when the worktree is already configured (the sentinel is present),
 * the non-idempotent phases are not repeated — resources are re-readied via
 * `ensure` rather than re-created, and the one-shot `steps` are skipped. The
 * convergent repository and worktree ensure buckets run on EVERY pass so a
 * re-fired `worktree create` hook or a re-run `discern worktree setup` re-converges the
 * worktree on the current tree.
 */
export async function worktreeSetup(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions = {},
): Promise<void> {
  // 1. must be inside a worktree
  await assertInWorktree("discern worktree setup", ctx.cwd);

  // Build the plan ONCE — the dry-run renders it and the apply records its
  // outcomes against it, so the preview and the `--json` report can't drift.
  const plan = await buildSetupPlan(ctx);
  if (opts.dryRun ?? false) {
    emitDryRun(
      ctx,
      "worktree setup",
      setupPlanToEngine(plan),
      opts.json ?? false,
    );
    return;
  }

  ctx.log.heading("Setting up this worktree…");

  // 2. ensure a named branch (resolve identity first for its branch base)
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  await ensureWorktreeBranch(identity.branch, ctx.cwd);

  // Has this worktree already completed setup? The ready sentinel is the proof. The
  // two non-ensure callers — a re-fired `worktree create` hook and an explicit
  // `discern worktree setup` — reach here on an already-configured worktree, where the
  // non-idempotent phases (resource `create`, `[worktree.setup].steps`) must not
  // re-run. (`worktreeEnsure` gates the session-start path the same way.)
  const configured = await worktreeSetupComplete(ctx.cwd);

  // 3. inherit env vars from main — FIRST among the env writers, because it is
  // the one allowed to CREATE the worktree's env file (a declared value must
  // arrive in a fresh worktree); the resource and port recorders below only ever
  // update files that exist.
  await inheritMainEnvVars({
    worktreeRoot: ctx.cwd,
    vars: ctx.config.worktree.inherit_env,
    files: ctx.config.worktree.env_files,
    log: ctx.log,
  });

  // 4. provision the per-worktree resources. On a FIRST setup, create them
  // (ledger-logged for GC; a required create failure aborts setup). On a re-entry,
  // re-ready them via `ensure` instead — never re-create. Needs the git identity.
  let createdFailed: string[] = [];
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  const gitKey = await worktreeGitKey(ctx.cwd);
  if (commonGitDir !== undefined && gitKey !== undefined) {
    if (configured) {
      await ensureResources(ctx, identity, settings);
    } else {
      createdFailed =
        (await createResources(ctx, identity, settings, commonGitDir, gitKey))
          .failed;
    }
    await recordResourceEnv(ctx, identity, settings);
  } else if (readResourceSpecs(ctx.config).length > 0) {
    throw new WorktreeGitError(
      "Discern could not identify this worktree in Git, so it could not set up its " +
        "resources. Run `git worktree repair`, then re-run `discern worktree setup`.",
    );
  }

  // 5. record the deterministic port
  await recordPort(ctx, identity);

  // 6. one-shot `steps`, then the shared and worktree convergence buckets.
  // `steps` are scaffolding: they run
  // only on a FRESH worktree and are skipped once configured (a one-shot `createdb`
  // must not re-run). Repository ensure converges checkout-generic dependencies;
  // worktree ensure handles identity-dependent state. Both run on EVERY pass —
  // after `steps` at a fresh creation, alone on re-entry. A fresh failure is FATAL;
  // a re-entry failure is recorded and non-fatal.
  let repositoryEnsureOutcomes: StepOutcome[] = [];
  let worktreeEnsureOutcomes: StepOutcome[] = [];
  if (configured) {
    if (ctx.config.worktree.setup.steps.length > 0) {
      ctx.log.info("Worktree already configured — skipping setup steps.");
    }
    repositoryEnsureOutcomes = await runRepositoryEnsureSteps(ctx, {
      fatal: false,
    });
    worktreeEnsureOutcomes = await runWorktreeEnsureSteps(ctx, {
      fatal: false,
    });
  } else {
    for (const step of ctx.config.worktree.setup.steps) {
      ctx.log.info(`Setup step: ${step}`);
      const code = await runShellRouted(step, { cwd: ctx.cwd, log: ctx.log });
      if (code !== 0) {
        throw new WorktreeGitError(
          `The worktree setup step failed: ${step}. Fix that command or its ` +
            `prerequisites, then re-run \`discern worktree setup\`.`,
        );
      }
    }
    // One-shot scaffolding may have rewritten the env file wholesale (the
    // canonical `cp .env.example .env`) — re-assert the env writers so the
    // inherited values and the recorded port/resource handles land in the
    // FINAL file, not the pre-step one the scaffold replaced. All three are
    // idempotent upserts, and the pre-step pass stays so the steps themselves
    // can read the values.
    if (ctx.config.worktree.setup.steps.length > 0) {
      await inheritMainEnvVars({
        worktreeRoot: ctx.cwd,
        vars: ctx.config.worktree.inherit_env,
        files: ctx.config.worktree.env_files,
        log: ctx.log,
      });
      if (commonGitDir !== undefined && gitKey !== undefined) {
        await recordResourceEnv(ctx, identity, settings);
      }
      await recordPort(ctx, identity);
    }
    repositoryEnsureOutcomes = await runRepositoryEnsureSteps(ctx, {
      fatal: true,
    });
    worktreeEnsureOutcomes = await runWorktreeEnsureSteps(ctx, { fatal: true });
  }

  // 7. refresh the agent files, which also materializes skills into THIS
  // worktree's .claude/skills/. A linked worktree does NOT inherit that gitignored
  // directory from the main checkout, so it must be (re)built here. Non-fatal —
  // but its real outcome is recorded, not reported as a blanket success.
  ctx.log.info("Refreshing agent files…");
  let refreshOk = true;
  try {
    const refreshed = await compileGuidelines(ctx.root, ctx.log);
    refreshOk = guidanceRefreshSucceeded(refreshed);
  } catch {
    refreshOk = false;
    ctx.log.warn("Agent-file refresh reported an error — continuing.");
  }

  await recordIgnoredFileBaseline(
    ctx.cwd,
    ctx.config.worktree.ignored_file_drift,
  );

  // mark this worktree configured
  const marker = await readySentinelPath(ctx.cwd);
  if (marker !== undefined) {
    try {
      await Deno.writeTextFile(marker, "");
    } catch {
      // best-effort sentinel — a failure here must not fail setup
    }
  }

  ctx.log.ok("Worktree setup complete.");

  const result = appliedResult(
    "worktree setup",
    setupResults(
      plan,
      createdFailed,
      refreshOk,
      repositoryEnsureOutcomes,
      worktreeEnsureOutcomes,
    ),
  );
  if ((opts.json ?? false) || (opts.humanApplySummary ?? true)) {
    emitOrRenderWorktreeResult(ctx, result, opts.json ?? false);
  }
}

/**
 * Create a linked worktree at `dir` on `branch` from the main checkout `mainRepo`,
 * then run its first-time setup — the shared "mint + ready a worktree at a resolved
 * location" core. Both `discern start` (which mints its own worktree from the main
 * checkout) and the Claude Code worktree-create hook call this, so the create-then-
 * setup sequence lives in exactly one place. It bakes in NO placement convention:
 * the caller resolves WHERE the worktree lands (`resolveWorktreeRoot`, the feature
 * layer) and passes the final `dir` — keeping this engine core agent-agnostic.
 * `startPoint` names the ref the new branch forks from (omitted → the main
 * checkout's HEAD — the caller decides). Idempotent end to end: `addWorktree`
 * no-ops on an existing worktree and `worktreeSetup` re-readies (never re-creates)
 * an already-configured one. Setup runs with the new worktree as both root and
 * cwd — a linked worktree is its own checkout, with its own discern.toml and
 * gitignored materialized skills to build.
 *
 * Fails CLOSED and CLEAN: an unborn repo (no first commit) is refused up front in
 * plain language, and any failure after the worktree was created here discards the
 * partial worktree (directory, registration, branch) before rethrowing — a failed
 * create must never leave debris that `status` then lists as a healthy worktree.
 */
export async function createAndSetupWorktree(
  mainRepo: string,
  dir: string,
  branch: string,
  log: Logger,
  startPoint?: string,
): Promise<void> {
  if (!(await hasAnyCommit(mainRepo))) {
    throw new WorktreeGitError(
      "This repository has no commits yet, so there is nothing to branch a " +
        "worktree from — make your first commit first, then re-run.",
    );
  }
  // Idempotence marker: when `dir` is already a worktree this call created nothing,
  // so a later failure must not discard someone else's live worktree.
  const preExisting = await pathPresent(join(dir, ".git"));
  // A fresh create always mints a fresh `-b` branch. When the branch already
  // exists — typically unlanded work left by an earlier worktree of the same
  // name — refuse up front in plain language: `git worktree add` would fail
  // anyway, and the branch (and its commits) was never this call's to touch.
  if (!preExisting && (await localBranchExists(mainRepo, branch))) {
    throw new WorktreeGitError(
      `A branch named '${branch}' already exists in this repository — it may ` +
        `hold unlanded work from an earlier worktree of the same name. Choose ` +
        `a different worktree name, or review that branch first ` +
        `(git log ${branch}) and land or delete it yourself, then re-run.`,
    );
  }
  // True once `git worktree add -b` has succeeded — the moment the branch (and
  // the checkout) became THIS call's creation, and so its to discard on failure.
  let createdWorktree = false;
  try {
    await addWorktree(mainRepo, dir, branch, startPoint);
    createdWorktree = true;
    let ctx: LifecycleContext;
    try {
      ctx = await lifecycleContext(dir, log, dir);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        // The checked-out tree has no discern.toml — the ref it branched from
        // predates discern (or setup hasn't landed on it). Say so plainly instead
        // of surfacing a raw readfile crash.
        throw new WorktreeGitError(
          `The new worktree at ${dir} has no discern config — the ref it ` +
            `branched from doesn't carry discern.toml. Branch from a ref that ` +
            `contains it: land setup on the trunk first, or pass --from <ref>, then ` +
            `re-run.`,
        );
      }
      throw e;
    }
    await worktreeSetup(ctx, { humanApplySummary: false });
  } catch (e) {
    if (!preExisting) {
      // Delete the branch only when the add above created it: a failed add
      // (e.g. a branch-name collision racing past the pre-check) means the
      // branch — possibly holding unlanded commits — was never ours to remove.
      await discardWorktreeBestEffort(mainRepo, dir, branch, log, {
        deleteBranch: createdWorktree,
      });
    }
    throw e;
  }
}

/**
 * Discard a worktree unconditionally and best-effort: destroy its resources (from
 * inside it, so `@dir@` destroys resolve), remove the worktree directory and its
 * git registration, then delete its branch — but ONLY under `deleteBranch: true`,
 * the caller's explicit claim that this very flow created the branch; cleanup
 * must never destroy a branch (and its commits) that predates it. Every step
 * swallows its own failure. This cleans up a failed `start`/create (no debris
 * left for `status` to list) and retires the viability probe's throwaway
 * worktree; `worktree prune` is the backstop for anything it misses.
 */
async function discardWorktreeBestEffort(
  mainRepo: string,
  dir: string,
  branch: string,
  log: Logger,
  opts: { deleteBranch: boolean },
): Promise<void> {
  try {
    await teardownResources(await lifecycleContext(dir, log, dir));
  } catch { /* best-effort */ }
  try {
    await removeWorktreeSafely(dir, mainRepo);
  } catch { /* best-effort */ }
  if (opts.deleteBranch) {
    try {
      await runGit(["branch", "-D", branch], { cwd: mainRepo });
    } catch { /* best-effort */ }
  }
}

/** The outcome of the idempotent session-start ensure check. */
export type EnsureResult =
  /** Not in a linked worktree → silent no-op. */
  | { kind: "skipped" }
  /** Already configured (the sentinel is present) → no-op. */
  | { kind: "already" }
  /** Setup was not yet run; it has now been executed. */
  | { kind: "ran" };

/**
 * The idempotent session-start check — the `worktree ensure` command. Runs
 * `worktreeSetup` exactly once for a linked worktree that has not been set up.
 * Safe to run on every session start: the main checkout, a
 * non-git dir, or an already-configured worktree are all silent no-ops.
 */
export async function worktreeEnsure(
  ctx: LifecycleContext,
): Promise<EnsureResult> {
  // Skip when not inside a linked worktree (including the main checkout).
  try {
    await assertInWorktree("session-start", ctx.cwd);
  } catch {
    return { kind: "skipped" };
  }
  if (await worktreeSetupComplete(ctx.cwd)) {
    // Already set up — converge the worktree: reconcile any resource that declares an
    // `ensure` (re-ready one that died out-of-band, e.g. a host reboot) and re-run the
    // checkout-shared and worktree-only ensure commands. All are
    // best-effort here — a convergence hiccup must never break session start. Cheap
    // and silent when neither is declared.
    const { identity, settings } = await resolveContextIdentity(ctx);
    await ensureResources(ctx, identity, settings);
    await runRepositoryEnsureSteps(ctx, { fatal: false });
    await runWorktreeEnsureSteps(ctx, { fatal: false });
    return { kind: "already" };
  }
  ctx.log.warn(
    "[discern] Worktree not configured yet; running 'discern worktree setup'…",
  );
  await worktreeSetup(ctx, { humanApplySummary: false });
  return { kind: "ran" };
}

/**
 * Tear down this worktree's resources without accepting its
 * branch — the `worktree teardown` command, used when discarding a worktree.
 * Asserts the worktree precondition; destroys every resource the worktree created.
 */
export async function worktreeTeardown(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions = {},
): Promise<void> {
  await assertInWorktree("discern worktree teardown", ctx.cwd);

  const plan = await buildTeardownPlan(ctx);
  if (opts.dryRun ?? false) {
    emitDryRun(
      ctx,
      "worktree teardown",
      teardownPlanToEngine(plan),
      opts.json ?? false,
    );
    return;
  }

  ctx.log.heading("Tearing down this worktree…");
  // Apply CONSUMES the plan: destroy exactly the entries the dry-run previewed,
  // not a fresh re-read that could have drifted.
  const { destroyed, failed } = await destroyResources(ctx, plan.entries);
  ctx.log.ok("Worktree teardown complete.");

  const results: StepResult[] = plan.entries.map((item) => ({
    step: {
      kind: "resource-destroy",
      label: item.entry.resource_name,
      disposition: "run",
      note: item.entry.resource_identity,
    },
    outcome: failed.includes(item.entry.resource_name)
      ? "failed"
      : destroyed.includes(item.entry.resource_name)
      ? "ok"
      : "skipped",
  }));
  emitOrRenderWorktreeResult(
    ctx,
    appliedResult("worktree teardown", results),
    opts.json ?? false,
  );
}

/** Options for {@link worktreeDrop}. */
export interface WorktreeDropOptions extends WorktreeOpOptions {
  /** Discard even when the worktree holds uncommitted changes or unmerged commits. */
  force?: boolean;
}

/**
 * The read-only diagnosis a `worktree drop` acts on: resolve `target` (a worktree
 * id or path) against git's own registry, snapshot what discarding it would lose,
 * and read its resource ledger. Refuses an unknown target (listing the known ids)
 * and the main checkout. A plan exists even when blocked — `--dry-run` shows what
 * a `--force` WOULD discard; the executor enforces the `--force` gate.
 */
async function buildDropPlan(
  ctx: LifecycleContext,
  target: string,
): Promise<DropPlan> {
  await assertNotInWorktree("discern worktree drop", ctx.cwd);
  if (target.trim() === "") {
    throw new WorktreeGitError(
      "discern worktree drop needs a target. Pass a worktree id or path, then re-run.",
    );
  }
  const trunk = integrationBranch(ctx.config.repository.trunk);
  const fleet = (await listWorktreeFleet(ctx.cwd, trunk)).filter((row) =>
    !row.isMain
  );
  if (fleet.length === 0) {
    throw new WorktreeGitError(
      "There are no worktrees to drop. Run `discern status` to review the current " +
        "worktrees; if none is listed, there is nothing to remove.",
    );
  }

  // Match by canonical path, by directory basename, or by resolved worktree id.
  // Anything with a path separator is a path — relative ones resolve against the
  // caller's cwd (an id never contains a slash); a bare name stays id/basename.
  const wanted = target.trim().replace(/\/+$/, "");
  const wantedAbs = isAbsolute(wanted) || wanted.includes("/")
    ? await Deno.realPath(resolve(wanted)).catch(() => resolve(wanted))
    : undefined;
  const settings = await loadIdentitySettings(ctx.root).catch(() => undefined);
  let match: (typeof fleet)[number] | undefined;
  for (const row of fleet) {
    if (row.path === wantedAbs || basename(row.path) === wanted) {
      match = row;
      break;
    }
    if (settings !== undefined) {
      const id = await resolveWorktreeId(settings, row.path).catch(() =>
        undefined
      );
      if (id === wanted) {
        match = row;
        break;
      }
    }
  }
  if (match === undefined) {
    const known = fleet.map((row) => basename(row.path)).join(", ");
    throw new WorktreeGitError(
      `No worktree matches '${target}'. Known worktrees: ${known}. ` +
        `Pass one of those worktree ids (the directory name) or its path, then re-run.`,
    );
  }

  // A `git worktree lock`ed worktree cannot be removed at all (git refuses, and
  // discern honors the lock — it protects checkouts and their ignored files on
  // removable/network media). A hard refusal, NOT a --force blocker: --force
  // consents to discarding work, not to defeating git's own protection.
  if (match.locked) {
    throw new WorktreeGitError(
      `Worktree '${basename(match.path)}' is locked (git worktree lock), so ` +
        `discern will not remove it — not even with --force. Unlock it first ` +
        `(git worktree unlock ${match.path}), then re-run.`,
    );
  }

  // What a drop would lose — the `--force` blockers.
  const blockers: string[] = [];
  const trunkExists = await localBranchExists(ctx.root, trunk);
  if (match.snapshot === undefined) {
    // Git could not run inside the worktree (missing directory, corrupted
    // gitlink, permission refusal) — its working-tree state is UNKNOWN, and an
    // unknown state fails SAFE: it blocks the drop rather than reading as
    // clean. The branch ref still lives in the main repo, so unlanded commits
    // stay checkable (and nameable) even when the checkout is unreadable.
    if (!trunkExists) {
      blockers.push(
        `cannot verify the work is merged (no local '${trunk}' branch)`,
      );
    } else if (
      match.branch !== "" && match.branch !== trunk &&
      !(await branchIsMerged(ctx.root, match.branch, trunk))
    ) {
      blockers.push(`branch '${match.branch}' has commits not on ${trunk}`);
    }
    blockers.push(
      "the worktree's git state could not be read (its checkout is missing " +
        "or damaged), so uncommitted work cannot be ruled out",
    );
  } else {
    if (match.snapshot.changedFiles > 0) {
      blockers.push(
        `${match.snapshot.changedFiles} uncommitted change${
          match.snapshot.changedFiles === 1 ? "" : "s"
        }`,
      );
    }
    if (trunkExists) {
      if (match.snapshot.ahead > 0) {
        blockers.push(
          `${match.snapshot.ahead} commit${
            match.snapshot.ahead === 1 ? "" : "s"
          } not on ${trunk}`,
        );
      }
    } else {
      blockers.push(
        `cannot verify the work is merged (no local '${trunk}' branch)`,
      );
    }
  }

  // The resource ledger for the target (destruction order), read via ITS git key.
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  const gitKey = await worktreeGitKey(match.path);
  const entries = commonGitDir !== undefined && gitKey !== undefined
    ? await entriesForWorktree(commonGitDir, gitKey)
    : [];

  return {
    targetPath: match.path,
    id: basename(match.path),
    branch: match.branch,
    // Drop discards a LINE OF WORK; the trunk is never one. A worktree holding
    // the trunk (the legacy accept-to-branch layouts leave these behind) has
    // its checkout removed and its branch kept — deleting the trunk would leave
    // the repository with no landing target at all.
    deleteBranch: match.branch !== "" && match.branch !== trunk,
    blockers,
    entries,
  };
}

/**
 * Discard a worktree from the main checkout — the `discern worktree drop`
 * command, the sanctioned removal for abandoned work (`worktree prune` only ever
 * reclaims fully-merged, clean worktrees; before this verb the fallback was raw
 * `rm -rf`). Tears down the worktree's resources, removes the worktree directory
 * and registration, and deletes its branch. When the worktree holds uncommitted
 * changes or commits not on the trunk it refuses without `--force`, naming
 * exactly what a forced drop would discard. `--dry-run` shows the plan and
 * touches nothing. Deliberately CLI-only — no MCP tool: the MCP surface aims at
 * the caller's OWN worktree, every other worktree is another line of work an
 * agent must never remove (the fleet ownership rule), and discarding work is a
 * human supervisory action; `status` hints carry the command to the human.
 */
export async function worktreeDrop(
  ctx: LifecycleContext,
  target: string,
  opts: WorktreeDropOptions = {},
): Promise<void> {
  const plan = await buildDropPlan(ctx, target);
  if (opts.dryRun ?? false) {
    emitDryRun(
      ctx,
      "worktree drop",
      dropPlanToEngine(plan),
      opts.json ?? false,
    );
    return;
  }

  if (plan.blockers.length > 0 && !(opts.force ?? false)) {
    throw new WorktreeGitError(
      `Worktree '${plan.id}' has work a drop would discard: ${
        plan.blockers.join("; ")
      }. Resume a session there to finish or land it, or re-run with --force ` +
        `to discard it permanently.`,
    );
  }

  ctx.log.heading(`Dropping worktree '${plan.id}'…`);
  const steps: StepResult[] = [];

  // 1. Tear down its resources, best-effort — from inside the target so
  // `@dir@`-bearing destroys resolve; a configless (broken) worktree falls back to
  // the main checkout's context (resource commands are authored cwd-independent).
  // A teardown hiccup never strands the drop; `worktree prune`'s GC is the backstop.
  let destroyed: string[] = [];
  let failed: string[] = [];
  if (plan.entries.length > 0) {
    const teardownCtx = await lifecycleContext(
      plan.targetPath,
      ctx.log,
      plan.targetPath,
    ).catch(() => ctx);
    ({ destroyed, failed } = await destroyResources(
      teardownCtx,
      plan.entries,
    ));
  }
  for (const item of plan.entries) {
    steps.push({
      step: {
        kind: "resource-destroy",
        label: item.entry.resource_name,
        disposition: "run",
        note: item.entry.resource_identity,
      },
      outcome: failed.includes(item.entry.resource_name)
        ? "failed"
        : destroyed.includes(item.entry.resource_name)
        ? "ok"
        : "skipped",
    });
  }

  // 2. Remove the worktree directory + registration.
  ctx.log.info(`Removing worktree: ${plan.targetPath}`);
  try {
    await removeWorktreeSafely(plan.targetPath, ctx.root);
  } catch (e) {
    throw new WorktreeGitError(
      `Worktree removal failed for ${plan.targetPath}: ${
        e instanceof Error ? e.message : String(e)
      }\nRun \`git worktree list\` to inspect its state, fix the problem it shows, ` +
        `then re-run \`discern worktree drop ${plan.id}\`.`,
    );
  }
  steps.push({
    step: {
      kind: "git",
      label: "remove-worktree",
      disposition: "run",
      note: plan.targetPath,
    },
    outcome: "ok",
  });

  // 3. Delete its branch (force — the --force gate above is the consent for an
  // unmerged branch; a merged one deletes the same way). Never the trunk: a
  // worktree holding it loses only its checkout (`plan.deleteBranch`).
  if (plan.deleteBranch) {
    const del = await makeGitRunner(ctx)(
      ["branch", "-D", plan.branch],
      ctx.root,
    );
    if (!del.success) {
      throw new WorktreeGitError(
        `The worktree was removed, but Git could not delete its branch ` +
          `'${plan.branch}'. Delete it with \`git branch -D ${plan.branch}\` after ` +
          `reviewing the error below.\nGit said: ${del.stderr.trim()}`,
      );
    }
    ctx.log.ok(`Deleted branch ${plan.branch}.`);
    steps.push({
      step: {
        kind: "git",
        label: "delete-branch",
        disposition: "run",
        note: plan.branch,
      },
      outcome: "ok",
    });
  } else if (plan.branch !== "") {
    ctx.log.ok(`Kept branch ${plan.branch} — the trunk is never deleted.`);
    steps.push({
      step: {
        kind: "git",
        label: "delete-branch",
        disposition: "skip",
        note: `${plan.branch} is the trunk — kept`,
      },
      outcome: "skipped",
    });
  }

  ctx.log.ok(`Worktree '${plan.id}' dropped.`);
  emitOrRenderWorktreeResult(
    ctx,
    appliedResult("worktree drop", steps),
    opts.json ?? false,
  );
}

/** A bound git runner for the acceptance flow (defaults to the worktree cwd). */
type GitRunner = (args: string[], cwd?: string) => Promise<GitResult>;

/** The git runner acceptance uses — the shared runner bound to the worktree cwd. */
function makeGitRunner(ctx: LifecycleContext): GitRunner {
  return (args: string[], cwd: string = ctx.cwd) => runGit(args, { cwd });
}

/**
 * The read-only diagnosis an acceptance acts on — the plan-build half. Asserts the
 * preconditions (in a worktree, not the main repo, branch contains main, main is
 * clean AND sitting on the trunk — acceptance fast-forwards the trunk there and
 * never silently switches a parked checkout), throwing the same
 * `WorktreeGitError`s as before so a plan only exists for an acceptance that may
 * proceed. Resolves the branch name read-only for display; the authoritative
 * branch (created if the worktree is detached) is ensured by the executor, so
 * building a plan — and `--dry-run` — never mutates.
 */
async function buildAcceptPlan(
  ctx: LifecycleContext,
  run: GitRunner,
): Promise<AcceptPlan> {
  // diagnose
  if (!(await run(["rev-parse", "--is-inside-work-tree"])).success) {
    throw new WorktreeGitError(
      "discern accept needs a Git worktree, but this directory is outside a Git " +
        "repository. Move into the worktree that holds the finished branch, then re-run.",
    );
  }
  const gitDir = (await run(["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const commonRaw = (await run(["rev-parse", "--git-common-dir"])).stdout
    .trim();
  const gitCommonDir = await realPathOrLifecycle(commonRaw, ctx.cwd);
  if (gitDir === gitCommonDir) {
    throw new WorktreeGitError(
      "discern accept runs inside a worktree — a separate checkout and branch for " +
        "one change — but this is the main checkout. Move into the finished worktree " +
        "path shown by `discern status`, then re-run.",
    );
  }
  const worktreePath = (await run(["rev-parse", "--show-toplevel"])).stdout
    .trim();

  // resolve the branch name read-only (the executor ensures/creates it)
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  const current = (await run(["branch", "--show-current"])).stdout.trim();
  const worktreeBranch = current !== "" ? current : identity.branch;

  const mainRepo = await mainRepoPath(ctx.cwd);
  if (mainRepo === undefined) {
    throw new WorktreeGitError(
      "Discern could not find the main checkout from Git's worktree records. Run " +
        "`git worktree repair`, then re-run `discern accept`.",
    );
  }
  if (mainRepo === worktreePath) {
    throw new WorktreeGitError(
      "Git identifies this path as the main checkout, so there is no worktree branch " +
        "to accept. Move into the finished worktree shown by `discern status`, then " +
        "re-run `discern accept`.",
    );
  }

  // Acceptance ends by REMOVING this worktree, and a `git worktree lock`ed one
  // cannot be removed (git refuses; discern honors the lock). Refuse at plan
  // time — before the gate runs and long before the trunk fast-forwards — so a
  // locked worktree never strands a half-landed acceptance.
  if (
    (await registeredWorktreeRecord(worktreePath, mainRepo))?.locked === true
  ) {
    throw new WorktreeGitError(
      `This worktree is locked (git worktree lock), and acceptance removes ` +
        `the worktree after landing. Unlock it first ` +
        `(git worktree unlock ${worktreePath}), then re-run discern accept.`,
    );
  }

  // require the branch contains the latest integration branch
  const trunkBranch = integrationBranch(ctx.config.repository.trunk);
  ctx.log.info(`Checking the branch contains the latest ${trunkBranch}…`);
  const merged = await assertMainMerged(
    ctx.cwd,
    ctx.config.repository.trunk,
  );
  if (merged.kind === "behind") {
    throw new WorktreeGitError(
      `This branch is behind the trunk (${trunkBranch}). Run \`discern update\` to ` +
        `bring it in, then \`discern done\`, then re-run \`discern accept\`.`,
    );
  }
  if (merged.kind === "missing") {
    throw new WorktreeGitError(
      `${missingIntegrationBranchWarning(merged.branch)} ` +
        "Acceptance will not remove this worktree until the merge check can run.",
    );
  }
  ctx.log.ok(`Branch contains the latest ${trunkBranch}.`);

  // capture worktree state
  const worktreeDirty =
    (await run(["status", "--porcelain", "-z"])).stdout.trim() !== "";
  if (worktreeDirty) {
    throw new WorktreeGitError(
      "This worktree has uncommitted changes, so acceptance cannot land a stable " +
        "commit. Commit or stash them, then re-run `discern accept`; discern never " +
        "creates a work-in-progress commit for you.",
    );
  }
  const ignoredFileChanges = await inspectIgnoredFileChanges(
    ctx.cwd,
    ctx.config.worktree.ignored_file_drift,
  );
  // Refuse to move the main checkout only for tracked changes. Untracked local
  // provider/session scratch does not participate in the fast-forward and is
  // left in place.
  const mainDirty = await hasUncommittedTrackedChanges(mainRepo) ?? false;
  const mainBranchRun = await run(["branch", "--show-current"], mainRepo);
  const mainBranch = mainBranchRun.stdout.trim() !== ""
    ? mainBranchRun.stdout.trim()
    : "(detached)";

  // gate: refuse to touch a dirty main checkout
  if (mainDirty) {
    throw new WorktreeGitError(
      `Main checkout at ${mainRepo} has uncommitted tracked changes on '${mainBranch}'. ` +
        `Commit or stash them, then re-run \`discern accept\`; acceptance will not move ` +
        `your main-checkout work for you. ` +
        `Your worktree branch '${worktreeBranch}' is untouched and still holds all its commits.`,
    );
  }

  // gate: acceptance fast-forwards the trunk IN the main checkout, so the main
  // checkout must be sitting on the trunk — never silently switch it off whatever
  // branch someone parked it on.
  if (mainBranch !== trunkBranch) {
    throw new WorktreeGitError(
      offTrunkAcceptRefusal(mainRepo, mainBranch, trunkBranch),
    );
  }

  return {
    worktreeBranch,
    worktreePath,
    mainRepo,
    trunk: ctx.config.repository.trunk,
    repositoryEnsureSteps: ctx.config.repository.ensure,
    smokeSteps: planStageJobs(ctx.config, "test")
      .filter((job) =>
        job.kind === "capability" && /^smoke(?:#\d+)?$/.test(job.label)
      )
      .map((job) => ({
        label: job.label,
        command: job.command,
        ...(job.timeoutS !== undefined ? { timeoutS: job.timeoutS } : {}),
      })),
    hasResources: readResourceSpecs(ctx.config).length > 0,
    ignoredFileChanges,
  };
}

/** The accept refusal when the main checkout is parked on a branch other than
 * the trunk (detached included). Acceptance lands by fast-forwarding the trunk in
 * the main checkout, so switching it back is the user's one clear next step —
 * never something accept does silently to a checkout someone parked
 * deliberately. */
function offTrunkAcceptRefusal(
  mainRepo: string,
  mainBranch: string,
  trunk: string,
): string {
  return `The main checkout at ${mainRepo} is on '${mainBranch}', not ` +
    `'${trunk}' (the trunk). Acceptance lands by fast-forwarding the trunk ` +
    `there, so return it first — \`git -C ${mainRepo} switch ${trunk}\` — ` +
    `then re-run \`discern accept\`. Your branch keeps all its commits.`;
}

/** The relay-and-recovery sentence the consent refusal serves on every surface
 * — the Error's message (the human render) and the envelope's `message`. It
 * re-serves the review moment (relay the receipt, wait for the owner) and names
 * the recovery (re-run with the attestation). Mutation-free: it fires before any
 * git runs, so the worktree, its branch, and the trunk are genuinely untouched. */
const ACCEPT_AWAITING_CONSENT_MESSAGE =
  "Landing is the owner's decision, so `discern accept` needs their explicit " +
  "acceptance before it lands. Relay the receipt to your owner and wait for " +
  "their go-ahead, then re-run `discern accept --confirmed` (standing " +
  "pre-authorization counts as their acceptance). Nothing has been landed — " +
  "the worktree, its branch, and the trunk are untouched.";

/**
 * The read-only refusal `accept` serves when its `--confirmed` attestation is
 * absent (ADR 0134, extending ADR 0086's pattern to the landing verb). Landing is
 * the highest-stakes act, so structure — not a guidance sentence — forces the
 * relay moment into the transcript: an agent under context pressure that runs
 * `accept` without the attestation is handed the review moment, not silently
 * landed. Shares the {@link AWAITING_CONSENT_SLUG} slug with `setup begin` so the
 * consent-gated class is one contract. Carries ≥1 actionable hint; the honored
 * receipt and the raw-diff command it points at live once, on `discern status`.
 */
function acceptAwaitingConsentResult(): DiscernResult<AcceptData> {
  return {
    ok: false,
    verb: "accept",
    error: AWAITING_CONSENT_SLUG,
    message: ACCEPT_AWAITING_CONSENT_MESSAGE,
    hints: [
      "Re-run `discern accept --confirmed` once your owner has accepted this " +
      "landing — the flag attests that acceptance, so a pre-authorized landing " +
      "still takes one call.",
      "`discern status` carries the honored receipt to relay " +
      "(data.gate_receipt.receipt) and the exact `git diff` command for the raw " +
      "change.",
    ],
  };
}

// How many of the gate's diagnostics ride inline in an accept refusal before the agent
// is pointed at `discern done` for the rest — a cap so a gate that failed with many
// findings can't flood accept's refusal message.
const ACCEPT_DIAG_CAP = 10;

/**
 * The accept refusal when the branch does NOT pass `done` at the tree it would land
 * (ADR 0067). Leads with the gate's own failed-stage message (the same {@link failMessage}
 * SSOT `done` prints), then a capped list of the surfaced diagnostics, then the recovery:
 * run `discern done` to see the full output and fix it. The branch keeps all its commits
 * and the worktree is intact (this precedes every teardown/removal).
 */
function acceptGateRefusal(
  branch: string,
  gate: DiscernResult<GateData>,
): string {
  const stage = gate.data?.failed_stage ?? null;
  const headline = stage !== null ? failMessage(stage) : "The gate failed.";
  const diags = gate.diagnostics ?? [];
  const shown = diags
    .slice(0, ACCEPT_DIAG_CAP)
    .map((d) => `  • ${d.message} (reproduce: ${d.reproduce_cmd})`);
  if (diags.length > shown.length) {
    shown.push(`  … (+${diags.length - shown.length} more)`);
  }
  return `Branch '${branch}' does not pass \`discern done\`, so it cannot land. ` +
    `${headline} Run \`discern done\` to see the full output and fix it, then commit ` +
    `and re-run \`discern accept\` — your branch keeps all its commits.` +
    (shown.length > 0 ? `\n\nWhat failed:\n${shown.join("\n")}` : "");
}

/** The accept refusal when the branch tip has moved off the commit the gate
 * validated — a commit landed while acceptance was validating (or between the
 * validation and the fast-forward), so the tree that would land is not the tree
 * the gate tested. Nothing has been changed when this fires. */
function movedDuringAcceptanceRefusal(
  branch: string,
  worktreePath: string,
): string {
  return `Branch '${branch}' moved while this acceptance was validating it — ` +
    `a commit landed after the gate run began, so the tree that would land ` +
    `is not the tree the gate tested. Nothing was changed and the worktree ` +
    `is intact. Re-run \`discern done\` on the final commit from ` +
    `${worktreePath}, then \`discern accept\` again.`;
}

async function assertAcceptBranchStillCurrent(
  cwd: string,
  trunkBranch: string,
): Promise<void> {
  const merged = await assertMainMerged(cwd, trunkBranch);
  if (merged.kind === "behind") {
    throw new WorktreeGitError(
      `This branch fell behind the trunk (${trunkBranch}) while the gate ran. ` +
        `Run \`discern update\` from this worktree, then \`discern done\` and ` +
        `\`discern accept\` again. The worktree has not been removed.`,
    );
  }
  if (merged.kind === "missing") {
    throw new WorktreeGitError(
      `${missingIntegrationBranchWarning(merged.branch)} ` +
        "Acceptance will not remove this worktree until the merge check can run.",
    );
  }
}

/**
 * Run only the configured smoke capability in the landing checkout. The full
 * gate already validated the commit in the worktree; this second, deliberately
 * narrow pass proves the main checkout's local runtime state is usable after its
 * repository convergence commands. It is non-fatal because the trunk has
 * already moved, but its real job steps and diagnostics are retained.
 */
async function runLandingSmoke(
  mainRepo: string,
  config: DiscernConfig,
  plan: AcceptPlan,
  log: Logger,
): Promise<{
  steps: StepResult[];
  diagnostics: Diagnostic[];
  hints: string[];
}> {
  if (plan.smokeSteps.length === 0) {
    return { steps: [], diagnostics: [], hints: [] };
  }
  const group: JobGroup = {
    stage: "test",
    mode: "parallel",
    heading: "Proving the landing checkout is ready...",
    display: "Smoke",
    jobs: plan.smokeSteps.map((job) => ({
      label: job.label,
      command: job.command,
      kind: "capability",
      reportStage: "test",
      willRun: true,
      ...(job.timeoutS !== undefined ? { timeoutS: job.timeoutS } : {}),
    })),
  };
  log.info("Running the smoke capability in the landing checkout...");
  // Always keep the gate runner quiet here: accept owns stdout (especially its
  // JSON envelope), while serializeJobSteps retains failure output as structured
  // diagnostics exactly as the normal gate does.
  const { runOpts, out } = gateRunContext(mainRepo, config, true);
  const { results, failedStage } = await runJobGroups([group], runOpts, out);
  const serialized = await serializeJobSteps([group], results);
  if (failedStage === null) {
    log.ok("Landing-checkout smoke passed.");
  } else {
    log.warn("Landing-checkout smoke failed — the landing is kept.");
  }
  return serialized;
}

/**
 * Apply an acceptance plan — the mutation dance. Ensures the named branch
 * (creating one if the worktree is detached), validates the exact tree against
 * the whole gate (ADR 0067, fast-pathed by a gate receipt), fast-forwards the
 * trunk, then refreshes, converges, and smoke-tests the receiving checkout before
 * the cleanup tail tears down resources, removes the worktree, and deletes the
 * merged branch. Returns the per-step results for `--json`.
 */
async function executeAcceptPlan(
  ctx: LifecycleContext,
  run: GitRunner,
  plan: AcceptPlan,
): Promise<{
  steps: StepResult[];
  gateValidation: NonNullable<AcceptData["gate_validation"]>;
  receiptMarkdown: string | undefined;
  convergenceHints: string[];
  diagnostics: Diagnostic[];
}> {
  // ensure a named branch (the one mutating step the read-only diagnosis deferred)
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  const worktreeBranch = await ensureWorktreeBranch(identity.branch, ctx.cwd);
  if (worktreeBranch === "") {
    throw new WorktreeGitError(
      `This worktree is detached from a named branch, and discern could not create ` +
        `one. Run \`git switch -c ${identity.branch}\` here, then re-run ` +
        `\`discern accept\`.`,
    );
  }
  const { worktreePath, mainRepo, trunk } = plan;

  // Validation gate (ADR 0067) — the exact tree we are about to land must pass the WHOLE
  // gate, so a clean-merging but gate-breaking `update` (or any tree never run through
  // `done` — e.g. a docs edit gated only by a prose linter) cannot fast-forward onto the
  // trunk LOCALLY, where CI's checks never run. This precedes every teardown/removal below,
  // so a refusal leaves the branch and worktree intact.
  //   FAST PATH: a gate receipt proves the current clean HEAD already passed `done`
  //   (the common case — nothing changed since the agent finished), so skip the re-run.
  //   SLOW PATH: run the full gate now and refuse to land on any failure. A merge `update`
  //   created, a new commit, or a dirty tree invalidates the receipt, landing us here.
  const receipt = await inspectGateReceipt(ctx.cwd);
  const gateValidation: NonNullable<AcceptData["gate_validation"]> =
    receipt.status === "honored"
      ? { mode: "receipt", receipt }
      : { mode: "rerun", receipt };
  // The receipt markdown for the tree that lands — the landing record accept
  // prints and carries: the honored marker stored it on the fast path; the fresh
  // gate run rendered it on the slow path. `validatedSha` is the ONE commit this
  // validation vouches for — the honored receipt's recorded sha, or the HEAD pinned
  // before the gate re-run — and it is the exact rev the fast-forward below lands:
  // a commit made during the (minutes-long) re-run must never ride along unvalidated.
  let receiptMarkdown: string | undefined;
  let validatedSha: string | undefined;
  if (gateValidation.mode === "receipt") {
    ctx.log.ok(
      "Branch already passed the gate at this commit — skipping the re-run.",
    );
    receiptMarkdown = receipt.receipt;
    validatedSha = receipt.head;
  } else {
    ctx.log.info("Validating the branch against the full gate before landing…");
    const pin = await pinValidatedTree(ctx.cwd);
    const gate = await finishResult(ctx.cwd);
    if (!gate.ok) {
      throw new WorktreeGitError(acceptGateRefusal(worktreeBranch, gate));
    }
    const now = await pinValidatedTree(ctx.cwd);
    if (
      pin.head === undefined || now.head !== pin.head || !pin.clean ||
      !now.clean
    ) {
      throw new WorktreeGitError(
        movedDuringAcceptanceRefusal(worktreeBranch, worktreePath),
      );
    }
    ctx.log.ok("Gate passed against the tree to be landed.");
    receiptMarkdown = gate.data?.receipt?.markdown;
    validatedSha = pin.head;
  }
  if (validatedSha === undefined) {
    // Defensive: an honored receipt always carries its head; refuse rather than
    // fall back to landing whatever the branch name resolves to at merge time.
    throw new WorktreeGitError(
      movedDuringAcceptanceRefusal(worktreeBranch, worktreePath),
    );
  }

  await assertAcceptBranchStillCurrent(ctx.cwd, trunk);

  const results: StepResult[] = [];
  const done = (kind: StepResult["step"]["kind"], label: string): void => {
    results.push({ step: { kind, label, disposition: "run" }, outcome: "ok" });
  };
  const doneRefresh = (
    outcome: StepResult["outcome"],
    note: string,
  ): void => {
    results.push({
      step: {
        kind: "refresh",
        label: "refresh agent files",
        disposition: "run",
        note,
      },
      outcome,
    });
  };

  ctx.log.heading("Acceptance plan");
  ctx.log.detail(`Branch:        ${worktreeBranch}`);
  ctx.log.detail(`From worktree: ${worktreePath}`);
  ctx.log.detail(
    `Into trunk:         ${mainRepo} (fast-forward ${trunk}, delete ${worktreeBranch})`,
  );
  const ignoredLine = ignoredFileChangeDetail(plan.ignoredFileChanges);
  if (ignoredLine !== undefined) {
    ctx.log.detail(ignoredLine);
  }
  const refreshTemplatesDir = await postLandingRefreshTemplatesDir(
    worktreePath,
    mainRepo,
  );

  // Land on the trunk: fast-forward it to the branch tip. The acceptance gate
  // already proved the branch contains the trunk, so this is always a clean
  // fast-forward — never a merge commit, never a conflict. The landing runs
  // BEFORE resource teardown so an acceptance that loses a concurrent-landing
  // race is refused with its worktree fully intact — resources included — and
  // the prescribed update → finish → accept recovery actually works.
  await assertAcceptBranchStillCurrent(ctx.cwd, trunk);
  // Re-verify the main checkout is STILL on the trunk immediately before the
  // fast-forward (the plan checked it, but the gate re-run above takes real time
  // and `git merge` advances whatever branch is checked out) — never fast-forward
  // a branch someone switched to mid-acceptance.
  const mainNow = (await run(["branch", "--show-current"], mainRepo)).stdout
    .trim();
  if (mainNow !== trunk) {
    throw new WorktreeGitError(
      offTrunkAcceptRefusal(
        mainRepo,
        mainNow === "" ? "(detached)" : mainNow,
        trunk,
      ),
    );
  }
  // Land the VALIDATED sha, not the branch name: a branch name resolves at merge
  // time, so a commit made after the validation above would ride onto the trunk
  // untested. Re-check the tip still names the validated commit (so the branch
  // deletion below deletes a fully-merged branch), then fast-forward to the sha.
  const tipNow = (await run(["rev-parse", "--verify", worktreeBranch], ctx.cwd))
    .stdout.trim();
  if (tipNow !== validatedSha) {
    throw new WorktreeGitError(
      movedDuringAcceptanceRefusal(worktreeBranch, worktreePath),
    );
  }
  ctx.log.info(`Fast-forwarding ${trunk} to ${worktreeBranch}…`);
  const ff = await run(
    ["merge", "--ff-only", "--quiet", validatedSha],
    mainRepo,
  );
  if (!ff.success) {
    // The usual cause is a concurrent landing: another line of work fast-forwarded
    // the trunk between this acceptance's checks and its own fast-forward. Say what
    // happened and what to do — the raw git stderr rides along as evidence, not as
    // the explanation.
    throw new WorktreeGitError(
      `The trunk (${trunk}) moved while this acceptance was running — most ` +
        `likely another line of work landed first — so Git did not move it and ` +
        `nothing was changed. Your worktree is fully intact, ` +
        `resources included, and your commits are safe on ` +
        `${worktreeBranch} at ${worktreePath}. From that worktree, run ` +
        `\`discern update\` to bring the new ${trunk} in beneath your work, ` +
        `then \`discern done\`, then \`discern accept\` again. ` +
        `Git said:\n    ${ff.stderr.trim()}`,
    );
  }
  ctx.log.ok(`${trunk} fast-forwarded to ${worktreeBranch} at ${mainRepo}.`);
  done("git", "fast-forward-trunk");

  // Converge and prove the checkout accept leaves behind BEFORE cleanup. The
  // trunk has already moved, so every operation in this block is non-fatal and
  // recorded: no dependency-install or smoke failure may strand the linked
  // worktree/resources by preventing the cleanup tail from running.
  const convergenceHints: string[] = [];
  const diagnostics: Diagnostic[] = [];
  ctx.log.info(
    "Re-materializing agent files + skills in the landing checkout…",
  );
  let refreshOk = true;
  try {
    const refreshed = await compileGuidelinesForLandingRefresh(
      mainRepo,
      ctx.log,
      refreshTemplatesDir,
    );
    refreshOk = guidanceRefreshSucceeded(refreshed);
    convergenceHints.push(...refreshed.hints);
  } catch {
    refreshOk = false;
    ctx.log.warn("Agent-file refresh reported an error — continuing.");
  }
  doneRefresh(
    refreshOk ? "ok" : "failed",
    "re-materialized the trunk checkout's generated agent files + skills",
  );
  if (!refreshOk) {
    convergenceHints.push(
      `Acceptance landed on ${trunk}, but the post-landing refresh failed; ` +
        `run \`discern refresh\` in ${mainRepo}.`,
    );
  }

  let landingConfig = ctx.config;
  try {
    landingConfig = await loadConfig(mainRepo);
  } catch {
    // The gate validated this same tracked config in the worktree. Falling back
    // keeps cleanup moving if a machine-local read hiccup occurs after the FF.
    ctx.log.warn(
      "Could not reload the landed config in the main checkout — using the validated worktree config for convergence.",
    );
  }

  // Attribute tracked drift only to repository convergence/smoke. A refresh can
  // legitimately rewrite generated tracked artifacts in older installs; if the
  // checkout is already dirty here, this pass cannot honestly blame a later
  // command for that pre-existing state.
  let trackedDirtyBeforeConvergence: boolean | undefined;
  try {
    trackedDirtyBeforeConvergence =
      await hasUncommittedTrackedChanges(mainRepo) ??
        undefined;
  } catch {
    trackedDirtyBeforeConvergence = undefined;
  }

  let repositoryOutcomes: StepOutcome[];
  try {
    repositoryOutcomes = await runEnsureCommands(
      ctx,
      plan.repositoryEnsureSteps,
      { fatal: false, cwd: mainRepo, scope: "repository" },
    );
  } catch {
    repositoryOutcomes = plan.repositoryEnsureSteps.map(() => "failed");
    ctx.log.warn(
      "Repository convergence reported an unexpected error — cleanup is continuing.",
    );
  }
  for (const [index, command] of plan.repositoryEnsureSteps.entries()) {
    results.push({
      step: {
        kind: "repository-ensure",
        label: command,
        disposition: "run",
        note: "converge the trunk checkout on the landed tree",
      },
      outcome: repositoryOutcomes[index] ?? "failed",
    });
  }

  try {
    const smoke = await runLandingSmoke(
      mainRepo,
      landingConfig,
      plan,
      ctx.log,
    );
    results.push(...smoke.steps);
    diagnostics.push(...smoke.diagnostics);
    convergenceHints.push(...smoke.hints);
  } catch {
    for (const smoke of plan.smokeSteps) {
      results.push({
        step: {
          kind: "job",
          label: smoke.label,
          disposition: "run",
          note: smoke.command,
          group: "Smoke",
        },
        outcome: "failed",
      });
    }
    ctx.log.warn(
      "Landing-checkout smoke could not complete — cleanup is continuing.",
    );
  }

  let checkoutClean: boolean | undefined;
  if (trackedDirtyBeforeConvergence === false) {
    try {
      checkoutClean = !(await hasUncommittedTrackedChanges(mainRepo) ?? true);
    } catch {
      checkoutClean = false;
    }
  }
  results.push({
    step: {
      kind: "checkout-clean-check",
      label: "check trunk checkout",
      disposition: "run",
      note: checkoutClean === undefined
        ? "tracked changes already existed after refresh; later drift is not attributable"
        : "report tracked files changed by post-landing convergence",
    },
    outcome: checkoutClean === undefined
      ? "skipped"
      : checkoutClean
      ? "ok"
      : "failed",
  });
  if (checkoutClean === false) {
    convergenceHints.push(
      `Acceptance landed on ${trunk}, but post-landing convergence changed ` +
        `tracked files in ${mainRepo}; review \`git status\` there.`,
    );
    ctx.log.warn(
      "Post-landing convergence changed tracked files in the trunk checkout — review git status after cleanup.",
    );
  }

  // tear down external resources (non-fatal, while still in the worktree so
  // @dir@-bearing destroys resolve, and before removal so no orphan is left)
  ctx.log.info("Tearing down the worktree's resources…");
  await teardownResources(ctx);
  done("resource-destroy", "teardown resources");

  // remove the worktree (from the main repo)
  ctx.log.info(`Removing worktree: ${worktreePath}`);
  try {
    await removeWorktreeSafely(worktreePath, mainRepo);
  } catch {
    throw new WorktreeGitError(
      `The branch landed, but removing the worktree at ${worktreePath} failed. ` +
        `Your commits remain on ${worktreeBranch}. Run \`git worktree list\` to ` +
        `inspect its state, then run \`discern worktree prune\` from the main checkout.`,
    );
  }
  ctx.log.ok("Worktree directory removed.");
  done("git", "remove-worktree");

  // Delete the now-merged branch.
  const del = await run(["branch", "-d", worktreeBranch], mainRepo);
  if (!del.success) {
    throw new WorktreeGitError(
      `The branch landed on the trunk (${trunk}), but Git could not delete the merged ` +
        `branch ${worktreeBranch}. Review the error below, then delete it with ` +
        `\`git branch -d ${worktreeBranch}\`.\nGit said: ${del.stderr.trim()}`,
    );
  }
  ctx.log.ok(`Deleted merged branch ${worktreeBranch}.`);
  done("git", "delete-branch");

  ctx.log.heading("Acceptance complete.");
  ctx.log.line(`  You are on ${trunk} in ${mainRepo}.`);
  // The landing record: the receipt for the tree that just landed, pasteable
  // into a PR body. Printed unindented so it relays as clean markdown.
  if (receiptMarkdown !== undefined) {
    ctx.log.line("");
    for (const line of receiptMarkdown.split("\n")) {
      ctx.log.line(line);
    }
  }
  return {
    steps: results,
    gateValidation,
    receiptMarkdown,
    convergenceHints,
    diagnostics,
  };
}

/**
 * Accept this worktree's branch onto the trunk — the `discern accept`
 * command, the single PUSH target of the landing model (composition happens on
 * the pull axis: `start --from` / `update --from`). Requires the latest main
 * is present beneath this branch, fast-forwards the trunk to the branch tip,
 * refreshes and converges the receiving checkout, tears down the worktree's
 * external resources, removes the clean worktree directory, and deletes the
 * now-merged branch.
 * Refuses without the `--confirmed` attestation (ADR 0134), then dirty worktrees,
 * dirty main checkouts, and a main checkout parked on a branch other than the
 * trunk. `--dry-run` shows the plan (after the read-only preconditions pass) and
 * touches nothing — and needs no attestation, since it never lands. Throws
 * `WorktreeGitError` on any unrecoverable error (the branch keeps its commits).
 */
export async function accept(
  ctx: LifecycleContext,
  opts: AcceptOpOptions = {},
): Promise<void> {
  const result = await acceptResult(ctx, {
    dryRun: opts.dryRun ?? false,
    confirmed: opts.confirmed ?? false,
  });
  emitOrRenderWorktreeResult(ctx, result, opts.json ?? false);
}

/**
 * Perform the acceptance and return its {@link DiscernResult} — the plan (dry-run)
 * or the executed steps — without emitting or exiting. The single source the CLI's
 * `--json` ({@link accept}) and the MCP server both render. NOT pure: on an apply
 * it runs the real git mutations + resource teardown (narrating through `ctx.log`,
 * which the MCP server silences with a quiet logger). The read-only preconditions
 * (in a worktree, main updated, clean main checkout sitting on the trunk) still
 * throw `WorktreeGitError` when they refuse — the caller maps that to an error
 * envelope via {@link worktreeErrorResult}.
 */
export async function acceptResult(
  ctx: LifecycleContext,
  opts: { dryRun?: boolean; confirmed?: boolean } = {},
): Promise<DiscernResult<AcceptData>> {
  const dryRun = opts.dryRun ?? false;
  // The consent attestation gates the landing act itself (ADR 0134). Without it,
  // refuse read-only — before any git runs, so nothing mutates — and re-serve the
  // review moment, so no work lands on a consent that lives only in the agent's
  // own summary. A dry-run previews and never lands, so it needs no attestation.
  // The setup-flow landing (`setup accept`) and the desk's interactive "land"
  // both collect their consent upstream and pass the attestation in, so neither
  // double-refuses here.
  if (!dryRun && !(opts.confirmed ?? false)) {
    throw new WorktreeResultError(
      ACCEPT_AWAITING_CONSENT_MESSAGE,
      acceptAwaitingConsentResult(),
    );
  }
  const run = makeGitRunner(ctx);
  const plan = await buildAcceptPlan(ctx, run);
  if (dryRun) {
    return previewResult("accept", acceptPlanToEngine(plan));
  }
  const executed = await executeAcceptPlan(ctx, run, plan);
  const result: DiscernResult<AcceptData> = appliedResult(
    "accept",
    executed.steps,
  );
  // The branch landed in the main checkout; report it so the MCP server can re-aim its
  // working root there now the worktree it operated on is gone (ADR 0062). The plan
  // resolved `mainRepo` before the removal, so it is valid after.
  result.data = {
    root: plan.mainRepo,
    gate_validation: executed.gateValidation,
    ...(executed.receiptMarkdown !== undefined
      ? { receipt: executed.receiptMarkdown }
      : {}),
    ...(hasIgnoredFileChanges(plan.ignoredFileChanges)
      ? { ignored_file_changes: plan.ignoredFileChanges }
      : {}),
  };
  result.hints = executed.receiptMarkdown !== undefined
    ? [
      "The receipt (data.receipt) is the landing record — relay it to your owner; it pastes cleanly into a PR body.",
      ...executed.convergenceHints,
    ]
    : executed.convergenceHints;
  if (executed.diagnostics.length > 0) {
    result.diagnostics = executed.diagnostics;
  }
  return result;
}

function ignoredFileChangeDetail(
  summary: AcceptPlan["ignoredFileChanges"],
): string | undefined {
  if (!hasIgnoredFileChanges(summary)) {
    return undefined;
  }
  const more = summary.truncated
    ? `, +${summary.changed_total - summary.changed_roots.length} more`
    : "";
  return `Ignored files changed since setup: ${
    summary.changed_roots.join(", ")
  }${more}`;
}

/** If the source templates for a post-landing refresh live inside the worktree that
 * accept is about to remove, point the refresh at the matching path in the main
 * checkout after landing. This is a no-op for installed binaries and external
 * projects, whose templates are outside the accepting worktree. */
export function remapWorktreeLocalTemplatesDir(
  templatesDir: string,
  worktreePath: string,
  mainRepo: string,
): string | undefined {
  const rel = relative(worktreePath, templatesDir);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    return join(mainRepo, rel);
  }
  return undefined;
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

async function postLandingRefreshTemplatesDir(
  worktreePath: string,
  mainRepo: string,
): Promise<string | undefined> {
  let templatesDir: string;
  try {
    templatesDir = await resolveTemplatesDir();
  } catch {
    return undefined;
  }
  const remapped = remapWorktreeLocalTemplatesDir(
    templatesDir,
    worktreePath,
    mainRepo,
  );
  return remapped !== undefined && await directoryExists(remapped)
    ? remapped
    : undefined;
}

async function compileGuidelinesForLandingRefresh(
  root: string,
  logger: Logger,
  templatesDir: string | undefined,
): Promise<Awaited<ReturnType<typeof compileGuidelines>>> {
  if (templatesDir === undefined) {
    return await compileGuidelines(root, logger);
  }

  const previous = Deno.env.get("DISCERN_TEMPLATES_DIR");
  Deno.env.set("DISCERN_TEMPLATES_DIR", templatesDir);
  try {
    return await compileGuidelines(root, logger);
  } finally {
    if (previous === undefined) {
      Deno.env.delete("DISCERN_TEMPLATES_DIR");
    } else {
      Deno.env.set("DISCERN_TEMPLATES_DIR", previous);
    }
  }
}

// How much integration detail rides inline before an agent is pointed at git for
// the rest (ADR 0064). Caps protect the agent's context; the `range` anchors + the
// escape-hatch hint make the overflow a single deliberate `git` call, not a dead end.
// `overlap` — the priority signal — is capped loosely; it is already a narrow set.
const UPDATE_COMMIT_CAP = 10;
const UPDATE_FILE_CAP = 20;
const UPDATE_OVERLAP_CAP = 50;

/** Build the {@link UpdateData} `range` from the anchors, carrying `after` only
 * when it exists (an apply; a `--dry-run` preview has no merged HEAD). */
function buildRange(
  anchors: { base: string; before: string; main: string; after?: string },
): UpdateData["range"] {
  const range: UpdateData["range"] = {
    base: anchors.base,
    before: anchors.before,
    main: anchors.main,
  };
  if (anchors.after !== undefined) {
    range.after = anchors.after;
  }
  return range;
}

/**
 * Summarize what an integration brought in BENEATH the branch (ADR 0064) — the core
 * DX of the verb. From the merge's SHA anchors it computes the commits + files landed
 * (capped), the OVERLAP with the branch's own changes (the hot zone — files git merged
 * cleanly that may still conflict semantically), and the fire-scopes the incoming change
 * touches; then it builds the structured {@link UpdateData} and the agent-facing
 * hints. `predicted` distinguishes a `--dry-run` (no `after`; the file delta is the
 * three-dot `before...main` prediction) from an apply (the real `before..after` tree
 * change). Fails open: any error — or a missing load-bearing anchor — yields
 * `{ data: undefined, hints: [<plain fallback>] }` and never throws, so on an apply a
 * summary hiccup can never undo or fail the landed merge.
 */
async function summarizeIntegration(
  ctx: LifecycleContext,
  anchors: { base: string; before: string; main: string; after?: string },
  opts: { predicted: boolean; source: string },
): Promise<{ data: UpdateData | undefined; hints: string[] }> {
  const { source, predicted } = opts;
  const fallback = [
    `Updated ${source} and re-materialized the agent files — run ` +
    `\`discern done\` to verify against the merged tree.`,
  ];
  // Nothing to diff against without the two load-bearing anchors.
  if (anchors.before === "" || anchors.main === "") {
    return { data: undefined, hints: fallback };
  }
  try {
    const delta = await integrationDelta(ctx.cwd, anchors, {
      predicted,
      commitCap: UPDATE_COMMIT_CAP,
      fileCap: UPDATE_FILE_CAP,
    });

    // Overlap = the branch's own files ∩ the files that changed beneath it — the hot
    // zone a clean merge can't vet. Shared with status's behind report via overlapPaths.
    const { overlap, total: overlapTotal } = overlapPaths(
      delta.ownPaths,
      delta.theirsPaths,
      UPDATE_OVERLAP_CAP,
    );

    const data: UpdateData = {
      // A pure fast-forward iff the branch tip was already an ancestor of main
      // (base === before) — derivable in both the apply and the predicted paths.
      behind: delta.commitsTotal,
      fast_forward: anchors.base !== "" && anchors.base === anchors.before,
      commits: delta.commits,
      commits_total: delta.commitsTotal,
      commits_truncated: delta.commitsTruncated,
      files: delta.files,
      files_total: delta.filesTotal,
      files_truncated: delta.filesTruncated,
      overlap,
      overlap_total: overlapTotal,
      scopes_incoming: scopesForPaths(delta.theirsPaths, ctx.config),
      range: buildRange(anchors),
    };
    return {
      data,
      hints: updateHints(data, source, delta.ownPaths.length, predicted),
    };
  } catch {
    return { data: undefined, hints: fallback };
  }
}

/**
 * The agent-facing hints for an integration — overlap-first. The headline either
 * flags the files the branch and the incoming source BOTH changed (re-read these;
 * a clean merge can't catch a semantic conflict) or reassures that none overlap.
 * When a list was capped, a follow-up hint carries the exact `git` command —
 * anchors pre-substituted — that pulls the full set in one call (two-dot
 * `before..after` on an apply, three-dot `before...<source>` on a preview), so an
 * overflow is never a dead end.
 */
function updateHints(
  data: UpdateData,
  source: string,
  ownTotal: number,
  predicted: boolean,
): string[] {
  const verb = predicted ? "Would update" : "Updated";
  const next = predicted
    ? "run `discern update` to apply, then `discern done`."
    : "run `discern done` to verify against the merged tree.";
  const hints: string[] = [];

  if (data.overlap.length > 0) {
    const shown = data.overlap.slice(0, 5).join(", ");
    const more = data.overlap_total > 5
      ? `, … (+${data.overlap_total - 5} more)`
      : "";
    const caveat = predicted
      ? "git would merge these cleanly, but they may still conflict semantically — " +
        "re-read them after updating, then "
      : "git merged these cleanly, but re-read them for semantic conflicts a clean " +
        "merge can't catch, then ";
    hints.push(
      `⚠ ${verb} ${source}: +${data.behind} commit(s) beneath your work. ` +
        `${data.overlap_total} file(s) you've changed are also changed by ` +
        `${source}: ${shown}${more} — ${caveat}${next}`,
    );
  } else {
    hints.push(
      `${verb} ${source}: +${data.behind} commit(s), ${data.files_total} ` +
        `file(s) changed beneath your work. None overlap the ${ownTotal} file(s) ` +
        `you've changed — ${next}`,
    );
  }

  const { before, main, after } = data.range;
  const diffRange = after === undefined
    ? `${before}...${main}`
    : `${before}..${after}`;
  if (data.files_truncated) {
    hints.push(
      `Showing ${data.files.length} of ${data.files_total} changed files. Full ` +
        `list: \`git diff --stat ${diffRange}\`. Inspect one: ` +
        `\`git diff ${diffRange} -- <path>\`.`,
    );
  }
  if (data.commits_truncated) {
    hints.push(
      `Showing ${data.commits.length} of ${data.commits_total} commits. Full ` +
        `log: \`git log --oneline ${before}..${main}\`.`,
    );
  }
  return hints;
}

/**
 * Narrate an integration's summary for a human (apply or `--dry-run`), through
 * `ctx.log` — silenced behind the MCP server's quiet logger, printed on the CLI. The
 * human echo of the {@link UpdateData} the `--json`/tool result carries: the
 * commits + files landed, then the overlap hot zone (or the all-clear).
 */
function narrateIntegration(
  ctx: LifecycleContext,
  data: UpdateData,
  predicted: boolean,
): void {
  ctx.log.info(
    `${
      predicted ? "Would bring in" : "Brought in"
    } ${data.behind} commit(s), ` +
      `${data.files_total} file(s) changed beneath your work.`,
  );
  for (const c of data.commits) {
    ctx.log.detail(`  ${c.sha}  ${c.subject}`);
  }
  if (data.commits_truncated) {
    ctx.log.detail(`  … (+${data.commits_total - data.commits.length} more)`);
  }
  if (data.overlap.length > 0) {
    ctx.log.warn(
      `${data.overlap_total} file(s) you've changed were also changed — re-check ` +
        `for semantic conflicts:`,
    );
    for (const p of data.overlap) {
      ctx.log.detail(`  ${p}`);
    }
    if (data.overlap_total > data.overlap.length) {
      ctx.log.detail(`  … (+${data.overlap_total - data.overlap.length} more)`);
    }
  } else {
    ctx.log.ok("None of the files you've changed were touched by the merge.");
  }
}

/**
 * The read-only diagnosis an integration acts on — the worktree precondition plus
 * how far behind the source the branch is. Asserts it is run from inside a linked
 * worktree (throwing the same `WorktreeGitError` accept does, so a plan only
 * exists for an integration that may proceed) and resolves the branch name + gap
 * read-only, so building a plan — and `--dry-run` — never mutates. The source is
 * the trunk by default; `from` pulls any ref instead (resolved through the same
 * {@link resolveCommitRef} as `start --from`, refusing an unknown or ambiguous
 * name in plain language).
 */
async function buildUpdatePlan(
  ctx: LifecycleContext,
  from?: string,
): Promise<UpdatePlan> {
  await assertInWorktree("discern update", ctx.cwd);
  const run = makeGitRunner(ctx);
  const current = (await run(["branch", "--show-current"])).stdout.trim();
  const worktreeBranch = current !== "" ? current : "(detached)";
  const repositoryEnsureSteps = ctx.config.repository.ensure;
  const worktreeEnsureSteps = ctx.config.worktree.setup.ensure;

  if (from !== undefined && from.trim() !== "") {
    const source = from.trim();
    await resolveCommitRef(ctx.cwd, source); // refuses unknown/ambiguous
    const state = await refMergedState(ctx.cwd, source);
    return {
      source,
      fromOverride: true,
      worktreeBranch,
      behind: state.behind,
      alreadyUpdated: state.already,
      repositoryEnsureSteps,
      worktreeEnsureSteps,
    };
  }

  const merged = await assertMainMerged(
    ctx.cwd,
    ctx.config.repository.trunk,
  );
  return {
    source: integrationBranch(ctx.config.repository.trunk),
    fromOverride: false,
    worktreeBranch,
    behind: merged.kind === "behind" ? Number(merged.behind) || 0 : 0,
    alreadyUpdated: merged.kind !== "behind",
    repositoryEnsureSteps,
    worktreeEnsureSteps,
  };
}

/** The refusal shown when updating `source` conflicts — names the conflicted
 * files (the merge is already aborted, the tree is clean) and the recovery that
 * CONVERGES: resolve the merge by hand, then re-run `discern update` — the
 * no-op re-run restores the agent-file refresh and the `[worktree.setup].ensure`
 * convergence the aborted merge skipped. */
function updateConflictMessage(
  plan: UpdatePlan,
  files: string[],
  aborted: boolean,
): string {
  const where = files.length > 0 ? ` in: ${files.join(", ")}` : "";
  const rerun = plan.fromOverride
    ? `discern update --from ${plan.source}`
    : "discern update";
  if (!aborted) {
    return `Updating ${plan.source} conflicts${where} — and stepping aside ` +
      `failed too, so the merge is still in progress in your tree. Either ` +
      `resolve the conflicts and commit the merge, or run ` +
      `\`git merge --abort\` to discard it; then re-run \`${rerun}\`.`;
  }
  return `Updating ${plan.source} conflicts${where}. The merge was aborted — ` +
    `your tree is untouched. Merge it yourself (\`git merge ${plan.source}\`), ` +
    `resolve the conflicts, commit the result, then re-run \`${rerun}\` — the ` +
    `no-op re-run re-materializes the agent files and re-runs the setup ` +
    `convergence the aborted merge skipped.`;
}

/**
 * Re-materialize the generated agent files + skills, then re-run the convergent
 * `[worktree.setup].ensure` commands — the convergence tail every integration pass
 * shares, merge or no-op. Non-fatal throughout: a refresh or convergence hiccup is
 * recorded as a failed step, never undoing a landed merge or failing the pass (the
 * gate is the backstop). Returns the step results plus any refresh hints.
 */
async function runUpdateConvergence(
  ctx: LifecycleContext,
  plan: UpdatePlan,
): Promise<{ steps: StepResult[]; refreshHints: string[] }> {
  ctx.log.info("Re-materializing agent files + skills…");
  let refreshOk = true;
  let refreshHints: string[] = [];
  try {
    const refreshed = await compileGuidelines(ctx.root, ctx.log);
    refreshOk = guidanceRefreshSucceeded(refreshed);
    refreshHints = refreshed.hints;
  } catch {
    refreshOk = false;
    ctx.log.warn("Agent-file refresh reported an error — continuing.");
  }
  const steps: StepResult[] = [{
    step: {
      kind: "refresh",
      label: "refresh agent files",
      disposition: "run",
      note: "re-materialized the generated agent files + skills",
    },
    outcome: refreshOk ? "ok" : "failed",
  }];
  const repositoryEnsureOutcomes = await runRepositoryEnsureSteps(ctx, {
    fatal: false,
  });
  for (const [index, step] of plan.repositoryEnsureSteps.entries()) {
    steps.push({
      step: {
        kind: "repository-ensure",
        label: step,
        disposition: "run",
        note: "converge the checkout on the current tree",
      },
      outcome: repositoryEnsureOutcomes[index] ?? "failed",
    });
  }
  const worktreeEnsureOutcomes = await runWorktreeEnsureSteps(ctx, {
    fatal: false,
  });
  for (const [index, step] of plan.worktreeEnsureSteps.entries()) {
    steps.push({
      step: {
        kind: "setup-ensure",
        label: step,
        disposition: "run",
        note: "converge the worktree on the current tree",
      },
      outcome: worktreeEnsureOutcomes[index] ?? "failed",
    });
  }
  return { steps, refreshHints };
}

/**
 * Apply an integration: merge the source (the trunk, or the `--from` ref) in,
 * re-materialize the agent files + skills, then run checkout-shared
 * `[repository].ensure` and linked-worktree `[worktree.setup].ensure` on the
 * merged tree. When the branch already contains the source nothing is merged, but
 * the refresh + ensure convergence STILL runs (like session start) — that is what
 * makes "re-run `discern update`" the recovery after a manually resolved
 * conflict, restoring everything the aborted merge skipped. A dirty tree or a
 * merge conflict throws `WorktreeGitError` (the conflict steps aside via
 * `git merge --abort` first, so the tree is left clean). The post-merge `ensure`
 * is non-fatal: a convergence hiccup is recorded as a failed step, never undoing
 * the landed merge. Narrates through `ctx.log`; returns the per-step results for
 * `--json`.
 */
async function executeUpdatePlan(
  ctx: LifecycleContext,
  plan: UpdatePlan,
): Promise<DiscernResult<UpdateData>> {
  const { source } = plan;
  const outcome = await updateMain(
    ctx.cwd,
    ctx.config.repository.trunk,
    plan.fromOverride ? { from: source } : {},
  );
  switch (outcome.kind) {
    case "skipped":
    case "already": {
      ctx.log.ok(
        `Already up to date with ${source} — nothing to merge; converging the worktree.`,
      );
      const steps: StepResult[] = [
        {
          step: {
            kind: "git",
            label: "merge",
            disposition: "skip",
            note: `already up to date with ${source}`,
          },
          outcome: "skipped",
        },
      ];
      const convergence = await runUpdateConvergence(ctx, plan);
      steps.push(...convergence.steps);
      const result: DiscernResult<UpdateData> = appliedResult(
        "update",
        steps,
      );
      result.hints = convergence.refreshHints;
      return result;
    }
    case "dirty":
      throw new WorktreeGitError(
        "This worktree has uncommitted tracked changes, and update merges only into a " +
          "clean tree. Commit or stash them, then re-run `discern update`.",
      );
    case "conflict":
      throw new WorktreeGitError(
        updateConflictMessage(plan, outcome.files, outcome.aborted),
      );
    case "merge_failed":
      // Git refused before any merge began — unrelated histories, an untracked
      // file in the way. The tree is untouched; the cause is git's to name.
      throw new WorktreeGitError(
        `Updating ${plan.source} failed before any merge began — your ` +
          `tree is untouched. Git refused:\n    ${outcome.reason}\n` +
          `Fix the cause git names, then re-run \`${
            plan.fromOverride
              ? `discern update --from ${plan.source}`
              : "discern update"
          }\`.`,
      );
    case "updated": {
      ctx.log.heading(`Updating ${source}…`);
      ctx.log.ok(
        outcome.fastForward
          ? `Fast-forwarded to ${source} (+${outcome.behind} commit(s)).`
          : `Merged ${source} (was behind by ${outcome.behind} commit(s)).`,
      );
      // Summarize what landed beneath the branch (ADR 0064) — commits, files, the
      // overlap hot zone, scopes — for the result `data` + hints, narrated here for
      // humans. Fail-open, so it can never undo or fail the merge that just landed.
      const summary = await summarizeIntegration(ctx, outcome, {
        predicted: false,
        source,
      });
      if (summary.data !== undefined) {
        narrateIntegration(ctx, summary.data, false);
      }
      const steps: StepResult[] = [{
        step: {
          kind: "git",
          label: "merge",
          disposition: "run",
          note: outcome.fastForward
            ? `fast-forwarded ${source}`
            : `merged ${source}`,
        },
        outcome: "ok",
      }];
      // Re-materialize + converge — the shared tail; a merge can bring in another
      // line of work's guidance/skill edits or a changed lockfile.
      const convergence = await runUpdateConvergence(ctx, plan);
      steps.push(...convergence.steps);
      ctx.log.ok("Update complete.");
      const result: DiscernResult<UpdateData> = appliedResult(
        "update",
        steps,
      );
      result.data = summary.data;
      result.hints = [...summary.hints, ...convergence.refreshHints];
      return result;
    }
  }
}

/**
 * Bring an integration source into this worktree's branch and re-materialize the
 * agent files + skills — the `discern update` command, the deterministic
 * inverse of `accept` and the action that resolves `done`'s fail-fast merge
 * check. The source is the trunk by default; `--from <ref>` pulls any ref instead
 * (the landing model's pull axis — how work composes below the trunk). Runs from
 * inside a linked worktree only; merges into a clean tree only. When the branch
 * already contains the source nothing merges, but the refresh + ensure
 * convergence still runs; on a conflict it aborts the merge and refuses, leaving
 * a clean tree. `--dry-run` shows the plan (after the worktree precondition
 * passes) and touches nothing. Throws `WorktreeGitError` on a refusal (the caller
 * maps it to an error envelope).
 */
export async function update(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions & { from?: string } = {},
): Promise<void> {
  const result = await updateResult(ctx, {
    dryRun: opts.dryRun ?? false,
    ...(opts.from !== undefined ? { from: opts.from } : {}),
  });
  emitOrRenderWorktreeResult(ctx, result, opts.json ?? false, {
    afterPlan: (r) => {
      if (r.data !== undefined) {
        narrateIntegration(ctx, r.data, true);
      }
    },
  });
}

/**
 * Perform the integration and return its {@link DiscernResult} — the plan (dry-run)
 * or the executed steps — without emitting or exiting. The single source the CLI's
 * `--json` ({@link update}) and the MCP server both render. NOT pure on an apply:
 * it runs the real `git merge` + re-materialize (narrating through `ctx.log`, which
 * the MCP server silences with a quiet logger). The worktree precondition throws
 * `WorktreeGitError`, as does a refusal on a dirty tree, a conflict, or an
 * unknown/ambiguous `from` ref — the caller maps that to an error envelope via
 * {@link worktreeErrorResult}.
 */
export async function updateResult(
  ctx: LifecycleContext,
  opts: { dryRun?: boolean; from?: string } = {},
): Promise<DiscernResult<UpdateData>> {
  const plan = await buildUpdatePlan(ctx, opts.from);
  if (opts.dryRun ?? false) {
    const preview: DiscernResult<UpdateData> = previewResult(
      "update",
      updatePlanToEngine(plan),
    );
    // Predict what the merge WOULD bring in (ADR 0064) — the same summary as an
    // apply, computed read-only from the fork point (no `after`; the file delta is
    // the three-dot `before...<source>`). Skipped on a no-op (nothing to update).
    if (!plan.alreadyUpdated) {
      const anchors = await resolveIntegrationAnchors(ctx.cwd, plan.source);
      const summary = await summarizeIntegration(ctx, anchors, {
        predicted: true,
        source: plan.source,
      });
      preview.data = summary.data;
      preview.hints = summary.hints;
    }
    return preview;
  }
  return await executeUpdatePlan(ctx, plan);
}

// ── start (create a fresh worktree to inhabit, from the main checkout) ──────────

/** Whether a path exists on disk (any type) — the collision check `discern start`
 * uses so a minted id never lands on an existing directory. */
async function pathPresent(p: string): Promise<boolean> {
  try {
    await Deno.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * The deterministic dev-server ports currently claimed by LIVE worktrees — each
 * derived from the worktree's own resolved id, so no registry or env file is
 * needed. Used at mint time to re-roll an id whose port would collide with a
 * live sibling's (two worktrees hashing to the same port would otherwise fight
 * over it, unexplained). Empty when `[worktree].port` is off. Fails open per row.
 */
export async function livePortsInUse(
  ctx: LifecycleContext,
  settings: IdentitySettings,
): Promise<Set<number>> {
  const ports = new Set<number>();
  if (!ctx.config.worktree.port) {
    return ports;
  }
  const fleet = await listWorktreeFleet(
    ctx.cwd,
    ctx.config.repository.trunk,
  );
  for (const row of fleet) {
    if (row.isMain) {
      continue;
    }
    const id = await resolveWorktreeId(settings, row.path).catch(() =>
      undefined
    );
    if (id !== undefined) {
      ports.add(deriveIdentity(id, settings).port);
    }
  }
  return ports;
}

/**
 * Mint a fresh worktree id whose `<branch_prefix><id>` branch AND `<root>/<id>`
 * directory are both free — so `discern start` always *creates* a new worktree
 * and never adopts an existing one — and whose derived PORT doesn't collide with
 * a live worktree's (`opts.usedPorts`). The random hex tail in
 * {@link generateWorktreeId} makes an id collision astronomically unlikely and a
 * port collision merely unlikely (a 2000-wide band), so both are verified and
 * re-rolled a bounded number of times. Port uniqueness is BEST-EFFORT: when the
 * attempts exhaust (a band that crowded means dozens of live worktrees), a
 * colliding port is accepted rather than failing the start. `opts.generate` is a
 * test seam — the id generator, defaulting to the real {@link generateWorktreeId}.
 * Exported for the port-collision class-guard test.
 */
export async function mintFreeWorktree(
  ctx: LifecycleContext,
  settings: IdentitySettings,
  worktreeRoot: string,
  name?: string,
  opts: {
    usedPorts?: Set<number>;
    generate?: (name?: string) => ReturnType<typeof generateWorktreeId>;
  } = {},
): Promise<{ id: string; branch: string; dir: string; note?: string }> {
  const run = makeGitRunner(ctx);
  const usedPorts = opts.usedPorts ?? new Set<number>();
  const generate = opts.generate ?? generateWorktreeId;
  // Two passes: the first insists on a free port; the second (fallback) accepts a
  // port collision so a crowded band can never make `start` fail outright.
  for (const requireFreePort of [true, false]) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const minted = generate(name);
      const identity = deriveIdentity(minted.id, settings);
      const dir = join(worktreeRoot, minted.id);
      if (requireFreePort && usedPorts.has(identity.port)) {
        continue;
      }
      const branchTaken = (await run(
        ["show-ref", "--verify", "--quiet", `refs/heads/${identity.branch}`],
      )).success;
      if (!branchTaken && !(await pathPresent(dir))) {
        // The note (if any) is deterministic from the name, so returning the winning
        // attempt's carries the same transparency the caller surfaces upward.
        return minted.note !== undefined
          ? { id: minted.id, branch: identity.branch, dir, note: minted.note }
          : { id: minted.id, branch: identity.branch, dir };
      }
    }
  }
  throw new WorktreeGitError(
    "discern start could not find an unused worktree name after many attempts. " +
      "Choose a more specific `--name`, inspect existing worktrees with `discern " +
      "status`, then re-run.",
  );
}

/**
 * Resolve the ref a `discern start` forks from — the pull-side entry point of the
 * landing model. `from` (when given) may be any branch, tag, or commit, verified
 * through the shared {@link resolveCommitRef}; absent, the TRUNK is used
 * explicitly — never the main checkout's HEAD, so a main checkout parked on some
 * other branch can't poison a new worktree with that branch's commits. Refuses an
 * unborn repo ("make your first commit first") and a missing trunk in plain
 * language.
 */
async function resolveStartPoint(
  ctx: LifecycleContext,
  from: string | undefined,
): Promise<string> {
  if (from !== undefined && from.trim() !== "") {
    const ref = from.trim();
    await resolveCommitRef(ctx.root, ref); // refuses unknown/ambiguous
    return ref;
  }
  // The trunk is all a default start needs — the main checkout's HEAD may be
  // parked anywhere, detached, or even unborn (an orphan branch): the worktree
  // forks from the trunk ref, never from HEAD.
  const trunk = integrationBranch(ctx.config.repository.trunk);
  if (await localBranchExists(ctx.root, trunk)) {
    return trunk;
  }
  if (!(await hasAnyCommit(ctx.root))) {
    throw new WorktreeGitError(
      "This repository has no commits yet, so there is nothing to branch a " +
        "worktree from — make your first commit first, then re-run `discern start`.",
    );
  }
  throw new WorktreeGitError(
    `New worktrees branch from the trunk, but the local branch '${trunk}' ` +
      `doesn't exist. Set [repository].trunk to the branch this project ` +
      `uses, or pass \`--from <ref>\` to branch from a specific ref, then re-run.`,
  );
}

/**
 * Refuse a `discern start` when the project root is not the git repository's
 * top level — a `discern.toml` in a subdirectory would place the new worktree (a
 * FULL-repo checkout) nested inside the repo, the exact anti-pattern the config
 * template warns against, and its `discern.toml` would not be where the setup
 * expects. Named paths, plain language; `doctor` carries the matching check.
 */
async function assertProjectRootIsRepoToplevel(
  ctx: LifecycleContext,
): Promise<void> {
  const toplevel = await repoToplevel(ctx.root);
  if (toplevel === undefined) {
    throw new WorktreeGitError(
      "discern start needs a Git repository, but this project is outside one. Run " +
        "`git init` and make a first commit, then re-run.",
    );
  }
  const root = await Deno.realPath(ctx.root).catch(() => ctx.root);
  if (root !== toplevel) {
    throw new WorktreeGitError(
      `discern.toml lives at ${root}, but the git repository's root is ` +
        `${toplevel}. Worktrees are whole-repository checkouts, so discern must ` +
        `be installed at the repository root — move discern.toml (and its ` +
        `authored files) to ${toplevel}, or make ${root} its own repository, then ` +
        `re-run \`discern start\`.`,
    );
  }
}

/**
 * Perform `discern start` and return its {@link DiscernResult} — the plan (dry-run)
 * or the created worktree — without emitting or exiting. The single source the CLI's
 * `--json` ({@link start}) and the MCP server both render. Runs from the MAIN
 * checkout only ({@link assertNotInWorktree}); an agent already inside a worktree
 * must not spin up a pointless sibling, so it refuses there (mapped to
 * `precondition_failed` by {@link worktreeErrorResult}). It MINTS a fresh, unique id
 * (collision-checked against existing branches/dirs), creates the linked worktree at
 * `<worktreeRoot>/<id>` on `<branch_prefix><id>` — branched from the TRUNK (or
 * `opts.from`, any ref: the landing model composes freely on the pull axis), never
 * from whatever branch the main checkout happens to be parked on — and runs its
 * first-time setup via the shared {@link createAndSetupWorktree} (which discards
 * the partial worktree on any failure). `worktreeRoot` is supplied by the caller
 * (the dispatcher / MCP server resolve it via `resolveWorktreeRoot`), keeping this
 * engine core free of the placement convention. The result carries the new worktree's
 * `data.path` and a hint to re-root: nothing relocates the caller's session for it.
 */
export async function startResult(
  ctx: LifecycleContext,
  opts: {
    dryRun?: boolean;
    worktreeRoot: string;
    name?: string;
    from?: string;
  },
): Promise<DiscernResult<StartData>> {
  await assertNotInWorktree("discern start", ctx.cwd);
  await assertProjectRootIsRepoToplevel(ctx);
  const startPoint = await resolveStartPoint(ctx, opts.from);

  const settings = await loadIdentitySettings(ctx.root);
  const { id, branch, dir, note } = await mintFreeWorktree(
    ctx,
    settings,
    opts.worktreeRoot,
    opts.name,
    { usedPorts: await livePortsInUse(ctx, settings) },
  );

  if (opts.dryRun ?? false) {
    return previewResult(
      "start",
      startPlanToEngine(
        note !== undefined
          ? { id, branch, worktreePath: dir, from: startPoint, note }
          : { id, branch, worktreePath: dir, from: startPoint },
      ),
    );
  }

  // Advisory, not a gate: uncommitted work in the main checkout never follows a
  // new worktree (it branches from a committed ref), so say where it stays.
  const mainChanges = parsePorcelainZ(
    (await makeGitRunner(ctx)(
      ["status", "--porcelain", "-z", "--untracked-files=normal"],
      ctx.root,
    )).stdout,
  ).length;
  const dirtyNote = mainChanges > 0
    ? `${mainChanges} uncommitted change${
      mainChanges === 1 ? "" : "s"
    } stay in the main checkout — the new worktree branches from '${startPoint}'.`
    : undefined;
  if (dirtyNote !== undefined) {
    ctx.log.info(dirtyNote);
  }

  ctx.log.heading(`Starting a new worktree (${id})…`);
  await createAndSetupWorktree(ctx.root, dir, branch, ctx.log, startPoint);
  ctx.log.ok(`Worktree '${id}' is ready at ${dir} (from ${startPoint}).`);

  const data: StartData = {
    id,
    branch,
    path: dir,
    from: startPoint,
    ...(note !== undefined ? { name_note: note } : {}),
  };
  const result: DiscernResult<StartData> = appliedResult("start", [
    {
      step: {
        kind: "git",
        label: "add-worktree",
        disposition: "run",
        note: `${dir} on ${branch} (from ${startPoint})`,
      },
      outcome: "ok",
    },
    {
      step: {
        kind: "setup-step",
        label: "setup",
        disposition: "run",
        note: "readied the new worktree",
      },
      outcome: "ok",
    },
  ]);
  result.data = data;
  const reRoot =
    `Created worktree '${id}' at ${dir} (branch ${branch}). Nothing was relocated ` +
    `for you — start a session rooted at ${dir} (or cd there) to continue, and do ` +
    `not keep working in the main checkout.`;
  // A normalisation/fallback note leads the hints, so the caller — and the human
  // reading over its shoulder — see what the worktree was actually named.
  result.hints = [
    ...(note !== undefined ? [note] : []),
    reRoot,
    ...(dirtyNote !== undefined ? [dirtyNote] : []),
  ];
  return result;
}

/**
 * Create a fresh isolated worktree from the main checkout and re-root into it — the
 * `discern start` command, the first-class way an agent on the trunk gets its own
 * workspace instead of squatting in another line of work's worktree. Mints a unique
 * id, creates the worktree on its own `<branch_prefix><id>` branch — forked from the
 * trunk, or `--from <ref>` — at the configured sibling location, sets it up, and
 * prints the new path plus how to enter it. `--dry-run` shows the plan (after the
 * preconditions pass) and touches nothing. Throws `WorktreeGitError` when run from
 * inside a worktree, from an unborn repo, or from a project root that is not the
 * repository root (the caller maps it to an error envelope).
 */
export async function start(
  ctx: LifecycleContext,
  opts: {
    dryRun?: boolean;
    json?: boolean;
    worktreeRoot: string;
    name?: string;
    from?: string;
  },
): Promise<void> {
  const result = await startResult(ctx, {
    dryRun: opts.dryRun ?? false,
    worktreeRoot: opts.worktreeRoot,
    name: opts.name ?? "",
    ...(opts.from !== undefined ? { from: opts.from } : {}),
  });
  emitOrRenderWorktreeResult(ctx, result, opts.json ?? false, {
    afterApply: (r) => {
      // Human apply: the new worktree's path is the deliverable — say how to enter it.
      const data = r.data;
      if (data !== undefined) {
        ctx.log.info(`cd into it to continue: cd ${data.path}`);
      }
    },
  });
}

/**
 * The outcome of a worktree-viability probe (ADR 0090) — one throwaway worktree
 * created, exercised, and destroyed to prove the project actually functions where
 * every future task lives.
 */
export type WorktreeProbeOutcome =
  /** The probe could not be created — an unborn branch (no commit yet), not the main
   * checkout, or a git failure. Not the app's fault, so the caller reports the project
   * un-proven-in-a-worktree but does NOT block on it. */
  | { kind: "uncreatable"; reason: string }
  /** The worktree was created but readying it (resources, one-shot `steps`, the
   * fresh-creation `ensure`) FAILED — the project cannot set itself up in a copy. A
   * genuine red the caller blocks on. */
  | { kind: "setup_failed"; reason: string }
  /** The probe ran inside the readied worktree; `ok` is the caller's verdict, `detail`
   * its note. */
  | { kind: "probed"; ok: boolean; detail?: string };

/**
 * Prove the project is viable inside a linked worktree — the copy every future task
 * runs in — by creating a THROWAWAY one exactly as `discern start` would, running a
 * caller-supplied `probe` inside it, and tearing it down unconditionally (win or
 * lose). The worktree branches from the main checkout's CURRENT HEAD, never from
 * `main`: a project still on its unlanded `discern-setup` branch is probed with its
 * own just-authored config, not a repo without discern at all (ADR 0090). It reuses
 * the same create (`addWorktree` + `worktreeSetup`) and removal (`removeWorktreeSafely`)
 * cores the rest of the lifecycle uses, so the probe exercises precisely what a real
 * worktree does — its `[worktree.setup]` steps/ensure, its resources, its env
 * inheritance — the anchoring an env-anchored app silently breaks. Gate-agnostic: the
 * caller decides what "viable" means via `probe` (setup passes it the finish core).
 * Runs from the main checkout; never throws — a teardown hiccup is swallowed (a later
 * `worktree prune` reclaims the remains).
 */
export async function probeWorktreeViability(
  ctx: LifecycleContext,
  worktreeRoot: string,
  probe: (probeDir: string) => Promise<{ ok: boolean; detail?: string }>,
): Promise<WorktreeProbeOutcome> {
  const asMsg = (e: unknown): string =>
    e instanceof Error ? e.message : String(e);

  // The probe branches from the main checkout's HEAD; anywhere else is a skip, not a
  // red (nothing to fault the app for).
  try {
    await assertNotInWorktree("worktree probe", ctx.cwd);
  } catch (e) {
    return { kind: "uncreatable", reason: asMsg(e) };
  }

  const settings = await loadIdentitySettings(ctx.root);
  let branch: string;
  let dir: string;
  try {
    const minted = await mintFreeWorktree(ctx, settings, worktreeRoot);
    branch = minted.branch;
    dir = minted.dir;
    // `git worktree add` from HEAD — fails on an unborn branch (no commit yet), which
    // is a legitimate skip, not the app failing.
    await addWorktree(ctx.root, dir, branch);
  } catch (e) {
    return { kind: "uncreatable", reason: asMsg(e) };
  }

  try {
    // Ready the worktree exactly as a real one: resources, env inheritance, one-shot
    // `steps`, fresh-creation `ensure`, agent-file refresh, sentinel. A throw here is
    // the app failing to set itself up in a copy — the core failure the probe catches.
    try {
      await worktreeSetup(await lifecycleContext(dir, ctx.log, dir));
    } catch (e) {
      return { kind: "setup_failed", reason: asMsg(e) };
    }
    const verdict = await probe(dir);
    return verdict.detail !== undefined
      ? { kind: "probed", ok: verdict.ok, detail: verdict.detail }
      : { kind: "probed", ok: verdict.ok };
  } finally {
    // A probe teardown must never fail the caller (`setup done`) — the discard is
    // best-effort throughout and `worktree prune` is the backstop. The branch is
    // the probe's own freshly-minted throwaway (mintFreeWorktree guarantees it
    // was free), so deleting it discards nothing that predates the probe.
    await discardWorktreeBestEffort(ctx.root, dir, branch, ctx.log, {
      deleteBranch: true,
    });
  }
}

/**
 * Map a thrown worktree precondition / identity error to its {@link DiscernResult}
 * error fields, or undefined when `e` is neither. The single source of the failure
 * slugs (`precondition_failed`, `identity_error`) shared by the CLI runner
 * (`runWorktreeOp`) and the MCP server, so the two surfaces never diverge. The
 * caller rethrows when this returns undefined (a genuinely unexpected error).
 */
export function worktreeErrorResult(
  verb: string,
  e: unknown,
): DiscernResult | undefined {
  if (e instanceof WorktreeResultError) {
    return e.result;
  }
  if (e instanceof WorktreeGitError || e instanceof IdentityError) {
    return {
      ok: false,
      verb,
      error: e instanceof IdentityError
        ? "identity_error"
        : "precondition_failed",
      message: e.message,
    };
  }
  return undefined;
}

class WorktreeResultError extends WorktreeGitError {
  readonly result: DiscernResult;

  constructor(message: string, result: DiscernResult) {
    super(message);
    this.name = "WorktreeResultError";
    this.result = result;
  }
}

/** Resolve a possibly-relative git-common-dir against `cwd` and canonicalize it. */
async function realPathOrLifecycle(raw: string, cwd: string): Promise<string> {
  if (raw === "") {
    return raw;
  }
  const abs = raw.startsWith("/") ? raw : join(cwd, raw);
  try {
    return await Deno.realPath(abs);
  } catch {
    return abs;
  }
}

/** Options for {@link worktreePrune}. */
export interface WorktreePruneOptions {
  /** Proceed without prompting for the destructive prune candidate list. */
  assumeYes?: boolean;
  /** Report what would be removed/reclaimed without acting. */
  dryRun?: boolean;
  /** Emit a machine-readable (plan, results) object on stdout. */
  json?: boolean;
  /**
   * Extra directories the orphan sweep should scan beyond the git-derived
   * parents of registered worktrees — the configured worktree root, so a
   * FULLY-orphaned root (no registered worktree left to derive its parent from)
   * is still reclaimed. The engine knows no placement convention; the dispatch
   * layer resolves `[worktree].root` and passes it (ADR 0052).
   */
  extraScanDirs?: string[];
}

/**
 * The read-only prune SCAN — what `worktree prune` would remove and reclaim,
 * gathered without acting. The git-worktree and orphan-dir scans are carried in
 * the plan so apply consumes the same candidate set instead of re-reading live
 * state; resource reclaims come from the pure {@link classifyOrphans} decision
 * over the ledger. The deliverable a `--dry-run` renders and the apply path
 * reports.
 */
async function buildPrunePlan(
  ctx: LifecycleContext,
  extraScanDirs?: string[],
): Promise<PrunePlan> {
  const gitScan = await scanGitWorktreesForPrune({
    includeDetached: true,
    mainBranch: ctx.config.repository.trunk,
  });
  const orphanScan = await scanOrphanWorktreesForSweep({
    mainBranch: ctx.config.repository.trunk,
    ...(extraScanDirs !== undefined ? { extraDirs: extraScanDirs } : {}),
  });
  const resources = await planResourceReclaims(ctx);
  return {
    gitScan,
    orphanScan,
    resourceReclaims: resources.reclaimable,
    resourceReclaimsKept: resources.kept,
  };
}

/**
 * The orphaned-resource handles GC would reclaim — the read-only half of the
 * resource GC, built from the pure {@link classifyOrphans} decision over the
 * ledger and the live-worktree snapshot. No destroy, no ledger writes. A no-op
 * outside a git repo.
 */
async function planResourceReclaims(
  ctx: LifecycleContext,
): Promise<{ reclaimable: LedgerItem[]; kept: number }> {
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  if (commonGitDir === undefined) {
    return { reclaimable: [], kept: 0 };
  }
  const livePaths = await liveWorktreePaths(ctx.cwd);
  const { reclaimable, kept } = classifyOrphans(
    await listEntries(commonGitDir),
    {
      gitKeys: await liveWorktreeGitKeys(commonGitDir),
      paths: livePaths,
      identities: await liveResourceIdentitySet(ctx, livePaths),
    },
  );
  return { reclaimable, kept };
}

/**
 * Housekeeping for the worktree pool — the `worktree prune` command. Removes stale
 * worktrees and fully-merged branches, reclaims gitlinked orphan directories, then
 * reclaims orphaned per-worktree RESOURCES (the GC safety net: a resource whose
 * worktree vanished without a clean teardown). Refuses to run from inside a linked
 * worktree (pool housekeeping belongs to the main checkout). `--dry-run` renders
 * the prune plan and touches nothing. Throws on a setup or removal failure.
 */
export async function worktreePrune(
  ctx: LifecycleContext,
  opts: WorktreePruneOptions = {},
): Promise<void> {
  await assertNotInWorktree("discern worktree prune", ctx.cwd);
  const json = opts.json ?? false;
  const plan = await buildPrunePlan(ctx, opts.extraScanDirs);
  const enginePlan = prunePlanToEngine(plan);

  // Dry-run: scan read-only and render the plan; touch nothing.
  if (opts.dryRun ?? false) {
    emitDryRun(
      ctx,
      "worktree prune",
      enginePlan,
      json,
    );
    return;
  }

  if (!prunePlanIsEmpty(plan) && !(opts.assumeYes ?? false)) {
    const message =
      "Confirmation required for `discern worktree prune`; review the candidates and re-run with `--yes`.";
    if (!canPrompt(false)) {
      if (!json) {
        renderPlan(loggerSink(ctx.log), enginePlan);
      }
      throw new WorktreeResultError(message, {
        ok: false,
        verb: "worktree prune",
        error: "confirmation_required",
        message,
        plan: enginePlan,
      });
    }
    renderPlan(loggerSink(ctx.log), enginePlan);
    if (!(await confirmProceed("Remove the prune candidates above?", false))) {
      throw new WorktreeGitError(
        "Pruning was cancelled, so nothing was removed. Re-run when you are ready, " +
          "or pass `--yes` after reviewing the plan.",
      );
    }
  }

  // Apply: run the real removals, narrating exactly as before.
  ctx.log.heading("Pruning worktrees and fully-merged branches…");
  let prune = await pruneGitWorktrees(plan.gitScan, ctx.log);

  ctx.log.heading("Reclaiming orphaned worktree directories…");
  const sweep = await sweepOrphanWorktrees(plan.orphanScan, ctx.log);

  ctx.log.heading("Reclaiming orphaned worktree resources…");
  const gc = await gcWorktreeResources(
    ctx,
    plan.resourceReclaims,
    plan.resourceReclaimsKept,
  );

  if (
    plan.gitScan.staleMetadata.length > 0 && plan.orphanScan.kept.length === 0
  ) {
    ctx.log.heading("Pruning stale worktree metadata…");
    const metadata = await pruneStaleWorktreeMetadata(plan.gitScan, ctx.log);
    prune = {
      ...prune,
      staleMetadata: metadata.pruned,
      failed: prune.failed || metadata.failed,
    };
  } else if (plan.gitScan.staleMetadata.length > 0) {
    ctx.log.warn(
      "Skipped stale worktree metadata pruning because an orphaned worktree directory was kept.",
    );
  }
  if (prune.failed || sweep.failed || gc.failed) {
    throw new WorktreeGitError(
      "One or more worktree cleanups failed. Review the failed steps above, fix " +
        "their reported causes, then re-run `discern worktree prune`.",
    );
  }
  ctx.log.ok("Prune complete.");

  emitOrRenderWorktreeResult(
    ctx,
    appliedResult("worktree prune", pruneResults(prune, sweep, gc)),
    json,
  );
}

/** Map the real prune/sweep/GC outcomes to `--json` step results. */
function pruneResults(
  prune: {
    removed: string[];
    branchesDeleted: string[];
    staleMetadata: string[];
  },
  sweep: { removed: string[] },
  gc: GcResult,
): StepResult[] {
  const step = (
    kind: StepResult["step"]["kind"],
    label: string,
    note: string,
    group: string,
  ): StepResult => ({
    step: { kind, label, disposition: "run", note, group },
    outcome: "ok",
  });
  return [
    ...prune.removed.map((w) =>
      step("git", w, "removed stale worktree", "Worktrees")
    ),
    ...prune.branchesDeleted.map((b) =>
      step("git", b, "deleted fully-merged branch", "Branches")
    ),
    ...sweep.removed.map((d) =>
      step("git", d, "reclaimed orphan directory", "Orphan directories")
    ),
    ...prune.staleMetadata.map((d) =>
      step("git", d, "pruned stale metadata", "Stale metadata")
    ),
    ...gc.reclaimed.map((r) =>
      step("resource-destroy", r, "reclaimed orphaned resource", "Resources")
    ),
  ];
}

/**
 * The resource-GC pass of `worktree prune`: reclaim any ledgered resource whose
 * worktree is gone. Conservative — it only acts on the planned entries this
 * project's ledger held, and still rechecks that no live worktree owns one before
 * destroy (by key, path, or resource handle). A no-op outside a git repo.
 */
async function gcWorktreeResources(
  ctx: LifecycleContext,
  reclaimable: LedgerItem[],
  kept: number,
): Promise<GcResult> {
  const empty: GcResult = { reclaimed: [], kept: 0, failed: false };
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  if (commonGitDir === undefined) {
    return empty;
  }
  const gc = await gcPlannedOrphanResources({
    commonGitDir,
    cwd: ctx.cwd,
    reclaimable,
    kept,
    // Re-evaluate handle ownership against CURRENT disk state before each destroy:
    // a worktree created mid-loop can own this handle under a fresh git_key that
    // the snapshot — and the `gitKeyIsLive` re-check — both miss (M1).
    recheckIdentityLive: async (identity: string): Promise<boolean> => {
      const paths = await liveWorktreePaths(ctx.cwd);
      return (await liveResourceIdentitySet(ctx, paths)).has(identity);
    },
    log: ctx.log,
  });
  const n = gc.reclaimed.length;
  if (n === 0) {
    ctx.log.line("No orphaned worktree resources found.");
  } else {
    ctx.log.ok(
      `Reclaimed ${n} orphaned worktree resource${n === 1 ? "" : "s"}.`,
    );
  }
  return gc;
}

/**
 * The set of resource handles currently owned by LIVE worktrees — the recycling
 * guard, so GC never reclaims an orphan whose handle a live worktree now holds
 * (e.g. a reused container name). Empty when no resources are declared.
 */
async function liveResourceIdentitySet(
  ctx: LifecycleContext,
  livePaths: Set<string>,
): Promise<Set<string>> {
  const set = new Set<string>();
  const specs = readResourceSpecs(ctx.config);
  if (specs.length === 0) {
    return set;
  }
  let settings: IdentitySettings;
  try {
    settings = await loadIdentitySettings(ctx.root);
  } catch {
    // This handle guard is ONE of three independent GC liveness checks (git_key,
    // path, identity) — and the git_key + path guards are re-validated against disk
    // before each destroy. So returning an empty set here only narrows this third
    // line of defense; it must never become the sole guard a destroy relies on.
    return set;
  }
  for (const path of livePaths) {
    try {
      const id = await resolveWorktreeId(settings, path);
      for (const spec of specs) {
        set.add(resourceForId(settings.slug, id, spec.name));
      }
    } catch {
      // a worktree whose id can't be resolved — skip (it just isn't a guard)
    }
  }
  return set;
}

/**
 * Resolve a single identity field for the `identity` command surface. Kept
 * here so the dispatcher can map `discern identity --<field>` to one call
 * without reaching into the identity internals. Throws `IdentityError` (carrying
 * an exit code) on a resolution failure.
 */
export async function identityField(
  root: string,
  field: WorktreeField,
  target: string = Deno.cwd(),
): Promise<string> {
  const settings = await loadIdentitySettings(root);
  const id = await resolveWorktreeId(settings, target);
  const identity = deriveIdentity(id, settings);
  // No `default`: the switch is total over WorktreeField, so a field added to
  // WORKTREE_FIELDS makes this fail `deno check` ("not all code paths return") until
  // it is handled here — the compile-time tie back to the SSOT.
  switch (field) {
    case "id":
      return identity.id;
    case "site":
      return identity.site;
    case "branch":
      return identity.branch;
    case "port":
      return String(identity.port);
    case "db":
      return identity.db;
    case "worktree":
      return worktreeBase(settings.slug, identity.id);
  }
}

/**
 * Resolve a named resource's handle for `identity --resource <name>` — the
 * runtime-discovery query that equals what the resource's `create` used and what
 * `DISCERN_RESOURCE_<NAME>` carries in the worktree's `.env`.
 */
export async function identityResourceHandle(
  root: string,
  name: string,
  target: string = Deno.cwd(),
): Promise<string> {
  const settings = await loadIdentitySettings(root);
  const id = await resolveWorktreeId(settings, target);
  return resourceForId(settings.slug, id, name);
}

/**
 * List every declared resource's handle as `name=handle` lines, for
 * `identity --resources` (visibility into a worktree's resources).
 */
export async function identityResourcesList(
  root: string,
  target: string = Deno.cwd(),
): Promise<string[]> {
  const settings = await loadIdentitySettings(root);
  const id = await resolveWorktreeId(settings, target);
  const config = await loadConfig(root);
  return readResourceSpecs(config).map(
    (s) => `${s.name}=${resourceForId(settings.slug, id, s.name)}`,
  );
}

export { IdentityError, WorktreeGitError };
