/**
 * Locate the scaffold `templates/` tree.
 *
 * The tree is auto-discovered, never hardcoded: other agents own its contents
 * and add files over time. Resolution order:
 *   1. `ICCULUS_TEMPLATES_DIR` env override (used by tests and power users).
 *   2. a `templates/` directory found by walking up from this module's location
 *      (works under `deno run` from a checkout, and under a `deno compile`
 *      binary built with `--include templates/`).
 *
 * Walking up rather than assuming a fixed depth keeps the resolver robust if the
 * source layout shifts.
 */

import { dirname, fromFileUrl, join } from "@std/path";

/** True when `path` is an existing directory. */
async function isDir(path: string): Promise<boolean> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory;
  } catch {
    return false;
  }
}

/**
 * Resolve the absolute path to the templates tree. Throws a clear error if it
 * cannot be found, listing the override env var as the escape hatch.
 */
export async function resolveTemplatesDir(): Promise<string> {
  const override = Deno.env.get("ICCULUS_TEMPLATES_DIR");
  if (override) {
    if (await isDir(override)) {
      return override;
    }
    throw new Error(
      `ICCULUS_TEMPLATES_DIR is set to "${override}" but that is not a directory.`,
    );
  }

  // Walk up from this module's directory looking for a sibling `templates/`.
  let dir = dirname(fromFileUrl(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, "templates");
    if (await isDir(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new Error(
    "could not locate the templates/ tree. Set ICCULUS_TEMPLATES_DIR to its path.",
  );
}
