import { ON_DISK_FORMATS } from "./on_disk_formats.ts";
/** Published emergency notes preserve DSSE bytes and remain outside the passing-Proof schema. */
import { z } from "@zod/zod";
import { ExceptionClaimSchema } from "../engine/completion/exception_claim.ts";
import {
  ExecutorSchema,
  RecordIdSchema,
} from "../engine/completion/identity.ts";
import { ProofNoteSchema } from "./result_schemas.ts";
import { EMERGENCY_NOTE_PAYLOAD_TYPE } from "./public_schemas.ts";

export const EmergencyNotePayloadSchema = z.strictObject({
  kind: z.literal("emergency-exception"),
  version: z.literal(ON_DISK_FORMATS.proofNote.version),
  landing_id: RecordIdSchema,
  claim: ExceptionClaimSchema,
  executor: ExecutorSchema,
}).describe(
  "An emergency integration records exceptions and issues no passing Proof. The unsigned envelope records available facts without authenticating an owner.",
);

export const EmergencyNoteEnvelopeSchema = ProofNoteSchema.extend({
  payloadType: z.literal(EMERGENCY_NOTE_PAYLOAD_TYPE),
  payload: ProofNoteSchema.shape.payload.describe(
    "Base64-encoded emergency exception payload bytes. Preserve these bytes for future verification; this payload is never passing Proof.",
  ),
}).describe(
  "An unsigned or future signed emergency envelope records an integration exception. It cannot attest passing validation.",
);
