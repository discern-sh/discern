/** Reviewed host-duration observations; timer budgets belong to their owning layer. */
export interface TestElapsedBoundary {
  readonly path: string;
  readonly enclosing: string;
  readonly reads: number;
  readonly reason: string;
}

/** New measurements require both mechanical enrollment and review of their interval. */
export const TEST_ELAPSED_BOUNDARIES: readonly TestElapsedBoundary[] = [
  {
    path: "tests/engine_gate_timeout_test.ts",
    enclosing: "settleJobAfterReadiness",
    reads: 2,
    reason:
      "Only a direct StageRunResult is measured, after producer readiness; CLI preparation and environment return cannot enter this helper.",
  },
  {
    path: "tests/jobs_runner_test.ts",
    enclosing: "runParallel: fail-fast cancels the slow sibling promptly",
    reads: 2,
    reason:
      "The observer starts the interval at sibling failure; settlement checks the runner's cancellation and pipe-drain lifetime.",
  },
  {
    path: "tests/jobs_runner_test.ts",
    enclosing: "fail-fast escalates to SIGKILL when a sibling ignores SIGTERM",
    reads: 2,
    reason:
      "A ready stubborn child exercises the runner's SIGKILL escalation after the failing sibling settles.",
  },
  {
    path: "tests/jobs_runner_test.ts",
    enclosing:
      "runParallel: an external abort tree-kills every in-flight job promptly",
    reads: 2,
    reason:
      "The ready process tree is measured from external abort through runner settlement.",
  },
  {
    path: "tests/jobs_runner_test.ts",
    enclosing:
      "runParallel: an external abort stays bounded when an escaped descendant holds the pipes",
    reads: 2,
    reason:
      "The escaped pipe holder is ready before abort; the direct runner must release its pipe reads before that holder exits.",
  },
  {
    path: "tests/engine_interrupt_surfaces_test.ts",
    enclosing:
      "the interrupt harness reports an early surface exit without spending its readiness allowance",
    reads: 2,
    reason:
      "Already settled fake process status must fail the readiness helper promptly; no native process startup or environment return occurs.",
  },
  {
    path: "tests/engine_await_test.ts",
    enclosing: "a SIGINT ends the wait promptly, leaving nothing behind",
    reads: 2,
    reason:
      "The clock starts after readiness and SIGINT; the observed interval is the interrupted wait process's own exit.",
  },
  {
    path: "tests/patterns_test.ts",
    enclosing:
      "patterns registry: every detector stays bounded on a large history",
    reads: 4,
    reason:
      "This is an intentional algorithm benchmark over a fixed event corpus, not a producer watchdog or workflow deadline.",
  },
];
