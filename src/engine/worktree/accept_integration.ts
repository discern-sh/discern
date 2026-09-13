/**
 * The integration landing executor: land a submission the trunk overtook by
 * composing it with the trunk in a disposable integration worktree, proving
 * the combined tree, and advancing the trunk to that exact proven commit
 * under the existing acceptance transaction. `accept.ts` decides when this
 * route runs; this module owns its execution and its sentences, and never
 * imports `accept.ts` at runtime.
 */

import { uniqueCheckpointDrops } from "../../shared/checkpoint_drops.ts";
import { commandEvidence } from "../../shared/command_evidence.ts";
import {
  AWAITING_CONSENT_SLUG,
  type LandingConsent,
} from "../../shared/consent.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import {
  BUILT_IN_STEP_LABELS,
  type DiscernResult,
} from "../../shared/result.ts";
import type { AcceptData } from "../../shared/result_schemas.ts";
import { emitCompletionProgress } from "../completion/events.ts";
import { renderLandingProofLine } from "../gate/proof_render.ts";
import { convergeMainCheckout } from "./accept_convergence.ts";
import {
  assertMainCheckoutReady,
  type CleanupDisposition,
  cleanUpEffort,
  cleanupKeepsCheckout,
} from "./accept_cleanup.ts";
import { recordLandingProofNote } from "./accept_proof_recording.ts";
import {
  ACCEPT_NOTHING_LANDED,
  acceptAwaitingConsentMessage,
  availableLandingConsent,
  landingAuthorityDetail,
  refusal,
  short,
  trunkTip,
} from "./accept_support.ts";
import {
  clearCompletedAcceptanceJournal,
  performAcceptanceTransition,
} from "./acceptance_transaction.ts";
import { clearEffortGrant } from "./effort_grant_cleanup.ts";
import { WorktreeGitError, WorktreeResultError } from "./git.ts";
import { deriveIdentity } from "./identity.ts";
import { inspectLandingAuthority } from "./landing_authority.ts";
import { runIntegrationAttempt } from "./integration_landing.ts";
import { removeIntegrationWorktree } from "./lifecycle.ts";
import { classifyAutomaticBranchOwnership } from "./ownership.ts";
import { clearSubmissionIfCurrent } from "./submission_writer.ts";
import type {
  AcceptExecutionProgress,
  AcceptRequest,
  EffortCheckout,
  LandingDecision,
  LandingSubject,
} from "./accept.ts";
import type { AcceptPlan } from "./plan.ts";

/** The first paragraph of an integrated landing: what landed, as what, and
 * what happened to the author's checkout. */
function landedIntegratedMessage(
  effort: EffortCheckout,
  submittedHead: string,
  landed: string,
  disposition: CleanupDisposition,
): string {
  const lead = `Landed ${effort.branch}'s submission ${
    short(submittedHead)
  }, composed with ${effort.trunk} and proven as ${
    short(landed)
  }, on ${effort.trunk}`;
  switch (disposition.kind) {
    case "removed":
      return `${lead}; its checkout, branch, and resources are gone.`;
    case "resources-remain":
      return `${lead}, but resource teardown failed for ${
        disposition.failed.join(", ")
      }: run discern worktree prune from ${effort.mainRepo} after fixing the failed destroy command. Its checkout and branch are gone.`;
    case "later-commits":
      return `${lead}; the branch holds later commits, so its checkout and branch stay. Run discern done, then discern accept from ${effort.path} for them.`;
    case "uncommitted-changes":
      return `${lead}; the checkout has uncommitted changes, so it and its branch stay. Commit them, then run discern done, then discern accept from ${effort.path}.`;
  }
}

/** Append integration-cleanup failures as an ordinary failed step so the
 * result's completion policy and prune guidance both see them. */
function recordIntegrationCleanup(
  progress: AcceptExecutionProgress,
  mainRepo: string,
  failures: readonly string[],
): void {
  progress.steps.push({
    step: {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.removeWorktree,
      disposition: "run",
      note: failures.length === 0
        ? "removed the integration worktree, its resources, and its branch"
        : `integration cleanup incomplete: ${failures.join("; ")}`,
    },
    outcome: failures.length === 0 ? "ok" : "failed",
    ...(failures.length === 0 ? {} : {
      advisory: {
        kind: "acceptance-cleanup-incomplete" as const,
        evidence: [...failures],
        next_action:
          `Run \`discern worktree prune\` from ${mainRepo} after fixing the reported cause; the recorded integration state names what remains.`,
      },
    }),
  });
}

/** The author's route after a failed combined check or conflict. */
function integrationAuthorRoute(effort: EffortCheckout): string {
  return `Run discern update from ${effort.path}, resolve what it reports, commit, run discern done, then discern accept.`;
}

/**
 * Land a submission the trunk overtook: compose the frozen snapshot with the
 * trunk tip in a disposable integration worktree, prove the combined tree,
 * recheck authority, and advance the trunk to that exact proven commit under
 * the existing acceptance transaction. If the trunk moves during the checks,
 * one recomposition runs against the new tip; a second movement stops with
 * the explicit retry route. Conflicts and red checks clean up the copy and
 * return to the author; the author's checkout and any work it gained during
 * checking stay untouched and unlanded.
 */
export async function executeIntegrationLanding(
  effort: EffortCheckout,
  subject: LandingSubject,
  plan: AcceptPlan,
  decision: LandingDecision,
  progress: AcceptExecutionProgress,
  enteredTip: string,
  request: AcceptRequest,
  env: Pick<typeof Deno.env, "get">,
  operationHandle?: string,
): Promise<{
  readonly message: string;
  readonly proofLine?: string;
  readonly landedCommit: string;
  readonly integrated: boolean;
}> {
  const { mainRepo, trunk } = effort;
  const log = effort.ctx.log;
  const frozen = subject.submission;
  if (frozen === undefined) {
    throw new WorktreeGitError(
      `Only submitted work lands through an integration worktree, and ${effort.branch} has no recorded submission. Run discern accept from ${effort.path} to submit it, or land it directly once its Proof names the current trunk tip.`,
    );
  }
  const cliModel = request.cliModel;
  if (cliModel === undefined) {
    throw new WorktreeGitError(
      `The trunk moved after ${effort.branch}'s Proof, and this caller cannot run the combined check. Re-run discern accept from the command line or the MCP tools, or run discern update, discern done, then discern accept from ${effort.path}.`,
    );
  }
  const ownership = classifyAutomaticBranchOwnership({
    kind: "worktree",
    branch: effort.branch,
    id: effort.id,
    settings: effort.settings,
    source: "registered",
  });
  if (subject.atHead && !ownership.owned) {
    throw new WorktreeGitError(
      `discern can land branch '${effort.branch}', but it cannot automatically delete it because ${ownership.reason}. Rename it to '${
        deriveIdentity(effort.id, effort.settings).branch
      }' or land it outside discern; nothing was changed.`,
    );
  }
  await assertMainCheckoutReady(effort);

  let tip = enteredTip;
  for (let attempt = 1;; attempt++) {
    const composed = await runIntegrationAttempt({
      effort,
      submission: frozen,
      expectedTrunk: tip,
      log,
      cliModel,
      ...(operationHandle === undefined ? {} : { operationHandle }),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    const cleanupTail = (failures: readonly string[]): string =>
      failures.length === 0
        ? " The integration worktree was removed."
        : ` Integration cleanup did not finish (${
          failures.join("; ")
        }); run discern worktree prune from ${mainRepo}.`;
    if (composed.kind === "setup-failed") {
      throw new WorktreeGitError(
        `The integration worktree for ${effort.branch}'s submission could not be prepared: ${composed.reason}${
          cleanupTail(composed.cleanupFailures)
        } ${ACCEPT_NOTHING_LANDED}`,
      );
    }
    if (composed.kind === "conflict") {
      throw new WorktreeGitError(
        `Landing ${effort.branch}'s submission ${
          short(frozen.head)
        } conflicts with ${trunk} in: ${composed.files.join(", ")}. ${
          integrationAuthorRoute(effort)
        }${cleanupTail(composed.cleanupFailures)} ${ACCEPT_NOTHING_LANDED}`,
      );
    }
    if (composed.kind === "red") {
      const gate = composed.result;
      const failing = gate.data?.failed_stage ?? null;
      const reproduce = (gate.diagnostics ?? [])
        .map((diagnostic) => diagnostic.reproduce_cmd)
        .filter((cmd): cmd is string => cmd !== undefined && cmd !== "");
      const detail = gate.message ??
        (failing === null
          ? "the combined check did not complete"
          : `the ${failing} stage failed`);
      const refused: DiscernResult<AcceptData> = {
        ok: false,
        verb: "accept",
        error: "gate_failed",
        message: `The combined check for ${effort.branch}'s submission ${
          short(frozen.head)
        } with ${trunk} failed: ${detail}${
          reproduce.length > 0
            ? ` Reproduce with: ${[...new Set(reproduce)].join(" · ")}.`
            : ""
        } ${integrationAuthorRoute(effort)}${
          cleanupTail(composed.cleanupFailures)
        } ${ACCEPT_NOTHING_LANDED}`,
        ...(gate.diagnostics === undefined
          ? {}
          : { diagnostics: gate.diagnostics }),
      };
      throw new WorktreeResultError(
        refused.message ?? "The combined check failed.",
        refused,
      );
    }

    // Green. Recheck authority over the exact tree that lands before the
    // trunk moves; a grant revoked during the checks refuses here.
    // The classification covers the exact composed tree, so the
    // submission-behind-HEAD narrowing does not apply here.
    const authorityNow = await inspectLandingAuthority(effort.path, trunk, {
      includeScopeEvidence: true,
      classifyAt: composed.record.worktree.path,
    });
    const consent: LandingConsent | undefined =
      decision.consent.source === "conversation"
        ? decision.consent
        : availableLandingConsent(authorityNow, false);
    if (consent === undefined) {
      const failures = await removeIntegrationWorktree(
        mainRepo,
        composed.record,
        log,
      );
      refusal(
        AWAITING_CONSENT_SLUG,
        acceptAwaitingConsentMessage(authorityNow, true) +
          cleanupTail(failures),
        {
          hints: hintTexts([
            fire(HINTS["accept-awaiting-confirmation"]),
            fire(HINTS["accept-review-via-status"]),
          ]),
        },
      );
    }
    log.heading("Acceptance plan");
    log.detail(`Branch:        ${effort.branch}`);
    log.detail(`Submission:    ${short(frozen.head)} (frozen)`);
    log.detail(
      `Into trunk:    ${mainRepo} (advance ${trunk} to composed ${
        short(composed.head)
      })`,
    );
    log.detail(
      `Authority:     ${
        landingAuthorityDetail(
          authorityNow.kind === "authorized"
            ? authorityNow
            : decision.authority,
          consent.source === "conversation",
        )
      }`,
    );
    for (const warning of authorityNow.warnings) log.warn(warning);

    emitCompletionProgress({
      phase: "operation",
      state: "integration-land",
      candidate_id: null,
      reason: `Advancing ${trunk} to the proven combined commit ${
        short(composed.head)
      }.`,
    });
    const transition = await performAcceptanceTransition(effort.path, {
      mainRepo,
      trunk,
      worktreeBranch: effort.branch,
      expectedTrunk: tip,
      target: composed.head,
      effortClaim: consent.source === "effort-grant",
      ...(authorityNow.effortGrant === undefined
        ? {}
        : { grantId: authorityNow.effortGrant.id }),
      submissionId: frozen.id,
      proof: { ...composed.proofPointer },
      integration: {
        worktree_id: composed.record.worktree.id,
        worktree_branch: composed.record.worktree.branch,
        worktree_path: composed.record.worktree.path,
      },
      consent,
      variances: decision.variances,
      standardProposals: decision.standardProposals,
    });
    if (transition.kind === "authority-changed") {
      const detail = transition.claim.status === "invalid" ||
          transition.claim.status === "newer" ||
          transition.claim.status === "unavailable"
        ? `: ${transition.claim.reason}`
        : "";
      const failures = await removeIntegrationWorktree(
        mainRepo,
        composed.record,
        log,
      );
      throw new WorktreeGitError(
        `Landing authority changed at the trunk boundary: the effort grant could not be claimed${detail}.${
          cleanupTail(failures)
        } ${ACCEPT_NOTHING_LANDED} Re-authorize it from the desk, then re-run \`discern accept\`.`,
      );
    }
    const ff = transition.outcome;
    const settlement = transition.effortSettlement;
    const settlementWarning = settlement?.settled === false
      ? settlement.disposition === "consume"
        ? "discern could not remove the spent effort-grant claim. It cannot authorize another landing; worktree cleanup will reap it."
        : "discern could not restore the effort grant cleanly. Inspect the grant in the desk and re-authorize this worktree before retrying."
      : undefined;
    if (settlementWarning !== undefined) {
      log.warn(settlementWarning);
      progress.authorityWarnings.push(settlementWarning);
    }
    if (ff.kind === "moved") {
      const failures = await removeIntegrationWorktree(
        mainRepo,
        composed.record,
        log,
      );
      const newTip = await trunkTip(effort);
      if (attempt === 1 && newTip !== tip) {
        log.warn(
          `${trunk} moved again while the combined check ran; discarding the composition and recomposing once against ${
            short(newTip)
          }.`,
        );
        tip = newTip;
        continue;
      }
      throw new WorktreeGitError(
        `${trunk} moved again while this landing recomposed, so discern stopped after one bounded retry.${
          cleanupTail(failures)
        } ${ACCEPT_NOTHING_LANDED} Re-run \`discern accept\` to compose against the current trunk.`,
      );
    }
    if (ff.kind !== "updated") {
      const failures = await removeIntegrationWorktree(
        mainRepo,
        composed.record,
        log,
      );
      if (ff.kind === "dirty") {
        const statusCommand = commandEvidence([
          "git",
          "-C",
          mainRepo,
          "status",
          "--short",
        ]);
        throw new WorktreeGitError(
          `The main checkout at ${mainRepo} changed or could not be proved clean at the landing boundary, so discern refused before moving ${trunk}. Inspect it with \`${statusCommand}\`, preserve or clear the reported state, then re-run \`discern accept\`.${
            cleanupTail(failures)
          } Git said: ${ff.detail}`,
        );
      }
      if (ff.kind === "checkout-failed" && !ff.rolledBack) {
        progress.landing.trunk_landed = true;
        throw new WorktreeGitError(
          `discern atomically advanced ${trunk} to ${composed.head}, but Git could not converge the checked-out files and could not restore the old ref. Stop and inspect ${mainRepo} before doing more work. Git said: ${ff.detail}`,
        );
      }
      throw new WorktreeGitError(
        `The trunk transition was refused (${ff.kind}).${
          cleanupTail(failures)
        } ${ACCEPT_NOTHING_LANDED} Re-run \`discern accept\`. Git said: ${ff.detail}`,
      );
    }

    progress.landing.trunk_landed = true;
    log.ok(
      `${trunk} advanced to the proven combined commit ${
        short(composed.head)
      } at ${mainRepo}.`,
    );
    progress.steps.push({
      step: {
        kind: "git",
        label: BUILT_IN_STEP_LABELS.fastForwardTrunk,
        disposition: "run",
        note: `composed ${short(frozen.head)} with ${trunk} as ${
          short(composed.head)
        }`,
      },
      outcome: "ok",
    });
    const postTransitionStepStart = progress.steps.length;

    let proofLine = composed.proof.line;
    proofLine = renderLandingProofLine(proofLine, consent, {
      ...(decision.standardProposals.length > 0
        ? { proposals: decision.standardProposals }
        : {}),
      ...(decision.variances.length > 0 &&
          composed.proof.checkpoints !== undefined
        ? { checkpoints: composed.proof.checkpoints }
        : {}),
    });
    progress.proofLine = proofLine;
    progress.proofMarkdown = composed.proof.markdown;

    // The trunk now names the proven combined commit; everything below fails
    // open and never rolls the landing back.
    const recording = await recordLandingProofNote({
      mainRepo,
      commit: composed.head,
      mode: plan.proofNotes,
      proof: composed.proof,
      checkpointDrops: uniqueCheckpointDrops(
        composed.proof.checkpoint_drops ?? [],
      ),
      consent,
      variances: decision.variances,
      standardProposals: decision.standardProposals,
      log,
      env,
    });
    progress.proofNote = recording.proofNote;
    progress.steps.push(...recording.steps);
    progress.convergenceHints.push(...recording.hints);

    await convergeMainCheckout(effort, plan, progress, request.signal);

    await clearSubmissionIfCurrent(effort.path, frozen.id);
    try {
      await clearEffortGrant(effort.path);
    } catch (error) {
      log.warn(
        `Could not clear the consumed effort grant: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    // The author's normal cleanup rule, against the submitted revision: work
    // the branch gained during checking stays intact and unlanded.
    const disposition = await cleanUpEffort(
      effort,
      composed.head,
      progress,
      frozen.head,
    );
    emitCompletionProgress({
      phase: "operation",
      state: "integration-cleanup",
      candidate_id: null,
      reason:
        "Removing the integration worktree, its resources, and its branch.",
    });
    const integrationCleanup = await removeIntegrationWorktree(
      mainRepo,
      composed.record,
      log,
    );
    recordIntegrationCleanup(progress, mainRepo, integrationCleanup);
    if (
      cleanupKeepsCheckout(disposition) &&
      progress.steps
        .slice(postTransitionStepStart)
        .every((entry) => entry.outcome !== "failed") &&
      !(await clearCompletedAcceptanceJournal(effort.path, composed.head))
    ) {
      log.warn(
        "Could not retire the completed landing's recovery journal; the next accept will verify it before landing new work.",
      );
    }
    const message = landedIntegratedMessage(
      effort,
      frozen.head,
      composed.head,
      disposition,
    );
    log.heading("Acceptance complete.");
    log.line(`  ${message}`);
    return {
      message,
      proofLine,
      landedCommit: composed.head,
      integrated: true,
    };
  }
}
