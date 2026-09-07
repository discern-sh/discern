import {
  type LandingConverger,
  readLandingConvergenceResult,
} from "./convergence.ts";
import { runGit } from "../../shared/subprocess.ts";
import { fire, HINTS, hintTexts } from "../../shared/hints.ts";
import { z } from "@zod/zod";
import { loadConfig } from "../../shared/config_schema.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { Logger } from "../../lib/log.ts";
import { recordLandingProofNote } from "../worktree/accept_proof_recording.ts";
import { saveEnvironmentArtifact } from "../execution/artifacts.ts";
import { readEnvironmentArtifact } from "../execution/artifact_read.ts";
import { AcceptProofNoteSchema } from "../../shared/result_schemas.ts";
import {
  emitCompletionEvent,
  emitCompletionProgress,
} from "../completion/events.ts";
/** Publish one exact queue transition; recovery and note publication never repeat landing. */
import type { CompletionLanding } from "../completion/outcomes.ts";
import type { CompletionRecord } from "../completion/records.ts";
import type {
  CompletionBlocker,
  CompletionObservation,
} from "../completion/protocol.ts";
import {
  type PublicationFence,
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import { candidateRef } from "../completion/identity.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { withCompletionCheckout } from "../operation_lock.ts";
import { readProofPresentation } from "../gate/proof_presentation.ts";
import type { writeProofNote } from "../gate/proof_notes.ts";
import type { Proof } from "../../shared/result_schemas.ts";
import {
  claimEffortGrant,
  consumeEffortGrantClaimById,
  type EffortGrantClaim,
  readRecoveryEffortGrantClaim,
  restoreEffortGrantClaim,
} from "../worktree/effort_grant_cleanup.ts";
import { inspectEffortGrantSubject } from "../worktree/effort_grant_subject.ts";
import {
  fastForwardCheckedOutBranch,
  inspectGitOperation,
  readAcceptanceTransactionMarker,
  recoverCheckedOutFastForward,
} from "../worktree/git.ts";
import { gitValue } from "./composition.ts";
import { sameSource } from "./model.ts";
import { observeQueue, requireQueue, withQueueLock } from "./repository.ts";
import { mutateQueue } from "./mutations.ts";

export type LandingRecord = Extract<CompletionRecord, { kind: "landing" }>;
type AuthorityRecord = Extract<CompletionRecord, { kind: "authority" }>;
export const LANDING_BOUNDARIES = [
  "planned",
  "grant",
  "ref",
  "authority",
  "convergence",
  "note",
] as const;
export type LandingBoundary = (typeof LANDING_BOUNDARIES)[number];

export interface QueueLandingRuntime {
  readonly signal?: AbortSignal;
  readonly root: string;
  readonly mainRepo: string;
  readonly trunk: string;
  /** Includes canonical producer, composition, policy and separately authorized decision audits. */
  readonly audit: (
    record: LandingRecord,
  ) => Promise<CompletionObservation | CompletionBlocker>;
  readonly sourceCheckout: (
    record: LandingRecord,
  ) => Promise<string | undefined>;
  readonly clock?: Clock;
  readonly afterBoundary?: (
    boundary: LandingBoundary,
    record: LandingRecord,
  ) => Promise<void>;
  readonly writeNote?: typeof writeProofNote;
  readonly converge?: LandingConverger;
}

/** A ref transition's exact identifiers stay immutable through every settlement revision. */
async function currentLanding(
  root: string,
  id: string,
): Promise<{ record: LandingRecord; stamp: string }> {
  const current = await readCompletionRecord(root, { kind: "landing", id });
  if (current.kind !== "recorded" || current.record.kind !== "landing") {
    throw new Error(
      `Landing ${id} is ${current.kind}; preserve recovery state.`,
    );
  }
  return { record: current.record, stamp: current.stamp };
}

/** Preserve a terminal result with compare-and-swap, independently of its disposable checkout. */
async function updateLanding(
  runtime: QueueLandingRuntime,
  id: string,
  change: Partial<
    Pick<
      CompletionLanding,
      | "outcome"
      | "authority_settlement"
      | "note"
      | "note_result"
      | "convergence_result"
    >
  >,
): Promise<LandingRecord> {
  const current = await currentLanding(runtime.root, id);
  const record = {
    ...current.record,
    revision: current.record.revision + 1,
    data: { ...current.record.data, ...change },
  };
  const written = await writeCompletionRecord(
    runtime.root,
    record,
    current.stamp,
    undefined,
    runtime.clock,
  );
  if (written.kind !== "written") {
    throw new Error(
      `Landing settlement ${written.kind}; recover ${id} before retiring any checkout.`,
    );
  }
  if (record.data.outcome.kind !== current.record.data.outcome.kind) {
    emitCompletionEvent({
      id: `${record.id}:${record.revision}:landing`,
      at: (runtime.clock ?? SYSTEM_CLOCK).wallNow(),
      effort_id: record.data.source.effort_id,
      source_head: record.data.source.head,
      candidate_id: record.data.candidate_id,
      environment_id: null,
      attempt_id: record.data.attempt_id,
      executor_operation: record.data.executor.operation_id,
      fact: {
        kind: "landing",
        landing_id: record.id,
        outcome: record.data.outcome.kind,
        claim_kind: record.data.claim.kind,
      },
    });
  }
  if (
    record.data.outcome.kind === "landed" ||
    record.data.outcome.kind === "not-landed"
  ) {
    const attempt = await readCompletionRecord(runtime.root, {
      kind: "attempt",
      id: record.data.attempt_id,
    });
    if (
      attempt.kind === "recorded" && attempt.record.kind === "attempt" &&
      attempt.record.data.state.kind !== "finished"
    ) {
      const finished = await writeCompletionRecord(
        runtime.root,
        {
          ...attempt.record,
          revision: attempt.record.revision + 1,
          data: {
            ...attempt.record.data,
            state: {
              kind: "finished",
              outcome: record.data.outcome.kind === "landed"
                ? "passed"
                : "cancelled",
              finished_at: (runtime.clock ?? SYSTEM_CLOCK).wallNow(),
            },
          },
        },
        attempt.stamp,
        undefined,
        runtime.clock,
      );
      if (finished.kind !== "written") {
        throw new Error(
          `Landing actor settlement ${finished.kind}; recover ${id} before another attempt.`,
        );
      }
    }
  }
  return record;
}

/** A missing authority record is not inferred from ancestry or a green candidate. */
async function landingAuthority(
  root: string,
  record: LandingRecord,
): Promise<{ record: AuthorityRecord; stamp: string }> {
  if (record.data.claim.kind !== "normal") {
    throw new Error("Ordinary acceptance cannot publish an exception claim.");
  }
  const authority = await readCompletionRecord(root, {
    kind: "authority",
    id: record.data.claim.authority_id,
  });
  if (authority.kind !== "recorded" || authority.record.kind !== "authority") {
    throw new Error("The separately recorded source authority is unavailable.");
  }
  return { record: authority.record, stamp: authority.stamp };
}

/** Resolve the immutable machine claim before taking shared publication locks. */
export async function readLandingProof(
  runtime: QueueLandingRuntime,
  record: LandingRecord,
): Promise<Proof> {
  if (record.data.claim.kind !== "normal") {
    throw new Error("Ordinary acceptance requires complete normal Proof.");
  }
  const proof = await readProofPresentation(runtime.root, {
    candidate_id: record.data.candidate_id,
    proof_id: record.data.claim.proof_id,
  });
  const complete = proof.completion;
  if (
    complete === undefined ||
    complete.candidate.policy !== record.data.policy ||
    complete.candidate.head !== record.data.target ||
    complete.candidate.expected_predecessor.head !==
      record.data.expected_trunk ||
    !sameSource(complete.candidate.source, record.data.source) ||
    complete.validation.mode !== "strict"
  ) {
    throw new Error(
      "The landing subject differs from its complete strict Proof.",
    );
  }
  if (proof.trunk !== runtime.trunk) {
    throw new Error("The retained Proof names another trunk.");
  }
  return proof;
}

/** Grant consumption follows the common marker; incomplete file cleanup cannot restore spent authority. */
async function settleAdvanced(
  runtime: QueueLandingRuntime,
  record: LandingRecord,
): Promise<LandingRecord> {
  const clock = runtime.clock ?? SYSTEM_CLOCK;
  const authority = await landingAuthority(runtime.root, record);
  const state = authority.record.data.state;
  if (state.kind === "granted") {
    const consumed = await writeCompletionRecord(
      runtime.root,
      {
        ...authority.record,
        revision: authority.record.revision + 1,
        data: {
          ...authority.record.data,
          state: {
            kind: "consumed",
            landing_id: record.id,
            at: clock.wallNow(),
          },
        },
      },
      authority.stamp,
      undefined,
      clock,
    );
    if (consumed.kind !== "written") {
      throw new Error(
        `Source authority settlement ${consumed.kind}; retain landing ${record.id}.`,
      );
    }
  } else if (state.kind !== "consumed" || state.landing_id !== record.id) {
    throw new Error(
      "The recorded authority belongs to another settlement. Preserve this landing for recovery.",
    );
  }
  await runtime.afterBoundary?.("authority", record);
  const cleaned = authority.record.data.source.source !== "effort-grant" ||
    await consumeEffortGrantClaimById(runtime.root, record.id, true);
  return await updateLanding(runtime, record.id, {
    authority_settlement: cleaned ? "consumed" : "pending",
  });
}

const LandingNoteResultSchema = z.strictObject({
  proof_note: AcceptProofNoteSchema.optional(),
  hints: z.array(z.string()),
  reason: z.string().optional(),
});

/** Retained note diagnostics survive retirement and do not repeat any publication effect. */
export async function readLandingNoteResult(
  root: string,
  landing: CompletionLanding,
): Promise<z.infer<typeof LandingNoteResultSchema> | undefined> {
  if (landing.note_result === undefined) return undefined;
  if (
    landing.note_result.attempt_id !== landing.attempt_id ||
    landing.note_result.candidate_id !== landing.candidate_id
  ) {
    throw new Error(
      "Retained note diagnostics belong to another landing attempt or candidate.",
    );
  }
  return LandingNoteResultSchema.parse(
    await readEnvironmentArtifact(root, landing.note_result),
  );
}

/** Publish presentation only after source authority is durably spent for this landing. */
async function publishLandingNote(
  runtime: QueueLandingRuntime,
  record: LandingRecord,
  proof: Proof,
  env: Pick<typeof Deno.env, "get"> = Deno.env,
): Promise<LandingRecord> {
  const authority = await landingAuthority(runtime.root, record);
  if (
    authority.record.data.state.kind !== "consumed" ||
    authority.record.data.state.landing_id !== record.id
  ) return record;
  if (record.data.claim.kind !== "normal") {
    throw new Error("Ordinary acceptance cannot record emergency authority.");
  }
  const source = authority.record.data.source;
  let note: z.infer<typeof LandingNoteResultSchema>;
  try {
    const recorded = await recordLandingProofNote({
      mainRepo: runtime.mainRepo,
      commit: record.data.target,
      mode: (await loadConfig(runtime.mainRepo)).repository.proof_notes,
      proof,
      checkpointDrops: proof.checkpoint_drops ?? [],
      consent: {
        source: source.source,
        ...(source.scopes.length ? { scopes: source.scopes } : {}),
      },
      variances: record.data.claim.decisions.variances,
      standardProposals: record.data.claim.decisions.proposals,
      authority: {
        authority_id: authority.record.id,
        landing_id: record.id,
        authority: authority.record.data,
        executor: record.data.executor,
      },
      log: new Logger({ json: true, noColor: true }),
      env,
      ...(runtime.writeNote === undefined
        ? {}
        : { writeNote: runtime.writeNote }),
    });
    note = {
      proof_note: recorded.proofNote,
      hints: [
        ...recorded.hints,
        ...recorded.steps.flatMap((step) =>
          step.advisory === undefined ? [] : [step.advisory.next_action]
        ),
      ],
    };
  } catch (error) {
    note = {
      reason: error instanceof Error ? error.message : String(error),
      hints: hintTexts([
        fire(HINTS["completion-pending"], {
          action:
            "Repair the recorded Proof-note failure and retry accept; this landing and its consumed authority remain intact.",
        }),
      ]),
    };
  }
  const artifact = await saveEnvironmentArtifact(
    runtime.root,
    {
      attempt_id: record.data.attempt_id,
      candidate_id: record.data.candidate_id,
      context: "local",
    },
    `landing-note-${record.id}-${SYSTEM_SECURE_ENTROPY.uuid()}`,
    note,
  );
  const status = note.proof_note?.write.status;
  const updated = await withQueueLock(
    runtime.root,
    () =>
      updateLanding(runtime, record.id, {
        note: status === "recorded" || status === "already_present"
          ? "published"
          : "recovery",
        note_result: artifact,
      }),
  );
  await runtime.afterBoundary?.("note", updated);
  return updated;
}

/** Advance queue state from durable landing facts, even if note publication needs a retry. */
async function reconcileLandedQueue(
  runtime: QueueLandingRuntime,
): Promise<void> {
  const queue = await requireQueue(runtime.root);
  const changed = await mutateQueue({
    root: runtime.root,
    trunk: runtime.trunk,
    expected_stamp: queue.stamp,
    mutation: { kind: "trunk-moved" },
    ...(runtime.clock === undefined ? {} : { clock: runtime.clock }),
  });
  if (changed.kind !== "changed") {
    throw new Error(
      "The landing is durable; re-observe the queue before advancing another predecessor.",
    );
  }
}

/** Run only convergent checkout work under main exclusion, outside the shared publication lock.
 * A retained successful result is never rerun. An interrupted or failed run may be
 * retried on the same target; authority settlement and the ref transition stay fixed.
 */
async function convergeLandedCheckout(
  runtime: QueueLandingRuntime,
  record: LandingRecord,
  signal: AbortSignal,
): Promise<LandingRecord | CompletionBlocker> {
  if (record.data.outcome.kind !== "landed" || runtime.converge === undefined) {
    return record;
  }
  if ((await readLandingConvergenceResult(runtime.root, record.data))?.ok) {
    return record;
  }
  const branch = await runGit(["symbolic-ref", "--quiet", "HEAD"], {
    cwd: runtime.mainRepo,
  });
  const clean = await runGit([
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=no",
  ], { cwd: runtime.mainRepo });
  if (
    !branch.success || branch.stdout.trim() !== `refs/heads/${runtime.trunk}` ||
    !clean.success || clean.stdout !== "" ||
    await gitValue(runtime.mainRepo, ["rev-parse", "HEAD"]) !==
      record.data.target ||
    (await inspectGitOperation(runtime.mainRepo)).kind !== "none"
  ) {
    return {
      kind: "environment-unavailable",
      reason:
        "Landing is recorded. Restore the main checkout to the recorded target with a clean tracked tree before retrying its convergence commands; preserve any edits.",
    };
  }
  emitCompletionProgress({
    phase: "environment",
    state: "converging",
    candidate_id: record.data.candidate_id,
    reason:
      `Running receiving-checkout convergence for ${record.data.source.branch}; the landing is already recorded.`,
  });
  let result;
  try {
    result = await runtime.converge(runtime.mainRepo, signal);
  } catch (error) {
    result = {
      ok: false,
      steps: [],
      diagnostics: [{
        tool: "checkout-convergence",
        severity: "error" as const,
        message: error instanceof Error ? error.message : String(error),
        reproduce_cmd: "discern accept",
      }],
      hints: hintTexts([fire(HINTS["lifecycle-convergence-failed"])]),
    };
  }
  const head = await runGit(["rev-parse", "HEAD"], { cwd: runtime.mainRepo });
  const currentBranch = await runGit(["symbolic-ref", "--quiet", "HEAD"], {
    cwd: runtime.mainRepo,
  });
  if (
    !head.success || head.stdout.trim() !== record.data.target ||
    !currentBranch.success ||
    currentBranch.stdout.trim() !== `refs/heads/${runtime.trunk}`
  ) {
    result = {
      ...result,
      ok: false,
      diagnostics: [...result.diagnostics, {
        tool: "checkout-convergence",
        severity: "error",
        message:
          "The main checkout changed commits during convergence. Preserve it and reconcile the recorded landing target before retrying acceptance.",
        reproduce_cmd: "git status --short --branch",
      }],
    };
  }
  if (signal.aborted) result = { ...result, ok: false };
  const artifact = await saveEnvironmentArtifact(
    runtime.root,
    {
      attempt_id: record.data.attempt_id,
      candidate_id: record.data.candidate_id,
      context: "local",
    },
    `landing-convergence-${record.id}-${SYSTEM_SECURE_ENTROPY.uuid()}`,
    result,
  );
  const updated = await withQueueLock(
    runtime.root,
    () => updateLanding(runtime, record.id, { convergence_result: artifact }),
  );
  await runtime.afterBoundary?.("convergence", updated);
  return updated;
}

/** Expensive evidence audit precedes the short lock; every observed stamp is rechecked within it. */
export async function publishQueueLanding(
  runtime: QueueLandingRuntime,
  record: LandingRecord,
  expectedStamp: string | null,
  fence: PublicationFence,
): Promise<CompletionLanding | CompletionBlocker> {
  const clock = runtime.clock ?? SYSTEM_CLOCK;
  const audit = await runtime.audit(record);
  if ("kind" in audit) return audit;
  const proof = await readLandingProof(runtime, record);
  const sourcePath = await runtime.sourceCheckout(record);
  const advanced = await withCompletionCheckout(
    runtime.mainRepo,
    async (signal) => {
      if (signal.aborted) {
        return {
          kind: "environment-unavailable" as const,
          reason:
            "Acceptance was cancelled before publication; the recorded transition remains available for inspection.",
        };
      }
      const published = await withQueueLock(
        runtime.root,
        async (): Promise<LandingRecord | CompletionBlocker> => {
          const now = await observeQueue(runtime.root, runtime.trunk, clock);
          if (
            now.trunk !== audit.trunk ||
            JSON.stringify(now.records) !== JSON.stringify(audit.records)
          ) {
            return {
              kind: "stale-evidence",
              evidence_ids: [],
              reason: "claim-lost",
            };
          }
          const authority = await landingAuthority(runtime.root, record);
          if (
            authority.record.data.policy !== record.data.policy ||
            authority.record.data.composition_procedure !==
              proof.completion?.candidate.composition.procedure ||
            authority.record.data.state.kind !== "granted" ||
            !authority.record.data.sources.some((source) =>
              sameSource(source, record.data.source)
            )
          ) return { kind: "missing-authority", sources: [record.data.source] };
          const operation = await inspectGitOperation(runtime.mainRepo);
          if (operation.kind !== "none") {
            return {
              kind: "environment-unavailable",
              reason: operation.kind === "active"
                ? `The main checkout has an in-progress ${operation.operation}. Resolve it with git ${operation.operation} --continue or git ${operation.operation} --abort before retrying acceptance.`
                : operation.detail,
            };
          }
          const branch = await runGit(["branch", "--show-current"], {
            cwd: runtime.mainRepo,
          });
          if (!branch.success || branch.stdout.trim() !== runtime.trunk) {
            return {
              kind: "environment-unavailable",
              reason: !branch.success
                ? `The main checkout branch is unavailable: ${branch.stderr.trim()}`
                : `The main checkout is on '${
                  branch.stdout.trim() || "(detached)"
                }', not '${runtime.trunk}'. Return to the configured trunk in ${runtime.mainRepo}, then retry acceptance.`,
            };
          }
          const status = await runGit([
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=no",
          ], { cwd: runtime.mainRepo });
          if (!status.success || status.stdout !== "") {
            return {
              kind: "environment-unavailable",
              reason: status.success
                ? "The main checkout has uncommitted tracked changes. Preserve and resolve them before retrying acceptance."
                : `Git could not read tracked status in the main checkout: ${status.stderr.trim()}. Restore Git status access before retrying acceptance.`,
            };
          }
          const existing = await readCompletionRecord(runtime.root, record);
          if (
            (existing.kind === "missing"
              ? null
              : existing.kind === "recorded"
              ? existing.stamp
              : undefined) !== expectedStamp
          ) {
            return {
              kind: "stale-evidence",
              evidence_ids: [],
              reason: "claim-lost",
            };
          }
          // Rewriting an existing plan with its unchanged subject also checks the publication fence.
          const planned = existing.kind === "recorded"
            ? { ...record, revision: existing.record.revision + 1 }
            : record;
          const written = await writeCompletionRecord(
            runtime.root,
            planned,
            expectedStamp,
            fence,
            clock,
          );
          if (written.kind !== "written") {
            return {
              kind: "stale-evidence",
              evidence_ids: [],
              reason: "claim-lost",
            };
          }
          await runtime.afterBoundary?.("planned", planned);
          let claim: EffortGrantClaim | undefined;
          if (authority.record.data.source.source === "effort-grant") {
            if (sourcePath === undefined) {
              return {
                kind: "missing-authority",
                sources: [record.data.source],
              };
            }
            const acquired = await claimEffortGrant(
              sourcePath,
              record.data.source.branch.slice("refs/heads/".length),
              record.id,
              undefined,
              true,
            );
            if (acquired.status !== "claimed") {
              return {
                kind: "missing-authority",
                sources: [record.data.source],
              };
            }
            claim = acquired.claim;
            const subject = await inspectEffortGrantSubject(
              sourcePath,
              claim.grant.branch,
            );
            if (
              claim.grant.id !== authority.record.data.source.record_id ||
              !sameSource(claim.grant.source, record.data.source) ||
              !sameSource(subject.source, record.data.source) ||
              subject.composition_procedure !==
                authority.record.data.composition_procedure ||
              claim.grant.composition_procedure !==
                subject.composition_procedure
            ) {
              const restored = await restoreEffortGrantClaim(sourcePath, claim);
              await updateLanding(runtime, record.id, {
                outcome: {
                  kind: "not-landed",
                  reason: "Source authority changed before publication.",
                },
                authority_settlement: restored ? "restored" : "pending",
              });
              return {
                kind: "missing-authority",
                sources: [record.data.source],
              };
            }
          }
          await runtime.afterBoundary?.("grant", planned);
          const candidate = proof.completion?.candidate;
          if (candidate === undefined) {
            throw new Error(
              "The complete candidate is unavailable.",
            );
          }
          const outcome = await fastForwardCheckedOutBranch(
            runtime.mainRepo,
            runtime.trunk,
            record.data.expected_trunk,
            record.data.target,
            {
              transactionId: record.id,
              commonMarker: true,
              verifyRefs: [{
                ref: record.data.source.branch,
                head: record.data.source.head,
              }, {
                ref: candidateRef(
                  record.data.candidate_id,
                  candidate.attempt_id,
                ),
                head: record.data.target,
              }],
            },
          );
          await runtime.afterBoundary?.("ref", planned);
          const moved = outcome.kind === "updated" ||
            (outcome.kind === "checkout-failed" && !outcome.rolledBack);
          if (!moved) {
            const restored = claim === undefined ||
              (sourcePath !== undefined &&
                await restoreEffortGrantClaim(sourcePath, claim));
            return await updateLanding(runtime, record.id, {
              outcome: { kind: "not-landed", reason: outcome.detail },
              authority_settlement: restored ? "restored" : "pending",
            });
          }
          const terminal = await updateLanding(runtime, record.id, {
            outcome: outcome.kind === "updated"
              ? {
                kind: "landed",
                at: clock.wallNow(),
                transition_marker: record.id,
              }
              : {
                kind: "recovery",
                ref_advanced: true,
                recovery: {
                  phase: "publish",
                  reason: outcome.detail,
                  children_quiescent: true,
                  drift: { kind: "none" },
                  retained_paths: [runtime.mainRepo],
                  frozen_cleanup: [],
                },
              },
          });
          const settled = await settleAdvanced(runtime, terminal);
          if (
            settled.data.outcome.kind === "landed"
          ) await reconcileLandedQueue(runtime);
          return settled;
        },
      );
      return published.kind === "landing"
        ? await convergeLandedCheckout(runtime, published, signal)
        : published;
    },
    runtime.signal,
  );
  if (advanced.kind !== "landing") return advanced;
  return advanced.data.outcome.kind === "landed"
    ? (await publishLandingNote(runtime, advanced, proof)).data
    : advanced.data;
}

/** A replacement actor resolves the common marker and original trees before any new validation or approval. */
export async function recoverQueueLanding(
  runtime: QueueLandingRuntime,
  id: string,
): Promise<CompletionLanding | CompletionBlocker> {
  const initial = (await currentLanding(runtime.root, id)).record;
  const proof = await readLandingProof(runtime, initial);
  const recovered = await withCompletionCheckout(
    runtime.mainRepo,
    async (signal) => {
      if (signal.aborted) {
        return {
          kind: "environment-unavailable" as const,
          reason:
            "Acceptance was cancelled before publication; the recorded transition remains available for inspection.",
        };
      }
      const published = await withQueueLock(
        runtime.root,
        async (): Promise<LandingRecord | CompletionBlocker> => {
          const record = (await currentLanding(runtime.root, id)).record;
          const marker = await readAcceptanceTransactionMarker(
            runtime.mainRepo,
            record.id,
            true,
          );
          if (marker.kind === "unavailable") {
            return {
              kind: "environment-unavailable",
              reason: marker.detail,
            };
          }
          if (marker.kind === "missing") {
            if (
              await gitValue(runtime.mainRepo, [
                "rev-parse",
                `refs/heads/${runtime.trunk}`,
              ]) !== record.data.expected_trunk
            ) {
              return {
                kind: "environment-unavailable",
                reason:
                  "The marker is absent and the recorded expected trunk is no longer current. Preserve the claim until the ref history is reconciled.",
              };
            }
            if (
              record.data.outcome.kind === "landed" ||
              (record.data.outcome.kind === "recovery" &&
                record.data.outcome.ref_advanced)
            ) {
              return {
                kind: "environment-unavailable",
                reason:
                  "The common marker is missing for an advanced landing. Preserve its authority, checkout and records.",
              };
            }
            const sourcePath = await runtime.sourceCheckout(record);
            const claim = await readRecoveryEffortGrantClaim(
              runtime.root,
              record.data.source.branch.slice("refs/heads/".length),
              record.id,
              true,
            );
            const restored = claim.status === "missing" ||
              ((claim.status === "claimed" ||
                claim.status === "historical-claim") &&
                sourcePath !== undefined &&
                await restoreEffortGrantClaim(sourcePath, claim.claim));
            return await updateLanding(runtime, record.id, {
              outcome: {
                kind: "not-landed",
                reason: "The common ref transaction did not commit.",
              },
              authority_settlement: restored ? "restored" : "pending",
            });
          }
          if (marker.target !== record.data.target) {
            return {
              kind: "environment-unavailable",
              reason:
                "The landing marker names another target. Preserve every record for recovery.",
            };
          }
          const convergence = record.data.outcome.kind === "landed"
            ? { kind: "converged" as const, changed: false }
            : await recoverCheckedOutFastForward(
              runtime.mainRepo,
              runtime.trunk,
              record.data.expected_trunk,
              record.data.target,
            );
          if (convergence.kind !== "converged") {
            return {
              kind: "recovery-incomplete",
              record_id: id,
              recovery: {
                phase: "publish",
                reason: convergence.detail,
                children_quiescent: true,
                drift: { kind: "none" },
                retained_paths: [runtime.mainRepo],
                frozen_cleanup: [],
              },
            };
          }
          const landed = record.data.outcome.kind === "landed"
            ? record
            : await updateLanding(runtime, id, {
              outcome: {
                kind: "landed",
                at: (runtime.clock ?? SYSTEM_CLOCK).wallNow(),
                transition_marker: id,
              },
            });
          const settled = await settleAdvanced(runtime, landed);
          await reconcileLandedQueue(runtime);
          return settled;
        },
      );
      return published.kind === "landing"
        ? await convergeLandedCheckout(runtime, published, signal)
        : published;
    },
    runtime.signal,
  );
  if (recovered.kind !== "landing") return recovered;
  return recovered.data.outcome.kind === "landed"
    ? (await publishLandingNote(runtime, recovered, proof)).data
    : recovered.data;
}
