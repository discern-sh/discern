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
 * {@link makeTempArtifact} — an architectural test limits temp creation to this
 * OS-temp artifact registry and the separate, immediately-removed write-authority
 * probe (which creates beside a planned target, not in the OS temp store) — and
 * the gate verbs call the repository-wide coordinator in
 * `engine/gate/temp_artifact_sweep.ts` before their jobs spawn, reaping expired
 * artifacts from earlier runs. A new artifact family added to
 * {@link TEMP_ARTIFACT_KINDS} auto-enrols in both the naming and the reaping.
 * The sweep deliberately lives at the verb entries, NOT inside artifact
 * creation: creation happens between a job's spawn and its abort wiring, where
 * even a bounded sweep would delay the kill path (ADR 0105, ADR 0216).
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
  /** A crash report's fallback home outside a repository (ADR 0248). */
  crash: "discern-crash-",
  /** Versioned structured facts available only during one checkpoint command. */
  checkpointInput: "discern-checkpoint-input-",
} as const;

export type TempArtifactKind = keyof typeof TEMP_ARTIFACT_KINDS;

/** The directory-shaped families: one dirname prefix each, matched WITHOUT the
 * file suffix and reaped recursively. A live owner keeps its directory fresh
 * (the self-shim refreshes its mtime on every use), so the TTL only ever
 * collects abandoned ones. */
export const TEMP_ARTIFACT_DIR_KINDS = {
  /** The `discern` self-shim's OS-temp fallback, minted only when no
   * repository root is at hand; the family also drains shims from engines
   * that predate the git-admin per-identity home (ADR 0249). */
  shim: "discern-self-",
  /** Scaffolds and per-run temp homes discern's own test harness mints
   * (tests/engine_helpers.ts, tests/helpers.ts). The harness removes them at
   * process exit; this family collects what a killed run leaves. Matches
   * nothing outside discern's own development. */
  testScaffold: "discern-test-",
} as const;

export type TempArtifactDirKind = keyof typeof TEMP_ARTIFACT_DIR_KINDS;

/** Every artifact family shares the suffix, so the prune match stays narrow. */
export const TEMP_ARTIFACT_SUFFIX = ".log";

/** How long an artifact outlives its run. Long enough to inspect a result
 * envelope hours later; short enough that steady agent-driven gate traffic
 * carries at most a day of logs. */
export const TEMP_ARTIFACT_TTL_MS = 24 * 60 * 60 * 1000;

/** The per-sweep removal budget. The sweep runs inline before an artifact is
 * created, so it must stay fast even against a huge pre-retention backlog (tens
 * of thousands of files were observed in the wild): each sweep reaps at most
 * this many and lets subsequent runs drain the rest, while steady-state
 * production (tens of files per run) is always fully covered. */
const MAX_SWEEP_REMOVALS = 500;

/** The matching-entry inspection budget. Unlike the removal budget, this also
 * bounds a population that is entirely fresh: at most this many filesystem
 * metadata reads happen in one sweep, and candidate selection keeps at most
 * this many names per side of the cursor in memory. Directory enumeration
 * itself stays proportional to the population (a listing cannot resume
 * mid-stream, and fair rotation must consider every name) — which is why the
 * coordinator throttles pages to one per repository per hour. A persisted
 * cursor rotates later passes through the rest. */
const MAX_SWEEP_INSPECTIONS = 500;

interface SweepCandidate {
  readonly name: string;
  readonly isDirectory: boolean;
}

/** Order sweep candidates by name so cursor paging remains deterministic. */
function byName(a: SweepCandidate, b: SweepCandidate): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * A bounded keeper of the `limit` lexicographically smallest candidates seen
 * — a binary max-heap whose root is the largest kept name — so selecting a
 * page out of any population costs O(limit) memory and O(log limit) work per
 * entry, never a full collect-and-sort of everything that matches.
 */
class SmallestCandidates {
  private readonly heap: SweepCandidate[] = [];
  constructor(private readonly limit: number) {}

  offer(candidate: SweepCandidate): void {
    if (this.limit <= 0) {
      return;
    }
    if (this.heap.length < this.limit) {
      this.heap.push(candidate);
      this.siftUp(this.heap.length - 1);
      return;
    }
    const root = this.heap[0];
    if (root === undefined || byName(candidate, root) >= 0) {
      return;
    }
    this.heap[0] = candidate;
    this.siftDown();
  }

  /** The kept candidates, ascending by name. */
  drain(): SweepCandidate[] {
    return [...this.heap].sort(byName);
  }

  private swap(a: number, b: number): void {
    const left = this.heap[a];
    const right = this.heap[b];
    if (left === undefined || right === undefined) {
      return;
    }
    this.heap[a] = right;
    this.heap[b] = left;
  }

  private siftUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const child = this.heap[i];
      const above = this.heap[parent];
      if (child === undefined || above === undefined) {
        return;
      }
      if (byName(child, above) <= 0) {
        return;
      }
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(): void {
    let i = 0;
    while (true) {
      let largest = i;
      for (const child of [i * 2 + 1, i * 2 + 2]) {
        const contender = this.heap[child];
        const current = this.heap[largest];
        if (
          contender !== undefined && current !== undefined &&
          byName(contender, current) > 0
        ) {
          largest = child;
        }
      }
      if (largest === i) {
        return;
      }
      this.swap(i, largest);
      i = largest;
    }
  }
}

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
 * Create one OS-temp artifact DIRECTORY for `kind`. Same contract as
 * {@link makeTempArtifact}, directory-shaped: randomly named (a predictable
 * path in a shared temp dir would let another local user pre-plant it), and
 * reaped recursively once its mtime ages past the TTL.
 */
export function makeTempArtifactDir(
  kind: TempArtifactDirKind,
): Promise<string> {
  return Deno.makeTempDir({ prefix: TEMP_ARTIFACT_DIR_KINDS[kind] });
}

/** Testable inputs for one bounded page of the artifact population. */
export interface TempArtifactPruneOptions {
  readonly dir?: string;
  readonly ttlMs?: number;
  readonly now?: number;
  readonly maxRemovals?: number;
  readonly maxInspections?: number;
  /** Last candidate inspected by the preceding page. */
  readonly cursor?: string;
}

/** Work completed by one bounded page. */
export interface TempArtifactPruneResult {
  readonly removed: number;
  readonly inspected: number;
  /**
   * Last candidate inspected when a budget stopped the page. `undefined`
   * means every candidate was considered and the next sweep starts afresh.
   */
  readonly cursor: string | undefined;
}

/**
 * Remove registered artifacts older than the TTL from the OS temp dir, up to the
 * per-sweep removal and inspection budgets. A bigger or entirely fresh
 * population drains across later sweeps from the returned cursor instead of
 * repeating metadata reads from the beginning.
 *
 * Matching is deliberately narrow — a registered prefix AND the shared suffix,
 * regular files only — so nothing outside the registry is ever touched. `opts`
 * also let tests inject the directory, clock, and budgets; production callers
 * pass only the coordinator's persisted cursor.
 */
export async function pruneStaleTempArtifacts(
  opts: TempArtifactPruneOptions = {},
): Promise<TempArtifactPruneResult> {
  const dir = opts.dir ?? tmpdir();
  const ttlMs = opts.ttlMs ?? TEMP_ARTIFACT_TTL_MS;
  const now = opts.now ?? Date.now();
  const maxRemovals = opts.maxRemovals ?? MAX_SWEEP_REMOVALS;
  const maxInspections = opts.maxInspections ?? MAX_SWEEP_INSPECTIONS;
  const prefixes = Object.values(TEMP_ARTIFACT_KINDS);
  const dirPrefixes = Object.values(TEMP_ARTIFACT_DIR_KINDS);
  const cursor = opts.cursor;
  // One page inspects the smallest names after the cursor, wrapping to the
  // smallest overall when too few follow it — kept in bounded heaps, so the
  // pass over the directory never buffers or sorts the whole population.
  const above = new SmallestCandidates(maxInspections);
  const wrap = cursor === undefined
    ? undefined
    : new SmallestCandidates(maxInspections);
  let population = 0;
  let removed = 0;
  let inspected = 0;
  try {
    for await (const entry of Deno.readDir(dir)) {
      // Files match a registered prefix AND the shared suffix; directories
      // match a registered dir prefix. Anything else is never touched.
      const isArtifactFile = entry.isFile &&
        entry.name.endsWith(TEMP_ARTIFACT_SUFFIX) &&
        prefixes.some((p) => entry.name.startsWith(p));
      const isArtifactDir = entry.isDirectory &&
        dirPrefixes.some((p) => entry.name.startsWith(p));
      if (!isArtifactFile && !isArtifactDir) {
        continue;
      }
      population++;
      const candidate = { name: entry.name, isDirectory: isArtifactDir };
      if (cursor !== undefined && entry.name <= cursor) {
        wrap?.offer(candidate);
      } else {
        above.offer(candidate);
      }
    }
  } catch {
    return { removed, inspected, cursor: undefined };
  }
  const page = above.drain();
  if (wrap !== undefined && page.length < maxInspections) {
    page.push(...wrap.drain().slice(0, maxInspections - page.length));
  }

  let lastInspected: string | undefined;
  for (const entry of page) {
    if (removed >= maxRemovals || inspected >= maxInspections) {
      return { removed, inspected, cursor: lastInspected };
    }
    lastInspected = entry.name;
    inspected++;
    const path = join(dir, entry.name);
    try {
      const mtime = (await Deno.stat(path)).mtime?.getTime();
      if (mtime === undefined || now - mtime < ttlMs) {
        continue; // fresh, or an unreadable age — keep (fail-safe)
      }
      await Deno.remove(path, { recursive: entry.isDirectory });
      removed++;
    } catch {
      // Raced away by a concurrent process, or unreadable — skip it.
    }
  }
  return {
    removed,
    inspected,
    // A page smaller than the population leaves names uninspected; the next
    // page resumes after the last one this page reached.
    cursor: population > page.length ? lastInspected : undefined,
  };
}
