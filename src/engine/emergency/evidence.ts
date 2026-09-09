/** Emergency inventory consumes the ordinary selector and preserves missing-evidence causes. */
import type { ExceptionClaimSchema } from "../completion/authority.ts";
import type { z } from "@zod/zod";
import type { CompletionRecord } from "../completion/records.ts";
import type { ValidationSnapshot } from "../validation/catalog.ts";
import {
  artifactAuditEvidence,
  indexEvidence,
  selectEvidence,
} from "../validation/selection.ts";
import { auditArtifacts } from "../validation/artifacts.ts";
import { standardHeld } from "../validation/metrics.ts";

export type EmergencyExceptions = z.infer<
  typeof ExceptionClaimSchema
>["exceptions"];

/** No execution is started here. A failed standard remains failed even when its producer exited zero. */
export async function emergencyExceptions(
  root: string,
  snapshot: ValidationSnapshot,
  records: readonly CompletionRecord[],
): Promise<EmergencyExceptions> {
  const index = indexEvidence(records);
  const audited = await auditArtifacts(
    root,
    artifactAuditEvidence(snapshot, index),
  );
  const exceptions: EmergencyExceptions = [];
  for (const obligation of snapshot.obligations) {
    const selection = selectEvidence(
      obligation,
      snapshot.candidate_id,
      index,
      "strict",
      "completion",
      audited,
    );
    if (selection.kind === "selected") {
      if (
        obligation.standard === null ||
        (selection.reading !== null &&
          standardHeld(obligation.standard, selection.reading))
      ) continue;
      exceptions.push({
        requirement: obligation.requirement,
        state: "failed",
        evidence_id: selection.record.id,
      });
      continue;
    }
    const evidence = records.filter((
      record,
    ): record is Extract<CompletionRecord, { kind: "evidence" }> =>
      record.kind === "evidence" && record.data.purpose === "completion" &&
      record.data.applicability.producer === obligation.producer &&
      record.data.applicability.context === obligation.requirement.context &&
      (selection.kind !== "blocked" ||
        record.data.attempt_id === selection.attempt_id)
    ).sort((a, b) => b.data.sequence - a.data.sequence)[0];
    const state = selection.kind === "missing"
      ? evidence === undefined ? "unrun" : "stale"
      : selection.blocker.kind === "stale-evidence" ||
          selection.blocker.kind === "report-only"
      ? "stale"
      : evidence?.data.outcome.kind === "failed" ||
          (evidence?.data.outcome.kind === "passed" &&
            selection.blocker.kind === "validation-failed")
      ? "failed"
      : evidence?.data.outcome.kind === "stale"
      ? "stale"
      : "unrun";
    exceptions.push({
      requirement: obligation.requirement,
      state,
      evidence_id: evidence?.id ?? null,
    });
  }
  return exceptions.sort((a, b) =>
    JSON.stringify(a.requirement).localeCompare(JSON.stringify(b.requirement))
  );
}
