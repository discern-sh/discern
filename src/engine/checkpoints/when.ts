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
 *     the rest of the line is the project-root-relative path. Trigger
 *     composition keeps only paths in the structural matched set. Without a
 *     valid declared match, the subject falls back to that full set, which
 *     reopens more coarsely — commands declare matches when precision matters.
 *
 * Execution funnels through the gate's job runner, so the command inherits the
 * same capture environment, `discern` self-resolution, and process-tree
 * cleanup as every configured job, under a deliberately short fixed budget: a
 * pre-flight condition must answer in seconds, and a hung probe must never
 * stall the gate.
 */

import { type SpawnedJob, spawnJob } from "../jobs/command.ts";
import { beginTrackedRun } from "../jobs/interrupt.ts";
import { makeTempArtifact } from "../../shared/temp_artifacts.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";
import type { WhenOutcome } from "./types.ts";
import type { CheckpointWhenInput } from "../../shared/checkpoints.ts";
export type { CheckpointWhenInput } from "../../shared/checkpoints.ts";

/** The fixed wall-clock budget (seconds) a `when` command gets. */
export const CHECKPOINT_WHEN_TIMEOUT_SECONDS = 10;

/** Maximum command-output bytes retained for the match-line protocol. */
export const CHECKPOINT_WHEN_OUTPUT_BYTES = 256 * 1024;

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
 * engine could never have matched. Trigger composition later drops paths
 * outside the structural matched set.
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
  /** Structured facts. Production callers always provide this; omission keeps
   * direct compatibility probes from receiving an invented input. */
  input?: CheckpointWhenInput;
  /** External cancellation (MCP/client); OS interrupts join it internally. */
  signal?: AbortSignal;
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
  const tracked = beginTrackedRun(opts.signal);
  let inputPath: string | undefined;
  let result: SpawnedJob | undefined;
  let failed: { phase: "input" | "spawn"; detail: string } | undefined;
  let cleanupFailed = false;
  let phase: "input" | "spawn" = "input";
  try {
    const input = opts.input;
    const env: Record<string, string> = {};
    if (input !== undefined) {
      inputPath = await makeTempArtifact("checkpointInput");
      await Deno.chmod(inputPath, 0o600);
      await Deno.writeTextFile(inputPath, `${JSON.stringify(input)}\n`);
      env[DISCERN_ENVIRONMENT_VARIABLES.checkpointInput] = inputPath;
    }
    phase = "spawn";
    result = await spawnJob(
      { label: `checkpoint:${checkpointId}`, command },
      {
        cwd: root,
        stream: false,
        write: () => {},
        timeoutS,
        keepOutput: true,
        protocolOutputMaxBytes: CHECKPOINT_WHEN_OUTPUT_BYTES,
        signal: tracked.signal,
        env,
      },
    );
  } catch (error) {
    failed = {
      phase,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (inputPath !== undefined) {
      try {
        await Deno.remove(inputPath);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) cleanupFailed = true;
      }
    }
    tracked.release();
  }
  if (cleanupFailed) {
    return {
      kind: "error",
      reason: "when_input_cleanup_failed",
      advisory:
        `checkpoint '${checkpointId}': its temporary when input could not be removed; the trigger fails open and did not fire.`,
    };
  }
  if (failed !== undefined) {
    return {
      kind: "error",
      reason: failed.phase === "input"
        ? "when_input_failed"
        : "when_spawn_failed",
      advisory:
        `checkpoint '${checkpointId}': the when ${failed.phase} could not be prepared (${failed.detail}); the trigger fails open and did not fire.`,
    };
  }
  if (result === undefined) {
    return {
      kind: "error",
      reason: "when_spawn_failed",
      advisory:
        `checkpoint '${checkpointId}': the when command produced no result; the trigger fails open and did not fire.`,
    };
  }
  if (result.result.timedOutAfterS !== undefined) {
    return {
      kind: "error",
      reason: "when_timeout",
      advisory:
        `checkpoint '${checkpointId}': the when command did not finish within ` +
        `${result.result.timedOutAfterS}s; the trigger fails open and did not fire.`,
    };
  }
  if (result.result.cancelled === true || tracked.signal.aborted) {
    return {
      kind: "error",
      reason: "when_cancelled",
      advisory:
        `checkpoint '${checkpointId}': the when command was cancelled; the trigger fails open and did not fire.`,
    };
  }
  if (result.outputLimitExceeded === true) {
    return {
      kind: "error",
      reason: "when_output_limit",
      advisory:
        `checkpoint '${checkpointId}': the when command exceeded its ${CHECKPOINT_WHEN_OUTPUT_BYTES}-byte output limit; the trigger fails open and did not fire.`,
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
  const excerpt = result.output;
  return {
    kind: "error",
    reason: "when_invalid_exit",
    advisory:
      `checkpoint '${checkpointId}': the when command exited ${result.result.code} ` +
      `(0 fires, 1 passes); the trigger fails open and did not fire.` +
      (excerpt.length === 0 ? "" : ` Output: ${outputExcerpt(excerpt)}`),
  };
}
