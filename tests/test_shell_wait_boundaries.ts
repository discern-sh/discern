/**
 * Reviewed shell polling and elapsed-time contracts; every site is bound by
 * syntax. A hold on a signal file is rendered by `shellAwaitFile`, so its one
 * condition poll is enrolled there rather than at each test that holds.
 */
import type { ShellWaitBoundary } from "./test_shell_wait_guard.ts";

export const TEST_SHELL_WAIT_BOUNDARIES = [
  {
    path: "tests/shell_hold.ts",
    enclosing: "shellAwaitFile",
    argument: "0.05",
    count: 1,
    classification: "condition-poll",
    reason:
      "Every file hold paces one existence check of its owner-written signal file; the same poll ends the hold once that file's directory or its owning process is gone.",
  },
  {
    path: "tests/engine_desk_operation_test.ts",
    enclosing:
      "paused production Desk script exposes its actual lease, cancels durably, and releases the next action",
    argument: "60",
    count: 1,
    classification: "serialization-stimulus",
    reason:
      "The owned script stays alive while its lease and competing writers are observed, then cancellation ends it; the test ends it by cancellation instead of elapsed time.",
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
      "Both jobs poll the shared marker log until both starts appear. It is a content handshake, not a file hold: its attempt bound fails a wrongly serializing cap, and a removed log ends it.",
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
    path: "tests/engine_desk_isolation_tty_test.ts",
    enclosing: "<module>",
    argument: "1",
    count: 1,
    classification: "serialization-stimulus",
    reason:
      "The foreground Project Script stays alive until Ctrl-C stops it; the test ends it by interrupt, never by elapsed time.",
  },
] as const satisfies readonly ShellWaitBoundary[];
