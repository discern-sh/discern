/**
 * Project-root discovery and the `ICCULUS_*` environment a project recipe is
 * exec'd with.
 *
 * The binary finds the project root exactly as the old `agent` dispatcher did:
 * walk up from the cwd to the nearest ancestor holding `.icculus/config.toml`.
 * The recipe env replaces what the shell dispatcher exported, minus the engine
 * paths that no longer exist on disk (`ICCULUS_ENGINE`/`ICCULUS_LIB`) — a recipe
 * now reads config via `icculus config get`, not by sourcing a shell library.
 */

import { dirname, join } from "@std/path";

/** Relative path of the install marker the root walk looks for. */
export const CONFIG_REL = ".icculus/config.toml";

/**
 * Walk up from `start` (default: the cwd) to the nearest ancestor containing
 * `.icculus/config.toml`. Returns the project root, or undefined if none exists
 * in this directory or any parent.
 */
export async function findRoot(
  start: string = Deno.cwd(),
): Promise<string | undefined> {
  let dir = start;
  while (true) {
    try {
      if ((await Deno.stat(join(dir, CONFIG_REL))).isFile) {
        return dir;
      }
    } catch {
      // not here — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined; // reached the filesystem root without a match
    }
    dir = parent;
  }
}

/** The resolved pieces a recipe's `ICCULUS_*` environment is built from. */
export interface RecipeEnv {
  /** Absolute project root. */
  root: string;
  /** The `[recipes].dir` value as configured (relative or absolute). */
  recipesDir: string;
  /** The recipes directory resolved to an absolute path. */
  recipesAbs: string;
  /** The integration branch (`[project].main_branch`, default "main"). */
  mainBranch: string;
}

/**
 * Build the `ICCULUS_*` environment variables a project recipe is exec'd with.
 * Mirrors the subset the shell dispatcher exported that survives the refactor.
 */
export function recipeEnvVars(e: RecipeEnv): Record<string, string> {
  return {
    ICCULUS_ROOT: e.root,
    ICCULUS_TOML: join(e.root, CONFIG_REL),
    ICCULUS_RECIPES: e.recipesAbs,
    ICCULUS_RECIPES_DIR: e.recipesDir,
    MAIN_BRANCH: e.mainBranch,
  };
}
