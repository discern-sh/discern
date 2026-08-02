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

import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { FiredHint } from "../../shared/hints.ts";
import type { Out } from "../output.ts";
import {
  buildTestRunSlotAcquirer,
  testRunSlotAccounted,
  type TestRunSlotEvent,
  type TestRunSlotHold,
} from "../test_run_slots.ts";
import type { JobGroup } from "./plan.ts";

export type { TestRunSlotHold } from "../test_run_slots.ts";

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

/** Inputs that let a caller prove an upstream accounting decision explicitly. */
export interface BuildTestRunSlotsOptions {
  /** Whether an ancestor already accounted for this run. Defaults to the marker. */
  readonly accounted?: boolean;
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

/**
 * Build the run's slot surface from the typed config, or undefined when
 * `[gate].concurrent_test_runs` is 0 (the default): uncapped installs build no
 * slots object, touch no file, and create no directory.
 */
export function buildTestRunSlots(
  root: string,
  cfg: DiscernConfig,
  opts: BuildTestRunSlotsOptions = {},
): TestRunSlots | undefined {
  if (opts.accounted ?? testRunSlotAccounted()) {
    return undefined;
  }
  const acquirer = buildTestRunSlotAcquirer(root, cfg);
  if (acquirer === undefined) {
    return undefined;
  }
  const waits: FiredHint[] = [];
  return {
    cap: acquirer.cap,
    waits,
    async acquire(
      out: Out,
      signal?: AbortSignal,
    ): Promise<TestRunSlotHold | undefined> {
      return await acquirer.acquire((event: TestRunSlotEvent): void => {
        if (event.kind === "queued") {
          waits.push(event.hint);
          out.info(event.hint.text);
        } else if (event.kind === "unavailable") {
          waits.push(event.hint);
          out.warn(event.hint.text);
        }
      }, signal);
    },
  };
}
