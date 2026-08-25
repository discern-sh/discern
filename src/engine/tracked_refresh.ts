/**
 * The complete read-only refresh plan and its tracked-artifact projection.
 *
 * Provider writers run against an in-memory file overlay; materialized skills
 * and proof-note transport expose their own typed plans; agent files, merge
 * attributes, and the ADR index reuse their expected-state authorities. One
 * plan therefore feeds preview, apply, status, and Gate convergence checks.
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
import { resolveInstructionSources } from "../lib/paths.ts";
import { providerFor, skillsDirsForAgents } from "../lib/providers.ts";
import {
  planMaterializeSkills,
  type SkillMaterializationOperation,
} from "../lib/skills.ts";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import type { EnvReader } from "../shared/env.ts";
import { readTextIfExists, statIfExists } from "../shared/fs_presence.ts";
import { type EnginePlan, verbatimStepLabel } from "../shared/result.ts";
import { runGit } from "../shared/subprocess.ts";
import {
  planProofNotesFetch,
  type ProofNotesFetchOperation,
  type ProofNotesFetchPlan,
} from "./gate/proof_notes.ts";
import {
  agentFilePaths,
  instructionAgents,
  renderAgentFiles,
} from "./instruction_render.ts";
import { repoPathPrefix, stripRepoPathPrefix } from "./scopes/scopes.ts";
import { reconcileTrackedProviderArtifacts } from "./tracked_refresh_providers.ts";

/** Which tracked refresh transformation owns a proposed file effect. */
export type TrackedRefreshArtifactKind =
  | "agent_file"
  | "gitattributes"
  | "mcp"
  | "hooks"
  | "worktree_app"
  | "project_rules"
  | "adr_index";

/** Every complete-refresh target class, including checkout-local effects. */
export type RefreshArtifactKind =
  | TrackedRefreshArtifactKind
  | "skill"
  | "skill_manifest"
  | "proof_notes_fetch";

/** One exact file effect retained by the refresh plan. */
export interface RefreshFileOperation {
  readonly targetRel: string;
  readonly targetAbs: string;
  readonly disposition: "create" | "update" | "remove";
  readonly bytes?: Uint8Array | undefined;
  readonly mode?: number | undefined;
  readonly bytesChanged: boolean;
  readonly modeChanged: boolean;
}

/** Fields common to every executable refresh effect. */
interface RefreshEffectFields {
  readonly target: string;
  readonly disposition: "create" | "update" | "remove";
  readonly artifacts: readonly RefreshArtifactKind[];
  readonly trackedKinds: readonly TrackedRefreshArtifactKind[];
  readonly boundary: string;
  /** One target classifies every descendant written beneath it. */
  readonly tree: boolean;
}

/** One plan-bound effect consumed by the refresh executor. */
export type RefreshEffect =
  | (RefreshEffectFields & {
    readonly type: "file";
    readonly operation: RefreshFileOperation;
  })
  | (RefreshEffectFields & {
    readonly type: "skill";
    readonly operation: SkillMaterializationOperation;
  })
  | (RefreshEffectFields & {
    readonly type: "proof-notes-fetch";
    readonly operation: ProofNotesFetchOperation;
  });

/** A planning failure blocks only the named artifact boundary. */
export interface RefreshPlanningError {
  readonly message: string;
  readonly boundary: string;
  /** Whether status and Gate's tracked projection must also surface it. */
  readonly tracked: boolean;
}

/** The complete pure/read-only refresh plan. */
export interface RefreshPlan {
  readonly root: string;
  readonly config: DiscernConfig;
  readonly effects: readonly RefreshEffect[];
  readonly errors: readonly RefreshPlanningError[];
  readonly warnings: readonly string[];
  readonly mcpFirstInstall: boolean;
  readonly sourceCount: number;
}

/** Options selecting the same bounded variants the existing callers require. */
export interface PlanRefreshOptions {
  readonly config?: DiscernConfig | undefined;
  readonly env?: EnvReader | undefined;
  readonly reconcileProofNotesFetch?: boolean | undefined;
}

/** One final tracked-file effect an ordinary refresh would apply. */
export interface TrackedRefreshChange {
  readonly path: string;
  readonly kinds: readonly TrackedRefreshArtifactKind[];
  readonly bytesChanged: boolean;
  readonly modeChanged: boolean;
}

/** The tracked projection consumed by status, Gate, acceptance, and update. */
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
    mode: (_path: string): Promise<undefined> => Promise.resolve(undefined),
  };
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

/** Preserve a present file's mode when its writer does not normalize it. */
async function plannedFileMode(
  path: string,
  fallback = 0o644,
): Promise<number> {
  const info = await statIfExists(path);
  return info?.mode === undefined || info.mode === null
    ? fallback
    : info.mode & 0o777;
}

/** Add a concrete file effect to the complete plan. */
function addFileEffect(
  effects: RefreshEffect[],
  operation: RefreshFileOperation,
  artifacts: readonly RefreshArtifactKind[],
  trackedKinds: readonly TrackedRefreshArtifactKind[],
  boundary: string,
): void {
  effects.push({
    type: "file",
    target: operation.targetRel,
    disposition: operation.disposition,
    artifacts,
    trackedKinds,
    boundary,
    tree: false,
    operation,
  });
}

/** Flatten the typed skills plan into complete-refresh effects. */
function addSkillEffects(
  effects: RefreshEffect[],
  operations: readonly SkillMaterializationOperation[],
): void {
  for (const operation of operations) {
    effects.push({
      type: "skill",
      target: operation.targetRel,
      disposition: operation.disposition,
      artifacts: [
        operation.kind === "manifest" ? "skill_manifest" : "skill",
      ],
      trackedKinds: [],
      boundary: `skills:${operation.dirRel}`,
      tree: operation.kind === "bundled",
      operation,
    });
  }
}

/** Flatten proof-note config operations into complete-refresh effects. */
function addProofNotesEffects(
  effects: RefreshEffect[],
  plan: ProofNotesFetchPlan,
): void {
  for (const boundary of plan.boundaries) {
    for (const operation of boundary.operations) {
      effects.push({
        type: "proof-notes-fetch",
        target: `git config ${operation.key}`,
        disposition: operation.kind === "add"
          ? "create"
          : operation.kind === "remove"
          ? "remove"
          : "update",
        artifacts: ["proof_notes_fetch"],
        trackedKinds: [],
        boundary: `proof-notes:${boundary.remote}`,
        tree: false,
        operation,
      });
    }
  }
}

/**
 * Compute every Discern-owned refresh effect without writing. Each writer's
 * existing path/content authority supplies its portion of this one plan.
 */
export async function planRefresh(
  root: string,
  options: PlanRefreshOptions = {},
): Promise<RefreshPlan> {
  const config = options.config ?? await loadConfig(root);
  const env = options.env ?? Deno.env;
  const effects: RefreshEffect[] = [];
  const errors: RefreshPlanningError[] = [];
  const warnings: string[] = [];
  const agents = instructionAgents(config);
  const repoPrefix = await repoPathPrefix(root);

  try {
    const skills = await planMaterializeSkills(
      root,
      config,
      skillsDirsForAgents(agents),
    );
    for (const directory of skills.directories) {
      addSkillEffects(effects, directory.operations);
      if (directory.foreign.length > 0) {
        warnings.push(
          `${directory.dirRel}/ has unmanaged entries discern would leave untouched: ${
            directory.foreign.join(", ")
          }`,
        );
      }
    }
    warnings.push(...skills.warnings);
    errors.push(...skills.errors.map((message) => ({
      message,
      boundary: "skills",
      tracked: false,
    })));
  } catch (error) {
    errors.push({
      message: `could not plan materialized skills: ${errText(error)}`,
      boundary: "skills",
      tracked: false,
    });
  }

  const providerFiles = new PlanningRefreshFileOps(root);
  const committedFiles = repoPrefix === undefined
    ? undefined
    : new PlanningRefreshFileOps(root, headRefreshSnapshot(root, repoPrefix));
  const provider = await reconcileTrackedProviderArtifacts(
    root,
    config,
    env,
    providerFiles,
    committedFiles,
  );
  errors.push(...provider.errors.map((message) => ({
    message,
    boundary: "provider-integrations",
    tracked: true,
  })));
  const kindsByPath = integrationKinds([
    { kind: "mcp", paths: provider.mcpWired },
    { kind: "hooks", paths: provider.hooksWired },
    { kind: "worktree_app", paths: provider.worktreeAppWired },
    { kind: "project_rules", paths: provider.projectRulesWired },
  ]);
  for (const operation of providerFiles.operations()) {
    const kinds = kindsByPath.get(operation.path);
    if (kinds === undefined) {
      errors.push({
        message:
          `refresh planned an unclassified provider artifact: ${operation.path}`,
        boundary: "provider-integrations",
        tracked: true,
      });
      continue;
    }
    const artifacts = [...kinds].sort();
    const trackedKinds = artifacts.filter((kind) =>
      !(kind === "mcp" &&
        provider.mcpFirstInstallPaths.includes(operation.path))
    );
    addFileEffect(
      effects,
      {
        targetRel: operation.path,
        targetAbs: operation.targetAbs,
        disposition: operation.disposition,
        bytes: new TextEncoder().encode(operation.text),
        mode: operation.mode,
        bytesChanged: operation.bytesChanged,
        modeChanged: operation.modeChanged,
      },
      artifacts,
      trackedKinds,
      "provider-integrations",
    );
  }

  if (options.reconcileProofNotesFetch !== false) {
    try {
      const proofNotes = await planProofNotesFetch(
        root,
        config.repository.proof_notes,
      );
      addProofNotesEffects(effects, proofNotes);
      errors.push(...proofNotes.errors.map((message) => ({
        message,
        boundary: "proof-notes-fetch",
        tracked: false,
      })));
    } catch (error) {
      errors.push({
        message: `could not plan proof-note fetch transport: ${errText(error)}`,
        boundary: "proof-notes-fetch",
        tracked: false,
      });
    }
  }

  try {
    const index = await adrIndexState(root, config.map.dir);
    if (index.kind === "stale") {
      const targetAbs = join(root, index.path);
      addFileEffect(
        effects,
        {
          targetRel: index.path,
          targetAbs,
          disposition: "update",
          bytes: new TextEncoder().encode(index.expected),
          mode: await plannedFileMode(targetAbs),
          bytesChanged: true,
          modeChanged: false,
        },
        ["adr_index"],
        ["adr_index"],
        "adr-index",
      );
    } else if (index.kind === "invalid") {
      errors.push({
        message:
          `could not regenerate the ADR index in ${index.path}: ${index.issue}`,
        boundary: "adr-index",
        tracked: true,
      });
    }
  } catch (error) {
    errors.push({
      message: `could not plan the ADR index: ${errText(error)}`,
      boundary: "adr-index",
      tracked: true,
    });
  }

  let renderedAgentPaths: string[] = [];
  try {
    const rendered = await renderAgentFiles(root, config);
    renderedAgentPaths = [...rendered.keys()];
    for (const [path, expected] of rendered) {
      const targetAbs = join(root, path);
      try {
        const actual = await readTextIfExists(targetAbs);
        const info = actual === undefined
          ? undefined
          : await statIfExists(targetAbs);
        const bytesChanged = actual !== expected;
        const modeChanged = info?.mode !== undefined && info.mode !== null &&
          (info.mode & 0o111) !== 0;
        if (!bytesChanged && !modeChanged) {
          continue;
        }
        addFileEffect(
          effects,
          {
            targetRel: path,
            targetAbs,
            disposition: actual === undefined ? "create" : "update",
            bytes: new TextEncoder().encode(expected),
            mode: 0o644,
            bytesChanged,
            modeChanged,
          },
          ["agent_file"],
          ["agent_file"],
          `agent-file:${path}`,
        );
      } catch (error) {
        errors.push({
          message: `could not plan ${path}: ${errText(error)}`,
          boundary: `agent-file:${path}`,
          tracked: true,
        });
      }
    }
    for (const agent of agents) {
      if (providerFor(agent)?.instructionFile === undefined) {
        warnings.push(
          `unknown agent '${agent}' in [project].agents has no Agent-file mapping`,
        );
      }
    }
  } catch (error) {
    errors.push({
      message: `could not compute the Agent files: ${errText(error)}`,
      boundary: "agent-files",
      tracked: true,
    });
  }

  try {
    const attributes = await planDiscernGitattributesFile(
      root,
      config,
      agentFilePaths(config),
      env,
      renderedAgentPaths,
    );
    for (const refused of attributes.refused) {
      warnings.push(
        `${GITATTRIBUTES_REL} omitted pattern ${
          JSON.stringify(refused.pattern)
        }: ${refused.reason}`,
      );
    }
    if (attributes.operations.length > 0) {
      const targetAbs = join(root, GITATTRIBUTES_REL);
      const remove = attributes.text === "" &&
        attributes.existing !== undefined;
      addFileEffect(
        effects,
        {
          targetRel: GITATTRIBUTES_REL,
          targetAbs,
          disposition: remove
            ? "remove"
            : attributes.existing === undefined
            ? "create"
            : "update",
          ...(remove
            ? {}
            : { bytes: new TextEncoder().encode(attributes.text) }),
          ...(remove ? {} : { mode: await plannedFileMode(targetAbs) }),
          bytesChanged: true,
          modeChanged: false,
        },
        ["gitattributes"],
        ["gitattributes"],
        "gitattributes",
      );
    }
  } catch (error) {
    errors.push({
      message: `could not plan ${GITATTRIBUTES_REL}: ${errText(error)}`,
      boundary: "gitattributes",
      tracked: true,
    });
  }

  let sourceCount = 0;
  try {
    sourceCount = (await resolveInstructionSources(root, config)).length;
  } catch (error) {
    warnings.push(`could not count instruction sources: ${errText(error)}`);
  }

  return {
    root,
    config,
    effects,
    errors,
    warnings,
    mcpFirstInstall: provider.mcpFirstInstall,
    sourceCount,
  };
}

/** Human group for one refresh artifact class. */
function artifactGroup(effect: RefreshEffect): string {
  if (effect.artifacts.includes("agent_file")) return "Agent files";
  if (
    effect.artifacts.includes("skill") ||
    effect.artifacts.includes("skill_manifest")
  ) return "Materialized skills";
  if (effect.artifacts.includes("proof_notes_fetch")) {
    return "Checkout-local integrations";
  }
  if (effect.artifacts.includes("adr_index")) return "Maintained ADR index";
  if (effect.artifacts.includes("gitattributes")) return "Generated metadata";
  return "Provider integrations";
}

/** Human note that preserves create/update/remove distinctions. */
function effectNote(effect: RefreshEffect): string {
  const classes = effect.artifacts.map((kind) => kind.replaceAll("_", " "))
    .join(" + ");
  return `${effect.disposition} ${classes}${effect.tree ? " tree" : ""}`;
}

/** Project the typed refresh plan onto the uniform engine-plan envelope. */
export function refreshPlanToEngine(plan: RefreshPlan): EnginePlan {
  return {
    title: "Refresh plan",
    details: plan.errors.map((error) => `Planning error: ${error.message}`),
    steps: plan.effects.map((effect) => ({
      kind: "refresh",
      label: verbatimStepLabel(effect.target),
      disposition: "run",
      note: effectNote(effect),
      group: artifactGroup(effect),
    })),
  };
}

/**
 * Project the complete refresh plan onto tracked convergence. Untracked first
 * installations and checkout-local effects stay visible to refresh previews but
 * do not become status/Gate drift.
 */
export async function planTrackedRefresh(
  root: string,
  config?: DiscernConfig,
  env: EnvReader = Deno.env,
): Promise<TrackedRefreshPlan> {
  const plan = await planRefresh(root, { config, env });
  const repoPrefix = await repoPathPrefix(root);
  const candidates = plan.effects.filter((effect): effect is Extract<
    RefreshEffect,
    { type: "file" }
  > => effect.type === "file" && effect.trackedKinds.length > 0);
  let tracked: Set<string>;
  const errors = plan.errors.filter((error) => error.tracked)
    .map((error) => error.message);
  try {
    tracked = await trackedPaths(
      root,
      candidates.map((effect) => effect.operation.targetRel),
      repoPrefix,
    );
  } catch (error) {
    errors.push(
      `could not classify tracked refresh artifacts: ${errText(error)}`,
    );
    tracked = new Set();
  }
  return {
    changes: candidates
      .filter((effect) => tracked.has(effect.operation.targetRel))
      .map((effect) => ({
        path: effect.operation.targetRel,
        kinds: [...effect.trackedKinds].sort(),
        bytesChanged: effect.operation.bytesChanged,
        modeChanged: effect.operation.modeChanged,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    errors,
  };
}

/** Paths only, for lifecycle conflict and commit enrollment. */
export function trackedRefreshPaths(plan: TrackedRefreshPlan): string[] {
  return plan.changes.map((change) => change.path);
}
