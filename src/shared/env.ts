/**
 * Project-root discovery and the `DISCERN_*` environment a project script is
 * exec'd with.
 *
 * The whole discern footprint in a project is a single root file: `discern.toml`
 * (ADR 0020 dissolved the hidden `.discern/` namespace). The binary finds the
 * project root by walking up from the cwd to the nearest ancestor holding that
 * file. The pre-6 consolidated location (`.discern/config.toml`) is still
 * recognised as a legacy marker so a not-yet-upgraded install is found and
 * carried forward by `upgrade`.
 *
 * A project script is handed the `DISCERN_*` variables and reads config via `discern
 * config get` rather than sourcing shell helpers; no engine paths
 * (`DISCERN_ENGINE`/`DISCERN_LIB`) are exported, because the engine lives in the
 * binary, not on disk.
 */

import { dirname, join } from "@std/path";

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

/** Relative path of the install marker the root walk looks for (the dissolved
 * single-file footprint). */
export const CONFIG_REL = "discern.toml";

/** The canonical refusal when root discovery cannot find a discern project. */
export const NO_PROJECT_MESSAGE =
  "Discern could not find a project: this directory and its parents have no discern.toml. " +
  "Run `discern setup` to create one here, or move into an existing discern project.";

/** The pre-6 consolidated location, still recognised as a legacy/migration-source
 * marker so a not-yet-upgraded install is found and carried forward. */
export const LEGACY_CONFIG_REL = ".discern/config.toml";

/** The install markers in precedence order — the new single-file footprint first,
 * the legacy `.discern/` location second. */
export const CONFIG_MARKERS: readonly string[] = [
  CONFIG_REL,
  LEGACY_CONFIG_REL,
];

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
 * discern install — one holding a root `discern.toml` (or, for a not-yet-upgraded
 * install, a legacy `.discern/config.toml`). Returns the project root, or
 * undefined if none exists in this directory or any parent.
 */
export async function findRoot(
  start: string = Deno.cwd(),
): Promise<string | undefined> {
  let dir = start;
  while (true) {
    for (const rel of CONFIG_MARKERS) {
      if (await isFile(join(dir, rel))) {
        return dir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined; // reached the filesystem root without a match
    }
    dir = parent;
  }
}

/**
 * The relative path of the config file present under `root` — the new
 * `discern.toml` if present, else the legacy `.discern/config.toml`, else
 * undefined when `root` is not a discern install. The new path is preferred so a
 * migrated install is unambiguous; the legacy fallback is what lets the engine,
 * `upgrade`, and `upgrade` keep working in a pre-6 install.
 */
export async function installedConfigRel(
  root: string,
): Promise<string | undefined> {
  for (const rel of CONFIG_MARKERS) {
    if (await isFile(join(root, rel))) {
      return rel;
    }
  }
  return undefined;
}

/** The resolved pieces a project script's `DISCERN_*` environment is built from. */
export interface ScriptEnv {
  /** Absolute project root. */
  root: string;
  /** Absolute path to the install config (resolved: `discern.toml` or legacy). */
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
    DISCERN_ROOT: e.root,
    DISCERN_TOML: e.tomlPath,
    DISCERN_SCRIPTS: e.scriptsAbs,
    DISCERN_SCRIPTS_DIR: e.scriptsDir,
    DISCERN_MAIN_BRANCH: e.mainBranch,
  };
}
