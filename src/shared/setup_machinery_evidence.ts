/**
 * Proof for retrying the setup machinery commit after Git rejected its first
 * attempt.
 *
 * The record captures the exact stage-0 blobs discern generated and the whole
 * index tree before the first commit attempt. A later `setup begin` may reuse
 * discern's bot attribution only while HEAD, branch, index, and every candidate
 * worktree blob still match that proof byte-for-byte.
 */

import { dirname } from "@std/path";
import { gitAdminStatePath } from "./git_admin_state.ts";
import { splitNulRecords } from "./git_paths.ts";
import { runGit } from "./subprocess.ts";

const SETUP_MACHINERY_EVIDENCE_VERSION = 1;

interface SetupMachineryIndexEntry {
  readonly path: string;
  readonly mode: string;
  /** The staged, clean-filtered Git blob. */
  readonly oid: string;
}

export interface SetupMachineryEvidenceEntry extends SetupMachineryIndexEntry {
  /** The raw worktree bytes, before any Git clean filter. */
  readonly worktreeOid: string;
}

export interface SetupMachineryCommitEvidence {
  readonly version: typeof SETUP_MACHINERY_EVIDENCE_VERSION;
  readonly branch: string;
  readonly head: string | null;
  readonly indexTree: string;
  readonly entries: readonly SetupMachineryEvidenceEntry[];
}

export type SetupMachineryEvidenceRead =
  | {
    readonly status: "found";
    readonly evidence: SetupMachineryCommitEvidence;
  }
  | { readonly status: "missing" }
  | { readonly status: "invalid" }
  | { readonly status: "unavailable" };

function isOid(value: unknown): value is string {
  return typeof value === "string" &&
    /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

function parseEvidence(raw: string): SetupMachineryCommitEvidence | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== SETUP_MACHINERY_EVIDENCE_VERSION ||
    typeof record.branch !== "string" || record.branch === "" ||
    !(record.head === null || isOid(record.head)) ||
    !isOid(record.indexTree) ||
    !Array.isArray(record.entries) ||
    record.entries.length === 0
  ) {
    return undefined;
  }

  const entries: SetupMachineryEvidenceEntry[] = [];
  const paths = new Set<string>();
  for (const candidate of record.entries) {
    if (
      candidate === null || typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      return undefined;
    }
    const entry = candidate as Record<string, unknown>;
    if (
      typeof entry.path !== "string" || entry.path === "" ||
      entry.path.includes("\0") ||
      typeof entry.mode !== "string" || !/^[0-7]{6}$/.test(entry.mode) ||
      !isOid(entry.oid) || !isOid(entry.worktreeOid) || paths.has(entry.path)
    ) {
      return undefined;
    }
    paths.add(entry.path);
    entries.push({
      path: entry.path,
      mode: entry.mode,
      oid: entry.oid,
      worktreeOid: entry.worktreeOid,
    });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    version: SETUP_MACHINERY_EVIDENCE_VERSION,
    branch: record.branch,
    head: record.head,
    indexTree: record.indexTree,
    entries,
  };
}

async function currentBranch(root: string): Promise<string | undefined> {
  const result = await runGit(["branch", "--show-current"], { cwd: root });
  const branch = result.stdout.trim();
  return result.success && branch !== "" ? branch : undefined;
}

async function currentHead(
  root: string,
): Promise<string | null | undefined> {
  const result = await runGit(["rev-parse", "--verify", "-q", "HEAD"], {
    cwd: root,
  });
  if (result.success) {
    const oid = result.stdout.trim();
    return isOid(oid) ? oid : undefined;
  }
  return result.code === 1 ? null : undefined;
}

async function currentIndexTree(root: string): Promise<string | undefined> {
  const result = await runGit(["write-tree"], { cwd: root });
  const oid = result.stdout.trim();
  return result.success && isOid(oid) ? oid : undefined;
}

async function stagedPaths(root: string): Promise<string[] | undefined> {
  const result = await runGit(
    ["diff", "--cached", "--name-only", "--no-renames", "-z", "--"],
    { cwd: root },
  );
  return result.success ? splitNulRecords(result.stdout).sort() : undefined;
}

function parseIndexEntries(
  stdout: string,
): SetupMachineryIndexEntry[] | undefined {
  const entries: SetupMachineryIndexEntry[] = [];
  const paths = new Set<string>();
  for (const raw of splitNulRecords(stdout)) {
    const separator = raw.indexOf("\t");
    if (separator === -1) {
      return undefined;
    }
    const metadata = raw.slice(0, separator).split(" ");
    const path = raw.slice(separator + 1);
    const mode = metadata[0];
    const oid = metadata[1];
    const stage = metadata[2];
    if (
      mode === undefined || !/^[0-7]{6}$/.test(mode) ||
      oid === undefined || !isOid(oid) ||
      stage !== "0" || path === "" || paths.has(path)
    ) {
      return undefined;
    }
    paths.add(path);
    entries.push({ path, mode, oid });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

async function indexEntries(
  root: string,
  paths: readonly string[],
): Promise<SetupMachineryIndexEntry[] | undefined> {
  const result = await runGit(
    ["ls-files", "--stage", "-z", "--", ...paths],
    { cwd: root },
  );
  return result.success ? parseIndexEntries(result.stdout) : undefined;
}

async function rawWorktreeOid(
  root: string,
  path: string,
): Promise<string | undefined> {
  const result = await runGit(
    ["hash-object", "--no-filters", "--", path],
    { cwd: root },
  );
  const oid = result.stdout.trim();
  return result.success && isOid(oid) ? oid : undefined;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function sameEntries(
  left: readonly SetupMachineryIndexEntry[],
  right: readonly SetupMachineryEvidenceEntry[],
): boolean {
  return left.length === right.length &&
    left.every((entry, index) => {
      const candidate = right[index];
      return candidate !== undefined &&
        entry.path === candidate.path &&
        entry.mode === candidate.mode &&
        entry.oid === candidate.oid;
    });
}

async function worktreeMatches(
  root: string,
  entries: readonly SetupMachineryEvidenceEntry[],
): Promise<boolean> {
  for (const entry of entries) {
    if (await rawWorktreeOid(root, entry.path) !== entry.worktreeOid) {
      return false;
    }
  }
  return true;
}

async function writeEvidence(
  root: string,
  evidence: SetupMachineryCommitEvidence,
): Promise<void> {
  const path = await gitAdminStatePath(root, "setupMachineryCommitEvidence");
  if (path === undefined) {
    throw new Error("Git could not resolve the setup machinery evidence path.");
  }
  await Deno.mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${crypto.randomUUID()}`;
  let cleanupError: unknown;
  try {
    await Deno.writeTextFile(temp, `${JSON.stringify(evidence)}\n`, {
      createNew: true,
    });
    await Deno.rename(temp, path);
  } finally {
    try {
      await Deno.remove(temp);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) {
        cleanupError = error;
      }
    }
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
}

/**
 * Persist the exact staged machinery discern just generated.
 *
 * Refuses evidence when the index contains any staged path outside `allowedPaths`
 * and records each candidate's raw worktree hash separately from its clean-filtered
 * staged blob.
 */
export async function recordSetupMachineryCommitEvidence(
  root: string,
  allowedPaths: readonly string[],
): Promise<SetupMachineryCommitEvidence | undefined> {
  const branch = await currentBranch(root);
  const head = await currentHead(root);
  const indexTree = await currentIndexTree(root);
  const staged = await stagedPaths(root);
  if (
    branch === undefined || head === undefined || indexTree === undefined ||
    staged === undefined || staged.length === 0
  ) {
    return undefined;
  }
  const allowed = new Set(allowedPaths);
  if (staged.some((path) => !allowed.has(path))) {
    return undefined;
  }
  const entries = await indexEntries(root, staged);
  if (
    entries === undefined || !sameStrings(
      entries.map((entry) => entry.path),
      staged,
    )
  ) {
    return undefined;
  }
  const provenEntries: SetupMachineryEvidenceEntry[] = [];
  for (const entry of entries) {
    const worktreeOid = await rawWorktreeOid(root, entry.path);
    if (worktreeOid === undefined) {
      return undefined;
    }
    provenEntries.push({ ...entry, worktreeOid });
  }
  const evidence: SetupMachineryCommitEvidence = {
    version: SETUP_MACHINERY_EVIDENCE_VERSION,
    branch,
    head,
    indexTree,
    entries: provenEntries,
  };
  await writeEvidence(root, evidence);
  return evidence;
}

/** Read the worktree-scoped retry proof. Malformed state never authorizes a commit. */
export async function readSetupMachineryCommitEvidence(
  root: string,
): Promise<SetupMachineryEvidenceRead> {
  const path = await gitAdminStatePath(root, "setupMachineryCommitEvidence");
  if (path === undefined) {
    return { status: "unavailable" };
  }
  try {
    const evidence = parseEvidence(await Deno.readTextFile(path));
    return evidence === undefined
      ? { status: "invalid" }
      : { status: "found", evidence };
  } catch (error) {
    return error instanceof Deno.errors.NotFound
      ? { status: "missing" }
      : { status: "unavailable" };
  }
}

/**
 * Check the retry proof against all state a bare staged-index commit could carry.
 *
 * The whole index tree excludes unrelated staged content. Per-entry index mode/blob
 * checks and worktree hashes prove that every candidate still has the generated
 * bytes from the first attempt.
 */
export async function setupMachineryCommitEvidenceMatches(
  root: string,
  evidence: SetupMachineryCommitEvidence,
): Promise<boolean> {
  const [branch, head, indexTree, staged, entries] = await Promise.all([
    currentBranch(root),
    currentHead(root),
    currentIndexTree(root),
    stagedPaths(root),
    indexEntries(root, evidence.entries.map((entry) => entry.path)),
  ]);
  const expectedPaths = evidence.entries.map((entry) => entry.path);
  return branch === evidence.branch &&
    head === evidence.head &&
    indexTree === evidence.indexTree &&
    staged !== undefined && sameStrings(staged, expectedPaths) &&
    entries !== undefined && sameEntries(entries, evidence.entries) &&
    await worktreeMatches(root, evidence.entries);
}

/** Remove retry authority after its proven staged bytes commit successfully. */
export async function clearSetupMachineryCommitEvidence(
  root: string,
): Promise<boolean> {
  const path = await gitAdminStatePath(root, "setupMachineryCommitEvidence");
  if (path === undefined) {
    return false;
  }
  try {
    await Deno.remove(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }
    throw error;
  }
}
