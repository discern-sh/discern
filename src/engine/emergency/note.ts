import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
import { EmergencyNotePayloadSchema } from "../../shared/emergency_note.ts";
/** Exception notes retain the unsigned DSSE boundary without a Proof-shaped payload. */
import { encodeBase64 } from "@std/encoding/base64";
import type { ExceptionRecord } from "../completion/exception.ts";
import { EMERGENCY_NOTE_PAYLOAD_TYPE } from "../../shared/public_schemas.ts";
import {
  PROOF_NOTES_REF,
  PROOF_NOTES_SHORT_REF,
} from "../../shared/git_conventions.ts";
import { proofNoteAuthorEnvironment } from "../gate/proof_notes.ts";
import { runGit } from "../../shared/subprocess.ts";
import type { EnvReader } from "../../shared/env.ts";
import type { ProofNoteWriteData } from "../../shared/result_schemas.ts";

/** Exact bytes remain inside the existing DSSE payload boundary, ready for future verification. */
export function canonicalExceptionNote(
  id: string,
  record: ExceptionRecord,
): string {
  if (record.outcome.kind !== "landed") {
    throw new Error("An exception note requires its landed integration.");
  }
  const payload = EmergencyNotePayloadSchema.parse({
    kind: "emergency-exception",
    version: ON_DISK_FORMATS.proofNote.version,
    landing_id: id,
    claim: record.claim,
    executor: record.executor,
  });
  return JSON.stringify({
    payloadType: EMERGENCY_NOTE_PAYLOAD_TYPE,
    payload: encodeBase64(new TextEncoder().encode(JSON.stringify(payload))),
    signatures: [],
  }) + "\n";
}

/** Create-only publication preserves every existing claim, including a later or unsupported note. */
export async function recordExceptionNote(
  root: string,
  id: string,
  record: ExceptionRecord,
  env: EnvReader = Deno.env,
): Promise<ProofNoteWriteData> {
  const commit = record.target;
  const base = { ref: PROOF_NOTES_REF, commit, merged_refs: [] };
  const body = canonicalExceptionNote(id, record);
  const existing = await runGit([
    "notes",
    `--ref=${PROOF_NOTES_SHORT_REF}`,
    "show",
    commit,
  ], { cwd: root });
  if (existing.success) {
    return existing.stdout === body ? { ...base, status: "already_present" } : {
      ...base,
      status: "record_failed",
      reason:
        "The integrated commit already has a different note. Preserve it and the durable exception record; no existing claim was replaced.",
    };
  }
  if (existing.code !== 1) {
    return {
      ...base,
      status: "record_failed",
      reason: existing.stderr || "The existing note could not be inspected.",
    };
  }
  const identity = proofNoteAuthorEnvironment(env);
  const written = await runGit([
    "notes",
    `--ref=${PROOF_NOTES_SHORT_REF}`,
    "add",
    "-F",
    "-",
    commit,
  ], {
    cwd: root,
    stdin: body,
    ...(identity === undefined ? {} : { env: identity }),
  });
  return written.success ? { ...base, status: "recorded" } : {
    ...base,
    status: "record_failed",
    reason: written.stderr ||
      "The exception note could not be published. Recover the recorded landing after repairing Git notes access.",
  };
}
