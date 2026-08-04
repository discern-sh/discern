/**
 * Project-root discovery and the `DISCERN_*` environment a project script is
 * exec'd with.
 *
 * The whole discern footprint in a project is a single root file: `discern.toml`
 * (ADR 0020 dissolved the hidden `.discern/` namespace). The binary finds the
 * project root by walking up from the cwd to the nearest ancestor holding that
 * file.
 *
 * A project script is handed the `DISCERN_*` variables and reads config via `discern
 * config get` rather than sourcing shell helpers; no engine paths
 * (`DISCERN_ENGINE`/`DISCERN_LIB`) are exported, because the engine lives in the
 * binary, not on disk.
 */

import { dirname, join, SEPARATOR } from "@std/path";
import { DISCERN_ENVIRONMENT_VARIABLES } from "./environment_variables.ts";
import type { DiscernResult } from "./result.ts";

/**
 * A read-only view over environment variables — the seam a caller passes so it
 * can supply env values explicitly instead of reading the real process env.
 * Mutating `Deno.env` is process-global and leaks across test files running
 * concurrently under `deno test --parallel`; every function that consults an env
 * override therefore accepts one of these, defaulting to `Deno.env` (which
 * satisfies the shape), so a test injects a fake and never touches the process.
 */
export interface EnvReader {
  get(key: string): string | undefined;
}

/** Suppress discern's co-author trailer when set to a non-empty value. */
export const DISCERN_NO_ATTRIBUTION =
  DISCERN_ENVIRONMENT_VARIABLES.noAttribution;

/** Whether discern-authored commits carry the co-author trailer. */
export function discernCommitAttributionEnabled(
  env: EnvReader = Deno.env,
): boolean {
  const value = env.get(DISCERN_NO_ATTRIBUTION);
  return value === undefined || value === "";
}

/** Relative path of the install marker the root walk looks for (the dissolved
 * single-file footprint). */
export const CONFIG_REL = "discern.toml";

/** The canonical refusal when root discovery cannot find a discern project. */
export const NO_PROJECT_MESSAGE =
  "Discern could not find a project: this directory and its parents have no discern.toml. " +
  "Run `discern setup` to create one here, or move into an existing discern project.";

/** The machine slug a `--json` consumer branches on when root discovery fails. */
export const NOT_INITIALIZED = "not_initialized";

/**
 * The uniform not-initialized refusal envelope — the ONE constructor behind
 * every surface's "no discern project here" result (the CLI's `requireRoot`,
 * `status`, the MCP server's per-tool guard, and the installer verbs), so the
 * slug and shape cannot drift between emitters. A verb with tailored recovery
 * advice passes its own `message`; the default is the canonical discovery
 * refusal.
 */
export function notInitializedResult(
  verb: string,
  message: string = NO_PROJECT_MESSAGE,
): DiscernResult<never> {
  return { ok: false, verb, error: NOT_INITIALIZED, message };
}

/** True when a regular file exists at `path`. */
async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/**
 * Walk up from `start` (default: the cwd) to the nearest ancestor that is an
 * discern install — one holding a root `discern.toml`. Returns the project
 * root, or undefined if none exists in this directory or any parent.
 */
export async function findRoot(
  start: string = Deno.cwd(),
): Promise<string | undefined> {
  let dir = start;
  while (true) {
    if (await isFile(join(dir, CONFIG_REL))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined; // reached the filesystem root without a match
    }
    dir = parent;
  }
}

/** True when any directory entry (file or directory) exists at `path` — `.git`
 * is a directory in an ordinary checkout but a file in a linked worktree or a
 * submodule checkout, so a file-only probe would miss half the repositories. */
async function hasEntry(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The directories strictly below `root` on the walk from `start` up to `root`
 * that are git repositories of their own (holding a `.git` entry). {@link findRoot}
 * walks past such a directory whenever it holds no config marker, so `start`
 * sits inside a NESTED repository while the nearest `discern.toml` belongs to
 * an outer one — the crossing `doctor` discloses. (ADR 0115 records the
 * complementary shape: a root BELOW its own repo's toplevel.) Both paths are
 * realpath-normalized before comparison; returns [] when `start` does not sit
 * under `root`, because then the discovery walk crossed nothing on this path.
 */
export async function crossedRepoBoundaries(
  start: string,
  root: string,
): Promise<string[]> {
  const real = (p: string): Promise<string | undefined> =>
    Deno.realPath(p).catch(() => undefined);
  const s = await real(start);
  const r = await real(root);
  if (s === undefined || r === undefined || s === r) return [];
  if (!s.startsWith(r + SEPARATOR)) return [];
  const crossed: string[] = [];
  let dir = s;
  while (dir !== r) {
    if (await hasEntry(join(dir, ".git"))) crossed.push(dir);
    dir = dirname(dir);
  }
  return crossed;
}

/**
 * The relative path of the config file present under `root`, or undefined when
 * `root` is not a discern install.
 */
export async function installedConfigRel(
  root: string,
): Promise<string | undefined> {
  return await isFile(join(root, CONFIG_REL)) ? CONFIG_REL : undefined;
}

/** The resolved pieces a project script's `DISCERN_*` environment is built from. */
export interface ScriptEnv {
  /** Absolute project root. */
  root: string;
  /** Absolute path to the install config. */
  tomlPath: string;
  /** The `[scripts].dir` value as configured (relative or absolute). */
  scriptsDir: string;
  /** The project scripts directory resolved to an absolute path. */
  scriptsAbs: string;
  /** The integration branch (`[repository].trunk`, default "main"). */
  mainBranch: string;
}

/**
 * Build the `DISCERN_*` environment variables a project script is exec'd with.
 */
export function scriptEnvVars(e: ScriptEnv): Record<string, string> {
  return {
    [DISCERN_ENVIRONMENT_VARIABLES.root]: e.root,
    [DISCERN_ENVIRONMENT_VARIABLES.toml]: e.tomlPath,
    [DISCERN_ENVIRONMENT_VARIABLES.scripts]: e.scriptsAbs,
    [DISCERN_ENVIRONMENT_VARIABLES.scriptsDirectory]: e.scriptsDir,
    [DISCERN_ENVIRONMENT_VARIABLES.trunk]: e.mainBranch,
  };
}
