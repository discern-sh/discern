/**
 * Engine-test harness — scaffold the seed surface into a temp dir, then drive the
 * TypeScript engine through `src/main.ts` and assert on its output + exit code.
 *
 * The engine lives under `src/engine/**`, compiled into the binary. These tests
 * run it the way a real install does: `runAgent` invokes the engine via the repo's
 * `src/main.ts`, with a `discern` shim on PATH so a project script or hook that
 * calls `discern <verb>` resolves the same command a real install would. It reuses
 * the installer's own `assembleInitPlan`/`applyPlan` to lay down a faithful install
 * (so the engine runs exactly the bytes a real `discern setup` would write), then
 * drives the verbs through the dispatcher. The suite is the engine's black-box
 * behavioral parity oracle.
 *
 * Tests that exercise scope/scope-gate/standard behaviour need a git repo so
 * `scopes` can answer; `gitInit` makes a hermetic one (its own config,
 * no signing, a `main` branch) so a developer's global git settings can't leak
 * in. `writeConfig` overwrites the scaffolded `discern.toml` seed with
 * test-specific capabilities/checks/scopes/standards.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { ensureDir } from "@std/fs";
import { assembleInitPlan } from "../src/commands/setup.ts";
import { applyPlan } from "../src/lib/fs_plan.ts";
import { TomlEditor } from "../src/lib/toml_edit.ts";
import { TomlFormatError, writeDiscernToml } from "../src/lib/tidy_format.ts";
import { resolveWorktreeRoot } from "../src/lib/paths.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
  type SourcePathName,
} from "../src/shared/paths_registry.ts";
import type { AgentName } from "../src/lib/config.ts";
import { selfShimDir } from "../src/shared/self_shim.ts";
import { DESK_SESSION_ENV } from "../src/engine/desk/session.ts";
import { TEST_RUN_SLOT_ENV } from "../src/engine/test_run_slots.ts";
import { EXPERIMENTAL_ENVIRONMENT_VARIABLES } from "../src/shared/experimental.ts";
import { DISCERN_NO_ATTRIBUTION } from "../src/shared/env.ts";
import { fakeEnv, REAL_TEMPLATES } from "./helpers.ts";

/**
 * Map `items` through `fn` with at most `limit` in flight — the bounded
 * fan-out for sweep guards whose cases are independent (each case driving its
 * own scaffold, or read-only runs against a shared one). Results keep item
 * order. On a failure the pool stops claiming new items, lets the in-flight
 * cases settle (so no dangling ops trip the test sanitizers), then rethrows
 * the first error.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const errors: unknown[] = [];
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length && errors.length === 0) {
        const i = next++;
        try {
          results[i] = await fn(items[i] as T, i);
        } catch (e) {
          errors.push(e);
        }
      }
    },
  );
  await Promise.all(workers);
  if (errors.length > 0) {
    throw errors[0];
  }
  return results;
}

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

/** One path inside the fresh map default, derived from the path registry. */
export function defaultMapPath(root: string, ...parts: string[]): string {
  return join(root, SOURCE_PATHS.map.defaultPath, ...parts);
}

let suiteTempPromise: Promise<string> | undefined;

/**
 * The suite-scoped temp home injected as every spawned engine's TMPDIR: job
 * and diagnostic artifacts, fallback shims — everything the engines mint in
 * "OS temp" — land here instead of the shared temp dir, so parallel suites
 * neither pollute the machine nor scan each other's litter, and a scaffolded
 * project's due retention sweep walks this small directory rather than the
 * machine-wide population (ADR 0249). One home per test module instance,
 * removed on process unload; a process killed too hard to unload leaves a
 * `discern-test-` entry the engine's own reaper collects by age — the prefix
 * is a registered temp-artifact directory family, so no scan of the shared
 * temp dir ever runs from the harness itself.
 */
export function suiteTempDir(): Promise<string> {
  suiteTempPromise ??= (async (): Promise<string> => {
    const dir = await Deno.makeTempDir({ prefix: "discern-test-tmp-" });
    globalThis.addEventListener("unload", () => {
      try {
        Deno.removeSync(dir, { recursive: true });
      } catch {
        // Best-effort: the artifact reaper collects what unload cannot.
      }
    });
    return dir;
  })();
  return suiteTempPromise;
}

/** Shell-quote a path for a command string handed to a PTY shell. */
function shq(s: string): string {
  return `'${s.replaceAll("'", "'\\''")}'`;
}

/**
 * Build the environment for an engine subprocess: colour off, git isolated,
 * TMPDIR pointed at the suite temp home ({@link suiteTempDir}), the engine's
 * own `discern` self-shim on PATH, plus any caller overrides.
 * The shim (src/shared/self_shim.ts) is the same one the engine gives its
 * operator commands — this suite runs from the same checkout, so consuming it
 * keeps one definition of "re-invoke this engine" — and it lets a project script
 * (`discern config get …`) or a settings.json hook (`discern worktree …`)
 * spawned by a TEST resolve the command the way a real install (binary on
 * PATH) would. The desk's session marker
 * is designed to be inherited by every descendant process, so a suite launched
 * from inside `discern desk` would leak it into every spawned engine. The same
 * applies to a suite admitted through `discern queue`: each scaffolded fixture
 * models a separate invocation and must make its own slot decision. Blanking
 * both markers here keeps the suite deterministic; a test that needs either
 * marker sets it via `extra`.
 */
export async function engineEnv(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const shim = await selfShimDir(REPO_ROOT);
  const tmp = await suiteTempDir();
  return {
    NO_COLOR: "1",
    // FORCE_COLOR flips Deno.noColor false even when NO_COLOR is set; empty
    // means unset, so an inherited value can't recolour spawned output.
    FORCE_COLOR: "",
    PATH: `${shim}:${Deno.env.get("PATH") ?? ""}`,
    // All three spellings so the engine's temp resolution lands in the suite
    // home on every platform.
    TMPDIR: tmp,
    TMP: tmp,
    TEMP: tmp,
    [DESK_SESSION_ENV]: "",
    [TEST_RUN_SLOT_ENV]: "",
    [DISCERN_NO_ATTRIBUTION]: "",
    ...Object.fromEntries(
      Object.values(EXPERIMENTAL_ENVIRONMENT_VARIABLES).map((name) => [
        name,
        "",
      ]),
    ),
    ...GIT_ISOLATION,
    ...extra,
  };
}

/**
 * Scaffold the real harness into `dir` via the installer's own plan/apply path,
 * so the bytes under test are the bytes a real install ships. Tests usually
 * follow with `writeConfig` to set the capabilities/checks/scopes/standards they
 * need.
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
    env: fakeEnv(),
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

/** One keyed registry path repointed at a non-default location. */
export interface RepointedPath {
  name: SourcePathName;
  /** The dotted config key (e.g. `map.dir`). */
  key: string;
  /** The non-default value the key is pointed at. */
  value: string;
}

/**
 * A fully NON-DEFAULT source-path layout, derived from the paths registry so a
 * newly registered path auto-enrols (ADR 0102): every keyed entry pointed at a
 * `zz-alt-…` location shaped like its default (trailing slash / extension
 * preserved so resolution behaves identically). A keyless entry (the brief)
 * has nothing to repoint.
 */
export function nonDefaultPaths(): RepointedPath[] {
  const out: RepointedPath[] = [];
  for (const name of SOURCE_PATH_NAMES) {
    const { key, defaultPath } = SOURCE_PATHS[name];
    if (key === null) {
      continue;
    }
    const dot = defaultPath.lastIndexOf(".");
    const directoryCandidate = `zz-alt-${name}/`;
    const value = defaultPath.endsWith("/")
      ? directoryCandidate.includes(defaultPath)
        ? "zz-alt-location/"
        : directoryCandidate
      : dot === -1
      ? `zz-alt-${name}`
      : `zz-alt-${name}${defaultPath.slice(dot)}`;
    out.push({ name, key, value });
  }
  return out;
}

/**
 * Repoint every keyed registry source path in a scaffolded `discern.toml` at
 * the {@link nonDefaultPaths} layout (comment-preserving) — the
 * paths-parameterized variant of the engine scaffold. `guidance.sources` is
 * the one list-typed key; a future list-typed entry fails the config parse
 * loudly, telling its author to teach this helper the shape.
 */
export async function repointSourcePaths(
  dir: string,
): Promise<RepointedPath[]> {
  const path = join(dir, "discern.toml");
  const editor = new TomlEditor(await Deno.readTextFile(path));
  const repointed = nonDefaultPaths();
  for (const { key, value } of repointed) {
    if (key === "guidance.sources") {
      editor.setStringArray(key, [value]);
    } else {
      editor.setString(key, value);
    }
  }
  await writeDiscernToml(path, editor.toString());
  return repointed;
}

/**
 * Write config text the way production does — through the canonical formatter,
 * so it lands depth-indented and a later gate run inside the test finds nothing
 * to reformat. Unparseable TOML (a test exercising the parse-failure path) is
 * written verbatim: the broken bytes ARE the fixture.
 */
async function writeConfigText(path: string, text: string): Promise<void> {
  try {
    await writeDiscernToml(path, text);
  } catch (error) {
    if (!(error instanceof TomlFormatError)) {
      throw error;
    }
    await Deno.writeTextFile(path, text);
  }
}

/** Record `[meta].bootstrapped = true` in a scaffolded config (comment-preserving,
 * through the canonical writer production uses). */
async function markBootstrapped(configPath: string): Promise<void> {
  const editor = new TomlEditor(await Deno.readTextFile(configPath));
  editor.setBool("meta.bootstrapped", true);
  await writeConfigText(configPath, editor.toString());
}

/**
 * Run `agent <args>` inside `dir`. Colour is forced off so assertions match
 * plain text, and git is isolated so project scripts that shell out to git are hermetic.
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
 * Run the real engine with stdin/stdout attached to a pseudo-terminal. `script`
 * is the system PTY driver on the Unix platforms discern supports; the two
 * argument forms account for BSD (macOS) and util-linux. This is the black-box
 * seam for proving terminal-only dispatch without teaching production code a
 * fake TTY switch.
 */
export async function runAgentPty(
  dir: string,
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<RunResult> {
  if (Deno.build.os === "windows") {
    throw new Error("runAgentPty requires the Unix script(1) utility");
  }
  const command = [
    Deno.execPath(),
    "run",
    "--no-check",
    "--config",
    DENO_JSON,
    "-A",
    MAIN_TS,
    ...args,
  ];
  const scriptArgs = Deno.build.os === "darwin"
    ? ["-q", "/dev/null", ...command]
    : ["-q", "-e", "-c", command.map(shq).join(" "), "/dev/null"];
  const child = new Deno.Command("script", {
    args: scriptArgs,
    cwd: dir,
    env: await engineEnv(opts.env),
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  });
  const process = child.spawn();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      process.kill("SIGTERM");
    } catch {
      // It finished between the timer firing and kill reaching the process.
    }
  }, opts.timeoutMs ?? 5_000);
  const { code, stdout, stderr } = await process.output();
  clearTimeout(timer);
  const out = DECODER.decode(stdout);
  const err = DECODER.decode(stderr);
  if (timedOut) {
    throw new Error(
      `pseudo-TTY command did not terminate within ${
        opts.timeoutMs ?? 5_000
      }ms: discern ${args.join(" ")}\n${out}${err}`,
    );
  }
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
 *
 * Writes through {@link writeConfigText}, so a test's flush-left inline TOML
 * lands on disk in the same depth-indented form a real install carries.
 */
export async function writeConfig(dir: string, toml: string): Promise<void> {
  const path = join(dir, "discern.toml");
  await writeConfigText(path, toml);
  if (!toml.includes("bootstrapped")) {
    await markBootstrapped(path);
  }
}

/** Write an executable file (e.g. a project script or a capability command). */
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
  // `-b main` pins the branch name (the engine's default integration branch)
  // regardless of the local git's init.defaultBranch.
  await git("init", "-q", "-b", "main");
  // Repo-local identity and signing-off, appended straight into .git/config:
  // identity must live in CONFIG (not GIT_AUTHOR_*/GIT_COMMITTER_* env) because
  // the engine's own identity probe reads `git config user.name`/`user.email`
  // and must resolve in every scaffolded repo. A fresh `git init` always makes
  // `.git` a directory, so the config path is stable. Appending the section is
  // equivalent to three `git config` calls, without three subprocesses — this
  // helper runs hundreds of times per suite run.
  await Deno.writeTextFile(
    join(dir, ".git", "config"),
    "[user]\n\tname = Engine Test\n\temail = engine-test@example.com\n" +
      "[commit]\n\tgpgsign = false\n",
    { append: true },
  );
  await git("add", "-A");
  await git("commit", "-q", "-m", "scaffold", "--no-gpg-sign");
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

/** Parse one commit message through git's own trailer grammar. */
export async function parsedCommitTrailers(
  dir: string,
  rev = "HEAD",
): Promise<string> {
  const message = await gitOut(dir, "show", "-s", "--format=%B", rev);
  const path = await Deno.makeTempFile({
    prefix: "discern-commit-message-",
  });
  try {
    await Deno.writeTextFile(path, `${message}\n`);
    return await gitOut(dir, "interpret-trailers", "--parse", path);
  } finally {
    await Deno.remove(path).catch(() => {});
  }
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
 * acceptance) with no reliance on any agent-specific gitignored path. `mainDir`
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
