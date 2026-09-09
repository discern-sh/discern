import { sha256Hex } from "../../shared/sha256.ts";
import { inspectLandingAuthority } from "../worktree/landing_authority.ts";
import { clearReviewedEffortGrant } from "../worktree/effort_grant_cleanup.ts";
import { registeredSourcePath } from "./public_authority.ts";
/** Reviewable owner changes to the canonical queue, without validation or landing. */
import type { QueueControl } from "../../shared/queue_control.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type { AcceptData } from "../../shared/result_schemas.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import type { LifecycleContext } from "../worktree/lifecycle.ts";
import { integrationBranch, mainRepoPath } from "../worktree/git.ts";
import { resolveIdentity } from "../worktree/identity.ts";
import { resolveWorktreeTarget } from "../worktree/target_resolution.ts";
import { orderedEntries } from "./model.ts";
import {
  mutateQueue,
  planQueueMutation,
  type QueueMutation,
} from "./mutations.ts";
import {
  observedQueue,
  observedRecords,
  observeQueue,
  requireQueue,
  withQueueLock,
} from "./repository.ts";
import { acceptancePending } from "./public_result.ts";

export interface QueueControlOptions {
  readonly control: QueueControl;
  readonly target?: string;
  readonly order?: string[];
  readonly expected?: string;
  readonly confirmed?: boolean;
  readonly dryRun?: boolean;
}

/** The preview token pins the queue; publication repeats that compare under common exclusion. */
export async function queueControlResult(
  ctx: LifecycleContext,
  options: QueueControlOptions,
): Promise<DiscernResult<AcceptData>> {
  const root = await mainRepoPath(ctx.cwd);
  if (root === undefined) {
    return { ok: false, verb: "accept", error: "no_repository" };
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
        "No usable queue is available. Complete the selected committed effort first, or resolve the reported record condition.",
      data: { pending: [acceptancePending(current)] },
    };
  }
  if (options.control !== "reprioritize" && options.order !== undefined) {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      message:
        "Use --order only with reprioritize; preview each queue decision separately.",
    };
  }
  const queue = current.record.data;
  const resolve = async (token: string): Promise<string | undefined> => {
    if (queue.entries.some((entry) => entry.source.effort_id === token)) {
      return token;
    }
    const resolved = await resolveWorktreeTarget(root, token, {
      cwd: ctx.cwd,
      mode: "branch",
      command: "accept",
    });
    return queue.entries.find((entry) =>
      entry.source.effort_id === resolved.id ||
      entry.source.branch === resolved.ref
    )?.source.effort_id;
  };
  const target = options.target === undefined
    ? (await resolveIdentity(ctx.cwd, ctx.cwd)).id
    : await resolve(options.target);
  const entry = queue.entries.find((entry) =>
    entry.source.effort_id === target
  );
  if (
    options.control !== "reprioritize" &&
    (entry === undefined || entry.state === "landed")
  ) {
    return {
      ok: false,
      verb: "accept",
      error: "no_target",
      message:
        "Select an unlanded effort with --target <effort-id>. Landed outcomes cannot be changed by queue controls.",
    };
  }
  const before = orderedEntries(queue).filter((entry) =>
    entry.eligible_order !== null
  ).map((entry) => entry.source.effort_id);
  const order: string[] = [];
  for (const token of options.order ?? []) {
    const effort = await resolve(token);
    if (effort === undefined) {
      return {
        ok: false,
        verb: "accept",
        error: "no_target",
        message: `No queued effort matches '${token}'.`,
      };
    }
    order.push(effort);
  }
  const sourcePath = entry === undefined
    ? undefined
    : await registeredSourcePath(root, entry.source);
  const grantId = options.control === "revoke" && sourcePath !== undefined
    ? (await inspectLandingAuthority(sourcePath, trunk)).effortGrant?.id ?? null
    : null;
  const expectedState = await sha256Hex(
    JSON.stringify({ queue: current.stamp, grant: grantId }),
  );
  const mutation: QueueMutation = options.control === "reprioritize"
    ? {
      kind: "reprioritize",
      decision: { id: SYSTEM_SECURE_ENTROPY.uuid(), expected: before, order },
    }
    : {
      kind: options.control === "withdraw"
        ? "withdrawn"
        : options.control === "revoke"
        ? "authority-revoked"
        : options.control,
      effort: target ?? "",
      ...(options.control === "revoke" ? { grant_id: grantId } : {}),
    };
  const planned = planQueueMutation(
    queue,
    observedRecords(observation),
    observation.trunk,
    mutation,
  );
  if (planned.kind !== "changed") {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      message: acceptancePending(planned).reason,
      data: { pending: [acceptancePending(planned)] },
    };
  }
  const after = orderedEntries(planned.queue).filter((entry) =>
    entry.eligible_order !== null
  ).map((entry) => entry.source.effort_id);
  const applied = options.control === "hold"
    ? entry?.held === true
    : options.control === "resume"
    ? entry?.held === false
    : options.control === "withdraw"
    ? entry?.state === "withdrawn"
    : options.control === "revoke"
    ? entry?.revoked_grant !== undefined && entry.authority_id === null &&
      (grantId === null || grantId === entry.revoked_grant)
    : JSON.stringify(before) === JSON.stringify(order);
  const control: NonNullable<AcceptData["queue_control"]> = {
    action: options.control,
    target: target ?? null,
    expected_state: expectedState,
    before_order: before,
    after_order: after,
    affected_efforts: [...planned.invalidation?.efforts ?? []],
    state: "planned",
  };
  if (options.dryRun) {
    return {
      ok: true,
      verb: "accept",
      dry_run: true,
      data: { queue_control: control },
      message:
        "Queue change planned. Review the target and affected efforts; apply with --confirmed and --expected <expected_state>. No evidence or authority was changed.",
    };
  }
  if (applied && !(options.control === "revoke" && grantId !== null)) {
    return {
      ok: true,
      verb: "accept",
      data: { queue_control: { ...control, state: "applied" } },
      message: "The requested queue state is already established.",
    };
  }
  if (!applied && !options.confirmed) {
    return {
      ok: false,
      verb: "accept",
      error: "awaiting_consent",
      data: { queue_control: control },
      message:
        "This queue change requires the owner's instruction. Review the plan, then use --confirmed with its --expected token.",
    };
  }
  if (!applied && options.expected !== expectedState) {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      data: { queue_control: control },
      message:
        "The queue differs from the reviewed plan, or its token is missing. Preview this action again and apply its current --expected token.",
    };
  }
  const changed = await withQueueLock(root, async () => {
    if ((await requireQueue(root)).stamp !== current.stamp) {
      return { kind: "replan" as const };
    }
    if (
      options.control === "revoke" && sourcePath !== undefined &&
      ((await inspectLandingAuthority(sourcePath, trunk)).effortGrant?.id ??
          null) !== grantId
    ) return { kind: "replan" as const };
    const changed = await mutateQueue({
      root,
      trunk,
      expected_stamp: current.stamp,
      mutation,
    });
    if (
      changed.kind === "changed" && grantId !== null &&
      sourcePath !== undefined &&
      !await clearReviewedEffortGrant(sourcePath, grantId)
    ) return { kind: "replan" as const };
    return changed;
  });
  if (changed.kind !== "changed") {
    return {
      ok: false,
      verb: "accept",
      error: "precondition_failed",
      data: { queue_control: control },
      message:
        "The queue changed before publication. Preview the requested action again.",
    };
  }
  return {
    ok: true,
    verb: "accept",
    data: { queue_control: { ...control, state: "applied" } },
    message:
      "Queue change recorded. Candidate evidence is retained. Use accept --target <effort-id> to continue eligible work.",
  };
}
