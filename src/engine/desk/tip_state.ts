/**
 * The desk tip seen-state **store** — the one module that reads and writes
 * `<git-common-dir>/discern/desk/tips.json` (a sanctioned write site in
 * `tests/paths_write_surface_test.ts`; everything here lands inside `.git`,
 * outside the project tree). The common dir is shared by every linked
 * worktree, so one seen-state serves the whole repository with zero
 * unification logic, and nothing under the git admin area ever lands in a
 * commit or needs a gitignore entry — the logbook store's placement
 * reasoning, applied to desk state.
 *
 * Tip state must never cost a session: a missing, torn, foreign, or
 * unwritable file degrades to the fresh state or to silence, never to a
 * crash or a warning at the desk. The pure shape and its constructors live
 * with the selection engine in `tips.ts`; this module is I/O only.
 */

import { dirname, join } from "@std/path";
import { bestEffort } from "../../shared/best_effort.ts";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import { GIT_ADMIN_STATE } from "../../shared/git_admin_state.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import {
  freshTipSeenState,
  TIP_STATE_SCHEMA_VERSION,
  type TipSeenEntry,
  type TipSeenState,
} from "./tips.ts";

/** The seen-state file for the repository containing `root`, or undefined
 * outside a git repository. */
export async function tipStatePath(root: string): Promise<string | undefined> {
  const commonGitDir = await resolveCommonGitDir(root);
  return commonGitDir === undefined
    ? undefined
    : join(commonGitDir, GIT_ADMIN_STATE.deskTips.path);
}

/** Parse one state file's text, or undefined for anything malformed. */
function parseState(text: string): TipSeenState | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }
  const candidate = raw as {
    schema_version?: unknown;
    baseline_version?: unknown;
    tips?: unknown;
  };
  if (
    candidate.schema_version !== TIP_STATE_SCHEMA_VERSION ||
    typeof candidate.baseline_version !== "string" ||
    typeof candidate.tips !== "object" || candidate.tips === null
  ) {
    return undefined;
  }
  const tips: Record<string, TipSeenEntry> = {};
  for (const [id, value] of Object.entries(candidate.tips)) {
    if (typeof value !== "object" || value === null) {
      return undefined;
    }
    const entry = value as { count?: unknown; last_shown?: unknown };
    if (
      typeof entry.count !== "number" || typeof entry.last_shown !== "string"
    ) {
      return undefined;
    }
    tips[id] = { count: entry.count, last_shown: entry.last_shown };
  }
  return {
    schema_version: TIP_STATE_SCHEMA_VERSION,
    baseline_version: candidate.baseline_version,
    tips,
  };
}

/**
 * Read the repository's tip seen-state. Every failure — no repository, a
 * missing file, a torn write, a foreign schema — resets to the fresh state
 * baselined at `version` (the current discern version), never throws.
 */
export async function readTipSeenState(
  root: string,
  version: string,
): Promise<TipSeenState> {
  try {
    const path = await tipStatePath(root);
    if (path === undefined) {
      return freshTipSeenState(version);
    }
    return parseState(await Deno.readTextFile(path)) ??
      freshTipSeenState(version);
  } catch {
    return freshTipSeenState(version);
  }
}

/**
 * Write the repository's tip seen-state atomically (temp-in-dir + rename),
 * creating the desk state directory as needed. Best-effort: an unwritable
 * disk or a missing repository is silence — the shown tip simply repeats
 * sooner, which costs less than any warning at the desk.
 */
export async function writeTipSeenState(
  root: string,
  state: TipSeenState,
): Promise<void> {
  await bestEffort("desk-tip-state-record", async () => {
    const path = await tipStatePath(root);
    if (path === undefined) {
      return;
    }
    await Deno.mkdir(dirname(path), { recursive: true });
    await atomicReplaceJson(path, state, {
      mode: 0o666,
      sync: false,
      space: 2,
      trailingNewline: true,
    });
  });
}
