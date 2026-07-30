/**
 * The fleet test-run cap — `[gate].concurrent_test_runs` bounds how many
 * test-stage runs (the gate's test group, `discern test`, and `discern
 * standards`' measurement pass) may be in flight across EVERY checkout of this
 * repository at once. Linked worktrees share one machine, and one real test
 * suite can saturate it on its own, so a second concurrent suite thrashes the
 * first instead of borrowing idle capacity; the fleet is the scope that can
 * bound that load, and no per-project runner setting can (it neither sees the
 * sibling checkouts nor composes across them).
 *
 * A slot is an OS advisory file lock ({@link Deno.FsFile.tryLock}) on one of N
 * content-free files under the shared git common directory. Held-ness lives
 * entirely in the kernel: the OS releases a lock when its process dies, so a
 * crashed or killed run can never wedge the fleet — no daemon, no heartbeats,
 * no reclamation sweep, no state beyond held-ness. Slot files are created on
 * demand and never deleted: an unlink would split the lock domain (a
 * re-created name is a new inode, so two holders could share one slot); a
 * higher-numbered file left behind by a lowered cap is inert.
 *
 * Acquisition probes every slot with a non-blocking `tryLock`, then re-probes
 * on a capped backoff with jitter. A kernel-blocking `lock()` wait is rejected
 * twice over: Deno cannot cancel a pending lock operation (an abort would
 * strand the op, pinning the event loop of a long-lived MCP server), and with
 * N > 1 a waiter blocked on one slot ignores another slot freeing. The
 * backoff's worst-case wake latency (~2s) is noise against the minutes-scale
 * runs the cap exists for.
 *
 * The logbook decorates the wait line (what is in flight, a typical duration)
 * but never decides it: the lock files are the only authority on whether a run
 * may proceed, and a logbook-off install keeps the whole feature minus the
 * estimate.
 */

import { join } from "@std/path";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { runGit } from "../../shared/subprocess.ts";
import { compactDuration, type Out } from "../output.ts";
import { resolveCommonGitDir } from "../worktree/git.ts";
import { readFleetLogbookActivity } from "../logbook/read.ts";
import { configEpoch } from "../logbook/epoch.ts";
import type { JobGroup } from "./plan.ts";

/** Re-probe backoff while every slot is held: start fast, settle near ~2s. */
const POLL_INITIAL_MS = 150;
const POLL_FACTOR = 1.6;
const POLL_CAP_MS = 2_000;

/** At most this many in-flight sibling runs are named on the wait line. */
const WAIT_LINE_IN_FLIGHT_LIMIT = 2;

/** One held slot. Releasing closes the file, which releases the OS lock. */
export interface TestRunSlotHold {
  release(): void;
}

/**
 * The per-run slot surface a gate verb carries: the configured cap, the
 * acquire call the group executor makes before a test-stage group runs, and
 * the wait hints fired along the way (the verb appends them to its result's
 * `hints[]`, so a `--json`/MCP caller sees the wait the human line narrated).
 */
export interface TestRunSlots {
  readonly cap: number;
  /** Every wait or cap-unavailable hint this run fired, in order. */
  readonly waits: FiredHint[];
  /**
   * Acquire one slot, waiting (abortably) while every slot is held. Returns
   * undefined when the signal aborted or the slot files were unusable — the
   * caller proceeds either way; an aborted run's jobs die on the same signal.
   */
  acquire(out: Out, signal?: AbortSignal): Promise<TestRunSlotHold | undefined>;
}

/**
 * Whether a group carries work the cap bounds: a firing test-stage job or a
 * standard's measurement. Derived from the group's own jobs, never from which
 * verb built it, so every current and future gate verb enrols by construction
 * — `prepare` (fix + check) never matches, and a replay-only standards group
 * (nothing runs) never matches either.
 */
export function groupNeedsTestSlot(group: JobGroup): boolean {
  return group.jobs.some(
    (j) => j.willRun && (j.reportStage === "test" || j.kind === "standard"),
  );
}

/** A sleep the abort signal can cut short. Resolves either way. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

type SlotProbe =
  | { kind: "acquired"; file: Deno.FsFile }
  | { kind: "held" }
  | { kind: "unavailable"; reason: string };

/**
 * One non-blocking pass over every slot file. Opens each candidate and takes
 * the first free lock; a file that cannot be opened or probed makes the whole
 * cap unavailable (fail open — the cap protects throughput, and a run that
 * would otherwise be green must not fail over a lock file).
 */
async function probeSlots(dir: string, cap: number): Promise<SlotProbe> {
  for (let i = 1; i <= cap; i++) {
    const path = join(dir, `slot-${i}`);
    let file: Deno.FsFile;
    try {
      file = await Deno.open(path, { create: true, read: true, write: true });
    } catch (error) {
      return {
        kind: "unavailable",
        reason: `discern could not open its slot file at ${path} (${
          error instanceof Error ? error.message : String(error)
        })`,
      };
    }
    let acquired: boolean;
    try {
      acquired = await file.tryLock(true);
    } catch (error) {
      file.close();
      return {
        kind: "unavailable",
        reason: `discern could not probe its slot file at ${path} (${
          error instanceof Error ? error.message : String(error)
        })`,
      };
    }
    if (acquired) {
      return { kind: "acquired", file };
    }
    file.close();
  }
  return { kind: "held" };
}

/** Wrap an acquired slot file as an idempotent hold. */
function makeHold(file: Deno.FsFile): TestRunSlotHold {
  let released = false;
  return {
    release(): void {
      if (released) {
        return;
      }
      released = true;
      // Closing the file releases the advisory lock; the OS does the same if
      // the process dies first, which is the design's crash-safety.
      file.close();
    },
  };
}

const NO_DECORATION: {
  inFlight: string | undefined;
  typical: string | undefined;
} = {
  inFlight: undefined,
  typical: undefined,
};

/**
 * The logbook decoration for the wait line: which sibling runs are in flight
 * (from unmatched begin events) and how long the first one typically takes
 * (the verb's median duration prior). Best-effort and advisory throughout —
 * any failure to read decorates with nothing, and the wait itself never
 * consults the logbook (the lock files are the only authority).
 */
async function waitDecoration(
  root: string,
  cfg: DiscernConfig,
): Promise<{ inFlight: string | undefined; typical: string | undefined }> {
  try {
    const commonGitDir = await resolveCommonGitDir(root);
    if (commonGitDir === undefined) {
      return NO_DECORATION;
    }
    const branchProbe = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: root,
    });
    const ownBranch = branchProbe.success ? branchProbe.stdout.trim() : "";
    const activity = await readFleetLogbookActivity(
      commonGitDir,
      configEpoch(cfg).fingerprint,
    );
    const running: { branch: string; verb: string }[] = [];
    for (const [branch, entry] of activity.byBranch) {
      // This waiting run appended its own begin event before queueing; the
      // wait line names the OTHER runs, the ones holding the slots.
      if (entry.running === undefined || branch === ownBranch) {
        continue;
      }
      running.push({ branch, verb: entry.running.verb });
    }
    const first = running[0];
    if (first === undefined) {
      return NO_DECORATION;
    }
    const shown = running
      .slice(0, WAIT_LINE_IN_FLIGHT_LIMIT)
      .map((r) => `${r.verb} on ${r.branch}`);
    const rest = running.length - shown.length;
    const inFlight = rest > 0
      ? `${shown.join(", ")}, and ${rest} more`
      : shown.join(", ");
    const typicalMs = activity.durationPriors.get(first.verb)?.medianMs;
    return {
      inFlight,
      typical: typicalMs === undefined ? undefined : compactDuration(typicalMs),
    };
  } catch {
    return NO_DECORATION;
  }
}

/**
 * Build the run's slot surface from the typed config, or undefined when
 * `[gate].concurrent_test_runs` is 0 (the default): uncapped installs build no
 * slots object, touch no file, and create no directory.
 */
export function buildTestRunSlots(
  root: string,
  cfg: DiscernConfig,
): TestRunSlots | undefined {
  const cap = cfg.gate.concurrent_test_runs;
  if (!Number.isInteger(cap) || cap <= 0) {
    return undefined;
  }
  const waits: FiredHint[] = [];
  let dirPromise: Promise<string | undefined> | undefined;
  let unavailable = false;
  const slotDir = (): Promise<string | undefined> => {
    dirPromise ??= (async (): Promise<string | undefined> => {
      const dir = await gitAdminStatePath(root, "testSlots");
      if (dir === undefined) {
        return undefined;
      }
      try {
        await Deno.mkdir(dir, { recursive: true });
      } catch {
        return undefined;
      }
      return dir;
    })();
    return dirPromise;
  };
  const failOpen = (out: Out, reason: string): undefined => {
    // Warn once per run: a second capped group repeating the same news is noise.
    if (unavailable) {
      return undefined;
    }
    unavailable = true;
    const hint = fire(HINTS["gate-test-slots-unavailable"], { reason });
    waits.push(hint);
    out.warn(hint.text);
    return undefined;
  };
  return {
    cap,
    waits,
    async acquire(
      out: Out,
      signal?: AbortSignal,
    ): Promise<TestRunSlotHold | undefined> {
      if (unavailable) {
        return undefined;
      }
      const dir = await slotDir();
      if (dir === undefined) {
        return failOpen(
          out,
          "discern could not prepare its slot directory under .git",
        );
      }
      let probe = await probeSlots(dir, cap);
      if (probe.kind === "acquired") {
        return makeHold(probe.file);
      }
      if (probe.kind === "unavailable") {
        return failOpen(out, probe.reason);
      }
      // Every slot is held: say why once, calmly, then wait for one to free.
      const hint = fire(HINTS["gate-test-run-queued"], {
        cap,
        logbookOff: !cfg.project.logbook,
        ...(cfg.project.logbook
          ? await waitDecoration(root, cfg)
          : NO_DECORATION),
      });
      waits.push(hint);
      out.info(hint.text);
      let interval = POLL_INITIAL_MS;
      while (true) {
        // Jitter desynchronizes waiters that queued in the same instant.
        await abortableDelay(interval * (0.75 + Math.random() * 0.5), signal);
        if (signal?.aborted === true) {
          return undefined;
        }
        probe = await probeSlots(dir, cap);
        if (probe.kind === "acquired") {
          return makeHold(probe.file);
        }
        if (probe.kind === "unavailable") {
          return failOpen(out, probe.reason);
        }
        interval = Math.min(POLL_CAP_MS, interval * POLL_FACTOR);
      }
    },
  };
}
