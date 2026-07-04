/**
 * Path resolution for a discern install and the bundled `templates/` tree.
 *
 * The whole footprint in a project is a single root file, `discern.toml` (ADR
 * 0020). Everything else a project opts into — guidance prose, authored skills,
 * recipes — lives at a config-pointed location with a sensible discoverable
 * default, read only when present. This module owns those defaults and resolvers,
 * plus the install-config locator and the `templates/` discovery.
 */

import { basename, dirname, fromFileUrl, join } from "@std/path";
import { expandGlob } from "@std/fs";
import {
  CONFIG_REL,
  type EnvReader,
  installedConfigRel,
  LEGACY_CONFIG_REL,
} from "../shared/env.ts";
import type { DiscernConfig } from "../shared/config_schema.ts";
import { normalizeDocsDir } from "../shared/docs_path.ts";

// Re-export the install markers so installer-side callers can import them from
// the lib layer (the canonical definitions live in the shared env module).
export { CONFIG_REL, LEGACY_CONFIG_REL };

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
 * install is unambiguous; the legacy fallback is what lets `upgrade`
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
export function resolveSkillsDir(
  root: string,
  config: DiscernConfig,
): ResolvedDir {
  return resolveDir(root, config.skills.dir);
}

/** The configured agent-documentation tree: `[docs].dir`, default `docs/`. */
export function resolveDocsDir(
  root: string,
  config: DiscernConfig,
): ResolvedDir {
  return resolveDir(root, normalizeDocsDir(config.docs.dir));
}

/**
 * The project recipes directory: `[recipes].dir`, default `./recipes`. The
 * default works with no config; point it elsewhere (e.g. `tools/`) if preferred.
 */
export function resolveRecipesDir(
  root: string,
  config: DiscernConfig,
): ResolvedDir {
  return resolveDir(root, config.recipes.dir);
}

/**
 * The directory under which per-worktree `<name>` checkouts are created — the ONE
 * resolver every spawn path (the `WorktreeCreate` hook) and the orphan-sweep
 * wiring (`worktree prune`'s `extraDirs`) share, so the placement convention lives
 * in exactly one place. It lives HERE, in the feature layer, never in the
 * stack-neutral engine: the engine discovers existing worktrees from git's own
 * registry and knows nothing of *where* new ones go (ADR 0040, ADR 0052).
 *
 * Resolves `[worktree].root` against the main checkout `repoRoot`:
 *   - empty / unset (the default) ⇒ a SIBLING of the repo,
 *     `<parent>/<repo-basename>.worktrees` — visible, adjacent, and crucially NOT
 *     nested inside the repo (a worktree nested in its own checkout is a known
 *     anti-pattern: recursive globs double-count it, and a tool walking up to the
 *     repo root mis-resolves the worktree's `.git` file);
 *   - a RELATIVE path ⇒ resolved against `repoRoot` (e.g. `.claude/worktrees`
 *     nests them inside the repo; `../wts` a custom sibling);
 *   - an ABSOLUTE path ⇒ used as-is.
 *
 * Per-worktree `<name>` directories are created under the returned path.
 */
export function resolveWorktreeRoot(
  repoRoot: string,
  config: DiscernConfig,
): string {
  const configured = config.worktree.root;
  if (configured === "") {
    return join(dirname(repoRoot), `${basename(repoRoot)}.worktrees`);
  }
  return resolveDir(repoRoot, configured).abs;
}

/**
 * Expand `[guidance].sources` (default `["guidance.md"]`) into the matched source
 * files under `root`, present-only: a pattern that matches nothing simply
 * contributes nothing. Globs are supported. Results are de-duplicated and sorted
 * for a stable concatenation order regardless of match order.
 */
export async function resolveGuidanceSources(
  root: string,
  config: DiscernConfig,
): Promise<string[]> {
  // The schema defaults an absent `[guidance].sources` to `["guidance.md"]`; an
  // explicit empty list also falls back to it (an install that compiles only the
  // built-in guidance still wants the default source picked up when present).
  const configured = config.guidance.sources;
  const patterns = configured.length > 0 ? configured : ["guidance.md"];
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
 * The repo-root staging directory `scripts/build.ts` lays the bundled docs into
 * before `--include`-ing it (so customer binaries embed the public tree plus the
 * ADR allowlist, never `_private`/`_internal`). The single source of truth for the name,
 * shared by the build (which writes it) and {@link resolveBundledDocsDir} (which
 * reads it). It nests an inner `docs/` so the resolved tree's basename is `docs`
 * and indexed paths read `docs/…`, identical to a checkout.
 */
export const BUNDLED_DOCS_STAGE_DIR = ".discern-help-docs";

/**
 * The internal (`_`-prefixed) doc subtrees that ARE bundled into the binary and
 * may be surfaced — only through an explicit opt-in (`discern help --adr`), never
 * by default and never over MCP. Default-DENY is the safety property: the build
 * embeds public docs plus exactly these, and `--adr` reveals exactly these, so a
 * new private tree (e.g. anything under `_private/`) stays out of every customer
 * binary until it is added here on purpose. The single source for both the embed
 * (`scripts/build.ts`) and the view (the `--adr` allowlist).
 */
export const BUNDLED_INTERNAL_DOC_DIRS: readonly string[] = ["_adr"];

/**
 * Whether a top-level `docs/` entry (a public subtree, the root `README`, or an
 * allowlisted internal tree) is embedded into the binary for `discern help`.
 * Default-DENY: a `_`-prefixed tree ships only when named in
 * {@link BUNDLED_INTERNAL_DOC_DIRS}, so `_internal` / `_private` (and any future
 * private tree) are excluded automatically. The one predicate the build filters
 * on and the curation guard test pins.
 */
export function isBundledDocEntry(name: string): boolean {
  return !name.startsWith("_") || BUNDLED_INTERNAL_DOC_DIRS.includes(name);
}

/**
 * The bundled setup directory inside the resolved `templates/` tree. Holds
 * `instructions.md` (the agent-facing setup brief `discern setup` prints) and
 * `skel/` (the doc-tree skeletons it lays when a project has none). Setup is a CLI
 * command, not a materialized skill (ADR 0024, 0036), so its assets live here
 * rather than under `templates/skills/`.
 */
export async function resolveSetupDir(): Promise<string> {
  return join(await resolveTemplatesDir(), "setup");
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
export async function resolveTemplatesDir(
  env: EnvReader = Deno.env,
): Promise<string> {
  const override = env.get("DISCERN_TEMPLATES_DIR");
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

/**
 * Resolve the absolute path to discern's OWN bundled documentation — the tree
 * `discern help` serves, distinct from a project's `docs/` (which `discern docs`
 * resolves via the project root). Like {@link resolveTemplatesDir} it is
 * discovered module-relative, so it works both under `deno run` from this
 * checkout and inside a `deno compile` binary built with the staged docs
 * `--include`d.
 *
 * Resolution order:
 *   1. `DISCERN_DOCS_DIR` env override (tests point this at a fixture).
 *   2. the build-staged PUBLIC docs embedded in a compiled binary, found by
 *      walking up to a `<dir>/<BUNDLED_DOCS_STAGE_DIR>/docs` (the inner `docs`
 *      gives the tree a `docs/…` path shape identical to a checkout).
 *   3. this repo's own `docs/` when running from a checkout. Its internal
 *      `_`-prefixed subtrees are filtered out by the VIEW (`includeInternal:
 *      false`), not the embed — only the staged path is curated at build time.
 *
 * Returns `undefined` only when no tree can be located (a build defect in a
 * binary; never in a checkout) — the caller turns that into a clear message
 * rather than serving a project's docs by mistake.
 */
export async function resolveBundledDocsDir(): Promise<string | undefined> {
  const override = Deno.env.get("DISCERN_DOCS_DIR");
  if (override) {
    return (await isDir(override)) ? override : undefined;
  }

  // Walk up from this module's directory, preferring the staged public tree (a
  // compiled binary) and falling back to the repo's `docs/` (a checkout).
  let dir = dirname(fromFileUrl(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const staged = join(dir, BUNDLED_DOCS_STAGE_DIR, "docs");
    if (await isDir(staged)) {
      return staged;
    }
    const checkout = join(dir, "docs");
    if (await isDir(checkout)) {
      return checkout;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return undefined;
}
