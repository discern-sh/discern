/**
 * Repository-wide scheduling for OS-temp artifact retention.
 *
 * Gate verbs are short-lived processes under agent-driven development. A
 * process-local hourly timestamp therefore does not throttle a burst: every
 * process starts with an empty timestamp and walks the same shared OS temp
 * population. The due stamp and cursor live in one common-scope Git-admin file,
 * shared by the main checkout and every linked worktree. An advisory OS lock
 * makes the check-and-sweep exclusive; a busy or unavailable coordinator skips
 * this hygiene pass rather than affecting the gate.
 */

import { dirname } from "@std/path";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import {
  pruneStaleTempArtifacts,
  type TempArtifactPruneOptions,
  type TempArtifactPruneResult,
} from "../../shared/temp_artifacts.ts";

/** One repository pays for at most one bounded sweep per hour. */
export const TEMP_ARTIFACT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

interface TempArtifactSweepState {
  readonly lastSweepAt: number;
  readonly cursor: string | undefined;
}

type SweepPruneOptions = Omit<TempArtifactPruneOptions, "now" | "cursor">;

export interface TempArtifactSweepOptions {
  readonly now?: number;
  readonly prune?: SweepPruneOptions;
}

export type TempArtifactSweepOutcome =
  | { readonly kind: "swept"; readonly prune: TempArtifactPruneResult }
  | { readonly kind: "not-due" }
  | { readonly kind: "busy" }
  | { readonly kind: "unavailable" };

const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const MAX_STATE_BYTES = 4_096;

/** Read the repository throttle cursor, treating missing or malformed state as a fresh sweep. */
async function readState(
  file: Deno.FsFile,
): Promise<TempArtifactSweepState | undefined> {
  const size = (await file.stat()).size;
  if (size <= 0 || size > MAX_STATE_BYTES) {
    return undefined;
  }
  await file.seek(0, Deno.SeekMode.Start);
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < bytes.length) {
    const read = await file.read(bytes.subarray(offset));
    if (read === null) {
      break;
    }
    offset += read;
  }
  try {
    const parsed = JSON.parse(
      DECODER.decode(bytes.subarray(0, offset)),
    ) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.last_sweep_at !== "number" ||
      !Number.isFinite(record.last_sweep_at)
    ) {
      return undefined;
    }
    return {
      lastSweepAt: record.last_sweep_at,
      cursor: typeof record.cursor === "string" ? record.cursor : undefined,
    };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return undefined;
  }
}

/** Advance through partial filesystem writes until the complete sweep state is persisted. */
async function writeAll(file: Deno.FsFile, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    offset += await file.write(bytes.subarray(offset));
  }
}

/** Atomically persist the next sweep time and cursor through a temporary sibling. */
async function writeState(
  file: Deno.FsFile,
  state: TempArtifactSweepState,
): Promise<void> {
  const bytes = ENCODER.encode(
    `${
      JSON.stringify({
        last_sweep_at: state.lastSweepAt,
        cursor: state.cursor ?? null,
      })
    }\n`,
  );
  await file.truncate(0);
  await file.seek(0, Deno.SeekMode.Start);
  await writeAll(file, bytes);
}

/**
 * Run one bounded retention page when this repository's shared interval is due.
 * Every failure is fail-quiet: temp retention is hygiene and cannot decide a
 * gate outcome.
 */
export async function sweepDueTempArtifacts(
  root: string,
  opts: TempArtifactSweepOptions = {},
): Promise<TempArtifactSweepOutcome> {
  const path = await gitAdminStatePath(root, "tempArtifactSweep");
  if (path === undefined) {
    return { kind: "unavailable" };
  }
  try {
    await Deno.mkdir(dirname(path), { recursive: true });
  } catch {
    return { kind: "unavailable" };
  }

  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, {
      create: true,
      read: true,
      write: true,
    });
  } catch {
    return { kind: "unavailable" };
  }

  try {
    let acquired: boolean;
    try {
      acquired = await file.tryLock(true);
    } catch {
      return { kind: "unavailable" };
    }
    if (!acquired) {
      return { kind: "busy" };
    }

    const now = opts.now ?? Date.now();
    const prior = await readState(file);
    if (
      prior !== undefined &&
      now - prior.lastSweepAt < TEMP_ARTIFACT_SWEEP_INTERVAL_MS
    ) {
      return { kind: "not-due" };
    }

    // Stamp before scanning. If the process dies mid-sweep, the kernel frees
    // the lock and the next run waits for the next interval instead of
    // immediately repeating the same expensive page.
    const cursor = prior?.cursor;
    await writeState(file, { lastSweepAt: now, cursor });
    const prune = await pruneStaleTempArtifacts({
      ...opts.prune,
      now,
      ...(cursor === undefined ? {} : { cursor }),
    });
    await writeState(file, {
      lastSweepAt: now,
      cursor: prune.cursor,
    });
    return { kind: "swept", prune };
  } catch {
    return { kind: "unavailable" };
  } finally {
    file.close();
  }
}
