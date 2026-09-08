import {
  emitCompletionProgress,
  emitComponentUse,
} from "../completion/events.ts";
import { errorReason } from "../execution/types.ts";
import { producerLabel } from "./public_run.ts";
import { SYSTEM_SCHEDULER } from "../../shared/scheduler.ts";
import {
  observeClaimCapacity,
  requireEnvironment,
  unavailable,
} from "../execution/registry.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { runGit } from "../../shared/subprocess.ts";
/** Standalone standards retain component receipts without any queue claim, admission or queue success. */
import { loadConfig } from "../../shared/config_schema.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
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
  CompletionBlocker,
  ValidationPlan,
} from "../completion/protocol.ts";
import {
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import { ownValidationEnvironment } from "../execution/public_environment.ts";
import { createEnvironmentExecutor } from "../execution/executor.ts";
import { completionLease } from "../landing_queue/public_completion.ts";
import {
  gitValue,
  observeSource,
  retainMeasurementCandidate,
} from "../landing_queue/composition.ts";
import { compositionRecipe } from "../landing_queue/generation.ts";
import { predecessorPolicyIdentity } from "../landing_queue/policy.ts";
import {
  initializeQueue,
  observedRecords,
  REPOSITORY_QUEUE_ID,
  reserveQueueAttempt,
} from "../landing_queue/repository.ts";

/** The environment attempt records only its demanded subjects. The queue supplies sequence numbers, never a passed queue claim. */
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
      if (error instanceof IdentityError) return unavailable(error.message);
      throw error;
    }
    const source = await observeSource(
      root,
      identity.id,
      branch.stdout.trim(),
    );
    const predecessor = {
      head: await gitValue(root, [
        "rev-parse",
        `${integrationBranch(config.repository.trunk)}^{commit}`,
      ]),
      candidate_id: null,
    };
    const actor = {
      operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
      originating_effort: identity.id,
      started_at: SYSTEM_CLOCK.wallNow(),
    };
    const configured = await configuredValidation(config, [], false);
    const requirementSet = await requirementSetIdentity(
      configured.obligations.map((entry) => entry.requirement),
    );
    const recipe = await compositionRecipe(
      root,
      config,
      DISCERN_VERSION,
      Math.max(1, config.gate.timeout),
      {},
    );
    const policy = await predecessorPolicyIdentity(root, predecessor.head);
    const prior = observedRecords(await observeCompletionRecords(root)).find((
      record,
    ) =>
      record.kind === "candidate" && record.data.source.head === source.head &&
      record.data.source.effort_id === source.effort_id &&
      record.data.head === source.head &&
      record.data.expected_predecessor.head === predecessor.head &&
      record.data.requirement_set === requirementSet &&
      record.data.policy === policy &&
      record.data.composition.procedure === recipe.identity.procedure
    );
    const candidateId = prior?.kind === "candidate"
      ? prior.id
      : SYSTEM_SECURE_ENTROPY.uuid();
    let candidate: Candidate = prior?.kind === "candidate" ? prior.data : {
      attempt_id: SYSTEM_SECURE_ENTROPY.uuid(),
      source,
      dependencies: [],
      expected_predecessor: predecessor,
      head: source.head,
      tree: source.tree,
      policy,
      requirement_set: requirementSet,
      composition: {
        ...recipe.identity,
        merge_commit: null,
        regeneration_commit: null,
      },
    };
    const capabilities = await ownValidationEnvironment(
      root,
      config,
      source,
      actor,
      null,
    );
    if ("kind" in capabilities) return capabilities;
    const { environmentId, workspace, lifetime } = capabilities;
    if (
      (await readCompletionRecord(root, {
        kind: "queue",
        id: REPOSITORY_QUEUE_ID,
      })).kind === "missing"
    ) await initializeQueue(root, predecessor.head);
    const executor = createEnvironmentExecutor({
      root,
      environmentId,
      declaration: null,
      workspace,
      lifetime,
      leaseMs: await completionLease(config),
      reserveAttempt: (plan, actor) => reserveQueueAttempt(root, plan, actor),
      validationOutcome: (value) =>
        typeof value === "object" && value !== null && "outcome" in value &&
          typeof value.outcome === "object" && value.outcome !== null &&
          "blockers" in value.outcome &&
          Array.isArray(value.outcome.blockers) &&
          value.outcome.blockers.length === 0
          ? "passed"
          : "failed",
      ...(signal === undefined ? {} : { signal }),
    });
    const empty: ValidationPlan = {
      candidate_id: candidateId,
      candidate,
      demand: { kind: "compose", context: "local", mode: "strict" },
      producers: [],
      reused: [],
      blockers: [],
    };
    const plan = executor.plan(await observeCompletionRecords(root), empty);
    if ("kind" in plan) return plan;
    const capacityLimit = plan.declaration?.capacity ?? 1;
    let pendingAttempt: string | undefined;
    const claim = async () => {
      while (!signal.aborted) {
        const availability = await observeClaimCapacity(
          root,
          (await requireEnvironment(root, environmentId)).record.data,
          capacityLimit,
        );
        if (availability === null) {
          const claimed = await executor.claim(plan, actor);
          if (!("kind" in claimed)) return claimed;
          // Claim rechecks under exclusion. A racing winner can consume capacity
          // after observation; only an observed live owner permits another wait.
          if (
            await observeClaimCapacity(
              root,
              (await requireEnvironment(root, environmentId)).record.data,
              capacityLimit,
            ) === null
          ) return claimed;
        } else if (availability.kind !== "waiting-for-operation") {
          return availability;
        }
        if (
          availability?.kind === "waiting-for-operation" &&
          pendingAttempt !== availability.attempt_id
        ) {
          pendingAttempt = availability.attempt_id;
          emitCompletionProgress({
            phase: "environment",
            state: "waiting",
            candidate_id: candidateId,
            reason:
              `Waiting for execution ${availability.attempt_id} to return its environment.`,
          });
        }
        await new Promise<void>((resolve) =>
          SYSTEM_SCHEDULER.scheduleTimeout(resolve, 250)
        );
      }
      return unavailable(
        "Measurement was cancelled while waiting for execution capacity.",
      );
    };
    const claimed = await claim();
    if ("kind" in claimed) return claimed;
    let failure: unknown;
    const returned = await executor.execute(claimed, async (execution) => {
      try {
        if (prior === undefined) {
          // A measurement reports this exact authored source against the current
          // policy base. It neither composes a landing candidate nor enters the queue.
          candidate = { ...candidate, attempt_id: execution.fence.attempt_id };
          await retainMeasurementCandidate(
            root,
            candidateId,
            candidate,
            execution.fence,
          );
        }
        const validation = await executePublicValidation({
          root,
          config,
          scopes: [],
          claimed: { ...execution, candidate },
          ...(capacity === undefined ? {} : { capacity }),
          stageDependencies: false,
          bindComposition: true,
          demand: {
            kind,
            context: "local",
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
            execution.fence,
          );
          if (written.kind !== "written") {
            throw new Error(`Measurement receipt publication ${written.kind}.`);
          }
          emitComponentUse(
            { ...execution, candidate },
            component,
            evidenceId,
            "executed",
            (validation.results.get(
              producerLabel(component.applicability.producer),
            )?.durationS ?? 0) * 1000,
            component.finished_at,
          );
        }
        return validation;
      } catch (error) {
        failure = error;
        throw error;
      }
    });
    if (returned.returned.kind === "recovery-incomplete") {
      return { ...returned.returned, record_id: environmentId };
    }
    if (returned.validation === null) {
      return {
        kind: "validation-failed",
        evidence_ids: [],
        attempt_id: claimed.fence.attempt_id,
        reason: failure === undefined
          ? "Measurement execution did not return evidence."
          : errorReason(failure),
      };
    }
    return returned.validation;
  }, externalSignal);
}
