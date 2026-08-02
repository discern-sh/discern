/**
 * Shared acquisition core for the repository-wide test-run cap.
 *
 * A configured cap is represented by advisory locks on content-free slot files
 * under the git common directory. Callers provide their own presentation by
 * observing acquisition events; lock probing, backoff, fail-open behavior, and
 * logbook-backed queue decoration stay here so every surface contends for the
 * same resource with the same policy.
 */

import { join } from "@std/path";
import type { DiscernConfig } from "../shared/config_schema.ts";
import { gitAdminStatePath } from "../shared/git_admin_state.ts";
import { fire, type FiredHint, HINTS } from "../shared/hints.ts";
import { runGit } from "../shared/subprocess.ts";
import { compactDuration } from "./output.ts";
import { resolveCommonGitDir } from "./worktree/git.ts";
import { readFleetLogbookActivity } from "./logbook/read.ts";
import { configEpoch } from "./logbook/epoch.ts";

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

/** A presentation-neutral milestone reported by one acquisition attempt. */
export type TestRunSlotEvent =
  | { readonly kind: "queued"; readonly hint: FiredHint }
  | { readonly kind: "unavailable"; readonly hint: FiredHint }
  | { readonly kind: "acquired" };

/** The shared slot resource used by gate groups and command wrappers. */
export interface TestRunSlotAcquirer {
  readonly cap: number;
  /**
   * Acquire one slot, waiting abortably while every slot is held. Undefined
   * means the signal aborted or the limiter failed open; callers proceed under
   * their own cancellation contract either way.
   */
  acquire(
    onEvent: (event: TestRunSlotEvent) => void,
    signal?: AbortSignal,
  ): Promise<TestRunSlotHold | undefined>;
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
 * Probe every slot without blocking and return the first lock acquired.
 * Opening or probing any candidate unsuccessfully makes the cap unavailable,
 * because partial slot visibility would make the configured bound misleading.
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
 * Read optional queue-line context from the fleet logbook. Any read failure
 * removes the decoration without affecting whether or when the lock acquires.
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
      .map((entry) => `${entry.verb} on ${entry.branch}`);
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
 * Build the configured slot acquirer, or return undefined for an absent or
 * disabled cap. The slot directory remains lazy, so disabled callers touch no
 * git administrative state.
 */
export function buildTestRunSlotAcquirer(
  root: string,
  cfg: DiscernConfig,
): TestRunSlotAcquirer | undefined {
  const cap = cfg.gate.concurrent_test_runs;
  if (!Number.isInteger(cap) || cap <= 0) {
    return undefined;
  }
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
  const failOpen = (
    reason: string,
    onEvent: (event: TestRunSlotEvent) => void,
  ): undefined => {
    if (unavailable) {
      return undefined;
    }
    unavailable = true;
    onEvent({
      kind: "unavailable",
      hint: fire(HINTS["gate-test-slots-unavailable"], { reason }),
    });
    return undefined;
  };
  return {
    cap,
    async acquire(
      onEvent: (event: TestRunSlotEvent) => void,
      signal?: AbortSignal,
    ): Promise<TestRunSlotHold | undefined> {
      if (unavailable) {
        return undefined;
      }
      const dir = await slotDir();
      if (dir === undefined) {
        return failOpen(
          "discern could not prepare its slot directory under .git",
          onEvent,
        );
      }
      let probe = await probeSlots(dir, cap);
      if (probe.kind === "acquired") {
        onEvent({ kind: "acquired" });
        return makeHold(probe.file);
      }
      if (probe.kind === "unavailable") {
        return failOpen(probe.reason, onEvent);
      }
      onEvent({
        kind: "queued",
        hint: fire(HINTS["gate-test-run-queued"], {
          cap,
          logbookOff: !cfg.project.logbook,
          ...(cfg.project.logbook
            ? await waitDecoration(root, cfg)
            : NO_DECORATION),
        }),
      });
      let interval = POLL_INITIAL_MS;
      while (true) {
        await abortableDelay(interval * (0.75 + Math.random() * 0.5), signal);
        if (signal?.aborted === true) {
          return undefined;
        }
        probe = await probeSlots(dir, cap);
        if (probe.kind === "acquired") {
          onEvent({ kind: "acquired" });
          return makeHold(probe.file);
        }
        if (probe.kind === "unavailable") {
          return failOpen(probe.reason, onEvent);
        }
        interval = Math.min(POLL_CAP_MS, interval * POLL_FACTOR);
      }
    },
  };
}
