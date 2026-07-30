/**
 * Repository-resident landing receipts.
 *
 * The gate receipt marker is a worktree-local validation cache. Acceptance
 * publishes the same structured receipt after the trunk fast-forward as a Git
 * note, so the evidence survives worktree cleanup without changing trunk
 * history. All writes are local; this module never fetches or pushes.
 */

import { DISCERN_MACHINE } from "../../shared/brand.ts";
import {
  discernCommitAttributionEnabled,
  type EnvReader,
} from "../../shared/env.ts";
import {
  type Receipt,
  type ReceiptNotesFetchData,
  type ReceiptNoteWriteData,
  ReceiptSchema,
} from "../../shared/result_schemas.ts";
import { splitNulRecords } from "../../shared/git_paths.ts";
import { type GitResult, runGit } from "../../shared/subprocess.ts";

export const RECEIPT_NOTES_REF = "refs/notes/discern";
export const RECEIPT_NOTES_SHORT_REF = "discern";
export const RECEIPT_NOTES_TRACKING_PREFIX = "refs/discern/remotes";

const MANAGED_REMOTE_KEY = "discern.receiptNotesFetchRemote";

function fetchRef(remote: string): string {
  return `${RECEIPT_NOTES_TRACKING_PREFIX}/${remote}/notes`;
}

function fetchMapping(remote: string): string {
  return `+${RECEIPT_NOTES_REF}*:${fetchRef(remote)}*`;
}

function legacyFetchMapping(remote: string): string {
  return `+${RECEIPT_NOTES_REF}:${fetchRef(remote)}`;
}

function gitReason(result: GitResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  return detail === "" ? `git exited with status ${result.code}` : detail;
}

async function configValues(
  root: string,
  key: string,
): Promise<{ values: string[]; error?: string }> {
  const result = await runGit(["config", "--local", "--get-all", key], {
    cwd: root,
  });
  if (result.success) {
    return {
      values: result.stdout.split(/\r?\n/).filter((value) => value !== ""),
    };
  }
  if (result.code === 1) {
    return { values: [] };
  }
  return { values: [], error: gitReason(result) };
}

async function removeFixedConfigValue(
  root: string,
  key: string,
  value: string,
): Promise<string | undefined> {
  const result = await runGit(
    ["config", "--local", "--fixed-value", "--unset-all", key, value],
    { cwd: root },
  );
  if (result.success || result.code === 1) {
    return undefined;
  }
  return gitReason(result);
}

async function replaceFixedConfigValue(
  root: string,
  key: string,
  value: string,
  previous: string,
): Promise<string | undefined> {
  const result = await runGit(
    [
      "config",
      "--local",
      "--fixed-value",
      "--replace-all",
      key,
      value,
      previous,
    ],
    { cwd: root },
  );
  return result.success ? undefined : gitReason(result);
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9._/@%+=:,~-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'\\''`)}'`;
}

function legacyMappingError(
  remote: string,
  key: string,
  mapping: string,
): string {
  return `${key} contains an older receipt-note mapping without discern's ` +
    `ownership marker. This mapping makes \`git fetch ${
      shellArgument(remote)
    }\` fail whenever the remote has no receipt note. Remove it with ` +
    `\`git config --local --fixed-value --unset-all ${shellArgument(key)} ${
      shellArgument(mapping)
    }\`, then run \`discern refresh\` again.`;
}

async function removeManagedRemote(
  root: string,
  remote: string,
  removed: string[],
  errors: string[],
): Promise<void> {
  const key = `remote.${remote}.fetch`;
  const current = await configValues(root, key);
  if (current.error !== undefined) {
    errors.push(`could not read ${key}: ${current.error}`);
    return;
  }
  let mappingRemoved = false;
  for (
    const mapping of [fetchMapping(remote), legacyFetchMapping(remote)]
  ) {
    if (!current.values.includes(mapping)) {
      continue;
    }
    const removalError = await removeFixedConfigValue(root, key, mapping);
    if (removalError !== undefined) {
      errors.push(`could not remove ${key}: ${removalError}`);
      return;
    }
    mappingRemoved = true;
  }
  if (mappingRemoved) {
    pushUnique(removed, key);
  }
  const markerError = await removeFixedConfigValue(
    root,
    MANAGED_REMOTE_KEY,
    remote,
  );
  if (markerError !== undefined) {
    errors.push(
      `could not clear discern's receipt-note marker for ${remote}: ${markerError}`,
    );
  }
}

/**
 * Reconcile the opt-in fetch transport. The trailing wildcard makes the source
 * optional: Git accepts a zero-ref match, while an absent exact positive refspec
 * makes ordinary fetch fail. Only mappings this function marked are migrated or
 * removed. No push key is read or written.
 */
export async function reconcileReceiptNotesFetch(
  root: string,
  mode: "local" | "fetch",
): Promise<ReceiptNotesFetchData> {
  const repository = await runGit(["rev-parse", "--git-dir"], { cwd: root });
  if (!repository.success) {
    return {
      mode,
      status: mode === "fetch" ? "no_remote" : "local",
      remotes: [],
      added: [],
      removed: [],
      errors: [],
    };
  }

  const managedRead = await configValues(root, MANAGED_REMOTE_KEY);
  if (managedRead.error !== undefined) {
    return {
      mode,
      status: "failed",
      remotes: [],
      added: [],
      removed: [],
      errors: [
        `could not read discern's receipt-note markers: ${managedRead.error}`,
      ],
    };
  }

  const managed = new Set(managedRead.values);
  const added: string[] = [];
  const removed: string[] = [];
  const errors: string[] = [];

  const remoteRun = await runGit(["remote"], { cwd: root });
  if (!remoteRun.success) {
    return {
      mode,
      status: "failed",
      remotes: [],
      added,
      removed,
      errors: [`could not list Git remotes: ${gitReason(remoteRun)}`],
    };
  }
  const remotes = remoteRun.stdout.split(/\r?\n/).filter((value) =>
    value !== ""
  )
    .sort();
  const remoteSet = new Set(remotes);

  for (const remote of [...managed].filter((name) => !remoteSet.has(name))) {
    await removeManagedRemote(root, remote, removed, errors);
    managed.delete(remote);
  }

  if (mode === "local") {
    for (const remote of managed) {
      await removeManagedRemote(root, remote, removed, errors);
    }
    return {
      mode,
      status: errors.length > 0 ? "failed" : "local",
      remotes,
      added,
      removed,
      errors,
    };
  }

  for (const remote of remotes) {
    const key = `remote.${remote}.fetch`;
    const mapping = fetchMapping(remote);
    const legacyMapping = legacyFetchMapping(remote);
    const current = await configValues(root, key);
    if (current.error !== undefined) {
      errors.push(`could not read ${key}: ${current.error}`);
      continue;
    }

    const mappingCount = current.values.filter((value) =>
      value === mapping
    ).length;
    const hasLegacyMapping = current.values.includes(legacyMapping);
    if (!managed.has(remote) && hasLegacyMapping) {
      errors.push(legacyMappingError(remote, key, legacyMapping));
      continue;
    }

    if (managed.has(remote)) {
      if (hasLegacyMapping && mappingCount === 0) {
        const migrationError = await replaceFixedConfigValue(
          root,
          key,
          mapping,
          legacyMapping,
        );
        if (migrationError !== undefined) {
          errors.push(
            `could not migrate ${key} to an optional receipt-note mapping: ${migrationError}`,
          );
          continue;
        }
        pushUnique(added, key);
        pushUnique(removed, key);
        continue;
      }

      if (hasLegacyMapping) {
        const removalError = await removeFixedConfigValue(
          root,
          key,
          legacyMapping,
        );
        if (removalError !== undefined) {
          errors.push(
            `could not remove the older receipt-note mapping from ${key}: ${removalError}`,
          );
          continue;
        }
        pushUnique(removed, key);
      }

      if (mappingCount > 1) {
        const normalizeError = await replaceFixedConfigValue(
          root,
          key,
          mapping,
          mapping,
        );
        if (normalizeError !== undefined) {
          errors.push(
            `could not normalize discern's receipt-note mapping in ${key}: ${normalizeError}`,
          );
          continue;
        }
        pushUnique(added, key);
      }

      if (mappingCount > 0) {
        continue;
      }
    } else if (mappingCount > 0) {
      continue;
    }

    let markerAdded = false;
    if (!managed.has(remote)) {
      const marker = await runGit(
        ["config", "--local", "--add", MANAGED_REMOTE_KEY, remote],
        { cwd: root },
      );
      if (!marker.success) {
        errors.push(
          `could not mark ${key} as discern-managed: ${gitReason(marker)}`,
        );
        continue;
      }
      markerAdded = true;
      managed.add(remote);
    }

    const write = await runGit(
      ["config", "--local", "--add", key, mapping],
      { cwd: root },
    );
    if (!write.success) {
      errors.push(`could not add ${key}: ${gitReason(write)}`);
      if (markerAdded) {
        const rollback = await removeFixedConfigValue(
          root,
          MANAGED_REMOTE_KEY,
          remote,
        );
        if (rollback !== undefined) {
          errors.push(
            `could not roll back discern's marker for ${remote}: ${rollback}`,
          );
        }
      }
      continue;
    }
    pushUnique(added, key);
  }

  return {
    mode,
    status: errors.length > 0
      ? "failed"
      : remotes.length === 0
      ? "no_remote"
      : added.length > 0 || removed.length > 0
      ? "wired"
      : "unchanged",
    remotes,
    added,
    removed,
    errors,
  };
}

/** Whether fetch transport reconciliation completed without an error. */
export function receiptNotesFetchSucceeded(
  result: Pick<ReceiptNotesFetchData, "errors">,
): boolean {
  return result.errors.length === 0;
}

/** One deterministic byte representation for every structured receipt note. */
export function canonicalReceiptNote(receipt: Receipt): string {
  return JSON.stringify({
    branch: receipt.branch,
    trunk: receipt.trunk,
    head: receipt.head,
    files_total: receipt.files_total,
    insertions: receipt.insertions,
    deletions: receipt.deletions,
    line: receipt.line,
    markdown: receipt.markdown,
  }) + "\n";
}

function parseReceiptNote(content: string): Receipt | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    const receipt = ReceiptSchema.safeParse(parsed);
    return receipt.success ? receipt.data : undefined;
  } catch {
    return undefined;
  }
}

async function receiptTrackingRefs(root: string): Promise<string[]> {
  const result = await runGit(
    [
      "for-each-ref",
      "--format=%(refname)",
      `${RECEIPT_NOTES_TRACKING_PREFIX}/`,
    ],
    { cwd: root },
  );
  if (!result.success) {
    return [];
  }
  return result.stdout.split(/\r?\n/).filter((ref) =>
    ref.startsWith(`${RECEIPT_NOTES_TRACKING_PREFIX}/`) &&
    ref.endsWith("/notes")
  ).sort();
}

function notesIdentity(
  env: EnvReader,
): Record<string, string> | undefined {
  if (!discernCommitAttributionEnabled(env)) {
    return undefined;
  }
  return {
    GIT_AUTHOR_NAME: DISCERN_MACHINE.name,
    GIT_AUTHOR_EMAIL: DISCERN_MACHINE.email,
    GIT_COMMITTER_NAME: DISCERN_MACHINE.name,
    GIT_COMMITTER_EMAIL: DISCERN_MACHINE.email,
  };
}

/**
 * Merge already-fetched receipt histories, then attach one receipt to the
 * landed commit. Every failure is returned as data; the caller has already
 * moved the trunk and must never roll it back for this record.
 */
export async function writeReceiptNote(
  root: string,
  commit: string,
  receipt: Receipt | undefined,
  env: EnvReader = Deno.env,
): Promise<ReceiptNoteWriteData> {
  if (receipt === undefined) {
    return {
      status: "missing_receipt",
      ref: RECEIPT_NOTES_REF,
      commit,
      merged_refs: [],
      reason: "the validated gate marker carried no structured receipt",
    };
  }

  const identity = notesIdentity(env);
  const mergedRefs: string[] = [];
  for (const ref of await receiptTrackingRefs(root)) {
    const merge = await runGit(
      ["notes", `--ref=${RECEIPT_NOTES_SHORT_REF}`, "merge", ref],
      {
        cwd: root,
        ...(identity === undefined ? {} : { env: identity }),
      },
    );
    if (!merge.success) {
      await runGit(
        ["notes", `--ref=${RECEIPT_NOTES_SHORT_REF}`, "merge", "--abort"],
        { cwd: root },
      );
      return {
        status: "record_failed",
        ref: RECEIPT_NOTES_REF,
        commit,
        merged_refs: mergedRefs,
        reason: `could not merge ${ref}: ${gitReason(merge)}`,
      };
    }
    mergedRefs.push(ref);
  }

  const body = canonicalReceiptNote(receipt);
  const existing = await runGit(
    ["notes", `--ref=${RECEIPT_NOTES_SHORT_REF}`, "show", commit],
    { cwd: root },
  );
  if (existing.success) {
    const parsed = parseReceiptNote(existing.stdout);
    if (parsed !== undefined && canonicalReceiptNote(parsed) === body) {
      return {
        status: "already_present",
        ref: RECEIPT_NOTES_REF,
        commit,
        merged_refs: mergedRefs,
      };
    }
    return {
      status: "record_failed",
      ref: RECEIPT_NOTES_REF,
      commit,
      merged_refs: mergedRefs,
      reason: "the landed commit already has a different receipt note",
    };
  }
  if (existing.code !== 1) {
    return {
      status: "record_failed",
      ref: RECEIPT_NOTES_REF,
      commit,
      merged_refs: mergedRefs,
      reason: `could not inspect the landed receipt note: ${
        gitReason(existing)
      }`,
    };
  }

  const written = await runGit(
    [
      "notes",
      `--ref=${RECEIPT_NOTES_SHORT_REF}`,
      "add",
      "-F",
      "-",
      commit,
    ],
    {
      cwd: root,
      stdin: body,
      ...(identity === undefined ? {} : { env: identity }),
    },
  );
  if (!written.success) {
    return {
      status: "record_failed",
      ref: RECEIPT_NOTES_REF,
      commit,
      merged_refs: mergedRefs,
      reason: gitReason(written),
    };
  }
  return {
    status: "recorded",
    ref: RECEIPT_NOTES_REF,
    commit,
    merged_refs: mergedRefs,
  };
}

export interface LandedReceiptNote {
  readonly commit: string;
  readonly ref: string;
  readonly receipt: Receipt;
}

async function noteContentFromTrackingRef(
  root: string,
  ref: string,
  commit: string,
): Promise<string | undefined> {
  const paths = await notePathsFromRef(root, ref);
  const path = paths.get(commit);
  if (path === undefined) {
    return undefined;
  }
  const blob = await runGit(["show", `${ref}:${path}`], { cwd: root });
  return blob.success ? blob.stdout : undefined;
}

/** Object id → tree path for every note carried by one notes ref. */
async function notePathsFromRef(
  root: string,
  ref: string,
): Promise<Map<string, string>> {
  const tree = await runGit(
    ["ls-tree", "-r", "-z", "--format=%(path)", ref],
    { cwd: root },
  );
  if (!tree.success) {
    return new Map();
  }
  const paths = new Map<string, string>();
  for (const path of splitNulRecords(tree.stdout)) {
    const object = path.replaceAll("/", "");
    if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(object)) {
      paths.set(object, path);
    }
  }
  return paths;
}

/** Read one commit's first valid receipt, preferring local truth. */
export async function readReceiptNoteAt(
  root: string,
  commit: string,
): Promise<LandedReceiptNote | undefined> {
  if (commit === "") {
    return undefined;
  }
  const refs = [RECEIPT_NOTES_REF, ...await receiptTrackingRefs(root)];
  for (const ref of refs) {
    const content = ref === RECEIPT_NOTES_REF
      ? await runGit(
        ["notes", `--ref=${RECEIPT_NOTES_SHORT_REF}`, "show", commit],
        { cwd: root },
      ).then((shown) => shown.success ? shown.stdout : undefined)
      : await noteContentFromTrackingRef(root, ref, commit);
    if (content === undefined) {
      continue;
    }
    const receipt = parseReceiptNote(content);
    if (
      receipt !== undefined &&
      /^[0-9a-f]{7,64}$/u.test(receipt.head) &&
      commit.startsWith(receipt.head)
    ) {
      return { commit, ref, receipt };
    }
  }
  return undefined;
}

/**
 * Find a validated landing for `branch` on the trunk ancestry added after
 * `sinceCommit`. This is the durable bridge across an `await` continuation gap:
 * acceptance writes the receipt note before deleting the worktree and branch.
 */
export async function findLandedReceiptNoteForBranch(
  root: string,
  branch: string,
  trunk: string,
  sinceCommit: string,
): Promise<LandedReceiptNote | undefined> {
  const commits = await runGit(
    [
      "rev-list",
      "--reverse",
      `${sinceCommit}..refs/heads/${trunk}`,
    ],
    { cwd: root },
  );
  if (!commits.success) {
    return undefined;
  }
  for (
    const commit of commits.stdout.split(/\r?\n/).filter((value) =>
      value !== ""
    )
  ) {
    const landed = await readReceiptNoteAt(root, commit);
    if (
      landed?.receipt.branch === branch &&
      landed.receipt.trunk === trunk
    ) {
      return landed;
    }
  }
  return undefined;
}

/**
 * Find the newest accepted landing for a branch after acceptance deleted its
 * ref. Notes narrow the candidate set first; one trunk walk then orders and
 * ancestry-checks them without probing every commit for a note.
 */
export async function findLatestLandedReceiptNoteForBranch(
  root: string,
  branch: string,
  trunk: string,
): Promise<LandedReceiptNote | undefined> {
  const targets = new Set<string>();
  for (const ref of [RECEIPT_NOTES_REF, ...await receiptTrackingRefs(root)]) {
    for (const target of (await notePathsFromRef(root, ref)).keys()) {
      targets.add(target);
    }
  }
  if (targets.size === 0) {
    return undefined;
  }
  const ancestry = await runGit(
    ["rev-list", `refs/heads/${trunk}`],
    { cwd: root },
  );
  if (!ancestry.success) {
    return undefined;
  }
  for (
    const commit of ancestry.stdout.split(/\r?\n/).filter((value) =>
      value !== ""
    )
  ) {
    if (!targets.has(commit)) {
      continue;
    }
    const landed = await readReceiptNoteAt(root, commit);
    if (
      landed?.receipt.branch === branch &&
      landed.receipt.trunk === trunk
    ) {
      return landed;
    }
  }
  return undefined;
}

/** Read the configured trunk tip's first valid receipt, preferring local truth. */
export async function readLandedReceiptNote(
  root: string,
  trunk: string,
): Promise<LandedReceiptNote | undefined> {
  const tip = await runGit(
    ["rev-parse", "--verify", `refs/heads/${trunk}^{commit}`],
    { cwd: root },
  );
  return tip.success
    ? await readReceiptNoteAt(root, tip.stdout.trim())
    : undefined;
}
