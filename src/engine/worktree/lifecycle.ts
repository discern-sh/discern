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
import type { Logger } from "../../lib/log.ts";
import { Config } from "../../shared/config_read.ts";
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
import {
  createResources,
  destroyResources,
  ensureResources,
  gcOrphanResources,
  type GcResult,
  readResourceSpecs,
  recordResourceEnv,
} from "./resources.ts";
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
  config: Config;
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
  return { root, config: await Config.load(root), log, cwd };
}

/** Run a command string via `sh -c` in `cwd`, inheriting stdio. Returns its exit code. */
async function runShell(command: string, cwd: string): Promise<number> {
  if (command === "") {
    return 0;
  }
  const child = new Deno.Command("sh", {
    args: ["-c", command],
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;
  return status.code;
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
async function teardownResources(ctx: LifecycleContext): Promise<void> {
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  const gitKey = await worktreeGitKey(ctx.cwd);
  if (commonGitDir === undefined || gitKey === undefined) {
    ctx.log.warn(
      "Could not resolve this worktree's git identity — skipping resource teardown.",
    );
    return;
  }
  await destroyResources(ctx, commonGitDir, gitKey);
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

/** Record the deterministic port in this worktree's `.env`, or report it. */
async function recordPort(
  ctx: LifecycleContext,
  identity: WorktreeIdentity,
): Promise<void> {
  if (!ctx.config.bool("worktree.port")) {
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
 * Set up a freshly-created linked worktree — the `worktree` recipe. Asserts the
 * worktree precondition, ensures a named branch, creates the per-worktree
 * resources (a `required` create is fatal), inherits env vars, records the port +
 * resource handles into `.env`, runs `[worktree.setup].steps` in order, refreshes
 * the agent files, and drops the ready sentinel. Throws on a fatal step.
 */
export async function worktreeSetup(ctx: LifecycleContext): Promise<void> {
  // 1. must be inside a linked worktree
  try {
    await assertInWorktree("discern worktree", ctx.cwd);
  } catch {
    throw new WorktreeGitError(
      "discern worktree must be run from inside a linked git worktree, not the main checkout.",
    );
  }

  ctx.log.heading("Setting up this worktree…");

  // 2. ensure a named branch (resolve identity first for its branch base)
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  await ensureWorktreeBranch(identity.branch, ctx.cwd);

  // 3. create the per-worktree resources (ledger-logged for GC; a required
  // create failure aborts setup). Resources need the worktree's git identity.
  const commonGitDir = await resolveCommonGitDir(ctx.cwd);
  const gitKey = await worktreeGitKey(ctx.cwd);
  if (commonGitDir !== undefined && gitKey !== undefined) {
    await createResources(ctx, identity, settings, commonGitDir, gitKey);
    await recordResourceEnv(ctx, identity, settings);
  } else if (readResourceSpecs(ctx.config).length > 0) {
    throw new WorktreeGitError(
      "Could not resolve this worktree's git identity for resource setup.",
    );
  }

  // 4. inherit env vars from main
  await inheritMainEnvVars({
    worktreeRoot: ctx.cwd,
    vars: ctx.config.array("worktree.inherit_env"),
    log: ctx.log,
  });

  // 5. record the deterministic port
  await recordPort(ctx, identity);

  // 6. post-create setup steps (stop on first failure)
  for (const step of ctx.config.array("worktree.setup.steps")) {
    ctx.log.info(`Setup step: ${step}`);
    const code = await runShell(step, ctx.cwd);
    if (code !== 0) {
      throw new WorktreeGitError(`Setup step failed: ${step}`);
    }
  }

  // 7. refresh the agent files, which also materializes skills into THIS
  // worktree's .claude/skills/. A linked worktree does NOT inherit that gitignored
  // directory from the main checkout, so it must be (re)built here. Non-fatal.
  ctx.log.info("Refreshing agent files…");
  try {
    await compileGuidelines(ctx.root, ctx.log);
  } catch {
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
  if (!ctx.config.bool("worktree.enabled")) {
    return { kind: "skipped" };
  }
  // Skip when not inside a linked worktree (including the main checkout).
  try {
    await assertInWorktree("session-start", ctx.cwd);
  } catch {
    return { kind: "skipped" };
  }
  const marker = await readySentinelPath(ctx.cwd);
  if (marker !== undefined) {
    try {
      if ((await Deno.stat(marker)).isFile) {
        // Already set up — reconcile any resource that declares an `ensure`
        // (re-ready a resource that died out-of-band, e.g. a host reboot). Cheap
        // and silent when nothing declares `ensure`.
        const { identity, settings } = await resolveContextIdentity(ctx);
        await ensureResources(ctx, identity, settings);
        return { kind: "already" };
      }
    } catch {
      // sentinel absent — fall through and run setup
    }
  }
  ctx.log.warn(
    "[discern] Worktree not configured yet; running 'discern worktree'…",
  );
  await worktreeSetup(ctx);
  return { kind: "ran" };
}

/**
 * Tear down this worktree's database + dev-server link without graduating its
 * branch — the `worktree:teardown` recipe, used when DISCARDING a worktree.
 * Asserts the worktree precondition; destroys every resource the worktree created.
 */
export async function worktreeTeardown(ctx: LifecycleContext): Promise<void> {
  try {
    await assertInWorktree("discern worktree:teardown", ctx.cwd);
  } catch {
    throw new WorktreeGitError(
      "discern worktree:teardown must be run from inside a linked git worktree, not the main checkout.",
    );
  }
  ctx.log.heading("Tearing down this worktree…");
  await teardownResources(ctx);
  ctx.log.ok("Worktree teardown complete.");
}

/**
 * Graduate this worktree's branch into the main repo — the `discern graduate`
 * command. Requires the latest main is integrated, tears down the worktree's
 * external resources, WIP-commits any uncommitted changes, removes the worktree
 * directory, checks the branch out in main, then soft-resets the WIP commit so
 * those changes land staged. Refuses to touch a dirty main checkout. Throws
 * `WorktreeGitError` on any unrecoverable error (the branch keeps its commits).
 */
export async function graduate(ctx: LifecycleContext): Promise<void> {
  const gitBin = Deno.env.get("GIT_BIN") ?? "git";
  const run = async (
    args: string[],
    cwd: string = ctx.cwd,
  ): Promise<GitOut> => {
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

  // step 1: diagnose
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

  // ensure a named branch
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  const worktreeBranch = await ensureWorktreeBranch(identity.branch, ctx.cwd);
  if (worktreeBranch === "") {
    throw new WorktreeGitError(
      "Worktree is in detached HEAD state and ensure-worktree-branch could not create a named branch.",
    );
  }

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

  // step 2: require main is integrated
  ctx.log.info("Checking the branch contains the latest main…");
  const merged = await assertMainMerged(
    ctx.cwd,
    ctx.config.get("project.main_branch", "main"),
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

  // step 3: plan
  ctx.log.heading("Graduation plan");
  ctx.log.detail(`Branch:        ${worktreeBranch}`);
  ctx.log.detail(`From worktree: ${worktreePath}`);
  ctx.log.detail(`Into main:     ${mainRepo} (on ${mainBranch})`);
  if (worktreeDirty) {
    ctx.log.detail(
      "Note: worktree has uncommitted changes — will WIP-commit then unstage after migration",
    );
  }

  // step 4: tear down external resources (non-fatal, while still in the worktree
  // so @dir@-bearing destroys resolve, and before removal so no orphan is left)
  ctx.log.info("Tearing down the worktree's resources…");
  await teardownResources(ctx);

  // step 5: WIP commit if needed
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
  }

  // step 6: remove the worktree (from the main repo)
  ctx.log.info(`Removing worktree: ${worktreePath}`);
  try {
    await removeWorktreeSafely(worktreePath, mainRepo);
  } catch {
    throw new WorktreeGitError(
      `Worktree removal failed for ${worktreePath}. The branch ${worktreeBranch} holds your commits; run 'git worktree list' to investigate.`,
    );
  }
  ctx.log.ok("Worktree directory removed.");

  // step 7: check out the branch in main
  ctx.log.info(`Checking out ${worktreeBranch} in main repo…`);
  const checkout = await run(["checkout", "--quiet", worktreeBranch], mainRepo);
  if (!checkout.success) {
    throw new WorktreeGitError(
      `git checkout ${worktreeBranch} failed. The branch may still be claimed elsewhere. Git said:\n    ${checkout.stderr.trim()}`,
    );
  }
  ctx.log.ok(`On ${worktreeBranch} at ${mainRepo}.`);

  // step 8: soft-reset the WIP commit if we made one
  if (madeWipCommit) {
    ctx.log.info(
      "Unstaging WIP commit so changes land staged-but-uncommitted…",
    );
    await run(["reset", "--soft", "HEAD~1"], mainRepo);
    ctx.log.ok(
      "WIP commit unstaged; previously uncommitted changes are now staged here.",
    );
  }

  ctx.log.heading("Graduation complete.");
  ctx.log.line(`  You are on ${worktreeBranch} in ${mainRepo}.`);
}

/** A captured git run for the lifecycle layer's inline git calls. */
interface GitOut {
  success: boolean;
  stdout: string;
  stderr: string;
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
}

/**
 * Housekeeping for the worktree pool — the `worktree:prune` recipe. Removes stale
 * worktrees and fully-merged branches, reclaims gitlinked orphan directories, then
 * reclaims orphaned per-worktree RESOURCES (the GC safety net: a resource whose
 * worktree vanished without a clean teardown). Refuses to run from inside a linked
 * worktree (pool housekeeping belongs to the main checkout). Throws on a setup or
 * removal failure.
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
  const dryRun = opts.dryRun ?? false;

  ctx.log.heading(
    dryRun
      ? "Prune (dry run): worktrees and fully-merged branches…"
      : "Pruning worktrees and fully-merged branches…",
  );
  const prune = await pruneGitWorktrees({
    dryRun,
    includeDetached: true,
    mainBranch: ctx.config.get("project.main_branch", "main"),
    log: ctx.log,
  });

  ctx.log.heading("Reclaiming orphaned worktree directories…");
  const sweep = await sweepOrphanWorktrees({ dryRun, log: ctx.log });

  ctx.log.heading("Reclaiming orphaned worktree resources…");
  const gc = await gcWorktreeResources(ctx, dryRun);

  if (prune.failed || sweep.failed || gc.failed) {
    throw new WorktreeGitError("One or more cleanups failed.");
  }
  ctx.log.ok(dryRun ? "Dry run complete." : "Prune complete.");
  // `assumeYes` is accepted for dispatcher parity; the interactive confirmation
  // belongs to the dispatcher (which owns the TTY), so prune runs the removals
  // directly once invoked. See note in git.ts pruneGitWorktrees.
  void opts.assumeYes;
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
  const config = await Config.load(root);
  return readResourceSpecs(config).map(
    (s) => `${s.name}=${resourceForId(settings.slug, id, s.name)}`,
  );
}

export { IdentityError, WorktreeGitError };
