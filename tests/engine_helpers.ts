/**
 * Engine-test harness — scaffold the seed surface into a temp dir, then drive the
 * TypeScript engine through `src/main.ts` and assert on its output + exit code.
 *
 * The engine lives under `src/engine/**`, compiled into the binary. These tests
 * run it the way a real install does: `runAgent` invokes the engine via the repo's
 * `src/main.ts`, with an `icculus` shim on PATH so a project recipe or hook that
 * calls `icculus <verb>` resolves the same command a real install would. It reuses
 * the installer's own `assembleInitPlan`/`applyPlan` to lay down a faithful install
 * (so the engine runs exactly the bytes a real `icculus init` would write), then
 * drives the verbs through the dispatcher. The suite is the engine's black-box
 * behavioral parity oracle.
 *
 * Tests that exercise scope/scope-gate/ratchet behaviour need a git repo so
 * `changed-scopes` can answer; `gitInit` makes a hermetic one (its own config,
 * no signing, a `main` branch) so a developer's global git settings can't leak
 * in. `writeConfig` overwrites the scaffolded `.icculus/config.toml` (a seed file) with
 * test-specific capabilities/checks/scopes/ratchets.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { assembleInitPlan } from "../src/commands/init.ts";
import { applyPlan } from "../src/lib/fs_plan.ts";
import { REAL_TEMPLATES } from "./helpers.ts";

/** The captured result of one `agent` invocation. */
export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr concatenated — convenient for "appears somewhere" asserts. */
  output: string;
}

const DECODER = new TextDecoder();

/** Git env that isolates a temp repo from the developer's global/system config. */
const GIT_ISOLATION: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
};

/** Repo paths for driving the TS engine (its import map must be pointed at the
 * repo's deno.json since the temp project has none up its tree). */
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
const MAIN_TS = join(REPO_ROOT, "src", "main.ts");
const DENO_JSON = join(REPO_ROOT, "deno.json");

/** Shell-quote a path for the shim script. */
function shq(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

/**
 * A lazily-created directory holding an `icculus` shim that execs the TS engine
 * exactly as runAgent does. Prepended to PATH so a project recipe (`icculus
 * config get …`) or a settings.json hook (`icculus worktree …`) resolves the
 * command the same way a real install (binary on PATH) would.
 */
let shimDirCache: string | undefined;
async function icculusShimDir(): Promise<string> {
  if (shimDirCache !== undefined) {
    return shimDirCache;
  }
  const dir = await Deno.makeTempDir({ prefix: "icculus-shim-" });
  const shim = join(dir, "icculus");
  await Deno.writeTextFile(
    shim,
    `#!/usr/bin/env sh\nexec deno run --no-check --config ${
      shq(DENO_JSON)
    } -A ${shq(MAIN_TS)} "$@"\n`,
  );
  await Deno.chmod(shim, 0o755);
  shimDirCache = dir;
  return dir;
}

/**
 * Build the environment for an engine subprocess: colour off, git isolated, the
 * `icculus` shim on PATH, plus any caller overrides.
 */
export async function engineEnv(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const shim = await icculusShimDir();
  return {
    NO_COLOR: "1",
    PATH: `${shim}:${Deno.env.get("PATH") ?? ""}`,
    ...GIT_ISOLATION,
    ...extra,
  };
}

/**
 * Scaffold the real harness (engine, dispatcher, default `.icculus/config.toml`) into
 * `dir` via the installer's own plan/apply path, so the bytes under test are the
 * bytes a real install ships. Tests usually follow with `writeConfig` to set
 * the capabilities/checks/scopes/ratchets they need.
 */
export async function scaffoldEngine(dir: string): Promise<void> {
  const plan = await assembleInitPlan({
    templatesDir: REAL_TEMPLATES,
    destDir: dir,
    config: {
      projectName: "Engine Test",
      slug: "engine-test",
      branchPrefix: "agent/",
      sourceGlobs: ["src/**"],
      brief: "",
      agents: ["claude_code"],
    },
  });
  await applyPlan(plan);
}

/**
 * Run `agent <args>` inside `dir`. Colour is forced off so assertions match
 * plain text, and git is isolated so recipes that shell out to git are hermetic.
 * `opts.cwd` runs from a subdirectory (to exercise root-finding); `opts.env`
 * adds/overrides environment variables.
 */
export async function runAgent(
  dir: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<RunResult> {
  const command = new Deno.Command("deno", {
    args: ["run", "--no-check", "--config", DENO_JSON, "-A", MAIN_TS, ...args],
    cwd: opts.cwd ?? dir,
    env: await engineEnv(opts.env),
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await command.output();
  const out = DECODER.decode(stdout);
  const err = DECODER.decode(stderr);
  return { code, stdout: out, stderr: err, output: out + err };
}

/** Overwrite the scaffolded root `icculus.toml` (a seed file) with test content. */
export async function writeConfig(dir: string, toml: string): Promise<void> {
  await Deno.writeTextFile(join(dir, "icculus.toml"), toml);
}

/** Write an executable file (e.g. a project recipe or a capability command). */
export async function writeExecutable(
  path: string,
  contents: string,
): Promise<void> {
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, contents);
  await Deno.chmod(path, 0o755);
}

/**
 * Initialise a hermetic git repo in `dir` with one commit on a `main` branch.
 * Uses repo-local identity and disables signing so it works regardless of the
 * developer's global git configuration.
 */
export async function gitInit(dir: string): Promise<void> {
  const git = async (...args: string[]) => {
    const c = new Deno.Command("git", {
      args,
      cwd: dir,
      env: GIT_ISOLATION,
      stdout: "null",
      stderr: "piped",
    });
    const { success, stderr } = await c.output();
    if (!success) {
      throw new Error(
        `git ${args.join(" ")} failed: ${DECODER.decode(stderr)}`,
      );
    }
  };
  await git("init", "-q");
  await git("config", "user.email", "engine-test@example.com");
  await git("config", "user.name", "Engine Test");
  await git("config", "commit.gpgsign", "false");
  await git("add", "-A");
  await git("commit", "-q", "-m", "scaffold", "--no-gpg-sign");
  // Normalise the branch name to `main` (the engine's default integration
  // branch) regardless of the local git's init.defaultBranch.
  await git("branch", "-M", "main");
}

/**
 * Run a git command in `dir` (hermetic env). Returns nothing; throws on failure.
 * For tests that need to commit a baseline, branch, or stage extra files.
 */
export async function git(dir: string, ...args: string[]): Promise<void> {
  const c = new Deno.Command("git", {
    args,
    cwd: dir,
    env: GIT_ISOLATION,
    stdout: "null",
    stderr: "piped",
  });
  const { success, stderr } = await c.output();
  if (!success) {
    throw new Error(`git ${args.join(" ")} failed: ${DECODER.decode(stderr)}`);
  }
}

/**
 * Create a linked git worktree at `<mainDir>/.claude/worktrees/<name>` on a new
 * branch `agent/<name>` — the layout the worktree-* recipes expect. `mainDir`
 * must already be a git repo (call `gitInit` first). Returns the worktree's
 * absolute path, ready to drive with `runAgent(worktreePath, …)`.
 */
export async function addWorktree(
  mainDir: string,
  name: string,
): Promise<string> {
  const worktree = join(mainDir, ".claude", "worktrees", name);
  await git(mainDir, "worktree", "add", worktree, "-b", `agent/${name}`);
  return worktree;
}
