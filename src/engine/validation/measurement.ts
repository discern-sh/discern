/** Standalone standards retain component receipts on the source tip's own attempt, without Proof. */
import { emitComponentUse } from "../completion/events.ts";
import { producerLabel } from "./public_run.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { runGit } from "../../shared/subprocess.ts";
import { loadConfig } from "../../shared/config_schema.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { withCompletionCheckout } from "../operation_lock.ts";
import { IdentityError, resolveIdentity } from "../worktree/identity.ts";
import { integrationBranch, repoToplevel } from "../worktree/git.ts";
import { pinValidatedTree } from "../gate/proof.ts";
import { configuredValidation } from "./configuration.ts";
import { requirementSetIdentity } from "./catalog.ts";
import { standaloneValidation } from "./diagnostics.ts";
import {
  executePublicValidation,
  type PublicValidationCapacity,
  type PublicValidationRun,
} from "./public_run.ts";
import { observeCompletionRecords } from "./runtime.ts";
import type { Candidate } from "../completion/candidate.ts";
import type {
  ClaimedExecution,
  CompletionBlocker,
} from "../completion/protocol.ts";
import { writeCompletionRecord } from "../completion/store.ts";
import {
  attemptLease,
  reserveAttempt,
  settleAttempt,
} from "../completion/attempt_lifecycle.ts";
import {
  gitValue,
  observeSource,
  predecessorPolicyIdentity,
  recordedCandidate,
  retainCandidate,
} from "../completion/source.ts";

/** Preserve a concrete failure reason without assigning it a verdict. */
function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Measure the named standards on this checkout's committed tip. The receipts
 * join the candidate's recorded evidence so a later `done` can reuse them; no
 * Proof is assembled. A dirty or detached checkout measures standalone.
 */
export async function measureDeclaredStandards(
  root: string,
  names: readonly string[],
  kind: "standards" | "pin" | "proposal",
  externalSignal?: AbortSignal,
  capacity?: PublicValidationCapacity,
): Promise<PublicValidationRun | CompletionBlocker> {
  root = await Deno.realPath(root);
  return await withCompletionCheckout(root, async (signal) => {
    const config = await loadConfig(root);
    const pin = await pinValidatedTree(root);
    const branch = await runGit(["symbolic-ref", "--quiet", "HEAD"], {
      cwd: root,
    });
    if (!branch.success && branch.code !== 1) {
      throw new Error(
        branch.stderr ||
          "Git could not observe the measurement checkout attachment.",
      );
    }
    if (
      !pin.clean || pin.head === undefined || !branch.success ||
      await repoToplevel(root) !== root
    ) {
      return await standaloneValidation({
        root,
        config,
        scopes: [],
        kind: "standalone",
        standards: names,
        ...(capacity === undefined ? {} : { capacity }),
        ...(signal === undefined ? {} : { signal }),
      });
    }
    let identity;
    try {
      identity = await resolveIdentity(root, root);
    } catch (error) {
      if (error instanceof IdentityError) {
        return { kind: "unavailable", reason: error.message };
      }
      throw error;
    }
    const source = await observeSource(
      root,
      identity.id,
      branch.stdout.trim(),
    );
    const predecessor = await gitValue(root, [
      "rev-parse",
      `${integrationBranch(config.repository.trunk)}^{commit}`,
    ]);
    const actor = {
      operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
      originating_effort: identity.id,
      started_at: SYSTEM_CLOCK.wallNow(),
    };
    const configured = await configuredValidation(config, [], false);
    const requirementSet = await requirementSetIdentity(
      configured.obligations.map((entry) => entry.requirement),
    );
    const policy = await predecessorPolicyIdentity(root, predecessor);
    const prior = recordedCandidate(
      (await observeCompletionRecords(root)).records.flatMap(({ reading }) =>
        reading.kind === "recorded" ? [reading.record] : []
      ),
      {
        sources: [source],
        head: source.head,
        predecessor,
        requirement_set: requirementSet,
        policy,
      },
    );
    const candidateId = prior?.id ?? SYSTEM_SECURE_ENTROPY.uuid();
    const reserved = await reserveAttempt(root, {
      candidate_id: candidateId,
      executor: actor,
      rerun_of: null,
      mode: "strict",
      lease_ms: await attemptLease(config),
    });
    const candidate: Candidate = prior?.data ?? {
      attempt_id: reserved.attempt.identity.id,
      sources: [source],
      predecessor,
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
    try {
      const validation = await executePublicValidation({
        root,
        config,
        scopes: [],
        claimed: execution,
        ...(capacity === undefined ? {} : { capacity }),
        stageDependencies: false,
        bindAttempt: true,
        demand: {
          kind,
          mode: "strict",
          requirements: configured.obligations.filter((entry) =>
            entry.requirement.kind === "standard" &&
            names.includes(entry.requirement.id)
          ).map((entry) => entry.requirement),
        },
      });
      for (const component of validation.outcome.evidence) {
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
          throw new Error(`Measurement receipt publication ${written.kind}.`);
        }
        emitComponentUse(
          execution,
          component,
          evidenceId,
          "executed",
          (validation.results.get(
            producerLabel(component.applicability.producer),
          )?.durationS ?? 0) * 1000,
          component.finished_at,
        );
      }
      await settleAttempt(
        root,
        reserved.fence,
        validation.outcome.blockers.length === 0 ? "passed" : "failed",
      );
      return validation;
    } catch (error) {
      await settleAttempt(
        root,
        reserved.fence,
        signal.aborted ? "cancelled" : "failed",
      );
      return {
        kind: "validation-failed",
        evidence_ids: [],
        attempt_id: reserved.fence.attempt_id,
        reason: errorReason(error),
      };
    }
  }, externalSignal);
}
