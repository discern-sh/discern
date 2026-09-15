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
import type { DiscernConfig } from "../shared/config_schema.ts";
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
import { REPOSITORY_MANUAL_REL } from "../shared/manual.ts";

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

/** The bundled-skills directory inside an explicit or resolved `templates/` tree. */
export async function resolveBundledSkillsDir(
  templatesDir?: string,
): Promise<string> {
  return join(templatesDir ?? await resolveTemplatesDir(), "skills");
}

/**
 * The repo-root staging directory `scripts/build.ts` lays the bundled manual into
 * before `--include`-ing it (so customer binaries embed only the public
 * projection, never internal decision or maintainer trees). The single source
 * of truth for the name is shared by the build (which writes it) and
 * {@link resolveBundledManualDir} (which reads it). It nests an inner `docs/` so
 * bundled documentation paths keep the stable `docs/…` shape used by the public
 * interface.
 */
export const BUNDLED_MANUAL_STAGE_DIR = ".discern-bundled-manual";

/** The source-checkout decision-record directory that `docs --adr` can browse. */
export const DOCS_ADR_DOC_DIR = "_adr";

/** The reader role assigned to one numbered section of the configured Map. */
export type MapSectionAudience = "project" | "contributor";

/** One numbered Map section and the reader role its content serves. */
export interface MapSectionRegistration {
  readonly dir: string;
  readonly audience: MapSectionAudience;
}

/**
 * Every numbered section in discern's configured Map, in reading order. This is a
 * TOTAL registry: a new numbered directory must join it as public or
 * contributor-facing. This classification describes the project-knowledge
 * tree; it does not decide product-manual publication.
 */
export const MAP_SECTION_REGISTRY: readonly MapSectionRegistration[] = [
  { dir: "00-orientation", audience: "project" },
  { dir: "10-getting-started", audience: "project" },
  { dir: "20-quality-gate", audience: "project" },
  { dir: "30-worktrees", audience: "project" },
  { dir: "40-agent-instructions", audience: "project" },
  { dir: "45-skills", audience: "project" },
  { dir: "50-engine-internals", audience: "contributor" },
  { dir: "60-agent-integrations", audience: "project" },
  { dir: "70-reference", audience: "project" },
  { dir: "80-development", audience: "contributor" },
  { dir: "90-site", audience: "contributor" },
];

/** How each top-level Map tier crosses the repository and site boundary. */
export const MAP_TIER_PUBLICATION_POSTURES = [
  {
    tier: "numbered",
    posture: "public",
    boundary:
      "numbered map sources are tracked and selected pages may publish as public documentation or exhibits",
  },
  {
    tier: "_adr",
    posture: "public",
    boundary:
      "accepted decisions are tracked and publish through the public decisions route",
  },
  {
    tier: "_internal",
    posture: "repository-only",
    boundary:
      "maintainer authorities are deliberately tracked but excluded from public documentation routes",
  },
  {
    tier: "_private",
    posture: "private",
    boundary:
      "the private-stage overlay is excluded from publishing and removed during the owner-operated history scrub before repository publication",
  },
] as const;

/**
 * Route shape shared by the numbered documentation trees: the root README maps
 * to the root route, a section README collapses to its numeric-prefix-stripped
 * slug, and a leaf appends its extensionless filename.
 */
export function numberedDocRoute(
  relPath: string,
  rootRoute: string,
): string | undefined {
  if (relPath === "README.md") return rootRoute;
  const parts = relPath.split("/");
  const dir = parts[0];
  if (dir === undefined || parts.length < 2) return undefined;
  const tail = parts.slice(1);
  const filename = tail.at(-1) ?? "";
  if (filename.toLowerCase() === "readme.md") tail.pop();
  else tail[tail.length - 1] = filename.replace(/\.md$/iu, "");
  return [rootRoute, dir.replace(/^\d+-/u, ""), ...tail]
    .filter((segment) => segment.length > 0)
    .join("/");
}

/** Resolve discern's fixed repository-owned manual source. */
export function resolveRepositoryManualDir(root: string): ResolvedDir {
  return resolveDir(root, REPOSITORY_MANUAL_REL);
}

/**
 * The bundled setup directory inside the resolved `templates/` tree. Holds
 * `instructions.md` (the agent-facing setup brief `discern setup begin` prints) and
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
 *      walking up to a `<dir>/<BUNDLED_MANUAL_STAGE_DIR>/docs` (the inner `docs`
 *      keeps bundled-document paths stable).
 *   3. this repository's fixed `project/manual/` source when running from a
 *      checkout. It never falls back to a project's configured Map.
 *
 * Returns `undefined` only when no tree can be located (a build defect in a
 * binary; never in a checkout) — the caller turns that into a clear message
 * rather than serving a project's docs by mistake.
 */
export async function resolveBundledManualDir(
  env: EnvReader = Deno.env,
): Promise<string | undefined> {
  const override = env.get(DISCERN_ENVIRONMENT_VARIABLES.docsDirectory);
  if (override) {
    return (await directoryExists(override)) ? override : undefined;
  }

  // Walk up from this module's directory, preferring the staged public tree (a
  // compiled binary) and falling back to this repository's manual source.
  let dir = dirname(fromFileUrl(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const staged = join(dir, BUNDLED_MANUAL_STAGE_DIR, "docs");
    if (await directoryExists(staged)) {
      return staged;
    }
    const checkout = resolveRepositoryManualDir(dir).abs;
    if (await directoryExists(checkout)) {
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

/**
 * Resolve this source checkout's decision records for `docs --adr`. Customer
 * binaries deliberately carry no Map bytes, so the resolver returns undefined
 * outside a repository checkout.
 */
export async function resolveRepositoryDecisionDir(): Promise<
  string | undefined
> {
  let dir = dirname(fromFileUrl(import.meta.url));
  for (let depth = 0; depth < 8; depth++) {
    const candidate = join(dir, "project", "map", DOCS_ADR_DOC_DIR);
    if (await directoryExists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}
