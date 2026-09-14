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
import {
  AWAITING_DECLARATION_SLUG,
  AWAITING_VARIANCE_SLUG,
} from "../../shared/declarations.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import {
  BUILT_IN_STEP_LABELS,
  type DiscernResult,
} from "../../shared/result.ts";
import type {
  AcceptData,
  AuthorizedVarianceData,
  ServedCheckpointData,
} from "../../shared/result_schemas.ts";
import { emitCompletionProgress } from "../completion/events.ts";
import { checkpointServingText } from "../checkpoints/serving_text.ts";
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
  resolveVarianceInterlock,
  serveUnmetConclusion,
  type StandingUnmetConclusion,
} from "./acceptance_checkpoints.ts";
import {
  clearCompletedAcceptanceJournal,
  performAcceptanceTransition,
} from "./acceptance_transaction.ts";
import { clearEffortGrant } from "./effort_grant_cleanup.ts";
import { withLandingCommonPhase } from "../operation_lock.ts";
import { WorktreeGitError, WorktreeResultError } from "./git.ts";
import { deriveIdentity } from "./identity.ts";
import { inspectLandingAuthority } from "./landing_authority.ts";
import {
  type IntegrationDeclarations,
  retainIntegrationForJudgment,
  runIntegrationAttempt,
} from "./integration_landing.ts";
import { retainedIntegrationJudgment } from "./integration_record.ts";
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

/** One served checkpoint question's text in the integration judgment
 * refusal: id, evidence, and the question — the same fragments the gate's
 * own serving uses, with wire-shaped related evidence mapped back. */
function serveIntegrationQuestion(served: ServedCheckpointData): string {
  const evidence = checkpointServingText({
    matched: served.matched,
    related: (served.related ?? []).map((relation) => ({
      kind: relation.kind,
      forPath: relation.for_path,
      path: relation.path,
    })),
    ...(served.question_file === undefined
      ? {}
      : { questionFile: served.question_file }),
    ...(served.teach === undefined ? {} : { teach: served.teach }),
    ...(served.reference === undefined ? {} : { reference: served.reference }),
  });
  return [
    `${served.id} — changed: ${evidence.matched}`,
    ...evidence.related,
    `  Question: ${served.question.trim()}`,
    ...(evidence.questionSource === undefined ? [] : [evidence.questionSource]),
    ...evidence.notes,
  ].join("\n");
}

/** Refuse with the served integration questions and their callable
 * continuation. The composition is already retained; this is a judgment
 * stop — distinguishable from an executed check that failed — and no lock
 * is held while the answer is awaited. */
function refuseAwaitingIntegrationJudgment(
  effort: EffortCheckout,
  submittedHead: string,
  composedHead: string | undefined,
  copyPath: string,
  receipt: string,
  served: readonly ServedCheckpointData[],
  checkpoints: AcceptData["checkpoint_preparation"],
): never {
  const ids = served.map((entry) => entry.id);
  const heading = `Landing ${effort.branch}'s submission ${
    short(submittedHead)
  }, composed with ${effort.trunk}${
    composedHead === undefined ? "" : ` as ${short(composedHead)}`
  }, fired ${served.length} checkpoint question${
    served.length === 1 ? "" : "s"
  } that need${
    served.length === 1 ? "s" : ""
  } your judgment about the combined result before its check can run:`;
  refusal(
    AWAITING_DECLARATION_SLUG,
    `${heading}\n\n${
      served.map(serveIntegrationQuestion).join("\n\n")
    }\n\nJudge each question against the combined result — readable at ` +
      `${copyPath} (discern's integration worktree: inspect it read-only, ` +
      "never adopt or edit it) — then continue this landing from your own " +
      `worktree: \`discern accept --met <id> --composition ${receipt}\` ` +
      "(--met repeatable) when a question is satisfied, or `discern accept " +
      `--unmet <id> --why "<rationale>" --composition ${receipt}\` (one ` +
      "unmet per invocation) when it is not; the owner then decides that " +
      "declared-unmet landing. The receipt binds your answer to this exact " +
      "composition — a replaced composition refuses it and serves its own " +
      "question. The composition is retained for your answer. No gate job " +
      "ran, your worktree needs no update or new Proof for this, and other " +
      `landings can proceed meanwhile. ${ACCEPT_NOTHING_LANDED}`,
    {
      hints: hintTexts([
        fire(HINTS["accept-integration-judgment"], { ids }),
      ]),
      data: {
        ...(checkpoints === undefined
          ? {}
          : { checkpoint_preparation: checkpoints }),
        integration_judgment: {
          composition: receipt,
          decision: "declaration",
          awaiting: ids,
        },
      },
    },
  );
}

/** Serve the owner's variance decision over the combined result's
 * declared-unmet conclusions; the proven composition stays retained. */
function refuseAwaitingIntegrationVariance(
  unmet: readonly StandingUnmetConclusion[],
  missing: readonly string[],
  confirmed: boolean,
  receipt: string,
  /** The confirmation arrived without the served receipt, so it cannot be
   * shown to cover THIS composition's decision moment. */
  unboundDecision = false,
): never {
  const ids = unmet.map((entry) => entry.id);
  const decision = unboundDecision
    ? "A variance decision binds to the composition it was served for: pass the served receipt (--composition) with the owner's acceptance, so the decision cannot drift onto a different composition. The current decision moment is served below."
    : confirmed
    ? `The landing decision must also cover every declared-unmet checkpoint of the combined result; missing: ${
      missing.join(", ")
    }.`
    : `Landing is the owner's decision, and ${
      unmet.length === 1
        ? "one declared-unmet conclusion about the combined result additionally requires"
        : `${unmet.length} declared-unmet conclusions about the combined result additionally require`
    } the owner to authorize a variance.`;
  const command = `discern accept --confirmed ${
    ids.map((id) => `--variance ${id}`).join(" ")
  } --composition ${receipt}`;
  refusal(
    AWAITING_VARIANCE_SLUG,
    `${decision}\n\n${
      unmet.map(serveUnmetConclusion).join("\n\n")
    }\n\nRelay each question and rationale to the owner. Once the owner ` +
      `accepts this landing AND each named variance in the current ` +
      `conversation, re-run \`${command}\` from your worktree — the proven ` +
      `composition is retained and continues without re-running its check, ` +
      `and the receipt binds the decision to it. ` +
      `Recorded standing and effort grants never authorize a variance. ${ACCEPT_NOTHING_LANDED}`,
    {
      hints: hintTexts([
        fire(HINTS["accept-authorize-variance"], { ids }),
        fire(HINTS["accept-review-via-status"]),
      ]),
      data: {
        integration_judgment: {
          composition: receipt,
          decision: "variance",
          awaiting: ids,
        },
      },
    },
  );
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
  /** The variances this landing actually carried — resolved against the
   * combined result's declarations, not the author's. */
  readonly variances: readonly AuthorizedVarianceData[];
}> {
  const { mainRepo, trunk } = effort;
  const log = effort.ctx.log;
  const frozen = subject.submission;
  if (frozen === undefined) {
    throw new WorktreeGitError(
      `Only submitted work lands through an integration worktree, and ${effort.branch} has no recorded submission. Run discern accept from ${effort.path} to submit it, or land it directly once its proven revision contains the current trunk tip.`,
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

  // Conclusions this call carries for a retained composition's served
  // questions. They bind to the composition the agent was served, so a
  // recomposition (bounded trunk-movement retry) never consumes them.
  const declarations: IntegrationDeclarations | undefined =
    request.met.length > 0 || request.unmet !== undefined
      ? {
        met: request.met,
        ...(request.unmet === undefined ? {} : { unmet: request.unmet }),
      }
      : undefined;
  // A receipt names a retained composition; before composing anything,
  // verify one is retained and it is the one named — a receipt for a
  // replaced or completed composition refuses read-only, and the current
  // state is re-served by a plain accept, never shortcut.
  if (request.composition !== undefined) {
    const retained = await retainedIntegrationJudgment(mainRepo, effort.path);
    if (retained === undefined) {
      refusal(
        "precondition_failed",
        `--composition names no retained composition for ${effort.branch} — it was answered, replaced, or reclaimed. Re-run discern accept without --composition to compose against the current trunk and be served any question about that exact result. ${ACCEPT_NOTHING_LANDED}`,
      );
    }
    if (retained.id !== request.composition) {
      refusal(
        "precondition_failed",
        `--composition names a composition that is no longer retained for ${effort.branch}; its decision does not transfer. Re-run discern accept without --composition to be served the current composition's decision moment. ${ACCEPT_NOTHING_LANDED}`,
      );
    }
  }

  let tip = enteredTip;
  for (let attempt = 1;; attempt++) {
    const composed = await runIntegrationAttempt({
      effort,
      submission: frozen,
      expectedTrunk: tip,
      log,
      cliModel,
      ...(attempt === 1 && declarations !== undefined ? { declarations } : {}),
      ...(attempt === 1 && request.composition !== undefined
        ? { composition: request.composition }
        : {}),
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
    if (composed.kind === "invalid-declarations") {
      refusal(
        "invalid_value",
        `${composed.reason} ${ACCEPT_NOTHING_LANDED}`,
      );
    }
    if (composed.kind === "cleanup-blocked") {
      refusal(
        "precondition_failed",
        `${effort.branch}'s retained composition is superseded (${composed.staleReason}), but its cleanup did not finish: ${
          composed.cleanupFailures.join("; ")
        }. Nothing replaces it while its record stands — fix the reported cause and re-run discern accept (the cleanup is retried), or run discern worktree prune from ${mainRepo}. ${ACCEPT_NOTHING_LANDED}`,
      );
    }
    if (composed.kind === "judgment-stale") {
      refusal(
        "precondition_failed",
        `The judgment this call carries no longer has its composition: ${composed.reason}.${
          cleanupTail(composed.cleanupFailures)
        } Re-run discern accept from ${effort.path} without continuation inputs — it composes against the current trunk and serves any renewed question about that exact result. ${ACCEPT_NOTHING_LANDED}`,
      );
    }
    if (composed.kind === "awaiting-judgment") {
      refuseAwaitingIntegrationJudgment(
        effort,
        frozen.head,
        composed.record.continuation?.composed_head,
        composed.record.worktree.path,
        composed.record.id,
        composed.served?.outstanding ?? [],
        composed.served,
      );
    }
    if (composed.kind === "conflict") {
      const message = `Landing ${effort.branch}'s submission ${
        short(frozen.head)
      } conflicts with ${trunk} in: ${composed.files.join(", ")}. ${
        integrationAuthorRoute(effort)
      }${cleanupTail(composed.cleanupFailures)} ${ACCEPT_NOTHING_LANDED}`;
      throw new WorktreeResultError(message, {
        ok: false,
        verb: "accept",
        error: "precondition_failed",
        message,
        hints: hintTexts(composed.hints),
      });
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

    // Green. Judgments bind to the combined subject: the copy's own
    // checkpoint state decides the variance interlock, so a declared-unmet
    // conclusion about the combined result — carried from the author with an
    // unchanged subject, or recorded through this landing's continuation —
    // still needs the owner's exact decision, and recorded grants never
    // cover it. An authorized set replaces the author-derived one; a missing
    // decision retains the proven composition and stops read-only.
    // A variance decision resumed onto a retained composition binds through
    // its receipt: without the match, the confirmation was given over a
    // different served moment, so the current composition's decision is
    // (re-)served instead of inheriting it.
    const varianceReceiptOk = request.variance.length === 0 ||
      (request.composition === undefined
        ? !composed.resumed
        : request.composition === composed.record.id);
    const interlock = resolveVarianceInterlock(composed.checkpointState, {
      confirmed: request.confirmed && varianceReceiptOk,
      varianceIds: request.variance,
    });
    let variancesNow: AuthorizedVarianceData[];
    if (interlock.kind === "authorized") {
      variancesNow = interlock.variances;
    } else {
      const unmetIds = composed.checkpointState.unmet.map((entry) => entry.id);
      if (interlock.kind === "declarations-stale") {
        // The gate just enforced current conclusions, so a stale reading here
        // is a conservative stop: retain the composition and re-serve.
        if (unmetIds.length + interlock.ids.length > 0) {
          await retainIntegrationForJudgment(mainRepo, composed.record, {
            composedHead: composed.head,
            decision: "declaration",
            awaiting: [...new Set([...interlock.ids, ...unmetIds])].sort(),
          });
        }
        refusal(
          AWAITING_DECLARATION_SLUG,
          `Landing needs a current conclusion for every governing checkpoint of the combined result, and ${
            interlock.ids.length === 1
              ? "one is"
              : `${interlock.ids.length} are`
          } missing or no longer current: ${
            interlock.ids.join(", ")
          }. Re-run discern accept from ${effort.path}; it serves each question about the retained composition. ${ACCEPT_NOTHING_LANDED}`,
        );
      }
      if (interlock.kind === "invalid-variances") {
        if (unmetIds.length > 0) {
          await retainIntegrationForJudgment(mainRepo, composed.record, {
            composedHead: composed.head,
            decision: "variance",
            awaiting: unmetIds,
          });
          refusal(
            "invalid_value",
            `${interlock.message} The proven composition is retained. ${ACCEPT_NOTHING_LANDED}`,
          );
        }
        const failures = await removeIntegrationWorktree(
          mainRepo,
          composed.record,
          log,
        );
        refusal(
          "invalid_value",
          `${interlock.message}${
            cleanupTail(failures)
          } ${ACCEPT_NOTHING_LANDED}`,
        );
      }
      await retainIntegrationForJudgment(mainRepo, composed.record, {
        composedHead: composed.head,
        decision: "variance",
        awaiting: interlock.unmet.map((entry) => entry.id),
      });
      refuseAwaitingIntegrationVariance(
        interlock.unmet,
        interlock.missing,
        interlock.confirmed,
        composed.record.id,
        request.confirmed && !varianceReceiptOk,
      );
    }

    // Only the transition core runs under the common publication
    // boundary — the authority recheck, consent resolution, and the trunk
    // compare-and-swap with its journal and claim. Proof-note recording,
    // convergence, and every cleanup (including external resource teardown)
    // stay outside it under the acceptance boundary alone, so sibling
    // completions are never starved by this landing's own commands.
    const core = await withLandingCommonPhase(mainRepo, async (): Promise<
      | {
        kind: "consent-missing";
        authorityNow: Awaited<ReturnType<typeof inspectLandingAuthority>>;
      }
      | {
        kind: "transitioned";
        authorityNow: Awaited<ReturnType<typeof inspectLandingAuthority>>;
        consent: LandingConsent;
        transition: Awaited<ReturnType<typeof performAcceptanceTransition>>;
      }
    > => {
      // Recheck authority over the exact tree that lands before the
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
        return { kind: "consent-missing", authorityNow };
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
        variances: variancesNow,
        standardProposals: decision.standardProposals,
      });
      return { kind: "transitioned", authorityNow, consent, transition };
    });
    if (core.kind === "consent-missing") {
      const failures = await removeIntegrationWorktree(
        mainRepo,
        composed.record,
        log,
      );
      refusal(
        AWAITING_CONSENT_SLUG,
        acceptAwaitingConsentMessage(core.authorityNow, true) +
          cleanupTail(failures),
        {
          hints: hintTexts([
            fire(HINTS["accept-awaiting-confirmation"]),
            fire(HINTS["accept-review-via-status"]),
          ]),
        },
      );
    }
    const { consent, transition } = core;
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
      if (request.composition !== undefined) {
        refusal(
          "precondition_failed",
          `${trunk} moved past the composition this decision names. Its receipt cannot authorize a replacement.${
            cleanupTail(failures)
          } Re-run discern accept without continuation inputs to be served the current composition's decision. ${ACCEPT_NOTHING_LANDED}`,
        );
      }
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
      ...(variancesNow.length > 0 &&
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
      variances: variancesNow,
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
      ...(proofLine === undefined ? {} : { proofLine }),
      landedCommit: composed.head,
      integrated: true,
      variances: variancesNow,
    };
  }
}
