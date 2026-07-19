/**
 * The logbook **store** — where the events live on disk and the only module in
 * the logbook subsystem that writes the filesystem (it is a sanctioned
 * write-site in `tests/paths_write_surface_test.ts`: everything here lands
 * inside `.git`, outside the project tree).
 *
 * Layout, beside the resource ledger the worktree lifecycle already keeps:
 *
 *     <git-common-dir>/discern/logbook/
 *       2026-07.jsonl   — one month of events, one JSON line each
 *       2026-06.jsonl
 *       epoch.json      — per-branch config-epoch state (see `epoch.ts`)
 *
 * The common dir is shared by every linked worktree, so all fleet activity
 * converges into one logbook with zero unification logic, and nothing under the
 * git admin area ever lands in a commit or needs a gitignore entry. Events
 * attribute by branch name, so history survives a worktree's removal.
 *
 * The append bet (see the substrate decision record): one `write()` of one
 * whole line to an `O_APPEND` handle — atomic in practice on local filesystems
 * for lines this small, across concurrent worktrees. The backstop is the
 * torn-line-tolerant reader (`schema.ts`); a hard crash between verb completion
 * and the append loses that run's single event, accepted for v1.
 *
 * Rotation is by age: month-stamped files, the newest {@link MAX_MONTH_FILES}
 * kept. The prune pass runs only when a new month file is first created (the
 * one moment the file count can grow), removes oldest-first, and is LOUD — the
 * removals are themselves recorded as a `prune` event, never silent.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import {
  LOGBOOK_SCHEMA_VERSION,
  type LogbookEvent,
  type PruneEvent,
} from "./schema.ts";

/** The logbook directory for a repo: `<common-git-dir>/discern/logbook/`. */
export function logbookDir(commonGitDir: string): string {
  return join(commonGitDir, "discern", "logbook");
}

/** The month files kept after rotation (about a year of history). */
export const MAX_MONTH_FILES = 12;

/** A month-stamped event file name (`2026-07.jsonl`) from an ISO timestamp. */
export function monthFileName(atIso: string): string {
  return `${atIso.slice(0, 7)}.jsonl`;
}

/** The shape of a month-file name — what rotation may count and remove. */
const MONTH_FILE_RE = /^\d{4}-\d{2}\.jsonl$/;

/** Serialize one event as its single logbook line (trailing newline included). */
function eventLine(event: LogbookEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/** Append one line in a single `O_APPEND` write — the atomicity bet. */
async function appendLine(path: string, line: string): Promise<void> {
  await Deno.writeTextFile(path, line, { append: true });
}

/**
 * Append one event to the logbook under `commonGitDir`, creating the directory
 * and month file as needed. When the append CREATES a new month file, the
 * rotation pass runs afterwards. Throws on any write failure — the recorder
 * (`record.ts`) is the layer that degrades to silence, so the verb's own result
 * is never touched.
 */
export async function appendEvent(
  commonGitDir: string,
  event: LogbookEvent,
): Promise<void> {
  const dir = logbookDir(commonGitDir);
  await ensureDir(dir);
  const path = join(dir, monthFileName(event.at));
  const isNewMonth = !(await pathExists(path));
  await appendLine(path, eventLine(event));
  if (isNewMonth) {
    await rotate(dir, path, event.at);
  }
}

/** True when `path` exists (any kind). */
async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The rotation pass: list the month files, keep the newest
 * {@link MAX_MONTH_FILES} (the YYYY-MM names sort chronologically), remove the
 * rest oldest-first, and record the removals as a `prune` event in the current
 * month file — pruning is loud, never silent.
 */
async function rotate(
  dir: string,
  currentPath: string,
  atIso: string,
): Promise<void> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && MONTH_FILE_RE.test(entry.name)) {
      names.push(entry.name);
    }
  }
  const excess = names.sort().reverse().slice(MAX_MONTH_FILES).sort();
  if (excess.length === 0) {
    return;
  }
  for (const name of excess) {
    await Deno.remove(join(dir, name));
  }
  const prune: PruneEvent = {
    schema: LOGBOOK_SCHEMA_VERSION,
    at: atIso,
    kind: "prune",
    removed: excess,
  };
  await appendLine(currentPath, eventLine(prune));
}

// ── the epoch sidecar ───────────────────────────────────────────────────────

/** The per-branch epoch state the recorder compares consecutive events against.
 * Kept OUTSIDE the event stream (a sidecar file) because naming which sections
 * moved needs the previous per-section hashes, and events carry only the
 * combined fingerprint. Per BRANCH, not global: parallel worktrees legitimately
 * hold different configs, and a shared last-fingerprint would record a phantom
 * `config-change` on every interleaving. A branch entry simply lingers after
 * its worktree lands — a few stale lines of state, accepted for v1. */
export interface EpochState {
  schema: number;
  branches: Record<
    string,
    { fingerprint: string; sections: Record<string, string> }
  >;
}

/** The epoch sidecar path for a repo. */
export function epochStatePath(commonGitDir: string): string {
  return join(logbookDir(commonGitDir), "epoch.json");
}

/** Read the epoch sidecar, tolerating a missing/corrupt/foreign file (→ undefined). */
export async function readEpochState(
  commonGitDir: string,
): Promise<EpochState | undefined> {
  let text: string;
  try {
    text = await Deno.readTextFile(epochStatePath(commonGitDir));
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(text) as EpochState;
    if (
      parsed.schema !== LOGBOOK_SCHEMA_VERSION ||
      typeof parsed.branches !== "object" || parsed.branches === null
    ) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/** Write the epoch sidecar atomically (temp-in-dir + rename). */
export async function writeEpochState(
  commonGitDir: string,
  state: EpochState,
): Promise<void> {
  const dir = logbookDir(commonGitDir);
  await ensureDir(dir);
  const path = epochStatePath(commonGitDir);
  const tmp = `${path}.${Deno.pid}.tmp`;
  await Deno.writeTextFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
  await Deno.rename(tmp, path);
}
