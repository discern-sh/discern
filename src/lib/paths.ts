/**
 * Path resolution for a discern install and the bundled `templates/` tree.
 *
 * The whole footprint in a project is a single root file, `discern.toml` (ADR
 * 0020). Everything else a project opts into — guidance prose, authored skills,
 * recipes — lives at a config-pointed location with a sensible discoverable
 * default, read only when present. This module owns those defaults and resolvers,
 * plus the install-config locator and the `templates/` discovery.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { expandGlob } from "@std/fs";
import {
  CONFIG_REL,
  installedConfigRel,
  LEGACY_CONFIG_REL,
} from "../shared/env.ts";
import type { Config } from "../shared/config_read.ts";

// Re-export the install markers so installer-side callers can import them from
// the lib layer (the canonical definitions live in the shared env module).
export { CONFIG_REL, LEGACY_CONFIG_REL };

/** Default authored-skills directory (`[skills].dir`), relative to the root. */
export const DEFAULT_SKILLS_DIR = "skills";

/** Default recipes directory (`[recipes].dir`), relative to the root. */
export const DEFAULT_RECIPES_DIR = "recipes";

/** Default guidance source globs (`[guidance].sources`), relative to the root. */
export const DEFAULT_GUIDANCE_SOURCES: readonly string[] = ["guidance.md"];

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
 * Resolve the config file inside an install directory: the root `discern.toml`
 * if present, else a legacy `.discern/config.toml`, else `undefined` when
 * `destDir` is not a discern install. The new path is preferred so a migrated
 * install is unambiguous; the legacy fallback is what lets `upgrade`/`migrate`
 * recognise a pre-6 install and carry it forward.
 */
export async function resolveConfigPath(
  destDir: string,
): Promise<string | undefined> {
  const rel = await installedConfigRel(destDir);
  return rel === undefined ? undefined : join(destDir, rel);
}

/** A directory referenced by config: the configured value (relative or absolute)
 * and its absolute resolution. */
export interface ResolvedDir {
  /** The configured value, verbatim (relative or absolute). */
  rel: string;
  /** The directory resolved to an absolute path. */
  abs: string;
}

/** Resolve a relative-or-absolute configured dir against `root`. */
function resolveDir(root: string, value: string): ResolvedDir {
  return { rel: value, abs: value.startsWith("/") ? value : join(root, value) };
}

/**
 * The authored-skills directory: `[skills].dir`, default `./skills`. Read only
 * when present by the caller — the default lets a `skills/` dir be picked up with
 * zero config, and points elsewhere when configured.
 */
export function resolveSkillsDir(root: string, config: Config): ResolvedDir {
  return resolveDir(root, config.get("skills.dir", DEFAULT_SKILLS_DIR));
}

/**
 * The project recipes directory: `[recipes].dir`, default `./recipes`. The
 * default works with no config; point it elsewhere (e.g. `tools/`) if preferred.
 */
export function resolveRecipesDir(root: string, config: Config): ResolvedDir {
  return resolveDir(root, config.get("recipes.dir", DEFAULT_RECIPES_DIR));
}

/**
 * Expand `[guidance].sources` (default `["guidance.md"]`) into the matched source
 * files under `root`, present-only: a pattern that matches nothing simply
 * contributes nothing. Globs are supported. Results are de-duplicated and sorted
 * for a stable concatenation order regardless of match order.
 */
export async function resolveGuidanceSources(
  root: string,
  config: Config,
): Promise<string[]> {
  const configured = config.array("guidance.sources");
  const patterns = configured.length > 0
    ? configured
    : [...DEFAULT_GUIDANCE_SOURCES];
  const matched = new Set<string>();
  for (const pattern of patterns) {
    // Absolute patterns are honoured as-is; relative ones resolve against root.
    const glob = pattern.startsWith("/") ? pattern : join(root, pattern);
    for await (const entry of expandGlob(glob, { includeDirs: false })) {
      if (entry.isFile) {
        matched.add(entry.path);
      }
    }
  }
  return [...matched].sort();
}

/** The bundled-skills directory inside the resolved `templates/` tree. */
export async function resolveBundledSkillsDir(): Promise<string> {
  return join(await resolveTemplatesDir(), "skills");
}

/**
 * Resolve the absolute path to the templates tree. Throws a clear error if it
 * cannot be found, listing the override env var as the escape hatch.
 *
 * The tree is auto-discovered, never hardcoded: other agents own its contents
 * and add files over time. Resolution order:
 *   1. `DISCERN_TEMPLATES_DIR` env override (used by tests and power users).
 *   2. a `templates/` directory found by walking up from this module's location
 *      (works under `deno run` from a checkout, and under a `deno compile`
 *      binary built with `--include templates/`).
 */
export async function resolveTemplatesDir(): Promise<string> {
  const override = Deno.env.get("DISCERN_TEMPLATES_DIR");
  if (override) {
    if (await isDir(override)) {
      return override;
    }
    throw new Error(
      `DISCERN_TEMPLATES_DIR is set to "${override}" but that is not a directory.`,
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
    "could not locate the templates/ tree. Set DISCERN_TEMPLATES_DIR to its path.",
  );
}
