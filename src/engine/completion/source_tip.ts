/**
 * One `done` proves the invoking checkout's committed tip against the trunk it
 * was checked on. The run records the candidate, reserves one attempt,
 * executes the demanded producers in this checkout, publishes their evidence,
 * assembles the complete Proof, and settles the attempt. Nothing here installs
 * a revision into any checkout or waits on another effort.
 */
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import type { CompletionProofPointer } from "../../shared/completion_proof.ts";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { runGit } from "../../shared/subprocess.ts";
import { withCompletionCheckout } from "../operation_lock.ts";
import { classifyScopeImpact } from "../scopes/scopes.ts";
import { requirementSetIdentity } from "../validation/catalog.ts";
import { configuredValidation } from "../validation/configuration.ts";
import { producerLabel } from "../validation/public_run.ts";
import type { PublicValidationRun } from "../validation/public_run.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import {
  finishedValidationAttempts,
  indexEvidence,
} from "../validation/selection.ts";
import { integrationBranch } from "../worktree/git.ts";
import { IdentityError, resolveIdentity } from "../worktree/identity.ts";
import type { CompletionArtifact } from "./artifacts.ts";
import {
  attemptLease,
  reserveAttempt,
  settleAttempt,
} from "./attempt_lifecycle.ts";
import type { Candidate } from "./candidate.ts";
import { completionRecordBlocker } from "./compatibility.ts";
import { emitCompletionEvent, emitComponentUse } from "./events.ts";
import type { Executor } from "./identity.ts";
import type {
  ClaimedExecution,
  CompletionBlocker,
  CompletionEvent,
} from "./protocol.ts";
import {
  gitValue,
  observeSource,
  predecessorPolicyIdentity,
  recordedCandidate,
  retainCandidate,
} from "./source.ts";
import { writeCompletionRecord } from "./store.ts";
import type { CompletionRecord } from "./records.ts";

/** What the gate receives once the run holds its attempt. */
export interface CompletionSession {
  readonly execution: ClaimedExecution;
  readonly mode: "strict" | "report";
  readonly rerun_of?: string;
}
export interface CompletionRunValue<T> {
  readonly value: T;
  readonly passed: boolean;
  readonly validation?: PublicValidationRun;
  readonly blockers?: readonly CompletionBlocker[];
  readonly review?: CompletionArtifact;
}
export interface CompletedCandidate<T> {
  readonly kind: "completed";
  readonly value: T;
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly proof_id?: string;
  readonly blockers: readonly CompletionBlocker[];
}

/** The obligations of the source tip, as the trunk's scopes select them. */
export async function requirementsAt(
  root: string,
  config: DiscernConfig,
): Promise<string> {
  const impact = await classifyScopeImpact(root, config);
  return await requirementSetIdentity(
    (await configuredValidation(config, impact.scopes)).obligations.map((
      entry,
    ) => entry.requirement),
  );
}

/** Project recorded readings onto validated envelopes. */
function observedRecords(
  observation: Awaited<ReturnType<typeof observeCompletionRecords>>,
): CompletionRecord[] {
  return observation.records.flatMap(({ reading }) =>
    reading.kind === "recorded" ? [reading.record] : []
  );
}

/**
 * Prove the invoking checkout's committed tip. `run` executes the gate over the
 * claimed attempt and reports its producers' evidence; `finalize` records the
 * gate marker and presentation once the complete Proof exists.
 */
export async function completeSourceTip<T>(
  rootInput: string,
  options: {
    readonly mode: "strict" | "report";
    readonly rerun?: boolean;
    readonly signal?: AbortSignal;
  },
  run: (session: CompletionSession) => Promise<CompletionRunValue<T>>,
  finalize?: (value: T, pointer: CompletionProofPointer) => Promise<boolean>,
): Promise<CompletedCandidate<T> | CompletionBlocker> {
  const requestedAt = SYSTEM_CLOCK.wallNow();
  let attribution: Omit<CompletionEvent, "id" | "at" | "fact"> | undefined;
  const root = await Deno.realPath(rootInput);
  const completed = await withCompletionCheckout<
    CompletedCandidate<T> | CompletionBlocker
  >(root, async (signal) => {
    const config = await loadConfig(root);
    let identity;
    try {
      identity = await resolveIdentity(root, root);
    } catch (error) {
      if (error instanceof IdentityError) {
        return { kind: "unavailable" as const, reason: error.message };
      }
      throw error;
    }
    const branchRun = await runGit(["symbolic-ref", "--quiet", "HEAD"], {
      cwd: root,
    });
    if (!branchRun.success) {
      return {
        kind: "unavailable" as const,
        reason:
          "Completion proves a named branch's committed tip; switch this checkout to its branch, then run discern done.",
      };
    }
    const source = await observeSource(
      root,
      identity.id,
      branchRun.stdout.trim(),
    );
    const actor: Executor = {
      operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
      originating_effort: source.effort_id,
      started_at: SYSTEM_CLOCK.wallNow(),
    };
    attribution = {
      effort_id: source.effort_id,
      source_head: source.head,
      candidate_id: null,
      attempt_id: null,
      executor_operation: actor.operation_id,
    };
    const trunk = integrationBranch(config.repository.trunk);
    const trunkHead = await gitValue(root, [
      "rev-parse",
      "--verify",
      `refs/heads/${trunk}^{commit}`,
    ]);
    const contained = await runGit(
      ["merge-base", "--is-ancestor", trunkHead, source.head],
      { cwd: root },
    );
    if (!contained.success) {
      if (contained.code !== 1) {
        throw new Error("Candidate predecessor ancestry is unavailable.");
      }
      return {
        kind: "unavailable" as const,
        reason:
          `This branch is behind ${trunk}. Run discern update, then discern done.`,
      };
    }
    const policy = await predecessorPolicyIdentity(root, trunkHead);
    const requirementSet = await requirementsAt(root, config);
    const observation = await observeCompletionRecords(root);
    const unsupported = completionRecordBlocker(observation);
    if (unsupported !== undefined) return unsupported;
    const records = observedRecords(observation);
    const prior = recordedCandidate(records, {
      sources: [source],
      predecessor: trunkHead,
      policy,
      requirement_set: requirementSet,
    });
    const candidateId = prior?.id ?? SYSTEM_SECURE_ENTROPY.uuid();
    // The newest finished attempt this effort recorded, whichever candidate
    // recorded it: reusable subjects survive source edits, so an explicit
    // retry must bound failures a predecessor candidate left behind.
    const rerunOf = options.rerun
      ? finishedValidationAttempts(records).find((attempt) =>
        attempt.data.identity.candidate_id === candidateId ||
        attempt.data.identity.executor.originating_effort === source.effort_id
      )?.id ?? null
      : null;
    // A red verdict is sticky for the unchanged subject: when this exact
    // candidate's newest finished attempt failed WITH an adverse receipt — a
    // producer the run judged red — a bare strict run refuses before any
    // producer or gate job runs, and `--rerun` executes and records the
    // deliberate repeat. A cancelled attempt carries no verdict, and an
    // attempt that failed without judging any producer (an observation or
    // environment failure) may clear itself, so neither blocks a retry.
    if (!options.rerun && options.mode === "strict") {
      const judged = finishedValidationAttempts(records).find((attempt) =>
        attempt.data.identity.candidate_id === candidateId
      );
      const adverse = judged === undefined
        ? false
        : (indexEvidence(records).receipts.get(judged.id) ?? []).some((
          receipt,
        ) => receipt.data.outcome.kind === "failed");
      if (
        judged !== undefined && adverse &&
        judged.data.state.kind === "finished" &&
        judged.data.state.outcome === "failed"
      ) {
        return {
          kind: "validation-failed" as const,
          evidence_ids: [],
          attempt_id: judged.id,
          reason:
            `the gate already judged this exact candidate red (attempt ${judged.id}); nothing has changed since. ` +
            `Resolve the failure, then use discern done --rerun for a deliberate retry of the unchanged subject.`,
        };
      }
    }
    const reserved = await reserveAttempt(root, {
      candidate_id: candidateId,
      executor: actor,
      rerun_of: rerunOf,
      mode: options.mode,
      lease_ms: await attemptLease(config),
    });
    attribution = {
      ...attribution,
      candidate_id: candidateId,
      attempt_id: reserved.attempt.identity.id,
    };
    const candidate: Candidate = prior?.data ?? {
      attempt_id: reserved.attempt.identity.id,
      sources: [source],
      predecessor: trunkHead,
      head: source.head,
      tree: source.tree,
      policy,
      requirement_set: requirementSet,
    };
    if (prior === undefined) {
      await retainCandidate(root, candidateId, candidate, reserved.fence);
    }
    const execution: ClaimedExecution = {
      fence: reserved.fence,
      attempt: reserved.attempt,
      path: root,
      seed: identity.seed,
      candidate_id: candidateId,
      candidate,
      signal,
    };
    const settle = async (
      outcome: "passed" | "failed" | "cancelled",
    ): Promise<void> => {
      await settleAttempt(root, reserved.fence, outcome);
    };
    let result: CompletionRunValue<T> | undefined;
    let failure: string | undefined;
    try {
      result = await run({
        execution,
        mode: options.mode,
        ...(rerunOf === null ? {} : { rerun_of: rerunOf }),
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    if (result === undefined) {
      await settle(signal.aborted ? "cancelled" : "failed");
      if (signal.aborted) {
        return {
          kind: "cancelled" as const,
          reason: "Completion was cancelled before it produced a result.",
        };
      }
      return {
        kind: "validation-failed" as const,
        evidence_ids: [],
        reason: failure ??
          "Validation did not produce a result. Inspect the run's diagnostics and run again.",
      };
    }
    // Every produced component becomes an immutable receipt under this
    // attempt's fence, whatever the run's verdict: a failed producer's
    // evidence is as durable as a passing one's.
    let publicationFailure: CompletionBlocker | undefined;
    for (const component of result.validation?.outcome.evidence ?? []) {
      const evidenceId = SYSTEM_SECURE_ENTROPY.uuid();
      const written = await writeCompletionRecord(
        root,
        {
          version: ON_DISK_FORMATS.completionRecord.version,
          kind: "evidence",
          id: evidenceId,
          revision: 1,
          data: component,
        },
        null,
        reserved.fence,
      );
      if (written.kind !== "written") {
        publicationFailure = written.kind === "newer" ||
            written.kind === "older" || written.kind === "invalid" ||
            written.kind === "unavailable"
          ? completionRecordBlocker({
            records: [{
              selector: { kind: "evidence", id: evidenceId },
              reading: written,
            }],
          })
          : {
            kind: "stale-evidence",
            evidence_ids: [],
            reason: "claim-lost",
          };
        break;
      }
      emitComponentUse(
        execution,
        component,
        evidenceId,
        "executed",
        (result.validation?.results.get(
          producerLabel(component.applicability.producer),
        )?.durationS ?? 0) * 1000,
        component.finished_at,
      );
    }
    const base = {
      kind: "completed" as const,
      value: result.value,
      candidate_id: candidateId,
      candidate,
    };
    if (signal.aborted) {
      await settle("cancelled");
      return {
        ...base,
        blockers: [{
          kind: "cancelled" as const,
          reason: "Completion was cancelled; its attempt is closed.",
        }],
      };
    }
    if (publicationFailure !== undefined) {
      await settle("failed");
      return { ...base, blockers: [publicationFailure] };
    }
    if (result.blockers !== undefined && result.blockers.length > 0) {
      await settle("failed");
      return { ...base, blockers: result.blockers };
    }
    const validation = result.validation;
    if (
      !result.passed || validation === undefined ||
      validation.outcome.blockers.length > 0
    ) {
      await settle("failed");
      return {
        ...base,
        blockers: validation?.outcome.blockers.length
          ? validation.outcome.blockers
          : [{ kind: "validation-failed" as const, evidence_ids: [] }],
      };
    }
    // Assemble the complete Proof from every applicable receipt now recorded,
    // attributed to this attempt while its claim is still live.
    await validation.evaluator.observe(candidateId);
    const assembly = validation.evaluator.assemble(
      candidateId,
      candidate,
      validation.snapshot.requirements,
      observedRecords(await observeCompletionRecords(root)),
      options.mode,
      reserved.fence,
    );
    if (assembly.kind === "incomplete") {
      await settle("failed");
      return { ...base, blockers: assembly.blockers };
    }
    const proofId = reserved.fence.attempt_id;
    const proof = await writeCompletionRecord(
      root,
      {
        version: ON_DISK_FORMATS.completionRecord.version,
        kind: "proof",
        id: proofId,
        revision: 1,
        data: {
          ...assembly.proof,
          ...(result.review === undefined ? {} : { review: result.review }),
        },
      },
      null,
      reserved.fence,
    );
    if (proof.kind !== "written") {
      await settle("failed");
      return {
        ...base,
        blockers: [{
          kind: "unavailable" as const,
          reason:
            `Proof publication ${proof.kind}; observe the records and run discern done again.`,
        }],
      };
    }
    await settle("passed");
    emitCompletionEvent({
      id: `${proofId}:proven`,
      at: SYSTEM_CLOCK.wallNow(),
      effort_id: source.effort_id,
      source_head: source.head,
      candidate_id: candidateId,
      attempt_id: proofId,
      executor_operation: actor.operation_id,
      fact: { kind: "proven", proof_id: proofId, mode: options.mode },
    });
    const pointer: CompletionProofPointer = {
      candidate_id: candidateId,
      proof_id: proofId,
    };
    await finalize?.(result.value, pointer);
    return { ...base, proof_id: proofId, blockers: [] };
  }, options.signal);
  if (attribution !== undefined) {
    const finishedAt = SYSTEM_CLOCK.wallNow();
    emitCompletionEvent({
      ...attribution,
      id: `${attribution.executor_operation}:validation-feedback`,
      at: finishedAt,
      fact: {
        kind: "timing",
        interval_id: attribution.executor_operation,
        category: "validation-feedback",
        started_at: requestedAt,
        finished_at: finishedAt,
      },
    });
  }
  return completed;
}
