/**
 * The executable escape hatch: run a checkpoint's `when` command and read its
 * verdict. The command text comes from the GOVERNING (merge-base) config; in
 * this version it executes in the candidate worktree, so any script,
 * dependency, configuration, or interpreter it references resolves from that
 * worktree — the policy identity proves where the command text came from, not
 * an executable dependency closure.
 *
 * The protocol, a sibling of the standards metric line:
 *
 *   - exit 0 — the trigger FIRES;
 *   - exit 1 — the trigger passes (does not fire);
 *   - any other exit, a timeout, or a spawn failure — the trigger FAILS OPEN
 *     (does not fire) and the outcome carries a plain-language advisory;
 *   - `DISCERN_MATCH <path>` output lines declare the subject paths precisely.
 *     The marker may sit anywhere on a line (a tool may prefix its own text);
 *     the rest of the line is the project-root-relative path. Without any, the
 *     subject falls back to the structural matched set, which reopens more
 *     coarsely — commands declare matches when precision matters.
 *
 * Execution funnels through the gate's job runner, so the command inherits the
 * same capture environment, `discern` self-resolution, and process-tree
 * cleanup as every configured job, under a deliberately short fixed budget: a
 * pre-flight condition must answer in seconds, and a hung probe must never
 * stall the gate.
 */

import { spawnJob } from "../jobs/command.ts";
import type { WhenOutcome } from "./types.ts";

/** The fixed wall-clock budget (seconds) a `when` command gets. */
export const CHECKPOINT_WHEN_TIMEOUT_SECONDS = 10;

/** Cap on the advisory's excerpt of the command's own words. */
const ADVISORY_EXCERPT_MAX = 160;

const DECODER = new TextDecoder();

/** One line of the command's own output, flattened, for an advisory. */
function outputExcerpt(output: Uint8Array): string {
  const flat = DECODER.decode(output).replace(/\s+/g, " ").trim();
  if (flat === "") {
    return "";
  }
  return flat.length <= ADVISORY_EXCERPT_MAX
    ? flat
    : `${flat.slice(0, ADVISORY_EXCERPT_MAX)}…`;
}

/**
 * Every path declared by `DISCERN_MATCH <path>` lines in `output`, normalized
 * and deduplicated in declaration order. The marker must be a whole token; the
 * rest of the line is the path (so paths may contain spaces, though leading or
 * trailing whitespace cannot survive a line protocol). A declared path that is
 * empty, absolute, or escapes the project root is dropped: the subject then
 * falls back on the structural matched set rather than binding to a path the
 * engine could never have matched.
 */
export function parseDiscernMatches(output: string): string[] {
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const m = /(?:^|\s)DISCERN_MATCH\s+(.*)$/.exec(line);
    if (m === null) {
      continue;
    }
    let path = (m[1] ?? "").trim();
    while (path.startsWith("./")) {
      path = path.slice(2);
    }
    if (
      path === "" || path.startsWith("/") ||
      path.split("/").includes("..")
    ) {
      continue;
    }
    if (!seen.has(path)) {
      seen.add(path);
      matches.push(path);
    }
  }
  return matches;
}

/** Options for one `when` run. */
export interface RunWhenOptions {
  /** Replace the fixed budget — for tests; production callers omit it. */
  timeoutS?: number;
}

/**
 * Run one checkpoint's `when` command in the worktree at `root` and read the
 * protocol's verdict. Never throws: every failure mode resolves to the
 * fail-open `error` outcome with its advisory.
 */
export async function runWhenCommand(
  root: string,
  checkpointId: string,
  command: string,
  opts: RunWhenOptions = {},
): Promise<WhenOutcome> {
  const timeoutS = opts.timeoutS ?? CHECKPOINT_WHEN_TIMEOUT_SECONDS;
  let result;
  try {
    result = await spawnJob(
      { label: `checkpoint:${checkpointId}`, command },
      { cwd: root, stream: false, write: () => {}, timeoutS },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      kind: "error",
      advisory:
        `checkpoint '${checkpointId}': the when command could not run (${reason}); ` +
        `the trigger fails open and did not fire.`,
    };
  }
  if (result.result.timedOutAfterS !== undefined) {
    return {
      kind: "error",
      advisory:
        `checkpoint '${checkpointId}': the when command did not finish within ` +
        `${result.result.timedOutAfterS}s; the trigger fails open and did not fire.`,
    };
  }
  if (result.result.code === 0) {
    return {
      kind: "fire",
      matches: parseDiscernMatches(DECODER.decode(result.output)),
    };
  }
  if (result.result.code === 1) {
    return { kind: "pass" };
  }
  const excerpt = outputExcerpt(result.output);
  return {
    kind: "error",
    advisory:
      `checkpoint '${checkpointId}': the when command exited ${result.result.code} ` +
      `(0 fires, 1 passes); the trigger fails open and did not fire.` +
      (excerpt === "" ? "" : ` Output: ${excerpt}`),
  };
}
