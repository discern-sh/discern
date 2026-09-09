import { inspectIgnoredFileChanges } from "../worktree/ignored.ts";
import type { RetirementEffects } from "../../shared/accept_landing_state.ts";
import { resolveIdentity } from "../worktree/identity.ts";
import { emitCompletionEvent } from "../completion/events.ts";
import type { Executor } from "../completion/identity.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
/** Landing evidence lives in common storage; retirement consumes only an exact owner release. */
import type { Logger } from "../../lib/log.ts";
import { pinValidatedTree } from "../gate/proof.ts";
import { runGit } from "../../shared/subprocess.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { readTextIfExists, statIfExists } from "../../shared/fs_presence.ts";
import type { CompletionRecord } from "../completion/records.ts";
import type { CompletionRetirement } from "../completion/outcomes.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import {
  OperationLockError,
  withCompletionCheckout,
  withCompletionPublication,
} from "../operation_lock.ts";
import {
  executionChildrenQuiescent,
  withRecordedExecutionChildren,
} from "../execution/lifetime.ts";
import { releasedValidationEnvironment } from "../execution/public_environment.ts";
import {
  replaceEnvironment,
  requireEnvironment,
} from "../execution/registry.ts";
import {
  enrolledDeclaration,
  releaseMatchesSnapshot,
} from "../execution/subjects.ts";
import { withRecoveryStorage } from "../execution/storage_lifetime.ts";
import { saveEnvironmentArtifact } from "../execution/artifacts.ts";
import { readEnvironmentArtifact } from "../execution/artifact_read.ts";
import { WorkspaceStateSchema } from "../execution/workspace_state.ts";
import {
  captureGitSnapshotLike,
  requireRestorableSnapshot,
} from "../execution/snapshot.ts";
import { recoveryFor } from "../execution/types.ts";
import {
  registeredWorktreeRecord,
  removeWorktreeSafely,
  resolveCommonGitDir,
  worktreeGitKey,
} from "../worktree/git.ts";
import {
  classifyAutomaticBranchOwnership,
  deleteAutomaticallyOwnedBranch,
} from "../worktree/ownership.ts";
import {
  captureWorktreeResourceLedger,
  destroyResources,
  inspectResourceEntry,
  type LedgerItem,
  parseResourceEntry,
} from "../worktree/resources.ts";
import { gitValue } from "./composition.ts";
import { observedRecords, observeQueue } from "./repository.ts";
import { sameSource } from "./model.ts";
import type { LandingRecord } from "./publication.ts";

export type IntegratedRecord =
  | LandingRecord
  | Extract<CompletionRecord, { kind: "integration" }>;

type RetirementRecord = Extract<CompletionRecord, { kind: "retirement" }>;
import { RetirementCaptureSchema } from "../execution/artifact_contracts.ts";
export { RetirementCaptureSchema } from "../execution/artifact_contracts.ts";
export const RETIREMENT_BOUNDARIES = [
  "planned",
  "resources",
  "checkout",
  "branch",
  "disposed",
] as const;
export interface RetirementRuntime {
  readonly signal?: AbortSignal;
  readonly root: string;
  readonly trunk: string;
  readonly config: DiscernConfig;
  readonly log: Logger;
  readonly executor?: Executor;
  readonly afterBoundary?: (
    phase: typeof RETIREMENT_BOUNDARIES[number],
    record: RetirementRecord,
  ) => Promise<void>;
}
const bounds = {
  maxFiles: 100_000,
  maxBytes: 1024 * 1024 * 1024,
  gitTimeoutMs: 60_000,
};

/** Compare and publish one retirement revision under the short common lock. */
async function publish(
  runtime: RetirementRuntime,
  record: RetirementRecord,
  stamp: string | null,
): Promise<void> {
  await withCompletionPublication(runtime.root, async () => {
    const written = await writeCompletionRecord(runtime.root, record, stamp);
    if (written.kind !== "written") {
      throw new Error(
        `Retirement publication ${written.kind}; preserve its recorded resources.`,
      );
    }
  });
  if (runtime.executor !== undefined) {
    emitCompletionEvent({
      id: `${record.id}:${record.revision}:retirement`,
      at: SYSTEM_CLOCK.wallNow(),
      effort_id: record.data.source.effort_id,
      source_head: record.data.source.head,
      candidate_id: null,
      environment_id: record.data.environment_id,
      attempt_id: null,
      executor_operation: runtime.executor.operation_id,
      fact: {
        kind: "retirement",
        retirement_id: record.id,
        outcome: record.data.outcome.kind,
      },
    });
  }
}

export type RetirementPlan =
  | {
    kind: "settled";
    outcome: CompletionRetirement["outcome"];
    record?: RetirementRecord;
  }
  | { kind: "resume"; record: RetirementRecord }
  | {
    kind: "inspect";
    environment: Extract<CompletionRecord, { kind: "environment" }>;
  };

/** Read the same retirement decision for execution and public projection. */
export function planQueueRetirement(
  landing: IntegratedRecord,
  records: readonly CompletionRecord[],
): RetirementPlan {
  if (
    landing.kind === "landing" && (landing.data.outcome.kind !== "landed" ||
      landing.data.authority_settlement !== "consumed")
  ) {
    return {
      kind: "settled",
      outcome: { kind: "retained", reason: "ownership-uncertain" },
    };
  }
  const prior = records.filter((record): record is RetirementRecord =>
    record.kind === "retirement" &&
    (landing.kind === "landing"
      ? record.data.landing_id === landing.id
      : record.data.external_integration_id === landing.id)
  );
  const retired = prior.find((record) =>
    record.data.outcome.kind === "retired"
  );
  if (retired !== undefined) {
    return { kind: "settled", outcome: retired.data.outcome, record: retired };
  }
  const environment = records.find((record) =>
    record.kind === "environment" &&
    record.data.ownership.kind === "borrowed" &&
    sameSource(record.data.ownership.source, landing.data.source) &&
    record.data.state.kind !== "disposed"
  );
  const unfinished = prior.find((record) =>
    record.data.capture !== undefined &&
    (record.data.outcome.kind === "pending" ||
      record.data.outcome.kind === "recovery")
  );
  if (unfinished !== undefined) {
    return { kind: "resume", record: unfinished };
  }
  const retained = prior.find((record) =>
    record.data.capture !== undefined &&
    record.data.outcome.kind === "retained" &&
    !(environment?.kind === "environment" &&
      environment.data.state.kind === "idle" &&
      environment.data.release.kind === "released" &&
      environment.data.release.retirement &&
      environment.data.release.id !== record.data.release_id)
  );
  if (retained !== undefined) {
    return {
      kind: "settled",
      outcome: retained.data.outcome,
      record: retained,
    };
  }
  if (environment?.kind !== "environment") {
    return {
      kind: "settled",
      outcome: { kind: "retained", reason: "ownership-uncertain" },
    };
  }
  if (
    environment.data.release.kind !== "released" ||
    !environment.data.release.retirement
  ) {
    return {
      kind: "settled",
      outcome: { kind: "retained", reason: "unreleased" },
    };
  }
  if (environment.data.state.kind !== "idle") {
    return {
      kind: "settled",
      outcome: { kind: "retained", reason: "active-use" },
    };
  }
  return { kind: "inspect", environment };
}

/** Retained paths and cleanup recovery never undo landing or acquire another grant. */
export async function retireQueueLanding(
  runtime: RetirementRuntime,
  landing: IntegratedRecord,
): Promise<CompletionRetirement["outcome"]> {
  runtime = {
    ...runtime,
    executor: runtime.executor ?? {
      operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
      originating_effort:
        (await resolveIdentity(runtime.root, runtime.root)).id,
      started_at: SYSTEM_CLOCK.wallNow(),
    },
  };
  const plan = planQueueRetirement(
    landing,
    observedRecords(await observeQueue(runtime.root, runtime.trunk)),
  );
  if (plan.kind === "settled") return plan.outcome;
  if (plan.kind === "resume") {
    return await applyRetirement(runtime, plan.record);
  }
  const environment = plan.environment;
  const path = environment.data.path;
  try {
    return await withCompletionCheckout(path, async (signal) => {
      const captured = await withRecoveryStorage<
        RetirementRecord | CompletionRetirement["outcome"]
      >(runtime.root, async () => {
        signal.throwIfAborted();
        const current = await requireEnvironment(runtime.root, environment.id);
        if (
          current.record.data.release.kind !== "released" ||
          !current.record.data.release.retirement ||
          current.record.data.state.kind !== "idle"
        ) return { kind: "retained", reason: "unreleased" };
        const pin = await pinValidatedTree(path);
        if (
          pin.head !== landing.data.source.head ||
          await gitValue(path, ["symbolic-ref", "HEAD"]) !==
            landing.data.source.branch
        ) return { kind: "retained", reason: "moved-branch" };
        if (!pin.clean) return { kind: "retained", reason: "dirty" };
        const config = await loadConfig(path);
        const declaration = await enrolledDeclaration(
          current.record.data,
          Object.values(config.execution),
        );
        const capabilities = await releasedValidationEnvironment(
          path,
          config,
          landing.data.source,
          declaration,
          { environment_id: environment.id, expected_stamp: current.stamp },
        );
        if ("kind" in capabilities) {
          return { kind: "retained", reason: "ownership-uncertain" };
        }
        const snapshot = await capabilities.workspace.inspect(
          current.record.data,
          declaration,
          undefined,
          signal,
        );
        if (
          !await releaseMatchesSnapshot(current.record.data, snapshot)
        ) return { kind: "retained", reason: "dirty" };
        await capabilities.workspace.verify(
          current.record.data,
          snapshot,
          signal,
        );
        const state = WorkspaceStateSchema.parse(snapshot.value);
        requireRestorableSnapshot(state.git);
        const branch = landing.data.source.branch.slice("refs/heads/".length);
        const ownership = {
          kind: "worktree" as const,
          branch,
          id: state.worktree_id,
          settings: state.settings,
          source: "registered" as const,
        };
        if (
          !classifyAutomaticBranchOwnership(ownership).owned ||
          state.git === null ||
          state.git.branch !== landing.data.source.branch ||
          state.git.head !== landing.data.source.head
        ) return { kind: "retained", reason: "ownership-uncertain" };
        const frozen: LedgerItem[] = [];
        for (const item of state.ledger) {
          const entry = parseResourceEntry(item.raw);
          if (
            entry.status !== "recorded" || entry.entry.phase !== "ready" ||
            entry.entry.worktree_path !== path ||
            entry.entry.worktree_id !== state.worktree_id ||
            state.resources[entry.entry.resource_name] !==
              entry.entry.resource_identity
          ) return { kind: "retained", reason: "ownership-uncertain" };
          frozen.push({ path: item.path, entry: entry.entry });
        }
        const id = SYSTEM_SECURE_ENTROPY.uuid();
        const recheck = async (): Promise<void> => {
          signal.throwIfAborted();
          if (
            (await requireEnvironment(runtime.root, environment.id)).stamp !==
              current.stamp
          ) {
            throw new Error(
              "Retirement ownership changed during capture; preserve the checkout and replan from its current release.",
            );
          }
        };
        const capture = await saveEnvironmentArtifact(
          runtime.root,
          {
            attempt_id: landing.data.attempt_id,
            candidate_id: landing.data.candidate_id,
            context: "local",
          },
          `retirement-${id}`,
          {
            environment: current.record.data,
            snapshot,
            ignored_file_changes: await inspectIgnoredFileChanges(
              path,
              config.worktree.ignored_file_drift,
            ),
          },
          recheck,
        );
        const record: RetirementRecord = {
          version: ON_DISK_FORMATS.completionRecord.version,
          kind: "retirement",
          id,
          revision: 1,
          data: {
            landing_id: landing.kind === "landing" ? landing.id : null,
            ...(landing.kind === "integration"
              ? { external_integration_id: landing.id }
              : {}),
            source: landing.data.source,
            environment_id: environment.id,
            release_id: current.record.data.release.id,
            ownership: await sha256Hex(
              JSON.stringify(current.record.data.ownership),
            ),
            frozen_cleanup: frozen.map((item) => item.entry.destroy_command)
              .filter(Boolean),
            capture,
            reservation: current.record.revision + 1,
            effects: { worktree_removed: false, branch_deleted: false },
            outcome: { kind: "pending" },
          },
        };
        await withCompletionPublication(runtime.root, async () => {
          await recheck();
          await publish(runtime, record, null);
        });
        return record;
      });
      return captured.kind === "retirement"
        ? await applyRetirement({ ...runtime, signal }, captured)
        : captured;
    }, runtime.signal);
  } catch (error) {
    if (error instanceof OperationLockError) {
      return { kind: "retained", reason: "active-use" };
    }
    return {
      kind: "recovery",
      recovery: recoveryFor(
        "retire",
        error instanceof Error ? error.message : String(error),
        path,
        [],
      ),
    };
  }
}

/** A common capture and reservation are indispensable before any disposable state is removed. */
async function applyRetirement(
  runtime: RetirementRuntime,
  input: RetirementRecord,
): Promise<CompletionRetirement["outcome"]> {
  let record = input;
  let path = runtime.root;
  const settle = async (
    outcome: CompletionRetirement["outcome"],
    effects?: Partial<RetirementEffects>,
  ): Promise<CompletionRetirement["outcome"]> => {
    const current = await readCompletionRecord(runtime.root, {
      kind: "retirement",
      id: record.id,
    });
    if (current.kind !== "recorded" || current.record.kind !== "retirement") {
      throw new Error("Retirement recovery record is unavailable.");
    }
    if (current.record.data.outcome.kind === "retired") {
      return current.record.data.outcome;
    }
    record = {
      ...current.record,
      revision: current.record.revision + 1,
      data: {
        ...current.record.data,
        outcome,
        effects: {
          worktree_removed: false,
          branch_deleted: false,
          ...current.record.data.effects,
          ...effects,
        },
      },
    };
    await publish(runtime, record, current.stamp);
    return outcome;
  };
  try {
    const capture = record.data.capture;
    const reservation = record.data.reservation;
    if (capture === undefined || reservation === undefined) {
      return await settle({ kind: "retained", reason: "ownership-uncertain" });
    }
    const frozen = RetirementCaptureSchema.parse(
      await readEnvironmentArtifact(runtime.root, capture),
    );
    const state = WorkspaceStateSchema.parse(frozen.snapshot.value);
    requireRestorableSnapshot(state.git);
    const environment = frozen.environment;
    path = environment.path;
    if (
      environment.release.kind !== "released" ||
      !environment.release.retirement ||
      environment.release.id !== record.data.release_id ||
      environment.ownership.kind !== "borrowed" ||
      !sameSource(environment.ownership.source, record.data.source) ||
      record.data.ownership !==
        await sha256Hex(JSON.stringify(environment.ownership)) ||
      !await releaseMatchesSnapshot(environment, frozen.snapshot)
    ) return await settle({ kind: "retained", reason: "ownership-uncertain" });
    const run = async (
      signal?: AbortSignal,
    ): Promise<CompletionRetirement["outcome"]> => {
      signal?.throwIfAborted();
      const current = await requireEnvironment(
        runtime.root,
        record.data.environment_id,
      );
      if (
        current.record.data.state.kind === "disposed" &&
        current.record.revision === reservation + 1 &&
        await statIfExists(path) === undefined &&
        await registeredWorktreeRecord(path, runtime.root) === undefined
      ) {
        const branch = await runGit([
          "show-ref",
          "--verify",
          "--quiet",
          record.data.source.branch,
        ], { cwd: runtime.root });
        if (branch.code === 1) {
          return await settle({
            kind: "retired",
            at: current.record.data.state.at,
          });
        }
        return await settle({ kind: "retained", reason: "moved-branch" });
      }
      if (
        current.record.revision === reservation - 1 &&
        current.record.data.release.kind === "released" &&
        current.record.data.release.id === record.data.release_id &&
        current.record.data.state.kind === "idle"
      ) {
        await withCompletionPublication(
          runtime.root,
          () =>
            replaceEnvironment(runtime.root, current, {
              ...current.record.data,
              release: { kind: "held" },
            }, SYSTEM_CLOCK),
        );
      } else if (
        current.record.revision !== reservation ||
        current.record.data.release.kind !== "held" ||
        current.record.data.state.kind !== "idle"
      ) {
        return await settle({
          kind: "retained",
          reason: "ownership-uncertain",
        });
      }
      await runtime.afterBoundary?.("planned", record);
      const branch = record.data.source.branch.slice("refs/heads/".length);
      const ownership = {
        kind: "worktree" as const,
        branch,
        id: state.worktree_id,
        settings: state.settings,
        source: "registered" as const,
      };
      if (!classifyAutomaticBranchOwnership(ownership).owned) {
        return await settle({
          kind: "retained",
          reason: "ownership-uncertain",
        });
      }
      const exists = await statIfExists(path);
      const registration = await registeredWorktreeRecord(path, runtime.root);
      if (exists !== undefined) {
        if (
          registration === undefined || registration.locked ||
          state.git === null
        ) {
          return await settle({
            kind: "retained",
            reason: "ownership-uncertain",
          });
        }
        const git = await captureGitSnapshotLike(
          path,
          { ...bounds, ...(signal === undefined ? {} : { signal }) },
          state.git,
          runtime.root,
        );
        requireRestorableSnapshot(git);
        if (
          git.head !== record.data.source.head ||
          git.branch !== record.data.source.branch ||
          await gitValue(runtime.root, [
              "rev-parse",
              record.data.source.branch,
            ]) !== record.data.source.head
        ) return await settle({ kind: "retained", reason: "moved-branch" });
        if (
          git.status !== "" || JSON.stringify(git) !== JSON.stringify(state.git)
        ) return await settle({ kind: "retained", reason: "dirty" });
        const common = await resolveCommonGitDir(path);
        const gitKey = await worktreeGitKey(path);
        if (common === undefined || gitKey === undefined) {
          return await settle({
            kind: "retained",
            reason: "ownership-uncertain",
          });
        }
        const inventory = await captureWorktreeResourceLedger(
          common,
          gitKey,
          path,
        );
        if (
          inventory.some((item) =>
            !state.ledger.some((frozen) =>
              frozen.path === item.path && frozen.raw === item.raw
            )
          )
        ) {
          return await settle({
            kind: "retained",
            reason: "ownership-uncertain",
          });
        }
        const entries: LedgerItem[] = [];
        for (const item of state.ledger) {
          const prior = parseResourceEntry(item.raw);
          const live = await inspectResourceEntry(item.path);
          if (live.status === "missing") continue;
          if (
            prior.status !== "recorded" || live.status !== "recorded" ||
            await readTextIfExists(item.path) !== item.raw
          ) {
            return await settle({
              kind: "retained",
              reason: "ownership-uncertain",
            });
          }
          entries.push({ path: item.path, entry: prior.entry });
        }
        await withRecordedExecutionChildren(
          runtime.root,
          {
            attempt_id: record.id,
            candidate_id: capture.candidate_id,
            context: capture.context,
          },
          record.id,
          async () => {
            const destroyed = await destroyResources({
              config: runtime.config,
              ...(signal === undefined ? {} : { signal }),
              cwd: path,
              log: runtime.log,
            }, entries);
            if (destroyed.failed.length) {
              throw new Error(
                `Retirement kept resources requiring recovery: ${
                  destroyed.failed.join(", ")
                }.`,
              );
            }
          },
        );
        if (!await executionChildrenQuiescent(runtime.root, record.id)) {
          throw new Error("Retirement children remain active or uncertain.");
        }
        await runtime.afterBoundary?.("resources", record);
        if (
          JSON.stringify(
            await captureGitSnapshotLike(
              path,
              { ...bounds, ...(signal === undefined ? {} : { signal }) },
              git,
              runtime.root,
            ),
          ) !==
            JSON.stringify(git)
        ) return await settle({ kind: "retained", reason: "dirty" });
        if (
          (await captureWorktreeResourceLedger(common, gitKey, path)).length !==
            0
        ) {
          return await settle({
            kind: "retained",
            reason: "ownership-uncertain",
          });
        }
        signal?.throwIfAborted();
        await removeWorktreeSafely(path, runtime.root);
      } else if (registration !== undefined) {
        return await settle({
          kind: "retained",
          reason: "ownership-uncertain",
        });
      }
      await settle(record.data.outcome, { worktree_removed: true });
      await runtime.afterBoundary?.("checkout", record);
      signal?.throwIfAborted();
      const deleted = await withCompletionPublication(
        runtime.root,
        () =>
          deleteAutomaticallyOwnedBranch({
            repoRoot: runtime.root,
            branch,
            expectedCommit: record.data.source.head,
            ownership,
            mergedInto: runtime.trunk,
          }),
      );
      if (deleted.kind === "refused") {
        if (deleted.refusal === "unavailable") {
          throw new Error(
            `Branch retirement needs recovery: ${deleted.reason}`,
          );
        }
        return await settle({
          kind: "retained",
          reason: deleted.refusal === "changed"
            ? "moved-branch"
            : deleted.refusal === "in-use"
            ? "active-use"
            : "ownership-uncertain",
        });
      }
      await settle(record.data.outcome, { branch_deleted: true });
      await runtime.afterBoundary?.("branch", record);
      const enrolled = await requireEnvironment(
        runtime.root,
        record.data.environment_id,
      );
      await withCompletionPublication(
        runtime.root,
        () =>
          replaceEnvironment(runtime.root, enrolled, {
            ...enrolled.record.data,
            state: { kind: "disposed", at: SYSTEM_CLOCK.wallNow() },
          }, SYSTEM_CLOCK),
      );
      await runtime.afterBoundary?.("disposed", record);
      return await settle({ kind: "retired", at: SYSTEM_CLOCK.wallNow() });
    };
    return await statIfExists(path) === undefined
      ? await run(runtime.signal)
      : await withCompletionCheckout(path, run, runtime.signal);
  } catch (error) {
    if (error instanceof OperationLockError) {
      return { kind: "retained", reason: "active-use" };
    }
    return await settle({
      kind: "recovery",
      recovery: recoveryFor(
        "retire",
        error instanceof Error ? error.message : String(error),
        path,
        record.data.frozen_cleanup,
      ),
    });
  }
}
