/**
 * Required setup effects and their point-in-time write authority.
 *
 * Every effect carries its required write targets in the plan itself. The
 * executor flattens that one authority through the shared real-operation
 * preflight; there is no parallel list of paths for a future effect to forget.
 * Advisory Logbook recording never enters this model.
 */

import { dirname, join } from "@std/path";
import { resolveCommonGitDir } from "../engine/worktree/git.ts";
import { runGit } from "./subprocess.ts";
import {
  type PlannedWriteTarget,
  preflightPlannedWrites,
  type WritePreflightResult,
} from "./write_preflight.ts";

/** Effectful setup commands governed by this boundary. */
export const SETUP_EFFECT_COMMANDS = ["begin", "done", "accept"] as const;
export type SetupEffectCommand = (typeof SETUP_EFFECT_COMMANDS)[number];

/** Canonical required-effect vocabulary. New effects join this set once. */
export const SETUP_REQUIRED_EFFECT_KINDS = [
  "begin-branch",
  "begin-scaffold",
  "begin-commit",
  "done-refresh",
  "done-completion-config",
  "done-commit",
  "done-validation-evidence",
  "done-worktree-probe",
  "accept-merge",
  "accept-materialize",
  "accept-checkout",
  "accept-ref-advance",
  "accept-proof-note",
  "accept-branch-delete",
] as const;
export type SetupRequiredEffectKind =
  (typeof SETUP_REQUIRED_EFFECT_KINDS)[number];

/** Predictable Git-admin surfaces a planned Git operation may require. */
export const GIT_MUTATION_WRITE_SURFACES = [
  "common-directory",
  "checkout-directory",
  "head",
  "index",
  "objects",
  "branch-refs",
  "proof-note-refs",
  "branch-reflogs",
  "linked-worktrees",
] as const;
export type GitMutationWriteSurface =
  (typeof GIT_MUTATION_WRITE_SURFACES)[number];

/** A non-empty target set makes omission impossible at construction time. */
export type RequiredWriteTargets = readonly [
  PlannedWriteTarget,
  ...PlannedWriteTarget[],
];

/** One planned effect and the writes without which it cannot run. */
export interface SetupRequiredEffect {
  kind: SetupRequiredEffectKind;
  writes: RequiredWriteTargets;
}

/** The complete required-effect plan for one setup command invocation. */
export interface SetupEffectPlan {
  command: SetupEffectCommand;
  effects: readonly SetupRequiredEffect[];
}

/** Construct one required effect; callers cannot omit or pass an empty target set. */
export function setupRequiredEffect(
  kind: SetupRequiredEffectKind,
  first: PlannedWriteTarget,
  ...rest: PlannedWriteTarget[]
): SetupRequiredEffect {
  return { kind, writes: [first, ...rest] };
}

/** Construct a command plan after its cheap read-only preconditions. */
export function setupEffectPlan(
  command: SetupEffectCommand,
  effects: readonly SetupRequiredEffect[],
): SetupEffectPlan {
  return { command, effects };
}

/** Derive the probe population from the effects themselves. */
export function setupPlannedWrites(
  plan: SetupEffectPlan,
): PlannedWriteTarget[] {
  return plan.effects.flatMap((effect) => [...effect.writes]);
}

/** Exercise every write the plan requires, stopping at the first denial. */
export async function preflightSetupEffects(
  plan: SetupEffectPlan,
): Promise<WritePreflightResult> {
  return await preflightPlannedWrites(setupPlannedWrites(plan));
}

/** Whether a filesystem path currently names a file, directory, or nothing. */
async function pathKind(
  path: string,
): Promise<"file" | "directory" | "missing"> {
  try {
    const stat = await Deno.stat(path);
    return stat.isDirectory ? "directory" : "file";
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return "missing";
    throw error;
  }
}

/**
 * Derive representative writes for one planned filesystem target. Existing
 * files prove the exact open plus their parent entry protocol; missing files
 * prove creation of their containing tree without materializing it.
 */
export async function plannedFilesystemWrites(
  path: string,
  description: string,
): Promise<RequiredWriteTargets> {
  const kind = await pathKind(path);
  if (kind === "directory") {
    return [{ kind: "directory-entry", path, description }];
  }
  if (kind === "file") {
    return [
      { kind: "existing-file", path, description },
      {
        kind: "directory-entry",
        path: dirname(path),
        description: `${description} replacement`,
      },
    ];
  }
  return [{
    kind: "directory-tree",
    path: dirname(path),
    description: `${description} parent directory`,
  }];
}

/** Resolve this checkout's absolute Git directory without mutating Git. */
async function checkoutGitDir(root: string): Promise<string | undefined> {
  const result = await runGit(["rev-parse", "--absolute-git-dir"], {
    cwd: root,
  });
  const path = result.stdout.trim();
  return result.success && path !== "" ? path : undefined;
}

/**
 * Derive the filesystem and Git-admin surfaces used by checkout, index, ref,
 * object, reflog, commit, merge, note, and branch-deletion effects. An absent
 * repository has no Git mutation target and returns an empty population.
 */
export async function plannedGitMutationWrites(
  root: string,
  description: string,
  surfaces: readonly GitMutationWriteSurface[] = GIT_MUTATION_WRITE_SURFACES,
): Promise<PlannedWriteTarget[]> {
  const [common, checkout] = await Promise.all([
    resolveCommonGitDir(root),
    checkoutGitDir(root),
  ]);
  if (common === undefined || checkout === undefined) return [];
  const selected = new Set(surfaces);
  const targets: PlannedWriteTarget[] = [];
  if (selected.has("common-directory")) {
    targets.push({
      kind: "directory-entry",
      path: common,
      description: `${description} Git common directory`,
    });
  }
  if (selected.has("checkout-directory") && checkout !== common) {
    targets.push({
      kind: "directory-entry",
      path: checkout,
      description: `${description} checkout Git directory`,
    });
  }
  for (
    const [surface, path, label] of [
      ["head", join(checkout, "HEAD"), "HEAD"],
      ["index", join(checkout, "index"), "index"],
      ["objects", join(common, "objects"), "object database"],
      ["branch-refs", join(common, "refs", "heads"), "branch refs"],
      ["proof-note-refs", join(common, "refs", "notes"), "Proof-note refs"],
      [
        "branch-reflogs",
        join(common, "logs", "refs", "heads"),
        "branch reflogs",
      ],
      [
        "linked-worktrees",
        join(common, "worktrees"),
        "linked-worktree administration",
      ],
    ] as const
  ) {
    if (!selected.has(surface)) continue;
    targets.push(
      ...await plannedFilesystemWrites(
        path,
        `${description} ${label}`,
      ),
    );
  }
  return targets;
}
