/**
 * The worktree lifecycle entry points — worktree setup, ensure, graduate,
 * teardown, and prune. These compose the identity, resource, and git layers into
 * the operations the dispatcher exposes as `discern worktree setup`, `discern graduate`,
 * and the `worktree` command group.
 *
 * Per-worktree external resources ([worktree.resources.<name>].create/destroy)
 * are project-supplied command strings run via `sh -c` after `@…@` token
 * expansion (see ./resources.ts). They are created once at setup (a `required`
 * create is fatal — a broken setup must be loud), destroyed once at teardown
 * (best-effort — a hiccup must never strand a worktree; a later prune is the
 * backstop), and reclaimed by prune when a worktree vanishes without a clean
 * teardown. [worktree.setup].steps run once at creation, stopping at the first
 * failure; [worktree.setup].ensure re-runs on every pass to converge the worktree.
 */

import { isAbsolute, join, relative } from "@std/path";
import { type Logger, loggerSink } from "../../lib/log.ts";
import { canPrompt, confirmProceed } from "../../lib/prompts.ts";
import {
  type DiscernConfig,
  type GraduateTarget,
  loadConfig,
} from "../../shared/config_schema.ts";
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
import { type GitResult, runGit } from "../../shared/subprocess.ts";
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
  type GraduatePlan,
  graduatePlanToEngine,
  type IntegratePlan,
  integratePlanToEngine,
  type PrunePlan,
  prunePlanIsEmpty,
  prunePlanToEngine,
  type SetupPlan,
  setupPlanToEngine,
  type SetupStepDesc,
  startPlanToEngine,
  type TeardownPlan,
  teardownPlanToEngine,
} from "./plan.ts";
import {
  appliedResult,
  type DiscernResult,
  type EnginePlan,
  previewResult,
  renderPlan,
  renderStepResults,
  type StepResult,
} from "../../shared/result.ts";
import type {
  GateData,
  GraduateData,
  IntegrateData,
  StartData,
} from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import {
  addWorktree,
  assertInWorktree,
  assertMainMerged,
  assertNotInWorktree,
  ensureWorktreeBranch,
  hasAnyCommit,
  hasUncommittedTrackedChanges,
  inheritMainEnvVars,
  integrateMain,
  integrationBranch,
  integrationDelta,
  liveWorktreeGitKeys,
  liveWorktreePaths,
  localBranchExists,
  mainRepoPath,
  missingIntegrationBranchWarning,
  overlapPaths,
  pruneGitWorktrees,
  pruneStaleWorktreeMetadata,
  removeWorktreeSafely,
  repoToplevel,
  resolveCommitRef,
  resolveCommonGitDir,
  resolveIntegrationAnchors,
  scanGitWorktreesForPrune,
  scanOrphanWorktreesForSweep,
  sweepOrphanWorktrees,
  WorktreeGitError,
  worktreeGitKey,
} from "./git.ts";

// worktree setup recompiles the agent guidance as its final step — which also
// materializes skills into .claude/skills/ inside the freshly created worktree (a
// linked worktree does not inherit that gitignored directory from the main checkout).
import { compileGuidelines, guidanceRefreshSucceeded } from "../guidelines.ts";
import { resolveTemplatesDir } from "../../lib/paths.ts";
// graduate validates the exact tree it lands by running the full gate at the landing
// boundary (ADR 0067) — fast-pathed by a gate-pass receipt when nothing changed since
// the agent's own `finish`, so a clean-merging but gate-breaking `integrate` (or any
// tree never run through `finish`) cannot fast-forward onto the trunk unvalidated.
import { failMessage, finishResult } from "../gate/finish.ts";
import { inspectGateReceipt } from "../gate/receipt.ts";
// integrate classifies the merge's incoming files into the project's scopes for its
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
  /** Graduate only: where the branch lands. Overrides `[worktree].graduate_to`. */
  to?: GraduateTarget | undefined;
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
    case "integrate":
      return "Integration results";
    case "graduate":
      return "Graduation results";
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

/** The per-worktree setup sentinel path (`git rev-parse --git-path discern-worktree-ready`). */
async function readySentinelPath(cwd: string): Promise<string | undefined> {
  const r = await runGit(
    ["rev-parse", "--git-path", "discern-worktree-ready"],
    { cwd },
  );
  if (!r.success) {
    return undefined;
  }
  const raw = r.stdout.trim();
  if (raw === "") {
    return undefined;
  }
  // `--git-path` may print a path relative to the worktree's cwd.
  return raw.startsWith("/") ? raw : join(cwd, raw);
}

/** Whether this worktree's ready sentinel is present — the proof setup completed.
 * The one read of "is this worktree already configured?", shared by the setup and
 * the session-start ensure paths. */
async function sentinelPresent(cwd: string): Promise<boolean> {
  const marker = await readySentinelPath(cwd);
  if (marker === undefined) {
    return false;
  }
  try {
    return (await Deno.stat(marker)).isFile;
  } catch {
    return false;
  }
}

/** Record the deterministic port in this worktree's `.env`, or report it. */
async function recordPort(
  ctx: LifecycleContext,
  identity: WorktreeIdentity,
): Promise<void> {
  if (!ctx.config.worktree.port) {
    return;
  }
  const port = String(identity.port);
  const wrote = await writeEnvVar(ctx.cwd, "DISCERN_WORKTREE_PORT", port);
  ctx.log.ok(
    wrote
      ? `Worktree dev-server port: ${port} (recorded in .env).`
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
  for (const spec of readResourceSpecs(ctx.config)) {
    if (spec.create !== "" || spec.destroy !== "") {
      steps.push({
        kind: "resource-create",
        label: spec.name,
        note: resourceForId(settings.slug, id, spec.name),
      });
    }
  }
  if (ctx.config.worktree.inherit_env.length > 0) {
    steps.push({
      kind: "env",
      label: "inherit-env",
      note: ctx.config.worktree.inherit_env.join(", "),
    });
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
  failedEnsure: string[],
): StepResult[] {
  return plan.steps.map((s) => {
    const failed = (s.kind === "resource-create" &&
      failedResources.includes(s.label)) ||
      (s.kind === "setup-ensure" && failedEnsure.includes(s.label)) ||
      (s.kind === "refresh" && !refreshOk);
    return {
      step: { kind: s.kind, label: s.label, disposition: "run", note: s.note },
      outcome: failed ? "failed" : "ok",
    };
  });
}

/**
 * Run the convergent `[worktree.setup].ensure` commands in order — the steps that
 * re-run on EVERY setup pass (creation, session-start re-entry, and `discern
 * integrate`) to converge the worktree on the current tree. The direct parallel to
 * a resource's `ensure`, sharing the one setup-step shell runner with the one-shot
 * `steps`. `fatal` selects the failure contract: at a fresh creation a non-zero exit
 * is fatal (a worktree that cannot ready its environment is broken — abort loudly,
 * exactly like a `steps` failure); on a re-entry or integrate it is recorded and the
 * run continues (never undo a completed merge or break session start over a
 * convergence hiccup — the gate is the backstop). Returns the commands that failed
 * (always empty when `fatal`, since the first failure throws). A no-op when none are
 * declared.
 */
async function runEnsureSteps(
  ctx: LifecycleContext,
  opts: { fatal: boolean },
): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  for (const step of ctx.config.worktree.setup.ensure) {
    ctx.log.info(`Ensure step: ${step}`);
    const code = await runShellRouted(step, { cwd: ctx.cwd, log: ctx.log });
    if (code !== 0) {
      if (opts.fatal) {
        throw new WorktreeGitError(`Ensure step failed: ${step}`);
      }
      ctx.log.warn(`Ensure step failed (continuing): ${step}`);
      failed.push(step);
    }
  }
  return { failed };
}

/**
 * Set up a linked worktree — the `worktree setup` command. Asserts the worktree
 * precondition, ensures a named branch, provisions the per-worktree resources (a
 * `required` create is fatal), inherits env vars, records the port + resource
 * handles into `.env`, runs the one-shot `[worktree.setup].steps` then the
 * convergent `[worktree.setup].ensure` in order, refreshes the agent files, and
 * drops the ready sentinel. Throws on a fatal step. `--dry-run` shows the plan and
 * touches nothing.
 *
 * Idempotent: when the worktree is already configured (the sentinel is present),
 * the non-idempotent phases are not repeated — resources are re-readied via
 * `ensure` rather than re-created, and the one-shot `steps` are skipped. The
 * convergent `setup.ensure` runs on EVERY pass (re-install deps, rebuild) so a
 * re-fired `worktree create` hook or a re-run `discern worktree setup` re-converges the
 * worktree on the current tree.
 */
export async function worktreeSetup(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions = {},
): Promise<void> {
  // 1. must be inside a linked worktree
  try {
    await assertInWorktree("discern worktree setup", ctx.cwd);
  } catch {
    throw new WorktreeGitError(
      "discern worktree setup must be run from inside a linked git worktree, not the main checkout.",
    );
  }

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
  const configured = await sentinelPresent(ctx.cwd);

  // 3. provision the per-worktree resources. On a FIRST setup, create them
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
      "Could not resolve this worktree's git identity for resource setup.",
    );
  }

  // 4. inherit env vars from main
  await inheritMainEnvVars({
    worktreeRoot: ctx.cwd,
    vars: ctx.config.worktree.inherit_env,
    log: ctx.log,
  });

  // 5. record the deterministic port
  await recordPort(ctx, identity);

  // 6. one-shot `steps`, then convergent `ensure`. `steps` are scaffolding: they run
  // only on a FRESH worktree and are skipped once configured (a one-shot `createdb`
  // must not re-run). `ensure` converges the worktree on the current tree (install
  // deps, build) and runs on EVERY pass — after `steps` at a fresh creation, alone on
  // a re-entry. A fresh `ensure` failure is FATAL (a worktree that cannot ready its
  // environment is broken); a re-entry `ensure` failure is recorded and non-fatal.
  let ensureFailed: string[] = [];
  if (configured) {
    if (ctx.config.worktree.setup.steps.length > 0) {
      ctx.log.info("Worktree already configured — skipping setup steps.");
    }
    ensureFailed = (await runEnsureSteps(ctx, { fatal: false })).failed;
  } else {
    for (const step of ctx.config.worktree.setup.steps) {
      ctx.log.info(`Setup step: ${step}`);
      const code = await runShellRouted(step, { cwd: ctx.cwd, log: ctx.log });
      if (code !== 0) {
        throw new WorktreeGitError(`Setup step failed: ${step}`);
      }
    }
    await runEnsureSteps(ctx, { fatal: true });
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
    setupResults(plan, createdFailed, refreshOk, ensureFailed),
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
  try {
    await addWorktree(mainRepo, dir, branch, startPoint);
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
            `contains it (land your setup on the trunk first, or pass --from <ref>).`,
        );
      }
      throw e;
    }
    await worktreeSetup(ctx, { humanApplySummary: false });
  } catch (e) {
    if (!preExisting) {
      await discardWorktreeBestEffort(mainRepo, dir, branch, log);
    }
    throw e;
  }
}

/**
 * Discard a worktree unconditionally and best-effort: destroy its resources (from
 * inside it, so `@dir@` destroys resolve), remove the worktree directory and its
 * git registration, then delete its branch. Every step swallows its own failure —
 * used to clean up a failed `start`/create (no debris left for `status` to list)
 * and to retire the viability probe's throwaway worktree; `worktree prune` is the
 * backstop for anything it misses.
 */
async function discardWorktreeBestEffort(
  mainRepo: string,
  dir: string,
  branch: string,
  log: Logger,
): Promise<void> {
  try {
    await teardownResources(await lifecycleContext(dir, log, dir));
  } catch { /* best-effort */ }
  try {
    await removeWorktreeSafely(dir, mainRepo);
  } catch { /* best-effort */ }
  try {
    await runGit(["branch", "-D", branch], { cwd: mainRepo });
  } catch { /* best-effort */ }
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
 * The idempotent session-start check — the `worktree-ensure` recipe. Runs
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
  if (await sentinelPresent(ctx.cwd)) {
    // Already set up — converge the worktree: reconcile any resource that declares an
    // `ensure` (re-ready one that died out-of-band, e.g. a host reboot) and re-run the
    // `[worktree.setup].ensure` commands (re-install deps, rebuild). Both are
    // best-effort here — a convergence hiccup must never break session start. Cheap
    // and silent when neither is declared.
    const { identity, settings } = await resolveContextIdentity(ctx);
    await ensureResources(ctx, identity, settings);
    await runEnsureSteps(ctx, { fatal: false });
    return { kind: "already" };
  }
  ctx.log.warn(
    "[discern] Worktree not configured yet; running 'discern worktree setup'…",
  );
  await worktreeSetup(ctx, { humanApplySummary: false });
  return { kind: "ran" };
}

/**
 * Tear down this worktree's resources without graduating its
 * branch — the `worktree teardown` recipe, used when DISCARDING a worktree.
 * Asserts the worktree precondition; destroys every resource the worktree created.
 */
export async function worktreeTeardown(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions = {},
): Promise<void> {
  try {
    await assertInWorktree("discern worktree teardown", ctx.cwd);
  } catch {
    throw new WorktreeGitError(
      "discern worktree teardown must be run from inside a linked git worktree, not the main checkout.",
    );
  }

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

/** A bound git runner for the graduation flow (defaults to the worktree cwd). */
type GitRunner = (args: string[], cwd?: string) => Promise<GitResult>;

/** The git runner graduation uses — the shared runner bound to the worktree cwd. */
function makeGitRunner(ctx: LifecycleContext): GitRunner {
  return (args: string[], cwd: string = ctx.cwd) => runGit(args, { cwd });
}

/**
 * The read-only diagnosis a graduation acts on — the plan-build half. Asserts the
 * preconditions (in a worktree, not the main repo, branch contains main, main is
 * clean), throwing the same `WorktreeGitError`s as before so a plan only exists for
 * a graduation that may proceed. Resolves the branch name read-only for display;
 * the authoritative branch (created if the worktree is detached) is ensured by the
 * executor, so building a plan — and `--dry-run` — never mutates.
 */
async function buildGraduatePlan(
  ctx: LifecycleContext,
  run: GitRunner,
  to: GraduateTarget,
): Promise<GraduatePlan> {
  // diagnose
  if (!(await run(["rev-parse", "--is-inside-work-tree"])).success) {
    throw new WorktreeGitError("Not inside a git repository.");
  }
  const gitDir = (await run(["rev-parse", "--absolute-git-dir"])).stdout.trim();
  const commonRaw = (await run(["rev-parse", "--git-common-dir"])).stdout
    .trim();
  const gitCommonDir = await realPathOrLifecycle(commonRaw, ctx.cwd);
  if (gitDir === gitCommonDir) {
    throw new WorktreeGitError(
      "This is the main repo, not a worktree — nothing to graduate.",
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
      "Could not determine main repo path from 'git worktree list'.",
    );
  }
  if (mainRepo === worktreePath) {
    throw new WorktreeGitError(
      "Current worktree appears to be the main worktree — refusing to proceed.",
    );
  }

  // require the integration branch is integrated
  const trunkBranch = integrationBranch(ctx.config.project.main_branch);
  ctx.log.info(`Checking the branch contains the latest ${trunkBranch}…`);
  const merged = await assertMainMerged(
    ctx.cwd,
    ctx.config.project.main_branch,
  );
  if (merged.kind === "behind") {
    throw new WorktreeGitError(
      `Branch is behind ${trunkBranch}. Run \`discern integrate\` to bring ${trunkBranch} in and re-materialize, then re-run — \`discern finish\` gates on this same check.`,
    );
  }
  if (merged.kind === "missing") {
    throw new WorktreeGitError(
      `${missingIntegrationBranchWarning(merged.branch)} ` +
        "Graduation will not remove this worktree until the merge check can run.",
    );
  }
  ctx.log.ok(`Branch contains the latest ${trunkBranch}.`);

  // capture worktree state
  const worktreeDirty =
    (await run(["status", "--porcelain"])).stdout.trim() !== "";
  if (worktreeDirty) {
    throw new WorktreeGitError(
      "Worktree has uncommitted changes. Commit or stash them yourself, then re-run — graduation only lands clean branches and will not create WIP commits.",
    );
  }
  const ignoredFileChanges = await inspectIgnoredFileChanges(
    ctx.cwd,
    ctx.config.worktree.ignored_file_drift,
  );
  // Refuse to move the main checkout only for tracked changes. Untracked local
  // provider/session scratch does not participate in checkout/fast-forward and is
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
        `Commit or stash them yourself, then re-run — graduation will not move your main-repo work for you. ` +
        `Your worktree branch '${worktreeBranch}' is untouched and still holds all its commits.`,
    );
  }

  return {
    to,
    worktreeBranch,
    worktreePath,
    mainRepo,
    mainBranch,
    trunk: ctx.config.project.main_branch,
    hasResources: readResourceSpecs(ctx.config).length > 0,
    ignoredFileChanges,
  };
}

// How many of the gate's diagnostics ride inline in a graduate refusal before the agent
// is pointed at `discern finish` for the rest — a cap so a gate that failed with many
// findings can't flood graduate's refusal message.
const GRADUATE_DIAG_CAP = 10;

/**
 * The graduate refusal when the branch does NOT pass `finish` at the tree it would land
 * (ADR 0067). Leads with the gate's own failed-stage message (the same {@link failMessage}
 * SSOT `finish` prints), then a capped list of the surfaced diagnostics, then the recovery:
 * run `discern finish` to see the full output and fix it. The branch keeps all its commits
 * and the worktree is intact (this precedes every teardown/removal).
 */
function graduateGateRefusal(
  branch: string,
  gate: DiscernResult<GateData>,
): string {
  const stage = gate.data?.failed_stage ?? null;
  const headline = stage !== null ? failMessage(stage) : "The gate failed.";
  const diags = gate.diagnostics ?? [];
  const shown = diags
    .slice(0, GRADUATE_DIAG_CAP)
    .map((d) => `  • ${d.message} (reproduce: ${d.reproduce_cmd})`);
  if (diags.length > shown.length) {
    shown.push(`  … (+${diags.length - shown.length} more)`);
  }
  return `Branch '${branch}' does not pass \`discern finish\`, so it cannot land. ` +
    `${headline} Run \`discern finish\` to see the full output and fix it, then commit ` +
    `and re-run \`discern graduate\` — your branch keeps all its commits.` +
    (shown.length > 0 ? `\n\nWhat failed:\n${shown.join("\n")}` : "");
}

async function assertGraduateBranchStillCurrent(
  cwd: string,
  trunkBranch: string,
): Promise<void> {
  const merged = await assertMainMerged(cwd, trunkBranch);
  if (merged.kind === "behind") {
    throw new WorktreeGitError(
      `Branch is behind ${trunkBranch} after the gate finished. ` +
        `Run \`discern integrate\` from this worktree, then \`discern finish\` and ` +
        `\`discern graduate\` again. The worktree has not been removed.`,
    );
  }
  if (merged.kind === "missing") {
    throw new WorktreeGitError(
      `${missingIntegrationBranchWarning(merged.branch)} ` +
        "Graduation will not remove this worktree until the merge check can run.",
    );
  }
}

/**
 * Apply a graduation plan — the mutation dance. Ensures the named branch
 * (creating one if the worktree is detached), validates the exact tree against the whole
 * gate before landing (ADR 0067, fast-pathed by a gate-pass receipt), tears down the
 * resources, removes the worktree, lands the branch in main, and refreshes the
 * checkout it leaves behind. Narrates exactly as before; throws `WorktreeGitError` on any unrecoverable
 * error (the branch keeps its commits). Returns the per-step results for `--json`.
 */
async function executeGraduatePlan(
  ctx: LifecycleContext,
  run: GitRunner,
  plan: GraduatePlan,
): Promise<{
  steps: StepResult[];
  gateValidation: NonNullable<GraduateData["gate_validation"]>;
  refreshHints: string[];
}> {
  // ensure a named branch (the one mutating step the read-only diagnosis deferred)
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  const worktreeBranch = await ensureWorktreeBranch(identity.branch, ctx.cwd);
  if (worktreeBranch === "") {
    throw new WorktreeGitError(
      "Worktree is in detached HEAD state and ensure-worktree-branch could not create a named branch.",
    );
  }
  const { to, worktreePath, mainRepo, mainBranch, trunk } = plan;

  // Validation gate (ADR 0067) — the exact tree we are about to land must pass the WHOLE
  // gate, so a clean-merging but gate-breaking `integrate` (or any tree never run through
  // `finish` — e.g. a docs edit gated only by a prose linter) cannot fast-forward onto the
  // trunk LOCALLY, where CI's checks never run. This precedes every teardown/removal below,
  // so a refusal leaves the branch and worktree intact.
  //   FAST PATH: a gate-pass receipt proves the current clean HEAD already passed `finish`
  //   (the common case — nothing changed since the agent finished), so skip the re-run.
  //   SLOW PATH: run the full gate now and refuse to land on any failure. A merge `integrate`
  //   created, a new commit, or a dirty tree invalidates the receipt, landing us here.
  const receipt = await inspectGateReceipt(ctx.cwd);
  const gateValidation: NonNullable<GraduateData["gate_validation"]> =
    receipt.status === "honored"
      ? { mode: "receipt", receipt }
      : { mode: "rerun", receipt };
  if (gateValidation.mode === "receipt") {
    ctx.log.ok(
      "Branch already passed the gate at this commit — skipping the re-run.",
    );
  } else {
    ctx.log.info("Validating the branch against the full gate before landing…");
    const gate = await finishResult(ctx.cwd);
    if (!gate.ok) {
      throw new WorktreeGitError(graduateGateRefusal(worktreeBranch, gate));
    }
    ctx.log.ok("Gate passed against the tree to be landed.");
  }

  await assertGraduateBranchStillCurrent(ctx.cwd, trunk);

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

  ctx.log.heading("Graduation plan");
  ctx.log.detail(`Branch:        ${worktreeBranch}`);
  ctx.log.detail(`From worktree: ${worktreePath}`);
  ctx.log.detail(
    to === "trunk"
      ? `Into trunk:         ${mainRepo} (fast-forward ${trunk}, delete ${worktreeBranch})`
      : `Into main checkout: ${mainRepo} (on ${mainBranch})`,
  );
  const ignoredLine = ignoredFileChangeDetail(plan.ignoredFileChanges);
  if (ignoredLine !== undefined) {
    ctx.log.detail(ignoredLine);
  }
  const refreshTemplatesDir = await postLandingRefreshTemplatesDir(
    worktreePath,
    mainRepo,
  );

  // tear down external resources (non-fatal, while still in the worktree so
  // @dir@-bearing destroys resolve, and before removal so no orphan is left)
  ctx.log.info("Tearing down the worktree's resources…");
  await teardownResources(ctx);
  done("resource-destroy", "teardown resources");

  // land the branch where the plan says
  if (to === "trunk") {
    // Fast-forward the trunk to the branch tip and land there. The graduation gate
    // already proved the branch contains the trunk, so this is always a clean
    // fast-forward — never a merge commit, never a conflict.
    await assertGraduateBranchStillCurrent(ctx.cwd, trunk);
    ctx.log.info(`Checking out ${trunk} in main repo…`);
    const checkout = await run(["checkout", "--quiet", trunk], mainRepo);
    if (!checkout.success) {
      throw new WorktreeGitError(
        `git checkout ${trunk} failed in the main repo. Git said:\n    ${checkout.stderr.trim()}`,
      );
    }
    ctx.log.info(`Fast-forwarding ${trunk} to ${worktreeBranch}…`);
    const ff = await run(
      ["merge", "--ff-only", "--quiet", worktreeBranch],
      mainRepo,
    );
    if (!ff.success) {
      throw new WorktreeGitError(
        `Fast-forwarding ${trunk} to ${worktreeBranch} failed before the worktree was removed. ` +
          `Your commits are safe on ${worktreeBranch} at ${worktreePath}. ` +
          `Run \`discern integrate\` from that worktree, then \`discern finish\` and ` +
          `\`discern graduate --to trunk\` again. Git said:\n    ${ff.stderr.trim()}`,
      );
    }
    ctx.log.ok(`${trunk} fast-forwarded to ${worktreeBranch} at ${mainRepo}.`);
    done("git", "fast-forward-trunk");
  }

  // remove the worktree (from the main repo)
  ctx.log.info(`Removing worktree: ${worktreePath}`);
  try {
    await removeWorktreeSafely(worktreePath, mainRepo);
  } catch {
    throw new WorktreeGitError(
      `Worktree removal failed for ${worktreePath}. The branch ${worktreeBranch} holds your commits; run 'git worktree list' to investigate.`,
    );
  }
  ctx.log.ok("Worktree directory removed.");
  done("git", "remove-worktree");

  if (to === "trunk") {
    // Delete the now-merged branch.
    const del = await run(["branch", "-d", worktreeBranch], mainRepo);
    if (!del.success) {
      throw new WorktreeGitError(
        `git branch -d ${worktreeBranch} failed after merging it into ${trunk}. Git said:\n    ${del.stderr.trim()}`,
      );
    }
    ctx.log.ok(`Deleted merged branch ${worktreeBranch}.`);
    done("git", "delete-branch");
  } else {
    // Check out the branch in main (review-first; the branch is preserved).
    ctx.log.info(`Checking out ${worktreeBranch} in main repo…`);
    const checkout = await run(
      ["checkout", "--quiet", worktreeBranch],
      mainRepo,
    );
    if (!checkout.success) {
      throw new WorktreeGitError(
        `git checkout ${worktreeBranch} failed. The branch may still be claimed elsewhere. Git said:\n    ${checkout.stderr.trim()}`,
      );
    }
    ctx.log.ok(`On ${worktreeBranch} at ${mainRepo}.`);
    done("git", "checkout");
  }

  const landedOn = to === "trunk" ? trunk : worktreeBranch;
  // Re-materialize the checkout that graduate leaves behind. The branch has already
  // landed, so a refresh hiccup is reported as a failed step rather than undoing the
  // git transition (parallel to integrate's post-merge refresh).
  ctx.log.info(
    "Re-materializing agent files + skills in the landing checkout…",
  );
  let refreshOk = true;
  let refreshHints: string[] = [];
  try {
    const refreshed = await compileGuidelinesForLandingRefresh(
      mainRepo,
      ctx.log,
      refreshTemplatesDir,
    );
    refreshOk = guidanceRefreshSucceeded(refreshed);
    refreshHints = refreshed.hints;
  } catch {
    refreshOk = false;
    ctx.log.warn("Agent-file refresh reported an error — continuing.");
  }
  const refreshNote = to === "trunk"
    ? "re-materialized the trunk checkout's generated agent files + skills"
    : "re-materialized the review checkout's generated agent files + skills";
  doneRefresh(refreshOk ? "ok" : "failed", refreshNote);
  if (!refreshOk) {
    refreshHints = [
      ...refreshHints,
      `Graduation landed on ${landedOn}, but the post-landing refresh failed; ` +
      `run \`discern refresh\` in ${mainRepo}.`,
    ];
  }

  ctx.log.heading("Graduation complete.");
  ctx.log.line(`  You are on ${landedOn} in ${mainRepo}.`);
  return { steps: results, gateValidation, refreshHints };
}

/**
 * Graduate this worktree's branch into the main repo — the `discern graduate`
 * command. Requires the latest main is integrated, tears down the worktree's
 * external resources, removes the clean worktree directory, then lands the branch per the destination (`opts.to`, falling back
 * to `[worktree].graduate_to`): `"branch"` checks it out in main for review;
 * `"trunk"` fast-forwards the trunk to the branch tip and deletes the merged
 * branch. The checkout left behind is refreshed after landing. Refuses dirty
 * worktrees and dirty main checkouts. `--dry-run` shows the plan (after the
 * read-only preconditions pass) and touches nothing. Throws `WorktreeGitError` on
 * any unrecoverable error (the branch keeps its commits).
 */
export async function graduate(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions = {},
): Promise<void> {
  const result = await graduateResult(ctx, {
    dryRun: opts.dryRun ?? false,
    to: opts.to,
  });
  emitOrRenderWorktreeResult(ctx, result, opts.json ?? false);
}

/**
 * Perform the graduation and return its {@link DiscernResult} — the plan (dry-run)
 * or the executed steps — without emitting or exiting. The single source the CLI's
 * `--json` ({@link graduate}) and the MCP server both render. NOT pure: on an apply
 * it runs the real git mutations + resource teardown (narrating through `ctx.log`,
 * which the MCP server silences with a quiet logger). The read-only preconditions
 * (in a worktree, main integrated, clean main checkout) still throw
 * `WorktreeGitError` when they refuse — the caller maps that to an error envelope
 * via {@link worktreeErrorResult}.
 */
export async function graduateResult(
  ctx: LifecycleContext,
  opts: { dryRun?: boolean; to?: GraduateTarget | undefined } = {},
): Promise<DiscernResult<GraduateData>> {
  const run = makeGitRunner(ctx);
  const to = opts.to ?? ctx.config.worktree.graduate_to;
  const plan = await buildGraduatePlan(ctx, run, to);
  if (opts.dryRun ?? false) {
    return previewResult("graduate", graduatePlanToEngine(plan));
  }
  const executed = await executeGraduatePlan(ctx, run, plan);
  const result: DiscernResult<GraduateData> = appliedResult(
    "graduate",
    executed.steps,
  );
  // The branch landed in the main checkout; report it so the MCP server can re-aim its
  // working root there now the worktree it operated on is gone (ADR 0062). The plan
  // resolved `mainRepo` before the removal, so it is valid after.
  result.data = {
    root: plan.mainRepo,
    gate_validation: executed.gateValidation,
    ...(hasIgnoredFileChanges(plan.ignoredFileChanges)
      ? { ignored_file_changes: plan.ignoredFileChanges }
      : {}),
  };
  result.hints = executed.refreshHints;
  return result;
}

function ignoredFileChangeDetail(
  summary: GraduatePlan["ignoredFileChanges"],
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
 * graduate is about to remove, point the refresh at the matching path in the main
 * checkout after landing. This is a no-op for installed binaries and external
 * projects, whose templates are outside the graduating worktree. */
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
const INTEGRATE_COMMIT_CAP = 10;
const INTEGRATE_FILE_CAP = 20;
const INTEGRATE_OVERLAP_CAP = 50;

/** Build the {@link IntegrateData} `range` from the anchors, carrying `after` only
 * when it exists (an apply; a `--dry-run` preview has no merged HEAD). */
function buildRange(
  anchors: { base: string; before: string; main: string; after?: string },
): IntegrateData["range"] {
  const range: IntegrateData["range"] = {
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
 * touches; then it builds the structured {@link IntegrateData} and the agent-facing
 * hints. `predicted` distinguishes a `--dry-run` (no `after`; the file delta is the
 * three-dot `before...main` prediction) from an apply (the real `before..after` tree
 * change). Fails open: any error — or a missing load-bearing anchor — yields
 * `{ data: undefined, hints: [<plain fallback>] }` and never throws, so on an apply a
 * summary hiccup can never undo or fail the landed merge.
 */
async function summarizeIntegration(
  ctx: LifecycleContext,
  anchors: { base: string; before: string; main: string; after?: string },
  opts: { predicted: boolean; mainBranch: string },
): Promise<{ data: IntegrateData | undefined; hints: string[] }> {
  const { mainBranch, predicted } = opts;
  const fallback = [
    `Integrated ${mainBranch} and re-materialized the agent files — run ` +
    `\`discern finish\` to verify against the merged tree.`,
  ];
  // Nothing to diff against without the two load-bearing anchors.
  if (anchors.before === "" || anchors.main === "") {
    return { data: undefined, hints: fallback };
  }
  try {
    const delta = await integrationDelta(ctx.cwd, anchors, {
      predicted,
      commitCap: INTEGRATE_COMMIT_CAP,
      fileCap: INTEGRATE_FILE_CAP,
    });

    // Overlap = the branch's own files ∩ the files that changed beneath it — the hot
    // zone a clean merge can't vet. Shared with status's behind report via overlapPaths.
    const { overlap, total: overlapTotal } = overlapPaths(
      delta.ownPaths,
      delta.theirsPaths,
      INTEGRATE_OVERLAP_CAP,
    );

    const data: IntegrateData = {
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
      hints: integrateHints(data, mainBranch, delta.ownPaths.length, predicted),
    };
  } catch {
    return { data: undefined, hints: fallback };
  }
}

/**
 * The agent-facing hints for an integration — overlap-first. The headline either
 * flags the files the branch and main BOTH changed (re-read these; a clean merge
 * can't catch a semantic conflict) or reassures that none overlap. When a list was
 * capped, a follow-up hint carries the exact `git` command — anchors pre-substituted
 * — that pulls the full set in one call (two-dot `before..after` on an apply,
 * three-dot `before...main` on a preview), so an overflow is never a dead end.
 */
function integrateHints(
  data: IntegrateData,
  mainBranch: string,
  ownTotal: number,
  predicted: boolean,
): string[] {
  const verb = predicted ? "Would integrate" : "Integrated";
  const next = predicted
    ? "run `discern integrate` to apply, then `discern finish`."
    : "run `discern finish` to verify against the merged tree.";
  const hints: string[] = [];

  if (data.overlap.length > 0) {
    const shown = data.overlap.slice(0, 5).join(", ");
    const more = data.overlap_total > 5
      ? `, … (+${data.overlap_total - 5} more)`
      : "";
    const caveat = predicted
      ? "git would merge these cleanly, but they may still conflict semantically — " +
        "re-read them after integrating, then "
      : "git merged these cleanly, but re-read them for semantic conflicts a clean " +
        "merge can't catch, then ";
    hints.push(
      `⚠ ${verb} ${mainBranch}: +${data.behind} commit(s) beneath your work. ` +
        `${data.overlap_total} file(s) you've changed are also changed by ` +
        `${mainBranch}: ${shown}${more} — ${caveat}${next}`,
    );
  } else {
    hints.push(
      `${verb} ${mainBranch}: +${data.behind} commit(s), ${data.files_total} ` +
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
 * human echo of the {@link IntegrateData} the `--json`/tool result carries: the
 * commits + files landed, then the overlap hot zone (or the all-clear).
 */
function narrateIntegration(
  ctx: LifecycleContext,
  data: IntegrateData,
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
 * how far behind main the branch is. Asserts it is run from inside a linked
 * worktree (throwing the same `WorktreeGitError` graduate does, so a plan only
 * exists for an integration that may proceed) and resolves the branch name + main
 * gap read-only, so building a plan — and `--dry-run` — never mutates.
 */
async function buildIntegratePlan(
  ctx: LifecycleContext,
): Promise<IntegratePlan> {
  await assertInWorktree("discern integrate", ctx.cwd);
  const run = makeGitRunner(ctx);
  const current = (await run(["branch", "--show-current"])).stdout.trim();
  const merged = await assertMainMerged(
    ctx.cwd,
    ctx.config.project.main_branch,
  );
  return {
    mainBranch: integrationBranch(ctx.config.project.main_branch),
    worktreeBranch: current !== "" ? current : "(detached)",
    behind: merged.kind === "behind" ? Number(merged.behind) || 0 : 0,
    alreadyIntegrated: merged.kind !== "behind",
    ensureSteps: ctx.config.worktree.setup.ensure,
  };
}

/** The refusal shown when integrating `mainBranch` conflicts — names the conflicted
 * files (the merge is already aborted) and the manual path to resolve them. */
function integrateConflictMessage(
  mainBranch: string,
  files: string[],
): string {
  const where = files.length > 0 ? ` in: ${files.join(", ")}` : "";
  return `Integrating ${mainBranch} conflicts${where}. Resolve by merging manually ` +
    `(\`git merge ${mainBranch}\`), commit the result, then re-run \`discern finish\`.`;
}

/**
 * Apply an integration: merge the integration branch in, re-materialize the agent
 * files + skills, then re-run the convergent `[worktree.setup].ensure` to converge
 * the worktree's environment on the merged tree (the motivating case — a merge that
 * changed a lockfile leaves dependencies stale). A no-op (`already`/`skipped`) when
 * the branch already contains main — nothing merged, so nothing refreshed and no
 * convergence needed. A dirty tree or a merge conflict throws `WorktreeGitError`
 * (the conflict steps aside via `git merge --abort` first, so the tree is left
 * clean). The post-merge `ensure` is non-fatal: a convergence hiccup is recorded as
 * a failed step, never undoing the landed merge. Narrates through `ctx.log`; returns
 * the per-step results for `--json`.
 */
async function executeIntegratePlan(
  ctx: LifecycleContext,
  plan: IntegratePlan,
): Promise<DiscernResult<IntegrateData>> {
  const { mainBranch } = plan;
  const outcome = await integrateMain(ctx.cwd, ctx.config.project.main_branch);
  switch (outcome.kind) {
    case "skipped":
    case "already": {
      ctx.log.ok(
        `Already up to date with ${mainBranch} — nothing to integrate.`,
      );
      const steps: StepResult[] = [
        {
          step: {
            kind: "git",
            label: "merge",
            disposition: "skip",
            note: `already up to date with ${mainBranch}`,
          },
          outcome: "skipped",
        },
        {
          step: {
            kind: "refresh",
            label: "refresh agent files",
            disposition: "skip",
            note: "nothing merged — no refresh needed",
          },
          outcome: "skipped",
        },
      ];
      // Nothing merged → no staleness → the convergent ensure steps are skipped too,
      // listed for parity with the dry-run plan (a no-op when none are declared).
      for (const step of plan.ensureSteps) {
        steps.push({
          step: {
            kind: "setup-ensure",
            label: step,
            disposition: "skip",
            note: "nothing merged — no convergence needed",
          },
          outcome: "skipped",
        });
      }
      return appliedResult("integrate", steps);
    }
    case "dirty":
      throw new WorktreeGitError(
        "Commit or stash your changes first, then re-run — integrate merges into a clean tree.",
      );
    case "conflict":
      throw new WorktreeGitError(
        integrateConflictMessage(mainBranch, outcome.files),
      );
    case "integrated": {
      ctx.log.heading(`Integrating ${mainBranch}…`);
      ctx.log.ok(
        outcome.fastForward
          ? `Fast-forwarded to ${mainBranch} (+${outcome.behind} commit(s)).`
          : `Merged ${mainBranch} (was behind by ${outcome.behind} commit(s)).`,
      );
      // Summarize what landed beneath the branch (ADR 0064) — commits, files, the
      // overlap hot zone, scopes — for the result `data` + hints, narrated here for
      // humans. Fail-open, so it can never undo or fail the merge that just landed.
      const summary = await summarizeIntegration(ctx, outcome, {
        predicted: false,
        mainBranch,
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
            ? `fast-forwarded ${mainBranch}`
            : `merged ${mainBranch}`,
        },
        outcome: "ok",
      }];
      // Re-materialize the generated agent files + skills: a merge can bring in
      // another line of work's guidance/skill source edits, which would otherwise
      // leave the generated files stale until the next finish. Non-fatal — the merge
      // already landed, so a refresh hiccup is recorded, not raised.
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
      steps.push({
        step: {
          kind: "refresh",
          label: "refresh agent files",
          disposition: "run",
          note: "re-materialized the generated agent files + skills",
        },
        outcome: refreshOk ? "ok" : "failed",
      });
      // Converge the worktree's environment on the merged tree: re-run the
      // `[worktree.setup].ensure` commands (the motivating case — a merge that
      // changed a lockfile leaves dependencies stale). Non-fatal — the merge already
      // landed, so a convergence failure is recorded as a failed step, never raised.
      const ensure = await runEnsureSteps(ctx, { fatal: false });
      for (const step of plan.ensureSteps) {
        steps.push({
          step: {
            kind: "setup-ensure",
            label: step,
            disposition: "run",
            note: "converge the worktree on the merged tree",
          },
          outcome: ensure.failed.includes(step) ? "failed" : "ok",
        });
      }
      ctx.log.ok("Integration complete.");
      const result: DiscernResult<IntegrateData> = appliedResult(
        "integrate",
        steps,
      );
      result.data = summary.data;
      result.hints = [...summary.hints, ...refreshHints];
      return result;
    }
  }
}

/**
 * Bring the latest integration branch into this worktree's branch and
 * re-materialize the agent files + skills — the `discern integrate` command, the
 * deterministic inverse of `graduate` and the action that resolves `finish`'s
 * fail-fast merge check. Runs from inside a linked worktree only; merges into a
 * clean tree only. A no-op when the branch already contains main; on a conflict it
 * aborts the merge and refuses, leaving a clean tree. `--dry-run` shows the plan
 * (after the worktree precondition passes) and touches nothing. Throws
 * `WorktreeGitError` on a refusal (the caller maps it to an error envelope).
 */
export async function integrate(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions = {},
): Promise<void> {
  const result = await integrateResult(ctx, { dryRun: opts.dryRun ?? false });
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
 * `--json` ({@link integrate}) and the MCP server both render. NOT pure on an apply:
 * it runs the real `git merge` + re-materialize (narrating through `ctx.log`, which
 * the MCP server silences with a quiet logger). The worktree precondition throws
 * `WorktreeGitError`, as does a refusal on a dirty tree or a conflict — the caller
 * maps that to an error envelope via {@link worktreeErrorResult}.
 */
export async function integrateResult(
  ctx: LifecycleContext,
  opts: { dryRun?: boolean } = {},
): Promise<DiscernResult<IntegrateData>> {
  const plan = await buildIntegratePlan(ctx);
  if (opts.dryRun ?? false) {
    const preview: DiscernResult<IntegrateData> = previewResult(
      "integrate",
      integratePlanToEngine(plan),
    );
    // Predict what the merge WOULD bring in (ADR 0064) — the same summary as an
    // apply, computed read-only from the fork point (no `after`; the file delta is
    // the three-dot `before...main`). Skipped on a no-op (nothing to integrate).
    if (!plan.alreadyIntegrated) {
      const anchors = await resolveIntegrationAnchors(ctx.cwd, plan.mainBranch);
      const summary = await summarizeIntegration(ctx, anchors, {
        predicted: true,
        mainBranch: plan.mainBranch,
      });
      preview.data = summary.data;
      preview.hints = summary.hints;
    }
    return preview;
  }
  return await executeIntegratePlan(ctx, plan);
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
 * Mint a fresh worktree id whose `<branch_prefix><id>` branch AND `<root>/<id>`
 * directory are both free, so `discern start` always *creates* a new worktree and
 * never adopts an existing one. The random hex tail in {@link generateWorktreeId}
 * makes a collision astronomically unlikely; this still verifies and retries a
 * bounded number of times before giving up loudly rather than ever reusing a live
 * worktree's id.
 */
async function mintFreeWorktree(
  ctx: LifecycleContext,
  settings: IdentitySettings,
  worktreeRoot: string,
  name?: string,
): Promise<{ id: string; branch: string; dir: string; note?: string }> {
  const run = makeGitRunner(ctx);
  for (let attempt = 0; attempt < 50; attempt++) {
    const minted = generateWorktreeId(name);
    const { branch } = deriveIdentity(minted.id, settings);
    const dir = join(worktreeRoot, minted.id);
    const branchTaken =
      (await run(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]))
        .success;
    if (!branchTaken && !(await pathPresent(dir))) {
      // The note (if any) is deterministic from the name, so returning the winning
      // attempt's carries the same transparency the caller surfaces upward.
      return minted.note !== undefined
        ? { id: minted.id, branch, dir, note: minted.note }
        : { id: minted.id, branch, dir };
    }
  }
  throw new WorktreeGitError(
    "discern start: could not mint a unique worktree id after many attempts.",
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
  if (!(await hasAnyCommit(ctx.root))) {
    throw new WorktreeGitError(
      "This repository has no commits yet, so there is nothing to branch a " +
        "worktree from — make your first commit first, then re-run `discern start`.",
    );
  }
  if (from !== undefined && from.trim() !== "") {
    const ref = from.trim();
    await resolveCommitRef(ctx.root, ref); // refuses unknown/ambiguous
    return ref;
  }
  const trunk = integrationBranch(ctx.config.project.main_branch);
  if (!(await localBranchExists(ctx.root, trunk))) {
    throw new WorktreeGitError(
      `New worktrees branch from the trunk, but the local branch '${trunk}' ` +
        `doesn't exist. Set [project].main_branch to the branch this project ` +
        `uses, or pass \`--from <ref>\` to branch from a specific ref.`,
    );
  }
  return trunk;
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
      "discern start: this project is not inside a git repository — run `git init` " +
        "and make a first commit, then re-run.",
    );
  }
  const root = await Deno.realPath(ctx.root).catch(() => ctx.root);
  if (root !== toplevel) {
    throw new WorktreeGitError(
      `discern.toml lives at ${root}, but the git repository's root is ` +
        `${toplevel}. Worktrees are whole-repository checkouts, so discern must ` +
        `be installed at the repository root — move discern.toml (and its ` +
        `authored files) to ${toplevel}, or make ${root} its own repository.`,
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
  const mainChanges = (await makeGitRunner(ctx)(
    ["status", "--porcelain", "--untracked-files=normal"],
    ctx.root,
  )).stdout.split("\n").filter((l) => l !== "").length;
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
    // best-effort throughout and `worktree prune` is the backstop.
    await discardWorktreeBestEffort(ctx.root, dir, branch, ctx.log);
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
    mainBranch: ctx.config.project.main_branch,
  });
  const orphanScan = await scanOrphanWorktreesForSweep({
    mainBranch: ctx.config.project.main_branch,
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
 * Housekeeping for the worktree pool — the `worktree prune` recipe. Removes stale
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
  try {
    await assertNotInWorktree("discern worktree prune", ctx.cwd);
  } catch {
    throw new WorktreeGitError(
      "discern worktree prune must be run from the main checkout, not a linked worktree.",
    );
  }
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
      throw new WorktreeGitError("Prune aborted; nothing was removed.");
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
    throw new WorktreeGitError("One or more cleanups failed.");
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
