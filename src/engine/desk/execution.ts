/** Execute reviewed Desk effects with their own journal, ownership, and child lifetime. */
import type { DiscernResult } from "../../shared/result.ts";
import { isInteractiveSessionAction } from "../../shared/operation_effects.ts";
import { executeOperation } from "../operation_execution.ts";
import {
  type OperationInvocation,
  OperationLockError,
} from "../operation_lock.ts";
import { runOwnedChild } from "../owned_child.ts";
import { runProjectScriptAt } from "../project_scripts.ts";
import {
  worktreeErrorResult,
  WorktreeGitError,
} from "../worktree/lifecycle.ts";

/** Every Desk effect enters the shared execution boundary after its review. */
export async function executeDeskOperation<T>(
  path: string,
  invocation: OperationInvocation,
  run: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await executeOperation(
      path,
      invocation,
      async (signal) => {
        try {
          return await run(signal);
        } catch (error) {
          const mapped = worktreeErrorResult(invocation.command, error);
          if (mapped !== undefined) {
            throw new OperationLockError(mapped, { cause: error });
          }
          throw error;
        }
      },
      (value, rendered) => {
        if (
          typeof value === "object" && value !== null && "ok" in value &&
          "verb" in value
        ) {
          return value as DiscernResult;
        }
        // Nested commands emit results too; only the action's own envelope can finish it.
        if (rendered?.verb === invocation.command) return rendered;
        return typeof value !== "number" || value === 0
          ? { ok: true, verb: invocation.command }
          : {
            ok: false,
            verb: invocation.command,
            error: "precondition_failed",
            message:
              `${invocation.command} exited with status ${value}. Read the command output before retrying.`,
          };
      },
      signal,
      undefined,
      { resumeAfterInterrupt: true },
    );
  } catch (error) {
    if (
      error instanceof OperationLockError &&
      error.cause instanceof WorktreeGitError
    ) throw error.cause;
    throw error;
  }
}

/**
 * Launch one desk-owned interactive child with the desk's interrupt contract.
 *
 * The child owns the terminal until the human ends it, so its action must be
 * registered as an interactive session: journaled and owned, but holding no
 * exclusion boundary an idle shell would keep from a running gate.
 */
export async function runDeskInteractiveChild(
  command: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
  action = "desk agent",
): Promise<number> {
  if (!isInteractiveSessionAction(action)) {
    throw new Error(
      `Desk action \`${action}\` launches a terminal-owning child but is not registered ` +
        "as an interactive session in the operation-effect registry. Register it with " +
        "the interactive-session effect and no lock before launching it.",
    );
  }
  return await executeDeskOperation(
    cwd,
    { command: action },
    async (signal) => {
      const child = await runOwnedChild(command, {
        args: [...args],
        cwd,
        env,
        resumeAfterInterrupt: true,
        lineage: "interactive",
        signal,
      });
      return child.status.code;
    },
  );
}

/** Run one desk-owned Project Script with the desk's interrupt contract. */
export async function runDeskProjectScript(
  root: string,
  name: string,
  args: readonly string[],
  env: Record<string, string>,
  expectedExecutable?: string,
  signal?: AbortSignal,
): Promise<number> {
  return await executeDeskOperation(
    root,
    { command: "scripts", hasOperands: true },
    () =>
      runProjectScriptAt(root, name, [...args], {
        env,
        resumeAfterInterrupt: true,
        ...(expectedExecutable === undefined ? {} : { expectedExecutable }),
      }),
    signal,
  );
}
