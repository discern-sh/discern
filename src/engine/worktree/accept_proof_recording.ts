/** Post-CAS Proof-note recording shared by acceptance and its recovery path. */

import type { Logger } from "../../lib/log.ts";
import type { CheckpointDrop } from "../../shared/checkpoint_drops.ts";
import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { LandingConsent } from "../../shared/consent.ts";
import {
  BUILT_IN_STEP_LABELS,
  type Diagnostic,
  type StepResult,
} from "../../shared/result.ts";
import type {
  AcceptanceEvidenceData,
  AcceptProofNoteData,
  AuthorizedVarianceData,
  LandingConsentData,
  Proof,
  StandardLimitProposalData,
} from "../../shared/result_schemas.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import { cloneStandardLimitProposal } from "../gate/standard_proposal_state.ts";
import {
  gateRunContext,
  resolveGateRunPolicy,
  runJobGroups,
} from "../gate/execute.ts";
import { type JobGroup, serializeJobSteps } from "../gate/plan.ts";
import {
  proofNotesFetchSucceeded,
  reconcileProofNotesFetch,
  writeProofNote,
} from "../gate/proof_notes.ts";
import type { AcceptPlan } from "./plan.ts";

/** Copy consent scopes before exposing them through acceptance result data. */
export function cloneLandingConsent(
  consent: LandingConsent,
): LandingConsentData {
  return {
    source: consent.source,
    ...(consent.scopes === undefined ? {} : { scopes: [...consent.scopes] }),
  };
}

/** Prove the receiving checkout's local runtime state after the trunk moves. */
export async function runLandingSmoke(
  mainRepo: string,
  config: DiscernConfig,
  plan: AcceptPlan,
  log: Logger,
): Promise<{
  steps: StepResult[];
  diagnostics: Diagnostic[];
  hints: string[];
}> {
  if (plan.smokeSteps.length === 0) {
    return { steps: [], diagnostics: [], hints: [] };
  }
  const group: JobGroup = {
    stage: "test",
    mode: "parallel",
    heading: "Proving the landing checkout is ready...",
    display: "Smoke",
    jobs: plan.smokeSteps.map((job) => ({
      label: job.label,
      command: job.command,
      kind: "known",
      reportStage: "test",
      willRun: true,
      ...(job.timeout !== undefined ? { timeout: job.timeout } : {}),
    })),
  };
  log.info("Running the smoke job in the landing checkout...");
  const policy = resolveGateRunPolicy(config.gate.stream, {
    kind: "quiet-result",
  });
  const { runOpts, out, slots } = gateRunContext(mainRepo, config, policy);
  const { results, failedStage } = await runJobGroups(
    [group],
    runOpts,
    out,
    slots,
  );
  const serialized = await serializeJobSteps(mainRepo, [group], results);
  if (failedStage === null) {
    log.ok("Landing-checkout smoke passed.");
  } else {
    log.warn("Landing-checkout smoke failed — the landing is kept.");
  }
  return { ...serialized, hints: hintTexts(serialized.hints) };
}

/** Record one already-landed commit's Proof and optional fetch transport. */
export async function recordLandingProofNote(input: {
  readonly mainRepo: string;
  readonly commit: string;
  readonly mode: "local" | "fetch";
  readonly proof: Proof | undefined;
  readonly checkpointDrops: readonly CheckpointDrop[];
  readonly consent: LandingConsent;
  readonly variances: readonly AuthorizedVarianceData[];
  readonly standardProposals: readonly StandardLimitProposalData[];
  readonly log: Logger;
  readonly env: Pick<typeof Deno.env, "get">;
}): Promise<{
  readonly proofNote: AcceptProofNoteData;
  readonly steps: StepResult[];
  readonly hints: string[];
}> {
  const proofFetch = await reconcileProofNotesFetch(input.mainRepo, input.mode);
  const proofFetchOk = proofNotesFetchSucceeded(proofFetch);
  const fetchStep: StepResult = {
    step: {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.reconcileProofNoteFetch,
      disposition: "run",
      note: proofFetchOk
        ? `proof-note transport is ${proofFetch.status}`
        : proofFetch.errors.join("; "),
    },
    outcome: proofFetchOk ? "ok" : "failed",
    ...(proofFetchOk ? {} : {
      advisory: {
        kind: "proof-recording-unavailable" as const,
        evidence: proofFetch.errors.length === 0
          ? [`Proof-note fetch transport status: ${proofFetch.status}.`]
          : [...proofFetch.errors],
        next_action:
          "Repair the reported Git-notes fetch configuration; the landing itself does not need to be repeated.",
      },
    }),
  };
  if (!proofFetchOk) {
    input.log.warn(
      "Proof-note fetch transport could not converge — the landing is kept.",
    );
  }

  const proofForNote = input.proof === undefined ? undefined : {
    ...input.proof,
    ...(input.checkpointDrops.length === 0 ? {} : {
      checkpoint_drops: input.checkpointDrops.map((drop) => ({ ...drop })),
    }),
  };
  const acceptanceEvidence: AcceptanceEvidenceData = {
    consent: cloneLandingConsent(input.consent),
    variances: input.variances.map((variance) => ({ ...variance })),
    standard_proposals: input.standardProposals.map(cloneStandardLimitProposal),
  };
  const proofWrite = await writeProofNote(
    input.mainRepo,
    input.commit,
    proofForNote,
    input.env,
    acceptanceEvidence,
  );
  const proofWritten = proofWrite.status === "recorded" ||
    proofWrite.status === "already_present";
  const writeStep: StepResult = {
    step: {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.writeProofNote,
      disposition: "run",
      note: proofWrite.reason ?? `${proofWrite.ref} at ${proofWrite.commit}`,
    },
    outcome: proofWritten ? "ok" : "failed",
    ...(proofWritten ? {} : {
      advisory: {
        kind: "proof-recording-unavailable" as const,
        evidence: [
          proofWrite.reason ?? `Proof-note write status: ${proofWrite.status}.`,
        ],
        next_action:
          "Repair the reported Git-notes storage problem and use the documented Proof-note recovery without repeating the landing.",
      },
    }),
  };
  if (proofWritten) {
    input.log.ok(`Recorded the landing proof under ${proofWrite.ref}.`);
  } else {
    input.log.warn(
      `The landing proof note was not recorded — the landing is kept. ${
        proofWrite.reason ?? proofWrite.status
      }`,
    );
  }

  const publicationRemote = proofFetch.remotes.includes("origin")
    ? "origin"
    : proofFetch.remotes[0];
  const shouldOfferPublication = input.mode === "fetch" && proofFetchOk &&
    proofWritten && publicationRemote !== undefined;
  const publicationHints = shouldOfferPublication
    ? hintTexts([
      fire(HINTS["accept-publish-proof-note"], { remote: publicationRemote }),
    ])
    : hintTexts([]);
  return {
    proofNote: { fetch: proofFetch, write: proofWrite },
    steps: [fetchStep, writeStep],
    hints: publicationHints,
  };
}
