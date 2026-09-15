/** Shared public execution: journal before exclusion, retain the delivered result. */
import { runGit } from "../shared/subprocess.ts";
import { CommonPublicationExecutionError } from "../shared/operation_execution_boundary.ts";
import { loadConfig } from "../shared/config_schema.ts";
import { resolveConfigPath } from "../lib/paths.ts";
import {
  managedMaterialBoundary,
  trunkManagedVersionBoundary,
} from "./managed_version.ts";

import type { DiscernResult } from "../shared/result.ts";
import { withResultObserver } from "../shared/result_capture.ts";
import { operationEffectPolicy } from "../shared/operation_effects.ts";
import {
  currentOperationOwner,
  inheritedOperationLockLeases,
  type OperationOwner,
  readLiveOperationLease,
  runWithOperationOwner,
} from "../shared/operation_lock_context.ts";
import { SYSTEM_SECURE_ENTROPY } from "../shared/entropy.ts";
import { SYSTEM_CLOCK, wallTimeIso } from "../shared/clock.ts";
import {
  readOperationJournal,
  withOperationJournal,
} from "./completion/operation_journal.ts";
import {
  type CompletionObservationFact,
  withCompletionObserver,
} from "./completion/events.ts";
import { withTrackedRun } from "./jobs/interrupt.ts";
import {
  type OperationInvocation,
  OperationLockError,
  withOperationLock,
} from "./operation_lock.ts";

/** Both public surfaces enter here; dry runs and read-only forms stay read-only. */
export async function executeOperation<T>(
  root: string,
  invocation: OperationInvocation,
  body: (signal: AbortSignal) => Promise<T>,
  result: (value: T, rendered: DiscernResult | undefined) => DiscernResult,
  externalSignal?: AbortSignal,
  announce?: (fact: CompletionObservationFact) => void,
  options: { resumeAfterInterrupt?: boolean } = {},
): Promise<T> {
  const policy = operationEffectPolicy(invocation.command, invocation);
  // Refuse without journal effects, then recheck after acquiring exclusion: a
  // preceding operation may have adopted a newer version while this one waited.
  await assertOperationAdoption(root, invocation);
  const guardedBody = async (signal: AbortSignal): Promise<T> => {
    await assertOperationAdoption(root, invocation);
    return await body(signal);
  };
  const observable = !invocation.dryRun &&
    ((policy !== undefined && policy.lock !== "none") ||
      (policy?.lockWhen === undefined &&
        policy?.effects.includes("project-command")));
  if (!observable) {
    return await withOperationLock(
      root,
      invocation,
      () => guardedBody(externalSignal ?? new AbortController().signal),
    );
  }
  return await withTrackedRun(externalSignal, async (signal) => {
    const parent = await inheritedJournalOwner(root);
    const branch = await runGit(
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { cwd: root },
    );
    let observed: DiscernResult | undefined;
    const outcome = await withResultObserver(
      (value) => {
        observed = value;
      },
      () =>
        withCompletionObserver((fact) => {
          announce?.(fact);
        }, () =>
          withOperationJournal(
            root,
            {
              verb: invocation.command,
              path: root,
              ...(branch.success ? { branch: branch.stdout.trim() } : {}),
            },
            async (handle) => {
              const owner = currentOperationOwner() ?? {
                id: SYSTEM_SECURE_ENTROPY.uuid(),
                command: invocation.command,
                path: root,
                started: wallTimeIso(SYSTEM_CLOCK.wallNow()),
                ...(handle === undefined ? {} : { handle }),
              };
              return await runWithOperationOwner(owner, async () => {
                try {
                  const value = await withOperationLock(
                    root,
                    invocation,
                    () => guardedBody(signal),
                  );
                  return {
                    kind: "returned" as const,
                    value,
                    result: result(value, observed),
                  };
                } catch (caught) {
                  const error =
                    caught instanceof CommonPublicationExecutionError
                      ? new OperationLockError({
                        ok: false,
                        verb: invocation.resultVerb ?? invocation.command,
                        error: "precondition_failed",
                        message: caught.message,
                      }, { cause: caught })
                      : caught;
                  return {
                    kind: "threw" as const,
                    error,
                    result: error instanceof OperationLockError
                      ? error.result
                      : {
                        ok: false as const,
                        verb: invocation.resultVerb ?? invocation.command,
                        error: "internal_error" as const,
                        message:
                          "The operation failed. Read the calling surface for its diagnostic before retrying.",
                      },
                  };
                }
              });
            },
            {
              result: (value) => value.result,
              signal,
              ...(parent?.handle === undefined ? {} : {
                parent: { handle: parent.handle, verb: parent.command },
              }),
            },
          )),
    );
    if (outcome.kind === "threw") throw outcome.error;
    return outcome.value;
  }, options);
}

/** Registry-driven writer protection; adoption is not a universal runtime floor. */
async function assertOperationAdoption(
  root: string,
  invocation: OperationInvocation,
): Promise<void> {
  const policy = operationEffectPolicy(invocation.command, invocation);
  if (
    !policy?.effects.includes("managed-artifact-write") &&
    invocation.command !== "done"
  ) return;
  if (await resolveConfigPath(root) === undefined) return;
  const config = await loadConfig(root);
  const currency = managedMaterialBoundary(config);
  const regression =
    invocation.command === "done" || invocation.command === "accept" ||
      invocation.command === "setup accept"
      ? await trunkManagedVersionBoundary(root, config)
      : undefined;
  const message = currency === undefined ? regression : currency +
    " Managed-artifact currency and ordinary Proof are unavailable to this binary. Safe reads and `discern test` remain available.";
  if (message !== undefined) {
    throw new OperationLockError({
      ok: false,
      verb: invocation.resultVerb ?? invocation.command,
      error: "precondition_failed",
      message,
    });
  }
}

/** A delegated child belongs to its live lease owner's journal. The parent
 * remains the only writer and retains the enclosing command's final result. */
async function inheritedJournalOwner(
  root: string,
): Promise<OperationOwner | undefined> {
  for (const lease of inheritedOperationLockLeases()) {
    const live = await readLiveOperationLease(lease);
    if (live?.owner?.handle === undefined) continue;
    // A command targeting another repository owns its own observation lifetime.
    const parent = await readOperationJournal(root, live.owner.handle);
    if (parent.kind === "found") return live.owner;
  }
  return undefined;
}
