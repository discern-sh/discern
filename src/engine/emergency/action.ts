import { acceptancePending } from "../landing_queue/public_result.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import { readLandingConvergenceResult } from "../landing_queue/convergence.ts";
import { ownValidationEnvironment } from "../execution/public_environment.ts";
/** The emergency exchange delegates its transition and retirement to the ordinary landing engine. */
import type { DiscernResult } from "../../shared/result.ts";
import type { AcceptData } from "../../shared/result_schemas.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { AWAITING_CONSENT_SLUG } from "../../shared/consent.ts";
import type { LifecycleContext } from "../worktree/lifecycle.ts";
import { integrationBranch, mainRepoPath } from "../worktree/git.ts";
import { withCompletionCheckout } from "../operation_lock.ts";
import type { LandingConverger } from "../landing_queue/convergence.ts";
import {
  type LandingRecord,
  publishEmergencyLanding,
  type QueueLandingRuntime,
  recoverQueueLanding,
} from "../landing_queue/publication.ts";
import { retireQueueLanding } from "../landing_queue/retirement.ts";
import { registeredSourcePath } from "../landing_queue/public_authority.ts";
import {
  initializeQueue,
  REPOSITORY_QUEUE_ID,
  reserveQueueAttempt,
} from "../landing_queue/repository.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import { retainMeasurementCandidate } from "../landing_queue/composition.ts";
import {
  EMERGENCY_CONFIRMATION_MS,
  emergencyConfirmationCurrent,
  emergencyId,
  emergencyToken,
  planEmergency,
} from "./plan.ts";
import { emergencyValidationStatus } from "./obligations.ts";

export interface EmergencyOptions {
  readonly reason?: string;
  readonly confirmation?: string;
  readonly confirmed?: boolean;
  readonly dryRun?: boolean;
  readonly recover?: string;
  readonly signal?: AbortSignal;
  readonly converge?: LandingConverger;
  /** Fault injection covers the same durable transition boundaries as ordinary acceptance. */
  readonly afterBoundary?: QueueLandingRuntime["afterBoundary"];
}

const boundary =
  "This authorizes only the displayed local emergency integration. No passing Proof, ordinary grant, remote push, deployment, or change to external branch protections is implied.";

/** Every refusal carries a canonical next action across terminal, JSON, Markdown, and MCP. */
export async function emergencyResult(
  ctx: LifecycleContext,
  options: EmergencyOptions,
): Promise<DiscernResult<AcceptData>> {
  const result = await runEmergencyResult(ctx, options);
  if (!result.ok) {
    result.hints = hintTexts([
      fire(HINTS["completion-pending"], {
        action: result.error === AWAITING_CONSENT_SLUG
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

/** Publish only the source and exceptions approved in the current review. */
async function prepareAndIntegrate(
  ctx: LifecycleContext,
  options: EmergencyOptions,
): Promise<DiscernResult<AcceptData>> {
  const plan = await planEmergency(ctx, options.reason ?? "");
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
      message:
        `Emergency plan: ${plan.candidate.source.branch} at ${plan.candidate.head} will advance ${plan.trunk} from ${plan.candidate.expected_predecessor.head}. Reason: ${plan.reason}\n\n${
          plan.exceptions.map((entry) =>
            `${entry.state}: ${entry.requirement.kind} ${entry.requirement.id} (${entry.requirement.context})`
          ).join("\n")
        }\n\n${boundary}\n\nReview this plan with the owner. After fresh explicit approval, repeat accept emergency with the same --reason, --confirmed, and --confirmation ${confirmation}. The confirmation expires in 15 minutes; changed subjects require another review.`,
    };
  }
  const approvedToken = options.confirmation;
  const id = emergencyId(await sha256Hex(approvedToken));
  const previous = await readCompletionRecord(plan.root, {
    kind: "landing",
    id,
  });
  if (previous.kind !== "missing") {
    throw new Error(
      `This emergency authorization already has a record. Use discern accept emergency --recover ${id}; do not replay confirmation.`,
    );
  }
  const queue = await readCompletionRecord(plan.root, {
    kind: "queue",
    id: REPOSITORY_QUEUE_ID,
  });
  if (queue.kind === "missing") {
    const initialized = await initializeQueue(
      plan.root,
      plan.observation.trunk,
    );
    if (initialized.kind !== "written") {
      throw new Error(
        `Queue initialization is ${initialized.kind}; preserve its records and retry the plan.`,
      );
    }
  }
  const actor = {
    operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
    originating_effort: plan.candidate.source.effort_id,
    started_at: now,
  };
  const environment = await withCompletionCheckout(
    ctx.cwd,
    () =>
      ownValidationEnvironment(
        ctx.cwd,
        ctx.config,
        plan.candidate.source,
        actor,
        ctx.config.execution.local ?? null,
      ),
    options.signal,
  );
  if ("kind" in environment) {
    throw new Error(
      "The repair environment is unavailable or requires recovery. Restore it before emergency integration.",
    );
  }
  const attempt = await reserveQueueAttempt(plan.root, {
    candidate_id: plan.candidate_id,
  }, actor);
  const token = SYSTEM_SECURE_ENTROPY.uuid();
  const fence = { attempt_id: attempt.id, token };
  const written = await writeCompletionRecord(plan.root, {
    version: ON_DISK_FORMATS.completionRecord.version,
    kind: "attempt",
    id: attempt.id,
    revision: 1,
    data: {
      identity: attempt,
      environment_id: environment.environmentId,
      subjects: [],
      purpose: "completion",
      mode: "strict",
      state: {
        kind: "claimed",
        claim: {
          token,
          executor: actor,
          acquired_at: now,
          expires_at: now + 60_000,
        },
      },
    },
  }, null);
  if (written.kind !== "written") {
    throw new Error(
      `Emergency actor publication is ${written.kind}; re-observe before another action.`,
    );
  }
  const existingCandidate = await readCompletionRecord(plan.root, {
    kind: "candidate",
    id: plan.candidate_id,
  });
  if (existingCandidate.kind === "missing") {
    await retainMeasurementCandidate(ctx.cwd, plan.candidate_id, {
      ...plan.candidate,
      attempt_id: attempt.id,
    }, fence);
  }
  const record: LandingRecord = {
    version: ON_DISK_FORMATS.completionRecord.version,
    kind: "landing",
    id,
    revision: 1,
    data: {
      attempt_id: attempt.id,
      candidate_id: plan.candidate_id,
      source: plan.candidate.source,
      executor: actor,
      expected_trunk: plan.candidate.expected_predecessor.head,
      target: plan.candidate.head,
      policy: plan.candidate.policy,
      claim: {
        kind: "exception",
        authorization_id: id,
        authorized_at: now,
        actual_trunk: plan.candidate.expected_predecessor.head,
        source: plan.candidate.source,
        candidate_id: plan.candidate_id,
        candidate_head: plan.candidate.head,
        policy: plan.candidate.policy,
        reason: plan.reason,
        exceptions: plan.exceptions,
      },
      outcome: { kind: "planned" },
      authority_settlement: "pending",
      note: "pending",
    },
  };
  const runtime: QueueLandingRuntime = {
    emergencyAuthorizationExpiresAt: Number(approvedToken.split(".")[0]),
    root: plan.root,
    mainRepo: plan.root,
    trunk: plan.trunk,
    sourceCheckout: (record) =>
      registeredSourcePath(plan.root, record.data.source),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.converge === undefined ? {} : { converge: options.converge }),
    ...(options.afterBoundary === undefined
      ? {}
      : { afterBoundary: options.afterBoundary }),
    audit: async () => {
      const current = await planEmergency(ctx, plan.reason);
      if (!await emergencyConfirmationCurrent(current, approvedToken)) {
        return { kind: "missing-authority", sources: [plan.candidate.source] };
      }
      return current.observation;
    },
  };
  let landed;
  try {
    landed = await publishEmergencyLanding(runtime, record, fence);
  } catch (error) {
    const retained = await readCompletionRecord(plan.root, {
      kind: "landing",
      id,
    });
    return {
      ok: false,
      verb: "accept",
      error: "partial_acceptance",
      message: `${error instanceof Error ? error.message : String(error)}. ${
        retained.kind === "recorded"
          ? `The exception record is retained; run discern accept emergency --recover ${id}.`
          : "The transition was not recorded; inspect state before preparing a new plan."
      }`,
      data: {
        root: plan.root,
        ...(retained.kind === "recorded"
          ? { emergency: { landing_id: id, outcome: "recovery" } }
          : {}),
      },
    };
  }
  if ("kind" in landed) {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      message: `The emergency subject or publication conditions changed: ${
        acceptancePending(landed).reason
      }. Inspect current state and prepare a new owner review.`,
      data: {
        root: plan.root,
        emergency: preview.emergency,
      },
    };
  }
  return await emergencyOutcome(ctx, options, plan.root, plan.trunk, {
    ...record,
    data: landed,
  });
}

/** Reconcile the durable marker and original exception without fresh landing consent. */
async function recoverEmergency(
  ctx: LifecycleContext,
  options: EmergencyOptions,
): Promise<DiscernResult<AcceptData>> {
  const root = await mainRepoPath(ctx.cwd);
  if (root === undefined || options.recover === undefined) {
    throw new Error("The main checkout or landing id is unavailable.");
  }
  const reading = await readCompletionRecord(root, {
    kind: "landing",
    id: options.recover,
  });
  if (
    reading.kind !== "recorded" || reading.record.kind !== "landing" ||
    reading.record.data.claim.kind !== "exception"
  ) {
    throw new Error(
      "No readable emergency landing exists at that id. Preserve the records and inspect status.",
    );
  }
  const trunk = integrationBranch(ctx.config.repository.trunk);
  if (options.dryRun) {
    return {
      ok: true,
      verb: "accept",
      dry_run: true,
      data: {
        root,
        emergency: {
          landing_id: reading.record.id,
          reason: reading.record.data.claim.reason,
          exceptions: reading.record.data.claim.exceptions,
        },
      },
      message:
        "Recover only this recorded emergency transition and its cleanup. No new integration or authorization is created.",
    };
  }
  const runtime: QueueLandingRuntime = {
    root,
    mainRepo: root,
    trunk,
    sourceCheckout: (record) => registeredSourcePath(root, record.data.source),
    audit: () => {
      throw new Error("Recovery cannot authorize a new transition.");
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.converge === undefined ? {} : { converge: options.converge }),
  };
  const recovered = await recoverQueueLanding(runtime, reading.record.id);
  if ("kind" in recovered) {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      message: acceptancePending(recovered).reason,
      data: {
        root,
        emergency: { landing_id: reading.record.id, outcome: "recovery" },
      },
    };
  }
  return await emergencyOutcome(ctx, options, root, trunk, {
    ...reading.record,
    data: recovered,
  });
}

/** Keep integration, convergence, note publication, and retirement outcomes separate. */
async function emergencyOutcome(
  ctx: LifecycleContext,
  options: EmergencyOptions,
  root: string,
  trunk: string,
  record: LandingRecord,
): Promise<DiscernResult<AcceptData>> {
  const claim = record.data.claim;
  if (claim.kind !== "exception") {
    throw new Error("Emergency result requires its exception claim.");
  }
  const landed = record.data.outcome.kind === "landed";
  const notLanded = record.data.outcome.kind === "not-landed";
  const convergence = await readLandingConvergenceResult(root, record.data);
  const converged = options.converge === undefined &&
      record.data.convergence_result === undefined || convergence?.ok === true;
  const retirement = landed && converged
    ? await retireQueueLanding({
      root,
      trunk,
      config: ctx.config,
      executor: record.data.executor,
      log: ctx.log,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }, record)
    : undefined;
  return {
    verb: "accept",
    ...(!landed || !converged || record.data.note !== "published" ||
        retirement?.kind === "recovery"
      ? { ok: false as const, error: "partial_acceptance" as const }
      : { ok: true as const }),
    data: {
      root,
      emergency: {
        landing_id: record.id,
        candidate_id: record.data.candidate_id,
        reason: claim.reason,
        exceptions: claim.exceptions,
        outcome: landed
          ? "landed"
          : record.data.outcome.kind === "not-landed"
          ? "not-landed"
          : "recovery",
        ...(retirement === undefined ? {} : { retirement: retirement.kind }),
      },
      emergency_validation: await emergencyValidationStatus(root),
    },
    message: `${
      landed
        ? "Emergency integration is recorded"
        : notLanded
        ? "Emergency integration did not occur"
        : "Emergency integration needs recovery"
    } for ${record.data.target}. No passing Proof was issued. ${boundary}\n\n${
      landed && converged && record.data.note === "published" &&
        retirement?.kind !== "recovery"
        ? "Run discern done --rerun on the current committed trunk or a repair containing it to resolve outstanding validation."
        : notLanded
        ? "The unlanded outcome is settled. Return to the repair worktree and prepare a new emergency plan for fresh owner review."
        : `Run discern accept emergency --recover ${record.id} to reconcile this recorded transition.`
    }`,
  };
}
