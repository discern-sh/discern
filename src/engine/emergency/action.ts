import { markdownCodeSpan } from "../../shared/markdown_code.ts";
import { displayBranch } from "../../shared/result_markdown_values.ts";
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
  inspectInterruptedAcceptance,
  performAcceptanceTransition,
  recoverInterruptedAcceptance,
  withAcceptanceTransactionLock,
} from "../worktree/acceptance_transaction.ts";
import { worktreePathForEffortBranch } from "../worktree/target_resolution.ts";
import {
  type AcceptExecutionProgress,
  assertMainCheckoutReady,
  type CleanupDisposition,
  cleanUpEffort,
  convergeMainCheckout,
  type EffortCheckout,
  effortCheckout,
  freshAcceptExecutionProgress,
  landingPlan,
} from "../worktree/accept.ts";
import { inspectIgnoredFileChanges } from "../worktree/ignored.ts";
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
  readonly preparation?: string;
  readonly met?: readonly string[];
  readonly reason?: string;
  readonly confirmation?: string;
  readonly confirmed?: boolean;
  readonly dryRun?: boolean;
  readonly recover?: string;
  readonly signal?: AbortSignal;
}

type RecordedException = Extract<CompletionRecord, { kind: "exception" }>;

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
          ? "Follow the preparation result. Repeat accept emergency --prepare with --met only for satisfied served questions; then request the owner-review plan with its preparation receipt."
          : result.error === AWAITING_CONSENT_SLUG
          ? "Review the displayed emergency plan with the owner. After their fresh explicit approval, repeat accept emergency with the displayed confirmation token and --confirmed."
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
    options.preparation,
  );
  const now = SYSTEM_CLOCK.wallNow();
  const expires = now + EMERGENCY_CONFIRMATION_MS;
  const confirmation = await emergencyToken(plan, expires);
  const preview: AcceptData = {
    root: plan.root,
    emergency: {
      candidate_id: plan.candidate_id,
      candidate: plan.candidate,
      reason: plan.reason,
      exceptions: plan.exceptions,
      confirmation,
      expires_at: expires,
      outcome: "preview",
    },
  };
  if (
    options.dryRun || !options.confirmed ||
    options.confirmation === undefined ||
    !await emergencyConfirmationCurrent(plan, options.confirmation, now)
  ) {
    return {
      verb: "accept",
      ...(options.dryRun
        ? { ok: true as const, dry_run: true }
        : { ok: false as const, error: AWAITING_CONSENT_SLUG }),
      data: preview,
      message: `Emergency plan for ${
        markdownCodeSpan(displayBranch(plan.candidate.source.branch))
      }: land its repair on ${plan.trunk} now, skipping ${
        plan.exceptions.length === 1
          ? "1 check"
          : `${plan.exceptions.length} checks`
      }. Reason: ${plan.reason}\n\n${
        plan.exceptions.map((entry) =>
          `${entry.state}: ${entry.requirement.kind} ${entry.requirement.id}`
        ).join("\n")
      }\n\n${boundary}\n\nReview this plan with the owner. After fresh explicit approval, repeat accept emergency with the same --reason, ${
        options.preparation === undefined
          ? ""
          : `--preparation ${options.preparation}, `
      }--confirmed, and --confirmation ${confirmation}. The confirmation expires in 15 minutes; changed subjects require another review.`,
    };
  }
  const approvedToken = options.confirmation;
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
    originating_effort: plan.candidate.source.effort_id,
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
        source: plan.candidate.source,
        candidate_id: plan.candidate_id,
        candidate_head: plan.candidate.head,
        policy: plan.candidate.policy,
        reason: plan.reason,
        exceptions: plan.exceptions,
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
    const current = await planEmergency(ctx, plan.reason, options.preparation);
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
      variances: [],
      standardProposals: [],
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
        outcome: "not-landed",
      },
    },
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
  let cleanup: "removed" | "kept" | "failed" = "kept";
  let cleanupDetail: string | undefined;
  if (effort !== undefined) {
    const plan = landingPlan(
      effort,
      await inspectIgnoredFileChanges(
        effort.path,
        effort.ctx.config.worktree.ignored_file_drift,
      ),
    );
    await convergeMainCheckout(effort, plan, progress, signal);
    let disposition: CleanupDisposition;
    try {
      disposition = await cleanUpEffort(effort, current.data.target, progress);
      cleanup = disposition.kind === "removed" ? "removed" : "kept";
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
          () => recoverInterruptedAcceptance(effort.path, interrupted),
        );
        if (recovered.kind === "stopped" && !recovered.trunkLanded) {
          throw new WorktreeGitError(recovered.message);
        }
        landed = recovered.kind === "ready"
          ? await commitIsMerged(root, current.data.target, trunk)
          : recovered.trunkLanded;
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
          outcome: "not-landed",
        },
      },
    };
  }
  return await settleLanded(ctx, effort, current, options.signal);
}

/** Keep integration, note publication, and cleanup outcomes separate. */
async function emergencyOutcome(
  root: string,
  trunk: string,
  record: RecordedException,
  progress: AcceptExecutionProgress,
  cleanup: "removed" | "kept" | "failed",
  cleanupDetail: string | undefined,
): Promise<DiscernResult<AcceptData>> {
  const claim = record.data.claim;
  const published = record.data.note === "published";
  const settled = published && cleanup !== "failed";
  const branch = markdownCodeSpan(displayBranch(claim.source.branch));
  const lead =
    `${branch} landed on ${trunk} as an emergency, with no passing Proof.`;
  const next = !published
    ? `The exception note was not recorded. Run discern accept emergency --recover ${record.id} after repairing Git notes access.`
    : cleanup === "failed"
    ? `${
      cleanupDetail ?? "Cleanup did not complete."
    } Run discern worktree prune from ${root}.`
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
        outcome: "landed",
        note: record.data.note,
        cleanup,
      },
      emergency_validation: await emergencyValidationStatus(root),
    },
    message: `${lead} ${boundary}\n\n${next}`,
  };
}
