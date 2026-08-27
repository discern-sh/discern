/**
 * The single source of truth for discern-authored commit sites (ADR 0203) and the only
 * production boundary allowed to invoke `git commit` for them.
 *
 * Callers still own their surrounding workflow: they stage their scoped paths,
 * decide whether a failure is fatal, and perform any rollback. This boundary
 * owns the commit message, attribution, and declared-scope invocation. Most
 * callers use Git pathspecs; a caller with independently proven staged bytes
 * can require an exact staged path set and commit the index as-is.
 */

import { DISCERN_MACHINE } from "./brand.ts";
import { discernAttributionEnabled, type EnvReader } from "./env.ts";
import { splitNulRecords } from "./git_paths.ts";
import {
  describeSpawnError,
  gitBin,
  type GitResult,
  runGit,
  SPAWN_FAILED,
} from "./subprocess.ts";
import { quiesceProcessGroup } from "./process_group.ts";
import { type SecureEntropy, SYSTEM_SECURE_ENTROPY } from "./entropy.ts";

export interface DiscernAuthoredCommitSiteDefinition {
  readonly id: string;
  /** Shipped module allowed to import the commit capability for this site. */
  readonly callerModule: `src/${string}.ts`;
}

/** Every workflow whose diff discern itself composes and commits. */
export const DISCERN_AUTHORED_COMMIT_SITES = {
  scaffoldWiring: {
    id: "scaffold-wiring",
    callerModule: "src/commands/setup.ts",
  },
  setupCompletion: {
    id: "setup-completion",
    callerModule: "src/commands/setup.ts",
  },
  standardsPin: {
    id: "standards-pin",
    callerModule: "src/engine/gate/standards.ts",
  },
  standardsLimitProposal: {
    id: "standards-limit-proposal",
    callerModule: "src/engine/gate/standard_proposals.ts",
  },
  updateRegeneration: {
    id: "update-regeneration",
    callerModule: "src/engine/worktree/git.ts",
  },
} as const satisfies Readonly<
  Record<string, DiscernAuthoredCommitSiteDefinition>
>;

export type DiscernAuthoredCommitSite = typeof DISCERN_AUTHORED_COMMIT_SITES[
  keyof typeof DISCERN_AUTHORED_COMMIT_SITES
];

const DISCERN_OWNED_COMMIT = Symbol("discern-owned-commit");

/**
 * In-memory ownership evidence for the exact commit one invocation authored.
 * The private brand means a caller can retain and return this evidence, but only
 * this module can mint it from the reflog-bound commit verification below.
 */
export interface DiscernOwnedCommit {
  readonly site: DiscernAuthoredCommitSite;
  readonly cwd: string;
  readonly branch: string;
  readonly parent: string | null;
  readonly head: string;
  readonly tree: string;
  readonly pathspecs: readonly string[];
  readonly [DISCERN_OWNED_COMMIT]: true;
}

/** Git's ordinary commit result plus exact ownership on a verified success. */
export type DiscernCommitResult = GitResult & {
  readonly owned?: DiscernOwnedCommit | undefined;
};

/** A safe rollback either removed exactly the owned tip or retained all state. */
export type DiscernOwnedRollbackOutcome =
  | { readonly kind: "rolled-back" }
  | { readonly kind: "retained"; readonly detail: string };

export interface DiscernStagedCommitProof {
  /** Branch whose ref the commit may advance. */
  readonly branch: string;
  /** HEAD before the commit, or null for an unborn branch. */
  readonly head: string | null;
  /** The only tree the resulting commit may contain. */
  readonly tree: string;
}

interface DiscernCommitBaseOptions {
  /** Canonical workflow identity; its registry entry also enrolls the caller. */
  readonly site: DiscernAuthoredCommitSite;
  readonly cwd: string;
  readonly subject: string;
  readonly body?: string;
  /**
   * The exact paths this commit may carry. Empty pathspecs are refused. With
   * `source: "staged-index"`, these paths are an exact staged-set assertion and
   * are deliberately not passed to `git commit`.
   */
  readonly pathspecs: readonly string[];
  /** Injectable environment read for parallel-safe attribution tests. */
  readonly env?: EnvReader;
  /** Cryptographic identity source for the private reflog action. */
  readonly entropy?: SecureEntropy;
}

const authoredCommitSites = new Set<DiscernAuthoredCommitSite>(
  Object.values(DISCERN_AUTHORED_COMMIT_SITES),
);

export type DiscernCommitOptions =
  | DiscernCommitBaseOptions & {
    /** The established pathspec-scoped Git invocation. */
    readonly source?: "worktree-pathspecs";
    readonly stagedProof?: never;
  }
  | DiscernCommitBaseOptions & {
    /**
     * Commit the already-proven index bytes. The helper verifies the staged
     * names before Git runs and the resulting commit tree after hooks run.
     */
    readonly source: "staged-index";
    readonly stagedProof: DiscernStagedCommitProof;
  };

/** Represent a policy refusal as the same structured failure Git callers consume. */
function refusedCommit(
  site: DiscernAuthoredCommitSite,
  reason: string,
): GitResult {
  return {
    success: false,
    code: 2,
    stdout: "",
    stderr: `discern-authored commit site '${site.id}' ${reason}`,
  };
}

/** Run a Git query and accept only nonempty stdout from a successful command. */
async function gitValue(
  cwd: string,
  args: string[],
): Promise<string | undefined> {
  const result = await runGit(args, { cwd });
  const value = result.stdout.trim();
  return result.success && value !== "" ? value : undefined;
}

/** Resolve HEAD, distinguishing an unborn branch from an unreadable repository. */
async function headValue(cwd: string): Promise<string | null | undefined> {
  const result = await runGit(["rev-parse", "--verify", "-q", "HEAD"], {
    cwd,
  });
  if (result.success) {
    const value = result.stdout.trim();
    return value === "" ? undefined : value;
  }
  return result.code === 1 ? null : undefined;
}

/** Resolve a ref, distinguishing an absent ref from an indeterminate lookup. */
async function refValue(
  cwd: string,
  ref: string,
): Promise<string | null | undefined> {
  const result = await runGit(["rev-parse", "--verify", "-q", ref], { cwd });
  if (result.success) {
    const value = result.stdout.trim();
    return value === "" ? undefined : value;
  }
  return result.code === 1 ? null : undefined;
}

interface AuthoredCommitObject {
  readonly parents: readonly string[];
  readonly tree: string;
}

interface CommitInvocationProof {
  readonly branch: string;
  readonly head: string | null;
  /** Exact resulting tree for staged-index commits. */
  readonly expectedTree?: string;
  /** Real index before Git prepares a partial pathspec commit. */
  readonly indexTreeBefore?: string;
}

/** Read a commit's parents and tree only when both Git queries agree on its identity. */
async function authoredCommitObject(
  cwd: string,
  oid: string,
): Promise<AuthoredCommitObject | undefined> {
  const [revision, tree] = await Promise.all([
    runGit(["rev-list", "--parents", "--max-count=1", oid, "--"], { cwd }),
    gitValue(cwd, ["rev-parse", "--verify", `${oid}^{tree}`]),
  ]);
  const fields = revision.stdout.trim().split(/\s+/);
  if (!revision.success || fields[0] !== oid || tree === undefined) {
    return undefined;
  }
  return { parents: fields.slice(1), tree };
}

/**
 * Find the exact commit written by THIS Git invocation, not whichever tip a
 * later hook or process left behind. `git commit` appends the final subject to
 * GIT_REFLOG_ACTION; the action is a per-call UUID and the branch reflog is
 * forced on for this spawn. Reflog output is newest-first, so the oldest match
 * is the commit itself when a hook performs another commit before returning.
 */
async function authoredCommitFromReflog(
  cwd: string,
  branch: string,
  action: string,
): Promise<string | undefined> {
  const result = await runGit(
    [
      "reflog",
      "show",
      "-z",
      "--format=%H%x00%gs",
      `refs/heads/${branch}`,
    ],
    { cwd },
  );
  if (!result.success) {
    return undefined;
  }
  const fields = splitNulRecords(result.stdout);
  if (fields.length % 2 !== 0) {
    return undefined;
  }
  let authored: string | undefined;
  for (let index = 0; index < fields.length; index += 2) {
    const oid = fields[index];
    const summary = fields[index + 1];
    if (
      oid !== undefined && summary !== undefined &&
      summary.startsWith(`${action}:`)
    ) {
      authored = oid;
    }
  }
  return authored;
}

/** List paths introduced against a parent, including the root-commit case. */
async function changedPaths(
  cwd: string,
  parent: string | null,
  commit: string,
): Promise<string[] | undefined> {
  const args = parent === null
    ? [
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--name-only",
      "--no-renames",
      "-r",
      "-z",
      commit,
      "--",
    ]
    : [
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      parent,
      commit,
      "--",
    ];
  const result = await runGit(args, { cwd });
  return result.success ? splitNulRecords(result.stdout) : undefined;
}

interface GitTreeEntry {
  readonly mode: string;
  readonly oid: string;
}

/** Force Git to interpret an arbitrary repository path without pathspec magic. */
function literalPathspec(path: string): string {
  return `:(literal)${path}`;
}

/** Decode one NUL-delimited `ls-tree` record and validate its path, mode, and OID. */
function parseTreeEntry(
  stdout: string,
  path: string,
): GitTreeEntry | null | undefined {
  const records = splitNulRecords(stdout);
  if (records.length === 0) {
    return null;
  }
  if (records.length !== 1) {
    return undefined;
  }
  const record = records[0];
  const separator = record?.indexOf("\t") ?? -1;
  if (record === undefined || separator === -1) {
    return undefined;
  }
  const metadata = record.slice(0, separator).split(" ");
  const mode = metadata[0];
  const oid = metadata[2];
  if (
    record.slice(separator + 1) !== path ||
    mode === undefined || !/^[0-7]{6}$/.test(mode) ||
    oid === undefined || !/^[0-9a-f]+$/.test(oid)
  ) {
    return undefined;
  }
  return { mode, oid };
}

/** Look up one literal path in a committed tree, preserving absent and failed states. */
async function treeEntry(
  cwd: string,
  treeish: string,
  path: string,
): Promise<GitTreeEntry | null | undefined> {
  const result = await runGit(
    ["ls-tree", "-z", treeish, "--", literalPathspec(path)],
    { cwd },
  );
  return result.success ? parseTreeEntry(result.stdout, path) : undefined;
}

/** Read one stage-0 index entry and reject ambiguous or malformed Git output. */
async function indexEntry(
  cwd: string,
  path: string,
): Promise<GitTreeEntry | null | undefined> {
  const result = await runGit(
    ["ls-files", "--stage", "-z", "--", literalPathspec(path)],
    { cwd },
  );
  if (!result.success) {
    return undefined;
  }
  const records = splitNulRecords(result.stdout);
  if (records.length === 0) {
    return null;
  }
  if (records.length !== 1) {
    return undefined;
  }
  const record = records[0];
  const separator = record?.indexOf("\t") ?? -1;
  if (record === undefined || separator === -1) {
    return undefined;
  }
  const metadata = record.slice(0, separator).split(" ");
  const mode = metadata[0];
  const oid = metadata[1];
  const stage = metadata[2];
  if (
    record.slice(separator + 1) !== path ||
    mode === undefined || !/^[0-7]{6}$/.test(mode) ||
    oid === undefined || !/^[0-9a-f]+$/.test(oid) ||
    stage !== "0"
  ) {
    return undefined;
  }
  return { mode, oid };
}

/** Compare Git tree absence or the exact mode-and-object pair needed for safe index restoration. */
function sameTreeEntry(
  left: GitTreeEntry | null,
  right: GitTreeEntry | null,
): boolean {
  return left === null || right === null
    ? left === right
    : left.mode === right.mode && left.oid === right.oid;
}

/**
 * Git's partial-commit index is deliberately separate from the real index.
 * When a hook adds an out-of-scope path, rejecting the commit would otherwise
 * leave its worktree bytes untracked/unstaged. Reapply the exact blob recorded
 * in the rejected commit only when that path's real index still equals both its
 * pre-invocation value and the parent. A pre-existing or concurrent staged
 * value wins instead of being overwritten.
 */
async function preserveHookIndexEntries(
  cwd: string,
  indexTreeBefore: string,
  parent: string | null,
  commit: string,
  paths: readonly string[],
): Promise<string | undefined> {
  for (const path of paths) {
    const [before, parentEntry, committed, current] = await Promise.all([
      treeEntry(cwd, indexTreeBefore, path),
      parent === null ? Promise.resolve(null) : treeEntry(cwd, parent, path),
      treeEntry(cwd, commit, path),
      indexEntry(cwd, path),
    ]);
    if (
      before === undefined || parentEntry === undefined ||
      committed === undefined || current === undefined
    ) {
      return `could not inspect the hook-staged index entry for ${path}`;
    }
    if (
      !sameTreeEntry(before, parentEntry) ||
      !sameTreeEntry(current, before) ||
      sameTreeEntry(current, committed)
    ) {
      continue;
    }
    const update = committed === null
      ? await runGit(["update-index", "--force-remove", "--", path], { cwd })
      : await runGit(
        [
          "update-index",
          "--add",
          "--cacheinfo",
          committed.mode,
          committed.oid,
          path,
        ],
        { cwd },
      );
    if (!update.success) {
      return update.stderr.trim() ||
        `could not preserve the hook-staged index entry for ${path}`;
    }
  }
  return undefined;
}

type RollbackOutcome =
  | { readonly kind: "rolled-back" }
  | { readonly kind: "advanced" }
  | { readonly kind: "failed"; readonly result: GitResult };

/**
 * Remove only the exact commit this invocation wrote. Its first parent is the
 * ref state Git itself observed; using that parent preserves a concurrent
 * advance that happened after the caller's earlier proof. The expected-old CAS
 * can never move a later hook/process tip.
 */
async function rollbackAuthoredCommit(
  cwd: string,
  ref: string,
  committedHead: string,
  parent: string | null,
): Promise<RollbackOutcome> {
  const rollback = parent === null
    ? await runGit(["update-ref", "-d", ref, committedHead], { cwd })
    : await runGit(["update-ref", ref, parent, committedHead], { cwd });
  if (rollback.success) {
    return { kind: "rolled-back" };
  }
  const current = await refValue(cwd, ref);
  if (current !== undefined && current !== committedHead) {
    return { kind: "advanced" };
  }
  return { kind: "failed", result: rollback };
}

/** Render subject, optional body, and the default-on co-author trailer. */
export function discernCommitMessage(
  subject: string,
  body: string | undefined,
  env: EnvReader = Deno.env,
): string {
  const paragraphs = [subject];
  if (body !== undefined && body !== "") {
    paragraphs.push(body);
  }
  if (discernAttributionEnabled(env)) {
    paragraphs.push(DISCERN_MACHINE.trailer);
  }
  return paragraphs.join("\n\n");
}

/** Commit one discern-composed diff without changing author or committer identity. */
export async function commitDiscernChanges(
  options: DiscernCommitOptions,
): Promise<DiscernCommitResult> {
  if (!authoredCommitSites.has(options.site)) {
    return {
      success: false,
      code: 2,
      stdout: "",
      stderr: "The discern-authored commit site is not registered in " +
        "DISCERN_AUTHORED_COMMIT_SITES.",
    };
  }
  if (options.pathspecs.length === 0) {
    return refusedCommit(
      options.site,
      "has no pathspecs; refusing an unscoped commit",
    );
  }
  const expectedPaths = [...options.pathspecs].sort();
  if (new Set(expectedPaths).size !== expectedPaths.length) {
    return refusedCommit(
      options.site,
      "has duplicate declared paths; refusing an ambiguous commit",
    );
  }
  const message = discernCommitMessage(
    options.subject,
    options.body,
    options.env,
  );
  const source = options.source ?? "worktree-pathspecs";
  let proof: CommitInvocationProof;
  if (options.source === "staged-index") {
    const stagedProof = options.stagedProof;
    const staged = await runGit(
      ["diff", "--cached", "--name-only", "--no-renames", "-z", "--"],
      { cwd: options.cwd },
    );
    if (!staged.success) {
      return staged;
    }
    const actual = splitNulRecords(staged.stdout).sort();
    if (
      expectedPaths.length !== actual.length ||
      expectedPaths.some((path, index) => path !== actual[index])
    ) {
      return refusedCommit(
        options.site,
        "staged paths do not match its proven scope; refusing the commit",
      );
    }
    const [branch, head, tree] = await Promise.all([
      gitValue(options.cwd, ["branch", "--show-current"]),
      headValue(options.cwd),
      gitValue(options.cwd, ["write-tree"]),
    ]);
    if (
      branch !== stagedProof.branch ||
      head !== stagedProof.head ||
      tree !== stagedProof.tree
    ) {
      return refusedCommit(
        options.site,
        "staged proof changed before Git ran; refusing the commit",
      );
    }
    proof = {
      branch: stagedProof.branch,
      head: stagedProof.head,
      expectedTree: stagedProof.tree,
    };
  } else {
    const [branch, head, indexTreeBefore] = await Promise.all([
      gitValue(options.cwd, ["branch", "--show-current"]),
      headValue(options.cwd),
      gitValue(options.cwd, ["write-tree"]),
    ]);
    if (
      branch === undefined || head === undefined ||
      indexTreeBefore === undefined
    ) {
      return refusedCommit(
        options.site,
        "could not prove the current branch, parent, and index; refusing the commit",
      );
    }
    proof = {
      branch,
      head,
      indexTreeBefore,
    };
  }
  const reflogAction = `discern authored commit/${
    (options.entropy ?? SYSTEM_SECURE_ENTROPY).uuid()
  }`;
  const args = [
    "-c",
    "core.logAllRefUpdates=always",
    "commit",
    "-m",
    message,
  ];
  if (source === "worktree-pathspecs") {
    args.push("--", ...options.pathspecs.map(literalPathspec));
  }
  const bin = gitBin();
  let output: Deno.CommandOutput;
  try {
    const child = new Deno.Command(bin, {
      args,
      cwd: options.cwd,
      env: { GIT_REFLOG_ACTION: reflogAction },
      stdout: "piped",
      stderr: "piped",
      detached: Deno.build.os !== "windows",
    }).spawn();
    const stdout = new Response(child.stdout).arrayBuffer();
    const stderr = new Response(child.stderr).arrayBuffer();
    const status = await child.status;
    await quiesceProcessGroup(child.pid);
    output = {
      ...status,
      stdout: new Uint8Array(await stdout),
      stderr: new Uint8Array(await stderr),
    };
  } catch (error) {
    return {
      success: false,
      code: SPAWN_FAILED,
      stdout: "",
      stderr: describeSpawnError(error, bin),
    };
  }
  const decoder = new TextDecoder();
  const commit: GitResult = {
    success: output.success,
    code: output.code,
    stdout: decoder.decode(output.stdout),
    stderr: decoder.decode(output.stderr),
  };
  if (!commit.success) {
    return commit;
  }

  const committedHead = await authoredCommitFromReflog(
    options.cwd,
    proof.branch,
    reflogAction,
  );
  if (committedHead === undefined) {
    return {
      success: false,
      code: 2,
      stdout: commit.stdout,
      stderr:
        `discern-authored commit site '${options.site.id}' saw Git report a successful commit but could not identify that exact commit. Discern did not guess at a rollback; inspect the branch before continuing`,
    };
  }
  const object = await authoredCommitObject(options.cwd, committedHead);
  if (object === undefined) {
    return {
      success: false,
      code: 2,
      stdout: commit.stdout,
      stderr:
        `discern-authored commit site '${options.site.id}' saw Git report a successful commit but could not inspect that exact commit. Discern did not guess at a rollback; inspect the branch before continuing`,
    };
  }
  const expectedParents = proof.head === null ? [] : [proof.head];
  const parentMatches = object.parents.length === expectedParents.length &&
    object.parents.every((parent, index) => parent === expectedParents[index]);
  let mismatch: string | undefined;
  let preservationFailure: string | undefined;
  if (!parentMatches) {
    mismatch = "was not the direct child of its proven parent";
  } else if (
    source === "staged-index" && object.tree !== proof.expectedTree
  ) {
    mismatch = "produced a tree outside its proven staged bytes";
  } else if (source === "worktree-pathspecs") {
    const paths = await changedPaths(options.cwd, proof.head, committedHead);
    if (paths === undefined) {
      mismatch = "could not verify the paths in the commit Git created";
    } else {
      const allowed = new Set(expectedPaths);
      const unexpected = paths.filter((path) => !allowed.has(path));
      if (unexpected.length > 0) {
        preservationFailure = proof.indexTreeBefore === undefined
          ? "could not recover the pre-commit index snapshot"
          : await preserveHookIndexEntries(
            options.cwd,
            proof.indexTreeBefore,
            proof.head,
            committedHead,
            unexpected,
          );
        mismatch = `carried paths outside its declared scope: ${
          unexpected.join(", ")
        }${
          preservationFailure === undefined ? "" : ` (${preservationFailure})`
        }`;
      }
    }
  }

  const ref = `refs/heads/${proof.branch}`;
  const [committedBranch, branchHead] = await Promise.all([
    gitValue(options.cwd, ["branch", "--show-current"]),
    refValue(options.cwd, ref),
  ]);
  if (
    mismatch === undefined &&
    committedBranch === proof.branch &&
    branchHead === committedHead
  ) {
    return {
      ...commit,
      owned: {
        site: options.site,
        cwd: options.cwd,
        branch: proof.branch,
        parent: proof.head,
        head: committedHead,
        tree: object.tree,
        pathspecs: expectedPaths,
        [DISCERN_OWNED_COMMIT]: true,
      },
    };
  }
  if (mismatch === undefined) {
    mismatch = "did not remain the exact tip of its proven branch";
  }

  const rollback = await rollbackAuthoredCommit(
    options.cwd,
    ref,
    committedHead,
    object.parents[0] ?? null,
  );
  if (rollback.kind === "advanced") {
    return {
      success: false,
      code: 2,
      stdout: commit.stdout,
      stderr:
        `discern-authored commit site '${options.site.id}' ${mismatch}; the branch advanced beyond that exact commit, so its later tip was left untouched`,
    };
  }
  if (rollback.kind === "failed") {
    return {
      success: false,
      code: rollback.result.code,
      stdout: commit.stdout,
      stderr:
        `discern-authored commit site '${options.site.id}' ${mismatch}, and Git could not safely roll back that exact commit: ${rollback.result.stderr.trim()}`,
    };
  }
  return {
    success: false,
    code: 2,
    stdout: commit.stdout,
    stderr: preservationFailure === undefined
      ? `discern-authored commit site '${options.site.id}' ${mismatch}; the exact commit was rolled back with its index and worktree changes preserved`
      : `discern-authored commit site '${options.site.id}' ${mismatch}; the exact commit was rolled back, but its hook-staged index bytes could not be fully restored. The worktree bytes remain`,
  };
}

/** Distinguish a clean tracked checkout from dirt or an unreadable Git state. */
async function trackedCheckoutIsClean(
  cwd: string,
): Promise<boolean | undefined> {
  const status = await runGit(["status", "--porcelain", "-z"], { cwd });
  return status.success ? status.stdout === "" : undefined;
}

/** Compare one branch ref with the exact commit named by ownership evidence. */
async function ownedCommitStillCurrent(
  owned: DiscernOwnedCommit,
): Promise<string | undefined> {
  const [branch, head, object, clean] = await Promise.all([
    gitValue(owned.cwd, ["branch", "--show-current"]),
    refValue(owned.cwd, `refs/heads/${owned.branch}`),
    authoredCommitObject(owned.cwd, owned.head),
    trackedCheckoutIsClean(owned.cwd),
  ]);
  if (branch !== owned.branch) {
    return `the checkout is no longer on the discern-owned branch '${owned.branch}'`;
  }
  if (head !== owned.head) {
    return `the branch moved after discern authored ${owned.head}`;
  }
  if (clean !== true) {
    return clean === false
      ? "the checkout changed after the discern-owned commit"
      : "Git could not prove the checkout remained clean";
  }
  if (
    object === undefined || object.tree !== owned.tree ||
    object.parents.length !== (owned.parent === null ? 0 : 1) ||
    (owned.parent !== null && object.parents[0] !== owned.parent)
  ) {
    return "the commit object no longer matches discern's ownership evidence";
  }
  const paths = await changedPaths(owned.cwd, owned.parent, owned.head);
  if (
    paths === undefined || paths.length !== owned.pathspecs.length ||
    paths.some((path, index) => path !== owned.pathspecs[index])
  ) {
    return "the commit's changed paths no longer match discern's owned scope";
  }
  return undefined;
}

/**
 * Remove one exact discern-authored tip and restore its sampled predecessor.
 *
 * This is deliberately narrower than a reset: the branded commit must remain
 * the clean tip of its original checked-out branch, its parent/tree/path scope
 * must still match, and the ref move uses an expected-old compare-and-swap. If
 * any fact changed, every byte and ref stays where it is for explicit recovery.
 */
export async function rollbackDiscernOwnedCommit(
  owned: DiscernOwnedCommit,
): Promise<DiscernOwnedRollbackOutcome> {
  if (owned[DISCERN_OWNED_COMMIT] !== true) {
    return { kind: "retained", detail: "commit ownership is unavailable" };
  }
  if (owned.parent === null) {
    return {
      kind: "retained",
      detail: "the owned commit has no predecessor to restore",
    };
  }
  const changed = await ownedCommitStillCurrent(owned);
  if (changed !== undefined) {
    return { kind: "retained", detail: changed };
  }

  const ref = `refs/heads/${owned.branch}`;
  const moved = await runGit(
    [
      "update-ref",
      "-m",
      `discern: roll back owned ${owned.site.id}`,
      ref,
      owned.parent,
      owned.head,
    ],
    { cwd: owned.cwd },
  );
  if (!moved.success) {
    return {
      kind: "retained",
      detail: moved.stderr.trim() || "Git refused the exact branch rollback",
    };
  }

  const checkout = await runGit(
    ["read-tree", "-u", "-m", owned.head, owned.parent],
    { cwd: owned.cwd },
  );
  if (checkout.success) {
    return { kind: "rolled-back" };
  }

  const restoredRef = await runGit(
    [
      "update-ref",
      "-m",
      `discern: retain owned ${owned.site.id}`,
      ref,
      owned.head,
      owned.parent,
    ],
    { cwd: owned.cwd },
  );
  if (restoredRef.success) {
    await runGit(["read-tree", "-u", "-m", owned.parent, owned.head], {
      cwd: owned.cwd,
    });
  }
  return {
    kind: "retained",
    detail: restoredRef.success
      ? `Git could not restore the predecessor checkout (${
        checkout.stderr.trim() || "read-tree failed"
      }); the owned commit remains current`
      : `Git moved the ref to the predecessor but could not restore its checkout, and the exact ref rollback also failed (${
        restoredRef.stderr.trim() || "update-ref failed"
      })`,
  };
}
