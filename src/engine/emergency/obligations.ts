import {
  inspectOnDiskRecordVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
/** Current validation resolves a new obligation record; the original exception stays immutable. */
import { z } from "@zod/zod";
import type { EmergencyValidation } from "../../shared/emergency.ts";
import type { CompletionProofPointer } from "../../shared/completion_proof.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { saveEnvironmentArtifact } from "../execution/artifacts.ts";
import { artifactPath } from "../execution/artifact_read.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import { decodeJson, decodeUnknown } from "../../shared/runtime_decode.ts";
import { readProofPresentation } from "../gate/proof_presentation.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { observedRecords, withQueueLock } from "../landing_queue/repository.ts";
import type { LandingRecord } from "../landing_queue/publication.ts";
import { runGit } from "../../shared/subprocess.ts";

import { EmergencyResolutionSchema } from "../execution/artifact_contracts.ts";
export { EmergencyResolutionSchema } from "../execution/artifact_contracts.ts";
const resolutionName = (landing: LandingRecord): string =>
  `emergency-validation-${landing.id}`;

/** Classify forward skew before interpreting an independent resolution document. */
export function parseEmergencyResolution(
  raw: string,
  source: string,
): z.infer<typeof EmergencyResolutionSchema> {
  const value = decodeJson(z.unknown(), raw, source);
  const version = inspectOnDiskRecordVersion("emergencyResolution", value);
  if (version.status === "newer") {
    throw new Error(
      newerOnDiskFormatMessage("emergencyResolution", version.found),
    );
  }
  return decodeUnknown(EmergencyResolutionSchema, value, source);
}

/** Validate the retained later Proof before reporting an obligation as resolved. */
async function resolution(
  root: string,
  landing: LandingRecord,
): Promise<z.infer<typeof EmergencyResolutionSchema> | undefined> {
  const path = await artifactPath(
    await Deno.realPath(root),
    landing.data.attempt_id,
    `environment/${resolutionName(landing)}.json`,
  );
  const raw = await readTextIfExists(path);
  if (raw === undefined) return undefined;
  const value = parseEmergencyResolution(raw, path);
  if (value.landing_id !== landing.id) {
    throw new Error(
      "The emergency validation receipt names another landing. Preserve it for recovery.",
    );
  }
  const proof = await readProofPresentation(root, value.proof);
  if (
    proof.completion?.candidate.head !== value.head ||
    !await resolvesLanding(root, landing, proof)
  ) {
    throw new Error(
      "The emergency validation receipt lacks matching later complete Proof. Preserve it and restore its evidence before treating validation as resolved.",
    );
  }
  return value;
}

/** The same predicate governs resolution publication and every later reading. */
async function resolvesLanding(
  root: string,
  landing: LandingRecord,
  proof: Awaited<ReturnType<typeof readProofPresentation>>,
): Promise<boolean> {
  const complete = proof.completion;
  if (
    proof.mode === "report" || complete === undefined ||
    landing.data.claim.kind !== "exception" ||
    landing.data.outcome.kind !== "landed" ||
    complete.validation.assembled_at <= landing.data.outcome.at
  ) return false;
  const contains = await runGit([
    "merge-base",
    "--is-ancestor",
    landing.data.target,
    complete.candidate.head,
  ], { cwd: root });
  if (!contains.success) return false;
  return landing.data.claim.exceptions.every(({ requirement }) =>
    complete.validation.requirements.some((current) =>
      current.kind === requirement.kind && current.id === requirement.id &&
      current.context === requirement.context
    )
  );
}

/** A strict completed candidate can discharge present checks only while retaining the integrated repair. */
export async function resolveEmergencyValidation(
  root: string,
  pointer: CompletionProofPointer,
): Promise<void> {
  const proof = await readProofPresentation(root, pointer);
  const complete = proof.completion;
  if (proof.mode === "report" || complete === undefined) return;
  for (
    const record of observedRecords(
      await observeCompletionRecords(root, SYSTEM_CLOCK, ["landing"]),
    )
  ) {
    if (record.kind !== "landing" || record.data.claim.kind !== "exception") {
      continue;
    }
    await withQueueLock(root, async () => {
      if (
        await resolution(root, record) !== undefined ||
        !await resolvesLanding(root, record, proof)
      ) return;
      await saveEnvironmentArtifact(
        root,
        {
          attempt_id: record.data.attempt_id,
          candidate_id: record.data.candidate_id,
          context: "local",
        },
        resolutionName(record),
        {
          version: ON_DISK_FORMATS.emergencyResolution.version,
          landing_id: record.id,
          proof: pointer,
          head: complete.candidate.head,
          resolved_at: SYSTEM_CLOCK.wallNow(),
        },
      );
    });
  }
}

/** Status and desk read receipts without running validation or modifying recovery. */
export async function emergencyValidationStatus(
  root: string,
): Promise<EmergencyValidation[]> {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
  });
  if (!inside.success || inside.stdout.trim() !== "true") return [];
  const rows: EmergencyValidation[] = [];
  for (
    const record of observedRecords(
      await observeCompletionRecords(root, SYSTEM_CLOCK, ["landing"]),
    )
  ) {
    if (
      record.kind !== "landing" || record.data.claim.kind !== "exception" ||
      !(record.data.outcome.kind === "landed" ||
        (record.data.outcome.kind === "recovery" &&
          record.data.outcome.ref_advanced))
    ) continue;
    const resolved = await resolution(root, record);
    rows.push({
      landing_id: record.id,
      head: record.data.target,
      reason: record.data.claim.reason,
      exceptions: record.data.claim.exceptions,
      state: resolved === undefined ? "outstanding" : "resolved",
      ...(resolved === undefined ? {} : { resolved_by: resolved.proof }),
      next_action: resolved === undefined
        ? "Run discern done --rerun on the current committed trunk or a repair containing it. Complete every required context. The emergency exception remains historical."
        : "Current validation was recorded later. The earlier emergency integration still has no passing Proof.",
    });
  }
  return rows;
}
