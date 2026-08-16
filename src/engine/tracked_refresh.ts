/**
 * Read-only convergence plan for refresh-managed tracked artifacts.
 *
 * Provider integration writers run against an in-memory filesystem overlay, so
 * this plan executes the same merge functions and ordering as `discern refresh`
 * without touching the checkout. The remaining artifacts already expose pure
 * expected-state computations; this module composes them into one verdict for
 * `status`, `done`, `accept`, and update bookkeeping.
 */

import { join, relative } from "@std/path";
import { adrIndexState } from "../lib/adr_index.ts";
import {
  GITATTRIBUTES_REL,
  planDiscernGitattributesFile,
} from "../lib/agent_gitattributes.ts";
import {
  PlanningRefreshFileOps,
  type RefreshFileSnapshot,
} from "../lib/refresh_file_ops.ts";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import type { EnvReader } from "../shared/env.ts";
import { runGit } from "../shared/subprocess.ts";
import { agentFilePaths, renderAgentFiles } from "./instruction_render.ts";
import { repoPathPrefix, stripRepoPathPrefix } from "./scopes/scopes.ts";
import { reconcileTrackedProviderArtifacts } from "./tracked_refresh_providers.ts";

/** Which refresh transformation owns a proposed tracked-file effect. */
export type TrackedRefreshArtifactKind =
  | "agent_file"
  | "gitattributes"
  | "mcp"
  | "hooks"
  | "worktree_app"
  | "project_rules"
  | "adr_index";

/** One final net effect an ordinary refresh would apply. */
export interface TrackedRefreshChange {
  readonly path: string;
  readonly kinds: readonly TrackedRefreshArtifactKind[];
  readonly bytesChanged: boolean;
  readonly modeChanged: boolean;
}

/** The complete read-only tracked portion of a refresh. */
export interface TrackedRefreshPlan {
  readonly changes: readonly TrackedRefreshChange[];
  readonly errors: readonly string[];
}

/** Render an unknown planning failure without losing its underlying reason. */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read tracked file bytes from the commit being judged, not the worktree. */
function headRefreshSnapshot(
  root: string,
  repoPrefix: string,
): RefreshFileSnapshot {
  return {
    readTextFile: async (path: string): Promise<string> => {
      const rel = relative(root, path);
      const repoPath = `${repoPrefix}${rel}`;
      const shown = await runGit(["show", `HEAD:${repoPath}`], { cwd: root });
      if (!shown.success) {
        const listed = await runGit(
          ["ls-tree", "-z", "HEAD", "--", repoPath],
          { cwd: root },
        );
        if (!listed.success) {
          const detail = listed.stderr.trim() || listed.stdout.trim();
          throw new Error(
            `could not inspect the committed version of ${rel}${
              detail === "" ? "" : `: ${detail}`
            }`,
          );
        }
        if (listed.stdout === "") {
          throw new Deno.errors.NotFound(`No tracked HEAD version of ${rel}`);
        }
        const detail = shown.stderr.trim() || shown.stdout.trim();
        throw new Error(
          `could not read the committed version of ${rel}${
            detail === "" ? "" : `: ${detail}`
          }`,
        );
      }
      return shown.stdout;
    },
    // MCP adoption classification depends on bytes only. Its writers may still
    // normalize a proposed mode inside the overlay, but no baseline mode is used.
    mode: (_path: string): Promise<undefined> => Promise.resolve(undefined),
  };
}

/** Add or merge one path's proposed effect. */
function recordChange(
  changes: Map<string, {
    kinds: Set<TrackedRefreshArtifactKind>;
    bytesChanged: boolean;
    modeChanged: boolean;
  }>,
  path: string,
  kind: TrackedRefreshArtifactKind,
  effect: { bytesChanged: boolean; modeChanged: boolean },
): void {
  const current = changes.get(path) ?? {
    kinds: new Set<TrackedRefreshArtifactKind>(),
    bytesChanged: false,
    modeChanged: false,
  };
  current.kinds.add(kind);
  current.bytesChanged = current.bytesChanged || effect.bytesChanged;
  current.modeChanged = current.modeChanged || effect.modeChanged;
  changes.set(path, current);
}

/** Return the supplied project-relative paths already tracked in Git. */
async function trackedPaths(
  root: string,
  paths: readonly string[],
  repoPrefix: string | undefined,
): Promise<Set<string>> {
  if (paths.length === 0 || repoPrefix === undefined) {
    return new Set();
  }
  const listed = await runGit(
    ["ls-files", "--full-name", "-z", "--", ...paths],
    { cwd: root },
  );
  if (!listed.success) {
    const detail = listed.stderr.trim() || listed.stdout.trim();
    throw new Error(
      `git ls-files could not identify tracked refresh artifacts${
        detail === "" ? "" : `: ${detail}`
      }`,
    );
  }
  return new Set(
    stripRepoPathPrefix(
      listed.stdout.split("\0").filter((path) => path.length > 0),
      repoPrefix,
    ),
  );
}

/** Map writer-reported paths to the integration classes that touched them. */
function integrationKinds(
  groups: ReadonlyArray<{
    kind: TrackedRefreshArtifactKind;
    paths: readonly string[];
  }>,
): Map<string, Set<TrackedRefreshArtifactKind>> {
  const out = new Map<string, Set<TrackedRefreshArtifactKind>>();
  for (const group of groups) {
    for (const path of group.paths) {
      const kinds = out.get(path) ?? new Set<TrackedRefreshArtifactKind>();
      kinds.add(group.kind);
      out.set(path, kinds);
    }
  }
  return out;
}

/**
 * Compute every tracked file effect `discern refresh` would apply, without
 * writing. Missing/untracked outputs retain the established local-output policy;
 * once a refresh artifact is tracked, deleting or drifting it is blocking.
 */
export async function planTrackedRefresh(
  root: string,
  config?: DiscernConfig,
  env: EnvReader = Deno.env,
): Promise<TrackedRefreshPlan> {
  const cfg = config ?? await loadConfig(root);
  const changes = new Map<string, {
    kinds: Set<TrackedRefreshArtifactKind>;
    bytesChanged: boolean;
    modeChanged: boolean;
  }>();
  const errors: string[] = [];
  const repoPrefix = await repoPathPrefix(root);

  // Provider integrations can co-own files, so run their real writers in the
  // same order as refresh against one overlay. Later writers see earlier output.
  const files = new PlanningRefreshFileOps(root);
  const committedFiles = repoPrefix === undefined
    ? undefined
    : new PlanningRefreshFileOps(root, headRefreshSnapshot(root, repoPrefix));
  const provider = await reconcileTrackedProviderArtifacts(
    root,
    cfg,
    env,
    files,
    committedFiles,
  );
  errors.push(...provider.errors);
  const kindsByPath = integrationKinds([
    { kind: "mcp", paths: provider.mcpWired },
    { kind: "hooks", paths: provider.hooksWired },
    { kind: "worktree_app", paths: provider.worktreeAppWired },
    { kind: "project_rules", paths: provider.projectRulesWired },
  ]);
  for (const effect of files.changes()) {
    const kinds = kindsByPath.get(effect.path);
    if (kinds === undefined) {
      errors.push(
        `refresh planned an unclassified provider artifact: ${effect.path}`,
      );
      continue;
    }
    for (const kind of kinds) {
      // Preserve the established missing-output policy: wiring an MCP server
      // for the first time belongs to setup/refresh and remains advisory. Once
      // the server exists, any in-place drift is a tracked convergence defect.
      if (
        kind === "mcp" && provider.mcpFirstInstallPaths.includes(effect.path)
      ) {
        continue;
      }
      recordChange(changes, effect.path, kind, effect);
    }
  }

  // Compiled instructions uses the renderer shared with refresh. Refresh normalizes
  // these generated files to mode 0644, so mode-only drift is part of the plan.
  let renderedAgentPaths: string[] = [];
  try {
    const rendered = await renderAgentFiles(root, cfg);
    renderedAgentPaths = [...rendered.keys()];
    const tracked = await trackedPaths(root, renderedAgentPaths, repoPrefix);
    for (const [path, expected] of rendered) {
      let actual: string;
      let mode: number | undefined;
      try {
        actual = await Deno.readTextFile(join(root, path));
        mode = (await Deno.stat(join(root, path))).mode ?? undefined;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          if (tracked.has(path)) {
            recordChange(changes, path, "agent_file", {
              bytesChanged: true,
              modeChanged: false,
            });
          }
          continue;
        }
        throw error;
      }
      const bytesChanged = actual !== expected;
      const modeChanged = mode !== undefined && (mode & 0o111) !== 0;
      if (bytesChanged || modeChanged) {
        recordChange(changes, path, "agent_file", {
          bytesChanged,
          modeChanged,
        });
      }
    }
  } catch (error) {
    errors.push(`could not plan the Agent files: ${errText(error)}`);
  }

  try {
    const attributes = await planDiscernGitattributesFile(
      root,
      cfg,
      agentFilePaths(cfg),
      env,
      renderedAgentPaths,
    );
    if (attributes.operations.length > 0) {
      recordChange(changes, GITATTRIBUTES_REL, "gitattributes", {
        bytesChanged: true,
        modeChanged: false,
      });
    }
  } catch (error) {
    errors.push(`could not plan ${GITATTRIBUTES_REL}: ${errText(error)}`);
  }

  try {
    const index = await adrIndexState(root, cfg.map.dir);
    if (index.kind === "stale") {
      recordChange(changes, index.path, "adr_index", {
        bytesChanged: true,
        modeChanged: false,
      });
    }
  } catch (error) {
    errors.push(`could not plan the ADR index: ${errText(error)}`);
  }

  let tracked: Set<string>;
  try {
    tracked = await trackedPaths(root, [...changes.keys()], repoPrefix);
  } catch (error) {
    errors.push(
      `could not classify tracked refresh artifacts: ${errText(error)}`,
    );
    tracked = new Set();
  }
  return {
    changes: [...changes.entries()]
      .filter(([path]) => tracked.has(path))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, change]) => ({
        path,
        kinds: [...change.kinds].sort(),
        bytesChanged: change.bytesChanged,
        modeChanged: change.modeChanged,
      })),
    errors,
  };
}

/** Paths only, for lifecycle conflict and commit enrollment. */
export function trackedRefreshPaths(plan: TrackedRefreshPlan): string[] {
  return plan.changes.map((change) => change.path);
}
