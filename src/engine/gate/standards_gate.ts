/** Config-only standard rows for read-only gate and doctor previews. */
import type { PlannedJob } from "./plan.ts";
import { type PlannedStandard, standardJobLabel } from "./standard_plan.ts";

/** Execution and reuse are decided by the validation planner, never this display projection. */
export function planStandardJobsFromConfig(
  standards: PlannedStandard[],
): PlannedJob[] {
  return standards.map((standard) => ({
    label: standardJobLabel(standard.name),
    command: standard.command,
    kind: "standard",
    reportStage: "test",
    willRun: true,
    ...(standard.spec.producer === undefined ? {} : {
      note:
        `Consumes producer ${standard.spec.producer}; dependencies and valid receipts determine execution.`,
    }),
    ...(standard.timeout === undefined ? {} : { timeout: standard.timeout }),
  }));
}
