/** Reconcile an observed integration and reuse canonical checkout retirement. */
import type { DiscernResult } from "../../shared/result.ts";
import type { AcceptData } from "../../shared/result_schemas.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import type { LifecycleContext } from "../worktree/lifecycle.ts";
import { integrationBranch, mainRepoPath } from "../worktree/git.ts";
import { resolveWorktreeTarget } from "../worktree/target_resolution.ts";
import { writeCompletionRecord } from "../completion/store.ts";
import {
  type ExternalIntegrationRecord,
  observeExternalIntegration,
} from "./external_integration.ts";
import {
  observedQueue,
  observedRecords,
  observeQueue,
  requireQueue,
  withQueueLock,
} from "./repository.ts";
import { mutateQueue } from "./mutations.ts";
import { acceptancePending, displayBranch } from "./public_result.ts";
import { markdownCodeSpan } from "../../shared/markdown_code.ts";
import { checkoutOutcomeSentence } from "../../shared/result_completion.ts";
import { runGit } from "../../shared/subprocess.ts";
import { reconcileQueueWork } from "./recovery.ts";
import { reclaimRetirementStorage } from "./retirement_storage.ts";
import { planQueueRetirement, retireQueueLanding } from "./retirement.ts";

/** No consent is granted or consumed: the exact proven target is already reachable. */
export async function reconcileIntegrationResult(
  ctx: LifecycleContext,
  options: {
    readonly target?: string;
    readonly dryRun?: boolean;
    readonly expected?: string;
    readonly signal?: AbortSignal;
  },
): Promise<DiscernResult<AcceptData>> {
  const root = await mainRepoPath(ctx.cwd);
  if (root === undefined) {
    return { ok: false, verb: "accept", error: "no_repository" };
  }
  if (options.target === undefined) {
    return {
      ok: false,
      verb: "accept",
      error: "no_target",
      message:
        "Reconciliation requires --target <effort-id>. Preview with --reconcile --dry-run, then apply its --expected token.",
    };
  }
  const trunk = integrationBranch(ctx.config.repository.trunk);
  const observation = await observeQueue(root, trunk);
  const current = observedQueue(observation);
  if ("kind" in current) {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      message:
        "No usable completion queue is available. Resolve the reported record condition before reconciliation.",
      data: { pending: [acceptancePending(current)] },
    };
  }
  const expectedState = await sha256Hex(JSON.stringify({
    trunk: observation.trunk,
    records: observation.records,
  }));
  let entry = current.record.data.entries.find((entry) =>
    entry.source.effort_id === options.target
  );
  if (entry === undefined) {
    const resolved = await resolveWorktreeTarget(root, options.target, {
      cwd: ctx.cwd,
      mode: "branch",
      command: "accept --reconcile",
    });
    entry = current.record.data.entries.find((entry) =>
      entry.source.effort_id === resolved.id ||
      entry.source.branch === resolved.ref
    );
  }
  if (entry === undefined) {
    return {
      ok: false,
      verb: "accept",
      error: "no_target",
      message:
        "The selected effort has no recorded completion source to reconcile.",
    };
  }
  const observed = await observeExternalIntegration(
    root,
    observation,
    entry.source.branch,
    entry.source.head,
  );
  if ("kind" in observed) {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      message: acceptancePending(observed).reason,
      data: { pending: [acceptancePending(observed)] },
    };
  }
  const records = observedRecords(observation);
  const governed = records.find((record) =>
    record.kind === "landing" &&
    record.data.candidate_id === observed.candidate.id &&
    record.data.outcome.kind !== "not-landed"
  );
  if (governed !== undefined) {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      message:
        "A governed transition already owns this candidate. Continue with accept --target <effort-id> to reconcile that transition without another landing.",
    };
  }
  const reservations = records.filter((record) =>
    record.kind === "attempt" &&
    record.data.identity.candidate_id === observed.candidate.id &&
    record.data.state.kind !== "finished"
  );
  const activeEnvironment = records.find((record) =>
    record.kind === "environment" &&
    (record.data.ownership.kind === "borrowed" &&
        record.data.ownership.source.effort_id === entry.source.effort_id ||
      reservations.some((attempt) =>
        attempt.kind === "attempt" && attempt.data.environment_id === record.id
      )) &&
    record.data.state.kind !== "idle" && record.data.state.kind !== "disposed"
  );
  const unsafeReservation = reservations.find((record) =>
    record.kind === "attempt" &&
    (entry.state !== "active" || record.data.subjects.length > 0 ||
      record.data.state.kind !== "claimed" ||
      record.data.state.claim.expires_at > observation.observed_at)
  );
  if (activeEnvironment !== undefined || unsafeReservation !== undefined) {
    if (
      unsafeReservation?.kind === "attempt" &&
      unsafeReservation.data.state.kind === "claimed" &&
      unsafeReservation.data.state.claim.expires_at > observation.observed_at
    ) {
      const pending = acceptancePending({
        kind: "waiting-for-operation",
        attempt_id: unsafeReservation.id,
        expires_at: unsafeReservation.data.state.claim.expires_at,
      });
      return {
        ok: false,
        verb: "accept",
        error: "incomplete",
        message: pending.reason,
        data: { pending: [pending] },
      };
    }
    const environment = activeEnvironment?.kind === "environment"
      ? activeEnvironment.id
      : unsafeReservation?.kind === "attempt"
      ? unsafeReservation.data.environment_id
      : undefined;
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      message:
        `Execution or recovery still owns this source. Preserve its reservation; use discern done --recover ${environment} from its owning worktree, then preview reconciliation again.`,
    };
  }
  const integration: ExternalIntegrationRecord = observed.existing ??
    {
      kind: "integration",
      version: ON_DISK_FORMATS.completionRecord.version,
      id: SYSTEM_SECURE_ENTROPY.uuid(),
      revision: 1,
      data: {
        source: entry.source,
        candidate_id: observed.candidate.id,
        attempt_id: observed.candidate.data.attempt_id,
        proof_id: observed.proof.id,
        target: observed.candidate.data.head,
        observed_trunk: observation.trunk,
        observed_at: SYSTEM_CLOCK.wallNow(),
      },
    };
  const retirementPlan = planQueueRetirement(integration, records);
  const result: NonNullable<AcceptData["external_integration"]> = {
    ...(observed.existing === undefined
      ? {}
      : { integration_id: integration.id }),
    reservations: reservations.map((record) => record.id),
    effort: entry.source.effort_id,
    candidate_id: observed.candidate.id,
    source_head: entry.source.head,
    proof_id: observed.proof.id,
    target: observed.candidate.data.head,
    observed_trunk: observation.trunk,
    expected_state: expectedState,
    governed_landing_receipt: null,
    state: "planned",
    retirement: retirementPlan.kind === "settled"
      ? retirementPlan.outcome.kind
      : "pending",
  };
  if (options.dryRun) {
    return {
      ok: true,
      verb: "accept",
      dry_run: true,
      data: { external_integration: result },
      message: `${
        markdownCodeSpan(displayBranch(entry.source.branch))
      }'s checked work is already on ${trunk}. Apply this --expected token to record the outside integration; nothing lands again, no approval is spent, and a released checkout is removed.`,
    };
  }
  if (entry.state !== "landed" || observed.existing === undefined) {
    if (options.expected !== expectedState) {
      return {
        ok: false,
        verb: "accept",
        error: "precondition_failed",
        data: { external_integration: result },
        message:
          "Preview reconciliation again and pass its current --expected token.",
      };
    }
    const published = await withQueueLock(root, async () => {
      const fresh = await observeQueue(root, trunk);
      const ref = await runGit(["rev-parse", "--verify", entry.source.branch], {
        cwd: root,
      });
      if (
        (await requireQueue(root)).stamp !== current.stamp ||
        fresh.trunk !== observation.trunk ||
        ref.success && ref.stdout.trim() !== entry.source.head ||
        JSON.stringify(fresh.records) !== JSON.stringify(observation.records)
      ) return false;
      let expectedStamp = current.stamp;
      if (reservations.length > 0 || entry.state === "active") {
        const recovered = await reconcileQueueWork({
          root,
          trunk,
          effort: entry.source.effort_id,
          expected_stamp: expectedStamp,
        });
        if (recovered.kind !== "released") return false;
        expectedStamp = (await requireQueue(root)).stamp;
      }
      if (observed.existing === undefined) {
        const written = await writeCompletionRecord(root, integration, null);
        if (written.kind !== "written") return false;
      }
      return (await mutateQueue({
        root,
        trunk,
        expected_stamp: expectedStamp,
        mutation: {
          kind: "integrated",
          id: integration.id,
          effort: entry.source.effort_id,
        },
      })).kind === "changed";
    });
    if (!published) {
      return {
        ok: false,
        verb: "accept",
        error: "precondition_failed",
        message:
          "The integration observation changed before publication. Preview reconciliation again.",
      };
    }
  }
  const retirement = await retireQueueLanding({
    root,
    trunk,
    config: ctx.config,
    log: ctx.log,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }, integration);
  const settled = planQueueRetirement(
    integration,
    observedRecords(await observeQueue(root, trunk)),
  );
  const retirementId = "record" in settled ? settled.record?.id : undefined;
  const storage = retirement.kind === "retired" && retirementId !== undefined
    ? await reclaimRetirementStorage(
      root,
      [retirementId],
      false,
      options.signal,
    )
    : undefined;
  return {
    ...(retirement.kind === "recovery"
      ? { ok: false as const, error: "incomplete" as const }
      : { ok: true as const }),
    verb: "accept",
    data: {
      ...(storage === undefined ? {} : { storage_cleanup: storage }),
      external_integration: {
        ...result,
        integration_id: integration.id,
        ...(retirementId === undefined ? {} : { retirement_id: retirementId }),
        ...(retirement.kind === "retained"
          ? { retirement_reason: retirement.reason }
          : retirement.kind === "recovery"
          ? { retirement_reason: retirement.recovery.reason }
          : {}),
        state: "observed",
        retirement: retirement.kind,
      },
    },
    message: `Recorded the outside integration of ${
      markdownCodeSpan(displayBranch(entry.source.branch))
    }; its Proof stands, nothing landed again, and no approval was spent. ${
      checkoutOutcomeSentence({
        retirement: retirement.kind,
        ...(retirement.kind === "retained"
          ? { retirement_reason: retirement.reason }
          : retirement.kind === "recovery"
          ? { retirement_reason: retirement.recovery.reason }
          : {}),
      })
    }`,
  };
}
