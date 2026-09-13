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
import { Logger } from "../lib/log.ts";
import { reportFailure } from "../lib/narration.ts";
import { recordedRun } from "./logbook/cli.ts";
import { reraiseInterrupt } from "./process_signals.ts";
import { runOwnedChild } from "./owned_child.ts";
import { writeStderr } from "./output.ts";
import { withCompletionObserver } from "./completion/events.ts";
import { progressWaitSentence } from "./completion/progress_wait.ts";
import { EXIT_EXECUTABLE_NOT_FOUND, EXIT_USAGE } from "../shared/exit_codes.ts";
import {
  buildTestRunSlotAcquirer,
  TEST_RUN_SLOT_ENV,
  TEST_RUN_SLOT_VALUE,
  testRunSlotAccounted,
  type TestRunSlotAcquirer,
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
 * Quiet result formats remain unsupported because the child owns both output streams.
 */
export function parseQueueInvocation(
  argsWithoutVerb: readonly string[],
  globalFlags: ReadonlySet<string>,
  valueFlags: ReadonlySet<string> = new Set(),
): QueueInvocation {
  let index = 0;
  const wrapperFlags: string[] = [];
  while (index < argsWithoutVerb.length) {
    const token = argsWithoutVerb[index] ?? "";
    const equals = token.indexOf("=");
    const flag = globalFlags.has(token)
      ? token
      : equals > 0 && valueFlags.has(token.slice(0, equals))
      ? token.slice(0, equals)
      : undefined;
    if (flag === undefined) break;
    wrapperFlags.push(flag);
    index += equals > 0 || !valueFlags.has(flag) ? 1 : 2;
  }
  const args = argsWithoutVerb.slice(index);
  if (args.length === 1 && (args[0] === "-h" || args[0] === "--help")) {
    return { kind: "help" };
  }
  const resultFlag = wrapperFlags.find((flag) =>
    flag === "--json" || flag === "--markdown" || flag === "--render"
  );
  if (resultFlag !== undefined) {
    return {
      kind: "error",
      message:
        "queue has no `--json`, `--markdown`, or `--render` mode because the wrapped command owns stdout and stderr.",
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
  reportFailure(
    new Logger({ json: false, noColor: false }),
    message,
    [`Run: ${QUEUE_USAGE}`],
  );
}

/** Report a malformed queue invocation with the conventional usage exit code. */
export function reportQueueUsageError(message: string): number {
  writeQueueError(message);
  return EXIT_USAGE;
}

/** Convert an unknown thrown value into the one-line spawn diagnostic. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Print queue and fail-open events on the wrapper's stderr side channel. */
function writeSlotEvent(event: TestRunSlotEvent): void {
  if (event.kind === "unavailable") {
    writeStderr(`${event.hint.text}\n`);
  }
}

/**
 * Hold a configured test-run slot while the raw command runs. No project means
 * no config read and no limiter; a disabled cap builds no slot directory.
 */
async function runQueueChild(
  command: string,
  args: string[],
  accounted: boolean,
  observeAcquirer?: (acquirer: TestRunSlotAcquirer | undefined) => void,
): Promise<number> {
  const root = accounted ? undefined : await findRoot();
  const acquirer = accounted || root === undefined
    ? undefined
    : buildTestRunSlotAcquirer(root, await loadConfig(root));
  observeAcquirer?.(acquirer);
  const hold = await withCompletionObserver((fact) => {
    if (fact.kind === "wait") {
      writeStderr(`${progressWaitSentence(fact.wait)}\n`);
    }
  }, async () => await acquirer?.acquire(writeSlotEvent, undefined, command));
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
    return EXIT_EXECUTABLE_NOT_FOUND;
  } finally {
    hold?.release();
  }
}

/**
 * Run one queue wrapper. An upstream marker transfers both slot and telemetry
 * ownership to the ancestor, so only an unmarked invocation enters the CLI
 * recording chokepoint. The executable is the event target; child arguments
 * remain outside the metadata-only logbook.
 */
export async function runQueue(
  command: string,
  args: string[],
): Promise<number> {
  const accounted = testRunSlotAccounted();
  if (accounted) {
    return await runQueueChild(command, args, true);
  }
  let acquirer: TestRunSlotAcquirer | undefined;
  return await recordedRun(
    "queue",
    "cli",
    () => runQueueChild(command, args, false, (value) => acquirer = value),
    {
      target: command,
      waitedMs: () => acquirer?.waitedMs,
      hasOperands: true,
    },
  );
}
