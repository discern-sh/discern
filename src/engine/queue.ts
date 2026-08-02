/**
 * `discern queue` command wrapping.
 *
 * The CLI parses only the required `--` boundary. Everything after it is an
 * executable plus raw arguments, run with inherited terminal streams through
 * the owned-child supervision boundary. When the current directory belongs to
 * a configured project with a positive test-run cap, the wrapper holds one
 * shared slot for the child's lifetime.
 */

import { loadConfig } from "../shared/config_schema.ts";
import { findRoot } from "../shared/env.ts";
import { renderHumanOutputGroups } from "../shared/result.ts";
import { reraiseInterrupt } from "./process_signals.ts";
import { runOwnedChild } from "./owned_child.ts";
import {
  buildTestRunSlotAcquirer,
  TEST_RUN_SLOT_ENV,
  TEST_RUN_SLOT_VALUE,
  testRunSlotAccounted,
  type TestRunSlotEvent,
} from "./test_run_slots.ts";

/** The form shared by help and every usage-error recovery line. */
export const QUEUE_USAGE = "discern queue -- <command> [args...]";

/** The pre-Cliffy interpretation of a queue invocation. */
export type QueueInvocation =
  | { readonly kind: "help" }
  | {
    readonly kind: "run";
    readonly command: string;
    readonly args: string[];
  }
  | { readonly kind: "error"; readonly message: string };

/**
 * Split the queue command at its required `--` boundary. Root-global flags may
 * precede the boundary because Cliffy permits them on either side of a verb;
 * `--json` remains unsupported because the child owns both output streams.
 */
export function parseQueueInvocation(
  argsWithoutVerb: readonly string[],
  globalFlags: ReadonlySet<string>,
): QueueInvocation {
  let index = 0;
  const wrapperFlags: string[] = [];
  while (
    index < argsWithoutVerb.length &&
    globalFlags.has(argsWithoutVerb[index] ?? "")
  ) {
    wrapperFlags.push(argsWithoutVerb[index] ?? "");
    index++;
  }
  const args = argsWithoutVerb.slice(index);
  if (args.length === 1 && (args[0] === "-h" || args[0] === "--help")) {
    return { kind: "help" };
  }
  if (wrapperFlags.includes("--json")) {
    return {
      kind: "error",
      message:
        "queue has no `--json` mode because the wrapped command owns stdout and stderr.",
    };
  }
  if (args[0] !== "--") {
    return {
      kind: "error",
      message: "queue needs `--` before the command.",
    };
  }
  const command = args[1];
  if (command === undefined || command === "") {
    return {
      kind: "error",
      message: "queue needs a command after `--`.",
    };
  }
  return { kind: "run", command, args: [...args.slice(2)] };
}

/** Render one queue failure and its canonical recovery form to stderr. */
function writeQueueError(message: string): void {
  console.error(renderHumanOutputGroups([
    { id: "failure", items: [`discern: ${message}`] },
    { id: "recovery", items: [`       Run: ${QUEUE_USAGE}`] },
  ]));
}

/** Report a malformed queue invocation with the conventional usage exit code. */
export function reportQueueUsageError(message: string): number {
  writeQueueError(message);
  return 2;
}

/** Convert an unknown thrown value into the one-line spawn diagnostic. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Print queue and fail-open events on the wrapper's stderr side channel. */
function writeSlotEvent(event: TestRunSlotEvent): void {
  if (event.kind !== "acquired") {
    console.error(event.hint.text);
  }
}

/**
 * Hold a configured test-run slot while the raw command runs. No project means
 * no config read and no limiter; a disabled cap builds no slot directory.
 */
export async function runQueue(
  command: string,
  args: string[],
): Promise<number> {
  const accounted = testRunSlotAccounted();
  const root = accounted ? undefined : await findRoot();
  const acquirer = accounted || root === undefined
    ? undefined
    : buildTestRunSlotAcquirer(root, await loadConfig(root));
  const hold = await acquirer?.acquire(writeSlotEvent);
  try {
    const child = await runOwnedChild(command, {
      args,
      env: { [TEST_RUN_SLOT_ENV]: TEST_RUN_SLOT_VALUE },
    });
    if (child.status.signal !== null) {
      reraiseInterrupt(child.status.signal);
    }
    return child.status.code;
  } catch (error) {
    writeQueueError(
      `couldn't run ${JSON.stringify(command)}: ${errorMessage(error)}`,
    );
    return 127;
  } finally {
    hold?.release();
  }
}
