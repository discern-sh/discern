/**
 * Tier-two evidence for the settled selection: the commits a task or branch
 * holds beyond the trunk, the files they change, a dirty checkout's
 * uncommitted files, and a failed task's last recorded failure.
 *
 * The status survey carries none of these, so the inspector reads them for
 * the one item the owner settled on: at most three Git commands, each with a
 * timeout, through an injected runner, and the retained operation record for
 * a failed run. Each section fails on its own. Results are kept in a small
 * least-recently-used cache keyed by everything that would change them, so
 * returning to a task whose head has not moved reads nothing.
 */

import { parsePorcelainZ, splitNulRecords } from "../../shared/git_paths.ts";
import type { StatusData } from "../../shared/result_schemas.ts";
import type { DeskRow } from "./model.ts";

/** Commits listed per item; more are counted, not shown. */
export const DESK_EVIDENCE_COMMITS = 20;

/** Changed files kept per item, largest first. */
export const DESK_EVIDENCE_FILES = 200;

/** Each Git read gives up after this long. */
export const DESK_EVIDENCE_TIMEOUT_MS = 2_000;

/** Items whose evidence the cache keeps. */
export const DESK_EVIDENCE_CACHE_SIZE = 32;

/** One commit beyond the trunk. */
export interface DeskCommit {
  readonly sha: string;
  readonly subject: string;
  /** Committer time, ISO 8601. */
  readonly at?: string;
}

/** One changed path and its line counts; binary files have none. */
export interface DeskFileStat {
  readonly path: string;
  readonly status: "added" | "removed" | "updated";
  readonly added?: number;
  readonly removed?: number;
}

/** One failure the last run recorded. */
export interface DeskFailureEvidence {
  readonly name: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
}

/** One section's read: what it found, or why it couldn't. */
export type DeskEvidenceSection<T> =
  | { readonly state: "ready"; readonly value: T }
  | { readonly state: "failed"; readonly error: string };

/** Everything tier two read for one item. */
export interface DeskEvidence {
  readonly commits: DeskEvidenceSection<readonly DeskCommit[]>;
  readonly files: DeskEvidenceSection<readonly DeskFileStat[]>;
  /** Present when the checkout had uncommitted files. */
  readonly uncommitted?: DeskEvidenceSection<readonly DeskFileStat[]>;
  /** Present for a failed run; empty when no record was retained. */
  readonly failure?: DeskEvidenceSection<readonly DeskFailureEvidence[]>;
}

/** The one item the slot reads, and every fact its evidence depends on. */
export interface DeskEvidenceSubject {
  /** Where Git runs: the task's checkout, or the main checkout for a branch. */
  readonly cwd: string;
  /** `HEAD` in a checkout, or a branch name. */
  readonly ref: string;
  readonly head?: string;
  readonly trunk: string;
  readonly trunkHead?: string;
  /** Present when the checkout has uncommitted files. */
  readonly dirty?: string;
  /** Present when the task's last run of a verb failed. */
  readonly failed?: { readonly branch: string; readonly verb: string };
}

/** How evidence reaches Git and the operation journal. */
export interface DeskEvidenceReader {
  git(
    args: readonly string[],
    cwd: string,
    signal: AbortSignal,
  ): Promise<{ success: boolean; stdout: string; stderr: string }>;
  failures(
    branch: string,
    verb: string,
  ): Promise<readonly DeskFailureEvidence[] | undefined>;
}

/** The cache key: a new head, trunk, or dirty stamp is a miss. */
export function evidenceKey(subject: DeskEvidenceSubject): string {
  return [
    subject.cwd,
    subject.ref,
    subject.head ?? "",
    subject.trunkHead ?? "",
    subject.dirty ?? "",
    subject.failed === undefined ? "" : subject.failed.verb,
  ].join("\u0000");
}

/** The trunk's head: the main checkout's registered commit. */
function trunkHead(data: StatusData | undefined): string | undefined {
  return data?.fleet?.find((entry) => entry.is_main)?.registration?.head;
}

/** The evidence subject for a task row. */
export function taskEvidenceSubject(
  row: DeskRow,
  data: StatusData | undefined,
  trunk: string,
): DeskEvidenceSubject {
  const entry = row.entry;
  const head = entry.registration?.head;
  const trunkTip = trunkHead(data);
  const failedVerb = entry.last_action?.outcome === "failed"
    ? entry.last_action.verb
    : undefined;
  return {
    cwd: entry.path,
    ref: "HEAD",
    trunk,
    ...(head === undefined ? {} : { head }),
    ...(trunkTip === undefined ? {} : { trunkHead: trunkTip }),
    ...(entry.clean === false
      ? { dirty: `${entry.changed_files ?? "?"}@${entry.last_activity ?? ""}` }
      : {}),
    ...(failedVerb === undefined || entry.branch === ""
      ? {}
      : { failed: { branch: entry.branch, verb: failedVerb } }),
  };
}

/** The evidence subject for a branch without a checkout. */
export function branchEvidenceSubject(
  branch: string,
  root: string,
  data: StatusData | undefined,
  trunk: string,
): DeskEvidenceSubject {
  const head = data?.parked_tasks?.find((task) => task.branch === branch)
    ?.head;
  const trunkTip = trunkHead(data);
  return {
    cwd: root,
    ref: branch,
    trunk,
    ...(head === undefined ? {} : { head }),
    ...(trunkTip === undefined ? {} : { trunkHead: trunkTip }),
  };
}

/** Git's own diagnostic, or a sentence when it printed none. */
function gitError(result: { stderr: string }): string {
  return result.stderr.trim() || "Git returned a non-zero status.";
}

/** Parse `%h%x00%s%x00%cI` lines. */
export function parseCommits(output: string): DeskCommit[] {
  return output.split("\n").flatMap((line) => {
    const [sha, subject, at] = line.split("\u0000");
    if (sha === undefined || sha === "" || subject === undefined) return [];
    return [{ sha, subject, ...(at === undefined || at === "" ? {} : { at }) }];
  });
}

/** The change a raw status letter names. */
function fileStatus(letter: string): DeskFileStat["status"] {
  return letter.startsWith("A")
    ? "added"
    : letter.startsWith("D")
    ? "removed"
    : "updated";
}

/** Parse `git diff --raw --numstat -z`: raw records, then numstat records. */
export function parseFileStats(output: string): DeskFileStat[] {
  const fields = splitNulRecords(output);
  const statuses = new Map<string, DeskFileStat["status"]>();
  const counts = new Map<string, { added?: number; removed?: number }>();
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    if (field.startsWith(":")) {
      const path = fields[index + 1];
      index += 1;
      if (path === undefined || path === "") continue;
      statuses.set(path, fileStatus(field.split(" ").at(-1) ?? "M"));
      continue;
    }
    const [added, removed, path] = field.split("\t");
    if (path === undefined || path === "") continue;
    const parsedAdded = Number(added);
    const parsedRemoved = Number(removed);
    counts.set(path, {
      ...(Number.isInteger(parsedAdded) ? { added: parsedAdded } : {}),
      ...(Number.isInteger(parsedRemoved) ? { removed: parsedRemoved } : {}),
    });
  }
  const files = [...statuses].map(([path, status]): DeskFileStat => ({
    path,
    status,
    ...(counts.get(path) ?? {}),
  }));
  const size = (file: DeskFileStat): number =>
    (file.added ?? 0) + (file.removed ?? 0);
  return files.sort((left, right) =>
    size(right) - size(left) || left.path.localeCompare(right.path)
  ).slice(0, DESK_EVIDENCE_FILES);
}

/** Parse `git status --porcelain=v1 -z` into changed files. */
function parseUncommitted(output: string): DeskFileStat[] {
  return parsePorcelainZ(output).map((entry) => ({
    path: entry.path,
    status: entry.status === "??" ? "added" : fileStatus(
      entry.status.replaceAll(" ", "") || "M",
    ),
  }));
}

/** Run one Git read into its section. */
async function section<T>(
  reader: DeskEvidenceReader,
  args: readonly string[],
  cwd: string,
  signal: AbortSignal,
  parse: (stdout: string) => T,
): Promise<DeskEvidenceSection<T>> {
  try {
    const result = await reader.git(args, cwd, signal);
    return result.success
      ? { state: "ready", value: parse(result.stdout) }
      : { state: "failed", error: gitError(result) };
  } catch (error) {
    return {
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Read one item's tier-two evidence: each section succeeds or fails alone. */
export async function readSelectedEvidence(
  subject: DeskEvidenceSubject,
  reader: DeskEvidenceReader,
  signal: AbortSignal,
): Promise<DeskEvidence> {
  const range = `${subject.trunk}..${subject.ref}`;
  const [commits, files, uncommitted, failure] = await Promise.all([
    section(
      reader,
      [
        "log",
        "--format=%h%x00%s%x00%cI",
        "-n",
        String(DESK_EVIDENCE_COMMITS),
        range,
      ],
      subject.cwd,
      signal,
      parseCommits,
    ),
    section(
      reader,
      [
        "diff",
        "--raw",
        "--numstat",
        "-z",
        "--no-renames",
        `${subject.trunk}...${subject.ref}`,
      ],
      subject.cwd,
      signal,
      parseFileStats,
    ),
    subject.dirty === undefined ? undefined : section(
      reader,
      ["status", "--porcelain=v1", "-z"],
      subject.cwd,
      signal,
      parseUncommitted,
    ),
    subject.failed === undefined
      ? undefined
      : failures(reader, subject.failed.branch, subject.failed.verb),
  ]);
  return {
    commits,
    files,
    ...(uncommitted === undefined ? {} : { uncommitted }),
    ...(failure === undefined ? {} : { failure }),
  };
}

/** The retained record's failures, or none when nothing was retained. */
async function failures(
  reader: DeskEvidenceReader,
  branch: string,
  verb: string,
): Promise<DeskEvidenceSection<readonly DeskFailureEvidence[]>> {
  try {
    return { state: "ready", value: await reader.failures(branch, verb) ?? [] };
  } catch (error) {
    return {
      state: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Whether every section of an item's evidence was read; a failed section
 * is read again the next time its item settles. */
export function evidenceComplete(evidence: DeskEvidence): boolean {
  return [
    evidence.commits,
    evidence.files,
    evidence.uncommitted,
    evidence.failure,
  ].every((section) => section === undefined || section.state === "ready");
}

/** Evidence kept per item, most recently used last. */
export interface DeskEvidenceCache {
  readonly entries: readonly (readonly [string, DeskEvidence])[];
}

/** A cache with nothing in it. */
export function emptyEvidenceCache(): DeskEvidenceCache {
  return { entries: [] };
}

/** The cached evidence for a key, if any. */
export function cachedEvidence(
  cache: DeskEvidenceCache,
  key: string,
): DeskEvidence | undefined {
  return cache.entries.find(([candidate]) => candidate === key)?.[1];
}

/** Keep one item's evidence as the most recently used, dropping the oldest. */
export function rememberEvidence(
  cache: DeskEvidenceCache,
  key: string,
  evidence: DeskEvidence,
): DeskEvidenceCache {
  return {
    entries: [
      ...cache.entries.filter(([candidate]) => candidate !== key),
      [key, evidence] as const,
    ].slice(-DESK_EVIDENCE_CACHE_SIZE),
  };
}
