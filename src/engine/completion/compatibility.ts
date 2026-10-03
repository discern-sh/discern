/** Preserve unreadable state and distinguish compatibility from damaged bytes. */
import { newerOnDiskFormatMessage } from "../../shared/on_disk_formats.ts";
import { claimLossBlocker } from "./attempt.ts";
import type { CompletionBlocker, CompletionObservation } from "./protocol.ts";
import type { RecordSelector } from "./records.ts";
import type {
  CompletionRecordReading,
  CompletionWriteRefusal,
} from "./store.ts";

/** A reading that holds no usable record and is not simply absent. */
type UnusableRecordReading = Exclude<
  CompletionRecordReading,
  { readonly kind: "recorded" | "missing" }
>;

/** Project the first unusable record without repairing or substituting its bytes. */
export function completionRecordBlocker(
  observation: Pick<CompletionObservation, "records">,
): CompletionBlocker | undefined {
  for (const { selector, reading } of observation.records) {
    if (reading.kind === "recorded" || reading.kind === "missing") continue;
    return unusableRecordBlocker(selector, reading);
  }
  return undefined;
}

/** What one unusable record leaves pending, preserving its bytes for recovery. */
function unusableRecordBlocker(
  selector: RecordSelector,
  reading: UnusableRecordReading,
): CompletionBlocker {
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
  const reason =
    `Completion record ${record_id} is ${reading.kind}: ${reading.reason}. Preserve the record and restore verified bytes or reconcile it with its owning engine before retrying.`;
  return reading.kind === "invalid"
    ? { kind: "record-corrupt", record_id, reason }
    : { kind: "unavailable", reason };
}

/**
 * What a refused publication leaves pending, taken from the refusal itself.
 * Only an attempt record that is finished or names another token reports the
 * retirement; a busy
 * lock or a refused write proves nothing about the claim or the source, and
 * keeps its reason.
 */
export function publicationRefusal(
  published: RecordSelector & { readonly kind: "evidence" | "proof" },
  refusal: CompletionWriteRefusal,
): CompletionBlocker {
  switch (refusal.kind) {
    case "claim-lost":
      return claimLossBlocker();
    case "conflict":
    case "transition-refused":
    case "busy":
    case "unavailable":
      return {
        kind: "unavailable",
        reason: `${
          published.kind === "proof" ? "Proof" : "Evidence"
        } ${published.id} was not published: ${refusal.reason}`,
      };
    case "newer":
    case "older":
    case "invalid":
      return unusableRecordBlocker(published, refusal);
  }
}
