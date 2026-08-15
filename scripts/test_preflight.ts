/** Prove the repository test suite's loopback prerequisite before it starts. */

const LOOPBACK_HOST = "127.0.0.1";

/** The smallest listener surface needed to prove bind and cleanup capability. */
export interface TestListener {
  close(): void;
}

/** Injectable boundary for the real loopback bind and adversarial test fixtures. */
export type OpenTestListener = () => TestListener;

/** A loopback listener could not be opened or closed. */
export interface TestPreflightFailure {
  ok: false;
  reason: string;
}

/** The test runtime can exercise the listener lifecycle its suite requires. */
export interface TestPreflightSuccess {
  ok: true;
}

export type TestPreflightResult = TestPreflightFailure | TestPreflightSuccess;

/** Preserve the original runtime denial instead of assuming one sandbox vendor. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Open the same temporary loopback listener class used by the test suite. */
function openLoopbackListener(): TestListener {
  return Deno.listen({ hostname: LOOPBACK_HOST, port: 0 });
}

/** Exercise the suite's real listener lifecycle and return a structured verdict. */
export function preflightTestRuntime(
  open: OpenTestListener = openLoopbackListener,
): TestPreflightResult {
  try {
    const listener = open();
    listener.close();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: errorText(error) };
  }
}

/** Explain the blocked capability and the one action that can unblock the run. */
export function testPreflightFailureMessage(
  failure: TestPreflightFailure,
): string {
  return `The discern test suite cannot bind a temporary ${LOOPBACK_HOST} listener: ${failure.reason}. Grant this test command permission to bind loopback network listeners, then retry. No tests were started.`;
}

if (import.meta.main) {
  const result = preflightTestRuntime();
  if (!result.ok) {
    console.error(testPreflightFailureMessage(result));
    Deno.exit(1);
  }
}
