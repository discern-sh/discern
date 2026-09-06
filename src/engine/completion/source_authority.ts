/** The exact source approval record, independent of checkpoint decision schemas. */
import { z } from "@zod/zod";
import { LANDING_CONSENT_SOURCES } from "../../shared/consent.ts";
import {
  DigestSchema,
  InstantSchema,
  NameSchema,
  RecordIdSchema,
  SourceRevisionSchema,
} from "./identity.ts";

const AuthoritySourceSchema = z.strictObject({
  source: z.enum(LANDING_CONSENT_SOURCES),
  record_id: RecordIdSchema,
  scopes: z.array(NameSchema),
}).refine(
  (source) =>
    source.source === "standing-grant"
      ? source.scopes.length > 0
      : source.scopes.length === 0,
  "only a standing grant carries a nonempty scope set",
);

export const AuthoritySchema = z.strictObject({
  source: AuthoritySourceSchema,
  approved_at: InstantSchema,
  sources: z.array(SourceRevisionSchema).min(1),
  composition_procedure: DigestSchema,
  policy: DigestSchema,
  predecessor_authorities: z.array(RecordIdSchema),
  state: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("granted") }),
    z.strictObject({ kind: z.literal("revoked"), at: InstantSchema }),
    z.strictObject({
      kind: z.literal("consumed"),
      landing_id: RecordIdSchema,
      at: InstantSchema,
    }),
  ]),
}).refine(
  (authority) =>
    new Set(authority.sources.map((source) => source.effort_id)).size ===
      authority.sources.length,
  "authority must identify one approved revision per effort",
);
