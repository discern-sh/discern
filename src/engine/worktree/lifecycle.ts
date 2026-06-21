/**
 * The worktree lifecycle recipe entry points — the TS port of the `worktree`,
 * `worktree-ensure`, `worktree-exit`, `worktree-teardown`, and `worktree-prune`
 * recipes. These compose the identity, token, and git layers into the operations
 * the dispatcher exposes as `icculus worktree` / `worktree:*`.
 *
 * Adapter seams ([worktree.db].clone/drop, [worktree.dev_server].link/unlink) are
 * operator-supplied command strings run via `sh -c` after `@…@` token expansion.
 * An empty command is a clean no-op. Setup adapters are fatal (a broken setup
 * must be loud); teardown adapters are non-fatal (a hiccup must never strand a
 * worktree). [worktree.setup].steps run in order, stopping at the first failure.
 */

import { join } from "@std/path";
import type { Logger } from "../../lib/log.ts";
import { Config } from "../../shared/config_read.ts";
import {
  deriveIdentity,
  IdentityError,
  loadIdentitySettings,
  resolveWorktreeId,
  type WorktreeIdentity,
} from "./identity.ts";
import {
  expandTokens,
  type TokenResolver,
  type WorktreeToken,
} from "./tokens.ts";
import {
  assertInWorktree,
  assertMainMerged,
  assertNotInWorktree,
  ensureWorktreeBranch,
  inheritMainEnvVars,
  mainRepoPath,
  pruneGitWorktrees,
  removeWorktreeSafely,
  sweepOrphanWorktrees,
  WorktreeGitError,
} from "./git.ts";

// worktree setup recompiles the agent guidance as its final step — which also
// materializes skills into .claude/skills/ inside the freshly created worktree (a
// linked worktree does not inherit that gitignored directory from the main checkout).
import { compileGuidelines } from "../guidelines.ts";

/** Context shared by every lifecycle operation. */
export interface LifecycleContext {
  /** The project root (holds `icculus.toml`). */
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

/**
 * A token resolver bound to a worktree's identity and root. `@db@`/`@site@`/
 * `@port@` come from the resolved identity; `@project_slug@` from config (the
 * raw configured slug, matching the shell `wt_token_value`); `@dir@` from the
 * worktree root. Built lazily so a command naming no tokens resolves nothing.
 */
function tokenResolver(
  identity: WorktreeIdentity,
  config: Config,
  worktreeRoot: string,
): TokenResolver {
  return (token: WorktreeToken): string => {
    switch (token) {
      case "db":
        return identity.db;
      case "site":
        return identity.site;
      case "port":
        return String(identity.port);
      case "project_slug":
        return config.get("project.slug", "");
      case "dir":
        return worktreeRoot;
    }
  };
}

/** The result of running one adapter command. */
interface AdapterRun {
  /** True when the command was empty (a no-op) or exited 0. */
  ok: boolean;
  /** The process exit code (0 for an empty no-op). */
  code: number;
}

/**
 * Run one adapter command after token expansion, but only when non-empty. Prints
 * `label` via `log.info` first. An empty command is a clean success no-op.
 * Mirrors the shell `wt_run_adapter`.
 */
async function runAdapter(
  ctx: LifecycleContext,
  identity: WorktreeIdentity,
  label: string,
  rawCommand: string,
): Promise<AdapterRun> {
  if (rawCommand === "") {
    return { ok: true, code: 0 };
  }
  ctx.log.info(label);
  const expanded = await expandTokens(
    rawCommand,
    tokenResolver(identity, ctx.config, ctx.cwd),
  );
  const code = await runShell(expanded, ctx.cwd);
  return { ok: code === 0, code };
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

/** Resolve this worktree's full identity from the context's cwd. */
async function resolveContextIdentity(
  ctx: LifecycleContext,
): Promise<WorktreeIdentity> {
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  return deriveIdentity(id, settings);
}

/**
 * Tear down this worktree's external resources: first unlink the dev server,
 * then drop the database. Both are no-ops when unset. Failures are reported but
 * NOT fatal — a teardown hiccup must never strand a worktree (a later prune is
 * the backstop). Mirrors the shell `wt_teardown`.
 */
async function teardownAdapters(
  ctx: LifecycleContext,
  identity: WorktreeIdentity,
): Promise<void> {
  const unlink = await runAdapter(
    ctx,
    identity,
    "Unlinking the worktree dev server…",
    ctx.config.get("worktree.dev_server.unlink", ""),
  );
  if (!unlink.ok) {
    ctx.log.warn("Dev-server unlink reported an error — continuing.");
  }
  const drop = await runAdapter(
    ctx,
    identity,
    "Dropping the worktree database…",
    ctx.config.get("worktree.db.drop", ""),
  );
  if (!drop.ok) {
    ctx.log.warn("Database drop reported an error — continuing.");
  }
}

/** The per-worktree setup sentinel path (`git rev-parse --git-path icculus-worktree-ready`). */
async function readySentinelPath(cwd: string): Promise<string | undefined> {
  const gitBin = Deno.env.get("GIT_BIN") ?? "git";
  try {
    const out = await new Deno.Command(gitBin, {
      args: ["rev-parse", "--git-path", "icculus-worktree-ready"],
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
  const envPath = join(ctx.cwd, ".env");
  let envText: string | undefined;
  try {
    envText = await Deno.readTextFile(envPath);
  } catch {
    envText = undefined;
  }
  if (envText === undefined) {
    ctx.log.ok(
      `Worktree dev-server port: ${port} (read it via: icculus worktree-name --port).`,
    );
    return;
  }
  const key = "ICCULUS_WORKTREE_PORT=";
  const lines = envText.split("\n");
  let replaced = false;
  const next = lines.map((line) => {
    if (!replaced && line.startsWith(key)) {
      replaced = true;
      return `${key}${port}`;
    }
    return line;
  });
  if (!replaced) {
    // Append, mirroring the shell `printf ... >> .env` (which adds a trailing NL).
    if (envText.endsWith("\n") || envText === "") {
      next.splice(
        next.length - (envText.endsWith("\n") ? 1 : 0),
        0,
        `${key}${port}`,
      );
    } else {
      next.push(`${key}${port}`);
    }
  }
  await Deno.writeTextFile(envPath, next.join("\n"));
  ctx.log.ok(`Worktree dev-server port: ${port} (recorded in .env).`);
}

/**
 * Set up a freshly-created linked worktree — the `worktree` recipe. Asserts the
 * worktree precondition, ensures a named branch, runs the db-clone and
 * dev-server-link adapters (fatal on failure), inherits env vars, records the
 * port, runs `[worktree.setup].steps` in order, compiles the agent guidelines,
 * and drops the ready sentinel. Throws on a fatal step.
 */
export async function worktreeSetup(ctx: LifecycleContext): Promise<void> {
  // 1. must be inside a linked worktree
  try {
    await assertInWorktree("icculus worktree", ctx.cwd);
  } catch {
    throw new WorktreeGitError(
      "icculus worktree must be run from inside a linked git worktree, not the main checkout.",
    );
  }

  ctx.log.heading("Setting up this worktree…");

  // 2. ensure a named branch (resolve identity first for its branch base)
  const settings = await loadIdentitySettings(ctx.root);
  const id = await resolveWorktreeId(settings, ctx.cwd);
  const identity = deriveIdentity(id, settings);
  await ensureWorktreeBranch(identity.branch, ctx.cwd);

  // 3. database clone (fatal on failure)
  const clone = await runAdapter(
    ctx,
    identity,
    "Cloning the worktree database…",
    ctx.config.get("worktree.db.clone", ""),
  );
  if (!clone.ok) {
    throw new WorktreeGitError("The database clone step failed.");
  }

  // 4. dev-server link (fatal on failure)
  const link = await runAdapter(
    ctx,
    identity,
    "Linking the worktree dev server…",
    ctx.config.get("worktree.dev_server.link", ""),
  );
  if (!link.ok) {
    throw new WorktreeGitError("The dev-server link step failed.");
  }

  // 5. inherit env vars from main
  await inheritMainEnvVars({
    worktreeRoot: ctx.cwd,
    vars: ctx.config.array("worktree.inherit_env"),
    log: ctx.log,
  });

  // 6. record the deterministic port
  await recordPort(ctx, identity);

  // 7. post-create setup steps (stop on first failure)
  for (const step of ctx.config.array("worktree.setup.steps")) {
    ctx.log.info(`Setup step: ${step}`);
    const code = await runShell(step, ctx.cwd);
    if (code !== 0) {
      throw new WorktreeGitError(`Setup step failed: ${step}`);
    }
  }

  // 8. compile the agent guidelines, which also materializes skills into THIS
  // worktree's .claude/skills/. A linked worktree does NOT inherit that gitignored
  // directory from the main checkout, so it must be (re)built here. Non-fatal.
  ctx.log.info("Compiling agent guidelines…");
  try {
    await compileGuidelines(ctx.root, ctx.log);
  } catch {
    ctx.log.warn("Guideline compilation reported an error — continuing.");
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
        return { kind: "already" };
      }
    } catch {
      // sentinel absent — fall through and run setup
    }
  }
  ctx.log.warn(
    "[icculus] Worktree not configured yet; running 'icculus worktree'…",
  );
  await worktreeSetup(ctx);
  return { kind: "ran" };
}

/**
 * Tear down this worktree's database + dev-server link without graduating its
 * branch — the `worktree:teardown` recipe, used when DISCARDING a worktree.
 * Asserts the worktree precondition; both adapters are clean no-ops when unset.
 */
export async function worktreeTeardown(ctx: LifecycleContext): Promise<void> {
  try {
    await assertInWorktree("icculus worktree:teardown", ctx.cwd);
  } catch {
    throw new WorktreeGitError(
      "icculus worktree:teardown must be run from inside a linked git worktree, not the main checkout.",
    );
  }
  ctx.log.heading("Tearing down this worktree…");
  const identity = await resolveContextIdentity(ctx);
  await teardownAdapters(ctx, identity);
  ctx.log.ok("Worktree teardown complete.");
}

/**
 * Graduate this worktree's branch into the main repo — the `worktree:exit`
 * recipe. Requires the latest main is integrated, tears down the worktree's
 * external resources, WIP-commits any uncommitted changes, removes the worktree
 * directory, checks the branch out in main, then soft-resets the WIP commit so
 * those changes land staged. Refuses to touch a dirty main checkout. Throws
 * `WorktreeGitError` on any unrecoverable error (the branch keeps its commits).
 */
export async function worktreeExit(ctx: LifecycleContext): Promise<void> {
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
      "Branch is behind main. Run 'icculus finish' to integrate it (commit, git merge main, re-run), then retry.",
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

  // step 4: tear down external resources (non-fatal, while still in the worktree)
  ctx.log.info("Tearing down the worktree's database and dev-server link…");
  await teardownAdapters(ctx, identity);

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
}

/**
 * Housekeeping for the worktree pool — the `worktree:prune` recipe. Removes
 * stale worktrees and fully-merged branches, then reclaims gitlinked orphan
 * directories. Refuses to run from inside a linked worktree (pool housekeeping
 * belongs to the main checkout). Databases are deliberately NOT swept here.
 * Throws on a setup failure or a removal failure.
 */
export async function worktreePrune(
  ctx: LifecycleContext,
  opts: WorktreePruneOptions = {},
): Promise<void> {
  try {
    await assertNotInWorktree("icculus worktree:prune", ctx.cwd);
  } catch {
    throw new WorktreeGitError(
      "icculus worktree:prune must be run from the main checkout, not a linked worktree.",
    );
  }

  ctx.log.heading("Pruning worktrees and fully-merged branches…");
  const prune = await pruneGitWorktrees({
    includeDetached: true,
    mainBranch: ctx.config.get("project.main_branch", "main"),
    log: ctx.log,
  });

  ctx.log.heading("Reclaiming orphaned worktree directories…");
  const sweep = await sweepOrphanWorktrees({ log: ctx.log });

  // Point at the per-worktree DB seam, since prune intentionally leaves DBs alone.
  if (ctx.config.get("worktree.db.drop", "") !== "") {
    ctx.log.info(
      "Databases are not pruned here — drop a discarded worktree's DB from inside it with: icculus worktree:teardown",
    );
  }

  if (prune.failed || sweep.failed) {
    throw new WorktreeGitError("One or more cleanups failed.");
  }
  ctx.log.ok("Prune complete.");
  // `assumeYes` is accepted for dispatcher parity; the interactive confirmation
  // belongs to the dispatcher (which owns the TTY), so prune runs the removals
  // directly once invoked. See note in git.ts pruneGitWorktrees.
  void opts.assumeYes;
}

/**
 * Resolve a single identity field for the `worktree-name` command surface. Kept
 * here so the dispatcher can map `icculus worktree-name --<field>` to one call
 * without reaching into the identity internals. Throws `IdentityError` (carrying
 * an exit code) on a resolution failure, exactly as the shell did.
 */
export async function worktreeNameField(
  root: string,
  field: "id" | "site" | "branch" | "port" | "db",
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
  }
}

export { IdentityError, WorktreeGitError };
