/**
 * The fleet change probe: a cheap fingerprint of what a status survey reads.
 *
 * A fleet survey spawns a few hundred Git processes. The probe spawns one per
 * checkout plus two and stats a few hundred files at most. Two equal
 * fingerprints mean a survey taken at the second would read the repository
 * the first one did:
 *
 * - the same registrations and HEADs (`git worktree list`) and refs
 *   (`git for-each-ref`), and each checkout's reflog for its HEAD;
 * - the same working-tree changes, read with the snapshot's own `git status`
 *   arguments, and the same modification time and size for each path it
 *   lists, the times status takes a checkout's last activity from;
 * - the same discern state, each administration entry read as the registry's
 *   `changeProbe` declares;
 * - the same ignored files status reads: env files and materialized skills;
 * - the same retired checkout paths, each through the bounded inspection
 *   status reports a reappeared path from.
 *
 * The clock is not an input. A survey also derives facts from it, such as a
 * task turning stale after days idle, so a caller still surveys on a ceiling.
 * `tests/engine_fleet_fingerprint_test.ts` records every path a survey of its
 * fixture reads and fails when one falls outside what this probe watches.
 */

import { join } from "@std/path";
import {
  loadConfig,
  resolveConfiguredAgents,
} from "../../shared/config_schema.ts";
import { observeFleet } from "../../shared/fleet_observation.ts";
import {
  GIT_ADMIN_STATE,
  GIT_ADMIN_STATE_KEYS,
  type GitAdminChangeProbe,
} from "../../shared/git_admin_paths.ts";
import { parsePorcelainZ } from "../../shared/git_paths.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { type GitResult, runGit } from "../../shared/subprocess.ts";
import { skillsDirsForAgents } from "../../lib/providers.ts";
import { parseWorktreeList, resolveCommonGitDir } from "../worktree/git.ts";
import {
  readRetiredWorktreePathRecords,
  retiredPathState,
} from "../worktree/retired_paths.ts";

/** The Git boundary the probe reads through. */
export type FleetFingerprintGit = (
  args: readonly string[],
  cwd: string,
) => Promise<GitResult>;

/**
 * The probe's Git reads. None takes a lock: a background reader must never
 * hold the index lock a concurrent commit in the same checkout needs.
 */
export const FLEET_FINGERPRINT_GIT: FleetFingerprintGit = (
  args: readonly string[],
  cwd: string,
): Promise<GitResult> =>
  runGit([...args], { cwd, env: { GIT_OPTIONAL_LOCKS: "0" } });

/** The registrations, HEADs and branches of every checkout. */
const WORKTREE_LIST = ["worktree", "list", "--porcelain"] as const;
/** Every ref and the object it names. */
const REFS = ["for-each-ref", "--format=%(objectname) %(refname)"] as const;
/** One checkout's changes, exactly as the status snapshot reads them. */
const CHECKOUT_STATUS = [
  "status",
  "--porcelain",
  "-z",
  "--untracked-files=normal",
] as const;

/** How far the probe reads under one filesystem input. */
export type FleetFingerprintDepth =
  | "self"
  | "entries"
  | "contents"
  | "retired";

/** One filesystem input of the fingerprint. */
export interface FleetFingerprintPath {
  readonly path: string;
  /**
   * `self`: the path's own metadata; `entries`: also each immediate
   * subdirectory's; `contents`: every file and directory under it; `retired`:
   * the bounded inspection status reports a reappeared checkout path from.
   */
  readonly depth: FleetFingerprintDepth;
}

/** Where one fleet's fingerprint looks. */
export interface FleetFingerprintLayout {
  /** Every registered checkout, the main checkout first, as Git lists them. */
  readonly checkouts: readonly string[];
  readonly commonDir: string;
  /**
   * Each checkout's administration directory: the common directory for the
   * main checkout, then every `worktrees/<id>` registration directory.
   */
  readonly adminDirs: readonly string[];
  /** The env files status reads in every checkout. */
  readonly envFiles: readonly string[];
  /** The materialized skills directories status compares in the main checkout. */
  readonly skillDirs: readonly string[];
  /** Checkout paths retired by removal, whose reappearance status reports. */
  readonly retiredPaths: readonly string[];
}

/** The depth an administration entry's `changeProbe` asks for, if any. */
function adminDepth(
  probe: GitAdminChangeProbe,
): FleetFingerprintDepth | undefined {
  switch (probe) {
    case "contents":
      return "contents";
    case "entries":
      return "entries";
    case "addressed":
    case "unread":
      return undefined;
  }
}

/**
 * Every filesystem input of one fleet's fingerprint, in a stable order. Git's
 * own refs and HEADs are read through Git; a checkout's reflog for its HEAD,
 * the repository configuration, and discern's administration state are read
 * here.
 */
export function fleetFingerprintPaths(
  layout: FleetFingerprintLayout,
): FleetFingerprintPath[] {
  const paths: FleetFingerprintPath[] = [
    { path: join(layout.commonDir, "config"), depth: "self" },
  ];
  for (const key of GIT_ADMIN_STATE_KEYS) {
    const entry = GIT_ADMIN_STATE[key];
    const depth = adminDepth(entry.changeProbe);
    if (depth === undefined) continue;
    const owners = entry.scope === "common"
      ? [layout.commonDir]
      : layout.adminDirs;
    for (const owner of owners) {
      paths.push({ path: join(owner, entry.path), depth });
    }
  }
  for (const admin of layout.adminDirs) {
    paths.push({ path: join(admin, "logs", "HEAD"), depth: "self" });
  }
  for (const checkout of layout.checkouts) {
    for (const file of layout.envFiles) {
      paths.push({ path: join(checkout, file), depth: "self" });
    }
  }
  const main = layout.checkouts[0];
  if (main !== undefined) {
    for (const dir of layout.skillDirs) {
      paths.push({ path: join(main, dir), depth: "contents" });
    }
  }
  for (const retired of layout.retiredPaths) {
    paths.push({ path: retired, depth: "retired" });
  }
  return paths;
}

/** Why a path could not be read, as a fingerprint line names it. */
function unreadable(path: string, error: unknown): string {
  return `${path}\t${
    error instanceof Deno.errors.NotFound
      ? "absent"
      : error instanceof Error
      ? error.name
      : "unreadable"
  }`;
}

/** One path's metadata as a fingerprint line; an unreadable path says why. */
async function statLine(path: string): Promise<{
  readonly line: string;
  readonly info?: Deno.FileInfo;
}> {
  try {
    const info = await Deno.lstat(path);
    const kind = info.isDirectory ? "d" : info.isSymlink ? "l" : "f";
    return {
      line: `${path}\t${kind}\t${info.mtime?.getTime() ?? ""}\t${info.size}\t${
        info.ino ?? ""
      }`,
      info,
    };
  } catch (error) {
    return { line: unreadable(path, error) };
  }
}

/** A directory's entries in name order, or the line saying why it can't be listed. */
async function listing(path: string): Promise<{
  readonly entries: readonly Deno.DirEntry[];
  readonly failure?: string;
}> {
  const entries: Deno.DirEntry[] = [];
  try {
    for await (const entry of Deno.readDir(path)) entries.push(entry);
  } catch (error) {
    return { entries: [], failure: unreadable(path, error) };
  }
  return {
    entries: entries.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    ),
  };
}

/** The fingerprint lines for one input, read to its depth. */
async function pathLines(input: FleetFingerprintPath): Promise<string[]> {
  if (input.depth === "retired") {
    return [`${input.path}\t${await retiredPathState(input.path)}`];
  }
  const own = await statLine(input.path);
  if (input.depth === "self" || own.info?.isDirectory !== true) {
    return [own.line];
  }
  const lines = [own.line];
  const listed = await listing(input.path);
  if (listed.failure !== undefined) lines.push(listed.failure);
  for (const entry of listed.entries) {
    const child = join(input.path, entry.name);
    if (input.depth === "contents") {
      lines.push(...await pathLines({ path: child, depth: "contents" }));
    } else if (entry.isDirectory) {
      lines.push((await statLine(child)).line);
    }
  }
  return lines;
}

/** One Git read as fingerprint lines: its outcome and exact output. */
function gitLines(label: string, run: GitResult): string[] {
  return [
    `${label}\t${run.code}`,
    run.stdout,
    run.success ? "" : run.stderr,
  ];
}

/** One checkout's changes and each changed path's metadata. */
async function checkoutLines(
  checkout: string,
  git: FleetFingerprintGit,
): Promise<string[]> {
  const run = await git(CHECKOUT_STATUS, checkout);
  const lines = gitLines(`status ${checkout}`, run);
  if (!run.success) return lines;
  for (const entry of parsePorcelainZ(run.stdout)) {
    lines.push((await statLine(join(checkout, entry.path))).line);
  }
  return lines;
}

/** The registration directories under the common directory, in name order. */
async function registrationDirs(commonDir: string): Promise<string[]> {
  const root = join(commonDir, "worktrees");
  return (await listing(root)).entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => join(root, entry.name));
}

/**
 * Where one fleet's fingerprint looks, read from its registrations, its
 * configuration and its retired-path records. `undefined` when the
 * repository's common directory cannot be found.
 */
export async function fleetFingerprintLayout(
  root: string,
  checkouts: readonly string[],
): Promise<FleetFingerprintLayout | undefined> {
  const commonDir = await resolveCommonGitDir(root);
  if (commonDir === undefined) return undefined;
  const config = await loadConfig(root);
  const retired = await readRetiredWorktreePathRecords(root);
  return {
    checkouts,
    commonDir,
    adminDirs: [commonDir, ...await registrationDirs(commonDir)],
    envFiles: config.worktree.env_files,
    skillDirs: skillsDirsForAgents(resolveConfiguredAgents(config)),
    retiredPaths: retired.map((record) => record.path),
  };
}

/**
 * The fingerprint of the fleet whose main checkout is `root`: a digest that
 * changes whenever a status survey would read different repository state.
 * `undefined` when the probe cannot read the fleet at all, so a caller
 * surveys instead.
 */
export async function fleetFingerprint(
  root: string,
  git: FleetFingerprintGit = FLEET_FINGERPRINT_GIT,
): Promise<string | undefined> {
  const [listed, refs] = await Promise.all([
    git(WORKTREE_LIST, root),
    git(REFS, root),
  ]);
  if (!listed.success) return undefined;
  const checkouts = parseWorktreeList(listed.stdout).map((record) =>
    record.path
  );
  const layout = await fleetFingerprintLayout(root, checkouts);
  if (layout === undefined) return undefined;
  const [changes, inputs] = await Promise.all([
    observeFleet(checkouts, (checkout) => checkoutLines(checkout, git)),
    observeFleet(fleetFingerprintPaths(layout), pathLines),
  ]);
  return await sha256Hex(
    [
      ...gitLines("worktrees", listed),
      ...gitLines("refs", refs),
      ...changes.flat(),
      ...inputs.flat(),
    ].join("\n"),
  );
}
