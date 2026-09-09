import { runGit } from "../../shared/subprocess.ts";
import { executionRecoveryCommand } from "../../shared/execution_recovery.ts";
/** Explicit checkout return uses frozen intent; it never runs validation or publishes Proof. */
import { loadConfig } from "../../shared/config_schema.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type { GateData, StatusData } from "../../shared/result_schemas.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import { RecordIdSchema } from "../completion/identity.ts";
import {
  observeCompletionCheckout,
  withCompletionRecovery,
} from "../operation_lock.ts";
import { loadIdentitySettings, resolveIdentity } from "../worktree/identity.ts";
import { integrationBranch } from "../worktree/git.ts";
import { gitValue } from "../landing_queue/composition.ts";
import {
  observedRecords,
  REPOSITORY_QUEUE_ID,
  requireQueue,
} from "../landing_queue/repository.ts";
import { readCompletionRecord } from "../completion/store.ts";
import { reconcileQueueWork } from "../landing_queue/recovery.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { requireEnvironment } from "./registry.ts";
import {
  createEnvironmentExecutor,
  type EnvironmentExecutorOptions,
} from "./executor.ts";
import {
  createNativeExecutionLifetime,
  executionChildrenQuiescent,
} from "./lifetime.ts";
import { loadExecutionIntent } from "./intent.ts";
import { validationWorkspace } from "./public_environment.ts";
import { errorReason } from "./types.ts";
import { recoverUnexecutedReservation } from "./reservation_recovery.ts";

/** A fresh public observation supplies the CAS stamp; no user edits a record or lease. */
export async function recoverCompletionResult(
  root: string,
  id: string,
  dryRun = false,
  hooks: Pick<
    EnvironmentExecutorOptions,
    "afterReturn" | "afterPhase" | "afterRecoveryPublication"
  > = {},
): Promise<DiscernResult<GateData>> {
  const data: GateData = {
    gate_ran: false,
    failed_stage: null,
    scopes_changed: [],
  };
  try {
    RecordIdSchema.parse(id);
    root = await Deno.realPath(root);
    return await withCompletionRecovery(root, async () => {
      const observed = await requireEnvironment(root, id);
      const environment = observed.record.data;
      const identity = await resolveIdentity(root, root);
      if (
        environment.path !== root ||
        environment.ownership.kind !== "borrowed" ||
        environment.ownership.source.effort_id !== identity.id
      ) {
        throw new Error(
          "Recovery must run from this borrowed environment's positively owned worktree. Preserve the recorded checkout and use its owner.",
        );
      }
      const source = environment.ownership.source;
      if (
        await gitValue(root, ["rev-parse", "--verify", source.branch]) !==
          source.head
      ) {
        throw new Error(
          "The recorded source branch changed. Preserve the environment and reconcile its exact source before recovery.",
        );
      }
      const queue = await requireQueue(root);
      const entry = queue.record.data.entries.find((item) =>
        item.source.effort_id === identity.id
      );
      const state = environment.state;
      if (
        state.kind === "idle" && entry?.state === "active" &&
        await recoverUnexecutedReservation(
          root,
          id,
          observed.stamp,
          await loadConfig(root),
          dryRun,
        )
      ) {
        return {
          ok: true,
          verb: "done",
          ...(dryRun ? { dry_run: true } : {}),
          data,
          message: dryRun
            ? "The unexecuted reservation can return after rechecking its release and ownership. No validation or landing will run."
            : "The unchanged checkout and its unexecuted reservation have returned to the owner. No validation or landing ran.",
        };
      }
      const attemptId = state.kind === "executing" || state.kind === "recovery"
        ? state.attempt_id
        : state.kind === "idle"
        ? state.returned_attempt_id
        : undefined;
      if (attemptId === undefined) {
        if (state.kind !== "idle" || entry?.state === "active") {
          throw new Error(
            "No exact returned attempt supports queue recovery. Preserve the environment and its execution artifacts.",
          );
        }
        return {
          ok: true,
          verb: "done",
          message:
            "The checkout has already returned. No validation or landing ran.",
          data,
        };
      }
      const intent = await loadExecutionIntent(root, attemptId, id);
      if (
        intent.environment.path !== root ||
        JSON.stringify(intent.environment.ownership) !==
          JSON.stringify(environment.ownership) ||
        (entry?.state === "active" &&
          entry.candidate_id !== intent.candidate_id)
      ) {
        throw new Error(
          "The current environment or queue no longer belongs to this frozen recovery subject. Observe the newer operation before proceeding.",
        );
      }
      if (dryRun) {
        return {
          ok: true,
          verb: "done",
          dry_run: true,
          message:
            `Recover environment ${id} for ${source.branch} at ${source.head}: prove child quiescence, capture retained state, apply its frozen return contract, verify return, then reconcile only its queue reservation. No validation or landing will run.`,
          data,
        };
      }
      const config = await loadConfig(root);
      const executor = createEnvironmentExecutor({
        ...hooks,
        root,
        environmentId: id,
        declaration: intent.recipe.declaration,
        workspace: validationWorkspace(
          root,
          config,
          id,
          await loadIdentitySettings(root),
        ),
        lifetime: createNativeExecutionLifetime(root),
        leaseMs: 300_000,
        reserveAttempt: () => {
          throw new Error("Recovery cannot reserve validation work.");
        },
        validationOutcome: () => "cancelled",
      });
      const returned = await executor.recover(id, observed.stamp, {
        operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
        originating_effort: identity.id,
        started_at: SYSTEM_CLOCK.wallNow(),
      });
      if (returned.kind === "recovery-incomplete") {
        throw new Error(returned.recovery.reason);
      }
      const freshQueue = await requireQueue(root);
      const current = freshQueue.record.data.entries.find((item) =>
        item.source.effort_id === identity.id
      );
      if (current?.state === "active") {
        if (current.candidate_id !== intent.candidate_id) {
          throw new Error(
            "Checkout returned, but a newer queue candidate requires its own recovery. No queue entry changed.",
          );
        }
        const reconciled = await reconcileQueueWork({
          root,
          trunk: integrationBranch(config.repository.trunk),
          effort: identity.id,
          expected_stamp: freshQueue.stamp,
          returned_attempt: attemptId,
        });
        if (reconciled.kind !== "released") {
          throw new Error(
            `Checkout return succeeded; queue recovery remains pending: ${
              JSON.stringify(reconciled)
            }. Retry the same recovery command after the named operation settles.`,
          );
        }
      }
      return {
        ok: true,
        verb: "done",
        message:
          "Checkout return and queue recovery completed. Authoring control has returned; retained artifacts and validation evidence remain intact. No validation or landing ran.",
        data,
        hints: hintTexts([
          fire(HINTS["completion-pending"], {
            action:
              "Run discern done on the prepared committed source to reuse applicable evidence and complete any remaining validation.",
          }),
        ]),
      };
    });
  } catch (error) {
    return {
      ok: false,
      verb: "done",
      error: "incomplete",
      message: errorReason(error),
      data,
      hints: hintTexts([fire(HINTS["execution-recovery"], { id })]),
    };
  }
}

/** Read-only local obligations remain visible even if temporary detachment hides a branch. */
export async function executionStatus(
  root: string,
): Promise<Pick<StatusData, "execution_activity" | "execution_recovery">> {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
  });
  if (!inside.success || inside.stdout.trim() !== "true") return {};
  const records = observedRecords(
    await observeCompletionRecords(root, SYSTEM_CLOCK, ["environment"]),
  );
  const canonical = await Deno.realPath(root);
  const activity: NonNullable<StatusData["execution_activity"]> = [];
  const recovery: NonNullable<StatusData["execution_recovery"]> = [];
  for (const record of records) {
    if (record.kind !== "environment" || record.data.path !== canonical) {
      continue;
    }
    const state = record.data.state;
    if (state.kind === "executing") {
      const observed = await observeCompletionCheckout(root);
      const childrenQuiescent = observed.ownership === "available"
        ? await executionChildrenQuiescent(root, state.attempt_id)
        : undefined;
      activity.push({
        environment_id: record.id,
        attempt_id: state.attempt_id,
        candidate_id: state.candidate_id,
        phase: state.phase,
        lease_expires_at: state.claim.expires_at,
        ownership: observed.ownership,
        ...(childrenQuiescent === undefined
          ? {}
          : { children_quiescent: childrenQuiescent }),
        reason: childrenQuiescent === false
          ? `${observed.reason} Recorded child absence remains unproved.`
          : observed.reason,
        next_action: observed.ownership === "held"
          ? "Let the owning operation finish or cancel it through its running handle; recovery rechecks exclusion."
          : `Run ${
            executionRecoveryCommand(record.id)
          } from this worktree. Recovery rechecks ownership and child quiescence before return; the validation deadline does not delay native takeover.`,
      });
    }
    if (state.kind === "idle" && record.data.ownership.kind === "borrowed") {
      const queue = await readCompletionRecord(root, {
        kind: "queue",
        id: REPOSITORY_QUEUE_ID,
      });
      const effort = record.data.ownership.source.effort_id;
      if (
        queue.kind === "recorded" && queue.record.kind === "queue" &&
        queue.record.data.entries.some((entry) =>
          entry.state === "active" && entry.source.effort_id === effort
        )
      ) {
        recovery.push({
          environment_id: record.id,
          phase: "reservation",
          reason:
            "The checkout is idle but its queue reservation remains recorded. The owning command may still be settling it; recovery rechecks native ownership and the exact release before reconciliation.",
          retained_paths: [canonical],
          next_action: executionRecoveryCommand(record.id),
        });
      }
    }
    if (state.kind === "recovery") {
      recovery.push({
        environment_id: record.id,
        attempt_id: state.attempt_id,
        phase: state.recovery.phase,
        children_quiescent: state.recovery.children_quiescent,
        reason: state.recovery.reason,
        retained_paths: state.recovery.retained_paths,
        next_action: executionRecoveryCommand(record.id),
      });
    }
  }
  return {
    ...(activity.length ? { execution_activity: activity } : {}),
    ...(recovery.length ? { execution_recovery: recovery } : {}),
  };
}

/** Recovery consumers share the status observation instead of reconstructing its fields. */
export async function executionRecoveryStatus(
  root: string,
): Promise<NonNullable<StatusData["execution_recovery"]>> {
  return (await executionStatus(root)).execution_recovery ?? [];
}

/** Recovery and validation are separate actions, including across CLI and MCP. */
export function recoveryArgumentConflict(options: {
  ci?: boolean;
  rerun?: boolean;
  standalone?: boolean;
  retainCheckout?: boolean;
  releaseCheckout?: boolean;
  context?: string;
  policyBase?: string;
  met?: string[];
  unmet?: unknown;
  execution?: unknown;
}): boolean {
  return options.ci === true || options.rerun === true ||
    options.standalone === true ||
    options.retainCheckout === true || options.releaseCheckout === true ||
    options.context !== undefined ||
    options.policyBase !== undefined ||
    (options.met?.length ?? 0) > 0 || options.unmet !== undefined ||
    options.execution !== undefined;
}

/** CLI and MCP validate recovery options through the same result boundary. */
export async function recoveryRequestResult(
  root: string,
  options: Parameters<typeof recoveryArgumentConflict>[0] & {
    recover?: string;
    dryRun?: boolean;
  },
): Promise<DiscernResult<GateData> | undefined> {
  if (options.recover === undefined) return undefined;
  if (recoveryArgumentConflict(options)) {
    return {
      ok: false,
      verb: "done",
      error: "invalid_arguments",
      message:
        "Recovery cannot be combined with validation, release, policy, or judgment options. Run done --recover separately.",
    };
  }
  return await recoverCompletionResult(root, options.recover, options.dryRun);
}
