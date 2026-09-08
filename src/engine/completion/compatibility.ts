import { type CompletionRecordReading, readCompletionRecord } from "./store.ts";
import type { RecordSelector } from "./records.ts";
/** Preserve unreadable state and distinguish compatibility from damaged bytes. */
import { newerOnDiskFormatMessage } from "../../shared/on_disk_formats.ts";
import type { CompletionBlocker, CompletionObservation } from "./protocol.ts";

/** Project the first unusable record without repairing or substituting its bytes. */
export function completionRecordBlocker(
  observation: Pick<CompletionObservation, "records">,
): CompletionBlocker | undefined {
  for (const { selector, reading } of observation.records) {
    if (reading.kind === "recorded" || reading.kind === "missing") continue;
    const record_id = `${selector.kind}/${selector.id}`;
    if ("version" in reading) {
      return {
        kind: "record-incompatible",
        record_id,
        reason: reading.kind === "newer"
          ? newerOnDiskFormatMessage("completionRecord", reading.version)
          : `Completion record ${record_id} uses unsupported version ${reading.version}. Preserve its bytes and use an engine supporting that version to reconcile or migrate the record before retrying.`,
      };
    }
    return {
      kind: reading.kind === "invalid"
        ? "record-corrupt"
        : "environment-unavailable",
      record_id,
      reason:
        `Completion record ${record_id} is ${reading.kind}: ${reading.reason}. Preserve the record and restore verified bytes or reconcile it with its owning engine before retrying.`,
    };
  }
  return undefined;
}

/** Read a required coordinate with a supported refusal, before a caller uses its shape. */
export async function readCompatibleCompletionRecord(
  root: string,
  selector: RecordSelector,
): Promise<
  Extract<CompletionRecordReading, { kind: "recorded" }> | CompletionBlocker
> {
  const reading = await readCompletionRecord(root, selector);
  if (reading.kind === "recorded") return reading;
  return completionRecordBlocker({ records: [{ selector, reading }] }) ?? {
    kind: "environment-unavailable",
    reason:
      `Required completion record ${selector.kind}/${selector.id} is missing. Restore or initialize its owning state before retrying.`,
  };
}
