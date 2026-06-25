/**
 * The worktree lifecycle entry points — worktree setup, ensure, graduate,
 * teardown, and prune. These compose the identity, resource, and git layers into
 * the operations the dispatcher exposes as `discern worktree`, `discern graduate`,
 * and `worktree:*`.
 *
 * Per-worktree external resources ([worktree.resources.<name>].create/destroy)
 * are project-supplied command strings run via `sh -c` after `@…@` token
 * expansion (see ./resources.ts). They are created once at setup (a `required`
 * create is fatal — a broken setup must be loud), destroyed once at teardown
 * (best-effort — a hiccup must never strand a worktree; a later prune is the
 * backstop), and reclaimed by prune when a worktree vanishes without a clean
 * teardown. [worktree.setup].steps run in order, stopping at the first failure.
 */

import { join } from "@std/path";
import { Logger, loggerSink } from "../../lib/log.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import {
  deriveIdentity,
  IdentityError,
  type IdentitySettings,
  loadIdentitySettings,
  resolveWorktreeId,
  resourceForId,
  worktreeBase,
  type WorktreeIdentity,
} from "./identity.ts";
import { writeEnvVar } from "./env_file.ts";
import { runShellRouted } from "./shell.ts";
import {
  classifyOrphans,
  createResources,
  destroyResources,
  ensureResources,
  entriesForWorktree,
  gcOrphanResources,
  type GcResult,
  listEntries,
  readResourceSpecs,
  recordResourceEnv,
} from "./resources.ts";
import {
  type GraduatePlan,
  graduatePlanToEngine,
  type PrunePlan,
  prunePlanToEngine,
  type SetupPlan,
  setupPlanToEngine,
  type SetupStepDesc,
  type TeardownPlan,
  teardownPlanToEngine,
} from "./plan.ts";
import {
  appliedResult,
  type DiscernResult,
  type EnginePlan,
  previewResult,
  renderPlan,
  type StepResult,
} from "../../shared/result.ts";
import { emitResult } from "../../shared/emit.ts";
import {
  assertInWorktree,
  assertMainMerged,
  assertNotInWorktree,
  ensureWorktreeBranch,
  inheritMainEnvVars,
  liveWorktreeGitKeys,
  liveWorktreePaths,
  mainRepoPath,
  pruneGitWorktrees,
  removeWorktreeSafely,
  resolveCommonGitDir,
  sweepOrphanWorktrees,
  WorktreeGitError,
  worktreeGitKey,
} from "./git.ts";

// worktree setup recompiles the agent guidance as its final step — which also
// materializes skills into .claude/skills/ inside the freshly created worktree (a
// linked worktree does not inherit that gitignored directory from the main checkout).
import { compileGuidelines } from "../guidelines.ts";

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

/** Emit an applied verb's result as the `--json` DiscernResult on stdout. */
function emitResults(verb: string, results: StepResult[]): void {
  emitResult(appliedResult(verb, results));
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
 * teardown hiccup must never strand a worktree (a later `worktree:prune` is the
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
  const gitBin = Deno.env.get("GIT_BIN") ?? "git";
  try {
    const out = await new Deno.Command(gitBin, {
      args: ["rev-parse", "--git-path", "discern-worktree-ready"],
      cwd,
      stdout: "piped",
      stderr: "null",
    }).output();
    if (!out.success) {
      return undefined;
    }
    const raw = new TextDecoder().decode(out.stdout).trim();
    if (raw === "") {
      return undefined;
    }
    // `--git-path` may print a path relative to the worktree's cwd.
    return raw.startsWith("/") ? raw : join(cwd, raw);
  } catch {
    return undefined;
  }
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
      : `Worktree dev-server port: ${port} (read it via: discern worktree-name --port).`,
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
  steps.push({ kind: "refresh", label: "refresh agent files" });
  return { branch, steps };
}

/**
 * Map the EXECUTED setup plan to `--json` results — recording what actually
 * happened, not a synthesized all-`ok`. A fatal step (a required resource, a
 * `setup.steps` non-zero exit) throws before this is reached; the steps that
 * warn-and-continue are reported honestly: a non-required resource whose create
 * failed, or an agent-file refresh that threw, is `failed`, not `ok`. The plan is
 * the one built before execution (never re-derived), so the reported steps can't
 * drift from what the dry-run previewed.
 */
function setupResults(
  plan: SetupPlan,
  failedResources: string[],
  refreshOk: boolean,
): StepResult[] {
  return plan.steps.map((s) => {
    const failed = (s.kind === "resource-create" &&
      failedResources.includes(s.label)) ||
      (s.kind === "refresh" && !refreshOk);
    return {
      step: { kind: s.kind, label: s.label, disposition: "run", note: s.note },
      outcome: failed ? "failed" : "ok",
    };
  });
}

/**
 * Set up a linked worktree — the `worktree` recipe. Asserts the worktree
 * precondition, ensures a named branch, provisions the per-worktree resources (a
 * `required` create is fatal), inherits env vars, records the port + resource
 * handles into `.env`, runs `[worktree.setup].steps` in order, refreshes the agent
 * files, and drops the ready sentinel. Throws on a fatal step. `--dry-run` shows
 * the plan and touches nothing.
 *
 * Idempotent: when the worktree is already configured (the sentinel is present),
 * the non-idempotent phases are not repeated — resources are re-readied via
 * `ensure` rather than re-created, and the setup steps are skipped — so a re-fired
 * `worktree:create` hook or a re-run `discern worktree` is safe.
 */
export async function worktreeSetup(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions = {},
): Promise<void> {
  // 1. must be inside a linked worktree
  try {
    await assertInWorktree("discern worktree", ctx.cwd);
  } catch {
    throw new WorktreeGitError(
      "discern worktree must be run from inside a linked git worktree, not the main checkout.",
    );
  }

  // Build the plan ONCE — the dry-run renders it and the apply records its
  // outcomes against it, so the preview and the `--json` report can't drift.
  const plan = await buildSetupPlan(ctx);
  if (opts.dryRun ?? false) {
    emitDryRun(ctx, "worktree", setupPlanToEngine(plan), opts.json ?? false);
    return;
  }

  ctx.log.heading("Setting up this worktree…");

  // 2. ensure a named branch (resolve identity first for its branch base)
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  await ensureWorktreeBranch(identity.branch, ctx.cwd);

  // Has this worktree already completed setup? The ready sentinel is the proof. The
  // two non-ensure callers — a re-fired `worktree:create` hook and an explicit
  // `discern worktree` — reach here on an already-configured worktree, where the
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

  // 6. post-create setup steps (stop on first failure). Skipped once the worktree
  // is configured — they ran at first setup and are not re-run (author them
  // idempotent so a recovered partial setup can re-run them safely).
  if (configured) {
    if (ctx.config.worktree.setup.steps.length > 0) {
      ctx.log.info("Worktree already configured — skipping setup steps.");
    }
  } else {
    for (const step of ctx.config.worktree.setup.steps) {
      ctx.log.info(`Setup step: ${step}`);
      const code = await runShellRouted(step, { cwd: ctx.cwd, log: ctx.log });
      if (code !== 0) {
        throw new WorktreeGitError(`Setup step failed: ${step}`);
      }
    }
  }

  // 7. refresh the agent files, which also materializes skills into THIS
  // worktree's .claude/skills/. A linked worktree does NOT inherit that gitignored
  // directory from the main checkout, so it must be (re)built here. Non-fatal —
  // but its real outcome is recorded, not reported as a blanket success.
  ctx.log.info("Refreshing agent files…");
  let refreshOk = true;
  try {
    await compileGuidelines(ctx.root, ctx.log);
  } catch {
    refreshOk = false;
    ctx.log.warn("Agent-file refresh reported an error — continuing.");
  }

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

  if (opts.json ?? false) {
    emitResults("worktree", setupResults(plan, createdFailed, refreshOk));
  }
}

/** The outcome of the idempotent session-start ensure check. */
export type EnsureResult =
  /** Worktree workflow disabled, or not in a linked worktree → silent no-op. */
  | { kind: "skipped" }
  /** Already configured (the sentinel is present) → no-op. */
  | { kind: "already" }
  /** Setup was not yet run; it has now been executed. */
  | { kind: "ran" };

/**
 * The idempotent session-start check — the `worktree-ensure` recipe. Runs
 * `worktreeSetup` exactly once for a linked worktree that has not been set up.
 * Safe to run on every session start: disabled workflow, the main checkout, a
 * non-git dir, or an already-configured worktree are all silent no-ops.
 */
export async function worktreeEnsure(
  ctx: LifecycleContext,
): Promise<EnsureResult> {
  if (!ctx.config.worktree.enabled) {
    return { kind: "skipped" };
  }
  // Skip when not inside a linked worktree (including the main checkout).
  try {
    await assertInWorktree("session-start", ctx.cwd);
  } catch {
    return { kind: "skipped" };
  }
  if (await sentinelPresent(ctx.cwd)) {
    // Already set up — reconcile any resource that declares an `ensure` (re-ready a
    // resource that died out-of-band, e.g. a host reboot). Cheap and silent when
    // nothing declares `ensure`.
    const { identity, settings } = await resolveContextIdentity(ctx);
    await ensureResources(ctx, identity, settings);
    return { kind: "already" };
  }
  ctx.log.warn(
    "[discern] Worktree not configured yet; running 'discern worktree'…",
  );
  await worktreeSetup(ctx);
  return { kind: "ran" };
}

/**
 * Tear down this worktree's resources without graduating its
 * branch — the `worktree:teardown` recipe, used when DISCARDING a worktree.
 * Asserts the worktree precondition; destroys every resource the worktree created.
 */
export async function worktreeTeardown(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions = {},
): Promise<void> {
  try {
    await assertInWorktree("discern worktree:teardown", ctx.cwd);
  } catch {
    throw new WorktreeGitError(
      "discern worktree:teardown must be run from inside a linked git worktree, not the main checkout.",
    );
  }

  const plan = await buildTeardownPlan(ctx);
  if (opts.dryRun ?? false) {
    emitDryRun(
      ctx,
      "worktree:teardown",
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

  if (opts.json ?? false) {
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
    emitResults("worktree:teardown", results);
  }
}

/** A captured git run for the lifecycle layer's inline git calls. */
interface GitOut {
  success: boolean;
  stdout: string;
  stderr: string;
}

/** A bound git runner for the graduation flow (defaults to the worktree cwd). */
type GitRunner = (args: string[], cwd?: string) => Promise<GitOut>;

/** Build the git runner graduation uses — captures stdout/stderr, never throws. */
function makeGitRunner(ctx: LifecycleContext): GitRunner {
  const gitBin = Deno.env.get("GIT_BIN") ?? "git";
  return async (args: string[], cwd: string = ctx.cwd): Promise<GitOut> => {
    try {
      const out = await new Deno.Command(gitBin, {
        args,
        cwd,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const dec = new TextDecoder();
      return {
        success: out.success,
        stdout: dec.decode(out.stdout),
        stderr: dec.decode(out.stderr),
      };
    } catch {
      return { success: false, stdout: "", stderr: "git is not on PATH" };
    }
  };
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

  // require main is integrated
  ctx.log.info("Checking the branch contains the latest main…");
  const merged = await assertMainMerged(
    ctx.cwd,
    ctx.config.project.main_branch,
  );
  if (merged.kind === "behind") {
    throw new WorktreeGitError(
      "Branch is behind main. Run 'discern finish' to integrate it (commit, git merge main, re-run), then retry.",
    );
  }
  ctx.log.ok("Branch contains the latest main.");

  // capture worktree state
  const worktreeDirty =
    (await run(["status", "--porcelain"])).stdout.trim() !== "";
  const mainDirty =
    (await run(["status", "--porcelain"], mainRepo)).stdout.trim() !== "";
  const mainBranchRun = await run(["branch", "--show-current"], mainRepo);
  const mainBranch = mainBranchRun.stdout.trim() !== ""
    ? mainBranchRun.stdout.trim()
    : "(detached)";

  // gate: refuse to touch a dirty main checkout
  if (mainDirty) {
    throw new WorktreeGitError(
      `Main checkout at ${mainRepo} has uncommitted changes on '${mainBranch}'. ` +
        `Commit or stash them yourself, then re-run — graduation will not move your main-repo work for you. ` +
        `Your worktree branch '${worktreeBranch}' is untouched and still holds all its commits.`,
    );
  }

  return {
    worktreeBranch,
    worktreePath,
    mainRepo,
    mainBranch,
    worktreeDirty,
    hasResources: readResourceSpecs(ctx.config).length > 0,
  };
}

/**
 * Apply a graduation plan — the mutation dance. Ensures the named branch
 * (creating one if the worktree is detached), tears down the resources, WIP-commits
 * any uncommitted changes, removes the worktree, checks the branch out in main, then
 * soft-resets the WIP commit so those changes land staged. Narrates exactly as
 * before; throws `WorktreeGitError` on any unrecoverable error (the branch keeps
 * its commits). Returns the per-step results for `--json`.
 */
async function executeGraduatePlan(
  ctx: LifecycleContext,
  run: GitRunner,
  plan: GraduatePlan,
): Promise<StepResult[]> {
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
  const { worktreePath, mainRepo, mainBranch, worktreeDirty } = plan;
  const results: StepResult[] = [];
  const done = (kind: StepResult["step"]["kind"], label: string): void => {
    results.push({ step: { kind, label, disposition: "run" }, outcome: "ok" });
  };

  ctx.log.heading("Graduation plan");
  ctx.log.detail(`Branch:        ${worktreeBranch}`);
  ctx.log.detail(`From worktree: ${worktreePath}`);
  ctx.log.detail(`Into main:     ${mainRepo} (on ${mainBranch})`);
  if (worktreeDirty) {
    ctx.log.detail(
      "Note: worktree has uncommitted changes — will WIP-commit then unstage after migration",
    );
  }

  // tear down external resources (non-fatal, while still in the worktree so
  // @dir@-bearing destroys resolve, and before removal so no orphan is left)
  ctx.log.info("Tearing down the worktree's resources…");
  await teardownResources(ctx);
  done("resource-destroy", "teardown resources");

  // WIP commit if needed
  let madeWipCommit = false;
  if (worktreeDirty) {
    ctx.log.info("Committing leftover uncommitted worktree changes as WIP…");
    await run(["add", "-A"]);
    const commit = await run([
      "commit",
      "--quiet",
      "-m",
      "WIP: graduate worktree (uncommitted changes)",
    ]);
    if (!commit.success) {
      throw new WorktreeGitError(
        `Failed to create WIP commit: ${commit.stderr.trim()}`,
      );
    }
    madeWipCommit = true;
    ctx.log.ok("WIP commit created.");
    done("git", "wip-commit");
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

  // check out the branch in main
  ctx.log.info(`Checking out ${worktreeBranch} in main repo…`);
  const checkout = await run(["checkout", "--quiet", worktreeBranch], mainRepo);
  if (!checkout.success) {
    throw new WorktreeGitError(
      `git checkout ${worktreeBranch} failed. The branch may still be claimed elsewhere. Git said:\n    ${checkout.stderr.trim()}`,
    );
  }
  ctx.log.ok(`On ${worktreeBranch} at ${mainRepo}.`);
  done("git", "checkout");

  // soft-reset the WIP commit if we made one
  if (madeWipCommit) {
    ctx.log.info(
      "Unstaging WIP commit so changes land staged-but-uncommitted…",
    );
    await run(["reset", "--soft", "HEAD~1"], mainRepo);
    ctx.log.ok(
      "WIP commit unstaged; previously uncommitted changes are now staged here.",
    );
    done("git", "unstage-wip");
  }

  ctx.log.heading("Graduation complete.");
  ctx.log.line(`  You are on ${worktreeBranch} in ${mainRepo}.`);
  return results;
}

/**
 * Graduate this worktree's branch into the main repo — the `discern graduate`
 * command. Requires the latest main is integrated, tears down the worktree's
 * external resources, WIP-commits any uncommitted changes, removes the worktree
 * directory, checks the branch out in main, then soft-resets the WIP commit so
 * those changes land staged. Refuses to touch a dirty main checkout. `--dry-run`
 * shows the plan (after the read-only preconditions pass) and touches nothing.
 * Throws `WorktreeGitError` on any unrecoverable error (the branch keeps its
 * commits).
 */
export async function graduate(
  ctx: LifecycleContext,
  opts: WorktreeOpOptions = {},
): Promise<void> {
  const result = await graduateResult(ctx, { dryRun: opts.dryRun ?? false });
  if (opts.json ?? false) {
    emitResult(result);
  } else if (result.dry_run === true && result.plan !== undefined) {
    // Human dry-run: render the plan the result carries (an apply already narrated
    // through ctx.log while executeGraduatePlan ran).
    renderPlan(loggerSink(ctx.log), result.plan);
  }
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
  opts: { dryRun?: boolean } = {},
): Promise<DiscernResult> {
  const run = makeGitRunner(ctx);
  const plan = await buildGraduatePlan(ctx, run);
  if (opts.dryRun ?? false) {
    return previewResult("graduate", graduatePlanToEngine(plan));
  }
  return appliedResult("graduate", await executeGraduatePlan(ctx, run, plan));
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
  /** Run non-interactively (the dispatcher passes this when there is no TTY). */
  assumeYes?: boolean;
  /** Report what would be removed/reclaimed without acting. */
  dryRun?: boolean;
  /** Emit a machine-readable (plan, results) object on stdout. */
  json?: boolean;
}

/**
 * The read-only prune SCAN — what `worktree:prune` would remove and reclaim,
 * gathered without acting. The git-worktree and orphan-dir scans run their
 * existing functions in `dryRun` mode through a quiet logger (so planning never
 * narrates); the resource reclaims come from the pure {@link classifyOrphans}
 * decision over the ledger. The deliverable a `--dry-run` renders and the apply
 * path reports.
 */
async function buildPrunePlan(ctx: LifecycleContext): Promise<PrunePlan> {
  const quiet = new Logger({ json: true, noColor: true });
  const prune = await pruneGitWorktrees({
    dryRun: true,
    includeDetached: true,
    mainBranch: ctx.config.project.main_branch,
    log: quiet,
  });
  const sweep = await sweepOrphanWorktrees({ dryRun: true, log: quiet });
  return {
    worktreesToRemove: prune.removed,
    branchesToDelete: prune.branchesDeleted,
    orphanDirs: sweep.removed,
    resourceReclaims: await planResourceReclaims(ctx),
  };
}

/**
 * The orphaned-resource handles GC would reclaim — the read-only half of the
 * resource GC, built from the pure {@link classifyOrphans} decision over the
 * ledger and the live-worktree snapshot. No destroy, no ledger writes. A no-op
 * outside a git repo.
 */
async function planResourceReclaims(ctx: LifecycleContext): Promise<string[]> {
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  if (commonGitDir === undefined) {
    return [];
  }
  const livePaths = await liveWorktreePaths(ctx.cwd);
  const { reclaimable } = classifyOrphans(await listEntries(commonGitDir), {
    gitKeys: await liveWorktreeGitKeys(commonGitDir),
    paths: livePaths,
    identities: await liveResourceIdentitySet(ctx, livePaths),
  });
  return reclaimable.map((item) => item.entry.resource_identity);
}

/**
 * Housekeeping for the worktree pool — the `worktree:prune` recipe. Removes stale
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
    await assertNotInWorktree("discern worktree:prune", ctx.cwd);
  } catch {
    throw new WorktreeGitError(
      "discern worktree:prune must be run from the main checkout, not a linked worktree.",
    );
  }
  const json = opts.json ?? false;

  // Dry-run: scan read-only and render the plan; touch nothing.
  if (opts.dryRun ?? false) {
    emitDryRun(
      ctx,
      "worktree:prune",
      prunePlanToEngine(await buildPrunePlan(ctx)),
      json,
    );
    return;
  }

  // Apply: run the real removals, narrating exactly as before.
  ctx.log.heading("Pruning worktrees and fully-merged branches…");
  const prune = await pruneGitWorktrees({
    dryRun: false,
    includeDetached: true,
    mainBranch: ctx.config.project.main_branch,
    log: ctx.log,
  });

  ctx.log.heading("Reclaiming orphaned worktree directories…");
  const sweep = await sweepOrphanWorktrees({ dryRun: false, log: ctx.log });

  ctx.log.heading("Reclaiming orphaned worktree resources…");
  const gc = await gcWorktreeResources(ctx, false);

  if (prune.failed || sweep.failed || gc.failed) {
    throw new WorktreeGitError("One or more cleanups failed.");
  }
  ctx.log.ok("Prune complete.");
  // `assumeYes` is accepted for dispatcher parity; the interactive confirmation
  // belongs to the dispatcher (which owns the TTY), so prune runs the removals
  // directly once invoked. See note in git.ts pruneGitWorktrees.
  void opts.assumeYes;

  if (json) {
    emitResults("worktree:prune", pruneResults(prune, sweep, gc));
  }
}

/** Map the real prune/sweep/GC outcomes to `--json` step results. */
function pruneResults(
  prune: { removed: string[]; branchesDeleted: string[] },
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
    ...gc.reclaimed.map((r) =>
      step("resource-destroy", r, "reclaimed orphaned resource", "Resources")
    ),
  ];
}

/**
 * The resource-GC pass of `worktree:prune`: reclaim any ledgered resource whose
 * worktree is gone. Conservative — `gcOrphanResources` only acts on entries this
 * project's ledger holds, and never on one a live worktree still owns (by key,
 * path, or resource handle). A no-op outside a git repo.
 */
async function gcWorktreeResources(
  ctx: LifecycleContext,
  dryRun: boolean,
): Promise<GcResult> {
  const empty: GcResult = { reclaimed: [], kept: 0, failed: false };
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  if (commonGitDir === undefined) {
    return empty;
  }
  const livePaths = await liveWorktreePaths(ctx.cwd);
  const gc = await gcOrphanResources({
    commonGitDir,
    cwd: ctx.cwd,
    liveGitKeys: await liveWorktreeGitKeys(commonGitDir),
    livePaths,
    liveIdentities: await liveResourceIdentitySet(ctx, livePaths),
    // Re-evaluate handle ownership against CURRENT disk state before each destroy:
    // a worktree created mid-loop can own this handle under a fresh git_key that
    // the snapshot — and the `gitKeyIsLive` re-check — both miss (M1).
    recheckIdentityLive: async (identity: string): Promise<boolean> => {
      const paths = await liveWorktreePaths(ctx.cwd);
      return (await liveResourceIdentitySet(ctx, paths)).has(identity);
    },
    dryRun,
    log: ctx.log,
  });
  const n = gc.reclaimed.length;
  if (dryRun) {
    ctx.log.line(
      `Would reclaim ${n} orphaned worktree resource${n === 1 ? "" : "s"}.`,
    );
  } else if (n === 0) {
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
 * Resolve a single identity field for the `worktree-name` command surface. Kept
 * here so the dispatcher can map `discern worktree-name --<field>` to one call
 * without reaching into the identity internals. Throws `IdentityError` (carrying
 * an exit code) on a resolution failure, exactly as the shell did.
 */
export async function worktreeNameField(
  root: string,
  field: "id" | "site" | "branch" | "port" | "db" | "worktree",
  target: string = Deno.cwd(),
): Promise<string> {
  const settings = await loadIdentitySettings(root);
  const id = await resolveWorktreeId(settings, target);
  const identity = deriveIdentity(id, settings);
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
 * Resolve a named resource's handle for `worktree-name --resource <name>` — the
 * runtime-discovery query that equals what the resource's `create` used and what
 * `DISCERN_RESOURCE_<NAME>` carries in the worktree's `.env`.
 */
export async function worktreeResourceHandle(
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
 * `worktree-name --resources` (visibility into a worktree's resources).
 */
export async function worktreeResourcesList(
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
