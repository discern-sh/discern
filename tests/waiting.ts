/** Condition-oriented waiting and the closed set of real test delays. */

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
}

/**
 * The complete set of genuine wall-clock intervals in executable test code.
 * The structural guard binds every member to exactly one literal call site.
 */
export const TEST_REAL_DELAY_BOUNDARIES = {
  "commit-hook-quiescence-window": {
    path: "tests/discern_commit_enrolment_test.ts",
    enclosing:
      "the attributed commit boundary quiesces backgrounded hook descendants",
    operation: "observe that a delayed post-commit descendant cannot write",
    reason:
      "Absence before the hook's planted delay expires cannot prove that the commit boundary reaped it.",
  },
  "escaped-daemon-hold": {
    path: "tests/fixtures/escaped_daemon.ts",
    enclosing: "Escaped daemon fixture",
    operation: "keep detached inherited pipes open after the leader exits",
    reason:
      "The runner's drain-bound behavior is tested only while the escaped descendant deliberately retains the pipes for an elapsed lifetime.",
  },
  "job-descendant-quiescence-window": {
    path: "tests/jobs_runner_test.ts",
    enclosing:
      "spawnJob quiesces background descendants before a clean result returns",
    operation: "observe that a released background job cannot write late",
    reason:
      "The assertion is the absence of a write scheduled after the job result, so no positive condition can complete it early.",
  },
  "interactive-tty-resize-delay": {
    path: "tests/fixtures/interactive_tty_harness.ts",
    enclosing: "main",
    operation: "move the PTY viewport during a live interactive frame",
    reason:
      "The resize scenario intentionally changes terminal geometry after startup and has no child-owned readiness marker.",
  },
  "interactive-tty-start-delay": {
    path: "tests/fixtures/interactive_tty_harness.ts",
    enclosing: "main",
    operation: "delay scripted interaction until the target state is exposed",
    reason:
      "This legacy interactive scenario observes behavior during a deliberately elapsed startup window and exposes no positive readiness signal.",
  },
  "pty-input-phase-settle": {
    path: "tests/fixtures/pty_process.ts",
    enclosing: "runPtyProcess",
    operation: "hold a readiness keyframe until its multi-write frame settles",
    reason:
      "The PTY output has no frame-complete protocol beyond the scenario's declared quiet interval.",
  },
  "pty-child-frame-completion": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "multi-write-frame",
    operation: "separate the middle and complete writes of one PTY frame",
    reason:
      "The scenario proves ordered multi-write rendering, so the writes must occupy distinct elapsed intervals.",
  },
  "pty-child-frame-middle": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "multi-write-frame",
    operation: "separate the opening and middle writes of one PTY frame",
    reason:
      "The scenario proves ordered multi-write rendering, so the writes must occupy distinct elapsed intervals.",
  },
  "pty-child-held-input-window": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "held-input",
    operation: "observe whether the wrapper input remains open after one read",
    reason:
      "The assertion distinguishes an open blocked read from EOF by allowing an explicit observation window to win the race.",
  },
  "pty-child-progress-phase-two": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "progressing-raw",
    operation: "delay completion after the second scripted input phase",
    reason:
      "The test subject is whether the completion timeout restarts after each observed input phase.",
  },
  "pty-child-progress-phase-one": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "progressing-raw",
    operation: "delay the second readiness marker after the first input phase",
    reason:
      "The test subject is whether the completion timeout restarts after each observed input phase.",
  },
  "pty-child-slow-start": {
    path: "tests/fixtures/pty_child_program.ts",
    enclosing: "slow-raw",
    operation: "delay raw-mode readiness beyond the completion timeout",
    reason:
      "The scenario proves startup readiness and completion use different clocks by intentionally exceeding the latter before readiness.",
  },
  "pty-input-step-pacing": {
    path: "tests/fixtures/pty_process.ts",
    enclosing: "runPtyProcess",
    operation: "separate intentionally distinct terminal input writes",
    reason:
      "The tests exercise byte sequences arriving in separate terminal reads; a condition would collapse the input timing under test.",
  },
  "pty-termination-grace": {
    path: "tests/fixtures/pty_process.ts",
    enclosing: "terminateProcessTree",
    operation: "allow TERM handling before escalating the PTY tree to KILL",
    reason:
      "Graceful signal handling is the timing contract, and the child offers no positive completion condition before escalation.",
  },
  "routed-command-quiescence-window": {
    path: "tests/owned_child_test.ts",
    enclosing:
      "a routed setup command quiesces background descendants before returning",
    operation: "observe that a released routed descendant cannot write late",
    reason:
      "The assertion is the absence of a delayed write after command settlement, which requires the planted window to pass.",
  },
  "terminal-resize-delay": {
    path: "tests/fixtures/terminal_resize_harness.ts",
    enclosing: "main",
    operation: "resize a real terminal after the scenario's declared interval",
    reason:
      "Unmarked real-PTY scenarios require the viewport change to occur after startup rather than at an observable child transition.",
  },
  "slot-lock-holder-lifetime": {
    path: "tests/fixtures/slot_lock_holder.ts",
    enclosing: "Acquire one advisory slot lock",
    operation: "keep a child process and its advisory lock alive until SIGKILL",
    reason:
      "The crash-safety test requires a live process to own the kernel lock; its termination signal is the only external release event.",
  },
  "suite-temp-child-lifetime": {
    path: "tests/fixtures/suite_temp_child.ts",
    enclosing: "Create a suite-owned temp directory",
    operation: "keep a suite-temp owner alive until the parent kills it",
    reason:
      "The test distinguishes normal unload cleanup from a killed process, so the child must remain alive without reaching unload first.",
  },
  "self-signal-desk-lifetime": {
    path: "tests/fixtures/self_signalling_child.ts",
    enclosing: "desk",
    operation: "keep the Desk child alive after it interrupts its parent",
    reason:
      "The Desk resume contract requires a still-live child tree for the parent to forward and reap after the interrupt.",
  },
  "self-signal-desk-trigger": {
    path: "tests/fixtures/self_signalling_child.ts",
    enclosing: "desk",
    operation: "interrupt the Desk driver after child startup",
    reason:
      "The signal must arrive asynchronously while the parent owns the live child, which is the interaction under test.",
  },
  "self-signal-owned-lifetime": {
    path: "tests/fixtures/self_signalling_child.ts",
    enclosing: "owned",
    operation: "keep the owned child alive after it interrupts its parent",
    reason:
      "Signal forwarding and escalation require a still-live child for the parent to terminate after receiving the interrupt.",
  },
  "self-signal-owned-trigger": {
    path: "tests/fixtures/self_signalling_child.ts",
    enclosing: "owned",
    operation: "interrupt the owned-child driver after child startup",
    reason:
      "The signal must arrive asynchronously while the parent is awaiting the child, which is the behavior under test.",
  },
  "validation-capture-deadline-watchdog": {
    path: "tests/validation_evidence_test.ts",
    enclosing: "assertCaptureDeadline",
    operation: "bound a categorical capture-deadline assertion",
    reason:
      "The test subject is the validation capture's elapsed-time deadline; the later watchdog distinguishes a returned deadline result from a hang.",
  },
  "waiting-real-delay-fake-time": {
    path: "tests/waiting_test.ts",
    enclosing: "realDelay follows the test scheduler",
    operation: "advance an enrolled elapsed-time assertion",
    reason:
      "The test's subject is the realDelay capability itself; FakeTime proves the interval without spending wall time.",
  },
  "worktree-probe-hook-quiescence-window": {
    path: "tests/engine_worktree_probe_test.ts",
    enclosing:
      "probeWorktreeViability: a backgrounded Git hook is quiesced before teardown",
    operation: "observe that a delayed checkout-hook descendant cannot recreate the probe",
    reason:
      "Only the full planted hook delay can prove the successful teardown did not return ahead of its process group.",
  },
  "worktree-probe-job-quiescence-window": {
    path: "tests/engine_worktree_probe_test.ts",
    enclosing:
      "probeWorktreeViability: a command-owned late writer cannot follow a successful teardown",
    operation: "observe that a delayed command descendant cannot recreate the probe",
    reason:
      "The negative post-teardown assertion becomes meaningful only after the planted writer's delay has elapsed.",
  },
} as const satisfies Record<string, TestRealDelayBoundary>;

export type TestRealDelayBoundaryId = keyof typeof TEST_REAL_DELAY_BOUNDARIES;

/** Options for one bounded eventual-condition observation. */
export interface WaitUntilOptions {
  /** Maximum elapsed scheduler time before the condition fails. */
  readonly timeoutMs?: number;
  /** Scheduler interval between condition observations. */
  readonly intervalMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERVAL_MS = 10;

/** One scheduler turn whose timer is intercepted by the test stack's FakeTime. */
function schedulerDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = (): void => {
      clearTimeout(timer);
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
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError("waitUntil timeoutMs must be a finite non-negative number");
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("waitUntil intervalMs must be a finite positive number");
  }

  const started = Date.now();
  let attempts = 0;
  while (true) {
    attempts++;
    const elapsedMs = Date.now() - started;
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
    await schedulerDelay(Math.min(intervalMs, timeoutMs - elapsedMs));
  }
}

/** Spend one registry-enrolled interval whose assertion subject is wall time. */
export async function realDelay(
  boundaryId: TestRealDelayBoundaryId,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  if (!Object.hasOwn(TEST_REAL_DELAY_BOUNDARIES, boundaryId)) {
    throw new TypeError(`unknown test real-delay boundary '${boundaryId}'`);
  }
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError("realDelay duration must be a finite non-negative number");
  }
  await schedulerDelay(ms, signal);
}
