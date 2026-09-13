/**
 * `discern accept`: submit this effort's proven revision and land it.
 *
 * The verb runs in the effort's own checkout, or selects one with `--target`.
 * It records the submission beside the effort grant, then, once authority
 * covers the landing, fast-forwards the trunk to the exact proven commit under
 * the acceptance transaction (journal, compare-and-swap, marker ref), records
 * the Proof note, converges the main checkout, and removes the effort's
 * resources, checkout, and branch when the branch holds nothing beyond the
 * landed revision. A revision is proven when its complete Proof names the
 * trunk's current tip as its predecessor; a moved trunk refuses with the
 * update route. Nothing here installs a revision into any checkout: the
 * effort's checkout is read, the main checkout converges to the trunk it
 * advanced, and no other checkout is touched.
 */

import { loggerSink } from "../../lib/log.ts";
import { terminalLine } from "../../lib/terminal.ts";
import {
  type CheckpointDrop,
  checkpointDropAccounts,
  isIndeterminateStopDrop,
  uniqueCheckpointDrops,
} from "../../shared/checkpoint_drops.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../../shared/clock.ts";
import { commandEvidence } from "../../shared/command_evidence.ts";
import type { CompleteProofEvidence } from "../../shared/completion_proof.ts";
import {
  AWAITING_CONSENT_SLUG,
  type LandingConsent,
} from "../../shared/consent.ts";
import {
  AWAITING_DECLARATION_SLUG,
  AWAITING_VARIANCE_SLUG,
} from "../../shared/declarations.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { detachPromise } from "../../shared/promise_effects.ts";
import { targetExists } from "../../shared/fs_presence.ts";
import type { CliModelProvider } from "../../shared/cli_reference_codegen.ts";
import {
  fire,
  hasRegisteredActionableHint,
  HINTS,
  hintTexts,
  mergeHintTexts,
} from "../../shared/hints.ts";
import { markdownCodeSpan } from "../../shared/markdown_code.ts";
import {
  appliedResult,
  BUILT_IN_STEP_LABELS,
  type Diagnostic,
  dimBlock,
  type DiscernResult,
  previewResult,
  type StepOutcome,
  type StepResult,
} from "../../shared/result.ts";
import { observeCheckpointActivity } from "../../shared/result_capture.ts";
import {
  type WaitDetails,
  withProgressWait,
} from "../completion/progress_wait.ts";
import { readOperationJournal } from "../completion/operation_journal.ts";
import type {
  AcceptData,
  AcceptLandingState,
  AcceptProofNoteData,
  AuthorizedVarianceData,
  LandingOutcomeData,
  Proof,
  StandardLimitApprovalRequestData,
  StandardLimitProposalData,
} from "../../shared/result_schemas.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  declarationIsCurrent,
  readOpenQuestions,
} from "../checkpoints/open_questions.ts";
import { checkpointServingText } from "../checkpoints/serving_text.ts";
import { candidatePredecessor } from "../completion/candidate.ts";
import { readCompleteProof } from "../gate/completion_proof.ts";
import { observedGateOperation } from "../gate/observed_operation.ts";
import { planStageJobs } from "../gate/plan.ts";
import { renderProofLineCli } from "../gate/presentation.ts";
import { inspectGateProof } from "../gate/proof.ts";
import { readProofPresentation } from "../gate/proof_presentation.ts";
import { renderLandingProofLine } from "../gate/proof_render.ts";
import { buildStandardPlan } from "../gate/standard_plan.ts";
import {
  cloneStandardLimitProposal,
  inspectActiveStandardLimitProposals,
  sameStandardLimitProposalSet,
} from "../gate/standard_proposal_state.ts";
import {
  planTrackedRefresh,
  type TrackedRefreshPlan,
} from "../tracked_refresh.ts";
import {
  assertMainCheckoutReady,
  type CleanupDisposition,
  cleanUpEffort,
  cleanupKeepsCheckout,
} from "./accept_cleanup.ts";
import { executeIntegrationLanding } from "./accept_integration.ts";
import {
  ACCEPT_NOTHING_LANDED,
  acceptAwaitingConsentMessage,
  availableLandingConsent,
  landingAuthorityDetail,
  progressData,
  refusal,
  short,
  throwPartialAcceptance,
  trunkTip,
} from "./accept_support.ts";
import { walkQueue } from "./accept_walk.ts";
import {
  cloneLandingConsent,
  recordLandingProofNote,
} from "./accept_proof_recording.ts";
import {
  type AcceptanceCheckpointState,
  inspectAcceptanceCheckpoints,
  resolveVarianceInterlock,
  type StandingUnmetConclusion,
  varianceBinding,
} from "./acceptance_checkpoints.ts";
import {
  clearCompletedAcceptanceJournal,
  inspectInterruptedAcceptance,
  performAcceptanceTransition,
  recoverInterruptedAcceptance,
  withAcceptanceTransactionLock,
} from "./acceptance_transaction.ts";
import { convergeMainCheckout } from "./accept_convergence.ts";
// The emergency route converges through the same sequence.
export { convergeMainCheckout };
import { clearEffortGrant } from "./effort_grant_cleanup.ts";
import {
  assertResolvedTrunkMerged,
  commitIsAncestorOf,
  commitIsMerged,
  inLinkedWorktree,
  integrationBranch,
  mainRepoPath,
  missingIntegrationBranchWarning,
  registeredWorktreeRecord,
  repoToplevel,
  WorktreeGitError,
  WorktreeResultError,
} from "./git.ts";
import {
  deriveIdentity,
  type IdentitySettings,
  loadIdentitySettings,
  resolveWorktreeId,
} from "./identity.ts";
import { hasIgnoredFileChanges, inspectIgnoredFileChanges } from "./ignored.ts";
import {
  inspectLandingAuthority,
  type LandingAuthorityResolution,
} from "./landing_authority.ts";
import {
  assertProjectRootIsRepoToplevel,
  emitOrRenderWorktreeResult,
  type LifecycleContext,
  lifecycleContext,
} from "./lifecycle.ts";
import { classifyAutomaticBranchOwnership } from "./ownership.ts";
import { type AcceptPlan, acceptPlanToEngine } from "./plan.ts";
import { removeIntegrationWorktree } from "./integration_landing.ts";
import { readResourceSpecs } from "./resources.ts";
import { standardLimitApprovalRequests } from "./standard_approval.ts";
import { strictVerdictCurrency } from "../completion/verdict.ts";
import {
  readSubmission,
  type Submission,
  type SubmissionRead,
} from "./submission.ts";
import {
  clearSubmission,
  clearSubmissionIfCurrent,
  recordSubmission,
} from "./submission_writer.ts";
import { type SubmissionRow, submissionRows } from "./submissions_view.ts";
import { resolveWorktreeTarget } from "./target_resolution.ts";

/** The landing request, as the CLI, MCP, and desk hand it over. */
export interface AcceptRequest {
  /** Select the effort by id, path, branch, or full local ref. */
  readonly target?: string;
  readonly dryRun: boolean;
  readonly confirmed: boolean;
  readonly variance: readonly string[];
  readonly approveStandard: readonly string[];
  /** The live command tree, required by the integration gate run when the
   * trunk moved after the submission's Proof. */
  readonly cliModel?: CliModelProvider;
  readonly signal?: AbortSignal;
}

// ── the effort ───────────────────────────────────────────────────────────────

/** The checkout whose revision this call submits or lands. */
export interface EffortCheckout {
  readonly ctx: LifecycleContext;
  readonly path: string;
  readonly branch: string;
  readonly id: string;
  readonly settings: IdentitySettings;
  readonly mainRepo: string;
  readonly trunk: string;
  /** The owner selected the effort with `--target` instead of running inside it. */
  readonly explicit: boolean;
}

/** One sentence per queue row, for the refusal and the preview. */
function queueLines(rows: readonly SubmissionRow[]): string[] {
  return rows.map((row) =>
    `${row.position}. ${row.branch} at ${short(row.head)} — ${
      row.authority === "pre-authorized"
        ? "pre-authorized"
        : "awaiting the owner"
    }${row.readiness === "ready" ? "" : `; ${row.reason ?? "waiting"}`}`
  );
}

/** Refuse a landing request made from the main checkout without a target. */
async function refuseFromMainCheckout(
  ctx: LifecycleContext,
  trunk: string,
  dryRun: boolean,
): Promise<DiscernResult<AcceptData>> {
  const rows = await submissionRows(ctx.root, trunk);
  const queue = rows.length === 0
    ? "No effort has submitted a revision for landing."
    : `Submissions awaiting landing:\n${queueLines(rows).join("\n")}`;
  if (dryRun) {
    return {
      ok: true,
      verb: "accept",
      dry_run: true,
      message:
        `This is the main checkout, so this preview lists the queue and lands nothing. ${queue}`,
    };
  }
  return {
    ok: false,
    verb: "accept",
    error: "precondition_failed",
    message:
      `Run discern accept from the effort's worktree, or select one with --target <effort>. ${queue}`,
  };
}

/** Resolve the effort checkout this call operates on. Read-only. */
export async function effortCheckout(
  ctx: LifecycleContext,
  target: string | undefined,
): Promise<EffortCheckout | undefined> {
  let path: string;
  let explicit = false;
  if (target !== undefined) {
    const resolved = await resolveWorktreeTarget(ctx.root, target, {
      cwd: ctx.cwd,
      mode: "registered",
      includeMain: false,
      command: "discern accept --target",
    });
    if (resolved.path === undefined) {
      throw new WorktreeGitError(
        `'${target}' names no registered worktree. Pass a listed worktree's id, path, or branch, then re-run discern accept --target.`,
      );
    }
    path = resolved.path;
    explicit = true;
  } else {
    if (!(await inLinkedWorktree(ctx.cwd))) return undefined;
    const toplevel = await repoToplevel(ctx.cwd);
    if (toplevel === undefined) {
      throw new WorktreeGitError(
        "discern accept needs a Git worktree, but this directory is outside a Git repository. Move into the worktree that holds the finished branch, then re-run.",
      );
    }
    path = toplevel;
  }
  const effortCtx = explicit
    ? await lifecycleContext(path, ctx.log, path)
    : { ...ctx, cwd: path };
  const mainRepo = await mainRepoPath(path);
  if (mainRepo === undefined) {
    throw new WorktreeGitError(
      "discern could not find the main checkout from Git's worktree records. Run `git worktree repair`, then re-run `discern accept`.",
    );
  }
  if (mainRepo === path) {
    throw new WorktreeGitError(
      "Git identifies this path as the main checkout, so there is no effort branch to land. Move into the finished worktree shown by `discern status`, then re-run `discern accept`.",
    );
  }
  const settings = await loadIdentitySettings(effortCtx.root);
  const id = await resolveWorktreeId(settings, path);
  const branchRun = await runGit(["branch", "--show-current"], { cwd: path });
  const branch = branchRun.success ? branchRun.stdout.trim() : "";
  if (branch === "") {
    const conventional = deriveIdentity(id, settings).branch;
    throw new WorktreeGitError(
      `The worktree at ${path} is detached from a named branch, so there is no branch to land. Run \`git switch ${conventional}\` there, then re-run \`discern accept\`.`,
    );
  }
  return {
    ctx: effortCtx,
    path,
    branch,
    id,
    settings,
    mainRepo,
    trunk: integrationBranch(effortCtx.config.repository.trunk),
    explicit,
  };
}

// ── the landing subject ──────────────────────────────────────────────────────

/** The exact revision this call lands and the Proof that vouches for it. */
export interface LandingSubject {
  readonly head: string;
  readonly complete: CompleteProofEvidence;
  readonly proof: Proof;
  readonly proofMarkdown: string | undefined;
  readonly proofLine: string | undefined;
  readonly drops: CheckpointDrop[];
  /** The subject is the checkout's HEAD; otherwise an earlier submission. */
  readonly atHead: boolean;
  readonly submission: Submission | undefined;
}

/** The refusal `accept` serves for a report-only Proof. */
function refuseReportOnlyProof(drops: readonly CheckpointDrop[]): never {
  refusal(
    "report_only_proof",
    "This Proof records checkpoint review as reported and not enforced. Run ordinary `discern done` before acceptance. Nothing has been landed.",
    {
      hints: hintTexts([fire(HINTS["accept-requires-strict-proof"])]),
      ...(drops.length === 0 ? {} : { data: { checkpoint_drops: [...drops] } }),
    },
  );
}

/**
 * Resolve what this call may land: the checkout's HEAD when its Proof is
 * honored and complete; otherwise, for an owner's explicit `--target`, the
 * effort's recorded submission read back from common storage.
 */
async function resolveSubject(
  effort: EffortCheckout,
): Promise<LandingSubject | undefined> {
  const inspected = await inspectGateProof(effort.path);
  const inspectedDrops = uniqueCheckpointDrops([
    ...(inspected.proof_data?.checkpoint_drops ?? []),
    ...(inspected.checkpoint_drops ?? []),
  ]);
  if (inspected.status === "report_only") refuseReportOnlyProof(inspectedDrops);
  const submissionRead = await readSubmission(effort.path);
  const submission = submissionRead.status === "submitted"
    ? submissionRead.submission
    : undefined;
  // An honored Proof whose only defect is a checkpoint drop still names the
  // proven revision: the decision layers serve the drop-specific refusal
  // (unreadable declaration evidence, an indeterminate stop) instead of the
  // generic nothing-proven route. Unverifiable strand evidence stays excluded:
  // no decision layer can compensate for it.
  const proofData = inspected.status === "honored"
    ? inspected.proof_data
    : undefined;
  if (
    inspected.status === "honored" &&
    proofData !== undefined && proofData.completion !== undefined &&
    inspected.proof_line !== undefined && inspected.head !== undefined &&
    inspectedDrops.some((drop) =>
        drop.reason === "strand_check_unavailable"
      ) !== true
  ) {
    return {
      head: inspected.head,
      complete: proofData.completion,
      proof: proofData,
      proofMarkdown: inspected.proof,
      proofLine: inspected.proof_line,
      drops: inspectedDrops,
      atHead: true,
      submission,
    };
  }
  if (!effort.explicit || submission === undefined) return undefined;
  let complete: CompleteProofEvidence;
  let proof: Proof;
  try {
    complete = await readCompleteProof(effort.path, submission.proof);
    proof = await readProofPresentation(effort.path, submission.proof);
  } catch (error) {
    throw new WorktreeGitError(
      `${effort.branch} submitted ${
        short(submission.head)
      }, but its Proof cannot be read: ${
        error instanceof Error ? error.message : String(error)
      }. Run discern done from ${effort.path}, then discern accept.`,
      { cause: error },
    );
  }
  if (complete.candidate.head !== submission.head) {
    throw new WorktreeGitError(
      `${effort.branch} submitted ${
        short(submission.head)
      }, but its Proof names another commit. Run discern done from ${effort.path}, then discern accept.`,
    );
  }
  if (proof.mode === "report") {
    refuseReportOnlyProof(proof.checkpoint_drops ?? []);
  }
  const tip = await runGit(
    ["rev-parse", "--verify", `refs/heads/${effort.branch}^{commit}`],
    { cwd: effort.path },
  );
  const tipSha = tip.success ? tip.stdout.trim() : "";
  if (
    tipSha === "" ||
    !(await commitIsAncestorOf(effort.mainRepo, submission.head, tipSha))
  ) {
    throw new WorktreeGitError(
      `${effort.branch} no longer contains its submitted revision ${
        short(submission.head)
      }. Run discern done from ${effort.path}, then discern accept for the current work.`,
    );
  }
  // The submission's Proof is durable, but it is landable only while it is
  // still the revision's NEWEST strict verdict: a later strict run that
  // judged the same revision red supersedes it for landing, and an
  // unreadable verdict inventory fails closed rather than landing blind.
  const verdict = await strictVerdictCurrency(effort.path, submission.head);
  if (verdict.kind === "superseded") {
    throw new WorktreeGitError(
      `${effort.branch} submitted ${
        short(submission.head)
      }, but a newer strict gate run judged that revision red, so its earlier Proof is not landable. Resolve the failure and run discern done --rerun from ${effort.path}, then discern accept.`,
    );
  }
  if (verdict.kind === "unavailable") {
    throw new WorktreeGitError(
      `${effort.branch} submitted ${
        short(submission.head)
      }, but the strict verdict over that revision could not be read: ${verdict.reason}. Restore the completion records, run discern done from ${effort.path}, then discern accept.`,
    );
  }
  return {
    head: submission.head,
    complete,
    proof,
    proofMarkdown: proof.markdown,
    proofLine: proof.line,
    drops: uniqueCheckpointDrops(proof.checkpoint_drops ?? []),
    atHead: tipSha === submission.head && inspected.status === "honored",
    submission,
  };
}

/** The refusal when the checkout has nothing proven to land. */
function refuseNothingProven(effort: EffortCheckout): never {
  const where = effort.explicit ? ` from ${effort.path}` : "";
  refusal(
    "precondition_failed",
    effort.explicit
      ? `Nothing to land for ${effort.branch}: it has no submission and no honored Proof at its HEAD. Run discern done${where}, then discern accept.`
      : `${effort.branch} has no honored Proof at HEAD, so there is nothing proven to land. Run discern done, then discern accept.`,
    {
      hints: hintTexts([
        fire(HINTS["completion-pending"], {
          action:
            `Run discern done${where} on the committed tree, then discern accept.`,
        }),
      ]),
    },
  );
}

/** Read the trunk's current tip in the main checkout. */

/** The refusal when the trunk moved between this landing's reads. */
function refuseTrunkMoved(effort: EffortCheckout): never {
  const where = effort.explicit ? ` from ${effort.path}` : "";
  refusal(
    "precondition_failed",
    `The trunk moved while this acceptance was preparing; re-run discern accept${where} — it composes and checks the moved trunk in an integration worktree before landing.`,
    {
      hints: hintTexts([
        fire(HINTS["completion-pending"], {
          action: `Re-run discern accept${where}.`,
        }),
      ]),
    },
  );
}

// ── the submission ───────────────────────────────────────────────────────────

/** Record what this effort asks to land; a same-revision resubmission keeps its time. */
async function submit(
  effort: EffortCheckout,
  subject: LandingSubject,
): Promise<Submission> {
  const existing = subject.submission;
  if (existing !== undefined && existing.head === subject.head) return existing;
  return await recordSubmission(effort.path, {
    id: SYSTEM_SECURE_ENTROPY.uuid(),
    effort_id: effort.id,
    branch: effort.branch,
    head: subject.head,
    tree: subject.complete.candidate.tree,
    proof: {
      candidate_id: subject.complete.candidate_id,
      proof_id: subject.complete.proof_id,
    },
    submitted_at: wallTimeIso(SYSTEM_CLOCK.wallNow()),
  });
}

// ── authority ────────────────────────────────────────────────────────────────

/** The read-only refusal when no grant or attestation authorizes the landing. */
function refuseAwaitingConsent(
  authority: LandingAuthorityResolution,
  submitted: boolean,
): never {
  refusal(
    AWAITING_CONSENT_SLUG,
    acceptAwaitingConsentMessage(authority, submitted),
    {
      hints: hintTexts([
        fire(HINTS["accept-awaiting-confirmation"]),
        fire(HINTS["accept-review-via-status"]),
      ]),
    },
  );
}

/** Configured scope names matched by the landing's classified paths. */
function changedLandingScopes(
  authority: LandingAuthorityResolution,
): string[] {
  if (authority.scopeNames !== undefined) return [...authority.scopeNames];
  const scopes = new Set<string>();
  for (const classification of authority.classifications) {
    for (const scope of classification.scopes) scopes.add(scope);
  }
  return [...scopes].sort();
}

/**
 * Standing grants classify the checkout's HEAD; a submission behind HEAD is a
 * different tree, so only the effort grant or the conversation covers it.
 */
function subjectAuthority(
  authority: LandingAuthorityResolution,
  subject: LandingSubject,
): LandingAuthorityResolution {
  if (
    subject.atHead || authority.kind !== "authorized" ||
    authority.consent.source !== "standing-grant"
  ) {
    return authority;
  }
  return {
    kind: "conversation-required",
    standingScopes: authority.standingScopes,
    classifications: [],
    uncovered: [],
    warnings: [
      ...authority.warnings,
      "Standing grants cover the checkout's current tree, not the earlier submitted revision.",
    ],
    ...(authority.effortGrant === undefined
      ? {}
      : { effortGrant: authority.effortGrant }),
  };
}

// ── checkpoints and standard proposals ───────────────────────────────────────

/** A reopened or missing checkpoint declaration routes back to `done`. */
function refuseDeclarationsStale(ids: readonly string[]): never {
  refusal(
    AWAITING_DECLARATION_SLUG,
    `Landing needs a current conclusion for every governing checkpoint, and ${
      ids.length === 1 ? "one is" : `${ids.length} are`
    } missing or no longer current: ${ids.join(", ")}. Run \`discern ` +
      "done` — it serves each question with its evidence and records your " +
      `conclusion — then re-run \`discern accept\`. ${ACCEPT_NOTHING_LANDED}`,
    {
      hints: hintTexts([
        fire(HINTS["accept-declarations-stale"], { ids: [...ids] }),
      ]),
    },
  );
}

/** One declared-unmet conclusion's serving text in the variance refusal. */
function serveUnmetConclusion(unmet: StandingUnmetConclusion): string {
  const evidence = checkpointServingText(unmet);
  return [
    `${unmet.id} — declared unmet at ${unmet.declaredAt}`,
    `  Question: ${unmet.question.trim()}`,
    ...(evidence.questionSource === undefined ? [] : [evidence.questionSource]),
    `  Changed: ${evidence.matched}`,
    ...evidence.related,
    `  Rationale: ${markdownCodeSpan(unmet.why)}`,
    ...evidence.notes,
  ].join("\n");
}

/** Serve the owner's one complete variance decision over every unmet checkpoint. */
function refuseAwaitingVariance(
  unmet: readonly StandingUnmetConclusion[],
  missing: readonly string[],
  confirmed: boolean,
): never {
  const ids = unmet.map((entry) => entry.id);
  const decision = confirmed
    ? `The landing decision must also cover every declared-unmet checkpoint; missing: ${
      missing.join(", ")
    }.`
    : `Landing is the owner's decision, and ${
      unmet.length === 1
        ? "one declared-unmet conclusion additionally requires"
        : `${unmet.length} declared-unmet conclusions additionally require`
    } the owner to authorize a variance.`;
  const command = `discern accept --confirmed ${
    ids.map((id) => `--variance ${id}`).join(" ")
  }`;
  refusal(
    AWAITING_VARIANCE_SLUG,
    `${decision}\n\n${
      unmet.map(serveUnmetConclusion).join("\n\n")
    }\n\nRelay each question and rationale to the owner. Once the owner ` +
      `accepts this landing AND each named variance in the current ` +
      `conversation, re-run \`${command}\`. Recorded standing and effort ` +
      `grants never authorize a variance. ${ACCEPT_NOTHING_LANDED}`,
    {
      hints: hintTexts([
        fire(HINTS["accept-authorize-variance"], { ids }),
        fire(HINTS["accept-review-via-status"]),
      ]),
    },
  );
}

/** Resolve the variance interlock, throwing the typed refusal when it stops. */
function enforceAcceptanceCheckpoints(
  state: AcceptanceCheckpointState,
  request: { confirmed: boolean; varianceIds: readonly string[] },
): AuthorizedVarianceData[] {
  const interlock = resolveVarianceInterlock(state, request);
  switch (interlock.kind) {
    case "declarations-stale":
      return refuseDeclarationsStale(interlock.ids);
    case "invalid-variances":
      return refusal(
        "invalid_value",
        `${interlock.message} ${ACCEPT_NOTHING_LANDED}`,
      );
    case "awaiting":
      return refuseAwaitingVariance(
        interlock.unmet,
        interlock.missing,
        interlock.confirmed,
      );
    case "authorized":
      return interlock.variances;
  }
}

/** Serve the exact standard-limit proposals the owner must approve by token. */
function refuseAwaitingStandardApproval(
  approvals: readonly StandardLimitApprovalRequestData[],
  confirmed: boolean,
  requested: readonly string[],
): never {
  const missing = approvals.filter((approval) =>
    !requested.includes(approval.token)
  );
  const detail = approvals.map(({ proposal, token }) =>
    `${proposal.standard}: ${proposal.trunk_limit} → ${proposal.proposed_limit} ` +
    `(measured ${proposal.measurement}; delta ${
      proposal.delta >= 0 ? "+" : ""
    }${proposal.delta})\n` +
    `  Reason: ${proposal.reason}\n` +
    `  Responsible paths: ${proposal.evidence_paths.join(", ")}\n` +
    `  Approval token: ${token}`
  ).join("\n\n");
  const command = `discern accept --confirmed ${
    approvals.map(({ token }) => `--approve-standard ${token}`).join(" ")
  }`;
  const opening = confirmed
    ? `The owner approval set is incomplete; missing: ${
      missing.map(({ proposal }) => proposal.standard).join(", ")
    }.`
    : "This Proof contains a standard limit proposal that requires a separate, exact owner decision.";
  refusal(
    "awaiting_standard_approval",
    `${opening}\n\n${detail}\n\nRelay every value and reason to the owner. ` +
      `Only after they approve these exact tuples, re-run \`${command}\`. ` +
      `If they decline, leave acceptance stopped, restore the trunk limit in ` +
      `this branch, and run \`discern done\` under ordinary enforcement. ` +
      `Standing grants, effort grants, generic landing consent, prior variances, ` +
      `and earlier standard approvals never cover this decision. ${ACCEPT_NOTHING_LANDED}`,
    {
      hints: hintTexts([fire(HINTS["accept-review-via-status"])]),
      data: {
        standard_approvals_required: approvals.map(({ proposal, token }) => ({
          proposal: cloneStandardLimitProposal(proposal),
          token,
        })),
      },
    },
  );
}

/** Resolve the current proposal authority and enforce the narrow approval set. */
async function enforceStandardLimitApprovals(
  effort: EffortCheckout,
  subject: LandingSubject,
  request: { readonly confirmed: boolean; readonly names: readonly string[] },
): Promise<StandardLimitProposalData[]> {
  const proofProposals = [...(subject.proof.standard_proposals ?? [])].sort((
    left,
    right,
  ) => left.standard.localeCompare(right.standard));
  if (subject.atHead) {
    const inspected = await inspectActiveStandardLimitProposals(
      effort.path,
      effort.trunk,
      buildStandardPlan(effort.ctx.config).standards,
    );
    const active = [...inspected.active.values()].sort((left, right) =>
      left.standard.localeCompare(right.standard)
    );
    if (!sameStandardLimitProposalSet(proofProposals, active)) {
      refusal(
        "proposal_stale",
        "The standard limit proposal record no longer matches the honored Proof. A reason change, revocation, or stale record restores ordinary enforcement. Run `discern done` to revalidate the current exact proposal; nothing has been landed.",
      );
    }
  }
  const approvals = await standardLimitApprovalRequests(proofProposals);
  const uniqueRequested = [...new Set(request.names)].sort();
  if (uniqueRequested.length !== request.names.length) {
    refusal(
      "invalid_value",
      `Duplicate --approve-standard tokens are not an exact approval set. Expected proposals: ${
        proofProposals.map((proposal) => proposal.standard).join(", ") ||
        "(none)"
      }. ${ACCEPT_NOTHING_LANDED}`,
    );
  }
  const expectedTokens = approvals.map(({ token }) => token).sort();
  const extras = uniqueRequested.filter((token) =>
    !expectedTokens.includes(token)
  );
  if (extras.length > 0) {
    refusal(
      "invalid_value",
      `--approve-standard contains a token for no current exact proposal: ${
        extras.join(", ")
      }. Current proposals: ${
        proofProposals.map((proposal) => proposal.standard).join(", ") ||
        "(none)"
      }. ${ACCEPT_NOTHING_LANDED}`,
    );
  }
  if (proofProposals.length === 0) return [];
  const missing = expectedTokens.filter((token) =>
    !uniqueRequested.includes(token)
  );
  if (!request.confirmed || missing.length > 0) {
    refuseAwaitingStandardApproval(
      approvals,
      request.confirmed,
      uniqueRequested,
    );
  }
  return proofProposals.map(cloneStandardLimitProposal);
}

/** Refuse an acceptance whose declaration binding cannot be read. */
function refuseUnreadableDeclarationEvidence(
  drops: readonly CheckpointDrop[],
): void {
  if (
    !drops.some((drop) => drop.reason === "declaration_evidence_unavailable")
  ) {
    return;
  }
  refusal(
    "checkpoint_evidence_unavailable",
    "Acceptance cannot read the checkpoint declaration evidence that the validated Proof must bind to. Nothing was landed and the worktree is intact. Restore the declaration store, run `discern done --rerun`, then retry acceptance.",
    { data: { checkpoint_drops: [...drops] } },
  );
}

/** A submission behind HEAD lands only when its Proof left no owner decision open. */
function refuseMovedOnDecisions(
  effort: EffortCheckout,
  subject: LandingSubject,
): void {
  const unmet = subject.proof.checkpoints?.declared_unmet.length ?? 0;
  const proposals = subject.proof.standard_proposals?.length ?? 0;
  if (unmet === 0 && proposals === 0) return;
  refusal(
    "precondition_failed",
    `${effort.branch} has moved on since it submitted ${
      short(subject.head)
    }, and that revision's Proof still carries ${
      unmet > 0 ? "a declared-unmet checkpoint" : "a standard limit proposal"
    }, so the owner's decision must be made in its worktree. Run discern done, then discern accept from ${effort.path}.`,
  );
}

// ── preconditions ────────────────────────────────────────────────────────────

/** Refuse acceptance while refresh still has tracked work to commit. */
function trackedRefreshAcceptRefusal(plan: TrackedRefreshPlan): string {
  const paths = plan.changes.map((change) => change.path);
  const planned = paths.length > 0
    ? ` Running \`discern refresh\` would change: ${paths.join(", ")}.`
    : "";
  const errors = plan.errors.length > 0
    ? ` The read-only refresh plan also reported: ${plan.errors.join("; ")}.`
    : "";
  return "This branch's tracked refresh convergence is not proved." +
    planned + errors +
    " Nothing was landed and the worktree is intact. Run `discern refresh`, " +
    "review and commit the named files, run `discern done`, then re-run " +
    "`discern accept`.";
}

/** The landing's projected steps for one effort, from its own configuration. */
export function landingPlan(
  effort: EffortCheckout,
  ignoredFileChanges: AcceptPlan["ignoredFileChanges"],
): AcceptPlan {
  return {
    worktreeBranch: effort.branch,
    worktreePath: effort.path,
    mainRepo: effort.mainRepo,
    trunk: effort.trunk,
    proofNotes: effort.ctx.config.repository.proof_notes,
    repositoryEnsureSteps: effort.ctx.config.repository.ensure,
    smokeSteps: planStageJobs(effort.ctx.config, "test")
      .filter((job) =>
        job.kind === "known" && /^smoke(?:#\d+)?$/.test(job.label)
      )
      .map((job) => ({
        label: job.label,
        command: job.command,
        ...(job.timeout !== undefined ? { timeout: job.timeout } : {}),
      })),
    hasResources: readResourceSpecs(effort.ctx.config).length > 0,
    ignoredFileChanges,
  };
}

/** The read-only diagnosis an acceptance acts on. A landing that will
 * compose in an integration worktree skips the author-side currency checks:
 * the frozen submission is re-proven on the combined tree, and the author's
 * checkout may legitimately be behind or mid-edit. */
async function buildAcceptPlan(
  effort: EffortCheckout,
  subject: LandingSubject,
  direct: boolean,
): Promise<AcceptPlan> {
  if (subject.atHead) {
    if (
      (await registeredWorktreeRecord(effort.path, effort.mainRepo))?.locked ===
        true
    ) {
      throw new WorktreeGitError(
        `This worktree is locked (git worktree lock), and acceptance removes the worktree after landing. Unlock it first (git worktree unlock ${effort.path}), then re-run discern accept.`,
      );
    }
  }
  if (subject.atHead && direct) {
    const merged = await assertResolvedTrunkMerged(effort.path, effort.trunk);
    if (merged.kind === "behind") refuseTrunkMoved(effort);
    if (merged.kind === "missing") {
      throw new WorktreeGitError(
        `${
          missingIntegrationBranchWarning(merged.branch)
        } Acceptance will not remove this worktree until the merge check can run.`,
      );
    }
    const trackedRefresh = await planTrackedRefresh(
      effort.path,
      effort.ctx.config,
    );
    if (trackedRefresh.changes.length > 0 || trackedRefresh.errors.length > 0) {
      throw new WorktreeGitError(trackedRefreshAcceptRefusal(trackedRefresh));
    }
  }
  const ignoredFileChanges = await inspectIgnoredFileChanges(
    effort.path,
    effort.ctx.config.worktree.ignored_file_drift,
  );
  await assertMainCheckoutReady(effort);
  return landingPlan(effort, ignoredFileChanges);
}

// ── progress and partial effects ─────────────────────────────────────────────

/** No effect has happened yet. */
function freshAcceptLandingState(): AcceptLandingState {
  return {
    recovery_performed: false,
    trunk_landed: false,
    worktree_removed: false,
    branch_deleted: false,
  };
}

export interface AcceptExecutionProgress {
  readonly steps: StepResult[];
  readonly landing: AcceptLandingState;
  readonly scopesChanged: string[];
  gateValidation?: NonNullable<AcceptData["gate_validation"]>;
  proofMarkdown?: string;
  proofLine?: string;
  proofNote?: AcceptProofNoteData;
  readonly convergenceHints: string[];
  readonly diagnostics: Diagnostic[];
  readonly authorityWarnings: string[];
}

/** The mutable record of what a landing has done so far, for results and partial reports. */
export function freshAcceptExecutionProgress(
  steps: StepResult[] = [],
  scopesChanged: string[] = [],
): AcceptExecutionProgress {
  return {
    steps,
    landing: freshAcceptLandingState(),
    scopesChanged,
    convergenceHints: [],
    diagnostics: [],
    authorityWarnings: [],
  };
}

/** Whether any irreversible effect has been recorded. */
function landingHasEffects(landing: AcceptLandingState): boolean {
  return landing.recovery_performed || landing.trunk_landed ||
    landing.worktree_removed || landing.branch_deleted;
}

/** Represent journal reconciliation as an ordinary acceptance step result. */
function recoveryStep(outcome: StepOutcome): StepResult {
  return {
    step: {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.recoverInterruptedAcceptance,
      disposition: "run",
      note:
        "complete or roll back the recorded transaction before any new landing",
    },
    outcome,
  };
}

// ── journal recovery ─────────────────────────────────────────────────────────

/**
 * Reconcile an interrupted transaction before any new landing. Returns the
 * recovery steps when ordinary acceptance may continue; throws the partial
 * result when the recorded transaction landed or stopped.
 */
async function recoverInterruptedJournal(
  effort: EffortCheckout,
  authority: LandingAuthorityResolution,
  confirmed: boolean,
  env: Pick<typeof Deno.env, "get">,
): Promise<StepResult[]> {
  const interrupted = await inspectInterruptedAcceptance(
    effort.path,
    effort.trunk,
  );
  if (interrupted.kind !== "recorded") return [];
  const recoveryConsent = interrupted.consent ??
    availableLandingConsent(authority, confirmed);
  if (recoveryConsent === undefined) refuseAwaitingConsent(authority, false);
  const recovered = await recoverInterruptedAcceptance(
    effort.path,
    interrupted,
  );
  // A recorded integration copy is settled with its transaction: obsolete
  // after a proven pre-CAS rollback, and landed after a durable CAS. The
  // ambiguous arms keep it for inspection; `discern worktree prune` reclaims
  // it once its owner is gone.
  const recordedIntegration = interrupted.transaction.integration;
  if (
    recordedIntegration !== undefined &&
    (recovered.kind === "ready" || recovered.trunkLanded)
  ) {
    const failures = await removeIntegrationWorktree(
      interrupted.transaction.main_repo,
      {
        worktree: {
          id: recordedIntegration.worktree_id,
          branch: recordedIntegration.worktree_branch,
          path: recordedIntegration.worktree_path,
        },
      },
      effort.ctx.log,
    );
    for (const failure of failures) {
      effort.ctx.log.warn(
        `Interrupted-integration cleanup: ${failure}. Run discern worktree prune from ${interrupted.transaction.main_repo}.`,
      );
    }
  }
  const progress = freshAcceptExecutionProgress([
    recoveryStep(
      recovered.kind === "ready" || recovered.recoveryPerformed
        ? "ok"
        : "failed",
    ),
  ]);
  progress.landing.recovery_performed = recovered.recoveryPerformed;
  if (recovered.kind === "stopped") {
    progress.landing.trunk_landed = recovered.trunkLanded;
    if (recovered.trunkLanded) {
      // The journal's own Proof pointer wins: an integrated landing's Proof
      // never lived in this worktree's gate marker.
      let pointed: Proof | undefined;
      if (interrupted.transaction.proof !== undefined) {
        try {
          pointed = await readProofPresentation(
            effort.path,
            interrupted.transaction.proof,
          );
        } catch {
          // discern-best-effort: accept-recovery-proof-pointer-fallback
          pointed = undefined;
        }
      }
      const recoveredProof = await inspectGateProof(effort.path);
      const matching = pointed ??
        (recoveredProof.status === "honored" &&
            recoveredProof.head === interrupted.transaction.target
          ? recoveredProof.proof_data
          : undefined);
      const recording = await recordLandingProofNote({
        mainRepo: interrupted.transaction.main_repo,
        commit: interrupted.transaction.target,
        mode: effort.ctx.config.repository.proof_notes,
        proof: matching,
        checkpointDrops: uniqueCheckpointDrops([
          ...(matching?.checkpoint_drops ?? []),
          ...(recoveredProof.checkpoint_drops ?? []),
        ]),
        consent: interrupted.transaction.consent,
        variances: interrupted.transaction.variances,
        standardProposals: interrupted.transaction.standard_proposals,
        log: effort.ctx.log,
        env,
      });
      progress.steps.push(...recording.steps);
      progress.proofNote = recording.proofNote;
      progress.convergenceHints.push(...recording.hints);
      if (matching !== undefined) {
        if (pointed === undefined && recoveredProof.status === "honored") {
          progress.gateValidation = { mode: "proof", proof: recoveredProof };
        }
        if (matching.markdown !== "") {
          progress.proofMarkdown = matching.markdown;
        }
        if (matching.line !== "") {
          progress.proofLine = renderLandingProofLine(
            matching.line,
            interrupted.transaction.consent,
            {
              ...(interrupted.transaction.standard_proposals.length > 0
                ? { proposals: interrupted.transaction.standard_proposals }
                : {}),
              ...(interrupted.transaction.variances.length > 0 &&
                  matching.checkpoints !== undefined
                ? { checkpoints: matching.checkpoints }
                : {}),
            },
          );
        }
      }
      // Consumption is exact: with a recorded submission id, only that
      // submission is spent; a replacement recorded before this retry
      // survives the older transaction's settling.
      if (interrupted.transaction.submission_id === undefined) {
        await clearSubmission(effort.path);
      } else {
        await clearSubmissionIfCurrent(
          effort.path,
          interrupted.transaction.submission_id,
        );
      }
    }
    if (recovered.recoveryPerformed || recovered.trunkLanded) {
      throwPartialAcceptance(
        interrupted.transaction.main_repo,
        recoveryConsent,
        progress,
        recovered.message,
      );
    }
    throw new WorktreeGitError(recovered.message);
  }
  return progress.steps;
}

// ── the landing ──────────────────────────────────────────────────────────────

/** What the cleanup tail found in the effort's checkout after the landing. */
/** The first paragraph of a completed landing: the branch, what happened, one next command. */
export function landedMessage(
  effort: EffortCheckout,
  landed: string,
  disposition: CleanupDisposition,
): string {
  const lead = `Landed ${effort.branch} at ${short(landed)} on ${effort.trunk}`;
  switch (disposition.kind) {
    case "removed":
      return `${lead}; its checkout, branch, and resources are gone. You are on ${effort.trunk} in ${effort.mainRepo}.`;
    case "resources-remain":
      return `${lead}, but resource teardown failed for ${
        disposition.failed.join(", ")
      }: run discern worktree prune from ${effort.mainRepo} after fixing the failed destroy command. Its checkout and branch are gone, and you are on ${effort.trunk} in ${effort.mainRepo}.`;
    case "later-commits":
      return `${lead}; the branch holds later commits, so its checkout and branch stay. Run discern done, then discern accept from ${effort.path} for them.`;
    case "uncommitted-changes":
      return `${lead}; the checkout has uncommitted changes, so it and its branch stay. Commit them, then run discern done, then discern accept from ${effort.path}.`;
  }
}

/** Apply the landing after every read-only decision has been made. */
async function executeLanding(
  effort: EffortCheckout,
  subject: LandingSubject,
  plan: AcceptPlan,
  authority: LandingAuthorityResolution,
  consent: LandingConsent,
  variances: readonly AuthorizedVarianceData[],
  standardProposals: readonly StandardLimitProposalData[],
  progress: AcceptExecutionProgress,
  signal: AbortSignal | undefined,
  env: Pick<typeof Deno.env, "get">,
): Promise<{
  readonly message: string;
  readonly proofLine?: string;
  readonly landedCommit: string;
  readonly integrated: boolean;
}> {
  const { mainRepo, trunk } = effort;
  const log = effort.ctx.log;
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

  // Re-check every live decision immediately before the transition: the
  // declarations, proposals, and authority a landing rests on must be the ones
  // the owner decided over.
  let accumulatedDrops = [...subject.drops];
  let abandonedOpenQuestions: { id: string }[] = [];
  if (subject.atHead) {
    const checkpointsNow = await inspectAcceptanceCheckpoints(
      effort.path,
      effort.ctx.config,
    );
    accumulatedDrops = uniqueCheckpointDrops([
      ...accumulatedDrops,
      ...checkpointsNow.drops,
    ]);
    refuseUnreadableDeclarationEvidence(accumulatedDrops);
    if (
      accumulatedDrops.some(isIndeterminateStopDrop) &&
      consent.source !== "conversation"
    ) {
      refusal(
        AWAITING_CONSENT_SLUG,
        "A stop checkpoint's executable condition was indeterminate, so this landing requires the owner's current-conversation attestation. Recorded grants do not cover it. Nothing was landed and the worktree is intact. Review the checkpoint drop, then re-run `discern accept --confirmed` in this conversation.",
        {
          data: { checkpoint_drops: accumulatedDrops },
          hints: hintTexts([fire(HINTS["accept-awaiting-confirmation"])]),
        },
      );
    }
    const bindingKey = (v: AuthorizedVarianceData): string =>
      [v.checkpoint, v.definition_hash, v.subject, v.why].join("\0");
    const live = checkpointsNow.unmet.map((unmet) =>
      bindingKey(varianceBinding(unmet))
    ).sort();
    const authorized = variances.map(bindingKey).sort();
    if (
      checkpointsNow.stale.length > 0 ||
      JSON.stringify(live) !== JSON.stringify(authorized)
    ) {
      throw new WorktreeGitError(
        "The checkpoint conclusions changed while this acceptance was running, so the recorded authorization no longer matches the declarations it covered. Nothing was landed and the worktree is intact. Re-run `discern accept` so the decision is made against the current conclusions.",
      );
    }
    const read = await readOpenQuestions(effort.path);
    if (read.status === "ok") {
      abandonedOpenQuestions = Object.values(read.openQuestions)
        .filter((openQuestion) =>
          openQuestion.declaration === undefined ||
          !declarationIsCurrent(openQuestion)
        )
        .map((openQuestion) => ({ id: openQuestion.checkpoint }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    const liveProposals = await inspectActiveStandardLimitProposals(
      effort.path,
      trunk,
      buildStandardPlan(effort.ctx.config).standards,
    );
    if (
      !sameStandardLimitProposalSet(
        [...liveProposals.active.values()],
        standardProposals,
      )
    ) {
      refusal(
        "proposal_stale",
        `The standard limit proposal was changed, revoked, or made stale after validation. No trunk ref moved. Run \`discern done\` and obtain exact owner approval for the current tuple before retrying. ${ACCEPT_NOTHING_LANDED}`,
      );
    }
  }
  await assertMainCheckoutReady(effort);
  const tipRun = await runGit(
    ["rev-parse", "--verify", `refs/heads/${effort.branch}^{commit}`],
    { cwd: mainRepo },
  );
  const tipNow = tipRun.success ? tipRun.stdout.trim() : "";
  if (
    subject.atHead
      ? tipNow !== subject.head
      : !(await commitIsAncestorOf(mainRepo, subject.head, tipNow))
  ) {
    throw new WorktreeGitError(
      `Branch '${effort.branch}' moved while this acceptance was running, so the tree that would land is not the tree its Proof vouches for. ${ACCEPT_NOTHING_LANDED} Re-run \`discern done\` on the final commit from ${effort.path}, then \`discern accept\` again.`,
    );
  }
  const expectedTrunk = candidatePredecessor(subject.complete.candidate);
  let proofLine = subject.proofLine;
  if (proofLine !== undefined) {
    proofLine = renderLandingProofLine(proofLine, consent, {
      ...(standardProposals.length > 0 ? { proposals: standardProposals } : {}),
      ...(variances.length > 0 && subject.proof.checkpoints !== undefined
        ? { checkpoints: subject.proof.checkpoints }
        : {}),
    });
    progress.proofLine = proofLine;
  }
  if (subject.proofMarkdown !== undefined) {
    progress.proofMarkdown = subject.proofMarkdown;
  }

  log.heading("Acceptance plan");
  log.detail(`Branch:        ${effort.branch}`);
  log.detail(`From worktree: ${effort.path}`);
  log.detail(
    `Into trunk:    ${mainRepo} (fast-forward ${trunk} to ${
      short(subject.head)
    })`,
  );
  log.detail(
    `Authority:     ${
      landingAuthorityDetail(authority, consent.source === "conversation")
    }`,
  );
  for (const warning of authority.warnings) log.warn(warning);

  log.info(`Fast-forwarding ${trunk} to ${effort.branch}…`);
  const transition = await performAcceptanceTransition(effort.path, {
    mainRepo,
    trunk,
    worktreeBranch: effort.branch,
    expectedTrunk,
    target: subject.head,
    effortClaim: consent.source === "effort-grant",
    ...(authority.effortGrant === undefined
      ? {}
      : { grantId: authority.effortGrant.id }),
    ...(subject.submission === undefined
      ? {}
      : { submissionId: subject.submission.id }),
    proof: {
      candidate_id: subject.complete.candidate_id,
      proof_id: subject.complete.proof_id,
    },
    consent,
    variances,
    standardProposals,
  });
  if (transition.kind === "authority-changed") {
    const detail = transition.claim.status === "invalid" ||
        transition.claim.status === "newer" ||
        transition.claim.status === "unavailable"
      ? `: ${transition.claim.reason}`
      : "";
    throw new WorktreeGitError(
      `Landing authority changed at the fast-forward boundary: the effort grant could not be claimed${detail}. ${ACCEPT_NOTHING_LANDED} Re-authorize it from the desk, then re-run \`discern accept\`.`,
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
  const settlementClause = settlementWarning === undefined
    ? ""
    : ` ${settlementWarning}`;
  if (ff.kind !== "updated") {
    if (ff.kind === "dirty") {
      const statusCommand = commandEvidence([
        "git",
        "-C",
        mainRepo,
        "status",
        "--short",
      ]);
      throw new WorktreeGitError(
        `The main checkout at ${mainRepo} changed or could not be proved clean at the landing boundary, so discern refused before moving ${trunk}. Inspect it with \`${statusCommand}\`, preserve or clear the reported state, then re-run \`discern accept\`. The worktree and its resources are intact. Git said: ${ff.detail}${settlementClause}`,
      );
    }
    if (ff.kind === "checkout-failed" && !ff.rolledBack) {
      progress.landing.trunk_landed = true;
      throw new WorktreeGitError(
        `discern atomically advanced ${trunk} to ${subject.head}, but Git could not converge the checked-out files and could not restore the old ref. Stop and inspect ${mainRepo} before doing more work. Git said: ${ff.detail}${settlementClause}`,
      );
    }
    const checkoutDetail = ff.kind === "checkout-failed"
      ? " Git restored the old trunk ref after checkout convergence failed."
      : "";
    throw new WorktreeGitError(
      `The trunk moved while this landing ran; re-run discern accept from ${effort.path} — it composes and checks the moved trunk in an integration worktree before landing.${checkoutDetail} Your worktree is fully intact, resources included, and your commits are safe on ${effort.branch}. Git said: ${ff.detail}${settlementClause}`,
    );
  }
  progress.landing.trunk_landed = true;
  observeCheckpointActivity({
    variances: variances.map((variance) => ({
      id: variance.checkpoint,
      definition: variance.definition_hash,
      subject: variance.subject,
    })),
    abandoned: abandonedOpenQuestions,
  });
  log.ok(`${trunk} fast-forwarded to ${effort.branch} at ${mainRepo}.`);
  progress.steps.push({
    step: {
      kind: "git",
      label: BUILT_IN_STEP_LABELS.fastForwardTrunk,
      disposition: "run",
    },
    outcome: "ok",
  });
  const postTransitionStepStart = progress.steps.length;

  // The trunk now names the proven commit. Everything below fails open: the
  // landing is durable and no recording, convergence, or cleanup step may
  // roll it back or turn the landing itself red.
  const recording = await recordLandingProofNote({
    mainRepo,
    commit: subject.head,
    mode: plan.proofNotes,
    proof: subject.proof,
    checkpointDrops: accumulatedDrops,
    consent,
    variances,
    standardProposals,
    log,
    env,
  });
  progress.proofNote = recording.proofNote;
  progress.steps.push(...recording.steps);
  progress.convergenceHints.push(...recording.hints);

  await convergeMainCheckout(effort, plan, progress, signal);

  // The submission is consumed and the grant spent by this landing, whether
  // or not the checkout stays for later commits. Consumption is exact: a
  // replacement submission recorded since the snapshot survives settling.
  if (subject.submission === undefined) {
    await clearSubmission(effort.path);
  } else {
    await clearSubmissionIfCurrent(effort.path, subject.submission.id);
  }
  try {
    await clearEffortGrant(effort.path);
  } catch (error) {
    log.warn(
      `Could not clear the consumed effort grant: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const disposition = await cleanUpEffort(effort, subject.head, progress);
  // A kept checkout outlives its transaction. Once every post-transition step
  // settled, the journal is a spent retry vehicle and must not send the next
  // accept into recovery; while any step remains failed, the journal stays so
  // a retry can finish it. The journal is worktree-scoped state, so only the
  // dispositions that keep the checkout (later commits, uncommitted changes)
  // have a journal left to settle — `removed` and `resources-remain` deleted
  // the checkout, and its journal went with it.
  if (
    cleanupKeepsCheckout(disposition) &&
    progress.steps
      .slice(postTransitionStepStart)
      .every((entry) => entry.outcome !== "failed") &&
    !(await clearCompletedAcceptanceJournal(effort.path, subject.head))
  ) {
    log.warn(
      "Could not retire the completed landing's recovery journal; the next accept will verify it before landing new work.",
    );
  }
  const message = landedMessage(effort, subject.head, disposition);
  log.heading("Acceptance complete.");
  log.line(`  ${message}`);
  return {
    message,
    landedCommit: subject.head,
    integrated: false,
    ...(proofLine === undefined ? {} : { proofLine }),
  };
}

// ── the verb ─────────────────────────────────────────────────────────────────

/** Build the read-only preview for `--dry-run`. */
async function previewLanding(
  effort: EffortCheckout,
  subject: LandingSubject,
  plan: AcceptPlan,
  authority: LandingAuthorityResolution,
  confirmed: boolean,
  drops: CheckpointDrop[],
  direct: boolean,
): Promise<DiscernResult<AcceptData>> {
  const enginePlan = acceptPlanToEngine(plan);
  const checkpointState = subject.atHead
    ? await inspectAcceptanceCheckpoints(effort.path, effort.ctx.config)
    : undefined;
  const allDrops = uniqueCheckpointDrops([
    ...drops,
    ...(checkpointState?.drops ?? []),
  ]);
  enginePlan.details.push(
    `Lands:         ${short(subject.head)}${
      subject.atHead
        ? ""
        : " (an earlier submission; the checkout and branch stay)"
    }`,
    ...(direct ? [] : [
      `Integrates:    the trunk moved after this Proof, so acceptance composes the submission with ${effort.trunk} in a disposable integration worktree, proves the combined tree, and lands that exact commit`,
    ]),
    `Authority:     ${landingAuthorityDetail(authority, confirmed)}`,
    ...authority.warnings.map((warning) => `Authority warning: ${warning}`),
    ...(checkpointState !== undefined && checkpointState.stale.length > 0
      ? [
        `Checkpoints:   conclusions missing or stale (route to done): ${
          checkpointState.stale.join(", ")
        }`,
      ]
      : []),
    ...(checkpointState?.unmet ?? []).map((unmet) =>
      `Checkpoints:   '${unmet.id}' declared unmet — owner variance required to land`
    ),
    ...checkpointDropAccounts(checkpointState?.drops ?? []).map((advisory) =>
      `Checkpoint advisory: ${advisory}`
    ),
    ...(subject.proof.standard_proposals ?? []).map((proposal) =>
      `Standard owner decision: ${proposal.standard} ${proposal.trunk_limit} → ${proposal.proposed_limit}; reason: ${proposal.reason}`
    ),
  );
  const rows = await submissionRows(effort.mainRepo, effort.trunk);
  if (rows.length > 0) {
    enginePlan.details.push(
      "Landing queue:",
      ...queueLines(rows).map((line) => `  ${line}`),
    );
  }
  const preview: DiscernResult<AcceptData> = previewResult(
    "accept",
    enginePlan,
  );
  if (allDrops.length > 0) preview.data = { checkpoint_drops: allDrops };
  return preview;
}

/** The decisions an apply commits to before any effect. */
export interface LandingDecision {
  readonly authority: LandingAuthorityResolution;
  readonly consent: LandingConsent;
  readonly variances: AuthorizedVarianceData[];
  readonly standardProposals: StandardLimitProposalData[];
  readonly drops: CheckpointDrop[];
}

/**
 * Decide the landing: the checkpoint contract first (a missing or stale
 * declaration routes back to `done`; a declared-unmet conclusion serves the
 * owner's one complete decision), then exact standard approvals, then consent.
 */
async function decideLanding(
  effort: EffortCheckout,
  subject: LandingSubject,
  authority: LandingAuthorityResolution,
  request: AcceptRequest,
): Promise<LandingDecision> {
  let drops = [...subject.drops];
  let variances: AuthorizedVarianceData[] = [];
  if (subject.atHead) {
    const checkpointState = await inspectAcceptanceCheckpoints(
      effort.path,
      effort.ctx.config,
    );
    drops = uniqueCheckpointDrops([...drops, ...checkpointState.drops]);
    refuseUnreadableDeclarationEvidence(drops);
    for (const advisory of checkpointDropAccounts(checkpointState.drops)) {
      effort.ctx.log.warn(advisory);
    }
    variances = enforceAcceptanceCheckpoints(checkpointState, {
      confirmed: request.confirmed,
      varianceIds: request.variance,
    });
  } else {
    refuseMovedOnDecisions(effort, subject);
  }
  const standardProposals = await enforceStandardLimitApprovals(
    effort,
    subject,
    { confirmed: request.confirmed, names: request.approveStandard },
  );
  // A variance or a standard approval forces current-conversation consent; an
  // owner landing a never-submitted revision decides in conversation too. A
  // submission is exact: recorded grants cover only a subject whose head IS
  // the recorded submission's head, so a later green revision the agent never
  // submitted — even at the checkout's HEAD — stays the owner's explicit
  // decision.
  const explicitUnsubmitted = effort.explicit &&
    (subject.submission === undefined ||
      subject.submission.head !== subject.head);
  let consent: LandingConsent;
  if (
    variances.length > 0 || standardProposals.length > 0 || explicitUnsubmitted
  ) {
    if (!request.confirmed) {
      if (explicitUnsubmitted) {
        const submitted = subject.submission;
        refusal(
          AWAITING_CONSENT_SLUG,
          submitted === undefined
            ? `${effort.branch} has a green run its agent never submitted, so only the owner lands it: decide in conversation, then re-run discern accept --target ${effort.branch} --confirmed. Recorded grants do not cover an unsubmitted revision. ${ACCEPT_NOTHING_LANDED}`
            : `${effort.branch} has a green run at ${
              short(subject.head)
            } its agent never submitted — its recorded submission names ${
              short(submitted.head)
            } — so only the owner lands it: decide in conversation, then re-run discern accept --target ${effort.branch} --confirmed. Recorded grants cover only the submitted revision. ${ACCEPT_NOTHING_LANDED}`,
          {
            hints: hintTexts([
              fire(HINTS["accept-awaiting-confirmation"]),
              fire(HINTS["accept-review-via-status"]),
            ]),
          },
        );
      }
      refuseAwaitingConsent(authority, subject.submission !== undefined);
    }
    consent = { source: "conversation" };
  } else {
    consent = availableLandingConsent(authority, request.confirmed) ??
      refuseAwaitingConsent(authority, !effort.explicit);
  }
  return { authority, consent, variances, standardProposals, drops };
}

/** Name the landing this call queues behind, from the operation journal, and
 * report the wait as progress. Advisory: an unreadable journal degrades to the
 * plain sentence, never to a refusal. */
/** The landing-turn wait before the journal names the holder. */
function landingTurnWait(): WaitDetails {
  return {
    kind: "landing-turn",
    reason: "Waiting behind another landing for the landing boundary.",
    next: "This call resumes automatically when its turn arrives.",
  };
}

/** Refresh the landing-turn wait with the running landing's identity and
 * reconnect handle, read from the operation journal. */
async function landingTurnWaitBehind(
  effort: EffortCheckout,
): Promise<WaitDetails> {
  try {
    const reading = await readOperationJournal(effort.mainRepo);
    const running = reading.kind === "found"
      ? { ...reading.record.operation, handle: reading.handle }
      : reading.kind === "elsewhere"
      ? reading.newest
      : undefined;
    if (running !== undefined) {
      return {
        kind: "landing-turn",
        reason: `Waiting behind \`${running.verb}\` on ${
          running.branch ?? running.path
        } for the landing boundary.`,
        next:
          `This call resumes automatically when its turn arrives; read that run with \`discern progress ${running.handle}\`.`,
      };
    }
  } catch {
    // discern-best-effort: accept-landing-wait-journal-fallback
  }
  return landingTurnWait();
}

/**
 * Submit and land under the effort's acceptance lock. The apply path recovers
 * an interrupted transaction first, then decides and lands once.
 */
/**
 * Decide and perform one effort's landing — the shared core behind the
 * caller's own landing and every further landing the queue walk attempts.
 * The caller holds the acceptance boundary for `effort.path`.
 */
async function landEffortOnce(
  effort: EffortCheckout,
  request: AcceptRequest,
  env: Pick<typeof Deno.env, "get">,
  operationHandle?: string,
): Promise<DiscernResult<AcceptData>> {
  {
    let authority = await inspectLandingAuthority(effort.path, effort.trunk, {
      includeScopeEvidence: true,
    });
    const recoverySteps = request.dryRun ? [] : await recoverInterruptedJournal(
      effort,
      authority,
      request.confirmed,
      env,
    );
    if (recoverySteps.length > 0) {
      authority = await inspectLandingAuthority(effort.path, effort.trunk, {
        includeScopeEvidence: true,
      });
    }
    const resolved = await resolveSubject(effort);
    if (resolved === undefined) refuseNothingProven(effort);
    let subject = resolved;
    if (!request.dryRun && !effort.explicit) {
      subject = { ...subject, submission: await submit(effort, subject) };
    }
    const tip = await trunkTip(effort);
    // Ancestry decides the shape, not queue length: the submission's honored
    // Proof names the current tip → 1A's direct fast-forward; a moved trunk
    // composes and re-proves in a disposable integration worktree.
    const direct = candidatePredecessor(subject.complete.candidate) === tip;
    if (direct) {
      authority = subjectAuthority(authority, subject);
    }
    const plan = await buildAcceptPlan(effort, subject, direct);
    if (request.dryRun) {
      return await previewLanding(
        effort,
        subject,
        plan,
        authority,
        request.confirmed,
        subject.drops,
        direct,
      );
    }
    const decision = await decideLanding(effort, subject, authority, request);
    // An owner explicitly accepting a proven but unsubmitted revision submits
    // it through this route; the landing then consumes exactly that record.
    if (
      subject.submission === undefined ||
      subject.submission.head !== subject.head
    ) {
      subject = { ...subject, submission: await submit(effort, subject) };
    }
    const progress = freshAcceptExecutionProgress(
      recoverySteps,
      changedLandingScopes(decision.authority),
    );
    if (recoverySteps.length > 0) progress.landing.recovery_performed = true;
    try {
      const landed = direct
        ? await executeLanding(
          effort,
          subject,
          plan,
          decision.authority,
          decision.consent,
          decision.variances,
          decision.standardProposals,
          progress,
          request.signal,
          env,
        )
        : await executeIntegrationLanding(
          effort,
          subject,
          plan,
          decision,
          progress,
          tip,
          request,
          env,
          operationHandle,
        );
      const result: DiscernResult<AcceptData> = appliedResult(
        "accept",
        progress.steps,
        progress.diagnostics,
      );
      result.message = landed.message;
      const selfOutcome: LandingOutcomeData = {
        effort: effort.id,
        branch: effort.branch,
        head: subject.head,
        selected: true,
        status: "landed",
        landed_commit: landed.landedCommit,
        ...(landed.integrated ? { integrated: true } : {}),
        consent: cloneLandingConsent(decision.consent),
        ...(landed.proofLine === undefined
          ? {}
          : { proof_line: landed.proofLine }),
      };
      result.data = {
        ...progressData(effort.mainRepo, decision.consent, progress),
        landings: [selfOutcome],
        ...(decision.drops.length === 0
          ? {}
          : { checkpoint_drops: [...decision.drops] }),
        ...(decision.variances.length === 0
          ? {}
          : { variances: decision.variances.map((v) => ({ ...v })) }),
        ...(decision.standardProposals.length === 0 ? {} : {
          standard_approvals: decision.standardProposals.map(
            cloneStandardLimitProposal,
          ),
        }),
        ...(decision.authority.warnings.length > 0
          ? {
            authority_warnings: [
              ...decision.authority.warnings,
              ...progress.authorityWarnings,
            ],
          }
          : {}),
        ...(hasIgnoredFileChanges(plan.ignoredFileChanges)
          ? { ignored_file_changes: plan.ignoredFileChanges }
          : {}),
      };
      result.hints = landed.proofLine !== undefined
        ? mergeHintTexts(
          hintTexts([fire(HINTS["accept-relay-landing-proof"])]),
          progress.convergenceHints,
        )
        : progress.convergenceHints;
      return result;
    } catch (error) {
      if (
        error instanceof WorktreeResultError &&
        error.result.error === "partial_acceptance"
      ) {
        throw error;
      }
      if (landingHasEffects(progress.landing)) {
        throwPartialAcceptance(
          effort.mainRepo,
          decision.consent,
          progress,
          error instanceof Error ? error.message : String(error),
        );
      }
      if (error instanceof WorktreeResultError) {
        if (decision.drops.length > 0 && error.result.data === undefined) {
          error.result.data = { checkpoint_drops: [...decision.drops] };
        }
      }
      throw error;
    }
  }
}

/** The settled result when a preceding landing already landed the submission
 * this call entered with; the call verifies and changes nothing. */
async function settledByPredecessor(
  effort: EffortCheckout,
  preWait: SubmissionRead,
): Promise<DiscernResult<AcceptData> | undefined> {
  if (preWait.status !== "submitted") return undefined;
  const now = await readSubmission(effort.path);
  if (now.status === "submitted" || now.status === "invalid") return undefined;
  const frozen = preWait.submission;
  if (
    !(await commitIsMerged(effort.mainRepo, frozen.head, effort.trunk))
  ) return undefined;
  const checkoutGone = !(await targetExists(effort.path));
  const message = `${effort.branch}'s submission ${
    short(frozen.head)
  } already landed on ${effort.trunk} through a preceding landing; this call verified that outcome and changed nothing.${
    checkoutGone
      ? " Its checkout and branch were already cleaned up."
      : ` Run discern status from ${effort.path} for what remains there.`
  }`;
  return {
    ok: true,
    verb: "accept",
    message,
    data: {
      root: effort.mainRepo,
      landing: {
        recovery_performed: false,
        trunk_landed: true,
        worktree_removed: checkoutGone,
        branch_deleted: checkoutGone,
      },
      landings: [{
        effort: effort.id,
        branch: effort.branch,
        head: frozen.head,
        selected: true,
        status: "landed",
        reason:
          "A preceding landing already landed this exact submission; nothing was checked, consumed, or cleaned up twice.",
      }],
    },
  };
}

/** Project one effort's settled landing result onto its walk outcome row. */
/**
 * Submit and land under the effort's acceptance lock. The apply path recovers
 * an interrupted transaction first, then decides and lands once; an explicit
 * selection walks the remaining queue afterwards.
 */
async function landingResult(
  ctx: LifecycleContext,
  request: AcceptRequest,
  operationHandle?: string,
  env: Pick<typeof Deno.env, "get"> = Deno.env,
): Promise<DiscernResult<AcceptData>> {
  await assertProjectRootIsRepoToplevel(ctx, "accept");
  const effort = await effortCheckout(ctx, request.target);
  if (effort === undefined) {
    return await refuseFromMainCheckout(
      ctx,
      integrationBranch(ctx.config.repository.trunk),
      request.dryRun,
    );
  }
  // The submission this call enters with, read before any wait: after the
  // boundary is acquired, a preceding queue walk may already have landed it.
  const preWait = request.dryRun
    ? { status: "missing" as const }
    : await readSubmission(effort.path);
  const body = async (): Promise<DiscernResult<AcceptData>> => {
    const settled = await settledByPredecessor(effort, preWait);
    if (settled !== undefined) return settled;
    if (!(await targetExists(effort.path))) {
      throw new WorktreeGitError(
        `The worktree at ${effort.path} is gone. Run discern status from ${effort.mainRepo} to see what remains.`,
      );
    }
    const selected = await landEffortOnce(
      effort,
      request,
      env,
      operationHandle,
    );
    if (request.dryRun || !selected.ok || !effort.explicit) return selected;
    return await walkQueue(
      ctx,
      effort,
      selected,
      request,
      env,
      { effortCheckout, landEffortOnce },
      operationHandle,
    );
  };
  if (request.dryRun) return await body();
  // A second accept waits its turn behind a running landing and resumes on
  // its own against the resulting trunk; the caller's signal cancels the
  // wait. The pause reports through the shared wait lifecycle, refreshed
  // with the running landing's reconnect handle once the journal names it.
  return await withProgressWait(
    (turn) =>
      withAcceptanceTransactionLock(effort.path, async () => {
        turn.end(
          "resumed",
          "The landing boundary is available; this landing continues.",
          "No action is needed.",
        );
        return await body();
      }, {
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        onContended: () => {
          turn.update(landingTurnWait());
          detachPromise(
            "accept-landing-wait-report",
            async () => turn.update(await landingTurnWaitBehind(effort)),
            globalThis.reportError,
          );
        },
      }),
    request.signal === undefined ? {} : { signal: request.signal },
  );
}

/**
 * The CLI, MCP, and desk share this result. A dry run previews and stays out
 * of the operation journal; a landing is a long operation with a reconnect
 * handle.
 */
export async function acceptLandingResult(
  ctx: LifecycleContext,
  request: AcceptRequest,
): Promise<DiscernResult<AcceptData>> {
  const run = async (
    operationHandle?: string,
  ): Promise<DiscernResult<AcceptData>> => {
    const result = await landingResult(ctx, request, operationHandle);
    if (result.ok || hasRegisteredActionableHint(result.hints)) return result;
    return {
      ...result,
      hints: mergeHintTexts(
        result.hints ?? [],
        hintTexts([
          fire(HINTS["completion-pending"], {
            action: result.message ??
              "Run discern status from the effort's worktree and follow its next action before retrying acceptance.",
          }),
        ]),
      ),
    };
  };
  if (request.dryRun) return await run();
  return await observedGateOperation(
    ctx.cwd,
    "accept",
    request.signal,
    (_presenter, handle) => run(handle),
    (value) => value,
  );
}

/** The terminal verb: run the landing and render its result. */
export async function acceptLanding(
  ctx: LifecycleContext,
  request: AcceptRequest & { readonly json?: boolean },
): Promise<void> {
  const result = await acceptLandingResult(ctx, request);
  if (!result.ok && result.error === "report_only_proof") {
    throw new WorktreeResultError(
      result.message ?? "Acceptance refused.",
      result,
    );
  }
  emitOrRenderWorktreeResult(ctx, result, request.json ?? false, {
    afterApply: (rendered): void => {
      if (!rendered.ok) return;
      const proofLine = rendered.data?.proof_line;
      if (proofLine !== undefined) {
        ctx.log.line(renderProofLineCli(proofLine, ctx.log.terminal));
      }
      const proofMarkdown = rendered.data?.proof;
      if (proofMarkdown !== undefined) {
        ctx.log.group("proof");
        for (
          const line of dimBlock(proofMarkdown, loggerSink(ctx.log).dim)
            .split("\n")
        ) {
          ctx.log.line(terminalLine(line));
        }
      }
    },
  });
}
