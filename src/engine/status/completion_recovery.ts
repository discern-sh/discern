/** Completion recovery projects its durable obligations and matching next actions together. */
import type { StatusData } from "../../shared/result_schemas.ts";
import { displayBranch } from "../../shared/result_markdown_values.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { emergencyValidationStatus } from "../emergency/obligations.ts";
import { executionStatus } from "../execution/public_recovery.ts";

/** Pair outstanding validation and checkout recovery with their registered next actions. */
export async function completionRecoveryStatus(root: string): Promise<{
  data: Pick<
    StatusData,
    "emergency_validation" | "execution_recovery" | "execution_activity"
  >;
  hints: FiredHint[];
}> {
  const [emergency, execution] = await Promise.all([
    emergencyValidationStatus(root),
    executionStatus(root),
  ]);
  return {
    data: {
      ...(emergency.length ? { emergency_validation: emergency } : {}),
      ...execution,
    },
    hints: [
      ...(execution.execution_recovery ?? []).map((row) =>
        fire(HINTS["execution-recovery"], { id: row.environment_id })
      ),
      ...emergency.filter((row) => row.state === "outstanding").map((row) =>
        fire(HINTS["emergency-outstanding"], { commit: row.head.slice(0, 12) })
      ),
    ],
  };
}

/** Active execution and recovery supersede ordinary authoring and landing directions. */
export function completionStatusPresentation(
  recovery: Awaited<ReturnType<typeof completionRecoveryStatus>>,
  ordinaryHints: readonly FiredHint[],
  landingMessage?: string,
  running?: StatusData["operation"],
): { hints: FiredHint[]; message?: string } {
  const recovering = (recovery.data.execution_recovery?.length ?? 0) > 0;
  const active = recovery.data.execution_activity?.[0];
  const hints = [...ordinaryHints];
  if (recovering || active !== undefined || running !== undefined) {
    const nextSteps = new Set(
      Object.values(HINTS).filter((definition) =>
        definition.category === "next-step"
      ).map((definition) => definition.id as string),
    );
    hints.splice(
      0,
      hints.length,
      ...hints.filter((hint) => !nextSteps.has(hint.id)),
    );
    if (!recovering && active !== undefined) {
      hints.push(fire(HINTS["completion-pending"], {
        action: active.next_action ??
          "Observe the owning command. If it ended, use the environment's supported recovery action; a recorded deadline does not prove activity.",
      }));
    }
  }
  hints.push(...recovery.hints);
  // A run this checkout started and has not finished is the first thing a
  // resumed session needs to hear: it must not be told to start another.
  const runningMessage = running === undefined
    ? undefined
    : `\`${running.verb}\` on ${
      running.branch === undefined
        ? "this checkout"
        : displayBranch(running.branch)
    } is still running${
      running.latest === undefined ? "." : `: ${running.latest}`
    } Read it back with discern progress ${running.handle}; it needs no new command while it runs.`;
  const message = recovering
    ? "Checkout return requires recovery before update, validation, release, or further authoring. Preserve the recorded paths and follow the environment's recovery action."
    : active !== undefined
    ? `Environment ${active.environment_id} records attempt ${active.attempt_id} in phase ${active.phase}. ${
      active.reason ?? "Current executor activity is unverified."
    }`
    : runningMessage ?? landingMessage;
  return { hints, ...(message === undefined ? {} : { message }) };
}
