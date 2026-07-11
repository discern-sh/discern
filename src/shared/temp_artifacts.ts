/**
 * Discern's OS-temp **artifact registry** — the single place temp output files
 * are created, and the single place they are reaped.
 *
 * The gate persists every job's full output past the run (ADR 0096: the artifact
 * is the agent's escape hatch for inspecting a loud-but-passing job), and offloads
 * truncated diagnostic text the same way. Persisting past the run must not mean
 * persisting forever: gate runs are agent-frequency events (one file per job, per
 * run), so without retention the OS temp dir accumulates tens of thousands of
 * orphaned logs — and on a size-limited tmpfs `/tmp`, eventually starves unrelated
 * programs (ADR 0117). Every creation therefore goes through
 * {@link makeTempArtifact} — an architectural test bans
 * `Deno.makeTempFile`/`makeTempDir` elsewhere in `src/` so no artifact can be
 * minted outside the registry — and the gate verbs call
 * {@link sweepDueTempArtifacts} before their jobs spawn, reaping expired
 * artifacts from earlier runs. A new artifact family added to
 * {@link TEMP_ARTIFACT_KINDS} auto-enrols in both the naming and the reaping.
 * The sweep deliberately lives at the verb entries, NOT inside artifact
 * creation: creation happens between a job's spawn and its abort wiring, where
 * even a bounded sweep would delay the kill path (ADR 0105).
 *
 * Everything here is best-effort: artifact I/O must never decide a job or verb
 * outcome, and a prune hiccup (a raced delete by a concurrent discern process,
 * an unreadable entry) is silently skipped.
 */

import { tmpdir } from "os";
import { join } from "@std/path";

/** The registry: one filename prefix per artifact family. The prefixes are the
 * retention contract — {@link pruneStaleTempArtifacts} reaps exactly these. */
export const TEMP_ARTIFACT_KINDS = {
  /** A gate job's full combined stdout+stderr capture (ADR 0096). */
  job: "discern-job-",
  /** A truncated diagnostic's offloaded full text (ADR 0083). */
  diag: "discern-diag-",
} as const;

export type TempArtifactKind = keyof typeof TEMP_ARTIFACT_KINDS;

/** Every artifact family shares the suffix, so the prune match stays narrow. */
export const TEMP_ARTIFACT_SUFFIX = ".log";

/** How long an artifact outlives its run. Long enough to inspect a result
 * envelope hours later; short enough that steady agent-driven gate traffic
 * carries at most a day of logs. */
export const TEMP_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;

/** At most one sweep per process per interval — a long-lived process (the MCP
 * server) keeps reaping, while a burst of short CLI runs stays cheap. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** The per-sweep removal budget. The sweep runs inline before an artifact is
 * created, so it must stay fast even against a huge pre-retention backlog (tens
 * of thousands of files were observed in the wild): each sweep reaps at most
 * this many and lets subsequent runs drain the rest, while steady-state
 * production (tens of files per run) is always fully covered. */
const MAX_SWEEP_REMOVALS = 500;

let lastSweepAt: number | undefined;

/**
 * Create one OS-temp artifact file for `kind`. The returned path is what rides
 * in the result envelope (`output_path`). Creation failures propagate — callers
 * already treat artifact creation as best-effort. No sweep happens here (see
 * the module doc): retention runs at the gate-verb entries, off the kill path.
 */
export function makeTempArtifact(kind: TempArtifactKind): Promise<string> {
  return Deno.makeTempFile({
    prefix: TEMP_ARTIFACT_KINDS[kind],
    suffix: TEMP_ARTIFACT_SUFFIX,
  });
}

/**
 * Reap expired artifacts when a sweep is due — at most once per
 * {@link SWEEP_INTERVAL_MS} per process, so a long-lived MCP server keeps
 * reaping while a burst of short CLI runs pays once. Called by the gate verbs
 * (`done`/`prepare`/`test`) before their jobs spawn. Best-effort: retention
 * is hygiene, never load-bearing, so a failure never reaches the verb.
 */
export async function sweepDueTempArtifacts(): Promise<void> {
  const now = Date.now();
  if (lastSweepAt !== undefined && now - lastSweepAt < SWEEP_INTERVAL_MS) {
    return;
  }
  lastSweepAt = now; // set before awaiting, so concurrent callers sweep once
  try {
    await pruneStaleTempArtifacts();
  } catch {
    // Retention is hygiene, never load-bearing.
  }
}

/**
 * Remove registered artifacts older than the TTL from the OS temp dir, up to the
 * per-sweep removal budget (a bigger backlog drains across later sweeps).
 * Matching is deliberately narrow — a registered prefix AND the shared suffix,
 * regular files only — so nothing outside the registry is ever touched. Returns
 * how many files were removed. `opts` exist for tests (an injected dir, TTL,
 * clock, and budget); production callers pass nothing.
 */
export async function pruneStaleTempArtifacts(
  opts: { dir?: string; ttlMs?: number; now?: number; maxRemovals?: number } =
    {},
): Promise<number> {
  const dir = opts.dir ?? tmpdir();
  const ttlMs = opts.ttlMs ?? TEMP_ARTIFACT_TTL_MS;
  const now = opts.now ?? Date.now();
  const maxRemovals = opts.maxRemovals ?? MAX_SWEEP_REMOVALS;
  const prefixes = Object.values(TEMP_ARTIFACT_KINDS);
  let removed = 0;
  let entries: AsyncIterable<Deno.DirEntry>;
  try {
    entries = Deno.readDir(dir);
  } catch {
    return removed;
  }
  try {
    for await (const entry of entries) {
      if (removed >= maxRemovals) {
        break;
      }
      if (!entry.isFile) {
        continue;
      }
      if (
        !entry.name.endsWith(TEMP_ARTIFACT_SUFFIX) ||
        !prefixes.some((p) => entry.name.startsWith(p))
      ) {
        continue;
      }
      const path = join(dir, entry.name);
      try {
        const mtime = (await Deno.stat(path)).mtime?.getTime();
        if (mtime === undefined || now - mtime < ttlMs) {
          continue; // fresh, or an unreadable age — keep (fail-safe)
        }
        await Deno.remove(path);
        removed++;
      } catch {
        // Raced away by a concurrent process, or unreadable — skip it.
      }
    }
  } catch {
    // Iteration hiccup mid-walk: keep what was already reaped.
  }
  return removed;
}
