/** Emergency landings whose skipped checks are still outstanding, with their next action. */
import type { StatusData } from "../../shared/result_schemas.ts";
import { displayBranch } from "../../shared/result_markdown_values.ts";
import { fire, type FiredHint, HINTS } from "../../shared/hints.ts";
import { emergencyValidationStatus } from "../emergency/obligations.ts";

/** Pair outstanding emergency validation with its registered next action. */
export async function completionRecoveryStatus(
  root: string,
): Promise<{
  data: Pick<StatusData, "emergency_validation">;
  hints: FiredHint[];
}> {
  const emergency = await emergencyValidationStatus(root);
  return {
    data: emergency.length ? { emergency_validation: emergency } : {},
    hints: emergency.filter((row) => row.state === "outstanding").map((row) =>
      fire(HINTS["emergency-outstanding"], { commit: row.head.slice(0, 12) })
    ),
  };
}

/** A run this checkout started and has not finished leads every other direction. */
export function completionStatusPresentation(
  recovery: Awaited<ReturnType<typeof completionRecoveryStatus>>,
  ordinaryHints: readonly FiredHint[],
  running?: StatusData["operation"],
): { hints: FiredHint[]; message?: string } {
  const hints = [...ordinaryHints];
  if (running !== undefined) {
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
  }
  hints.push(...recovery.hints);
  // A run this checkout started and has not finished is the first thing a
  // resumed session needs to hear: it must not be told to start another.
  const message = running === undefined
    ? undefined
    : `${
      running.latest ?? `\`${running.verb}\` on ${
        running.branch === undefined
          ? "this checkout"
          : displayBranch(running.branch)
      } has not finished; no current activity was recorded.`
    } Read it back with discern progress ${running.handle}; it needs no new command while it runs.`;
  return { hints, ...(message === undefined ? {} : { message }) };
}
