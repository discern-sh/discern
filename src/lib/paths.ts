/**
 * Path resolution for a discern install and the bundled `templates/` tree.
 *
 * The whole footprint in a project is a single root file, `discern.toml` (ADR
 * 0020). Everything else a project opts into — instructions prose, authored skills,
 * project scripts — lives at a config-pointed location with a sensible discoverable
 * default, read only when present. This module owns those defaults and resolvers,
 * plus the install-config locator and the `templates/` discovery.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { expandGlob } from "@std/fs";
import {
  CONFIG_REL,
  type EnvReader,
  installedConfigRel,
} from "../shared/env.ts";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../shared/environment_variables.ts";
import { normalizeMapDir } from "../shared/map_path.ts";
import {
  effectiveInstructionSourcePatterns,
  instructionSeedRel,
  SOURCE_PATHS,
} from "../shared/paths_registry.ts";
// Runtime-only import (used inside a function body, never at module evaluation),
// so the providers.ts → paths.ts edge in the other direction stays harmless.
import { allInstructionFilePaths } from "./providers.ts";
import { directoryExists } from "../shared/fs_presence.ts";

export { resolveWorktreeRoot } from "./worktree_root.ts";

// Re-export the install markers so installer-side callers can import them from
// the lib layer (the canonical definitions live in the shared env module).
export { CONFIG_REL };

/**
 * Resolve the root `discern.toml` inside an install directory, or `undefined`
 * when `destDir` is not a discern install.
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
 * The authored-skills directory: `[skills].dir` (its default lives in the paths
 * registry). Read only when present by the caller — the default lets the
 * namespace dir be picked up with zero config, and points elsewhere when
 * configured.
 */
export function resolveSkillsDir(
  root: string,
  config: DiscernConfig,
): ResolvedDir {
  return resolveDir(root, config.skills.dir);
}

/** The configured agent-documentation tree: `[map].dir` (its default lives in
 * the paths registry). */
export function resolveMapDir(
  root: string,
  config: DiscernConfig,
): ResolvedDir {
  return resolveDir(root, normalizeMapDir(config.map.dir));
}

/**
 * The project scripts directory: `[scripts].dir` (its default lives in the paths
 * registry). The default works with no config; point it elsewhere (e.g.
 * `tools/`) if preferred.
 */
export function resolveScriptsDir(
  root: string,
  config: DiscernConfig,
): ResolvedDir {
  return resolveDir(root, config.scripts.dir);
}

/**
 * The deferred-work ledger: `[project].todo` (its default lives in the paths
 * registry). Setup seeds it here; agents read and maintain it.
 */
export function resolveTodoPath(
  root: string,
  config: DiscernConfig,
): ResolvedDir {
  return resolveDir(root, config.project.todo);
}

/**
 * The project brief's fixed location. Registry-backed with NO config key (ADR
 * 0102): the brief is setup-time input, not an ongoing convention, so it gains a
 * key only when a real need appears.
 */
export function resolveBriefPath(root: string): ResolvedDir {
  return resolveDir(root, SOURCE_PATHS.brief.defaultPath);
}

/**
 * The concrete file setup seeds the starter instructions into — the registry's
 * {@link instructionSeedRel} over the configured `[instructions].sources`.
 */
export function resolveInstructionSeedRel(config: DiscernConfig): string {
  return instructionSeedRel(config.instructions.sources);
}

/**
 * Expand `[instructions].sources` (default: the registry's instruction path) into the
 * matched source files under `root`, present-only: a pattern that matches
 * nothing simply contributes nothing. Globs are supported in the pattern; the
 * `root` itself is always treated literally (never parsed as glob syntax), so a
 * project living at a path containing glob metacharacters still compiles. Results
 * are de-duplicated and sorted for a stable concatenation order regardless of
 * match order.
 *
 * The compile pipeline's own OUTPUTS — the agent files the provider
 * registry emits at the project root (`AGENTS.md`, `CLAUDE.md`, …) — are never
 * admitted, even when a pattern matches them (`sources = ["*.md"]` is the
 * classic case, but an explicit listing is refused too). Consuming an output as
 * a source would feed each compiled body into the next: every refresh grows the
 * file, and the currency check — which re-renders after the write — reads the
 * freshly written file as a new source and reports `stale` forever, blocking
 * the gate with a remediation (`discern refresh`) that can never clear it.
 */
export async function resolveInstructionSources(
  root: string,
  config: DiscernConfig,
): Promise<string[]> {
  // The schema defaults an absent `[instructions].sources` to the registry default;
  // an explicit empty list also falls back to it (an install that compiles only
  // the built-in instructions still wants the default source picked up when present).
  const patterns = effectiveInstructionSourcePatterns(
    config.instructions.sources,
  );
  // Every instruction file discern can emit, across ALL providers (not just the
  // configured set): a leftover output for an unconfigured agent is just as
  // poisonous a source as a live one.
  const outputs = new Set(
    allInstructionFilePaths().map((rel) => join(root, rel)),
  );
  const matched = new Set<string>();
  for (const pattern of patterns) {
    // A relative pattern resolves against `root` via expandGlob's `root` option —
    // which treats `root` as a LITERAL directory, never as glob syntax. Building
    // the glob string as `join(root, pattern)` would instead feed the absolute
    // project path through the glob parser, so a root containing a metacharacter
    // (`[`, `]`, `{`, `}`, `(`, `)`, a space, `*`) is read as a character class /
    // brace expansion and matches nothing — silently dropping all user instructions.
    // An absolute pattern is user-authored glob syntax by choice, honoured as-is.
    const [glob, opts] = pattern.startsWith("/")
      ? [pattern, { includeDirs: false } as const]
      : [pattern, { includeDirs: false, root } as const];
    for await (const entry of expandGlob(glob, opts)) {
      if (entry.isFile && !outputs.has(entry.path)) {
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
 * The repo-root staging directory `scripts/build.ts` lays the bundled manual into
 * before `--include`-ing it (so customer binaries embed only the public
 * projection, never internal decision or maintainer trees). The single source
 * of truth for the name is shared by the build (which writes it) and
 * {@link resolveBundledDocsDir} (which reads it). It nests an inner `docs/` so
 * bundled documentation paths keep the stable `docs/…` shape used by the public
 * interface.
 */
export const BUNDLED_DOCS_STAGE_DIR = ".discern-bundled-docs";

/** The source-checkout decision-record directory that `docs --adr` can browse. */
export const DOCS_ADR_DOC_DIR = "_adr";

/** The audience assigned to one numbered section of discern's own manual. */
export type ManualSectionAudience = "public" | "contributor";

/** One numbered manual section and the audience its projection serves. */
export interface ManualSectionRegistration {
  readonly dir: string;
  readonly audience: ManualSectionAudience;
}

/**
 * Every numbered section in discern's own manual, in reading order. This is a
 * TOTAL registry: a new numbered directory must join it as public or
 * contributor-facing, so default-deny publication cannot silently hide a new
 * public section. The curation guard ties the registry to the directory tree,
 * manual index, bundled documentation, and site navigation.
 */
export const MANUAL_SECTION_REGISTRY: readonly ManualSectionRegistration[] = [
  { dir: "00-orientation", audience: "public" },
  { dir: "10-getting-started", audience: "public" },
  { dir: "20-quality-gate", audience: "public" },
  { dir: "30-worktrees", audience: "public" },
  { dir: "40-agent-instructions", audience: "public" },
  { dir: "45-skills", audience: "public" },
  { dir: "50-engine-internals", audience: "contributor" },
  { dir: "60-agent-integrations", audience: "public" },
  { dir: "70-reference", audience: "public" },
  { dir: "80-development", audience: "contributor" },
  { dir: "90-site", audience: "contributor" },
];

/** The public subset a customer binary ships for `discern docs`. */
export const BUNDLED_PUBLIC_DOC_DIRS: readonly string[] =
  MANUAL_SECTION_REGISTRY
    .filter((section) => section.audience === "public")
    .map((section) => section.dir);

/**
 * Whether a top-level project-map entry belongs to the binary's public docs
 * projection. Allowlisted and default-deny: no `_`-prefixed tree ships, a
 * numbered subtree ships only when it is user-relevant, and a root-level
 * Markdown file (the docs front door) ships. The build combines this tier-level
 * predicate with `isPublicDoc` for the page-level boundary.
 */
export function isBundledDocEntry(name: string): boolean {
  if (name.startsWith("_")) return false;
  if (!name.includes("/") && name.endsWith(".md")) {
    return true; // a root-level doc (the front-door README)
  }
  return BUNDLED_PUBLIC_DOC_DIRS.includes(name);
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
  const variable = DISCERN_ENVIRONMENT_VARIABLES.templatesDirectory;
  const override = env.get(variable);
  if (override) {
    if (await directoryExists(override)) {
      return override;
    }
    throw new Error(
      `${variable} is set to "${override}" but that is not a directory.`,
    );
  }

  // Walk up from this module's directory looking for a sibling `templates/`.
  let dir = dirname(fromFileUrl(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, "templates");
    if (await directoryExists(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  throw new Error(
    `could not locate the templates/ tree. Set ${variable} to its path.`,
  );
}

/**
 * Resolve the absolute path to discern's OWN bundled documentation — the tree
 * `discern docs` serves, distinct from a project's map (which `discern map`
 * resolves via the project root). Like {@link resolveTemplatesDir} it is
 * discovered module-relative, so it works both under `deno run` from this
 * checkout and inside a `deno compile` binary built with the staged docs
 * `--include`d.
 *
 * Resolution order:
 *   1. `DISCERN_DOCS_DIR` env override (tests point this at a fixture).
 *   2. the build-staged public projection embedded in a compiled binary, found by
 *      walking up to a `<dir>/<BUNDLED_DOCS_STAGE_DIR>/docs` (the inner `docs`
 *      keeps bundled-document paths stable).
 *   3. this repo's own configured map when running from a checkout. The docs
 *      view applies both page publication and the manual section registry, so
 *      this uncurated fallback behaves like the pre-curated staged tree.
 *
 * Returns `undefined` only when no tree can be located (a build defect in a
 * binary; never in a checkout) — the caller turns that into a clear message
 * rather than serving a project's docs by mistake.
 */
export async function resolveBundledDocsDir(): Promise<string | undefined> {
  const override = Deno.env.get(DISCERN_ENVIRONMENT_VARIABLES.docsDirectory);
  if (override) {
    return (await directoryExists(override)) ? override : undefined;
  }

  // Walk up from this module's directory, preferring the staged public tree (a
  // compiled binary) and falling back to the checkout's configured map.
  let dir = dirname(fromFileUrl(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const staged = join(dir, BUNDLED_DOCS_STAGE_DIR, "docs");
    if (await directoryExists(staged)) {
      return staged;
    }
    try {
      const checkout = resolveMapDir(dir, await loadConfig(dir)).abs;
      if (await directoryExists(checkout)) {
        return checkout;
      }
    } catch {
      // A non-project ancestor is not a checkout candidate; keep walking.
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return undefined;
}
