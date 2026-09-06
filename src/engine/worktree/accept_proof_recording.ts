import type { LandedAuthorityEvidence } from "../../shared/completion_proof.ts";
/** Post-CAS Proof-note recording shared by acceptance and its recovery path. */

import type { Logger } from "../../lib/log.ts";
import type { CheckpointDrop } from "../../shared/checkpoint_drops.ts";
import type { LandingConsent } from "../../shared/consent.ts";
import { BUILT_IN_STEP_LABELS, type StepResult } from "../../shared/result.ts";
import type {
  AcceptanceEvidenceData,
  AcceptProofNoteData,
  AuthorizedVarianceData,
  LandingConsentData,
  Proof,
  StandardLimitProposalData,
} from "../../shared/result_schemas.ts";
import { fireOwnerAttention, HINTS, hintTexts } from "../../shared/hints.ts";
import { cloneStandardLimitProposal } from "../gate/standard_proposal_state.ts";
import {
  proofNotesFetchSucceeded,
  reconcileProofNotesFetch,
  writeProofNote,
} from "../gate/proof_notes.ts";

/** Copy consent scopes before exposing them through acceptance result data. */
export function cloneLandingConsent(
  consent: LandingConsent,
): LandingConsentData {
  return {
    source: consent.source,
    ...(consent.scopes === undefined ? {} : { scopes: [...consent.scopes] }),
  };
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
  readonly authority?: LandedAuthorityEvidence;
  readonly writeNote?: typeof writeProofNote;
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
        ? `Proof note transport is ${proofFetch.status}`
        : proofFetch.errors.join("; "),
    },
    outcome: proofFetchOk ? "ok" : "failed",
    ...(proofFetchOk ? {} : {
      advisory: {
        kind: "proof-recording-unavailable" as const,
        evidence: proofFetch.errors.length === 0
          ? [`Proof note fetch transport status: ${proofFetch.status}.`]
          : [...proofFetch.errors],
        next_action:
          "Repair the reported Git-notes fetch configuration; the landing itself does not need to be repeated.",
      },
    }),
  };
  if (!proofFetchOk) {
    input.log.warn(
      "Proof note fetch transport could not converge — the landing is kept.",
    );
  }

  const proofForNote = input.proof === undefined ? undefined : {
    ...input.proof,
    ...(input.checkpointDrops.length === 0 ? {} : {
      checkpoint_drops: input.checkpointDrops.map((drop) => ({ ...drop })),
    }),
  };
  const acceptanceEvidence: AcceptanceEvidenceData = {
    ...(input.authority === undefined ? {} : { authority: input.authority }),
    consent: cloneLandingConsent(input.consent),
    variances: input.variances.map((variance) => ({ ...variance })),
    standard_proposals: input.standardProposals.map(cloneStandardLimitProposal),
  };
  const proofWrite = await (input.writeNote ?? writeProofNote)(
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
          proofWrite.reason ?? `Proof note write status: ${proofWrite.status}.`,
        ],
        next_action:
          "Repair the reported Git-notes storage problem and use the documented Proof note recovery without repeating the landing.",
      },
    }),
  };
  if (proofWritten) {
    input.log.ok(`Recorded the landing Proof under ${proofWrite.ref}.`);
  } else {
    input.log.warn(
      `The landing Proof note was not recorded — the landing is kept. ${
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
      fireOwnerAttention(HINTS["accept-publish-proof-note"], {
        remote: publicationRemote,
      }),
    ])
    : hintTexts([]);
  return {
    proofNote: { fetch: proofFetch, write: proofWrite },
    steps: [fetchStep, writeStep],
    hints: publicationHints,
  };
}
