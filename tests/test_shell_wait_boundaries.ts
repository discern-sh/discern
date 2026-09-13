/** Reviewed shell polling and elapsed-time contracts; every site is bound by syntax. */
import type { ShellWaitBoundary } from "./test_shell_wait_guard.ts";

export const TEST_SHELL_WAIT_BOUNDARIES = [
  {
    path: "tests/engine_integration_landing_test.ts",
    enclosing:
      "a sibling completes while an integration landing's resource teardown runs",
    argument: "0.1",
    count: 1,
    classification: "condition-poll",
    reason:
      "The paused resource destroy polls the parent-owned release file; the sibling completion under test must run while the cleanup holds.",
  },
  {
    path: "tests/engine_integration_landing_test.ts",
    enclosing: "a sibling completion publishes while an integration gate runs",
    argument: "0.1",
    count: 1,
    classification: "condition-poll",
    reason:
      "The paused integration gate polls the parent-owned release file; the sibling completion under test must run while it holds.",
  },
  {
    path: "tests/engine_integration_recovery_test.ts",
    enclosing:
      "a running done in the author checkout is never deadlocked by acceptance",
    argument: "0.1",
    count: 1,
    classification: "condition-poll",
    reason:
      "The paused author gate polls the parent-owned release file while acceptance and the rerun contend for the checkout.",
  },
  {
    path: "tests/completion_public_done_test.ts",
    enclosing:
      "E09 public done releases an extractor while an unrelated check waits for it",
    argument: "0.02",
    count: 1,
    classification: "condition-poll",
    reason:
      "The check polls the extractor-owned file; elapsed time alone cannot release it.",
  },
  {
    path: "tests/discern_commit_enrolment_test.ts",
    enclosing:
      "the attributed commit boundary quiesces backgrounded hook descendants",
    argument: "0.01",
    count: 2,
    classification: "condition-poll",
    reason:
      "Both loops poll explicit hook-start and post-return release files; the late writer cannot advance on elapsed time.",
  },
  {
    path: "tests/engine_accept_authority_test.ts",
    enclosing:
      "concurrent accept refuses without recovering the active transaction",
    argument: "0.01",
    count: 1,
    classification: "condition-poll",
    reason:
      "The shell polls the owner-created release marker while acceptance authority remains held.",
  },
  {
    path: "tests/engine_gate_ergonomics_test.ts",
    enclosing: "failFastConfig",
    argument: "0.01",
    count: 1,
    classification: "condition-poll",
    reason:
      "The failure waits for the sibling-owned startup marker before triggering cancellation.",
  },
  {
    path: "tests/engine_gate_slots_test.ts",
    enclosing: "writeMarkerJob",
    argument: "${sleepS}",
    count: 1,
    classification: "serialization-stimulus",
    reason:
      "A bounded job lifetime supplies a competing lock workload; queue readiness is established separately by held slots and begin events.",
  },
  {
    path: "tests/engine_gate_slots_test.ts",
    enclosing: "gate slots: cap=2 lets two test runs overlap",
    argument: "0.1",
    count: 1,
    classification: "condition-poll",
    reason:
      "Both jobs poll the shared release file after the parent observes both starts.",
  },
  {
    path: "tests/engine_gate_timeout_test.ts",
    enclosing:
      "timeout override: a job's own budget bounds only that job — siblings keep the run-level budget",
    argument: "2",
    count: 1,
    classification: "elapsed-behavior",
    reason:
      "The sibling deliberately outlives the one-second override while remaining inside its own thirty-second watchdog.",
  },
  {
    path: "tests/engine_gate_timeout_test.ts",
    enclosing: "timeout override: 0 disables the bound for that job alone",
    argument: "2",
    count: 1,
    classification: "elapsed-behavior",
    reason:
      "The job deliberately outlives the inherited one-second watchdog to exercise its zero override.",
  },
  {
    path: "tests/engine_queue_test.ts",
    enclosing:
      "queue serializes two wrapped commands at cap 1 and narrates only on stderr",
    argument: "0.4",
    count: 1,
    classification: "serialization-stimulus",
    reason:
      "The interval supplies competing work between start and end markers; both wrappers acknowledge queuing before the externally held slot is released.",
  },
  {
    path: "tests/engine_queue_test.ts",
    enclosing: "queue nesting takes one slot total at cap 1",
    argument: "0.05",
    count: 1,
    classification: "condition-poll",
    reason:
      "The wrapped child polls the explicit release path after nested queue readiness is observed.",
  },
  {
    path: "tests/engine_queue_test.ts",
    enclosing:
      "a queued gate shows capacity now and retains other operation activity as history",
    argument: "0.05",
    count: 1,
    classification: "condition-poll",
    reason:
      "The slot owner polls the release file; the parent first observes the queued gate output.",
  },
  {
    path: "tests/engine_worktree_probe_test.ts",
    enclosing:
      "probeWorktreeViability: a command-owned late writer cannot follow a successful teardown",
    argument: "0.01",
    count: 2,
    classification: "condition-poll",
    reason:
      "The child polls readiness and teardown release markers; the later absence assertion has its own registered observation window.",
  },
  {
    path: "tests/engine_worktree_probe_test.ts",
    enclosing:
      "probeWorktreeViability: a backgrounded Git hook is quiesced before teardown",
    argument: "0.01",
    count: 2,
    classification: "condition-poll",
    reason:
      "The hook polls startup and teardown release markers, independent of how long setup takes.",
  },
  {
    path: "tests/jobs_runner_test.ts",
    enclosing:
      "runParallel: observer sees starts up front and settlements in real completion order",
    argument: "0.01",
    count: 1,
    classification: "condition-poll",
    reason:
      "The slow job polls the observer-written fast-settled file to establish settlement order.",
  },
  {
    path: "tests/jobs_runner_test.ts",
    enclosing:
      "buffered capture feeds complete and partial text to a separate live observer",
    argument: "0.01",
    count: 1,
    classification: "condition-poll",
    reason:
      "The producer waits for the explicit release file before completing the partial output.",
  },
  {
    path: "tests/jobs_runner_test.ts",
    enclosing:
      "spawnJob quiesces background descendants before a clean result returns",
    argument: "0.01",
    count: 2,
    classification: "condition-poll",
    reason:
      "Both child loops observe startup or explicit post-return release files, with a separate registered negative observation window.",
  },
  {
    path: "tests/jobs_runner_test.ts",
    enclosing: "fail-fast escalates to SIGKILL when a sibling ignores SIGTERM",
    argument: "0.05",
    count: 1,
    classification: "condition-poll",
    reason:
      "The failure polls the stubborn sibling startup marker before cancellation is triggered.",
  },
  {
    path: "tests/owned_child_test.ts",
    enclosing:
      "a routed setup command quiesces background descendants before returning",
    argument: "0.01",
    count: 2,
    classification: "condition-poll",
    reason:
      "Both loops wait on startup or explicit release files; elapsed time cannot make the descendant advance.",
  },
] as const satisfies readonly ShellWaitBoundary[];
