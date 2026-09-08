/** Reusing valid Proof still settles the owning checkout's requested lifetime. */
import type { CompletionProofPointer } from "../../shared/completion_proof.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { loadConfig } from "../../shared/config_schema.ts";
import { readCompletionRecord } from "../completion/store.ts";
import { createNativeExecutionLifetime } from "../execution/lifetime.ts";
import {
  ownValidationEnvironment,
  validationWorkspace,
} from "../execution/public_environment.ts";
import {
  releaseExecutionEnvironment,
  replaceEnvironment,
  requireEnvironment,
} from "../execution/registry.ts";
import { enrolledDeclaration } from "../execution/subjects.ts";
import { acceptancePending } from "../landing_queue/public_result.ts";
import { observeSource } from "../landing_queue/composition.ts";
import { sameSource } from "../landing_queue/model.ts";
import { observedRecords } from "../landing_queue/repository.ts";
import {
  OperationLockError,
  withCompletionCheckout,
  withCompletionPublication,
} from "../operation_lock.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type {
  GateData,
  StandardLimitProposalData,
} from "../../shared/result_schemas.ts";
import { gateProofHasCompleteEvidence, inspectGateProof } from "./proof.ts";
import { isIndeterminateStopDrop } from "../../shared/checkpoint_drops.ts";
import { inspectResolvedTrunkMerged } from "../worktree/git.ts";
import { sameStandardLimitProposalSet } from "./standard_proposal_state.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { loadIdentitySettings, resolveIdentity } from "../worktree/identity.ts";

/** Caller holds checkout exclusion across Proof inspection and this transition. */
export async function settleReviewedCheckout(
  root: string,
  proof: CompletionProofPointer,
  retain: boolean,
  dryRun = false,
  signal?: AbortSignal,
): Promise<void> {
  root = await Deno.realPath(root);
  const candidate = await readCompletionRecord(root, {
    kind: "candidate",
    id: proof.candidate_id,
  });
  if (candidate.kind !== "recorded" || candidate.record.kind !== "candidate") {
    throw new Error(
      "The proven candidate is unavailable; preserve the checkout and inspect completion recovery.",
    );
  }
  const identity = await resolveIdentity(root, root);
  const source = await observeSource(
    root,
    identity.id,
    candidate.record.data.source.branch,
  );
  if (!sameSource(source, candidate.record.data.source)) {
    throw new Error(
      "The checkout no longer matches the proven source; run done on the intended committed source.",
    );
  }
  const environment = observedRecords(await observeCompletionRecords(root))
    .find((record) =>
      record.kind === "environment" && record.data.path === root &&
      record.data.state.kind !== "disposed"
    );
  if (
    environment?.kind !== "environment" ||
    environment.data.state.kind !== "idle" ||
    environment.data.ownership.kind !== "borrowed" ||
    !sameSource(environment.data.ownership.source, source)
  ) {
    throw new Error(
      "The source environment is unavailable or still in use; finish its operation or reported recovery before changing checkout ownership.",
    );
  }
  const config = await loadConfig(root);
  const declaration = await enrolledDeclaration(
    environment.data,
    Object.values(config.execution),
  );
  const current = await requireEnvironment(root, environment.id);
  const lifetime = createNativeExecutionLifetime(root);
  const workspace = validationWorkspace(
    root,
    config,
    environment.id,
    await loadIdentitySettings(root),
  );
  const actor = {
    operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
    originating_effort: identity.id,
    started_at: SYSTEM_CLOCK.wallNow(),
  };
  if (!retain) {
    if (dryRun) {
      const use = await lifetime.inspect(root);
      if (!use.quiescent) throw new Error(use.reason);
      return;
    }
    const configured = config.execution.local;
    const releaseDeclaration = declaration ??
      (configured?.kind === "borrowed" ? configured : null);
    const release = releaseDeclaration === declaration
      ? { environmentId: environment.id, lifetime, workspace }
      : await ownValidationEnvironment(
        root,
        config,
        source,
        actor,
        releaseDeclaration,
        signal,
      );
    if ("kind" in release) throw new Error(acceptancePending(release).reason);
    const released = release.environmentId === environment.id
      ? current
      : await requireEnvironment(root, release.environmentId);
    await releaseExecutionEnvironment(
      root,
      release.environmentId,
      released.stamp,
      actor,
      releaseDeclaration,
      release,
      { retirement: true, ...(signal === undefined ? {} : { signal }) },
    );
    return;
  }
  const use = await lifetime.inspect(root);
  if (!use.quiescent) throw new Error(use.reason);
  if (current.record.data.release.kind === "held") return;
  const snapshot = await workspace.inspect(
    current.record.data,
    declaration,
    undefined,
    signal,
  );
  await workspace.verify(current.record.data, snapshot, signal);
  await withCompletionPublication(
    root,
    () =>
      replaceEnvironment(root, current, {
        ...current.record.data,
        release: { kind: "held" },
      }, SYSTEM_CLOCK),
  );
}

/** Inspect reusable evidence and settle its lifetime under one checkout exclusion. */
export async function reuseReviewedProof(
  root: string,
  inspect: (root: string) => Promise<DiscernResult<GateData> | undefined>,
  ownership: { retain: boolean; signal?: AbortSignal },
): Promise<DiscernResult<GateData> | undefined> {
  try {
    return await withCompletionCheckout(root, async (signal) => {
      const reused = await inspect(root);
      if (reused === undefined) return undefined;
      const pointer = reused.data?.proof?.completion;
      if (pointer === undefined) return undefined;
      await settleReviewedCheckout(
        root,
        pointer,
        ownership.retain,
        false,
        signal,
      );
      return {
        ...reused,
        message: `${reused.message} Checkout ${
          ownership.retain
            ? "retained for review or feedback edits in this effort"
            : "released for validation and eligible cleanup"
        }.`,
      };
    }, ownership.signal);
  } catch (error) {
    return {
      ok: false,
      verb: "done",
      error: "precondition_failed",
      message: error instanceof OperationLockError
        ? error.message
        : `Checkout ownership could not change: ${
          error instanceof Error ? error.message : String(error)
        }`,
      hints: hintTexts([fire(HINTS["completion-pending"], {
        action:
          "Stop preview or watch processes using this checkout and resolve any reported recovery, then retry done. Use done --retain-checkout before feedback edits in the same effort.",
      })]),
      data: { gate_ran: false, failed_stage: null, scopes_changed: [] },
    };
  }
}

/**
 * Reuse the canonical Proof only when it completely proves this exact clean
 * HEAD. This check runs before checkpoint reconciliation, so the optimization
 * cannot mutate conclusions, run fixers, measure Standards, or invoke a
 * configured job. An incomplete marker is a cache miss, never success.
 */
export async function reusableGreenProof(
  root: string,
  proposalStateFor: (root: string) => Promise<
    {
      readonly trunk: string;
      readonly proposals: StandardLimitProposalData[];
    } | undefined
  >,
): Promise<DiscernResult<GateData> | undefined> {
  const proof = await inspectGateProof(root);
  if (
    !gateProofHasCompleteEvidence(proof) ||
    proof.checkpoint_drops?.some((drop) =>
        drop.reason === "declaration_evidence_unavailable" ||
        drop.reason === "strand_check_unavailable" ||
        isIndeterminateStopDrop(drop)
      ) === true
  ) {
    return undefined;
  }
  const proposalState = await proposalStateFor(root);
  if (proposalState === undefined) return undefined;
  const merged = await inspectResolvedTrunkMerged(root, proposalState.trunk);
  if (
    merged.kind === "behind" || merged.kind === "missing" ||
    merged.kind === "unavailable"
  ) {
    return undefined;
  }
  if (
    !sameStandardLimitProposalSet(
      proof.proof_data.standard_proposals ?? [],
      proposalState.proposals,
    )
  ) {
    return undefined;
  }
  return {
    ok: true,
    verb: "done",
    message: "Current green Proof covers this exact tree; no gate job ran.",
    data: {
      gate_ran: false,
      failed_stage: null,
      scopes_changed: [],
      proof: proof.proof_data,
    },
  };
}
