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
import { saveCompletionArtifact } from "../completion/artifacts.ts";
import { artifactPath } from "../completion/artifact_paths.ts";
import { EmergencyResolutionSchema } from "../completion/documents.ts";
import type { ExceptionRecord } from "../completion/exception.ts";
import type { CompletionRecord } from "../completion/records.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import { decodeJson, decodeUnknown } from "../../shared/runtime_decode.ts";
import { readProofPresentation } from "../gate/proof_presentation.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { withCompletionPublication } from "../operation_lock.ts";
import { runGit } from "../../shared/subprocess.ts";

export { EmergencyResolutionSchema } from "../completion/documents.ts";

type RecordedException = Extract<CompletionRecord, { kind: "exception" }>;

const resolutionName = (exception: RecordedException): string =>
  `emergency-validation-${exception.id}`;

/** Every recorded exception, read once from common storage. */
export async function recordedExceptions(
  root: string,
): Promise<RecordedException[]> {
  return (await observeCompletionRecords(root, SYSTEM_CLOCK, ["exception"]))
    .records.flatMap(({ reading }) =>
      reading.kind === "recorded" && reading.record.kind === "exception"
        ? [reading.record]
        : []
    );
}

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
  exception: RecordedException,
): Promise<z.infer<typeof EmergencyResolutionSchema> | undefined> {
  const path = await artifactPath(
    await Deno.realPath(root),
    exception.id,
    `environment/${resolutionName(exception)}.json`,
  );
  const raw = await readTextIfExists(path);
  if (raw === undefined) return undefined;
  const value = parseEmergencyResolution(raw, path);
  if (value.landing_id !== exception.id) {
    throw new Error(
      "The emergency validation receipt names another landing. Preserve it for recovery.",
    );
  }
  const proof = await readProofPresentation(root, value.proof);
  if (
    proof.completion?.candidate.head !== value.head ||
    !await resolvesLanding(root, exception.data, proof)
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
  exception: ExceptionRecord,
  proof: Awaited<ReturnType<typeof readProofPresentation>>,
): Promise<boolean> {
  const complete = proof.completion;
  if (
    proof.mode === "report" || complete === undefined ||
    exception.outcome.kind !== "landed" ||
    complete.validation.assembled_at <= exception.outcome.at
  ) return false;
  const contains = await runGit([
    "merge-base",
    "--is-ancestor",
    exception.target,
    complete.candidate.head,
  ], { cwd: root });
  if (!contains.success) return false;
  return exception.claim.exceptions.every(({ requirement }) =>
    complete.validation.requirements.some((current) =>
      current.kind === requirement.kind && current.id === requirement.id
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
  for (const exception of await recordedExceptions(root)) {
    await withCompletionPublication(root, async () => {
      if (
        await resolution(root, exception) !== undefined ||
        !await resolvesLanding(root, exception.data, proof)
      ) return;
      await saveCompletionArtifact(
        root,
        {
          attempt_id: exception.id,
          candidate_id: exception.data.claim.candidate_id,
        },
        resolutionName(exception),
        {
          version: ON_DISK_FORMATS.emergencyResolution.version,
          landing_id: exception.id,
          proof: pointer,
          head: complete.candidate.head,
          resolved_at: SYSTEM_CLOCK.wallNow(),
        },
      );
    });
  }
}

/** Every recorded exception with its current resolution state — the durable
 * provenance inventory. Presentation surfaces use {@link emergencyValidationStatus}
 * instead; a corrupt or mismatched resolution receipt still throws here so it is
 * preserved rather than silently reported as outstanding. */
export async function emergencyValidationInventory(
  root: string,
): Promise<EmergencyValidation[]> {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
  });
  if (!inside.success || inside.stdout.trim() !== "true") return [];
  const rows: EmergencyValidation[] = [];
  for (const exception of await recordedExceptions(root)) {
    if (exception.data.outcome.kind !== "landed") continue;
    const resolved = await resolution(root, exception);
    rows.push({
      landing_id: exception.id,
      head: exception.data.target,
      reason: exception.data.claim.reason,
      exceptions: exception.data.claim.exceptions,
      state: resolved === undefined ? "outstanding" : "resolved",
      ...(resolved === undefined ? {} : { resolved_by: resolved.proof }),
      next_action: resolved === undefined
        ? "Run discern done --rerun on the current committed trunk or a repair containing it. The emergency exception remains historical."
        : "A later complete run resolved this validation. The exception record and its note remain the durable history; it never becomes passing Proof for the emergency landing.",
    });
  }
  return rows;
}

/** Status, desk, and completion results report an exception only while its
 * validation is outstanding. A resolved exception leaves every projection;
 * its note and completion record remain the durable history. */
export async function emergencyValidationStatus(
  root: string,
): Promise<EmergencyValidation[]> {
  return (await emergencyValidationInventory(root)).filter((row) =>
    row.state === "outstanding"
  );
}
