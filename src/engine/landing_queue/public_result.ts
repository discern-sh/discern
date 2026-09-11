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
import { quoteCommandWord } from "../../shared/command_evidence.ts";
import {
  checkoutOutcomeSentence,
  evaluateResultCompletion,
} from "../../shared/result_completion.ts";
import { displayBranch } from "../../shared/result_markdown_values.ts";
import { selectedVerdictSentence } from "../../shared/result_markdown_queue.ts";
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
import { queueDecisionReason } from "./queue_decision_subjects.ts";
import type { PublicCandidateAssessment } from "./public_assessment.ts";
import { readLandingNoteResult } from "./publication.ts";
import { observedRecords } from "./repository.ts";
import { planQueueRetirement, RetirementCaptureSchema } from "./retirement.ts";

export type AcceptancePrefix = NonNullable<AcceptData["queue"]>[number];

export { displayBranch };

/**
 * The effort the owner selected, implicitly by running from its worktree or
 * explicitly with `--target`. The result leads with this effort's own verdict
 * and always carries its row; other efforts follow, labelled. `synthesized`
 * carries the caller-built row when the walk never produced one — it joins the
 * rows only after global conditions are attributed to the true stopping row.
 */
export interface SelectedEffortPresentation {
  readonly effort: string;
  /** Short display branch for the verdict sentence. */
  readonly branch: string;
  /** The effort's CURRENT recorded source head. The verdict binds to this
   * source: a previous cycle's landing row for the same effort is another
   * outcome, never the selected effort's own answer. */
  readonly sourceHead?: string;
  readonly synthesized?: AcceptancePrefix;
  /** Active queue order (effort ids) that labels other rows ahead or behind. */
  readonly queueOrder?: readonly string[];
  /** Resolve a waiting row's shared single reason — the same derivation the
   * status queue shows, including the stale entry's withdrawal or
   * reconciliation offer when its work is already on the trunk. */
  readonly resolveQueueReason?: (
    row: AcceptancePrefix,
  ) => Promise<{ kind: string; reason: string } | undefined>;
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
        : reason === "claim-lost"
        ? "The acceptance reservation expired or its observed state changed. Retry acceptance for the same effort; unchanged validation evidence remains reusable."
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
        "No Proof covers this effort's current source. Run discern done from its clean committed worktree, then retry acceptance.";
      break;
    case "missing-authority":
      reason =
        "Waiting for the owner's recorded approval of its current source.";
      break;
    case "missing-judgment": {
      const subjects = "subjects" in blocker ? blocker.subjects : [];
      // Queue decisions carry their plain sentences in one table, so a first
      // paragraph never shows a recorded subject token for these causes.
      const translated = subjects.length === 1 && subjects[0] !== undefined
        ? queueDecisionReason(subjects[0])
        : undefined;
      reason = translated ??
        `A checkpoint or standard decision is still required${
          subjects.length ? ": " + subjects.join(", ") : "."
        }`;
      break;
    }
    case "validation-failed":
      reason =
        "Its checks failed. Fix the reported diagnostics, rerun discern done, then retry acceptance.";
      break;
    case "waiting-for-operation":
      reason =
        "Another acceptance is still finishing this landing. Wait for it to settle, then retry discern accept; the landing does not repeat.";
      break;
    case "report-only":
      reason =
        "This run reported checks without recording reusable evidence. Run discern done from the effort's clean committed worktree, then retry acceptance.";
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

/** Project each effort's outcome without losing independently pending decisions. */
export async function queueAcceptanceResult(
  root: string,
  rows: AcceptancePrefix[],
  pendingBlockers: readonly AcceptancePending[],
  proof?: Proof,
  dryRun = false,
  checkpointDrops: readonly CheckpointDrop[] = [],
  selected?: SelectedEffortPresentation,
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
    ) ?? [...rows].reverse().find((row) => row.planned_action !== undefined) ??
      rows.at(-1)
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
  // The synthesized row joins the presentation and returned data, but the
  // completion verdict is evaluated over the walk's own rows below — a
  // selected effort the walk never reached is not this call's failed effect.
  const walkRows = rows;
  if (
    selected?.synthesized !== undefined &&
    !rows.some((row) =>
      row.effort === selected.effort &&
      (selected.sourceHead === undefined ||
        row.source_head === selected.sourceHead)
    )
  ) {
    rows = [...rows, selected.synthesized];
  }
  const own = selected === undefined
    ? undefined
    : rows.find((row) =>
      row.effort === selected.effort &&
      (selected.sourceHead === undefined ||
        row.source_head === selected.sourceHead)
    );
  // Every waiting row leads with the shared single reason the status queue
  // shows — including a stale entry's own withdrawal or reconciliation offer —
  // ahead of the assessed detail. The not-reached line stays first on the
  // selected effort's own row.
  const sharedItems = new Set<AcceptancePrefix["pending"][number]>();
  if (selected?.resolveQueueReason !== undefined) {
    for (const row of rows) {
      if (row.state === "landed" || row.pending.length === 0) continue;
      const shared = await selected.resolveQueueReason(row);
      if (shared === undefined) continue;
      const already = row.pending.find((item) => item.reason === shared.reason);
      if (already !== undefined) {
        sharedItems.add(already);
        continue;
      }
      const keepFirst = row.pending[0]?.kind === "not-reached" ? 1 : 0;
      row.pending = [
        ...row.pending.slice(0, keepFirst),
        shared,
        ...row.pending.slice(keepFirst),
      ];
      sharedItems.add(shared);
    }
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
            `${row.branch} landed, but the main checkout has not finished catching up. Resolve the retained diagnostics and retry discern accept from the main checkout; the landing and its approval do not repeat.`,
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
  // One line per effort other than the selected one: what happened to it, and
  // when it waits, the single reason — full sentences, each said once.
  const rowLine = (row: AcceptancePrefix): string => {
    const branch = displayBranch(row.branch);
    if (row.state === "landed") {
      return `${branch} landed${
        row.exception === undefined
          ? ""
          : " by emergency exception, with no passing Proof"
      }. ${checkoutOutcomeSentence(row)}`;
    }
    const reason = row.pending[0]?.reason;
    return `${branch} is ${
      row.state === "ready" ? "ready to land" : "waiting"
    }${reason === undefined ? "." : `: ${reason}`}`;
  };
  const detailTail =
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
    ).join("");
  let message: string;
  if (selected === undefined) {
    message = (dryRun
      ? "Read-only preview; each effort in the queue lands with its own evidence and approval."
      : `${landed} effort${landed === 1 ? "" : "s"} landed.${
        blockers.length
          ? " Acceptance is pending: " +
            blockers.map((blocker) => acceptancePending(blocker).reason).join(
              "; ",
            )
          : ""
      }`) +
      (rows.length === 0 ? "" : "\n\n" + rows.map(rowLine).join("\n")) +
      detailTail;
  } else {
    // The first paragraph carries what the owner acts on: where the walk
    // stopped and the one shared reason the status queue shows (or, without
    // one, the first assessed reason). Every other assessed condition follows
    // under its own label, identifiers and all.
    const ownItems = own !== undefined && own.state !== "landed" &&
        own.state !== "ready"
      ? own.pending
      : [];
    const notReached = ownItems.filter((item) => item.kind === "not-reached");
    const sharedLead = ownItems.filter((item) => sharedItems.has(item));
    const rest = ownItems.filter((item) =>
      !notReached.includes(item) && !sharedLead.includes(item)
    );
    const lead = [
      ...notReached,
      ...(sharedLead.length > 0 ? sharedLead : rest.slice(0, 1)),
    ];
    const details = ownItems.filter((item) => !lead.includes(item));
    const verdict = selectedVerdictSentence({
      branch: selected.branch,
      state: own?.state,
      dryRun,
      ...(own === undefined ? {} : { checkout: own }),
    }) +
      (lead.length > 0
        ? "\n" + lead.map((item) => `- ${item.reason}`).join("\n")
        : "");
    const others = rows.filter((row) => row !== own);
    const order = selected.queueOrder ?? [];
    const ownIndex = order.indexOf(selected.effort);
    const ahead = others.filter((row) => {
      const index = order.indexOf(row.effort);
      return index >= 0 && (ownIndex < 0 || index < ownIndex);
    });
    const behind = others.filter((row) => {
      const index = order.indexOf(row.effort);
      return ownIndex >= 0 && index > ownIndex;
    });
    const elsewhere = others.filter((row) =>
      !ahead.includes(row) && !behind.includes(row)
    );
    // Presentations label rows from this recorded relation instead of
    // re-deriving queue order from data they do not carry.
    if (own !== undefined) own.relation = "selected";
    for (const row of ahead) row.relation = "ahead";
    for (const row of behind) row.relation = "behind";
    for (const row of elsewhere) row.relation = "other";
    // A global condition no shown line already states still reaches the owner.
    const shown = new Set([
      ...(own?.pending ?? []).map((item) => item.reason),
      ...others.map((row) => row.pending[0]?.reason),
    ]);
    const leftover = blockers.map((blocker) => acceptancePending(blocker))
      .filter((item) =>
        !shown.has(item.reason) &&
        !(own === undefined && item.kind === "missing-evidence")
      ).map((item) => item.reason);
    message = verdict +
      (ahead.length === 0 ? "" : "\n\nAhead of it in the queue:\n" +
        ahead.map(rowLine).join("\n")) +
      (behind.length === 0 ? "" : "\n\nBehind it in the queue:\n" +
        behind.map(rowLine).join("\n")) +
      (elsewhere.length === 0 ? "" : "\n\nOther efforts in this call:\n" +
        elsewhere.map(rowLine).join("\n")) +
      (details.length === 0
        ? ""
        : `\n\nDetails for ${markdownCodeSpan(selected.branch)}:\n` +
          details.map((item) => `- ${item.reason}`).join("\n")) +
      (leftover.length === 0 ? "" : "\n\n" + leftover.join("\n")) +
      detailTail +
      (dryRun ? "\n\nRead-only preview; nothing changed." : "");
  }
  const continuation =
    selected !== undefined && own !== undefined && own.state !== "landed"
      ? `discern accept --target ${quoteCommandWord(selected.effort)}`
      : undefined;
  const fields = {
    verb: "accept",
    ...(dryRun
      ? { dry_run: true as const }
      : { steps: convergenceSteps, diagnostics: convergenceDiagnostics }),
    message,
    data: {
      root,
      queue: rows,
      ...(selected === undefined ? {} : { selected_effort: selected.effort }),
      ...(continuation === undefined ? {} : { continuation }),
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
      continuation === undefined ? [] : hintTexts([
        fire(HINTS["completion-pending"], {
          action:
            `After resolving the named conditions, continue this selected effort with ${continuation}. Each earlier effort still needs its own approval.`,
        }),
      ]),
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
              "Resolve the named pending condition, then run discern accept again. Earlier landed efforts and spent approvals stay recorded.",
          }),
      ]),
    ),
  };
  const forEvaluation = {
    ...fields,
    data: { ...fields.data, queue: walkRows },
  };
  const evaluated = evaluateResultCompletion<AcceptData>(
    dryRun || blockers.length === 0 ? { ok: true, ...forEvaluation } : {
      ok: false,
      ...forEvaluation,
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
  const presented = evaluated.data === undefined
    ? evaluated
    : { ...evaluated, data: { ...evaluated.data, queue: rows } };
  return presented.ok || hasRegisteredActionableHint(presented.hints)
    ? presented
    : {
      ...presented,
      hints: hintTexts([
        fire(HINTS["completion-pending"], {
          action:
            "Resolve the named pending condition, then run discern accept again; preserve every recorded landing.",
        }),
      ]),
    };
}
