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
 * Parse `git status --porcelain=v1` stdout into the list of changed paths. Porcelain
 * lines are "XY <path>", renames "XY <old> -> <new>": strip the 3-char status prefix,
 * keep BOTH sides of a rename (the vacated old path is a deletion the change set
 * must not lose — a rename out of a gated scope has to keep firing that scope), and
 * drop git's wrapping quotes. Shared by the scope classifier and the gate's
 * fix-stage strand check, so both read porcelain identically.
 */
export function parsePorcelainPaths(stdout: string): string[] {
  const paths: string[] = [];
  const push = (raw: string): void => {
    const p = raw.replace(/^"/, "").replace(/"$/, "");
    if (p !== "") {
      paths.push(p);
    }
  };
  for (const raw of stdout.split("\n")) {
    if (raw === "") {
      continue;
    }
    const p = raw.slice(3);
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) {
      push(p.slice(0, arrow));
      push(p.slice(arrow + 4));
    } else {
      push(p);
    }
  }
  return paths;
}

/**
 * Collect the branch's changed paths (committed since the merge-base with main,
 * plus the working tree). Returns null to signal fail-open (git unavailable or
 * no diff base). Exported so the co-change advisory ({@link
 * import("../coupling/coupling.ts").couplingResult}) reads the SAME current change
 * set the scope classifier does, rather than a parallel git query.
 */
export async function collectPaths(
  root: string,
  mainBranch: string,
): Promise<string[] | null> {
  // --no-renames: rename detection would collapse a rename to one R line naming
  // only the NEW path, silently dropping the vacated old path from the change
  // set (a rename out of a gated scope would then fire fewer gates than a plain
  // deletion). Detection off, both sides list as a D + an A.
  const committed = await runGit(
    ["diff", "--name-only", "--no-renames", `${mainBranch}...HEAD`],
    { cwd: root },
  );
  if (!committed.success) {
    return null;
  }
  const pending = await runGit(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: root },
  );
  if (!pending.success) {
    return null;
  }

  const paths: string[] = [];
  for (const line of committed.stdout.split("\n")) {
    const p = line.trim();
    if (p !== "") {
      paths.push(p);
    }
  }
  // Porcelain v1 lines are "XY <path>", renames "XY <old> -> <new>" — parsed by the
  // shared parsePorcelainPaths (also used by the gate's fix-stage strand check).
  paths.push(...parsePorcelainPaths(pending.stdout));
  return paths;
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
 * The fire-scopes an explicit list of changed paths touches, in declaration order —
 * the scope-matching half of {@link scopes}, factored out so any verb that
 * already has a path list in hand (integrate's incoming files) classifies it through
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
  const fired = new Set<string>();
  for (const raw of paths) {
    const path = raw.trim().replace(/^\//, "");
    if (path === "") {
      continue;
    }
    for (const s of fireScopes) {
      if (
        !fired.has(s) && pathMatchesGlobs(resolvedScopePaths(config, s), path)
      ) {
        fired.add(s);
      }
    }
  }
  return fireScopes.filter((s) => fired.has(s));
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

  const mainBranch = Deno.env.get("MAIN_BRANCH") || config.project.main_branch;
  const paths = await collectPaths(root, mainBranch);
  if (paths === null) {
    // Fail open: cannot tell what changed → report every scope/marker.
    return [...SCOPE_MARKERS, ...fireScopes];
  }

  // The real (non-neutral) changed paths: any one is a gated `code` change, and the
  // fire-scopes they fall in (via the shared matcher) decide the `previewable` marker.
  const realPaths = paths
    .map((raw) => raw.trim().replace(/^\//, ""))
    .filter((path) => path !== "" && !isNeutralPath(config, path));
  const fired = scopesForPaths(realPaths, config);

  const out: string[] = [];
  if (realPaths.length > 0) {
    out.push(CODE_MARKER);
  }
  if (fired.some((s) => scopes[s]?.previewable)) {
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
