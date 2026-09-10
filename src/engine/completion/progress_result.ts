/**
 * The reconnect surface over operation journals: one call reads a long
 * operation's phase, the counts and failures known so far, named timing
 * boundaries, and the retained final result when one exists. Reading is
 * observation only — it starts, repairs, and cancels nothing, and an
 * observer's own loss never changes what the journal records.
 */
import type { DiscernResult } from "../../shared/result.ts";
import type {
  CompletionFailure,
  CompletionProgress,
  ProducerWork,
} from "./events.ts";
import {
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
  /** Whether the recording process is alive right now. */
  readonly executor: "running" | "gone";
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
}

/** Compose the first paragraph: the operation, what happened, the next command. */
function progressMessage(
  record: OperationJournalRecord,
  executor: "running" | "gone",
): string {
  const name = record.operation.branch === undefined
    ? `\`${record.operation.verb}\``
    : `\`${record.operation.verb}\` on ${record.operation.branch}`;
  if (record.outcome === "completed" || record.outcome === "failed") {
    const stored = record.result as { message?: string } | undefined;
    const summary = stored?.message === undefined ? "" : ` ${stored.message}`;
    return `${name} finished.${summary} The retained result is included; nothing needs to run again to read it.`;
  }
  if (record.outcome === "cancelled") {
    return `${name} was cancelled before finishing. The facts below are what it had established.`;
  }
  if (executor === "running") {
    const account = record.progress?.reason;
    return account === undefined
      ? `${name} is still running.`
      : `${name} is still running. ${account}`;
  }
  return `${name} stopped without finishing and its recording process is gone. The facts below are the last it recorded; run the command again to continue.`;
}

/** Read one operation by handle, or the most recently started one. */
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
      };
    case "missing":
      return {
        ok: false,
        verb: "progress",
        error: "not_found",
        message:
          "No operation with that handle is recorded in this repository. Journals expire after 7 days and a bounded store evicts the oldest records.",
      };
    case "none-recorded":
      return {
        ok: false,
        verb: "progress",
        error: "not_found",
        message:
          "No long operation has been recorded in this repository yet. Journals appear when `done`, `test`, `accept`, or an MCP `await` runs.",
      };
    case "corrupt":
      return {
        ok: false,
        verb: "progress",
        error: "read_error",
        message:
          "The recorded journal for that handle is unreadable. The operation itself is unaffected; the record cannot be presented.",
      };
    case "newer":
      return {
        ok: false,
        verb: "progress",
        error: "schema_version_too_new",
        message: reading.reason,
      };
    case "unavailable":
      return {
        ok: false,
        verb: "progress",
        error: "no_repository",
        message:
          "No journal store is reachable from here. Run this inside the repository whose operation you are reconnecting to.",
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
  };
  return {
    ok: true,
    verb: "progress",
    data,
    message: progressMessage(record, reading.executor),
  };
}
