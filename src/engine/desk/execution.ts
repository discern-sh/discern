/** Execute reviewed Desk effects with their own journal, ownership, and child lifetime. */
import { AsyncLocalStorage } from "../../shared/module_loading.ts";
import { runWithInterruptSource } from "../../shared/interrupt_source.ts";
import {
  type CapturedStream,
  withOutputCapture,
} from "../../shared/output_capture.ts";
import {
  type CompletionObservationFact,
  withCompletionObserver,
} from "../completion/events.ts";
import type { DiscernResult } from "../../shared/result.ts";
import {
  isInteractiveSessionAction,
  operationEffectPolicy,
} from "../../shared/operation_effects.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { beginRecording } from "../logbook/record.ts";
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

/**
 * Where one Desk effect running beside the live screen reports, and what
 * stops it: the text it would have written to the terminal, the completion
 * facts its operation emits (the same facts MCP progress projects), and its
 * operation's signal, its only interrupt.
 */
export interface DeskEffectSession {
  readonly signal: AbortSignal;
  readonly output: (stream: CapturedStream, text: string) => void;
  readonly observe: (fact: CompletionObservationFact) => void;
}

const sessionSignal = new AsyncLocalStorage<AbortSignal>();

/** The signal that stops the in-session effect running in this scope. */
export function deskEffectSignal(): AbortSignal | undefined {
  return sessionSignal.getStore();
}

/**
 * Run one Desk-owned effect beside the screen. Nothing inside reaches the
 * terminal: its output goes to the session, it cannot prompt, every child
 * it spawns is captured and leads its own process group, and no process
 * signal interrupts it. Its operation's signal stops it, through the same
 * journal recovery a CLI interruption takes.
 */
export async function runDeskEffectInSession<T>(
  session: DeskEffectSession,
  work: () => Promise<T>,
): Promise<T> {
  return await runWithInterruptSource(
    "operation",
    () =>
      withOutputCapture({ write: session.output }, () =>
        withCompletionObserver(
          session.observe,
          () => sessionSignal.run(session.signal, work),
        )),
  );
}

/** The result envelope an effect's returned value stands for. */
function deskEnvelope(
  invocation: OperationInvocation,
  value: unknown,
  rendered: DiscernResult | undefined,
): DiscernResult {
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
}

/**
 * Every Desk effect enters the shared execution boundary after its review.
 * Inside an in-session effect, the session's signal stops it.
 *
 * Each one is attributed to its task in the logbook through the recorder
 * the CLI and MCP surfaces use: a begin event when it starts, so a second
 * Desk and `discern status` see it running, and a verb event when it ends.
 * A preview records nothing. An agent, shell or editor session ends as it
 * ends; its exit status says nothing about the task.
 */
export async function executeDeskOperation<T>(
  path: string,
  invocation: OperationInvocation,
  run: (signal: AbortSignal) => Promise<T>,
  explicitSignal?: AbortSignal,
): Promise<T> {
  const signal = explicitSignal ?? deskEffectSignal();
  let envelope: DiscernResult | undefined;
  const execute = async (): Promise<T> => {
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
          envelope = deskEnvelope(invocation, value, rendered);
          return envelope;
        },
        signal,
        undefined,
        { resumeAfterInterrupt: true },
      );
    } catch (error) {
      if (error instanceof OperationLockError) envelope = error.result;
      if (
        error instanceof OperationLockError &&
        error.cause instanceof WorktreeGitError
      ) throw error.cause;
      throw error;
    }
  };
  if (invocation.dryRun === true) return await execute();
  const lockBoundary = operationEffectPolicy(invocation.command, invocation)
    ?.lock;
  const driver = Promise.resolve({ session: "desk", tty: true });
  const recording = beginRecording(path, {
    verb: invocation.command,
    surface: "cli",
    driver,
    ...(lockBoundary === undefined ? {} : { lockBoundary }),
  });
  const started = SYSTEM_CLOCK.monotonicNow();
  try {
    const value = await recording.run(execute);
    envelope ??= deskEnvelope(invocation, value, undefined);
    return value;
  } finally {
    await recording.finish({
      verb: invocation.command,
      surface: "cli",
      outcome:
        envelope?.ok === true || isInteractiveSessionAction(invocation.command)
          ? "ok"
          : "failed",
      durationMs: SYSTEM_CLOCK.monotonicNow() - started,
      ...(envelope === undefined ? {} : { result: envelope }),
      driver: await driver,
    });
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
