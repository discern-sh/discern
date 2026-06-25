/**
 * `changed-scopes`: classify which scopes the branch + working tree touch, so the
 * gate fires only the scope gates whose scope actually changed (and decides the
 * preview line). The TS port of the shell `changed-scopes` recipe.
 *
 * Classification FAILS OPEN: when git cannot answer, every scope/marker is
 * reported, so consumers run MORE gates, never fewer. Two derived markers ride
 * alongside the scope names: `code` (any non-neutral path — the fail-open
 * default) and `previewable` (a previewable-flagged scope changed).
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type { ChangedScopesData } from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import { pathMatchesPattern } from "./glob.ts";

/** Run `git -C root <args>`, capturing stdout. `ok:false` on any failure. */
async function git(
  root: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string }> {
  try {
    const out = await new Deno.Command("git", {
      args: ["-C", root, ...args],
      stdout: "piped",
      stderr: "null",
    }).output();
    return { ok: out.success, stdout: new TextDecoder().decode(out.stdout) };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/**
 * Collect the branch's changed paths (committed since the merge-base with main,
 * plus the working tree). Returns null to signal fail-open (git unavailable or
 * no diff base).
 */
async function collectPaths(
  root: string,
  mainBranch: string,
): Promise<string[] | null> {
  const committed = await git(root, [
    "diff",
    "--name-only",
    `${mainBranch}...HEAD`,
  ]);
  if (!committed.ok) {
    return null;
  }
  const pending = await git(root, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (!pending.ok) {
    return null;
  }

  const paths: string[] = [];
  for (const line of committed.stdout.split("\n")) {
    const p = line.trim();
    if (p !== "") {
      paths.push(p);
    }
  }
  // Porcelain v1 lines are "XY <path>", renames "XY <old> -> <new>": strip the
  // 3-char status prefix, keep the post-arrow path, drop git's wrapping quotes.
  for (const raw of pending.stdout.split("\n")) {
    if (raw === "") {
      continue;
    }
    let p = raw.slice(3);
    const arrow = p.indexOf(" -> ");
    if (arrow >= 0) {
      p = p.slice(arrow + 4);
    }
    p = p.replace(/^"/, "").replace(/"$/, "");
    if (p !== "") {
      paths.push(p);
    }
  }
  return paths;
}

/** Does `path` match any glob in `paths`? */
function pathMatchesGlobs(paths: string[], path: string): boolean {
  return paths.some((pat) => pathMatchesPattern(path, pat));
}

/**
 * The classified scopes/markers for the current branch, in stable order: the
 * `code` marker, the `previewable` marker, then the firing scopes that matched
 * (in declaration order). Pass a pre-loaded config to avoid re-parsing.
 */
export async function changedScopes(
  root: string,
  cfg?: DiscernConfig,
): Promise<string[]> {
  const config = cfg ?? await loadConfig(root);
  const scopes = config.scopes;
  const names = Object.keys(scopes);
  const neutralScopes = names.filter((s) => scopes[s]?.neutral);
  const fireScopes = names.filter((s) => !scopes[s]?.neutral);

  const mainBranch = Deno.env.get("MAIN_BRANCH") || config.project.main_branch;
  const paths = await collectPaths(root, mainBranch);
  if (paths === null) {
    // Fail open: cannot tell what changed → report every scope/marker.
    return ["code", "previewable", ...fireScopes];
  }

  // A path is neutral if it matches a neutral scope, or is a root-level *.md.
  const isNeutral = (path: string): boolean => {
    for (const s of neutralScopes) {
      if (pathMatchesGlobs(scopes[s]?.paths ?? [], path)) {
        return true;
      }
    }
    return !path.includes("/") && path.endsWith(".md");
  };

  let code = false;
  let previewable = false;
  const fired: string[] = [];
  for (const raw of paths) {
    const path = raw.trim().replace(/^\//, "");
    if (path === "" || isNeutral(path)) {
      continue;
    }
    code = true; // any non-neutral path is a real, gated change
    for (const s of fireScopes) {
      if (fired.includes(s)) {
        continue;
      }
      if (pathMatchesGlobs(scopes[s]?.paths ?? [], path)) {
        fired.push(s);
        if (scopes[s]?.previewable) {
          previewable = true;
        }
      }
    }
  }

  const out: string[] = [];
  if (code) {
    out.push("code");
  }
  if (previewable) {
    out.push("previewable");
  }
  for (const s of fireScopes) {
    if (fired.includes(s)) {
      out.push(s);
    }
  }
  return out;
}

/** Options for the `changed-scopes` subcommand surface. */
export interface ChangedScopesOptions {
  json?: boolean;
  /** Exit-status-only membership test for a single scope/marker name. */
  has?: string;
}

/** The `changed-scopes` envelope for a classified scope list — the one shape both
 * the CLI `--json` and the MCP tool render. */
function changedScopesEnvelope(scopes: string[]): DiscernResult {
  return {
    ok: true,
    verb: "changed-scopes",
    data: { scopes } satisfies ChangedScopesData,
  };
}

/**
 * Compute the `changed-scopes` {@link DiscernResult} without printing — the entry
 * point the MCP server renders, and the source the CLI's `--json` serializes.
 */
export async function changedScopesResult(
  root: string,
): Promise<DiscernResult> {
  return changedScopesEnvelope(await changedScopes(root));
}

/**
 * The `changed-scopes` subcommand: print the scopes (one per line), a JSON array
 * (`--json`), or test membership silently (`--has <name>` → exit 0/1).
 */
export async function runChangedScopes(
  root: string,
  opts: ChangedScopesOptions,
): Promise<number> {
  const scopes = await changedScopes(root);
  if (opts.has !== undefined) {
    return scopes.includes(opts.has) ? 0 : 1;
  }
  if (opts.json) {
    emitResult(changedScopesEnvelope(scopes));
    return 0;
  }
  for (const s of scopes) {
    console.log(s);
  }
  return 0;
}
