/** Measure the closed set of genuine wall-clock delays in executable tests. */

import { REPO_ROOT } from "../tests/repo_authored_paths.ts";
import {
  waitingFindings,
  waitingSources,
} from "../tests/test_waiting_guard.ts";
import { TEST_REAL_DELAY_BOUNDARIES } from "../tests/waiting.ts";
import type { TestRealDelayClassification } from "../tests/waiting.ts";

/** Summarize the semantic audit recorded on the canonical boundary rows. */
export function realDelayClassificationCounts(): Record<
  TestRealDelayClassification,
  number
> {
  const counts: Record<TestRealDelayClassification, number> = {
    "elapsed-behavior": 0,
    "negative-observation-window": 0,
    "adversarial-stimulus": 0,
  };
  for (const boundary of Object.values(TEST_REAL_DELAY_BOUNDARIES)) {
    counts[boundary.classification]++;
  }
  return counts;
}

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
  const classifications = realDelayClassificationCounts();
  console.error(
    "test real-delay classifications: " +
      Object.entries(classifications).map(([name, members]) =>
        `${name}=${members}`
      ).join(", "),
  );
  console.log(`DISCERN_METRIC test_real_delay_boundaries ${count}`);
}
