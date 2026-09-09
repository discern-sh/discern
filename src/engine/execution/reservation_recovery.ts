/** A queue claim that never entered execution returns without running a checkout procedure. */
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { writeCompletionRecord } from "../completion/store.ts";
import { sameSource } from "../landing_queue/model.ts";
import {
  observedRecords,
  observeQueue,
  replaceQueue,
  requireQueue,
  withQueueLock,
} from "../landing_queue/repository.ts";
import { withCompletionRecovery } from "../operation_lock.ts";
import { loadIdentitySettings, resolveIdentity } from "../worktree/identity.ts";
import { replaceEnvironment, requireEnvironment } from "./registry.ts";
import { enrolledDeclaration, releaseMatchesSnapshot } from "./subjects.ts";
import { validationWorkspace } from "./public_environment.ts";

/** Recheck the unexecuted prefix under native ownership and the queue publication boundary. */
export async function recoverUnexecutedReservation(
  root: string,
  environmentId: string,
  expectedStamp: string,
  config: DiscernConfig,
  dryRun: boolean,
): Promise<boolean> {
  return await withCompletionRecovery(root, async (signal) => {
    const identity = await resolveIdentity(root, root);
    return await withQueueLock(root, async () => {
      const current = await requireEnvironment(root, environmentId);
      const environment = current.record.data;
      if (
        current.stamp !== expectedStamp || environment.path !== root ||
        environment.ownership.kind !== "borrowed" ||
        environment.ownership.source.effort_id !== identity.id ||
        environment.state.kind !== "idle"
      ) {
        throw new Error(
          "Unexecuted reservation ownership changed; preserve the checkout and observe it again.",
        );
      }
      const queue = await requireQueue(root);
      const entry = queue.record.data.entries.find((item) =>
        item.source.effort_id === identity.id
      );
      if (entry?.state !== "active" || entry.candidate_id === null) {
        return false;
      }
      if (!sameSource(entry.source, environment.ownership.source)) {
        throw new Error(
          "The queue source differs from the released checkout; preserve both ownership records.",
        );
      }
      const observation = await observeQueue(root, queue.record.data.trunk);
      if (
        observation.records.some(({ reading }) =>
          reading.kind !== "recorded" && reading.kind !== "missing"
        )
      ) {
        throw new Error(
          "Unreadable completion state prevents reservation recovery.",
        );
      }
      const records = observedRecords(observation);
      const attempts = records.filter((record) =>
        record.kind === "attempt" &&
        record.data.identity.candidate_id === entry.candidate_id
      );
      const returnedAttemptId = environment.state.returned_attempt_id;
      if (attempts.some((record) => record.id === returnedAttemptId)) {
        return false;
      }
      const actors = new Set<string>();
      for (const record of attempts) {
        if (record.kind !== "attempt") continue;
        actors.add(record.data.identity.executor.operation_id);
        if (
          record.data.environment_id !== environmentId ||
          record.data.subjects.length !== 0 ||
          record.data.purpose !== "completion" ||
          record.data.state.kind === "composing" ||
          record.data.state.kind === "planned" ||
          (record.data.state.kind === "finished" &&
            record.data.state.outcome !== "cancelled")
        ) {
          throw new Error(
            "This reservation has execution evidence or another environment; recover its exact attempt instead.",
          );
        }
      }
      if (
        actors.size > 1 ||
        records.some((record) =>
          record.kind === "environment" &&
          record.id !== environmentId &&
          record.data.state.kind === "executing" &&
          record.data.state.candidate_id === entry.candidate_id
        )
      ) {
        throw new Error(
          "Another operation shares this candidate; preserve its reservation and recover that operation separately.",
        );
      }
      const declaration = await enrolledDeclaration(
        environment,
        Object.values(config.execution),
      );
      const workspace = validationWorkspace(
        root,
        config,
        environmentId,
        await loadIdentitySettings(root),
      );
      const snapshot = await workspace.inspect(
        environment,
        declaration,
        environment.release.kind === "released" &&
          environment.release.retirement
          ? "release"
          : declaration === null
          ? "source"
          : "recovery",
        signal,
      );
      if (
        environment.release.kind === "released" &&
        !await releaseMatchesSnapshot(environment, snapshot)
      ) {
        throw new Error(
          "The unexecuted checkout differs from its release. Preserve the changed files and reconcile the exact release before recovery.",
        );
      }
      if (
        environment.release.kind === "held" &&
        attempts.some((record) =>
          record.kind === "attempt" && record.data.state.kind !== "finished"
        )
      ) {
        throw new Error(
          "The reservation has no verified release or completed cancellation; preserve its ownership records.",
        );
      }
      await workspace.verify(environment, snapshot, signal);
      if (dryRun) return true;
      for (const { reading } of observation.records) {
        if (
          reading.kind !== "recorded" || reading.record.kind !== "attempt" ||
          !attempts.some((record) => record.id === reading.record.id) ||
          reading.record.data.state.kind === "finished"
        ) continue;
        const written = await writeCompletionRecord(root, {
          ...reading.record,
          revision: reading.record.revision + 1,
          data: {
            ...reading.record.data,
            state: {
              kind: "finished",
              outcome: "cancelled",
              finished_at: SYSTEM_CLOCK.wallNow(),
            },
          },
        }, reading.stamp);
        if (written.kind !== "written") {
          throw new Error(
            "Reservation settlement changed; retry supported recovery without changing the checkout.",
          );
        }
      }
      if (environment.release.kind === "released") {
        await replaceEnvironment(root, current, {
          ...environment,
          release: { kind: "held" },
        }, SYSTEM_CLOCK);
      }
      const written = await replaceQueue(root, queue, {
        ...queue.record.data,
        entries: queue.record.data.entries.map((item) =>
          item !== entry ? item : {
            ...item,
            state: item.authority_id === null ? "provisional" : "eligible",
          }
        ),
      }, SYSTEM_CLOCK);
      if (written.kind !== "written") {
        throw new Error(
          "Checkout return is verified; retry recovery to reconcile its remaining reservation.",
        );
      }
      return true;
    });
  });
}
