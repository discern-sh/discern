/** Read durable prefix outcomes and project one public acceptance result. */
import {
  type CheckpointDrop,
  uniqueCheckpointDrops,
} from "../../shared/checkpoint_drops.ts";
import {
  fire,
  hasRegisteredActionableHint,
  HINTS,
  hintTexts,
  mergeHintTexts,
} from "../../shared/hints.ts";
import { markdownCodeSpan } from "../../shared/markdown_code.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { type StepResult, stepResultFromJson } from "../../shared/result.ts";
import { evaluateResultCompletion } from "../../shared/result_completion.ts";
import type { AcceptData, Proof } from "../../shared/result_schemas.ts";
import { checkpointServingText } from "../checkpoints/serving_text.ts";
import { emitCompletionProgress } from "../completion/events.ts";
import type { CompletionBlocker } from "../completion/protocol.ts";
import { readCompletionRecord } from "../completion/store.ts";
import { readEnvironmentArtifact } from "../execution/artifact_read.ts";
import { readProofPresentation } from "../gate/proof_presentation.ts";
import { renderLandingProofLine } from "../gate/proof_render.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { ignoredFileDetails } from "../worktree/ignored.ts";
import {
  type LandingConvergenceResult,
  readLandingConvergenceResult,
} from "./convergence.ts";
import type { QueueEntry } from "./model.ts";
import type { PublicCandidateAssessment } from "./public_assessment.ts";
import { readLandingNoteResult } from "./publication.ts";
import { observedRecords } from "./repository.ts";
import { planQueueRetirement, RetirementCaptureSchema } from "./retirement.ts";

export type AcceptancePrefix = NonNullable<AcceptData["queue"]>[number];

/** Retention describes checkout ownership separately from the recorded landing. */
export function retainedCheckoutExplanation(
  reason: string | undefined,
): string {
  switch (reason) {
    case "unreleased":
      return "The checkout has not been released for cleanup. It remains available for review or further edits. Stop active use, then run discern done --release-checkout from this effort and discern accept from the main checkout for eligible cleanup.";
    case "active-use":
      return "The checkout is still in use. Stop its preview or active operation, then retry discern accept from the main checkout.";
    case "moved-branch":
      return "The source branch changed after landing. Preserve the new work and run discern status from its worktree.";
    case "dirty":
      return "The checkout contains changed files. Preserve and review them before retrying cleanup from the main checkout.";
    case "ownership-uncertain":
      return "Checkout ownership could not be verified. Preserve its files and resources and inspect discern status --verbose from the main checkout.";
    default:
      return reason ??
        "Inspect discern status --verbose from the main checkout for the retained checkout's next action.";
  }
}

/** Preserve the exact pending dimension alongside every earlier completed transition. */
export type AcceptancePending =
  | CompletionBlocker
  | NonNullable<AcceptData["pending"]>[number];

/** Keep the semantic pending kind and its explanation in every public projection. */
export function acceptancePending(
  blocker: AcceptancePending,
): { kind: string; reason: string } {
  if (blocker.kind === "stale-evidence") {
    const reason = "reason" in blocker ? blocker.reason : undefined;
    return {
      kind: blocker.kind,
      reason: reason === "source-replaced"
        ? "The authored source changed after completion. Run discern done on the intended clean committed source and obtain authority for that source."
        : `Validation evidence is stale${
          reason === undefined ? "" : ` (${reason})`
        }. Acceptance needs current evidence in an eligible released environment.`,
    };
  }
  if (blocker.kind === "recovery-incomplete" && "recovery" in blocker) {
    return { kind: blocker.kind, reason: blocker.recovery.reason };
  }
  if ("reason" in blocker && blocker.reason !== undefined) {
    return { kind: blocker.kind, reason: blocker.reason };
  }
  let reason: string;
  switch (blocker.kind) {
    case "missing-evidence":
      reason =
        "Required validation evidence is missing. Run discern done from the intended effort's clean committed worktree, then retry acceptance.";
      break;
    case "missing-authority":
      reason =
        "The next prefix needs separately recorded landing authority for its current source.";
      break;
    case "missing-judgment":
      reason = `A checkpoint or standard decision is still required${
        "subjects" in blocker ? ": " + blocker.subjects.join(", ") : "."
      }`;
      break;
    case "validation-failed":
      reason =
        "Required validation failed. Resolve its diagnostics and deliberately rerun completion before acceptance.";
      break;
    default:
      reason = JSON.stringify(blocker);
  }
  return { kind: blocker.kind, reason };
}

/** The same per-predecessor evidence appears in a preview and an active stop. */
export function acceptancePrefix(
  entry: QueueEntry,
  evaluated?: PublicCandidateAssessment,
): AcceptancePrefix {
  const assessment = evaluated?.assessment;
  return {
    effort: entry.source.effort_id,
    branch: entry.source.branch,
    source_head: entry.source.head,
    candidate_id: entry.candidate_id,
    expected_trunk: assessment?.candidate.expected_predecessor.head ?? null,
    target: assessment?.candidate.head ?? null,
    state: assessment?.proof !== undefined && assessment.proof !== null &&
        assessment.blockers.length === 0
      ? "ready"
      : "pending",
    authority_id: entry.authority_id,
    retirement: "retained",
    ...(evaluated?.ignored_file_changes === undefined
      ? {}
      : { ignored_file_changes: evaluated.ignored_file_changes }),
    preview_actions: evaluated?.preview_actions ?? [],
    ...(evaluated?.consent === undefined ? {} : { consent: evaluated.consent }),
    scopes_changed: [...evaluated?.scopes_changed ?? []],
    approval_requests: [...evaluated?.approval_requests ?? []],
    checkpoint_drops: [...evaluated?.checkpoint_drops ?? []],
    ...((evaluated?.review?.checkpoints === undefined ||
        evaluated.review.checkpoints === null)
      ? {}
      : { checkpoint_review: evaluated.review.checkpoints }),
    pending: assessment?.blockers.map((blocker) => {
      const item = acceptancePending(blocker);
      return blocker.kind === "missing-authority" &&
          evaluated?.authority_details.length
        ? {
          ...item,
          reason: `${item.reason} Uncovered authority: ${
            evaluated.authority_details.join("; ")
          }`,
        }
        : item;
    }) ?? [],
  };
}

/** A grant refusal must not hide the owner's separately pending variance decision. */
function pendingReviewText(rows: readonly AcceptancePrefix[]): string {
  return rows.filter((row) => row.state !== "landed").flatMap((row) =>
    (row.checkpoint_review?.declared_unmet ?? []).map((question) => {
      const evidence = checkpointServingText({
        matched: question.matched ?? [],
        related: (question.related ?? []).map((path) => ({
          ...path,
          forPath: path.for_path,
        })),
        ...(question.question_file === undefined
          ? {}
          : { questionFile: question.question_file }),
        ...(question.teach === undefined ? {} : { teach: question.teach }),
        ...(question.reference === undefined
          ? {}
          : { reference: question.reference }),
      });
      return [
        `Checkpoint ${markdownCodeSpan(question.id)} is declared unmet for ${
          markdownCodeSpan(row.branch)
        }.`,
        `Changed: ${evidence.matched}`,
        ...evidence.related,
        `Question: ${question.question}`,
        ...(evidence.questionSource === undefined
          ? []
          : [evidence.questionSource]),
        ...evidence.notes,
        `Rationale: ${markdownCodeSpan(question.why)}`,
      ].join("\n");
    })
  ).join("\n\n");
}

/** Project prefix outcomes without losing independently pending decisions. */
export async function queueAcceptanceResult(
  root: string,
  rows: AcceptancePrefix[],
  pendingBlockers: readonly AcceptancePending[],
  proof?: Proof,
  dryRun = false,
  checkpointDrops: readonly CheckpointDrop[] = [],
): Promise<DiscernResult<AcceptData>> {
  const blockers = [
    ...new Map(
      pendingBlockers.map((blocker) => [JSON.stringify(blocker), blocker]),
    ).values(),
  ];
  const convergenceSteps: StepResult[] = [];
  const convergenceDiagnostics: LandingConvergenceResult["diagnostics"] = [];
  const stopped = dryRun
    ? rows.find((row) =>
      row.planned_action !== undefined && row.planned_action !== "ready"
    ) ?? rows.at(-1)
    : rows.at(-1);
  if (
    blockers.length > 0 && stopped !== undefined && stopped.state !== "landed"
  ) {
    stopped.state = "pending";
    stopped.pending = blockers.map((blocker) =>
      blocker.kind === "missing-authority"
        ? stopped.pending.find((item) => item.kind === "missing-authority") ??
          acceptancePending(blocker)
        : acceptancePending(blocker)
    );
  }
  const noteHints: string[] = [];
  const completionRecords = rows.some((row) => row.landing_id !== undefined)
    ? observedRecords(await observeCompletionRecords(root))
    : [];
  for (const row of rows) {
    if (row.landing_id === undefined) continue;
    try {
      const landing = await readCompletionRecord(root, {
        kind: "landing",
        id: row.landing_id,
      });
      if (landing.kind !== "recorded" || landing.record.kind !== "landing") {
        continue;
      }
      const plan = planQueueRetirement(landing.record, completionRecords);
      if (plan.kind !== "inspect") {
        const retirement = plan.record;
        const outcome = plan.kind === "settled"
          ? plan.outcome
          : plan.record.data.outcome;
        if (retirement?.data.effects !== undefined) {
          row.retirement_effects = retirement.data.effects;
        }
        row.retirement = outcome.kind === "retired"
          ? "retired"
          : outcome.kind === "recovery"
          ? "recovery"
          : "retained";
        if (outcome.kind === "retained") {
          row.retirement_reason = outcome.reason;
        } else if (outcome.kind === "recovery") {
          row.retirement_reason = outcome.recovery.reason;
        } else {
          delete row.retirement_reason;
        }
        if (retirement?.data.capture !== undefined) {
          const ignored = RetirementCaptureSchema.parse(
            await readEnvironmentArtifact(root, retirement.data.capture),
          ).ignored_file_changes;
          if (ignored !== undefined) row.ignored_file_changes = ignored;
        }
      }
      const convergence = await readLandingConvergenceResult(
        root,
        landing.record.data,
      );
      row.convergence = convergence === undefined
        ? "pending"
        : convergence.ok
        ? "passed"
        : "failed";
      if (convergence !== undefined) {
        convergenceSteps.push(...convergence.steps.map(stepResultFromJson));
        convergenceDiagnostics.push(...convergence.diagnostics);
        noteHints.push(...convergence.hints);
      }
      if (row.convergence !== "passed") {
        blockers.push({
          kind: "convergence-incomplete",
          reason:
            `Landing is recorded for ${row.branch}; main checkout convergence is ${row.convergence}. Resolve the retained diagnostics and retry acceptance from the main checkout. Landing and its authority do not repeat.`,
        });
      }
      if (row.retirement === "recovery") {
        blockers.push({
          kind: "retirement-incomplete",
          reason: row.retirement_reason ??
            "Retirement recovery is incomplete; preserve its retained state.",
        });
      }
      const claim = landing.record.data.claim;
      if (claim.kind === "exception") row.exception = claim;
      if (claim.kind === "normal") {
        const authority = await readCompletionRecord(root, {
          kind: "authority",
          id: claim.authority_id,
        });
        if (
          authority.kind === "recorded" &&
          authority.record.kind === "authority" &&
          authority.record.data.state.kind === "consumed" &&
          authority.record.data.state.landing_id === landing.record.id
        ) {
          const consent = authority.record.data.source;
          const recordedConsent = {
            source: consent.source,
            ...(consent.scopes.length ? { scopes: [...consent.scopes] } : {}),
          };
          row.consent = recordedConsent;
          row.variances = [...claim.decisions.variances];
          row.standard_approvals = [...claim.decisions.proposals];
          const presentation = await readProofPresentation(root, {
            candidate_id: landing.record.data.candidate_id,
            proof_id: claim.proof_id,
          });
          row.proof_line = renderLandingProofLine(
            presentation.line,
            recordedConsent,
            {
              ...(presentation.checkpoints === undefined
                ? {}
                : { checkpoints: presentation.checkpoints }),
              ...(claim.decisions.proposals.length
                ? { proposals: claim.decisions.proposals }
                : {}),
            },
          );
          if (proof?.completion?.candidate_id === row.candidate_id) {
            proof = { ...proof, line: row.proof_line };
          }
        }
      }
      const note = await readLandingNoteResult(root, landing.record.data);
      if (note === undefined) continue;
      if (note.proof_note !== undefined) row.proof_note = note.proof_note;
      const reason = note.reason ?? note.proof_note?.write.reason;
      if (reason !== undefined) row.note_reason = reason;
      noteHints.push(...note.hints);
    } catch (error) {
      row.note_reason = `Retained note diagnostics are unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`;
      noteHints.push(...hintTexts([
        fire(HINTS["completion-pending"], {
          action:
            "Preserve the common landing record and restore its note-diagnostic artifact; landing itself does not need to repeat.",
        }),
      ]));
    }
  }
  for (const blocker of blockers) {
    emitCompletionProgress({
      phase: "pending",
      state: blocker.kind,
      candidate_id: rows.at(-1)?.candidate_id ?? null,
      reason: acceptancePending(blocker).reason,
    });
  }
  const landed = rows.filter((row) => row.state === "landed").length;
  const standardApproval = blockers.some((blocker) =>
    blocker.kind === "missing-judgment" && "subjects" in blocker &&
    blocker.subjects.some((subject) => subject.startsWith("standard-proposal:"))
  );
  const judgmentSubjects = blockers.flatMap((blocker) =>
    blocker.kind === "missing-judgment" && "subjects" in blocker
      ? [...blocker.subjects]
      : []
  );
  const variances = [
    ...new Set(
      judgmentSubjects.filter((subject) => subject.startsWith("variance:")).map(
        (subject) => subject.slice("variance:".length),
      ),
    ),
  ];
  const invalidDecision = judgmentSubjects.some((subject) =>
    subject.startsWith("invalid-variances:") ||
    subject.startsWith("invalid-standard-approvals:")
  );
  const checkpointUnavailable = judgmentSubjects.includes(
    "checkpoint-evidence-unavailable",
  );
  const staleDeclarations = judgmentSubjects.filter((subject) =>
    subject.startsWith("declaration-stale:")
  ).map((subject) => subject.slice("declaration-stale:".length));
  const proposalChanged =
    judgmentSubjects.includes("standard-proposal-changed") ||
    judgmentSubjects.includes("standard-proposal-store-unavailable");
  const judgmentChanged = judgmentSubjects.some((subject) =>
    subject === "checkpoint-declaration-changed" ||
    subject === "checkpoint-reading-changed"
  );
  const authority = blockers.some((blocker) =>
    blocker.kind === "missing-authority"
  );
  const fields = {
    verb: "accept",
    ...(dryRun
      ? { dry_run: true as const }
      : { steps: convergenceSteps, diagnostics: convergenceDiagnostics }),
    message:
      (dryRun
        ? "Read-only queue preview; each prefix has its own evidence and authority."
        : `${landed} prefix${landed === 1 ? "" : "es"} landed.${
          blockers.length
            ? " Acceptance is pending: " + blockers.map((blocker) =>
              acceptancePending(blocker).reason
            ).join("; ")
            : ""
        }`) +
      (rows.length === 0
        ? ""
        : "\n\n" + rows.map((row) =>
          `${row.branch}: ${row.state}${
            row.exception === undefined
              ? ""
              : "; emergency exception, no passing Proof"
          }${row.state === "landed" ? `; checkout ${row.retirement}` : ""}${
            row.state === "landed" && row.retirement === "retained"
              ? `. ${retainedCheckoutExplanation(row.retirement_reason)}`
              : ""
          }${
            row.pending.length
              ? "; " + row.pending.map((item) => item.reason).join("; ")
              : ""
          }`
        ).join("\n")) +
      rows.flatMap((row) =>
        row.ignored_file_changes === undefined
          ? []
          : ignoredFileDetails(row.ignored_file_changes).map((detail) =>
            `\n\n${row.branch}: ${detail}`
          )
      ).join("") +
      (pendingReviewText(rows) === "" ? "" : `\n\n${pendingReviewText(rows)}`) +
      rows.filter((row) => row.state !== "landed").flatMap((row) =>
        (row.approval_requests ?? []).map(({ proposal }) =>
          `\n\nStandard proposal ${markdownCodeSpan(proposal.standard)} for ${
            markdownCodeSpan(row.branch)
          }: ${proposal.trunk_limit} → ${proposal.proposed_limit}. Reason: ${
            markdownCodeSpan(proposal.reason)
          }`
        )
      ).join(""),
    data: {
      root,
      queue: rows,
      checkpoint_drops: uniqueCheckpointDrops([
        ...checkpointDrops,
        ...rows.flatMap((row) =>
          row.checkpoint_drops ?? row.checkpoint_review?.drops ?? []
        ),
      ]),
      ...(rows.length === 1 && rows[0]?.proof_note !== undefined
        ? { proof_note: rows[0].proof_note }
        : {}),
      pending: blockers.map(acceptancePending),
      ...(proof === undefined
        ? {}
        : { proof: proof.markdown, proof_line: proof.line }),
    },
    hints: mergeHintTexts(
      noteHints,
      variances.length === 0 ? [] : hintTexts([
        fire(HINTS["accept-authorize-variance"], { ids: variances }),
      ]),
      staleDeclarations.length === 0 ? [] : hintTexts([
        fire(HINTS["accept-declarations-stale"], { ids: staleDeclarations }),
      ]),
      hintTexts(
        rows.filter((row) =>
          row.state !== "landed" && (row.approval_requests?.length ?? 0) > 0
        ).map((row) =>
          fire(HINTS["accept-authorize-standard-proposals"], {
            branch: row.branch,
            tokens: (row.approval_requests ?? []).map((item) => item.token),
          })
        ),
      ),
      proof === undefined
        ? []
        : hintTexts([fire(HINTS["accept-relay-landing-proof"])]),
      blockers.length === 0 ? [] : hintTexts([
        authority
          ? fire(HINTS["accept-awaiting-confirmation"])
          : fire(HINTS["completion-pending"], {
            action:
              "Resolve the named pending condition, then run discern accept again. Earlier landed prefixes and spent authority remain in common recovery records.",
          }),
      ]),
    ),
  };
  const evaluated = evaluateResultCompletion<AcceptData>(
    dryRun || blockers.length === 0 ? { ok: true, ...fields } : {
      ok: false,
      ...fields,
      error: landed > 0
        ? "partial_acceptance"
        : checkpointUnavailable
        ? "checkpoint_evidence_unavailable"
        : invalidDecision
        ? "invalid_value"
        : proposalChanged
        ? "proposal_stale"
        : staleDeclarations.length > 0 || judgmentChanged
        ? "awaiting_declaration"
        : variances.length > 0
        ? "awaiting_variance"
        : standardApproval
        ? "awaiting_standard_approval"
        : authority
        ? "awaiting_consent"
        : "incomplete",
    },
  );
  return evaluated.ok || hasRegisteredActionableHint(evaluated.hints)
    ? evaluated
    : {
      ...evaluated,
      hints: hintTexts([
        fire(HINTS["completion-pending"], {
          action:
            "Resolve the named pending condition, then run discern accept again; preserve every recorded landing.",
        }),
      ]),
    };
}
