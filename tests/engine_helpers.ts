/**
 * Engine-test harness — scaffold the seed surface into a temp dir, then drive the
 * TypeScript engine through `src/main.ts` and assert on its output + exit code.
 *
 * The engine lives under `src/engine/**`, compiled into the binary. These tests
 * run it the way a real install does: `runAgent` invokes the engine via the repo's
 * `src/main.ts`, with a `discern` shim on PATH so a project recipe or hook that
 * calls `discern <verb>` resolves the same command a real install would. It reuses
 * the installer's own `assembleInitPlan`/`applyPlan` to lay down a faithful install
 * (so the engine runs exactly the bytes a real `discern init` would write), then
 * drives the verbs through the dispatcher. The suite is the engine's black-box
 * behavioral parity oracle.
 *
 * Tests that exercise scope/scope-gate/ratchet behaviour need a git repo so
 * `changed-scopes` can answer; `gitInit` makes a hermetic one (its own config,
 * no signing, a `main` branch) so a developer's global git settings can't leak
 * in. `writeConfig` overwrites the scaffolded `.discern/config.toml` (a seed file) with
 * test-specific capabilities/checks/scopes/ratchets.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { assembleInitPlan } from "../src/commands/setup.ts";
import { applyPlan } from "../src/lib/fs_plan.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import { resolveWorktreeRoot } from "../src/lib/paths.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import type { AgentName } from "../src/lib/config.ts";
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
 * repo's deno.json since the temp project has none up its tree). Exported so a
 * test that needs a long-running engine process (e.g. the MCP stdio server)
 * spawns it exactly as runAgent does. */
const REPO_ROOT = fromFileUrl(new URL("../", import.meta.url));
export const MAIN_TS = join(REPO_ROOT, "src", "main.ts");
export const DENO_JSON = join(REPO_ROOT, "deno.json");

/** Shell-quote a path for the shim script. */
function shq(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

/**
 * A lazily-created directory holding a `discern` shim that execs the TS engine
 * exactly as runAgent does. Prepended to PATH so a project recipe (`discern
 * config get …`) or a settings.json hook (`discern worktree …`) resolves the
 * command the same way a real install (binary on PATH) would.
 */
let shimDirCache: string | undefined;
async function discernShimDir(): Promise<string> {
  if (shimDirCache !== undefined) {
    return shimDirCache;
  }
  const dir = await Deno.makeTempDir({ prefix: "discern-shim-" });
  const shim = join(dir, "discern");
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
 * `discern` shim on PATH, plus any caller overrides.
 */
export async function engineEnv(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const shim = await discernShimDir();
  return {
    NO_COLOR: "1",
    PATH: `${shim}:${Deno.env.get("PATH") ?? ""}`,
    ...GIT_ISOLATION,
    ...extra,
  };
}

/**
 * Scaffold the real harness (engine, dispatcher, default `.discern/config.toml`) into
 * `dir` via the installer's own plan/apply path, so the bytes under test are the
 * bytes a real install ships. Tests usually follow with `writeConfig` to set
 * the capabilities/checks/scopes/ratchets they need.
 */
export async function scaffoldEngine(
  dir: string,
  opts: { bootstrapped?: boolean; agents?: AgentName[] } = {},
): Promise<void> {
  const plan = await assembleInitPlan({
    templatesDir: REAL_TEMPLATES,
    destDir: dir,
    config: {
      projectName: "Engine Test",
      slug: "engine-test",
      branchPrefix: "agent/",
      sourceGlobs: ["src/**"],
      brief: "",
      // Per-agent seeds are config-driven, so a test that exercises a specific
      // agent's wiring scaffolds with that agent in the set (default: Claude only).
      agents: opts.agents ?? ["claude_code"],
    },
  });
  await applyPlan(plan);
  // Engine tests exercise a *configured* harness — a project past its one-time
  // setup. Mark it set up by default so the work verbs (finish/test/…) run rather
  // than hard-redirecting to setup (ADR 0036); setup/improve tests that need the
  // un-set-up state pass `{ bootstrapped: false }`.
  if (opts.bootstrapped !== false) {
    await markBootstrapped(join(dir, "discern.toml"));
  }
}

/** Record `[meta].bootstrapped = true` in a scaffolded config (comment-preserving). */
async function markBootstrapped(configPath: string): Promise<void> {
  const editor = new TomlEditor(await Deno.readTextFile(configPath));
  editor.setBool("meta.bootstrapped", true);
  await Deno.writeTextFile(configPath, editor.toString());
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

/**
 * Like {@link runAgent}, but with stderr merged into stdout AT THE OS LEVEL (`2>&1`),
 * so the returned `stdout` is the real time-interleaved stream an agent captures with
 * `<verb> 2>&1 | …`. {@link runAgent} pipes the two streams separately and concatenates
 * them (`out + err`), which discards the interleaving — wrong for asserting what a
 * `tail`/`head` of the combined stream actually keeps.
 */
export async function runAgentMerged(
  dir: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<RunResult> {
  const inner = [
    "deno",
    "run",
    "--no-check",
    "--config",
    DENO_JSON,
    "-A",
    MAIN_TS,
    ...args,
  ]
    .map(shq)
    .join(" ");
  const command = new Deno.Command("sh", {
    args: ["-c", `${inner} 2>&1`],
    cwd: opts.cwd ?? dir,
    env: await engineEnv(opts.env),
    stdout: "piped",
    stderr: "null",
  });
  const { code, stdout } = await command.output();
  const out = DECODER.decode(stdout);
  return { code, stdout: out, stderr: "", output: out };
}

/**
 * Overwrite the scaffolded root `discern.toml` (a seed file) with test content.
 * Keeps the install "set up" (so work verbs run, not redirect — ADR 0036) unless
 * the test config explicitly mentions `bootstrapped` (its own opt-out).
 */
export async function writeConfig(dir: string, toml: string): Promise<void> {
  const path = join(dir, "discern.toml");
  await Deno.writeTextFile(path, toml);
  if (!toml.includes("bootstrapped")) {
    await markBootstrapped(path);
  }
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
 * Like {@link git}, but captures and returns trimmed stdout — for tests that read
 * git state (the current branch, whether a ref still exists). Throws on failure.
 */
export async function gitOut(dir: string, ...args: string[]): Promise<string> {
  const c = new Deno.Command("git", {
    args,
    cwd: dir,
    env: GIT_ISOLATION,
    stdout: "piped",
    stderr: "piped",
  });
  const { success, stdout, stderr } = await c.output();
  if (!success) {
    throw new Error(`git ${args.join(" ")} failed: ${DECODER.decode(stderr)}`);
  }
  return DECODER.decode(stdout).trim();
}

/**
 * The DEFAULT worktree path for `name` under `mainDir` — what the create hook
 * resolves with an unset `[worktree].root`: a sibling of the repo
 * (`<mainDir>.worktrees/<name>`). Computed through the production
 * {@link resolveWorktreeRoot}, so the tests' notion of "where a worktree lands"
 * can never drift from the engine's. The single place that knows the default.
 */
export function worktreePath(mainDir: string, name: string): string {
  return join(resolveWorktreeRoot(mainDir, parseConfigOrThrow("")), name);
}

/**
 * Create a linked git worktree for `name` at the default placement
 * ({@link worktreePath} — a SIBLING of `mainDir`, `<mainDir>.worktrees/<name>`)
 * on a new branch `agent/<name>`. Placing it outside the repo keeps the main
 * checkout clean (a nested checkout shows as untracked and would block
 * graduation) with no reliance on any agent-specific gitignored path. `mainDir`
 * must already be a git repo (call `gitInit` first). Returns the worktree's
 * absolute path, ready to drive with `runAgent(path, …)`.
 */
export async function addWorktree(
  mainDir: string,
  name: string,
): Promise<string> {
  const worktree = worktreePath(mainDir, name);
  await git(mainDir, "worktree", "add", worktree, "-b", `agent/${name}`);
  return worktree;
}
