/** Measure the closed set of genuine wall-clock delays in executable tests. */

import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import {
  waitingFindings,
  waitingSources,
} from "../tests/test_waiting_guard.ts";
import { TEST_REAL_DELAY_BOUNDARIES } from "../tests/waiting.ts";

/** Verify exact enrollment and return the deterministic registry population. */
export async function measureTestRealDelayBoundaries(
  root: string = REPO_ROOT,
): Promise<number> {
  const findings = waitingFindings(await waitingSources(root));
  if (findings.length > 0) {
    throw new Error(
      `test real-delay enrollment is invalid:\n${findings.join("\n")}`,
    );
  }
  return Object.keys(TEST_REAL_DELAY_BOUNDARIES).length;
}

if (import.meta.main) {
  const count = await measureTestRealDelayBoundaries();
  console.log(`DISCERN_METRIC test_real_delay_boundaries ${count}`);
}

