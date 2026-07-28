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
 * removals are themselves recorded as a `prune` event that carries a compact
 * digest of each removed month (event totals by outcome and verb), so coarse
 * long-horizon trends outlive the raw lines they came from.
 */

import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { KIT_VERSION } from "../../lib/version.ts";
import { GIT_ADMIN_STATE } from "../../shared/git_admin_state.ts";
import {
  LOGBOOK_SCHEMA_VERSION,
  type LogbookEvent,
  parseLogbookLine,
  type PruneDigest,
  type PruneEvent,
} from "./schema.ts";

/** The logbook directory for a repo: `<common-git-dir>/discern/logbook/`. */
export function logbookDir(commonGitDir: string): string {
  return join(commonGitDir, GIT_ADMIN_STATE.logbook.path);
}

/** The month files kept after rotation (about two years of history — a month
 * of heavy use is a few hundred kilobytes, so retention is bounded by
 * usefulness, not disk; the prune digest preserves coarser trends beyond it). */
export const MAX_MONTH_FILES = 24;

/** A month-stamped event file name (`2026-07.jsonl`) from an ISO timestamp. */
export function monthFileName(atIso: string): string {
  return `${atIso.slice(0, 7)}.jsonl`;
}

/** The shape of a month-file name — what rotation may count and remove, and
 * what the stream reader (`read.ts`) recognizes as event storage. */
export const MONTH_FILE_RE = /^\d{4}-\d{2}\.jsonl$/;

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

/** Digest one month file before its removal: line totals, verb-event counts by
 * outcome and by verb. Best-effort — an unreadable file digests to its name
 * and zero, and torn/foreign lines count as `unparsed` rather than vanishing. */
async function digestMonthFile(
  path: string,
  name: string,
): Promise<PruneDigest> {
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return { file: name, events: 0 };
  }
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  let ok = 0;
  let failed = 0;
  let partial = 0;
  let refused = 0;
  let unparsed = 0;
  const byVerb: Record<string, number> = {};
  for (const line of lines) {
    const parsed = parseLogbookLine(line);
    if (parsed.kind !== "event") {
      unparsed += 1;
      continue;
    }
    if (parsed.event.kind !== "verb") {
      continue;
    }
    byVerb[parsed.event.verb] = (byVerb[parsed.event.verb] ?? 0) + 1;
    if (parsed.event.outcome === "ok") {
      ok += 1;
    } else if (parsed.event.outcome === "partial") {
      partial += 1;
    } else if (parsed.event.outcome === "refused") {
      refused += 1;
    } else {
      failed += 1;
    }
  }
  return {
    file: name,
    events: lines.length,
    ...(ok > 0 ? { ok } : {}),
    ...(failed > 0 ? { failed } : {}),
    ...(partial > 0 ? { partial } : {}),
    ...(refused > 0 ? { refused } : {}),
    ...(Object.keys(byVerb).length > 0 ? { by_verb: byVerb } : {}),
    ...(unparsed > 0 ? { unparsed } : {}),
  };
}

/**
 * The rotation pass: list the month files, keep the newest
 * {@link MAX_MONTH_FILES} (the YYYY-MM names sort chronologically), digest and
 * remove the rest oldest-first, and record the removals as a `prune` event in
 * the current month file — pruning is loud, never silent, and each removed
 * month leaves its digest behind.
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
  const removed: PruneDigest[] = [];
  for (const name of excess) {
    const path = join(dir, name);
    removed.push(await digestMonthFile(path, name));
    await Deno.remove(path);
  }
  const prune: PruneEvent = {
    schema: LOGBOOK_SCHEMA_VERSION,
    at: atIso,
    writer: KIT_VERSION,
    kind: "prune",
    removed,
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

// ── the reset ───────────────────────────────────────────────────────────────

/** One logbook file's name and size — the reset plan's unit. */
export interface LogbookFile {
  file: string;
  bytes: number;
}

/** Every regular file directly under the logbook directory (month files, the
 * epoch sidecar, anything a future writer adds), sorted by name — what a reset
 * plan lists and its executor removes. A missing directory is an empty list. */
export async function listLogbookFiles(
  commonGitDir: string,
): Promise<LogbookFile[]> {
  const dir = logbookDir(commonGitDir);
  const files: LogbookFile[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) {
        continue;
      }
      const info = await Deno.stat(join(dir, entry.name));
      files.push({ file: entry.name, bytes: info.size });
    }
  } catch {
    return [];
  }
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

/** Delete the whole logbook directory — the reset action's executor, kept in
 * the store because this module is the subsystem's only sanctioned write site.
 * Removing an already-absent logbook is a no-op, not an error. */
export async function removeLogbook(commonGitDir: string): Promise<void> {
  try {
    await Deno.remove(logbookDir(commonGitDir), { recursive: true });
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      throw e;
    }
  }
}
