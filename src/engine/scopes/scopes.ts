/**
 * `scopes`: classify which scopes the branch + working tree touch, so the
 * gate fires only the scope gates whose scope actually changed (and decides the
 * preview line).
 *
 * Classification FAILS OPEN: when git cannot answer, every scope/marker is
 * reported, so consumers run MORE gates, never fewer. Two derived markers ride
 * alongside the scope names: `code` (any non-neutral path — the fail-open
 * default) and `previewable` (a previewable-flagged scope changed).
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type { ScopesData } from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import { runGit } from "../../shared/subprocess.ts";
import { parsePorcelainZ, splitNulRecords } from "../../shared/git_paths.ts";
import { pathMatchesPattern } from "./glob.ts";
import { expandDocsDirReference } from "../../shared/docs_path.ts";

/**
 * The two derived markers a classification emits ALONGSIDE the scope names: `code`
 * (any non-neutral path changed — the fail-open default) and `previewable` (a
 * previewable-flagged scope changed). The SINGLE source the producer (below) emits
 * and every consumer tests against — the gate's preview hint (`finish.ts`) and
 * status's scope-name filter (`status.ts`) — so a renamed/added marker propagates in
 * one edit instead of leaving a consumer matching a string nobody emits, and
 * {@link isScopeMarker} stays exhaustive automatically.
 */
export const SCOPE_MARKERS = ["code", "previewable"] as const;

/** One derived scopes marker ({@link SCOPE_MARKERS}). */
export type ScopeMarker = (typeof SCOPE_MARKERS)[number];

/** Named accessors for the markers — positional, so they never re-list the literals. */
export const [CODE_MARKER, PREVIEWABLE_MARKER] = SCOPE_MARKERS;

/** Whether `name` is a derived marker (vs. a configured scope name). Derived from
 * {@link SCOPE_MARKERS}, so a new marker is excluded from "scope names" for free. */
export function isScopeMarker(name: string): name is ScopeMarker {
  return (SCOPE_MARKERS as readonly string[]).includes(name);
}

/**
 * The project root's path inside its git repository (`git rev-parse
 * --show-prefix`): "" when the root IS the repository toplevel, otherwise a
 * trailing-slashed relative path like "app/". Undefined when git cannot answer.
 * Needed because git emits diff/status/log paths relative to the repository
 * TOPLEVEL regardless of cwd, while every discern consumer (scope globs,
 * coupling inputs, drift snapshots) speaks root-relative paths — for a project
 * rooted below its repo's toplevel the two disagree by exactly this prefix.
 */
export async function repoPathPrefix(
  root: string,
): Promise<string | undefined> {
  const r = await runGit(["rev-parse", "--show-prefix"], { cwd: root });
  return r.success ? r.stdout.trim() : undefined;
}

/**
 * Normalize toplevel-relative git output to root-relative: strip `prefix` and
 * drop paths outside the project subtree (a sibling project's changes in a
 * shared repository are not this project's). Identity when the root is the
 * toplevel (prefix ""). Shared by every reader of git-emitted path lists —
 * the scope classifier, the co-change miner, the fix-stage strand snapshot.
 */
export function stripRepoPathPrefix(
  paths: string[],
  prefix: string,
): string[] {
  if (prefix === "") {
    return paths;
  }
  return paths.flatMap((p) =>
    p.startsWith(prefix) ? [p.slice(prefix.length)] : []
  );
}

/**
 * Collect the branch's changed paths (committed since the merge-base with main,
 * plus the working tree), ROOT-relative. Both listings are read NUL-separated
 * (`-z`) and decoded by the shared parsers in `src/shared/git_paths.ts`, so a
 * path git would C-quote in line output arrives verbatim. Returns null to signal
 * fail-open (git
 * unavailable or no diff base). Exported so the co-change advisory ({@link
 * import("../coupling/coupling.ts").couplingResult}) reads the SAME current change
 * set the scope classifier does, rather than a parallel git query.
 */
export async function collectPaths(
  root: string,
  mainBranch: string,
): Promise<string[] | null> {
  const prefix = await repoPathPrefix(root);
  if (prefix === undefined) {
    return null;
  }
  // --no-renames: rename detection would collapse a rename to one R line naming
  // only the NEW path, silently dropping the vacated old path from the change
  // set (a rename out of a gated scope would then fire fewer gates than a plain
  // deletion). Detection off, both sides list as a D + an A.
  const committed = await runGit(
    ["diff", "--name-only", "--no-renames", "-z", `${mainBranch}...HEAD`],
    { cwd: root },
  );
  if (!committed.success) {
    return null;
  }
  const pending = await runGit(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: root },
  );
  if (!pending.success) {
    return null;
  }

  const paths = splitNulRecords(committed.stdout);
  for (const entry of parsePorcelainZ(pending.stdout)) {
    if (entry.origPath !== undefined) {
      paths.push(entry.origPath);
    }
    paths.push(entry.path);
  }
  // Git spoke toplevel-relative; consumers match root-relative scope globs.
  return stripRepoPathPrefix(paths, prefix);
}

/** Does `path` match any glob in `paths`? */
function pathMatchesGlobs(paths: string[], path: string): boolean {
  return paths.some((pat) => pathMatchesPattern(path, pat));
}

/** Resolve live config references in one scope's path list. */
function resolvedScopePaths(
  config: DiscernConfig,
  scope: string,
): string[] {
  return (config.scopes[scope]?.paths ?? []).map((path) =>
    expandDocsDirReference(path, config.docs.dir)
  );
}

/**
 * Whether `path` is a NEUTRAL path — one a change to needs no gate, and that must
 * not register as evidence: it matches a `neutral`-flagged scope (docs, agent
 * guidance, generated/materialized artifacts), or it is a root-level `*.md`. The
 * single definition of "neutral path", shared by {@link scopes} (which drops
 * these before classifying) and the co-change miner (which drops them before
 * building baskets, so `AGENTS.md`, `dist/`, lockfiles, and materialized skills
 * never create coupling edges).
 */
export function isNeutralPath(config: DiscernConfig, path: string): boolean {
  const scopes = config.scopes;
  for (const s of Object.keys(scopes)) {
    if (
      scopes[s]?.neutral &&
      pathMatchesGlobs(resolvedScopePaths(config, s), path)
    ) {
      return true;
    }
  }
  return !path.includes("/") && path.endsWith(".md");
}

/**
 * Which of `candidates` (scope names, already in declaration order) some path in
 * `paths` falls in, preserving that order — the one scope-matching loop every
 * classifier shares, so "which scopes do these paths touch?" is answered by a
 * single matcher regardless of WHICH subset of scopes the caller cares about
 * (the gated ones, the previewable ones). Each path is normalized here (trimmed,
 * leading slash stripped); the caller chooses the candidate set and whether the
 * paths were neutral-filtered first.
 */
function scopesTouchedBy(
  paths: string[],
  config: DiscernConfig,
  candidates: string[],
): string[] {
  const fired = new Set<string>();
  for (const raw of paths) {
    const path = raw.trim().replace(/^\//, "");
    if (path === "") {
      continue;
    }
    for (const s of candidates) {
      if (
        !fired.has(s) && pathMatchesGlobs(resolvedScopePaths(config, s), path)
      ) {
        fired.add(s);
      }
    }
  }
  return candidates.filter((s) => fired.has(s));
}

/**
 * The fire-scopes an explicit list of changed paths touches, in declaration order —
 * the scope-matching half of {@link scopes}, factored out so any verb that
 * already has a path list in hand (update's incoming files) classifies it through
 * the SAME matcher rather than a parallel copy. It answers only "which gated scopes
 * do these paths fall in?"; neutral scopes and the derived markers are not its
 * concern (a path is normalized — trimmed, leading slash stripped — but not
 * neutral-filtered here).
 */
export function scopesForPaths(
  paths: string[],
  config: DiscernConfig,
): string[] {
  const scopes = config.scopes;
  const fireScopes = Object.keys(scopes).filter((s) => !scopes[s]?.neutral);
  return scopesTouchedBy(paths, config, fireScopes);
}

/**
 * Whether a previewable-flagged scope changed — the truth behind the
 * `previewable` marker. Derived over the UNFILTERED changed paths (not the
 * neutral-filtered `realPaths` the gate keys off), because "previewable" and
 * "neutral" are independent flags: a scope can be BOTH (a generated preview a
 * person can still see), and a change there must light the preview signal even
 * though it fires no gate. Matches every previewable-flagged scope — neutral
 * ones included — via the shared matcher.
 */
function anyPreviewableScopeChanged(
  paths: string[],
  config: DiscernConfig,
): boolean {
  const scopes = config.scopes;
  const previewable = Object.keys(scopes).filter((s) => scopes[s]?.previewable);
  return scopesTouchedBy(paths, config, previewable).length > 0;
}

/**
 * The classified scopes/markers for the current branch, in stable order: the
 * `code` marker, the `previewable` marker, then the firing scopes that matched
 * (in declaration order). Pass a pre-loaded config to avoid re-parsing.
 */
export async function classifyScopes(
  root: string,
  cfg?: DiscernConfig,
): Promise<string[]> {
  const config = cfg ?? await loadConfig(root);
  const scopes = config.scopes;
  const names = Object.keys(scopes);
  const fireScopes = names.filter((s) => !scopes[s]?.neutral);

  const mainBranch = Deno.env.get("DISCERN_MAIN_BRANCH") ||
    config.project.main_branch;
  const paths = await collectPaths(root, mainBranch);
  if (paths === null) {
    // Fail open: cannot tell what changed → report every scope/marker.
    return [...SCOPE_MARKERS, ...fireScopes];
  }

  // All changed paths, normalized (trimmed, leading slash stripped, empties
  // dropped). The `previewable` marker is derived over THIS unfiltered set:
  // its contract is "a previewable-flagged scope changed", and a previewable
  // scope may also be neutral, so filtering neutrals out first would hide it.
  const normPaths = paths
    .map((raw) => raw.trim().replace(/^\//, ""))
    .filter((path) => path !== "");
  // The real (non-neutral) changed paths: any one is a gated `code` change, and
  // the fire-scopes they fall in (via the shared matcher) are what the gate runs.
  const realPaths = normPaths.filter((path) => !isNeutralPath(config, path));
  const fired = scopesForPaths(realPaths, config);

  const out: string[] = [];
  if (realPaths.length > 0) {
    out.push(CODE_MARKER);
  }
  if (anyPreviewableScopeChanged(normPaths, config)) {
    out.push(PREVIEWABLE_MARKER);
  }
  out.push(...fired);
  return out;
}

/** Options for the `scopes` subcommand surface. */
export interface ScopesOptions {
  json?: boolean;
  /** Exit-status-only membership test for a single scope/marker name. */
  has?: string;
}

/** The `scopes` envelope for a classified scope list — the one shape both
 * the CLI `--json` and the MCP tool render. */
function scopesEnvelope(
  scopes: string[],
): DiscernResult<ScopesData> {
  return {
    ok: true,
    verb: "scopes",
    data: { scopes } satisfies ScopesData,
  };
}

/**
 * Compute the `scopes` {@link DiscernResult} without printing — the entry
 * point the MCP server renders, and the source the CLI's `--json` serializes.
 */
export async function scopesResult(
  root: string,
): Promise<DiscernResult<ScopesData>> {
  return scopesEnvelope(await classifyScopes(root));
}

/**
 * The `scopes` subcommand: print the scopes (one per line), a JSON array
 * (`--json`), or test membership silently (`--has <name>` → exit 0/1).
 */
export async function runScopes(
  root: string,
  opts: ScopesOptions,
): Promise<number> {
  const scopes = await classifyScopes(root);
  if (opts.has !== undefined) {
    return scopes.includes(opts.has) ? 0 : 1;
  }
  if (opts.json) {
    emitResult(scopesEnvelope(scopes));
    return 0;
  }
  for (const s of scopes) {
    console.log(s);
  }
  return 0;
}
