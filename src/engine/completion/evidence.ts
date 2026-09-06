/** Machine evidence contracts. The producer evaluator owns applicability and assembly. */
import { z } from "@zod/zod";
import { sha256Hex } from "../../shared/sha256.ts";
import {
  DigestSchema,
  InstantSchema,
  NameSchema,
  ObjectIdSchema,
  RecordIdSchema,
} from "./identity.ts";
import {
  normalizeProjectRelativeFilePath,
  projectRelativePathIssue,
} from "../../shared/project_path.ts";

/** Persisted artifact names are canonical, relative to their producing attempt. */
export const ArtifactPathSchema = z.string().min(1).refine(
  (path) =>
    normalizeProjectRelativeFilePath(path) === path &&
    projectRelativePathIssue(path) === undefined &&
    !path.split("/").some((part) =>
      part === ".." || part === "." || part === ""
    ),
  "artifact must be a canonical project-relative file path",
);

export const RequirementSchema = z.strictObject({
  id: NameSchema,
  context: NameSchema,
  kind: z.enum(["job", "scope", "standard"]),
  definition: DigestSchema,
});
export type Requirement = z.infer<typeof RequirementSchema>;

export const CompletionModeSchema = z.enum(["strict", "report"]);
export const EvidencePurposeSchema = z.enum(["completion", "diagnostic"]);

/** All equality dimensions are explicit; unknown closure uses candidate binding. */
export const ApplicabilitySchema = z.strictObject({
  producer: z.string().min(1),
  context: NameSchema,
  policy: DigestSchema,
  protected_definitions: DigestSchema,
  command: DigestSchema,
  extractor: DigestSchema,
  inputs: DigestSchema,
  denominator_inputs: DigestSchema,
  toolchain: DigestSchema,
  environment: DigestSchema,
  seed: z.number().int(),
  closure: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("declared"), declaration: DigestSchema }),
    z.strictObject({ kind: z.literal("candidate"), head: ObjectIdSchema }),
  ]),
});

/** Canonical subject for attempt sequencing; schema order makes key order irrelevant. */
export async function applicabilitySubject(
  value: z.infer<typeof ApplicabilitySchema>,
): Promise<string> {
  return await sha256Hex(JSON.stringify(ApplicabilitySchema.parse(value)));
}

export const ArtifactSchema = z.strictObject({
  attempt_id: RecordIdSchema,
  candidate_id: RecordIdSchema,
  context: NameSchema,
  path: ArtifactPathSchema,
  digest: DigestSchema,
  bytes: z.number().int().nonnegative(),
});

export const EvidenceSchema = z.strictObject({
  attempt_id: RecordIdSchema,
  candidate_id: RecordIdSchema,
  sequence: z.number().int().positive(),
  purpose: EvidencePurposeSchema,
  mode: CompletionModeSchema,
  applicability: ApplicabilitySchema,
  finished_at: InstantSchema,
  artifacts: z.array(ArtifactSchema),
  outcome: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("passed"),
      capture_complete: z.literal(true),
      metrics: z.record(z.string(), z.number().finite()),
    }),
    z.strictObject({ kind: z.literal("failed"), reason: z.string().min(1) }),
    z.strictObject({ kind: z.literal("cancelled"), reason: z.string().min(1) }),
    z.strictObject({ kind: z.literal("unrun"), reason: z.string().min(1) }),
    z.strictObject({ kind: z.literal("stale"), reason: z.string().min(1) }),
  ]),
}).refine(
  (value) =>
    value.artifacts.every((artifact) =>
      artifact.attempt_id === value.attempt_id &&
      artifact.candidate_id === value.candidate_id &&
      artifact.context === value.applicability.context
    ),
  "artifact subject must match its producing evidence",
);
export type ComponentEvidence = z.infer<typeof EvidenceSchema>;

const RequirementReceiptSchema = z.strictObject({
  requirement: RequirementSchema,
  evidence_id: RecordIdSchema,
  /** The consuming candidate, even when the component came from an eligible predecessor. */
  candidate_id: RecordIdSchema,
  policy: DigestSchema,
  reading: z.number().finite().nullable(),
});

/** Complete machine coverage has an exact subject and says nothing about consent. */
export const CandidateProofSchema = z.strictObject({
  attempt_id: RecordIdSchema,
  candidate_id: RecordIdSchema,
  head: ObjectIdSchema,
  policy: DigestSchema,
  requirement_set: DigestSchema,
  mode: CompletionModeSchema,
  requirements: z.array(RequirementSchema).min(1),
  receipts: z.array(RequirementReceiptSchema).min(1),
  assembled_at: InstantSchema,
  review: ArtifactSchema.optional(),
}).refine((value) => {
  const obligations = value.requirements.map((requirement) =>
    JSON.stringify([requirement.kind, requirement.id, requirement.context])
  );
  const keys = value.requirements.map((requirement) =>
    JSON.stringify(requirement)
  );
  const receipts = value.receipts.map((receipt) =>
    JSON.stringify(receipt.requirement)
  );
  return new Set(obligations).size === obligations.length &&
    keys.length === receipts.length &&
    new Set(receipts).size === receipts.length && keys.every((key) =>
      receipts.includes(key)
    ) &&
    value.receipts.every((receipt) =>
      receipt.candidate_id === value.candidate_id &&
      receipt.policy === value.policy &&
      (receipt.requirement.kind !== "standard" || receipt.reading !== null)
    );
}, "Proof needs one matching receipt per required context and obligation");
export type CandidateProof = z.infer<typeof CandidateProofSchema>;
