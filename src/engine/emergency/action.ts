import { markdownCodeSpan } from "../../shared/markdown_code.ts";
import { candidateAuthor } from "../completion/candidate.ts";
import { displayBranch, plural } from "../../shared/result_markdown_values.ts";
import { carriedEffortLines, landedCommitLines } from "./carried_work.ts";
import {
  resolveStandardApprovals,
  standardApprovalLines,
} from "../worktree/standard_approval.ts";
import {
  resolveVarianceInterlock,
  serveUnmetConclusion,
  varianceBinding,
} from "../worktree/acceptance_checkpoints.ts";
import { emergencyOptionError } from "./arguments.ts";
import { prepareEmergency } from "./prepare.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
/** The emergency exchange lands one approved exception through the acceptance transaction. */
import type { DiscernResult } from "../../shared/result.ts";
import type { AcceptData } from "../../shared/result_schemas.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { AWAITING_CONSENT_SLUG } from "../../shared/consent.ts";
import {
  type LifecycleContext,
  lifecycleContext,
} from "../worktree/lifecycle.ts";
import {
  commitIsMerged,
  integrationBranch,
  mainRepoPath,
  WorktreeGitError,
} from "../worktree/git.ts";
import {
  clearCompletedAcceptanceJournal,
  inspectInterruptedAcceptance,
  performAcceptanceTransition,
  recoverInterruptedAcceptance,
  withAcceptanceTransactionLock,
} from "../worktree/acceptance_transaction.ts";
import { worktreePathForEffortBranch } from "../worktree/target_resolution.ts";
import {
  type AcceptExecutionProgress,
  convergeMainCheckout,
  type EffortCheckout,
  effortCheckout,
  freshAcceptExecutionProgress,
  landingPlan,
} from "../worktree/accept.ts";
import {
  assertMainCheckoutReady,
  type CleanupDisposition,
  cleanUpEffort,
} from "../worktree/accept_cleanup.ts";
import {
  ignoredFileDriftDisabled,
  inspectIgnoredFileChanges,
} from "../worktree/ignored.ts";
import { loadIdentitySettings } from "../worktree/identity.ts";
import type { ExceptionRecord } from "../completion/exception.ts";
import type { CompletionRecord } from "../completion/records.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import {
  EMERGENCY_CONFIRMATION_MS,
  emergencyConfirmationCurrent,
  emergencyId,
  type EmergencyPlan,
  emergencyToken,
  planEmergency,
} from "./plan.ts";
import { recordExceptionNote } from "./note.ts";
import { emergencyValidationStatus } from "./obligations.ts";

export interface EmergencyOptions {
  readonly prepare?: boolean;
  readonly preparationReceipt?: string;
  readonly met?: readonly string[];
  /** One served question the agent answers as unmet during preparation. */
  readonly unmet?: { readonly id: string; readonly why: string };
  readonly reason?: string;
  readonly approvalToken?: string;
  readonly confirmed?: boolean;
  readonly dryRun?: boolean;
  readonly recover?: string;
  /** The owner's variance over each of the plan's unmet answers, by id. */
  readonly variance?: readonly string[];
  /** The owner's approval tokens for the plan's loosened limits. */
  readonly approveStandard?: readonly string[];
  readonly signal?: AbortSignal;
}

type RecordedException = Extract<CompletionRecord, { kind: "exception" }>;

/** The owner-reviewed facts a claim carries beyond its skipped checks, as
 * every emergency result reports them. */
function claimDisclosures(
  claim: RecordedException["data"]["claim"],
): Pick<
  NonNullable<AcceptData["emergency"]>,
  "carried" | "standard_approvals" | "variances"
> {
  return {
    ...(claim.carried === undefined ? {} : { carried: claim.carried }),
    ...(claim.standard_approvals === undefined
      ? {}
      : { standard_approvals: claim.standard_approvals }),
    ...(claim.variances === undefined ? {} : { variances: claim.variances }),
  };
}

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

/** The owner's per-item decisions a current confirmation still lacks, by name. */
function unconfirmedDecisions(
  plan: EmergencyPlan,
  options: EmergencyOptions,
): string[] {
  const approved = new Set(options.approveStandard ?? []);
  const varied = new Set(options.variance ?? []);
  return [
    ...plan.standard_approvals.filter(({ token }) => !approved.has(token))
      .map(({ proposal }) => proposal.standard),
    ...plan.unmet.filter(({ id }) => !varied.has(id)).map(({ id }) => id),
  ];
}

/** The read-only owner review: every fact the confirmation token binds, and
 * the exact call that confirms it. */
function emergencyPreview(
  plan: EmergencyPlan,
  options: EmergencyOptions,
  confirmation: { readonly token: string; readonly expires: number },
  missing: readonly string[],
): DiscernResult<AcceptData> {
  const flags = [
    "the same --reason",
    ...(options.preparationReceipt === undefined
      ? []
      : [`--preparation-receipt ${options.preparationReceipt}`]),
    "--confirmed",
    `--approval-token ${confirmation.token}`,
    ...plan.standard_approvals.map(({ token }) =>
      `--approve-standard ${token}`
    ),
    ...plan.unmet.map(({ id }) => `--variance ${id}`),
  ];
  const limits = plan.standard_approvals.length;
  const unmet = plan.unmet.length;
  return {
    verb: "accept",
    ...(options.dryRun
      ? { ok: true as const, dry_run: true }
      : { ok: false as const, error: AWAITING_CONSENT_SLUG }),
    data: {
      root: plan.root,
      emergency: {
        candidate_id: plan.candidate_id,
        candidate: plan.candidate,
        reason: plan.reason,
        exceptions: plan.exceptions,
        commits: [...plan.commits],
        commits_total: plan.commits_total,
        ...(plan.carried.length === 0 ? {} : { carried: [...plan.carried] }),
        ...(limits === 0 ? {} : {
          standard_approvals: plan.standard_approvals.map(({ proposal }) =>
            proposal
          ),
        }),
        ...(unmet === 0 ? {} : { variances: plan.unmet.map(varianceBinding) }),
        confirmation: confirmation.token,
        expires_at: confirmation.expires,
        outcome: "preview",
      },
      ...(limits === 0
        ? {}
        : { standard_approvals_required: [...plan.standard_approvals] }),
    },
    message: [
      ...(missing.length === 0 ? [] : [
        `The owner's confirmation must also cover every decision below; missing: ${
          missing.map(markdownCodeSpan).join(", ")
        }.`,
      ]),
      `Emergency plan for ${
        markdownCodeSpan(displayBranch(candidateAuthor(plan.candidate).branch))
      }: land ${
        plural(plan.commits_total, "commit")
      } on ${plan.trunk} now, skipping ${
        plural(plan.exceptions.length, "check")
      }. Reason: ${plan.reason}`,
      landedCommitLines(plan.commits, plan.commits_total, plan.candidate),
      ...(plan.carried.length === 0 ? [] : [carriedEffortLines(plan.carried)]),
      ...(limits === 0 ? [] : [
        `It loosens ${
          limits === 1
            ? "a standard limit under its recorded proposal, which needs"
            : `${limits} standard limits under their recorded proposals, each needing`
        } the owner's approval:\n\n${
          standardApprovalLines(plan.standard_approvals)
        }`,
      ]),
      ...(unmet === 0 ? [] : [
        `It lands ${
          unmet === 1
            ? "an unmet checkpoint answer, which needs"
            : `${unmet} unmet checkpoint answers, each needing`
        } the owner's variance:\n\n${
          plan.unmet.map(serveUnmetConclusion).join("\n\n")
        }`,
      ]),
      plan.exceptions.map((entry) =>
        `${entry.state}: ${entry.requirement.kind} ${entry.requirement.id}`
      ).join("\n"),
      boundary,
      `Review this plan with the owner. After fresh explicit approval, repeat accept emergency with ${
        LIST.format(flags)
      }. The confirmation expires in 15 minutes; changed subjects require another review.`,
    ].join("\n\n"),
  };
}

const boundary =
  "This authorizes only the displayed local emergency integration. No passing Proof, ordinary grant, remote push, deployment, or change to external branch protections is implied.";

/** Every refusal carries a canonical next action across terminal, JSON, Markdown, and MCP. */
export async function emergencyResult(
  ctx: LifecycleContext,
  options: EmergencyOptions,
): Promise<DiscernResult<AcceptData>> {
  const invalid = emergencyOptionError(options);
  const result: DiscernResult<AcceptData> = invalid === undefined
    ? await runEmergencyResult(ctx, options)
    : {
      ok: false,
      verb: "accept",
      error: "invalid_arguments",
      message: invalid,
    };
  if (!result.ok) {
    result.hints = hintTexts([
      fire(HINTS["completion-pending"], {
        action: options.prepare
          ? "Follow the preparation result. Repeat accept emergency --prepare with --met for each satisfied served question and --unmet with --why for one that isn't; then request the owner-review plan with its preparation receipt."
          : result.error === AWAITING_CONSENT_SLUG
          ? "Review the displayed emergency plan with the owner. After their fresh explicit approval, repeat accept emergency with every flag the plan's closing instruction lists, including --confirmed and its approval token."
          : result.data?.emergency?.outcome === "not-landed"
          ? "No integration occurred. Return to the repair worktree and prepare a new emergency plan for fresh owner review."
          : result.data?.emergency?.landing_id === undefined
          ? "Resolve the reported precondition, then prepare a new emergency plan."
          : `Run discern accept emergency --recover ${result.data.emergency.landing_id} to inspect and reconcile this recorded transition.`,
      }),
    ]);
  }
  return result;
}

/** Route a fresh review or an existing recovery without converting one into the other. */
async function runEmergencyResult(
  ctx: LifecycleContext,
  options: EmergencyOptions,
): Promise<DiscernResult<AcceptData>> {
  try {
    if (options.prepare) {
      return await prepareEmergency(ctx, {
        reason: options.reason ?? "",
        met: options.met ?? [],
        ...(options.unmet === undefined ? {} : { unmet: options.unmet }),
        dryRun: options.dryRun ?? false,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    }
    if (options.recover !== undefined) {
      return await recoverEmergency(ctx, options);
    }
    return await prepareAndIntegrate(ctx, options);
  } catch (error) {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Replace the exception record's settlement fields by compare-and-swap. */
async function settleException(
  root: string,
  current: RecordedException,
  next: Pick<ExceptionRecord, "outcome" | "note">,
): Promise<RecordedException> {
  const reading = await readCompletionRecord(root, {
    kind: "exception",
    id: current.id,
  });
  if (reading.kind !== "recorded" || reading.record.kind !== "exception") {
    throw new Error(
      `Exception record ${current.id} is ${reading.kind}; preserve it and inspect status.`,
    );
  }
  const record: RecordedException = {
    ...reading.record,
    revision: reading.record.revision + 1,
    data: { ...reading.record.data, ...next },
  };
  const written = await writeCompletionRecord(root, record, reading.stamp);
  if (written.kind !== "written") {
    throw new Error(
      `Exception settlement ${written.kind}; run discern accept emergency --recover ${current.id}.`,
    );
  }
  return record;
}

/** Publish only the source and exceptions approved in the current review. */
async function prepareAndIntegrate(
  ctx: LifecycleContext,
  options: EmergencyOptions,
): Promise<DiscernResult<AcceptData>> {
  const plan = await planEmergency(
    ctx,
    options.reason ?? "",
    options.preparationReceipt,
  );
  const standards = resolveStandardApprovals(plan.standard_approvals, {
    confirmed: options.confirmed === true,
    names: options.approveStandard ?? [],
  });
  const variances = resolveVarianceInterlock(
    { stale: [], unmet: [...plan.unmet], met: [], drops: [] },
    {
      confirmed: options.confirmed === true,
      varianceIds: options.variance ?? [],
    },
  );
  const invalid = standards.kind === "invalid"
    ? standards.message
    : variances.kind === "invalid-variances"
    ? variances.message
    : undefined;
  if (invalid !== undefined) {
    return {
      ok: false,
      verb: "accept",
      error: "invalid_value",
      message: invalid,
    };
  }
  const now = SYSTEM_CLOCK.wallNow();
  const expires = now + EMERGENCY_CONFIRMATION_MS;
  const token = await emergencyToken(plan, expires);
  const current = options.approvalToken !== undefined &&
    await emergencyConfirmationCurrent(plan, options.approvalToken, now);
  if (
    options.dryRun || !options.confirmed ||
    options.approvalToken === undefined || !current ||
    standards.kind !== "approved" || variances.kind !== "authorized"
  ) {
    return emergencyPreview(
      plan,
      options,
      { token, expires },
      options.dryRun || !options.confirmed || !current
        ? []
        : unconfirmedDecisions(plan, options),
    );
  }
  const approvedToken = options.approvalToken;
  const id = emergencyId(await sha256Hex(approvedToken));
  const previous = await readCompletionRecord(plan.root, {
    kind: "exception",
    id,
  });
  if (previous.kind !== "missing") {
    throw new Error(
      `This emergency authorization already has a record. Use discern accept emergency --recover ${id}; do not replay confirmation.`,
    );
  }
  const actor = {
    operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
    originating_effort: candidateAuthor(plan.candidate).effort_id,
    started_at: now,
  };
  const record: RecordedException = {
    version: ON_DISK_FORMATS.completionRecord.version,
    kind: "exception",
    id,
    revision: 1,
    data: {
      claim: {
        kind: "exception",
        authorization_id: id,
        authorized_at: now,
        actual_trunk: plan.candidate.predecessor,
        source: candidateAuthor(plan.candidate),
        candidate_id: plan.candidate_id,
        candidate_head: plan.candidate.head,
        policy: plan.candidate.policy,
        reason: plan.reason,
        exceptions: plan.exceptions,
        ...(plan.carried.length === 0 ? {} : { carried: [...plan.carried] }),
        ...(standards.proposals.length === 0
          ? {}
          : { standard_approvals: standards.proposals }),
        ...(variances.variances.length === 0
          ? {}
          : { variances: variances.variances }),
        ...(plan.review === undefined ? {} : { review: plan.review }),
      },
      executor: actor,
      expected_trunk: plan.candidate.predecessor,
      target: plan.candidate.head,
      outcome: { kind: "planned" },
      note: "pending",
    },
  };
  const written = await writeCompletionRecord(plan.root, record, null);
  if (written.kind !== "written") {
    throw new Error(
      `Emergency record publication is ${written.kind}; re-observe before another action.`,
    );
  }
  const effort = await effortCheckout(ctx, undefined);
  if (effort === undefined) {
    throw new Error("Emergency integration runs from the repair's worktree.");
  }
  return await withAcceptanceTransactionLock(effort.path, async () => {
    // The approved subject must still be exactly what the owner reviewed.
    const current = await planEmergency(
      ctx,
      plan.reason,
      options.preparationReceipt,
    );
    if (!await emergencyConfirmationCurrent(current, approvedToken)) {
      const settled = await settleException(plan.root, record, {
        outcome: {
          kind: "not-landed",
          at: SYSTEM_CLOCK.wallNow(),
          reason: "the approved subject changed before the transition",
        },
        note: "pending",
      });
      return notLandedResult(
        plan,
        settled,
        "The emergency subject changed after the owner's approval. Inspect current state and prepare a new owner review.",
      );
    }
    await assertMainCheckoutReady(effort);
    const transition = await performAcceptanceTransition(effort.path, {
      mainRepo: plan.root,
      trunk: plan.trunk,
      worktreeBranch: effort.branch,
      expectedTrunk: plan.candidate.predecessor,
      target: plan.candidate.head,
      effortClaim: false,
      consent: { source: "conversation" },
      variances: variances.variances,
      standardProposals: standards.proposals,
    });
    if (transition.kind === "authority-changed") {
      throw new Error("Emergency integration claims no effort grant.");
    }
    const ff = transition.outcome;
    const advanced = ff.kind === "updated" ||
      (ff.kind === "checkout-failed" && !ff.rolledBack);
    if (!advanced) {
      const settled = await settleException(plan.root, record, {
        outcome: {
          kind: "not-landed",
          at: SYSTEM_CLOCK.wallNow(),
          reason: ff.kind === "dirty"
            ? `the main checkout was not clean at the landing boundary: ${ff.detail}`
            : `the trunk moved before the transition: ${ff.detail}`,
        },
        note: "pending",
      });
      return notLandedResult(
        plan,
        settled,
        ff.kind === "dirty"
          ? `The main checkout at ${plan.root} changed at the landing boundary, so nothing landed. Inspect it, then prepare a new emergency plan.`
          : `The trunk moved after the owner's approval, so nothing landed. Run discern update in the repair worktree, then prepare a new emergency plan.`,
      );
    }
    const landed = await settleException(plan.root, record, {
      outcome: { kind: "landed", at: SYSTEM_CLOCK.wallNow() },
      note: "pending",
    });
    return await settleLanded(ctx, effort, landed, options.signal);
  });
}

/** The result for an approved exception whose transition did not advance the trunk. */
function notLandedResult(
  plan: EmergencyPlan,
  record: RecordedException,
  message: string,
): DiscernResult<AcceptData> {
  return {
    ok: false,
    verb: "accept",
    error: "precondition_failed",
    message: `${message} ${boundary}`,
    data: {
      root: plan.root,
      emergency: {
        landing_id: record.id,
        candidate_id: record.data.claim.candidate_id,
        reason: record.data.claim.reason,
        exceptions: record.data.claim.exceptions,
        ...claimDisclosures(record.data.claim),
        outcome: "not-landed",
      },
    },
  };
}

/** A main-checkout stand-in that lets convergence run after the repair's
 * checkout is gone. Only the fields {@link landingPlan} and
 * {@link convergeMainCheckout} read are meaningful; the stand-in is never
 * handed to cleanup, so nothing can target the main checkout for removal. */
async function mainCheckoutStandIn(
  ctx: LifecycleContext,
  root: string,
  trunk: string,
  record: RecordedException,
): Promise<EffortCheckout> {
  return {
    ctx: await lifecycleContext(root, ctx.log, root),
    path: root,
    branch: record.data.claim.source.branch.slice("refs/heads/".length),
    id: record.data.claim.source.effort_id,
    settings: await loadIdentitySettings(root),
    mainRepo: root,
    trunk,
    explicit: false,
  };
}

/** Record the note, converge the main checkout, and clean up the repair after a landed exception. */
async function settleLanded(
  ctx: LifecycleContext,
  effort: EffortCheckout | undefined,
  record: RecordedException,
  signal: AbortSignal | undefined,
): Promise<DiscernResult<AcceptData>> {
  const root = effort?.mainRepo ?? (await mainRepoPath(ctx.cwd)) ?? ctx.root;
  const trunk = integrationBranch(ctx.config.repository.trunk);
  let current = record;
  if (current.data.note !== "published") {
    const note = await recordExceptionNote(root, current.id, current.data);
    const published = note.status === "recorded" ||
      note.status === "already_present";
    current = await settleException(root, current, {
      outcome: current.data.outcome,
      note: published ? "published" : "failed",
    });
    if (!published) ctx.log.warn(note.reason ?? "The exception note failed.");
  }
  const progress = freshAcceptExecutionProgress();
  progress.landing.trunk_landed = true;
  // Convergence is owed by the main checkout, not the repair's checkout, so
  // it runs on every landed settlement — recovery included, even after the
  // repair's worktree is gone. The durable record keeps no convergence field
  // (convergence outcomes travel in the result's steps), so each settlement
  // judges convergence from this run's own steps: a recovery retries the
  // commands and succeeds only when they actually converged.
  const convergence = effort ??
    await mainCheckoutStandIn(ctx, root, trunk, current);
  const plan = landingPlan(
    convergence,
    effort === undefined
      ? ignoredFileDriftDisabled()
      : await inspectIgnoredFileChanges(
        effort.path,
        effort.ctx.config.worktree.track_ignored_drift,
      ),
  );
  const convergenceStepStart = progress.steps.length;
  await convergeMainCheckout(convergence, plan, progress, signal);
  const converged = progress.steps
    .slice(convergenceStepStart)
    .every((step) => step.outcome !== "failed");
  let cleanup: "removed" | "kept" | "failed" = "kept";
  let cleanupDetail: string | undefined;
  if (effort !== undefined) {
    let disposition: CleanupDisposition;
    try {
      disposition = await cleanUpEffort(effort, current.data.target, progress);
      if (disposition.kind === "resources-remain") {
        cleanup = "failed";
        cleanupDetail =
          `The repair's checkout and branch are gone, but resource teardown failed for ${
            disposition.failed.join(", ")
          }.`;
      } else {
        cleanup = disposition.kind === "removed" ? "removed" : "kept";
      }
    } catch (error) {
      cleanup = "failed";
      cleanupDetail = error instanceof WorktreeGitError
        ? error.message
        : String(error);
    }
  } else {
    cleanup = "removed";
  }
  return emergencyOutcome(
    root,
    trunk,
    current,
    progress,
    cleanup,
    cleanupDetail,
    converged,
  );
}

/** Reconcile the durable record and original exception without fresh landing consent. */
async function recoverEmergency(
  ctx: LifecycleContext,
  options: EmergencyOptions,
): Promise<DiscernResult<AcceptData>> {
  const root = await mainRepoPath(ctx.cwd);
  if (root === undefined || options.recover === undefined) {
    throw new Error("The main checkout or landing id is unavailable.");
  }
  const reading = await readCompletionRecord(root, {
    kind: "exception",
    id: options.recover,
  });
  if (reading.kind !== "recorded" || reading.record.kind !== "exception") {
    throw new Error(
      "No readable emergency landing exists at that id. Preserve the records and inspect status.",
    );
  }
  const record = reading.record;
  const trunk = integrationBranch(ctx.config.repository.trunk);
  if (options.dryRun) {
    return {
      ok: true,
      verb: "accept",
      dry_run: true,
      data: {
        root,
        emergency: {
          landing_id: record.id,
          reason: record.data.claim.reason,
          exceptions: record.data.claim.exceptions,
          ...claimDisclosures(record.data.claim),
        },
      },
      message:
        "Recover only this recorded emergency transition and its cleanup. No new integration or authorization is created.",
    };
  }
  const branch = record.data.claim.source.branch.slice("refs/heads/".length);
  const worktree = await worktreePathForEffortBranch(root, branch);
  const effort = worktree === undefined ? undefined : await effortCheckout(
    { ...ctx, ...(await lifecycleContext(worktree, ctx.log, worktree)) },
    undefined,
  );
  let current = record;
  if (current.data.outcome.kind === "planned") {
    // The transition was recorded but never settled: the journal in the
    // repair's checkout says whether the trunk advanced.
    let landed = await commitIsMerged(root, current.data.target, trunk);
    if (effort !== undefined) {
      const interrupted = await inspectInterruptedAcceptance(
        effort.path,
        trunk,
      );
      if (interrupted.kind === "recorded") {
        const recovered = await withAcceptanceTransactionLock(
          effort.path,
          async () => {
            const outcome = await recoverInterruptedAcceptance(
              effort.path,
              interrupted,
            );
            // The exception record, not this journal, carries what the
            // landed transition still owes, so its journal retires at once.
            if (
              outcome.kind === "landed" &&
              !(await clearCompletedAcceptanceJournal(
                effort.path,
                interrupted.transaction.target,
              ))
            ) {
              ctx.log.warn(
                `Could not retire the recovered landing's journal at ${interrupted.path}; the next acceptance from this checkout settles it first.`,
              );
            }
            return outcome;
          },
        );
        if (recovered.kind === "stopped" && !recovered.trunkLanded) {
          throw new WorktreeGitError(recovered.message);
        }
        landed = recovered.kind === "ready"
          ? await commitIsMerged(root, current.data.target, trunk)
          : recovered.kind === "landed" || recovered.trunkLanded;
      }
    }
    current = await settleException(root, current, {
      outcome: landed ? { kind: "landed", at: SYSTEM_CLOCK.wallNow() } : {
        kind: "not-landed",
        at: SYSTEM_CLOCK.wallNow(),
        reason: "the recorded transition never advanced the trunk",
      },
      note: "pending",
    });
  }
  if (current.data.outcome.kind === "not-landed") {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      message: `${
        markdownCodeSpan(displayBranch(current.data.claim.source.branch))
      } did not land; the emergency was not applied and no Proof was issued. ${boundary}\n\nThe unlanded outcome is settled. Return to the repair worktree and prepare a new emergency plan for fresh owner review.`,
      data: {
        root,
        emergency: {
          landing_id: current.id,
          candidate_id: current.data.claim.candidate_id,
          reason: current.data.claim.reason,
          exceptions: current.data.claim.exceptions,
          ...claimDisclosures(current.data.claim),
          outcome: "not-landed",
        },
      },
    };
  }
  return await settleLanded(ctx, effort, current, options.signal);
}

/** Keep integration, convergence, note publication, and cleanup outcomes separate. */
async function emergencyOutcome(
  root: string,
  trunk: string,
  record: RecordedException,
  progress: AcceptExecutionProgress,
  cleanup: "removed" | "kept" | "failed",
  cleanupDetail: string | undefined,
  converged: boolean,
): Promise<DiscernResult<AcceptData>> {
  const claim = record.data.claim;
  const published = record.data.note === "published";
  const settled = published && converged && cleanup !== "failed";
  const branch = markdownCodeSpan(displayBranch(claim.source.branch));
  const lead =
    `${branch} landed on ${trunk} as an emergency, with no passing Proof.`;
  // Every unresolved obligation is named; the landing itself already stands.
  const owed: string[] = [];
  if (!published) {
    owed.push(
      `The exception note was not recorded. Run discern accept emergency --recover ${record.id} after repairing Git notes access.`,
    );
  }
  if (!converged) {
    owed.push(
      `The main checkout at ${root} did not converge on the landed tree; the failed steps are in this result. Fix their cause, then run discern accept emergency --recover ${record.id} to retry convergence.`,
    );
  }
  if (cleanup === "failed") {
    owed.push(
      `${
        cleanupDetail ?? "Cleanup did not complete."
      } Run discern worktree prune from ${root}.`,
    );
  }
  const next = owed.length > 0
    ? owed.join("\n")
    : cleanup === "kept"
    ? "The repair's checkout stays for the work it still holds. Run discern done --rerun on the current committed trunk or a repair containing it to resolve outstanding validation."
    : "Run discern done --rerun on the current committed trunk or a repair containing it to resolve outstanding validation.";
  return {
    verb: "accept",
    ...(settled
      ? { ok: true as const }
      : { ok: false as const, error: "partial_acceptance" as const }),
    ...(progress.steps.length === 0 ? {} : { steps: [...progress.steps] }),
    ...(progress.diagnostics.length === 0
      ? {}
      : { diagnostics: [...progress.diagnostics] }),
    data: {
      root,
      emergency: {
        landing_id: record.id,
        candidate_id: claim.candidate_id,
        reason: claim.reason,
        exceptions: claim.exceptions,
        ...claimDisclosures(claim),
        outcome: "landed",
        note: record.data.note,
        cleanup,
      },
      emergency_validation: await emergencyValidationStatus(root),
    },
    message: `${lead} ${boundary}\n\n${next}`,
  };
}
