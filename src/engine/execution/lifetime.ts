/** Native exclusion and durable child receipts survive interruption and checkout disposal. */
import type { z } from "@zod/zod";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { ExecutionIntentSchema } from "./intent.ts";
import { artifactPath, readExecutionDocument } from "./artifact_read.ts";
import { saveEnvironmentArtifact } from "./artifacts.ts";
import { readCompletionRecord } from "../completion/store.ts";
import {
  OperationLockError,
  withCompletionCheckout,
} from "../operation_lock.ts";
import {
  executionChildAbsent,
  withExecutionChildren,
} from "../../shared/execution_child_context.ts";
import { errorReason } from "./types.ts";
import type { ExecutionLifetime } from "./types.ts";

import { StartedChildSchema } from "./artifact_contracts.ts";
/** An unrecorded spawn outcome remains uncertain; an expired lease proves nothing. */
async function inspectExecutionChildren(
  root: string,
  attemptId: string,
): Promise<{ quiescent: boolean; reason: string }> {
  const directory = await artifactPath(root, attemptId, "environment/children");
  try {
    for await (const entry of Deno.readDir(directory)) {
      if (!entry.isFile || !entry.name.startsWith("planned-")) continue;
      const key = entry.name.slice("planned-".length);
      try {
        const terminal = await Deno.readTextFile(
          await artifactPath(
            root,
            attemptId,
            `environment/children/settled-${key}`,
          ),
        );
        if (terminal !== "true") {
          return {
            quiescent: false,
            reason: "A child settlement receipt is invalid.",
          };
        }
        continue;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          return { quiescent: false, reason: errorReason(error) };
        }
      }
      try {
        const started = StartedChildSchema.parse(
          JSON.parse(
            await Deno.readTextFile(
              await artifactPath(
                root,
                attemptId,
                `environment/children/started-${key}`,
              ),
            ),
          ),
        );
        if (!started.isolated || !executionChildAbsent(started.pid, true)) {
          return {
            quiescent: false,
            reason:
              "A child process group remains live or its isolation is unproven.",
          };
        }
      } catch (error) {
        return {
          quiescent: false,
          reason: `The child start receipt is unavailable: ${
            errorReason(error)
          }`,
        };
      }
    }
    return {
      quiescent: true,
      reason: "Every recorded child process group is absent.",
    };
  } catch (error) {
    return {
      quiescent: false,
      reason: `Child receipt inventory is unavailable: ${errorReason(error)}`,
    };
  }
}

/** A conservative observation never turns missing or corrupt child evidence into absence. */
export async function executionChildrenQuiescent(
  root: string,
  attemptId: string,
): Promise<boolean> {
  return (await inspectExecutionChildren(root, attemptId)).quiescent;
}

/** The checkout OS lock spans project work; common locks only publish small receipts. */
export function createNativeExecutionLifetime(root: string): ExecutionLifetime {
  return {
    inspect: async (path) => {
      try {
        return await withCompletionCheckout(
          path,
          () =>
            Promise.resolve({
              quiescent: true,
              reason: "Checkout has no competing operation.",
            }),
        );
      } catch (error) {
        if (!(error instanceof OperationLockError)) throw error;
        return {
          quiescent: false,
          reason: `Checkout exclusion is unavailable: ${error.message}`,
        };
      }
    },
    exclusive: async (path, execution, operation) =>
      await withCompletionCheckout(path, async () => {
        const intent = ExecutionIntentSchema.parse(
          await readExecutionDocument(root, execution.attempt_id, "intent"),
        );
        const current = await readCompletionRecord(root, {
          kind: "environment",
          id: intent.environment_id,
        });
        if (
          current.kind !== "recorded" ||
          current.record.kind !== "environment" ||
          current.record.data.state.kind !== "executing" ||
          current.record.data.state.claim.token !== execution.token ||
          current.record.data.state.attempt_id !== execution.attempt_id ||
          await Deno.realPath(current.record.data.path) !==
            await Deno.realPath(path)
        ) throw new Error("Native execution no longer owns this environment.");
        const subject = {
          attempt_id: execution.attempt_id,
          candidate_id: intent.candidate_id,
          context: intent.context,
        };
        return await withRecordedExecutionChildren(
          root,
          subject,
          execution.token,
          operation,
        );
      }),
    quiesce: async (path, attemptId) =>
      await withCompletionCheckout(
        path,
        async () => {
          const observed = await inspectExecutionChildren(root, attemptId);
          if (!observed.quiescent) throw new Error(observed.reason);
          return true;
        },
      ),
  };
}

/** Shared child receipts for validation and separately reserved retirement effects. */
export async function withRecordedExecutionChildren<T>(
  root: string,
  subject: {
    readonly attempt_id: string;
    readonly candidate_id: string;
    readonly context: string;
  },
  token: string,
  operation: () => Promise<T>,
): Promise<T> {
  await saveEnvironmentArtifact(
    root,
    subject,
    `children/enrolled-${token}`,
    true,
  );
  const prior = await inspectExecutionChildren(root, subject.attempt_id);
  if (!prior.quiescent) throw new Error(prior.reason);
  return await withExecutionChildren({
    planned: async () => {
      const key = SYSTEM_SECURE_ENTROPY.uuid();
      await saveEnvironmentArtifact(
        root,
        subject,
        `children/planned-${key}`,
        { token: token },
      );
      let started: z.infer<typeof StartedChildSchema> | undefined;
      return {
        started: async (pid, isolated) => {
          started = StartedChildSchema.parse({ pid, isolated });
          await saveEnvironmentArtifact(
            root,
            subject,
            `children/started-${key}`,
            started,
          );
        },
        settled: async () => {
          if (
            started !== undefined && started.isolated &&
            executionChildAbsent(started.pid, true)
          ) {
            await saveEnvironmentArtifact(
              root,
              subject,
              `children/settled-${key}`,
              true,
            );
          }
        },
      };
    },
  }, operation);
}
