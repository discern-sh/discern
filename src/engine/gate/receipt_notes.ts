/**
 * Repository-resident landing receipts.
 *
 * The gate receipt marker is a worktree-local validation cache. Acceptance
 * publishes the same structured receipt after the trunk fast-forward as a Git
 * note, so the evidence survives worktree cleanup without changing trunk
 * history. All writes are local; this module never fetches or pushes.
 */

import { DISCERN_BOT } from "../../shared/brand.ts";
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
import { type GitResult, runGit } from "../../shared/subprocess.ts";

export const RECEIPT_NOTES_REF = "refs/notes/discern";
export const RECEIPT_NOTES_SHORT_REF = "discern";
export const RECEIPT_NOTES_TRACKING_PREFIX = "refs/discern/remotes";

const MANAGED_REMOTE_KEY = "discern.receiptNotesFetchRemote";

function fetchRef(remote: string): string {
  return `${RECEIPT_NOTES_TRACKING_PREFIX}/${remote}/notes`;
}

function fetchMapping(remote: string): string {
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

async function removeManagedRemote(
  root: string,
  remote: string,
  removed: string[],
  errors: string[],
): Promise<void> {
  const key = `remote.${remote}.fetch`;
  const mapping = fetchMapping(remote);
  const current = await configValues(root, key);
  if (current.error !== undefined) {
    errors.push(`could not read ${key}: ${current.error}`);
    return;
  }
  if (current.values.includes(mapping)) {
    const removalError = await removeFixedConfigValue(root, key, mapping);
    if (removalError !== undefined) {
      errors.push(`could not remove ${key}: ${removalError}`);
      return;
    }
    removed.push(key);
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
 * Reconcile the opt-in fetch transport. Only exact mappings this function added
 * are marked and later removable. No push key is read or written.
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
    const current = await configValues(root, key);
    if (current.error !== undefined) {
      errors.push(`could not read ${key}: ${current.error}`);
      continue;
    }
    if (current.values.includes(mapping)) {
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
    added.push(key);
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
    GIT_AUTHOR_NAME: DISCERN_BOT.name,
    GIT_AUTHOR_EMAIL: DISCERN_BOT.email,
    GIT_COMMITTER_NAME: DISCERN_BOT.name,
    GIT_COMMITTER_EMAIL: DISCERN_BOT.email,
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
  const tree = await runGit(["ls-tree", "-r", "--name-only", ref], {
    cwd: root,
  });
  if (!tree.success) {
    return undefined;
  }
  const path = tree.stdout.split(/\r?\n/).find((candidate) =>
    candidate.replaceAll("/", "") === commit
  );
  if (path === undefined) {
    return undefined;
  }
  const blob = await runGit(["show", `${ref}:${path}`], { cwd: root });
  return blob.success ? blob.stdout : undefined;
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
  const commit = tip.success ? tip.stdout.trim() : "";
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
    if (receipt !== undefined) {
      return { commit, ref, receipt };
    }
  }
  return undefined;
}
