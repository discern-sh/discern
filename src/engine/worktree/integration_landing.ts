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
import { AWAITING_DECLARATION_SLUG } from "../../shared/declarations.ts";
import type { FiredHint } from "../../shared/hints.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../../shared/clock.ts";
import type { CliModelProvider } from "../../shared/cli_reference_codegen.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { fileExists } from "../../shared/fs_presence.ts";
import { INTEGRATION_BRANCH_NAMESPACE } from "../../shared/git_conventions.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { parsePorcelainZ } from "../../shared/git_paths.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import type { DiscernResult } from "../../shared/result.ts";
import type {
  GateCheckpointsData,
  GateData,
  Proof,
} from "../../shared/result_schemas.ts";
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
  type AcceptanceCheckpointState,
  inspectAcceptanceCheckpoints,
} from "./acceptance_checkpoints.ts";
import { localBranchExists, WorktreeGitError } from "./git.ts";
import { generateWorktreeId, type IdentitySettings } from "./identity.ts";
import {
  type IntegrationLandingRecord,
  retainedIntegrationJudgment,
  writeIntegrationLandingRecord,
} from "./integration_record.ts";
import {
  applyUpdateCore,
  buildUpdatePlan,
  createAndSetupWorktree,
  lifecycleContext,
  removeIntegrationWorktree,
} from "./lifecycle.ts";
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

/** The agent's checkpoint conclusions for the retained composition, exactly
 * as `done` takes them: repeatable `met`, at most one `unmet` with its
 * rationale. They record judgments about the copy's served open questions
 * and never apply to a composition the agent has not been served. */
export interface IntegrationDeclarations {
  readonly met: readonly string[];
  readonly unmet?: { readonly id: string; readonly why: string };
}

/** What one composition attempt established. On `green` the integration
 * worktree still exists — the proven commit must stay reachable through its
 * branch until the trunk transition lands — and the caller settles cleanup.
 * On `awaiting-judgment` the copy is retained on purpose, with its record in
 * the awaiting-judgment phase, so the answer can continue this landing. */
export type IntegrationAttempt =
  | {
    readonly kind: "setup-failed";
    readonly reason: string;
    readonly cleanupFailures: readonly string[];
  }
  | {
    readonly kind: "conflict";
    readonly files: readonly string[];
    readonly hints: FiredHint[];
    readonly cleanupFailures: readonly string[];
  }
  | {
    readonly kind: "red";
    readonly result: DiscernResult<GateData>;
    readonly cleanupFailures: readonly string[];
  }
  | {
    /** The combined result fired checkpoint questions that need a recorded
     * conclusion before the check can run. No gate job ran; the composition
     * is retained for the continuation. */
    readonly kind: "awaiting-judgment";
    readonly record: IntegrationLandingRecord;
    readonly served: GateCheckpointsData | undefined;
    /** The gate's own serving message, when it produced one. */
    readonly message: string | undefined;
  }
  | {
    /** Declarations arrived without a retained composition matching the
     * judged one; nothing was recorded. */
    readonly kind: "judgment-stale";
    readonly reason: string;
    readonly cleanupFailures: readonly string[];
  }
  | {
    /** A declaration names no served question of the retained composition;
     * nothing was recorded and the composition is kept unchanged. */
    readonly kind: "invalid-declarations";
    readonly reason: string;
  }
  | {
    /** A superseded composition's cleanup did not finish; its record stays
     * the single continuation, and nothing was composed or recorded. */
    readonly kind: "cleanup-blocked";
    readonly staleReason: string;
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
    /** The copy's acceptance-side checkpoint state — current conclusions and
     * their bindings on the combined tree — for the variance interlock. */
    readonly checkpointState: AcceptanceCheckpointState;
    /** The composition was adopted from a retained record rather than
     * freshly composed; receipt-bound decisions require the match. */
    readonly resumed: boolean;
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

/** The verbatim command an ISO clock stamps retention records with. */
function nowIso(): string {
  return wallTimeIso(SYSTEM_CLOCK.wallNow());
}

/** Retain the composed copy for a served checkpoint decision: the record
 * moves to the awaiting-judgment phase, carrying the exact composed commit
 * and the ids the continuation waits on, and nothing is removed. */
export async function retainIntegrationForJudgment(
  mainRepo: string,
  record: IntegrationLandingRecord,
  continuation: {
    readonly composedHead: string;
    readonly decision: "declaration" | "variance";
    readonly awaiting: readonly string[];
  },
): Promise<IntegrationLandingRecord> {
  const retained: IntegrationLandingRecord = {
    version: record.version,
    id: record.id,
    phase: "awaiting-judgment",
    created_at: record.created_at,
    operation: record.operation,
    landing: record.landing,
    worktree: record.worktree,
    continuation: {
      composed_head: continuation.composedHead,
      decision: continuation.decision,
      awaiting: [...continuation.awaiting],
      retained_at: nowIso(),
    },
  };
  await writeIntegrationLandingRecord(mainRepo, retained);
  return retained;
}

/** Discard any composition retained for this author: a direct landing (or
 * its refusal path) supersedes the judgment it was waiting on, so the copy
 * is removed rather than left for prune. Failures are logged with the prune
 * route; absence is already the settled state. */
export async function discardSupersededComposition(
  mainRepo: string,
  authorWorktreePath: string,
  log: Logger,
): Promise<void> {
  const retained = await retainedIntegrationJudgment(
    mainRepo,
    authorWorktreePath,
  );
  if (retained === undefined) return;
  const failures = await removeIntegrationWorktree(mainRepo, retained, log);
  for (const failure of failures) {
    log.warn(
      `Superseded-judgment cleanup: ${failure}. Run discern worktree prune from ${mainRepo}.`,
    );
  }
}

/** How the retained-composition adoption resolved for one attempt. */
type RetainedAdoption =
  | { readonly kind: "adopted"; readonly record: IntegrationLandingRecord }
  | {
    readonly kind: "invalid-declarations";
    readonly reason: string;
  }
  | {
    /** A superseded copy's cleanup did not finish, so its record survives;
     * nothing replaces it until the cleanup settles. */
    readonly kind: "cleanup-blocked";
    readonly staleReason: string;
    readonly cleanupFailures: readonly string[];
  }
  | {
    readonly kind: "fresh";
    readonly cleanupFailures: readonly string[];
    readonly staleReason?: string;
  };

/**
 * Adopt the retained awaiting-judgment composition for this author, when one
 * exists and still matches this exact landing: same submission, same expected
 * trunk, the copy present, clean, and at the composed commit the judgment was
 * served for. Anything else discards the stale copy — an answer never
 * transfers to a composition the agent was not served.
 */
async function adoptRetainedComposition(input: {
  readonly effort: IntegrationEffort;
  readonly submission: Submission;
  readonly expectedTrunk: string;
  readonly log: Logger;
  readonly declarations?: IntegrationDeclarations;
  /** The served composition receipt the caller answers. */
  readonly compositionReceipt?: string;
  readonly operationHandle?: string;
}): Promise<RetainedAdoption> {
  const { effort, submission, log } = input;
  const retained = await retainedIntegrationJudgment(
    effort.mainRepo,
    effort.path,
  );
  if (retained === undefined) return { kind: "fresh", cleanupFailures: [] };
  const continuation = retained.continuation;
  let stale: string | undefined;
  if (retained.landing.submission_id !== submission.id) {
    stale =
      "a replacement submission superseded the composition that was awaiting judgment";
  } else if (retained.landing.expected_trunk !== input.expectedTrunk) {
    stale =
      `${effort.trunk} moved past the composition that was awaiting judgment`;
  } else if (continuation === undefined) {
    stale = "the retained record carries no continuation";
  } else if (!(await fileExists(join(retained.worktree.path, ".git")))) {
    stale = "the retained integration worktree is gone";
  } else {
    const status = await runGit(["status", "--porcelain", "-z"], {
      cwd: retained.worktree.path,
    });
    const head = await runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: retained.worktree.path,
    });
    if (!status.success || status.stdout.trim() !== "") {
      stale = "the retained integration worktree is no longer clean";
    } else if (
      !head.success || head.stdout.trim() !== continuation.composed_head
    ) {
      stale =
        "the retained integration worktree no longer sits at the composed commit its question was served for";
    }
  }
  if (stale === undefined && continuation !== undefined) {
    // Declarations answer exactly the served questions of the composition
    // that served them: the receipt binds the answer, and an unknown id is
    // an error served read-only, with the composition kept for a corrected
    // call. A mismatched receipt never reveals the current one — the current
    // composition's question must be served afresh, not shortcut.
    if (input.declarations !== undefined) {
      if (input.compositionReceipt === undefined) {
        return {
          kind: "invalid-declarations",
          reason:
            "an answer binds to the composition that served it: pass --composition-receipt with the receipt from the served refusal, or re-run discern accept to be served the current composition's question. The retained composition is unchanged.",
        };
      }
      if (input.compositionReceipt !== retained.id) {
        return {
          kind: "invalid-declarations",
          reason:
            "the composition this answer was served for has been replaced; its judgment does not transfer. Re-run discern accept to be served the current composition's question. The retained composition is unchanged.",
        };
      }
      const known = new Set(continuation.awaiting);
      const requested = [
        ...input.declarations.met,
        ...(input.declarations.unmet === undefined
          ? []
          : [input.declarations.unmet.id]),
      ];
      const unknown = requested.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        return {
          kind: "invalid-declarations",
          reason: `${unknown.join(", ")} name${
            unknown.length === 1 ? "s" : ""
          } no served integration question; awaiting: ${
            [...known].sort().join(", ")
          }. The retained composition is unchanged.`,
        };
      }
    }
    const adopted: IntegrationLandingRecord = {
      version: retained.version,
      id: retained.id,
      phase: "ready",
      created_at: retained.created_at,
      operation: {
        pid: Deno.pid,
        ...(input.operationHandle === undefined
          ? {}
          : { operation_handle: input.operationHandle }),
      },
      landing: retained.landing,
      worktree: retained.worktree,
    };
    await writeIntegrationLandingRecord(effort.mainRepo, adopted);
    narrate(
      log,
      "integration-resume",
      `Resuming the retained integration worktree at ${retained.worktree.path} for ${
        submission.head.slice(0, 12)
      }.`,
    );
    return { kind: "adopted", record: adopted };
  }
  const cleanupFailures = await removeIntegrationWorktree(
    effort.mainRepo,
    retained,
    log,
  );
  // Replacement waits for settled cleanup: while the superseded record
  // survives, minting another composition would leave two retained records
  // for one submission — an ambiguous continuation — so the failure is the
  // result, not a footnote.
  const survivor = await retainedIntegrationJudgment(
    effort.mainRepo,
    effort.path,
  );
  if (survivor !== undefined && survivor.id === retained.id) {
    return {
      kind: "cleanup-blocked",
      staleReason: stale ?? "the retained composition was superseded",
      cleanupFailures,
    };
  }
  for (const failure of cleanupFailures) {
    log.warn(
      `Superseded-composition cleanup: ${failure}. Run discern worktree prune from ${effort.mainRepo} to reclaim what remains.`,
    );
  }
  return {
    kind: "fresh",
    cleanupFailures,
    ...(stale === undefined ? {} : { staleReason: stale }),
  };
}

/**
 * Run one composition attempt for the frozen submission against the trunk tip
 * it entered with. On `green` the caller owns the still-present integration
 * worktree through the trunk transition and settles its cleanup; on
 * `awaiting-judgment` the copy is retained with its record for the
 * continuation; every other outcome already cleaned up (reporting any
 * remainder) and preserved the author's checkout untouched. A retained copy
 * whose served question this call answers is adopted instead of composing
 * again; a retained copy invalidated by a moved trunk, a replacement
 * submission, or a changed tree is discarded first.
 */
export async function runIntegrationAttempt(input: {
  readonly effort: IntegrationEffort;
  readonly submission: Submission;
  readonly expectedTrunk: string;
  readonly log: Logger;
  readonly cliModel: CliModelProvider;
  /** Conclusions for the retained composition's served questions; refused
   * unless a matching retained composition exists. */
  readonly declarations?: IntegrationDeclarations;
  /** The served composition receipt a continuation names. */
  readonly compositionReceipt?: string;
  readonly operationHandle?: string;
  readonly signal?: AbortSignal;
}): Promise<IntegrationAttempt> {
  const { effort, submission, log } = input;
  const adoption = await adoptRetainedComposition(input);
  if (adoption.kind === "invalid-declarations") {
    return { kind: "invalid-declarations", reason: adoption.reason };
  }
  if (adoption.kind === "cleanup-blocked") {
    return {
      kind: "cleanup-blocked",
      staleReason: adoption.staleReason,
      cleanupFailures: adoption.cleanupFailures,
    };
  }
  if (adoption.kind === "adopted") {
    return await proveComposition(input, adoption.record, true);
  }
  if (
    input.declarations !== undefined || input.compositionReceipt !== undefined
  ) {
    return {
      kind: "judgment-stale",
      reason: adoption.staleReason ??
        "no retained integration composition awaits a judgment for this submission",
      cleanupFailures: adoption.cleanupFailures,
    };
  }
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
    created_at: nowIso(),
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
    // The creation core discards the partial checkout, but its rollback
    // deletes branches under authoring ownership and refuses the
    // integration/ namespace. Finish the cleanup under integration
    // ownership; the record is removed only once everything it accounts
    // for is verifiably gone, so a leftover branch stays reclaimable by
    // `discern worktree prune`.
    const cleanupFailures = await removeIntegrationWorktree(
      effort.mainRepo,
      record,
      log,
    );
    return {
      kind: "setup-failed",
      reason: error instanceof Error ? error.message : String(error),
      cleanupFailures,
    };
  }
  await writeIntegrationLandingRecord(effort.mainRepo, {
    ...record,
    phase: "ready",
  });
  await copyAuthorDecisionState(effort.path, minted.dir);
  return await proveComposition(input, {
    ...record,
    phase: "ready",
  }, false);
}

/** Compose (unless resumed) and prove the copy: the update core brings the
 * trunk in on a fresh copy, then the gate core proves the combined committed
 * tree, recording any declarations this call carries against the copy's own
 * served questions. */
async function proveComposition(
  input: {
    readonly effort: IntegrationEffort;
    readonly submission: Submission;
    readonly log: Logger;
    readonly cliModel: CliModelProvider;
    readonly declarations?: IntegrationDeclarations;
    readonly signal?: AbortSignal;
  },
  record: IntegrationLandingRecord,
  resumed: boolean,
): Promise<IntegrationAttempt> {
  const { effort, submission, log } = input;
  const dir = record.worktree.path;
  const author: SourceRevision = {
    effort_id: effort.id,
    branch: `refs/heads/${effort.branch}`,
    head: submission.head,
    tree: submission.tree,
  };
  return await withIntegrationCheckout(effort.path, dir, async () => {
    const intCtx = await lifecycleContext(dir, log, dir);
    if (!resumed) {
      narrate(
        log,
        "integration-update",
        `Bringing ${effort.trunk} into the integration worktree and regenerating derived artifacts.`,
      );
      const updated = await applyUpdateCore(
        intCtx,
        await buildUpdatePlan(intCtx),
        { route: "accept", effort: effort.branch },
      );
      if (updated.kind !== "applied") {
        const status = await runGit(["status", "--porcelain", "-z"], {
          cwd: dir,
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
          return {
            kind: "conflict",
            files: updated.files,
            hints: updated.hints,
            cleanupFailures,
          };
        }
        const reason = updated.kind === "merge_failed"
          ? `Git refused the merge: ${updated.reason}`
          : `the integration worktree was not clean after setup${dirtyDetail}`;
        return { kind: "setup-failed", reason, cleanupFailures };
      }
    }

    narrate(
      log,
      "integration-check",
      resumed
        ? "Checking the retained combined tree with the full gate."
        : "Checking the combined committed tree with the full gate.",
    );
    const gate = await finishResult(dir, {
      surface: { kind: "quiet" },
      cliModel: input.cliModel,
      composition: { sources: [author] },
      ...(input.declarations === undefined ? {} : {
        met: [...input.declarations.met],
        ...(input.declarations.unmet === undefined
          ? {}
          : { unmet: { ...input.declarations.unmet } }),
      }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    // A checkpoint question about the combined result is a judgment stop,
    // not an executed-check failure: retain the composition and serve the
    // question with its continuation. No gate job has run.
    if (!gate.ok && gate.error === AWAITING_DECLARATION_SLUG) {
      const served = gate.data?.checkpoints;
      const awaiting = (served?.outstanding ?? []).map((entry) => entry.id);
      const head = await runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
        cwd: dir,
      });
      if (awaiting.length > 0 && head.success) {
        const retained = await retainIntegrationForJudgment(
          effort.mainRepo,
          record,
          {
            composedHead: head.stdout.trim(),
            decision: "declaration",
            awaiting,
          },
        );
        narrate(
          log,
          "integration-judgment",
          `The combined result fired ${awaiting.length} checkpoint question${
            awaiting.length === 1 ? "" : "s"
          }; the composition is retained for the answer.`,
        );
        return {
          kind: "awaiting-judgment",
          record: retained,
          served,
          message: gate.message,
        };
      }
      // Without a readable served set there is nothing answerable to
      // retain; fall through to the ordinary red route below.
    }
    const pointer = gate.data?.completion;
    const proof = gate.data?.proof;
    // A resumed copy can reuse its own current green Proof (the second
    // continuation call after a variance stop); the reuse result names the
    // Proof without re-running jobs, so the pointer derives from it.
    const pointerIds = pointer?.kind === "complete" &&
        pointer.candidate_id !== undefined && pointer.proof_id !== undefined
      ? { candidate_id: pointer.candidate_id, proof_id: pointer.proof_id }
      : gate.ok && proof?.completion !== undefined
      ? {
        candidate_id: proof.completion.candidate_id,
        proof_id: proof.completion.proof_id,
      }
      : undefined;
    if (!gate.ok || proof === undefined || pointerIds === undefined) {
      const cleanupFailures = await removeIntegrationWorktree(
        effort.mainRepo,
        record,
        log,
      );
      return { kind: "red", result: gate, cleanupFailures };
    }
    const head = await runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: dir,
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
      proofPointer: pointerIds,
      checkpointState: await inspectAcceptanceCheckpoints(dir, intCtx.config),
      resumed,
    };
  });
}
