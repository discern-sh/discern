/**
 * The reconnect surface over operation journals: one call reads a long
 * operation's phase, the counts and failures known so far, named timing
 * boundaries, and the retained final result when one exists. Reading is
 * observation only — it starts, repairs, and cancels nothing, and an
 * observer's own loss never changes what the journal records.
 */
import { emitResult } from "../../shared/emit.ts";
import {
  fire,
  HINTS,
  hintTexts,
  interactiveHintTexts,
} from "../../shared/hints.ts";
import type { DiscernResult } from "../../shared/result.ts";
import { colorEnabled, makeOut } from "../output.ts";
import type {
  CompletionFailure,
  CompletionProgress,
  ProducerWork,
} from "./events.ts";
import {
  completionFailureSentence,
  completionProgressSentence,
  producerWorkSentence,
} from "./progress_prose.ts";
import {
  type ExecutorLiveness,
  type OperationJournalRecord,
  type OperationOutcome,
  type OperationTiming,
  readOperationJournal,
} from "./operation_journal.ts";

/** What one reconnect read returns about the selected operation. */
export interface OperationProgressData {
  readonly handle: string;
  /** The journalled operation's own verb, path, and branch. */
  readonly operation: {
    readonly verb: string;
    readonly path: string;
    readonly branch?: string;
    readonly started_at: number;
    readonly finished_at?: number;
  };
  /**
   * Whether a process with the recording process's id exists right now —
   * not proof it is the same executor — or whether that could not be checked.
   */
  readonly executor: ExecutorLiveness;
  /** Why the liveness check could not run, when `executor` is unknown. */
  readonly executor_reason?: string;
  /** How the executor closed the operation; absent while it has not. */
  readonly outcome?: OperationOutcome;
  /** The latest progress fact, exactly as live observers received it. */
  readonly progress?: CompletionProgress;
  readonly producers?: readonly ProducerWork[];
  readonly failures?: readonly CompletionFailure[];
  readonly timings?: readonly OperationTiming[];
  /** The retained final result envelope, when one exists and fit the bound. */
  readonly result?: unknown;
  readonly result_truncated?: boolean;
  /** Where the complete envelope lives when the record holds a reduced one. */
  readonly result_path?: string;
  /**
   * The composed sentences every surface presents, in order: the latest
   * progress fact, each producer's counts, each established failure. Composed
   * once here so no surface derives its own account.
   */
  readonly account: readonly string[];
}

/** Compose the account once from the retained facts. */
function accountOf(record: OperationJournalRecord): string[] {
  const sentences: string[] = [];
  if (record.progress !== undefined) {
    sentences.push(completionProgressSentence(record.progress));
  }
  for (const work of Object.values(record.producers ?? {})) {
    if (work.units !== undefined || work.results !== undefined) {
      sentences.push(producerWorkSentence(work));
    }
  }
  for (const failure of record.failures ?? []) {
    sentences.push(completionFailureSentence(failure));
  }
  return sentences;
}

/** Compose the first paragraph: the operation, what happened, the next command. */
function progressMessage(
  record: OperationJournalRecord,
  executor: ExecutorLiveness,
  executorReason: string | undefined,
): string {
  const name = record.operation.branch === undefined
    ? `\`${record.operation.verb}\``
    : `\`${record.operation.verb}\` on ${record.operation.branch}`;
  if (record.outcome === "completed" || record.outcome === "failed") {
    const verdict = record.outcome === "completed"
      ? "finished and succeeded"
      : "finished with a failing result";
    const stored = record.result as { message?: string } | undefined;
    const summary = stored?.message === undefined ? "" : ` ${stored.message}`;
    const retained = record.result === undefined
      ? "No result was retained for it; run the command again to see one."
      : record.result_truncated !== true
      ? "The retained result is included; nothing needs to run again to read it."
      : record.result_path === undefined
      ? "Only a reduced account of its result could be retained; the complete envelope was too large to keep."
      : `A reduced account of its result is included and the complete envelope is retained at ${record.result_path}; nothing needs to run again to read it.`;
    return `${name} ${verdict}.${summary} ${retained}`;
  }
  if (record.outcome === "cancelled") {
    return `${name} was cancelled before finishing. The facts below are what it had established.`;
  }
  if (executor === "running") {
    const account = record.progress === undefined
      ? undefined
      : completionProgressSentence(record.progress);
    return account === undefined
      ? `${name} is still running.`
      : `${name} is still running. ${account}`;
  }
  if (executor === "unknown") {
    const why = executorReason === undefined ? "" : ` (${executorReason})`;
    return `${name} has not finished, and whether its recording process is still running could not be checked from here${why}. The facts below are the last it recorded.`;
  }
  return `${name} stopped without finishing and its recording process is gone. The facts below are the last it recorded; run the command again to continue.`;
}

/**
 * Read one operation by handle, or the most recently started one of the
 * calling checkout. Another checkout's operation is named, never substituted.
 */
export async function operationProgressResult(
  root: string,
  opts: { readonly handle?: string } = {},
): Promise<DiscernResult<OperationProgressData>> {
  const reading = await readOperationJournal(root, opts.handle);
  switch (reading.kind) {
    case "invalid-handle":
      return {
        ok: false,
        verb: "progress",
        error: "invalid_arguments",
        message:
          "That progress handle is not one discern issued — its checksum does not hold. Copy the handle exactly as the operation announced it.",
        hints: hintTexts([fire(HINTS["progress-handle-required"])]),
      };
    case "missing":
      return {
        ok: false,
        verb: "progress",
        error: "not_found",
        message:
          "No operation with that handle is recorded in this repository. Journals expire after 7 days; when the bounded store fills, finished `await` records leave first, then the oldest finished operations.",
        hints: hintTexts([fire(HINTS["progress-handle-required"])]),
      };
    case "none-recorded":
      return {
        ok: false,
        verb: "progress",
        error: "not_found",
        message:
          "No long operation has been recorded in this repository yet. Journals appear when `done`, `test`, `standards`, `accept`, or an MCP `await` runs.",
        hints: hintTexts([fire(HINTS["progress-nothing-recorded"])]),
      };
    case "elsewhere": {
      const { handle, verb, branch, path } = reading.newest;
      const name = branch === undefined
        ? `\`${verb}\` at ${path}`
        : `\`${verb}\` on ${branch}`;
      return {
        ok: false,
        verb: "progress",
        error: "not_found",
        message:
          `No long operation is recorded for this checkout. The most recent one in this repository is ${name}, progress handle ${handle}; pass that handle to read it.`,
        hints: hintTexts([fire(HINTS["progress-handle-required"])]),
      };
    }
    case "corrupt":
      return {
        ok: false,
        verb: "progress",
        error: "read_error",
        message:
          "The recorded journal for that handle is unreadable. The operation itself is unaffected; the record cannot be presented.",
        hints: hintTexts([fire(HINTS["progress-record-unreadable"])]),
      };
    case "newer":
      return {
        ok: false,
        verb: "progress",
        error: "schema_version_too_new",
        message: reading.reason,
        hints: hintTexts([fire(HINTS["progress-record-unreadable"])]),
      };
    case "unavailable":
      return {
        ok: false,
        verb: "progress",
        error: "no_repository",
        message:
          "No repository is reachable from here, so there is no journal store to read.",
        hints: hintTexts([fire(HINTS["progress-outside-repository"])]),
      };
    case "inaccessible":
      return {
        ok: false,
        verb: "progress",
        error: "read_error",
        message:
          `The journal store under this repository's Git directory could not be used: ${reading.reason}. The operation itself is unaffected; the record cannot be presented.`,
        hints: hintTexts([fire(HINTS["progress-record-unreadable"])]),
      };
  }
  const record = reading.record;
  const producers = record.producers === undefined
    ? undefined
    : Object.values(record.producers);
  const data: OperationProgressData = {
    handle: reading.handle,
    operation: {
      verb: record.operation.verb,
      path: record.operation.path,
      ...(record.operation.branch === undefined
        ? {}
        : { branch: record.operation.branch }),
      started_at: record.operation.started_at,
      ...(record.operation.finished_at === undefined
        ? {}
        : { finished_at: record.operation.finished_at }),
    },
    executor: reading.executor,
    ...(reading.executor_reason === undefined
      ? {}
      : { executor_reason: reading.executor_reason }),
    ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
    ...(record.progress === undefined ? {} : { progress: record.progress }),
    ...(producers === undefined || producers.length === 0 ? {} : { producers }),
    ...(record.failures === undefined || record.failures.length === 0
      ? {}
      : { failures: record.failures }),
    ...(record.timings === undefined || record.timings.length === 0
      ? {}
      : { timings: record.timings }),
    ...(record.result === undefined ? {} : { result: record.result }),
    ...(record.result_truncated === true ? { result_truncated: true } : {}),
    ...(record.result_path === undefined
      ? {}
      : { result_path: record.result_path }),
    account: accountOf(record),
  };
  return {
    ok: true,
    verb: "progress",
    data,
    message: progressMessage(
      record,
      reading.executor,
      reading.executor_reason,
    ),
  };
}

/** Run the `progress` verb: the reading as JSON, or its sentences for a person. */
export async function runProgress(
  root: string,
  opts: { readonly json: boolean; readonly handle?: string },
): Promise<number> {
  const result = await operationProgressResult(
    root,
    opts.handle === undefined ? {} : { handle: opts.handle },
  );
  if (opts.json) {
    emitResult(result);
    return result.ok ? 0 : 1;
  }
  const out = makeOut(colorEnabled());
  if (!result.ok) {
    out.error(result.message ?? "progress refused.");
    for (const hint of interactiveHintTexts(result.hints)) out.info(hint);
    return 1;
  }
  out.info(result.message ?? "");
  for (const sentence of result.data?.account ?? []) out.info(sentence);
  if (result.data?.result_path !== undefined) {
    out.info(`Complete result retained at ${result.data.result_path}.`);
  }
  return 0;
}
