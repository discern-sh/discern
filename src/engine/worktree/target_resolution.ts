/**
 * Shared resolution of a user-supplied line-of-work name.
 *
 * A registered worktree has several stable public names: its discern id, path,
 * local branch, and full local ref. Product surfaces consume this authority with
 * a mode instead of rebuilding a partial matcher and forcing callers to guess
 * which vocabulary that command happened to choose.
 */

import { basename, isAbsolute, resolve } from "@std/path";
import { realPathIfExists } from "../../shared/fs_presence.ts";
import {
  deriveTrunkIdentity,
  type IdentitySettings,
  loadIdentitySettings,
  normalizeWorktreeId,
  resolveWorktreeId,
} from "./identity.ts";
import {
  inspectCommitRef,
  listRegisteredWorktrees,
  type RegisteredWorktree,
  registeredWorktreeId,
  WorktreeGitError,
} from "./git.ts";
import { listParkedTaskMetadata } from "./parked_task_metadata.ts";

/** What kind of canonical object a consuming command can use. */
export type WorktreeTargetMode = "registered" | "branch" | "commit";

/** Caller-specific bounds around the shared vocabulary. */
export interface WorktreeTargetOptions {
  /** Directory against which a relative path is interpreted. */
  cwd: string;
  mode: WorktreeTargetMode;
  /** Registered mode only: whether the main checkout may be selected. */
  includeMain?: boolean;
  /** Product command used in a refusal and its exact next action. */
  command: string;
}

/** The canonical facts a target supplied enough evidence to identify. */
export interface ResolvedWorktreeTarget {
  input: string;
  /** Stable discern id when the target is or was a discern worktree. */
  id?: string;
  /** Canonical path while a checkout is registered. */
  path?: string;
  /** Short local branch name. */
  branch?: string;
  /** Canonical full ref for a named ref, otherwise the original commit-ish. */
  ref: string;
  /** Resolved commit when Git can still observe it. */
  commit?: string;
  /** Whether the registered checkout is the repository's main checkout. */
  isMain?: boolean;
}

/** A refusal to guess between line-of-work identities. */
export class WorktreeTargetError extends WorktreeGitError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorktreeTargetError";
  }
}

interface TargetCandidate extends ResolvedWorktreeTarget {
  /** Human-readable canonical identity for ambiguity output. */
  label: string;
  /** The caller supplied this row's branch/ref, rather than another alias. */
  directRef: boolean;
}

/** Resolve the stable discern id for one live registration. */
async function registrationId(
  root: string,
  row: RegisteredWorktree,
  settings: IdentitySettings,
): Promise<string | undefined> {
  if (row.isMain) return deriveTrunkIdentity(settings).id;
  try {
    return await resolveWorktreeId(settings, row.path);
  } catch {
    // A damaged checkout may still carry authoritative Git-admin identity.
    return await registeredWorktreeId(row.path, root, settings);
  }
}

/** A path spelling only participates when it can plausibly be a path. */
async function canonicalPathInput(
  cwd: string,
  input: string,
): Promise<string | undefined> {
  if (!(isAbsolute(input) || input.includes("/") || input === ".")) {
    return undefined;
  }
  const absolute = resolve(cwd, input);
  return await realPathIfExists(absolute) ?? absolute.replace(/\/+$/, "");
}

/** Live registrations matching any stable spelling, deduplicated by path. */
async function matchingRegistrations(
  root: string,
  input: string,
  options: WorktreeTargetOptions,
): Promise<TargetCandidate[]> {
  const wantedPath = await canonicalPathInput(options.cwd, input);
  const settings = await loadIdentitySettings(root);
  const matches = new Map<string, TargetCandidate>();
  for (const row of await listRegisteredWorktrees(root)) {
    if (options.mode === "registered" && !options.includeMain && row.isMain) {
      continue;
    }
    const id = await registrationId(root, row, settings);
    const names = new Set([
      row.path,
      basename(row.path),
      row.branch,
      row.ref,
      ...(id === undefined ? [] : [id]),
    ].filter((value) => value !== ""));
    if (!names.has(input) && wantedPath !== row.path) continue;
    matches.set(row.path, {
      input,
      ...(id === undefined ? {} : { id }),
      path: row.path,
      ...(row.branch === "" ? {} : { branch: row.branch }),
      ref: row.ref === "" ? row.head : row.ref,
      commit: row.head,
      isMain: row.isMain,
      label: row.branch === ""
        ? `${row.path} at ${row.head}`
        : `${row.branch} (${row.path})`,
      directRef: input === row.branch || input === row.ref,
    });
  }
  return [...matches.values()];
}

/** Parked lines of work still have an id, branch, ref, and immutable head. */
async function matchingParked(
  root: string,
  input: string,
): Promise<TargetCandidate[]> {
  const matches = new Map<string, TargetCandidate>();
  let records: Awaited<ReturnType<typeof listParkedTaskMetadata>>;
  try {
    records = await listParkedTaskMetadata(root);
  } catch (error) {
    throw new WorktreeTargetError(
      `discern could not read retained Park identity while resolving '${input}': ${
        error instanceof Error ? error.message : String(error)
      } Run \`discern doctor\`, repair the metadata store, then re-run.`,
      { cause: error },
    );
  }
  for (const row of records) {
    const ref = `refs/heads/${row.branch}`;
    if (![row.id, row.branch, ref].includes(input)) continue;
    matches.set(row.branch, {
      input,
      id: row.id,
      branch: row.branch,
      ref,
      commit: row.head,
      label: `${row.branch} (parked worktree ${row.id})`,
      directRef: input === row.branch || input === ref,
    });
  }
  return [...matches.values()];
}

/** A bare stable id may still identify its conventionally named local branch. */
async function matchingDerivedBranch(
  root: string,
  input: string,
): Promise<TargetCandidate | undefined> {
  const branch = await conventionalBranchForWorktreeId(root, input);
  if (branch === undefined) return undefined;
  const ref = `refs/heads/${branch}`;
  const resolved = await inspectCommitRef(root, ref);
  if (resolved.kind !== "resolved") return undefined;
  return {
    input,
    id: input,
    branch,
    ref,
    commit: resolved.commit,
    label: `${branch} (worktree id ${input})`,
    directRef: false,
  };
}

/** Map an exact valid worktree id to its configured conventional branch. */
export async function conventionalBranchForWorktreeId(
  root: string,
  input: string,
): Promise<string | undefined> {
  if (input.includes("/")) return undefined;
  const id = normalizeWorktreeId(input);
  if (id === undefined || id !== input) return undefined;
  const settings = await loadIdentitySettings(root);
  return `${settings.branchPrefix}${id}`;
}

/**
 * The registered checkout that durably belongs to `branch`, including a
 * managed checkout temporarily detached from it — candidate installation
 * detaches HEAD while the effort's identity keeps naming its branch. Returns
 * undefined when no registration matches; a detached checkout whose durable
 * identity names another branch never matches.
 */
export async function worktreePathForEffortBranch(
  root: string,
  branch: string,
): Promise<string | undefined> {
  for (const row of await listRegisteredWorktrees(root)) {
    if (row.branch === branch) return row.path;
  }
  const settings = await loadIdentitySettings(root);
  if (!branch.startsWith(settings.branchPrefix)) return undefined;
  const id = branch.slice(settings.branchPrefix.length);
  if (normalizeWorktreeId(id) !== id) return undefined;
  for (const row of await listRegisteredWorktrees(root)) {
    if (row.isMain || row.branch !== "") continue;
    const registered = await registrationId(root, row, settings);
    if (registered === id) return row.path;
  }
  return undefined;
}

/** Refuse a token whose collected evidence names several canonical targets. */
function ambiguous(
  input: string,
  command: string,
  candidates: readonly string[],
): WorktreeTargetError {
  return new WorktreeTargetError(
    `\`${command}\` can't resolve '${input}': it is ambiguous between ${
      candidates.join(" and ")
    }. Pass one of these paths or a full ref, then re-run.`,
  );
}

/**
 * Resolve an id, path, local branch, or full local ref under one contract.
 * Commit consumers retain Git's broader vocabulary (tags, SHAs, expressions).
 */
export async function resolveWorktreeTarget(
  root: string,
  target: string,
  options: WorktreeTargetOptions,
): Promise<ResolvedWorktreeTarget> {
  const input = target.trim();
  if (input === "") {
    throw new WorktreeTargetError(
      `${options.command} needs a target. Pass a worktree id, path, branch, or full local ref, then re-run.`,
    );
  }

  const live = await matchingRegistrations(root, input, options);
  if (live.length > 1) {
    throw ambiguous(input, options.command, live.map((row) => row.label));
  }
  if (options.mode === "registered") {
    const match = live[0];
    if (match !== undefined) return match;
    const known = (await listRegisteredWorktrees(root))
      .filter((row) => options.includeMain || !row.isMain)
      .map((row) => row.branch === "" ? row.path : row.branch)
      .join(", ");
    throw new WorktreeTargetError(
      `No worktree matches '${target}'. Known worktrees: ${
        known === "" ? "none" : known
      }. Pass a listed worktree's id, path, branch, or full local ref, then re-run.`,
    );
  }

  const parked = await matchingParked(root, input);
  let derived = await matchingDerivedBranch(root, input);
  let liveCandidates = live;
  // A managed checkout temporarily detached from its branch (candidate
  // installation) and that branch's own name are one line of work, not an
  // ambiguity: resolve the durable branch and keep the checkout's path.
  const detached = live.length === 1 && live[0]?.branch === undefined &&
      live[0]?.id !== undefined
    ? live[0]
    : undefined;
  const durable = derived;
  if (
    detached !== undefined && durable !== undefined &&
    durable.id === detached.id
  ) {
    liveCandidates = [];
    derived = {
      ...durable,
      ...(detached.path === undefined ? {} : { path: detached.path }),
      ...(detached.isMain === undefined ? {} : { isMain: detached.isMain }),
      directRef: detached.directRef || durable.directRef,
    };
  }
  const aliases = new Map<string, TargetCandidate>();
  for (
    const candidate of [
      ...liveCandidates,
      ...parked,
      ...(derived === undefined ? [] : [derived]),
    ]
  ) {
    aliases.set(candidate.ref, candidate);
  }
  const aliasCandidates = [...aliases.values()];
  const worktree = aliasCandidates[0];
  if (aliasCandidates.length > 1) {
    throw ambiguous(
      input,
      options.command,
      aliasCandidates.map((row) => row.label),
    );
  }

  const gitRef = await inspectCommitRef(root, input);
  if (gitRef.kind === "ambiguous") {
    throw ambiguous(input, options.command, [...gitRef.candidates]);
  }
  if (gitRef.kind === "resolved") {
    const sameWorktreeRef = worktree?.ref === gitRef.ref;
    if (worktree !== undefined && !sameWorktreeRef) {
      throw ambiguous(input, options.command, [worktree.label, gitRef.ref]);
    }
    if (options.mode === "branch") {
      if (!gitRef.ref.startsWith("refs/heads/")) {
        throw new WorktreeTargetError(
          `'${target}' names ${gitRef.ref}, not a local branch. Pass a worktree id, path, local branch, or full local branch ref, then re-run ${options.command}.`,
        );
      }
      return worktree ?? {
        input,
        branch: gitRef.ref.slice("refs/heads/".length),
        ref: input,
        commit: gitRef.commit,
      };
    }
    if (worktree?.directRef) {
      return { ...worktree, ref: input, commit: gitRef.commit };
    }
    return worktree ?? {
      input,
      ...(gitRef.ref.startsWith("refs/heads/")
        ? { branch: gitRef.ref.slice("refs/heads/".length) }
        : {}),
      ref: input,
      commit: gitRef.commit,
    };
  }

  if (worktree !== undefined) return worktree;
  if (options.mode === "branch") {
    // Preserve the established recovery contract for a branch Git has already
    // deleted: await may still identify it through a durable landing proof.
    const branch = input.startsWith("refs/heads/")
      ? input.slice("refs/heads/".length)
      : input;
    return { input, branch, ref: `refs/heads/${branch}` };
  }
  throw new WorktreeTargetError(
    `Unknown ref '${target}', and no worktree matches it. It doesn't identify a branch, tag, commit, registered worktree, or parked worktree in this repository. List worktrees with \`discern status\` or local refs with \`git branch\`, choose one, then re-run ${options.command}.` +
      (gitRef.evidence === "" ? "" : `\n(git: ${gitRef.evidence})`),
  );
}
