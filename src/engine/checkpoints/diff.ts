/**
 * Collect the **effort diff** the trigger engine evaluates: everything that
 * changed between the effort's merge-base with the trunk and the current
 * working tree — committed, staged, unstaged, and untracked alike — plus the
 * merge-base tree listing the name-similarity predicate compares against.
 *
 * Git speaks toplevel-relative paths and the engine speaks root-relative ones,
 * so every listing is read NUL-separated (the shared `git_paths.ts` decoders)
 * and normalized through the scope classifier's prefix helpers. Rename
 * detection stays OFF (`--no-renames`), matching the classifier: a rename is a
 * deletion plus an addition, so a vacated path never silently leaves the
 * change set.
 *
 * Returns `undefined` whenever git cannot answer — the caller FAILS OPEN (no
 * checkpoint fires on unknowable state); a single unreadable untracked file
 * degrades to a binary entry rather than discarding the whole diff.
 */

import { join } from "@std/path";
import { runGit } from "../../shared/subprocess.ts";
import { parsePorcelainZ, splitNulRecords } from "../../shared/git_paths.ts";
import { repoPathPrefix, stripRepoPathPrefix } from "../scopes/scopes.ts";
import type {
  EffortChangeKind,
  EffortDiff,
  EffortFileChange,
} from "./types.ts";

/** Bytes of an untracked file inspected for a NUL byte — git's own text/binary
 * heuristic window. */
const BINARY_SNIFF_BYTES = 8000;

/** Map one `--name-status` letter to the effort-diff change kind. Everything
 * that is neither an addition nor a deletion (modification, type change,
 * unmerged) reads as modified — the conservative kind. */
function changeKind(status: string): EffortChangeKind {
  if (status.startsWith("A")) {
    return "added";
  }
  if (status.startsWith("D")) {
    return "deleted";
  }
  return "modified";
}

/** Parse `git diff --name-status --no-renames -z` output: records alternate
 * STATUS, PATH (rename records would carry a second path, but rename
 * detection is off). */
function parseNameStatusZ(stdout: string): { status: string; path: string }[] {
  const tokens = splitNulRecords(stdout);
  const out: { status: string; path: string }[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const status = tokens[i];
    const path = tokens[i + 1];
    if (status !== undefined && path !== undefined) {
      out.push({ status, path });
    }
  }
  return out;
}

/** Parse one `--numstat -z` record: `<insertions> TAB <deletions> TAB <path>`,
 * `-` marking a binary side. A path may contain a TAB, so only the first two
 * separators are structural. */
function parseNumstatRecord(
  record: string,
): { insertions: number; deletions: number; binary: boolean; path: string } {
  const first = record.indexOf("\t");
  const second = first === -1 ? -1 : record.indexOf("\t", first + 1);
  if (first === -1 || second === -1) {
    return { insertions: 0, deletions: 0, binary: false, path: record };
  }
  const ins = record.slice(0, first);
  const del = record.slice(first + 1, second);
  const binary = ins === "-" || del === "-";
  return {
    insertions: binary ? 0 : Number(ins) || 0,
    deletions: binary ? 0 : Number(del) || 0,
    binary,
    path: record.slice(second + 1),
  };
}

/** Line count and binary-ness of one untracked file's bytes. */
function untrackedStats(
  bytes: Uint8Array,
): { insertions: number; binary: boolean } {
  const window = bytes.subarray(0, BINARY_SNIFF_BYTES);
  if (window.includes(0)) {
    return { insertions: 0, binary: true };
  }
  if (bytes.length === 0) {
    return { insertions: 0, binary: false };
  }
  let lines = 0;
  for (const byte of bytes) {
    if (byte === 0x0a) {
      lines++;
    }
  }
  if (bytes[bytes.length - 1] !== 0x0a) {
    lines++;
  }
  return { insertions: lines, binary: false };
}

/**
 * Collect the effort diff at `root` against `mergeBase` (the effort's
 * merge-base commit with the trunk — the same commit whose configuration
 * governs the checkpoints, so the diff and the policy describe one boundary).
 * `undefined` when git cannot answer.
 */
export async function collectEffortDiff(
  root: string,
  mergeBase: string,
): Promise<EffortDiff | undefined> {
  const prefix = await repoPathPrefix(root);
  if (prefix === undefined) {
    return undefined;
  }

  // Tracked changes, merge-base → working tree, in one pass each for kind and
  // line stats. The two listings share flags, so they enumerate the same set.
  const nameStatus = await runGit(
    ["diff", "--name-status", "--no-renames", "-z", mergeBase],
    { cwd: root },
  );
  if (!nameStatus.success) {
    return undefined;
  }
  const numstat = await runGit(
    ["diff", "--numstat", "--no-renames", "-z", mergeBase],
    { cwd: root },
  );
  if (!numstat.success) {
    return undefined;
  }
  const stats = new Map<
    string,
    { insertions: number; deletions: number; binary: boolean }
  >();
  for (const record of splitNulRecords(numstat.stdout)) {
    const parsed = parseNumstatRecord(record);
    stats.set(parsed.path, {
      insertions: parsed.insertions,
      deletions: parsed.deletions,
      binary: parsed.binary,
    });
  }
  const files: EffortFileChange[] = [];
  const seen = new Set<string>();
  for (const entry of parseNameStatusZ(nameStatus.stdout)) {
    const [path] = stripRepoPathPrefix([entry.path], prefix);
    if (path === undefined || path === "" || seen.has(path)) {
      continue;
    }
    seen.add(path);
    const stat = stats.get(entry.path) ??
      { insertions: 0, deletions: 0, binary: false };
    files.push({ path, kind: changeKind(entry.status), ...stat });
  }

  // Untracked files are invisible to `git diff`; enumerate them individually
  // and count their content as additions. One unreadable file degrades to a
  // binary entry instead of discarding the diff.
  const pending = await runGit(
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { cwd: root },
  );
  if (!pending.success) {
    return undefined;
  }
  for (const entry of parsePorcelainZ(pending.stdout)) {
    if (entry.status !== "??") {
      continue; // tracked pending changes already arrived via `git diff`
    }
    const [path] = stripRepoPathPrefix([entry.path], prefix);
    if (path === undefined || path === "" || seen.has(path)) {
      continue;
    }
    seen.add(path);
    let stat: { insertions: number; binary: boolean };
    try {
      stat = untrackedStats(await Deno.readFile(join(root, path)));
    } catch {
      stat = { insertions: 0, binary: true };
    }
    files.push({ path, kind: "added", deletions: 0, ...stat });
  }

  const baseTree = await runGit(
    ["ls-tree", "-r", "-z", "--format=%(path)", mergeBase],
    { cwd: root },
  );
  if (!baseTree.success) {
    return undefined;
  }
  const baseFiles = stripRepoPathPrefix(
    splitNulRecords(baseTree.stdout),
    prefix,
  );
  return { files, baseFiles };
}
