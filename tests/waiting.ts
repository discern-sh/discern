/** Condition-oriented waiting and the closed set of real test delays. */

import { type Clock, SYSTEM_CLOCK } from "../src/shared/clock.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { type Scheduler, SYSTEM_SCHEDULER } from "../src/shared/scheduler.ts";

/** The semantic reason a registered test interval must remain real. */
export type TestRealDelayClassification =
  | "elapsed-behavior"
  | "negative-observation-window"
  | "adversarial-stimulus";

/** Evidence recorded for one test whose contract genuinely spends wall time. */
export interface TestRealDelayBoundary {
  /** Repository-relative module containing the one enrolled call. */
  readonly path: string;
  /** Stable test or helper name surrounding the enrolled call. */
  readonly enclosing: string;
  /** What the elapsed interval does in the scenario. */
  readonly operation: string;
  /** Why observation or fake time cannot replace the real interval. */
  readonly reason: string;
  /** Which retained semantic role makes elapsed scheduler time essential. */
  readonly classification: TestRealDelayClassification;
}

/**
 * The complete set of genuine JavaScript timer intervals in executable test code.
 * The structural guard binds every member to exactly one literal call site.
 */
export const TEST_REAL_DELAY_BOUNDARIES = {
  "commit-hook-quiescence-window": {
    path: "tests/discern_commit_enrolment_test.ts",
    enclosing:
      "the attributed commit boundary quiesces backgrounded hook descendants",
    operation:
      "release a post-commit descendant after return and observe it cannot write",
    reason:
      "The assertion is absence after an explicit post-return release, so no positive condition can complete it early.",
    classification: "negative-observation-window",
  },
  "escaped-daemon-hold": {
    path: "tests/fixtures/escaped_daemon.ts",
    enclosing: "Escaped daemon fixture",
    operation: "keep detached inherited pipes open after the leader exits",
    reason:
      "The runner's drain-bound behavior is tested only while the escaped descendant deliberately retains the pipes for an elapsed lifetime.",
    classification: "adversarial-stimulus",
  },
  "job-descendant-quiescence-window": {
    path: "tests/jobs_runner_test.ts",
    enclosing:
      "spawnJob quiesces background descendants before a clean result returns",
    operation: "observe that a released background job cannot write late",
    reason:
      "The assertion is the absence of a write scheduled after the job result, so no positive condition can complete it early.",
    classification: "negative-observation-window",
  },
  "interactive-tty-start-delay": {
    path: "tests/fixtures/interactive_tty_harness.ts",
    enclosing: "main",
    operation: "delay scripted interaction until the target state is exposed",
    reason:
      "The scenario deliberately postpones the first read; the parent still waits for the child-owned first-read acknowledgment before sending EOF.",
    classification: "adversarial-stimulus",
  },
  "pty-child-frame-completion": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "multi-write-frame",
    operation: "separate the middle and complete writes of one PTY frame",
    reason:
      "The scenario proves ordered multi-write rendering, so the writes must occupy distinct elapsed intervals.",
    classification: "adversarial-stimulus",
  },
  "pty-child-frame-middle": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "multi-write-frame",
    operation: "separate the opening and middle writes of one PTY frame",
    reason:
      "The scenario proves ordered multi-write rendering, so the writes must occupy distinct elapsed intervals.",
    classification: "adversarial-stimulus",
  },
  "pty-child-held-input-window": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "held-input",
    operation: "observe whether the wrapper input remains open after one read",
    reason:
      "The assertion distinguishes an open blocked read from EOF by allowing an explicit observation window to win the race.",
    classification: "negative-observation-window",
  },
  "pty-child-progress-phase-two": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "progressing-raw",
    operation: "delay completion after the second scripted input phase",
    reason:
      "The test subject is whether the completion timeout restarts after each observed input phase.",
    classification: "adversarial-stimulus",
  },
  "pty-child-progress-phase-one": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "progressing-raw",
    operation: "delay the second readiness marker after the first input phase",
    reason:
      "The test subject is whether the completion timeout restarts after each observed input phase.",
    classification: "adversarial-stimulus",
  },
  "pty-child-slow-start": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "slow-raw",
    operation: "delay raw-mode readiness beyond the completion timeout",
    reason:
      "The scenario proves startup readiness and completion use different clocks by intentionally exceeding the latter before readiness.",
    classification: "adversarial-stimulus",
  },
  "routed-command-quiescence-window": {
    path: "tests/owned_child_test.ts",
    enclosing:
      "a routed setup command quiesces background descendants before returning",
    operation: "observe that a released routed descendant cannot write late",
    reason:
      "The assertion is the absence of a delayed write after command settlement, which requires the planted window to pass.",
    classification: "negative-observation-window",
  },
  "slot-lock-holder-lifetime": {
    path: "tests/fixtures/slot_lock_holder.ts",
    enclosing: "Acquire one advisory slot lock",
    operation: "keep a child process and its advisory lock alive until SIGKILL",
    reason:
      "The crash-safety test requires a live process to own the kernel lock; its termination signal is the only external release event.",
    classification: "adversarial-stimulus",
  },
  "suite-temp-child-lifetime": {
    path: "tests/fixtures/suite_temp_child.ts",
    enclosing: "Create a suite-owned temp directory",
    operation: "keep a suite-temp owner alive until the parent kills it",
    reason:
      "The test distinguishes normal unload cleanup from a killed process, so the child must remain alive without reaching unload first.",
    classification: "adversarial-stimulus",
  },
  "self-signal-desk-lifetime": {
    path: "tests/fixtures/self_signalling_child.ts",
    enclosing: "desk",
    operation: "keep the Desk child alive after it interrupts its parent",
    reason:
      "The Desk resume contract requires a still-live child tree for the parent to forward and reap after the interrupt.",
    classification: "adversarial-stimulus",
  },
  "self-signal-desk-trigger": {
    path: "tests/fixtures/self_signalling_child.ts",
    enclosing: "desk",
    operation: "interrupt the Desk driver after child startup",
    reason:
      "The signal must arrive asynchronously while the parent owns the live child, which is the interaction under test.",
    classification: "adversarial-stimulus",
  },
  "self-signal-owned-lifetime": {
    path: "tests/fixtures/self_signalling_child.ts",
    enclosing: "owned",
    operation: "keep the owned child alive after it interrupts its parent",
    reason:
      "Signal forwarding and escalation require a still-live child for the parent to terminate after receiving the interrupt.",
    classification: "adversarial-stimulus",
  },
  "self-signal-owned-trigger": {
    path: "tests/fixtures/self_signalling_child.ts",
    enclosing: "owned",
    operation: "interrupt the owned-child driver after child startup",
    reason:
      "The signal must arrive asynchronously while the parent is awaiting the child, which is the behavior under test.",
    classification: "adversarial-stimulus",
  },
  "waiting-real-delay-fake-time": {
    path: "tests/waiting_test.ts",
    enclosing: "realDelay follows the test scheduler",
    operation: "advance an enrolled elapsed-time assertion",
    reason:
      "The test's subject is the realDelay capability itself; FakeTime proves the interval without spending wall time.",
    classification: "elapsed-behavior",
  },
  "worktree-probe-hook-quiescence-window": {
    path: "tests/engine_worktree_probe_test.ts",
    enclosing:
      "probeWorktreeViability: a backgrounded Git hook is quiesced before teardown",
    operation:
      "release a checkout-hook descendant after teardown and observe it cannot recreate the probe",
    reason:
      "The assertion is absence after an explicit post-teardown release, so no positive condition can complete it early.",
    classification: "negative-observation-window",
  },
  "worktree-probe-job-quiescence-window": {
    path: "tests/engine_worktree_probe_test.ts",
    enclosing:
      "probeWorktreeViability: a command-owned late writer cannot follow a successful teardown",
    operation:
      "release a command descendant after teardown and observe it cannot recreate the probe",
    reason:
      "The assertion is absence after an explicit post-teardown release, so no positive condition can complete it early.",
    classification: "negative-observation-window",
  },
} as const satisfies Record<string, TestRealDelayBoundary>;

export type TestRealDelayBoundaryId = keyof typeof TEST_REAL_DELAY_BOUNDARIES;

/** Options for one bounded eventual-condition observation. */
export interface WaitUntilOptions {
  /** Maximum elapsed scheduler time before the condition fails. */
  readonly timeoutMs?: number;
  /** Shared budget supplying the timeout when `timeoutMs` is absent. */
  readonly allowance?: ProcessAllowance;
  /** Scheduler interval between condition observations. */
  readonly intervalMs?: number;
  /** Monotonic clock used for the elapsed wait budget. */
  readonly clock?: Clock;
  /** Timer lifecycle used between condition observations. */
  readonly scheduler?: Scheduler;
}

/** Load-safe infrastructure allowance for a real child or async operation. */
export const TEST_PROCESS_TIMEOUT_MS = 180_000;

/** One test's shared load-safe budget, divided between every wait drawing on it. */
export interface ProcessAllowance {
  /** Scheduler-time budget remaining before the owning test must fail. */
  remaining(): number;
}

/**
 * Open one shared process allowance for a whole test. Waits that draw on it
 * split the canonical load-safe budget between them, so parallel-suite load can
 * stretch any single wait while a genuinely hung operation still costs the test
 * at most one allowance — never one allowance per wait.
 */
export function processAllowance(
  clock: Clock = SYSTEM_CLOCK,
): ProcessAllowance {
  const opened = clock.monotonicNow();
  return {
    remaining: (): number =>
      Math.max(0, TEST_PROCESS_TIMEOUT_MS - (clock.monotonicNow() - opened)),
  };
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERVAL_MS = 10;

/**
 * Wait for one filesystem marker through a positive condition.
 *
 * Filesystem notifications are scheduling hints, not durable readiness
 * evidence: a write can land before an iterator read is armed. Poll the marker
 * through the shared load-safe process budget so a retained file cannot be
 * missed and a genuinely absent marker remains bounded.
 */
export async function waitForPath(path: string): Promise<void> {
  await waitUntil(
    () => targetExists(path),
    `filesystem marker ${path} to appear`,
    { timeoutMs: TEST_PROCESS_TIMEOUT_MS },
  );
}

type PendingOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

/** Observe one promise without introducing another timer or rejection path. */
function observePending<T>(
  pending: Promise<T>,
): () => PendingOutcome<T> | undefined {
  let outcome: PendingOutcome<T> | undefined;
  void pending.then(
    (value) => {
      outcome = { ok: true, value };
    },
    (error: unknown) => {
      outcome = { ok: false, error };
    },
  );
  return () => outcome;
}

/** One scheduler turn whose timer is intercepted by the test stack's FakeTime. */
function schedulerDelay(
  ms: number,
  signal: AbortSignal | undefined,
  scheduler: Scheduler,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = scheduler.scheduleTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = (): void => {
      scheduler.cancelTimeout(timer);
      reject(signal?.reason ?? new DOMException("Delay aborted", "AbortError"));
    };
    if (signal?.aborted === true) {
      abort();
    } else {
      signal?.addEventListener("abort", abort, { once: true });
    }
  });
}

/** Render a thrown condition without losing its original cause. */
function conditionFailure(
  describe: string,
  attempt: number,
  elapsedMs: number,
  error: unknown,
): Error {
  return new Error(
    `condition '${describe}' threw on attempt ${attempt} after ${elapsedMs}ms`,
    { cause: error },
  );
}

/**
 * Observe `condition` until it succeeds or its scheduler-time budget expires.
 * A false condition yields through a bounded timer, so the loop never spins.
 */
export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  describe: string,
  options: WaitUntilOptions = {},
): Promise<void> {
  if (describe.trim().length === 0) {
    throw new TypeError("waitUntil requires a description of the condition");
  }
  if (options.timeoutMs !== undefined && options.allowance !== undefined) {
    throw new TypeError(
      "waitUntil takes an explicit timeoutMs or a shared allowance, not both",
    );
  }
  const timeoutMs = options.timeoutMs ?? options.allowance?.remaining() ??
    DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const clock = options.clock ?? SYSTEM_CLOCK;
  const scheduler = options.scheduler ?? SYSTEM_SCHEDULER;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(
      "waitUntil timeoutMs must be a finite non-negative number",
    );
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError(
      "waitUntil intervalMs must be a finite positive number",
    );
  }

  const started = clock.monotonicNow();
  let attempts = 0;
  while (true) {
    attempts++;
    const elapsedMs = clock.monotonicNow() - started;
    let met: boolean;
    try {
      met = await condition();
    } catch (error) {
      throw conditionFailure(describe, attempts, elapsedMs, error);
    }
    if (met) return;
    if (elapsedMs >= timeoutMs) {
      throw new Error(
        `timed out waiting for '${describe}' after ${elapsedMs}ms ` +
          `(budget ${timeoutMs}ms, interval ${intervalMs}ms, ${attempts} attempts)`,
      );
    }
    await schedulerDelay(
      Math.min(intervalMs, timeoutMs - elapsedMs),
      undefined,
      scheduler,
    );
  }
}

/** Options for infrastructure readiness; its timeout is one shared policy. */
export type PendingConditionOptions<T> =
  & Omit<
    WaitUntilOptions,
    "timeoutMs"
  >
  & {
    /** Add operation-specific evidence when it resolves before readiness. */
    readonly settledError?: (value: T) => Error | Promise<Error>;
  };

/**
 * Wait for a positive condition planted by a pending operation. Readiness is
 * infrastructure, not the behavior under test: parallel-suite load may delay
 * it up to the canonical process allowance — the whole allowance alone, or the
 * remaining share of the test's own. An operation that settles before its
 * marker fails immediately instead of spending that allowance.
 */
export async function waitForPendingCondition<T>(
  pending: Promise<T>,
  condition: () => boolean | Promise<boolean>,
  describe: string,
  options: PendingConditionOptions<T> = {},
): Promise<void> {
  const observed = observePending(pending);
  const { settledError, allowance, ...waitOptions } = options;
  const budget = allowance !== undefined
    ? { allowance }
    : { timeoutMs: TEST_PROCESS_TIMEOUT_MS };
  let earlyFailure: { readonly error: unknown } | undefined;
  try {
    await waitUntil(
      async () => {
        if (await condition()) return true;
        const outcome = observed();
        if (outcome === undefined) return false;
        const error = !outcome.ok
          ? outcome.error
          : settledError !== undefined
          ? await settledError(outcome.value)
          : new Error(
            `${describe} was not observed before the pending operation settled: ${
              JSON.stringify(outcome.value)
            }`,
          );
        earlyFailure = { error };
        throw error;
      },
      describe,
      { ...waitOptions, ...budget },
    );
  } catch (error) {
    if (earlyFailure !== undefined) throw earlyFailure.error;
    throw error;
  }
}

/** A required, behavior-specific budget for settling one known-ready operation. */
export type PendingSettlementOptions =
  | (WaitUntilOptions & { readonly timeoutMs: number })
  | (WaitUntilOptions & { readonly allowance: ProcessAllowance });

/** Await one operation inside an explicit post-readiness behavior budget. */
export async function settlePending<T>(
  pending: Promise<T>,
  describe: string,
  options: PendingSettlementOptions,
): Promise<T> {
  const observed = observePending(pending);
  await waitUntil(() => observed() !== undefined, describe, options);
  const outcome = observed();
  if (outcome === undefined) {
    throw new Error(`${describe} settled without observable evidence`);
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/** Spend one registry-enrolled interval whose assertion subject is wall time. */
export async function realDelay(
  boundaryId: TestRealDelayBoundaryId,
  ms: number,
  signal?: AbortSignal,
  scheduler: Scheduler = SYSTEM_SCHEDULER,
): Promise<void> {
  if (!Object.hasOwn(TEST_REAL_DELAY_BOUNDARIES, boundaryId)) {
    throw new TypeError(`unknown test real-delay boundary '${boundaryId}'`);
  }
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError(
      "realDelay duration must be a finite non-negative number",
    );
  }
  await schedulerDelay(ms, signal, scheduler);
}
