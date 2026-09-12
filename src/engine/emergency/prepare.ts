/** Checkpoint-only preparation retains exact judgment evidence before owner review. */
import type { DiscernResult } from "../../shared/result.ts";
import type { AcceptData } from "../../shared/result_schemas.ts";
import type { LifecycleContext } from "../worktree/lifecycle.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { withCompletionCheckout } from "../operation_lock.ts";
import { runCheckpointPreflight } from "../checkpoints/preflight.ts";
import { checkpointServingText } from "../checkpoints/serving_text.ts";
import {
  gateCheckpointsData,
  proofCheckpointsData,
} from "../gate/checkpoint_projection.ts";
import { recordCandidateReview } from "../gate/candidate_review.ts";
import { observeEmergencySubject } from "./plan.ts";
import { emergencyPreparationHandle } from "./review.ts";

/** Run only canonical checkpoint triggers; preparation never creates a landing or a validation claim. */
export async function prepareEmergency(
  ctx: LifecycleContext,
  options: {
    reason: string;
    met: readonly string[];
    dryRun: boolean;
    signal?: AbortSignal;
  },
): Promise<DiscernResult<AcceptData>> {
  if (options.dryRun) {
    const plan = await observeEmergencySubject(ctx, options.reason);
    return {
      ok: true,
      verb: "accept",
      dry_run: true,
      message:
        "Preparation will run checkpoint triggers, serve or record agent conclusions, and retain review evidence for this exact repair and trunk. No validation jobs or integration will run.",
      data: { root: plan.root },
    };
  }
  return await withCompletionCheckout(ctx.cwd, async () => {
    const before = await observeEmergencySubject(ctx, options.reason);
    const outcome = await runCheckpointPreflight(
      ctx.cwd,
      ctx.config,
      { met: options.met },
      undefined,
      options.signal,
      before.candidate.predecessor,
    );
    if (outcome.kind === "invalid") {
      return {
        ok: false,
        verb: "accept",
        error: "invalid_arguments",
        message: outcome.message,
      };
    }
    const after = await observeEmergencySubject(ctx, options.reason);
    if (JSON.stringify(before.candidate) !== JSON.stringify(after.candidate)) {
      throw new Error(
        "The repair or actual trunk changed during checkpoint preparation. Preserve the changes and prepare again.",
      );
    }
    const preflight = outcome.preflight;
    const checkpointData = gateCheckpointsData(preflight);
    const data: AcceptData = {
      root: after.root,
      ...(checkpointData === undefined
        ? {}
        : { checkpoint_preparation: checkpointData }),
    };
    if (preflight.outstanding.length > 0) {
      const questions = preflight.outstanding.map((question) => {
        const evidence = checkpointServingText(question);
        return [
          `${question.id}: ${question.question}`,
          `Changed: ${evidence.matched}`,
          ...evidence.related,
          ...evidence.notes,
        ].join("\n");
      }).join("\n\n");
      return {
        ok: false,
        verb: "accept",
        error: "awaiting_declaration",
        data,
        message:
          `${questions}\n\nAnswer only satisfied questions with accept emergency --prepare --reason <text> --met <id> (repeatable). An unmet question remains a stop for emergency integration. No validation or integration ran.`,
      };
    }
    if (preflight.drops.length > 0 || preflight.declaredUnmet.length > 0) {
      return {
        ok: false,
        verb: "accept",
        error: "precondition_failed",
        data,
        message:
          "Checkpoint evidence or an unmet question still blocks emergency integration. Resolve the recorded condition; preparation cannot grant a variance or weaken policy.",
      };
    }
    const artifact = await recordCandidateReview(
      ctx.cwd,
      after.candidate,
      {
        attempt_id: SYSTEM_SECURE_ENTROPY.uuid(),
        candidate_id: after.candidate_id,
      },
      "strict",
      proofCheckpointsData(preflight),
      [],
      "emergency-review",
    );
    const preparation = emergencyPreparationHandle(artifact);
    return {
      ok: true,
      verb: "accept",
      data: { ...data, emergency: { outcome: "prepared", preparation } },
      message:
        `Checkpoint preparation is complete. No validation jobs, passing Proof, or integration were produced. Run accept emergency --reason <text> --preparation ${preparation} for the exact owner-review plan. This receipt grants no landing authority.`,
    };
  }, options.signal);
}
