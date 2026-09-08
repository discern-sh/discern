/** Owner release changes checkout lifetime without selecting or validating queue work. */
import type { DiscernResult } from "../../shared/result.ts";
import type { GateData } from "../../shared/result_schemas.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import { recoveryArgumentConflict } from "../execution/public_recovery.ts";
import { withCompletionCheckout } from "../operation_lock.ts";
import { gateProofHasCompleteEvidence, inspectGateProof } from "./proof.ts";
import { settleReviewedCheckout } from "./review_release.ts";

/** Both transports reject mixed actions before inspecting or changing ownership. */
export async function releaseCheckoutRequestResult(
  root: string,
  options: Parameters<typeof recoveryArgumentConflict>[0] & {
    releaseCheckout?: boolean;
    recover?: string;
    dryRun?: boolean;
    signal?: AbortSignal;
  },
): Promise<DiscernResult<GateData> | undefined> {
  if (options.releaseCheckout !== true) return undefined;
  const { releaseCheckout: _release, ...other } = options;
  if (options.recover !== undefined || recoveryArgumentConflict(other)) {
    return {
      ok: false,
      verb: "done",
      error: "invalid_arguments",
      message:
        "Checkout release cannot be combined with recovery, retention, validation, policy, or judgment options. Run done --release-checkout separately.",
    };
  }
  const data: GateData = {
    gate_ran: false,
    failed_stage: null,
    scopes_changed: [],
  };
  try {
    return await withCompletionCheckout(root, async (signal) => {
      const proof = await inspectGateProof(root);
      const pointer = proof.proof_data?.completion;
      if (!gateProofHasCompleteEvidence(proof) || pointer === undefined) {
        throw new Error(
          "Release requires complete green Proof for this exact clean source. Preserve feedback edits and run discern done on their intended committed source first.",
        );
      }
      await settleReviewedCheckout(
        root,
        pointer,
        false,
        options.dryRun,
        signal,
      );
      return {
        ok: true,
        verb: "done",
        ...(options.dryRun ? { dry_run: true } : {}),
        message: options.dryRun
          ? "The source owner can release this checkout for validation and eligible cleanup. No ownership changed."
          : "Checkout released for validation and eligible cleanup. No producer, gate, or landing ran; existing evidence remains unchanged.",
        data,
        hints: hintTexts([
          fire(HINTS["completion-pending"], {
            action:
              "Run discern accept from the main checkout to continue authorized acceptance or eligible cleanup. Landing still requires authority for each source.",
          }),
        ]),
      };
    }, options.signal);
  } catch (error) {
    return {
      ok: false,
      verb: "done",
      error: "precondition_failed",
      data,
      message: `Checkout release could not finish: ${
        error instanceof Error ? error.message : String(error)
      }`,
      hints: hintTexts([
        fire(HINTS["completion-pending"], {
          action:
            "Stop preview or watch processes using this checkout and resolve its reported recovery, then retry discern done --release-checkout from the same effort.",
        }),
      ]),
    };
  }
}
