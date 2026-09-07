/** Completion recovery projects its durable obligations and matching next actions together. */
import type { StatusData } from "../../shared/result_schemas.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { emergencyValidationStatus } from "../emergency/obligations.ts";
import { executionRecoveryStatus } from "../execution/public_recovery.ts";

/** Pair outstanding validation and checkout recovery with their registered next actions. */
export async function completionRecoveryStatus(root: string): Promise<{
  data: Pick<StatusData, "emergency_validation" | "execution_recovery">;
  hints: FiredHint[];
}> {
  const [emergency, execution] = await Promise.all([
    emergencyValidationStatus(root),
    executionRecoveryStatus(root),
  ]);
  return {
    data: {
      ...(emergency.length ? { emergency_validation: emergency } : {}),
      ...(execution.length ? { execution_recovery: execution } : {}),
    },
    hints: [
      ...execution.map((row) =>
        fire(HINTS["execution-recovery"], { id: row.environment_id })
      ),
      ...emergency.filter((row) => row.state === "outstanding").map((row) =>
        fire(HINTS["emergency-outstanding"], { id: row.landing_id })
      ),
    ],
  };
}
