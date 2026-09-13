/**
 * Compose and check a moved trunk inside a disposable integration worktree.
 *
 * When the shared branch has moved since a submission's Proof, the landing
 * creates a fresh worktree from the submitted revision through the same
 * creation path `start` uses (setup and resources included), records its
 * ownership and the frozen submission snapshot before any effect, brings the
 * trunk in through the update core, proves the combined committed tree with
 * the gate core, and hands the proven commit back for the acceptance
 * transaction. Conflicts and red checks clean the copy up and stop; the
 * author's worktree is never touched. Cleanup intent survives interruption in
 * the integration-landing record, so `discern worktree prune` can finish what
 * a dead process left.
 */

import { dirname, join } from "@std/path";
import type { Logger } from "../../lib/log.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../../shared/clock.ts";
import type { CliModelProvider } from "../../shared/cli_reference_codegen.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { fileExists } from "../../shared/fs_presence.ts";
import { INTEGRATION_BRANCH_NAMESPACE } from "../../shared/git_conventions.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { parsePorcelainZ } from "../../shared/git_paths.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type { GateData, Proof } from "../../shared/result_schemas.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  type StoredTaskMetadata,
  TASK_METADATA_SCHEMA_VERSION,
} from "../../shared/task_metadata.ts";
import { emitCompletionProgress } from "../completion/events.ts";
import type { SourceRevision } from "../completion/identity.ts";
import { finishResult } from "../gate/finish.ts";
import { withIntegrationCheckout } from "../operation_lock.ts";
import {
  localBranchExists,
  removeWorktreeSafely,
  WorktreeGitError,
} from "./git.ts";
import { generateWorktreeId, type IdentitySettings } from "./identity.ts";
import {
  type IntegrationLandingRecord,
  removeIntegrationLandingRecord,
  writeIntegrationLandingRecord,
} from "./integration_record.ts";
import {
  applyUpdateCore,
  buildUpdatePlan,
  createAndSetupWorktree,
  lifecycleContext,
  teardownResources,
} from "./lifecycle.ts";
import { deleteAutomaticallyOwnedBranch } from "./ownership.ts";
import type { Submission } from "./submission.ts";

/** The author's effort as the integration phase needs it. */
export interface IntegrationEffort {
  readonly path: string;
  readonly branch: string;
  readonly id: string;
  readonly mainRepo: string;
  readonly trunk: string;
  readonly settings: IdentitySettings;
}

/** What one composition attempt established. On `green` the integration
 * worktree still exists — the proven commit must stay reachable through its
 * branch until the trunk transition lands — and the caller settles cleanup. */
export type IntegrationAttempt =
  | {
    readonly kind: "setup-failed";
    readonly reason: string;
    readonly cleanupFailures: readonly string[];
  }
  | {
    readonly kind: "conflict";
    readonly files: readonly string[];
    readonly cleanupFailures: readonly string[];
  }
  | {
    readonly kind: "red";
    readonly result: DiscernResult<GateData>;
    readonly cleanupFailures: readonly string[];
  }
  | {
    readonly kind: "green";
    readonly record: IntegrationLandingRecord;
    readonly head: string;
    readonly proof: Proof;
    readonly proofPointer: {
      readonly candidate_id: string;
      readonly proof_id: string;
    };
  };

/** Mint a free integration worktree identity beside the authoring worktrees:
 * branch `integration/<effort>-<suffix>`, directory `integration-<...>`. */
async function mintIntegrationWorktree(
  mainRepo: string,
  worktreeRoot: string,
  effortId: string,
): Promise<{ id: string; branch: string; dir: string }> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const minted = generateWorktreeId(`integration-${effortId}`);
    const id = minted.id.startsWith("integration-")
      ? minted.id
      : `integration-${minted.id}`;
    const branch = `${INTEGRATION_BRANCH_NAMESPACE}${
      id.slice("integration-".length)
    }`;
    const dir = join(worktreeRoot, id);
    if (
      !(await localBranchExists(mainRepo, branch)) &&
      !(await fileExists(join(dir, ".git")))
    ) {
      return { id, branch, dir };
    }
  }
  throw new WorktreeGitError(
    "discern could not find a free integration worktree name after many attempts. Run `discern worktree prune` from the main checkout, then re-run `discern accept`.",
  );
}

/** Copy the author's worktree-scoped decision stores — checkpoint conclusions
 * and standard-limit proposals — into the integration copy. They are the
 * author's recorded decisions traveling with their evidence; each subsystem's
 * own currency validation still decides whether they hold on the combined
 * tree. Absent stores stay absent. */
async function copyAuthorDecisionState(
  from: string,
  to: string,
): Promise<void> {
  for (
    const key of ["checkpointOpenQuestions", "standardLimitProposals"] as const
  ) {
    const source = await gitAdminStatePath(from, key);
    const target = await gitAdminStatePath(to, key);
    if (source === undefined || target === undefined) continue;
    if (!(await fileExists(source))) continue;
    await Deno.mkdir(dirname(target), { recursive: true });
    await Deno.copyFile(source, target);
  }
}

/** Remove the integration worktree, its resources, its branch, and its
 * record. Returns human-readable failures instead of throwing: on the red
 * routes the refusal must still reach the author, and after a landing the
 * trunk transition is already durable. Unfinished cleanup stays recorded for
 * `discern worktree prune`. */
export async function removeIntegrationWorktree(
  mainRepo: string,
  record: Pick<IntegrationLandingRecord, "worktree">,
  log: Logger,
): Promise<string[]> {
  const failures: string[] = [];
  const dir = record.worktree.path;
  if (await fileExists(join(dir, ".git"))) {
    try {
      const teardown = await teardownResources(
        await lifecycleContext(dir, log, dir),
      );
      if (teardown.failed.length > 0) {
        failures.push(
          `integration resources remain recorded for recovery: ${
            teardown.failed.join(", ")
          }`,
        );
      }
    } catch (error) {
      failures.push(
        `integration resource teardown could not run: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    try {
      await removeWorktreeSafely(dir, mainRepo);
    } catch (error) {
      failures.push(
        `the integration worktree at ${dir} could not be removed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (failures.length === 0) {
    const tip = await runGit(
      [
        "rev-parse",
        "--verify",
        `refs/heads/${record.worktree.branch}^{commit}`,
      ],
      { cwd: mainRepo },
    );
    if (tip.success) {
      const deleted = await deleteAutomaticallyOwnedBranch({
        repoRoot: mainRepo,
        branch: record.worktree.branch,
        expectedCommit: tip.stdout.trim(),
        ownership: {
          kind: "integration",
          branch: record.worktree.branch,
          recordedBranch: record.worktree.branch,
        },
      });
      if (deleted.kind === "refused") {
        failures.push(
          `the integration worktree's branch ${record.worktree.branch} could not be deleted: ${deleted.reason}`,
        );
      }
    }
    await removeIntegrationLandingRecord(mainRepo, record.worktree.id);
  }
  return failures;
}

/** One phase sentence on every surface watching this landing. */
function narrate(
  log: Logger,
  state: string,
  reason: string,
  next?: string,
): void {
  log.info(reason);
  emitCompletionProgress({
    phase: "operation",
    state,
    candidate_id: null,
    reason,
    ...(next === undefined ? {} : { next }),
  });
}

/**
 * Run one composition attempt for the frozen submission against the trunk tip
 * it entered with. On `green` the caller owns the still-present integration
 * worktree through the trunk transition and settles its cleanup; every other
 * outcome already cleaned up (reporting any remainder) and preserved the
 * author's checkout untouched.
 */
export async function runIntegrationAttempt(input: {
  readonly effort: IntegrationEffort;
  readonly submission: Submission;
  readonly expectedTrunk: string;
  readonly log: Logger;
  readonly cliModel: CliModelProvider;
  readonly operationHandle?: string;
  readonly signal?: AbortSignal;
}): Promise<IntegrationAttempt> {
  const { effort, submission, log } = input;
  const worktreeRoot = dirname(effort.path);
  const minted = await mintIntegrationWorktree(
    effort.mainRepo,
    worktreeRoot,
    effort.id,
  );
  const record: IntegrationLandingRecord = {
    version: ON_DISK_FORMATS.integrationLanding.version,
    id: SYSTEM_SECURE_ENTROPY.uuid(),
    phase: "intent",
    created_at: wallTimeIso(SYSTEM_CLOCK.wallNow()),
    operation: {
      pid: Deno.pid,
      ...(input.operationHandle === undefined
        ? {}
        : { operation_handle: input.operationHandle }),
    },
    landing: {
      effort_id: effort.id,
      branch: effort.branch,
      worktree_path: effort.path,
      submission_id: submission.id,
      head: submission.head,
      tree: submission.tree,
      proof: { ...submission.proof },
      trunk: effort.trunk,
      expected_trunk: input.expectedTrunk,
    },
    worktree: {
      id: minted.id,
      branch: minted.branch,
      path: minted.dir,
    },
  };

  // Cleanup intent precedes every setup effect.
  await writeIntegrationLandingRecord(effort.mainRepo, record);
  narrate(
    log,
    "integration-prepare",
    `Preparing an integration worktree at ${minted.dir} from ${
      submission.head.slice(0, 12)
    }.`,
    `The combined code is checked there before ${effort.trunk} moves.`,
  );
  const metadata: StoredTaskMetadata = {
    schema_version: TASK_METADATA_SCHEMA_VERSION,
    title: `Integration landing for ${effort.branch}`,
    created_from: { ref: effort.branch, commit: submission.head },
  };
  try {
    await createAndSetupWorktree(
      effort.mainRepo,
      minted.dir,
      minted.branch,
      log,
      { id: minted.id, settings: effort.settings },
      submission.head,
      {
        verb: "accept",
        reproduceCmd: "discern accept",
        taskMetadata: metadata,
      },
    );
  } catch (error) {
    // The creation core already discarded the partial worktree.
    await removeIntegrationLandingRecord(effort.mainRepo, minted.id);
    return {
      kind: "setup-failed",
      reason: error instanceof Error ? error.message : String(error),
      cleanupFailures: [],
    };
  }
  await writeIntegrationLandingRecord(effort.mainRepo, {
    ...record,
    phase: "ready",
  });
  await copyAuthorDecisionState(effort.path, minted.dir);

  const author: SourceRevision = {
    effort_id: effort.id,
    branch: `refs/heads/${effort.branch}`,
    head: submission.head,
    tree: submission.tree,
  };
  return await withIntegrationCheckout(effort.path, minted.dir, async () => {
    const intCtx = await lifecycleContext(minted.dir, log, minted.dir);
    narrate(
      log,
      "integration-update",
      `Bringing ${effort.trunk} into the integration worktree and regenerating derived artifacts.`,
    );
    const updated = await applyUpdateCore(
      intCtx,
      await buildUpdatePlan(intCtx),
    );
    if (updated.kind !== "applied") {
      const status = await runGit(["status", "--porcelain", "-z"], {
        cwd: minted.dir,
      });
      const entries = status.success ? parsePorcelainZ(status.stdout) : [];
      const dirtyDetail = entries.length > 0
        ? ` (changed: ${
          entries.map((entry) => `${entry.status.trim()} ${entry.path}`)
            .join(", ")
        })`
        : "";
      const cleanupFailures = await removeIntegrationWorktree(
        effort.mainRepo,
        record,
        log,
      );
      if (updated.kind === "conflict") {
        return { kind: "conflict", files: updated.files, cleanupFailures };
      }
      const reason = updated.kind === "merge_failed"
        ? `Git refused the merge: ${updated.reason}`
        : `the integration worktree was not clean after setup${dirtyDetail}`;
      return { kind: "setup-failed", reason, cleanupFailures };
    }

    narrate(
      log,
      "integration-check",
      "Checking the combined committed tree with the full gate.",
    );
    const gate = await finishResult(minted.dir, {
      surface: { kind: "quiet" },
      cliModel: input.cliModel,
      composition: { sources: [author] },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const pointer = gate.data?.completion;
    const proof = gate.data?.proof;
    if (
      !gate.ok || proof === undefined || pointer?.kind !== "complete" ||
      pointer.candidate_id === undefined || pointer.proof_id === undefined
    ) {
      const cleanupFailures = await removeIntegrationWorktree(
        effort.mainRepo,
        record,
        log,
      );
      return { kind: "red", result: gate, cleanupFailures };
    }
    const head = await runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: minted.dir,
    });
    const provenHead = proof.completion?.candidate.head;
    if (
      !head.success || provenHead === undefined ||
      head.stdout.trim() !== provenHead
    ) {
      const cleanupFailures = await removeIntegrationWorktree(
        effort.mainRepo,
        record,
        log,
      );
      return {
        kind: "setup-failed",
        reason:
          "the integration worktree moved while its combined check ran, so the proven commit is not the one that would land",
        cleanupFailures,
      };
    }
    return {
      kind: "green",
      record,
      head: provenHead,
      proof,
      proofPointer: {
        candidate_id: pointer.candidate_id,
        proof_id: pointer.proof_id,
      },
    };
  });
}
