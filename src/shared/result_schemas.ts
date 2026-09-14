import { EmergencyDataSchema, EmergencyValidationSchema } from "./emergency.ts";
import { IgnoredFileChangeSummarySchema } from "./ignored_file_changes.ts";
import {
  CompleteProofEvidenceSchema,
  CompletionProofPointerSchema,
} from "./completion_proof.ts";
/**
 * The **typed wire schemas** for every `discern` verb's result — the SSOT spine of
 * the MCP surface (ADR 0041). Where `result.ts` defines the result *vocabulary* as
 * TypeScript interfaces and `serializeResult` defines the wire *shape*, this module
 * is the one place that shape is described as runtime-checkable **Zod** schemas:
 *
 *  - the {@link EnvelopeSchema} mirrors exactly what `serializeResult` emits;
 *  - a per-verb **data schema** models each verb's `data` payload (every mode), and
 *    the verb's core types its `data` as `z.infer<…>` of that schema — so a core
 *    that drifts from its schema is a COMPILE error;
 *  - a per-verb **output schema** is the envelope with `data` narrowed, which the
 *    MCP server advertises as the tool's `outputSchema`.
 *
 * The discipline this buys: the SDK validates a tool's `structuredContent` against
 * its `outputSchema` on every call, so an output schema that doesn't match reality
 * turns a VALID call into an ERROR. Tying the schema to the type (compile time) and
 * proving faithfulness with a test (`tests/result_schemas_test.ts` runs each verb
 * and validates its real `serializeResult` output) keeps the two from drifting — the
 * MCP analog of the gate's instructions-currency check.
 *
 * Layer note: this is a `shared/` module — it depends only on `result.ts` and
 * Zod, never on `src/engine/**`, so the engine
 * cores import their data types FROM here (engine → shared), never the reverse.
 */

import { z } from "@zod/zod";
import { isSingleRunnableSetupCommand } from "./setup_next_action.ts";
import { MANUAL_KINDS } from "./manual.ts";
import {
  ACCEPT_LANDING_STATE_FIELDS,
  ACCEPT_LANDING_STATE_SHAPE,
  type AcceptLandingState,
  AcceptLandingStateSchema,
} from "./accept_landing_state.ts";
import {
  ACTORS,
  DIAGNOSTIC_SEVERITIES,
  ERROR_SLUGS,
  FAILED_STAGES,
  RESULT_ADVISORY_KINDS,
  STEP_DISPOSITIONS,
  STEP_KINDS,
  STEP_OUTCOMES,
} from "./result.ts";
import { ASSURANCE_VERDICTS, KNOWN_JOB_STATES } from "./setup_assurance.ts";
import { SetupHumanMomentProjectionSchema } from "./setup_experience.ts";
import { validateStandardLimitReason } from "./standard_limit_reason.ts";
import {
  CHECKPOINT_MODES,
  CHECKPOINT_OBLIGATION_STATES,
  RELATED_CHECKPOINT_KINDS,
  TRIGGER_VETOES,
} from "./checkpoints.ts";
import {
  CHECKPOINT_DROP_ACCOUNT_MAX,
  ENTRY_CHECKPOINT_DROP_REASONS,
  GATE_MODES,
  POLICY_CHECKPOINT_DROP_REASONS,
} from "./checkpoint_drops.ts";
import { UNKNOWN_GIT_COUNT } from "./git_count.ts";
import { LANDING_AUTHORITY_KINDS, LANDING_CONSENT_SOURCES } from "./consent.ts";
import { AWAIT_CALL_PROFILES } from "./mcp_timeout_policy.ts";
import { PROOF_NOTE_PAYLOAD_TYPE } from "./public_schemas.ts";
import { FIRST_PARTY_LEGAL_DOCUMENT_KINDS } from "./license_registry.ts";
import {
  CONTINUATION_HANDLE_LENGTH,
  CONTINUATION_HANDLE_PATTERN,
} from "./continuation_handle.ts";
import { CONFIG_ISSUE_KINDS } from "./config_issues.ts";
import { configExplainDataSchema } from "./config_explain_schema.ts";
import { CONFIG_RECONCILE_OPERATION_KINDS } from "./config_reconcile.ts";
import { TRUST_ACTION_KINDS, TRUST_FACT_KINDS } from "./provider_trust.ts";
import {
  WORKTREE_FIELDS,
  type WorktreeIdentityField,
} from "./worktree_identity_fields.ts";
import { TaskMetadataDataSchema } from "./task_metadata.ts";

export {
  ACCEPT_LANDING_STATE_FIELDS,
  ACCEPT_LANDING_STATE_SHAPE,
  type AcceptLandingState,
  AcceptLandingStateSchema,
};

/** Runtime schema for a trustworthy Git count or its explicit unknown state. */
export const GitCountSchema = z.union([
  z.number().int().nonnegative(),
  z.literal(UNKNOWN_GIT_COUNT),
]);

// ── ring 1+2 mirrors: the plan / step / diagnostic sub-shapes ────────────────
// Zod mirrors of the `result.ts` interfaces `serializeResult` emits. The closed
// vocabularies (disposition / step-kind / outcome) are DERIVED from their result.ts
// const tuples — not hand-listed — so the wire enum and the TS union are one source
// and a new member enrolls in both from a single edit. The object shapes (which Zod
// can't enumerate from an interface) stay proven faithful by the result-schema test
// running real finish/accept results through them.

/** The disposition vocabulary, derived from {@link STEP_DISPOSITIONS}. */
const dispositionEnum = z.enum(STEP_DISPOSITIONS);

/** The step-kind vocabulary, derived from {@link STEP_KINDS}. */
const stepKindEnum = z.enum(STEP_KINDS);

/** The executed-step outcome, derived from {@link STEP_OUTCOMES}. */
const outcomeEnum = z.enum(STEP_OUTCOMES);

/** Mirror of {@link import("./result.ts").Diagnostic} — a normalized failure. */
export const DiagnosticSchema = z.strictObject({
  tool: z.string(),
  severity: z.enum(DIAGNOSTIC_SEVERITIES),
  message: z.string(),
  reproduce_cmd: z.string(),
  output: z.string().optional(),
  truncated: z.boolean().optional(),
  output_path: z.string().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  col: z.number().optional(),
  rule: z.string().optional(),
  fix_available: z.boolean().optional(),
});

/** Mirror of {@link import("./result.ts").PlanStepJson} — one planned step. */
export const PlanStepJsonSchema = z.strictObject({
  kind: stepKindEnum,
  label: z.string(),
  disposition: dispositionEnum,
  note: z.string().optional(),
  group: z.string().optional(),
});

/** One optional degradation admitted by a verb's completion policy. */
export const ResultAdvisorySchema = z.strictObject({
  kind: z.enum(RESULT_ADVISORY_KINDS),
  evidence: z.array(z.string().trim().min(1)).min(1),
  next_action: z.string().trim().min(1),
});

/** Mirror of {@link import("./result.ts").StepResultJson} — a step + its outcome. */
export const StepResultJsonSchema = z.strictObject({
  kind: stepKindEnum,
  label: z.string(),
  disposition: dispositionEnum,
  note: z.string().optional(),
  group: z.string().optional(),
  outcome: outcomeEnum,
  advisory: ResultAdvisorySchema.optional(),
  duration_s: z.number().optional(),
  output_path: z.string().optional(),
  output_lines: z.number().optional(),
  error_like_lines: z.number().optional(),
});

/** Mirror of {@link import("./result.ts").PlanJson} — a whole dry-run plan. */
export const PlanJsonSchema = z.strictObject({
  title: z.string(),
  details: z.array(z.string()),
  steps: z.array(PlanStepJsonSchema),
});

// ── ring 3: the envelope ─────────────────────────────────────────────────────

/**
 * The flat field inventory every serialized envelope may carry. Structural
 * relationships among `ok`, `error`, `dry_run`, `plan`, and `steps` live in
 * {@link EnvelopeStateSchema}; keeping the inventory separate lets each
 * per-verb schema remain a strict Zod object for the MCP SDK while applying the
 * same discriminated contract as a refinement and JSON Schema constraint.
 */
const DiagnosticEvidenceSchema = z.strictObject({
  path: z.string(),
  digest: z.string(),
  bytes: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  shown: z.number().int().nonnegative(),
  repeats: z.array(z.number().int().positive()),
});
const ENVELOPE_BASE_FIELDS = {
  ok: z.boolean(),
  verb: z.string(),
  dry_run: z.boolean().optional(),
  plan: PlanJsonSchema.optional(),
  steps: z.array(StepResultJsonSchema).optional(),
  waited_ms: z.number().nonnegative().optional(),
  diagnostics: z.array(DiagnosticSchema).optional(),
  diagnostic_evidence: DiagnosticEvidenceSchema.optional(),
  hints: z.array(z.string()).optional(),
  advisories: z.array(ResultAdvisorySchema).optional(),
  error: z.enum(ERROR_SLUGS).optional(),
  message: z.string().optional(),
};

const ENVELOPE_BASE_FIELDS_WITHOUT_VERB = {
  ok: z.boolean(),
  dry_run: z.boolean().optional(),
  plan: PlanJsonSchema.optional(),
  steps: z.array(StepResultJsonSchema).optional(),
  waited_ms: z.number().nonnegative().optional(),
  diagnostics: z.array(DiagnosticSchema).optional(),
  diagnostic_evidence: DiagnosticEvidenceSchema.optional(),
  hints: z.array(z.string()).optional(),
  advisories: z.array(ResultAdvisorySchema).optional(),
  error: z.enum(ERROR_SLUGS).optional(),
  message: z.string().optional(),
};

const SuccessStateSchema = z.looseObject({
  ok: z.literal(true),
  error: z.never().optional(),
});

const FailureStateSchema = z.looseObject({
  ok: z.literal(false),
  error: z.enum(ERROR_SLUGS).optional(),
});

/** Success/failure discriminator mirrored from `DiscernResult`. */
const ResultOutcomeSchema = z.discriminatedUnion("ok", [
  SuccessStateSchema,
  FailureStateSchema,
]);

const PreviewStateSchema = z.looseObject({
  dry_run: z.literal(true),
  plan: PlanJsonSchema.optional(),
  steps: z.never().optional(),
});

const ReviewPlanStateSchema = z.looseObject({
  dry_run: z.literal(false).optional(),
  plan: PlanJsonSchema,
  steps: z.never().optional(),
});

const AppliedOrObservedStateSchema = z.looseObject({
  dry_run: z.literal(false).optional(),
  plan: z.never().optional(),
  steps: z.array(StepResultJsonSchema).optional(),
});

/** Preview, review-plan, and applied/observed states mirror `DiscernResult`. */
const ResultExecutionStateSchema = z.union([
  PreviewStateSchema,
  ReviewPlanStateSchema,
  AppliedOrObservedStateSchema,
]);

/**
 * The structural envelope contract: `ok` discriminates error presence, while
 * the execution union forbids `plan`/`steps` coexistence and completed preview
 * steps. State objects are deliberately loose because a strict per-verb object
 * owns the complete field inventory around this constraint.
 */
export const EnvelopeStateSchema = z.intersection(
  ResultOutcomeSchema,
  ResultExecutionStateSchema,
);

/** Convert the canonical state schema into embeddable JSON Schema metadata. */
function envelopeStateJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(EnvelopeStateSchema, {
    io: "output",
  }) as Record<string, unknown>;
  const { $schema: _schema, ...fragment } = generated;
  return fragment;
}

const ENVELOPE_STATE_JSON_SCHEMA = envelopeStateJsonSchema();

/** Forward the canonical state validator through a strict per-verb object. */
function validateEnvelopeState(
  value: unknown,
  ctx: z.RefinementCtx,
): void {
  const parsed = EnvelopeStateSchema.safeParse(value);
  if (parsed.success) {
    return;
  }
  for (const issue of parsed.error.issues) {
    ctx.addIssue({
      code: "custom",
      path: issue.path,
      message: issue.message,
    });
  }
}

/**
 * Build a strict MCP-compatible object that validates and advertises the same
 * structural state contract as {@link EnvelopeStateSchema}.
 */
function envelopeObjectSchema<T extends z.ZodRawShape>(
  fields: T,
): z.ZodObject<T> {
  return z.strictObject(fields)
    .superRefine(validateEnvelopeState)
    .meta(ENVELOPE_STATE_JSON_SCHEMA);
}

/** The general "any envelope" schema, with `data` left open (`unknown`). */
export const EnvelopeSchema = envelopeObjectSchema({
  ...ENVELOPE_BASE_FIELDS,
  data: z.unknown().optional(),
});

/**
 * The envelope for the data-LESS verbs (`prepare`, `test`, `tidy`): strict and
 * WITHOUT a `data` field. They carry no `data` today, and this makes that a checked
 * invariant — a result that grows a `data` payload fails its faithfulness test (and the
 * SDK's output validation) until the payload is modelled, the SSOT guard the bare
 * {@link EnvelopeSchema} (`data: unknown`) can't give. (`accept` moved out of this
 * set — it carries a {@link AcceptDataSchema} landing root on an apply; its dry-run
 * preview is still data-less.)
 */
export const DatalessEnvelopeSchema = envelopeObjectSchema(
  ENVELOPE_BASE_FIELDS,
);

export const ConfigIssueSchema = z.strictObject({
  kind: z.enum(CONFIG_ISSUE_KINDS).optional(),
  path: z.string(),
  message: z.string(),
});

const ConfigIssueDataSchema = z.strictObject({
  issues: z.array(ConfigIssueSchema),
});

/** Permit a verb's normal payload or the shared config-validation payload. */
function dataSchemaWithConfigIssues<T extends z.ZodType>(
  dataSchema: T,
): z.ZodUnion<[T, typeof ConfigIssueDataSchema]> {
  return z.union([dataSchema, ConfigIssueDataSchema]);
}

/** Bind a verb literal to one exact optional data schema. */
function exactDataResultOutputSchema<T extends z.ZodType>(
  verb: string,
  dataSchema: T,
): z.ZodObject<
  typeof ENVELOPE_BASE_FIELDS_WITHOUT_VERB & {
    verb: z.ZodLiteral<string>;
    data: z.ZodOptional<T>;
  }
> {
  return envelopeObjectSchema({
    ...ENVELOPE_BASE_FIELDS_WITHOUT_VERB,
    verb: z.literal(verb),
    data: dataSchema.optional(),
  });
}

/** Bind a verb literal to its normal data or shared config-issue data. */
function resultOutputSchema<T extends z.ZodType>(
  verb: string,
  dataSchema: T,
): z.ZodObject<
  typeof ENVELOPE_BASE_FIELDS_WITHOUT_VERB & {
    verb: z.ZodLiteral<string>;
    data: z.ZodOptional<z.ZodUnion<[T, typeof ConfigIssueDataSchema]>>;
  }
> {
  return exactDataResultOutputSchema(
    verb,
    dataSchemaWithConfigIssues(dataSchema),
  );
}

/** Bind a data-less verb while retaining the shared config-issue escape path. */
function datalessResultOutputSchema(
  verb: string,
): z.ZodObject<
  typeof ENVELOPE_BASE_FIELDS_WITHOUT_VERB & {
    verb: z.ZodLiteral<string>;
    data: z.ZodOptional<typeof ConfigIssueDataSchema>;
  }
> {
  return envelopeObjectSchema({
    ...ENVELOPE_BASE_FIELDS_WITHOUT_VERB,
    verb: z.literal(verb),
    data: ConfigIssueDataSchema.optional(),
  });
}

// ── per-verb `data` schemas (the source; the core's `data` type infers from it) ──

/** One commit on a branch (short `sha` + `subject`) — the identity shape of
 * `update`'s landed-commit list (ADR 0064). */
const branchCommitSchema = z.strictObject({
  sha: z.string(),
  subject: z.string(),
});

/** One changed file with its line counts. `added`/`removed` are null for a binary
 * file; `status` is git's single-letter code (`A`/`M`/`D`/`T`); renames are
 * decomposed to a delete + add (via `--no-renames`) so every entry is one matchable
 * path. The shape of `update`'s file delta. */
const changedFileSchema = z.strictObject({
  path: z.string(),
  status: z.string(),
  added: z.number().nullable(),
  removed: z.number().nullable(),
});

/**
 * The **proof** — the deterministic review claim a green gate emits over a
 * clean committed tree, in two renderings from one set of facts (ADR 0188): the
 * branch, the validated commit (`head`, abbreviated), and the whole-diff stats
 * vs the trunk; `line` — the one-line CommonMark blockquote an agent closes its
 * report with; and `markdown` — the review page the owner pulls from discern.
 * Derived ONCE from the result envelope: both renderings are a function of
 * these fields plus the envelope's `steps[]` (what ran, with command and
 * duration), never a second computation. Commit and per-file lists are git's
 * to report (`git diff <trunk>...<branch>`), so they are not mirrored here.
 */
const DURABLE_PROOF_FACT_FIELDS = {
  branch: z.string(),
  trunk: z.string(),
  head: z.string(),
  files_total: z.number(),
  insertions: z.number(),
  deletions: z.number(),
};

const PROOF_PRESENTATION_FIELDS = {
  line: z.string(),
  markdown: z.string(),
};

const PolicyCheckpointDropSchema = z.strictObject({
  scope: z.literal("policy"),
  checkpoint: z.null(),
  mode: z.null(),
  policy_commit: z.string().optional(),
  reason: z.enum(POLICY_CHECKPOINT_DROP_REASONS),
  account: z.string().max(CHECKPOINT_DROP_ACCOUNT_MAX),
});

const EntryCheckpointDropSchema = z.strictObject({
  scope: z.literal("checkpoint"),
  checkpoint: z.string(),
  mode: z.enum(CHECKPOINT_MODES),
  policy_commit: z.string(),
  reason: z.enum(ENTRY_CHECKPOINT_DROP_REASONS),
  account: z.string().max(CHECKPOINT_DROP_ACCOUNT_MAX),
});

/** One durable account of a checkpoint the engine could not enforce. */
export const CheckpointDropSchema = z.discriminatedUnion("scope", [
  PolicyCheckpointDropSchema,
  EntryCheckpointDropSchema,
]);
export type CheckpointDropData = z.infer<typeof CheckpointDropSchema>;

/** One Standard limit proposal. It is bound to the measured source
 * commit, the immutable config-only proposal commit, the current descendant
 * commit whose measurement renews it, the trunk baseline, the complete Standard
 * definition, and the responsible changed paths. */
export const StandardLimitProposalSchema = z.strictObject({
  standard: z.string(),
  commit: z.string(),
  bound_commit: z.string(),
  measured_commit: z.string(),
  definition_fingerprint: z.string(),
  trunk: z.string(),
  trunk_commit: z.string(),
  direction: z.enum(["up", "down"]),
  trunk_limit: z.number(),
  proposed_limit: z.number(),
  measurement: z.number(),
  delta: z.number(),
  reason: z.string().superRefine((reason, context) => {
    const validated = validateStandardLimitReason(reason);
    if (!validated.ok) {
      context.addIssue({ code: "custom", message: validated.message });
    }
  }),
  evidence_paths: z.array(z.string().min(1)).min(1).refine(
    (paths) => new Set(paths).size === paths.length,
    "responsible paths must be unique",
  ),
});
export type StandardLimitProposalData = z.infer<
  typeof StandardLimitProposalSchema
>;

/** One exact approval challenge served at acceptance. The opaque token binds
 * the Standard name, proposed value, and verbatim reason; changing any member
 * produces a different token. */
export const StandardLimitApprovalRequestSchema = z.strictObject({
  proposal: StandardLimitProposalSchema,
  token: z.string().regex(/^[0-9a-f]{64}$/u),
});
export type StandardLimitApprovalRequestData = z.infer<
  typeof StandardLimitApprovalRequestSchema
>;

const PROOF_SUMMARY_FIELDS = {
  completion: CompletionProofPointerSchema.optional(),
  ...DURABLE_PROOF_FACT_FIELDS,
  line: z.string(),
  /** Absent on Proof written before the strict/report distinction. */
  mode: z.enum(GATE_MODES).optional(),
  checkpoint_drops: z.array(CheckpointDropSchema).optional(),
  standard_proposals: z.array(StandardLimitProposalSchema).optional(),
};

/** Typed evidence related to one changed checkpoint path. Existing siblings
 * stay separate from changed-path counts while remaining explicit on every
 * public evidence surface. */
export const RelatedCheckpointEvidenceSchema = z.strictObject({
  kind: z.enum(RELATED_CHECKPOINT_KINDS),
  for_path: z.string(),
  path: z.string(),
});
export type RelatedCheckpointEvidenceData = z.infer<
  typeof RelatedCheckpointEvidenceSchema
>;

/** Resolved checkpoint question presentation. `question_file` records where
 * file-backed prose came from; `question` always carries the resolved text. */
const CHECKPOINT_QUESTION_AUXILIARY_FIELDS = {
  question_file: z.string().optional(),
  teach: z.string().optional(),
  reference: z.string().optional(),
};

const CHECKPOINT_QUESTION_PRESENTATION_FIELDS = {
  question: z.string(),
  ...CHECKPOINT_QUESTION_AUXILIARY_FIELDS,
};

/** One current declared-met checkpoint conclusion — agent evidence, so every
 * rendering says "declared met", never bare "met" or "passed". */
export const CheckpointMetConclusionSchema = z.strictObject({
  id: z.string(),
  /** Absent only on Proof records written before question snapshots shipped. */
  question: z.string().optional(),
  ...CHECKPOINT_QUESTION_AUXILIARY_FIELDS,
  declared_at: z.string(),
  matched: z.array(z.string()).optional(),
  related: z.array(RelatedCheckpointEvidenceSchema).optional(),
}).meta({
  description:
    "One checkpoint question the agent declared met, with the declaration " +
    "time. Agent evidence: recorded, not machine-verified.",
});
/** One current declared-unmet checkpoint conclusion and its rationale. */
export const CheckpointUnmetConclusionSchema = z.strictObject({
  id: z.string(),
  /** Absent only on Proof records written before question snapshots shipped. */
  question: z.string().optional(),
  ...CHECKPOINT_QUESTION_AUXILIARY_FIELDS,
  /** The agent's one-paragraph rationale — opaque evidence, rendered only
   * through escaping boundaries, never interpreted as policy. */
  why: z.string(),
  declared_at: z.string(),
  matched: z.array(z.string()).optional(),
  related: z.array(RelatedCheckpointEvidenceSchema).optional(),
}).meta({
  description:
    "One checkpoint question the agent declared unmet, with its rationale " +
    "and declaration time. Landing requires an owner-authorized variance.",
});
const ReportedCheckpointReviewEntrySchema = z.strictObject({
  id: z.string(),
  mode: z.enum(CHECKPOINT_MODES),
  ...CHECKPOINT_QUESTION_PRESENTATION_FIELDS,
  matched: z.array(z.string()),
  related: z.array(RelatedCheckpointEvidenceSchema).optional(),
});

export const CheckpointReviewReportSchema = z.strictObject({
  enforcement: z.literal("reported"),
  status: z.enum(["not_needed", "unreviewed"]),
  unreviewed: z.array(ReportedCheckpointReviewEntrySchema).optional(),
});

/** The Proof's agent-declared checkpoint conclusions, kept separate from the
 * machine-verified rows, plus the policy identity that governed them. */
export const ProofCheckpointsSchema = z.strictObject({
  /** The merge-base commit whose `[checkpoints]` configuration governed. */
  policy: z.string().optional(),
  declared_met: z.array(CheckpointMetConclusionSchema),
  declared_unmet: z.array(CheckpointUnmetConclusionSchema),
  review: CheckpointReviewReportSchema.optional(),
  drops: z.array(CheckpointDropSchema).optional(),
}).meta({
  id: "DiscernProofCheckpoints",
  description:
    "Agent-declared checkpoint conclusions carried by the Proof, separate " +
    "from machine results: the governing policy identity, the declared-met " +
    "set, and the declared-unmet set whose landing still requires " +
    "owner-authorized variances.",
});
export type ProofCheckpointsData = z.infer<typeof ProofCheckpointsSchema>;

const PROOF_FIELDS = {
  completion: CompleteProofEvidenceSchema.optional(),
  ...DURABLE_PROOF_FACT_FIELDS,
  ...PROOF_PRESENTATION_FIELDS,
  /** Strict is implied for Proof written before this additive field existed. */
  mode: z.enum(GATE_MODES).optional(),
  checkpoint_drops: z.array(CheckpointDropSchema).optional(),
  /** Present when checkpoints governed the run and any fired. */
  checkpoints: ProofCheckpointsSchema.optional(),
  /** Present only when an exact Standard limit proposal remains for
   * the owner; generic landing authority never covers these records. */
  standard_proposals: z.array(StandardLimitProposalSchema).optional(),
};

export const ProofSchema = z.strictObject(PROOF_FIELDS).meta({
  id: "DiscernProof",
  description:
    "The structured Proof a green gate emits over a clean committed tree: " +
    "the branch, trunk, validated commit (abbreviated for display), " +
    "whole-diff stats, and the two renderings derived from those facts.",
});
export type Proof = z.infer<typeof ProofSchema>;

/** The compact Proof: every claim, without the rendered review page. */
export const ProofSummarySchema = z.strictObject(PROOF_SUMMARY_FIELDS).meta({
  id: "DiscernProofSummary",
  description: "The compact Proof claim: branch, trunk, validated " +
    "commit, whole-diff statistics, and the one-line rendered Proof.",
});
/** Compatibility readers' view of an earlier or structurally wider proof.
 * Unknown fields remain readable but never enter the strict runtime proof. */
export const TolerantProofSchema = z.looseObject(PROOF_FIELDS);

/** Project a tolerant or structurally wider proof onto the strict runtime
 * fields in one fixed order. Every compatibility reader shares this boundary. */
export function canonicalProof(proof: Proof): Proof {
  return {
    ...(proof.completion === undefined ? {} : { completion: proof.completion }),
    branch: proof.branch,
    trunk: proof.trunk,
    head: proof.head,
    files_total: proof.files_total,
    insertions: proof.insertions,
    deletions: proof.deletions,
    line: proof.line,
    markdown: proof.markdown,
    ...(proof.mode === undefined ? {} : { mode: proof.mode }),
    ...(proof.checkpoint_drops === undefined
      ? {}
      : { checkpoint_drops: proof.checkpoint_drops }),
    ...(proof.checkpoints === undefined
      ? {}
      : { checkpoints: proof.checkpoints }),
    ...(proof.standard_proposals === undefined
      ? {}
      : { standard_proposals: proof.standard_proposals }),
  };
}

/** The recorded consent evidence used by one successful landing. */
export const LandingConsentDataSchema = z.strictObject({
  source: z.enum(LANDING_CONSENT_SOURCES),
  /** Present only for a standing grant: the scopes that covered changed paths. */
  scopes: z.array(z.string()).optional(),
});
export type LandingConsentData = z.infer<typeof LandingConsentDataSchema>;

/**
 * One owner-authorized variance: permission to land one current declared-unmet
 * checkpoint without changing it. Bound to the exact declaration — checkpoint
 * id, resolved-definition hash, subject fingerprint, and rationale — and to
 * the landed commit it travels with; it changes no future policy.
 */
export const AuthorizedVarianceSchema = z.strictObject({
  checkpoint: z.string(),
  definition_hash: z.string(),
  subject: z.string(),
  /** The agent's rationale the owner authorized landing against. */
  why: z.string(),
}).meta({
  id: "DiscernAuthorizedVariance",
  description:
    "Owner authorization to land one declared-unmet checkpoint, bound to the " +
    "exact declaration (checkpoint, definition hash, subject fingerprint, " +
    "rationale) and the commit it landed with. Never a future policy.",
});
export type AuthorizedVarianceData = z.infer<typeof AuthorizedVarianceSchema>;

/** The structured acceptance evidence a landing records beside its proof:
 * the consent source that landed it plus every owner-authorized variance. */
export const AcceptanceEvidenceSchema = z.strictObject({
  consent: LandingConsentDataSchema,
  variances: z.array(AuthorizedVarianceSchema),
  standard_proposals: z.array(StandardLimitProposalSchema),
}).meta({
  id: "DiscernAcceptanceEvidence",
  description: "How one landing was authorized: the consent evidence, each " +
    "owner-authorized variance for a declared-unmet checkpoint, and each exact " +
    "owner-approved standard limit. A reader can " +
    "therefore distinguish a conclusion awaiting a decision from one the " +
    "owner authorized to land.",
});
export type AcceptanceEvidenceData = z.infer<typeof AcceptanceEvidenceSchema>;

// ── the durable proof note (ADR 0242) ───────────────────────────────────────
// The landed proof travels as a DSSE-compatible envelope under the proof
// name (ADR 0245). `payloadType` and the decoded `payload` bytes are the
// future signature input; the payload owns the full-object-id subject, the
// proof claim, the issuer assertion, and the brief reference.
// Runtime writers stay strict while durable readers accept additive fields.

const PROOF_ISSUER_FIELDS = {
  name: z.string().meta({
    description:
      "The issuer's asserted display name. A verified signature protects " +
      "this text from alteration; trust policy decides who the signing key represents.",
  }).optional(),
  email: z.string().meta({
    description:
      "The issuer's asserted email address. A verified signature protects " +
      "this text from alteration; trust policy decides who the signing key represents.",
  }).optional(),
  key: z.string().meta({
    description:
      "The issuer's asserted key or key reference. Verifiers use their signing " +
      "profile and trust policy rather than trusting this value on its own.",
  }).optional(),
};
/** Identity details asserted by a durable proof payload. A verified
 * signature protects the assertion; a trust policy binds its key to a person,
 * agent, runner, or organization. */
export const ProofIssuerSchema = z.strictObject(PROOF_ISSUER_FIELDS).meta({
  description:
    "Identity details asserted by the Proof payload. A verified Dead Simple " +
    "Signing Envelope (DSSE) signature protects these details from alteration " +
    "but does not establish who controls the signing key. Current writers leave them absent.",
});
export type ProofIssuer = z.infer<typeof ProofIssuerSchema>;

/** One standard DSSE signature entry. Cryptographic algorithm, signature
 * encoding, key resolution, and trust remain the signing profile's decisions. */
export const ProofNoteSignatureSchema = z.strictObject({
  keyid: z.string().meta({
    description:
      "Optional key-selection hint. It is not authenticated by DSSE and must " +
      "not be used as evidence that a key is trusted.",
  }).optional(),
  sig: z.string().meta({
    description:
      "The Base64-encoded signature over DSSE v1 pre-authentication encoding " +
      "of payloadType and the decoded payload bytes.",
  }),
}).meta({
  description:
    "One DSSE signature over this envelope's payload type and decoded payload " +
    "bytes. No signing profile or trust policy is selected today.",
});

/** The closed structured claim a durable proof makes about one green gate run.
 * Runtime proof telemetry cannot enter this schema by composition. */
export const DurableProofClaimSchema = z.strictObject(
  {
    completion: CompleteProofEvidenceSchema,
    ...DURABLE_PROOF_FACT_FIELDS,
    mode: z.enum(GATE_MODES).optional(),
    checkpoint_drops: z.array(CheckpointDropSchema).optional(),
    standard_proposals: z.array(StandardLimitProposalSchema).optional(),
  },
).meta({
  id: "DiscernProofClaim",
  description:
    "The durable structured gate claim: branch and trunk labels, the " +
    "validated commit abbreviation, and whole-diff statistics. The payload's " +
    "full commit subject remains the Proof identity.",
});
export type DurableProofClaim = z.infer<typeof DurableProofClaimSchema>;

/** Human renderings stored beside the structured claim for inspection. They
 * are signed payload bytes but never inputs to proof verification policy. */
export const ProofPresentationSchema = z.strictObject(
  PROOF_PRESENTATION_FIELDS,
).meta({
  id: "DiscernProofPresentation",
  description:
    "The Proof line and Markdown page derived from the gate result for human " +
    "inspection. Verification policy uses the structured claim, never these renderings.",
});
export type ProofPresentation = z.infer<typeof ProofPresentationSchema>;

/** The JSON claim preserved as the envelope's Base64 payload. A future DSSE
 * signature covers every byte of this claim, including issuer and brief. */
export const ProofNotePayloadSchema = z.strictObject({
  subject: z.strictObject({
    commit: z.string().meta({
      description: "The full object id of the validated, landed commit.",
    }),
  }),
  proof: DurableProofClaimSchema,
  presentation: ProofPresentationSchema,
  /** Present when acceptance recorded structured authorization evidence:
   * the consent source plus every owner-authorized variance. */
  acceptance: AcceptanceEvidenceSchema.optional(),
  issuer: ProofIssuerSchema.optional(),
  brief: z.string().meta({
    description:
      "Reserved: a reference to a signed intent artifact. Current writers " +
      "leave it absent.",
  }).optional(),
}).refine(
  (value) => {
    const complete = value.proof.completion;
    return value.subject.commit === complete.candidate.head &&
      (value.proof.mode ?? "strict") === complete.validation.mode;
  },
  "Proof subject and mode must agree with the complete candidate",
).meta({
  description:
    "The Proof claim carried as UTF-8 JSON in the DSSE payload: the landed " +
    "commit, structured gate facts, separate human presentation, optional " +
    "acceptance evidence (consent plus authorized variances), and optional " +
    "issuer assertion and intent reference.",
});
export type ProofNotePayload = z.infer<typeof ProofNotePayloadSchema>;

/** The durable proof note envelope `discern accept` attaches to a landed
 * commit under the registered Proof-note ref. Current writers use discern's unsigned
 * empty-array extension; durable readers use {@link TolerantProofNoteSchema}. */
export const ProofNoteSchema = z.strictObject({
  payloadType: z.literal(PROOF_NOTE_PAYLOAD_TYPE).meta({
    description:
      "The Proof payload's published type. DSSE authenticates this value " +
      "together with the decoded payload bytes.",
  }),
  payload: z.string().meta({
    description: "Standard or URL-safe Base64-encoded UTF-8 JSON matching " +
      "DiscernProofNotePayload, with or without padding. These " +
      "decoded bytes are the DSSE payload and must not be reserialized before verification.",
  }),
  signatures: z.array(ProofNoteSignatureSchema).meta({
    description:
      "DSSE signatures over this payload. Standard signed envelopes carry at " +
      "least one. Current unsigned writers emit discern's empty-array extension.",
  }),
});
/** The durable reader's payload schema. Unknown additive fields pass at every
 * level while the required proof claim remains stable within this major. */
export const TolerantProofNotePayloadSchema = z.looseObject({
  subject: z.looseObject({ commit: z.string() }),
  proof: z.looseObject({
    completion: CompleteProofEvidenceSchema,
    ...DURABLE_PROOF_FACT_FIELDS,
    mode: z.enum(GATE_MODES).optional(),
    checkpoint_drops: z.array(CheckpointDropSchema).optional(),
    standard_proposals: z.array(StandardLimitProposalSchema).optional(),
  }),
  presentation: z.looseObject(PROOF_PRESENTATION_FIELDS),
  acceptance: z.looseObject({
    consent: z.looseObject({
      source: z.string(),
      scopes: z.array(z.string()).optional(),
    }),
    variances: z.array(z.looseObject({
      checkpoint: z.string(),
      definition_hash: z.string(),
      subject: z.string(),
      why: z.string(),
    })),
    standard_proposals: z.array(StandardLimitProposalSchema),
  }).optional(),
  issuer: z.looseObject(PROOF_ISSUER_FIELDS).optional(),
  brief: z.string().optional(),
});

/** The durable reader's envelope schema. Signature entries stay opaque until
 * a signing profile and verifier exist; their bytes remain in the Git note. */
export const TolerantProofNoteSchema = z.looseObject({
  payloadType: z.string(),
  payload: z.string(),
  signatures: z.array(z.looseObject({})),
});

/** How one configured standard's measurement went in a gate run. The SSOT for the
 * measurement-disposition vocabulary — the engine types its outcomes from these. */
export const STANDARD_MEASUREMENTS = [
  "measured", // the run command executed inside the gate's parallel group
  "replayed", // the recorded baseline value stood in — its inputs were untouched
  "skipped", // the gate aborted (fail-fast, an earlier stage) before it ran
  "cancelled", // interrupted production has no completed measurement verdict
  "stale", // produced evidence is inapplicable to the observed subject
] as const;
/** One measurement disposition ({@link STANDARD_MEASUREMENTS}). */
export type StandardMeasurementDisposition =
  (typeof STANDARD_MEASUREMENTS)[number];

/** A measured (or replayed) value's standing against its limit. */
export const STANDARD_VERDICTS = ["improved", "held", "regressed"] as const;
/** One standard verdict ({@link STANDARD_VERDICTS}). */
export type StandardVerdictLabel = (typeof STANDARD_VERDICTS)[number];

/** One standard's outcome in a gate run: what the gate did about its measurement
 * (`measurement`), the value and its standing when one exists (`value` absent for
 * skipped and for an unreadable metric — the diagnostic carries why), the
 * measurement's wall-clock cost, and — for a replay — the commit whose recorded
 * measurement stood in. */
export const GateStandardSchema = z.strictObject({
  name: z.string(),
  direction: z.enum(["up", "down"]),
  limit: z.number(),
  /** Configured headroom used by the Gate's mechanical pin decision. */
  margin: z.number().nonnegative().optional(),
  measurement: z.enum(STANDARD_MEASUREMENTS),
  value: z.number().optional(),
  verdict: z.enum(STANDARD_VERDICTS).optional(),
  duration_s: z.number().optional(),
  replayed_from: z.string().optional(),
  /** Gate-owned mechanical eligibility at this value. Recommendation policy
   * remains outside the Gate. */
  pin_eligible: z.boolean().optional(),
  /** The exact tighter limit the Gate would apply when eligible. */
  pin_target: z.number().optional(),
}).superRefine((reading, context) => {
  if (
    (reading.measurement === "cancelled" || reading.measurement === "stale") &&
    (reading.value !== undefined || reading.verdict !== undefined ||
      reading.pin_eligible === true || reading.replayed_from !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      path: ["measurement"],
      message:
        "An incomplete measurement cannot carry a value, verdict, replay or pin authority",
    });
  }
  if (reading.pin_eligible === true && reading.pin_target === undefined) {
    context.addIssue({
      code: "custom",
      path: ["pin_target"],
      message: "an eligible standard reading must name its pin target",
    });
  }
  if (reading.pin_eligible !== true && reading.pin_target !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["pin_target"],
      message: "an ineligible or unevaluated standard cannot name a pin target",
    });
  }
});
export type GateStandard = z.infer<typeof GateStandardSchema>;

/** One limit a `standards --pin` tightened: the standard, the bound it moved
 * `from` → `to`, and the measured value that justified it. */
export const PinnedLimitSchema = z.strictObject({
  name: z.string(),
  from: z.number(),
  to: z.number(),
  measured: z.number(),
});
/** How `standards propose` changed (or retained) its one proposal record. */
export const StandardLimitProposalResultSchema = z.strictObject({
  status: z.enum([
    "recorded",
    "rebound",
    "replaced",
    "unchanged",
    "recovered",
  ]),
  proposal: StandardLimitProposalSchema,
});
/** The `standards` verb's `data`: the per-standard readings (the same shape the
 * gate carries in `GateData.standards`, so one consumer reads both), and — on a
 * `--pin` that tightened limits — the applied pins. Both optional: a refusal or
 * an empty config carries neither. */
export const ProducerExecutionsSchema = z.record(
  z.string(),
  z.number().int().nonnegative(),
);

/** Why one producer ran or had its recorded evidence reused in a validation run.
 * `closure` is the applicability's own vocabulary: `declared` inputs let evidence
 * travel across commits; `candidate` binds it to the exact commit. */
export const ProducerEvidenceSchema = z.strictObject({
  producer: z.string(),
  use: z.enum(["executed", "reused"]),
  closure: z.enum(["declared", "candidate"]),
  reason: z.string(),
  /** The reused evidence record, when `use` is `reused`. */
  evidence_id: z.string().optional(),
  /** The commit whose validation recorded the reused evidence. */
  from: z.string().optional(),
});
export type ProducerEvidence = z.infer<typeof ProducerEvidenceSchema>;

export const StandaloneValidationDataSchema = z.strictObject({
  producer_executions: ProducerExecutionsSchema,
  producer_evidence: z.array(ProducerEvidenceSchema).optional(),
  standards: z.array(GateStandardSchema).optional(),
  measurement: z.literal("none").optional(),
  completion: z.strictObject({
    kind: z.literal("diagnostic"),
    proof: z.literal("not-issued"),
  }).optional(),
});

export const StandardsDataSchema = z.strictObject({
  producer_executions: ProducerExecutionsSchema.optional(),
  producer_evidence: z.array(ProducerEvidenceSchema).optional(),
  standards: z.array(GateStandardSchema).optional(),
  pinned: z.array(PinnedLimitSchema).optional(),
  proposal: StandardLimitProposalResultSchema.optional(),
});
export type StandardsData = z.infer<typeof StandardsDataSchema>;

/** How the gate's protection of existing `[standards]` definitions and limits
 * against the trunk went: `verified` (definitions match and no bound loosened —
 * vacuously so for Standards new on the branch or a trunk with no config yet),
 * `loosened` (a definition changed, a bound loosened, or an entry was deleted —
 * the gate fails and per-Standard diagnostics carry the details), `unverified`
 * (the trunk cannot be read — an unborn repo or an unfetched CI clone; the gate
 * proceeds LOUDLY, never silently), or `parse_failed` (the trunk's config was
 * fetched but does not parse — the gate fails). The field name and status value
 * remain stable result-envelope vocabulary. */
export const StandardsLimitsSchema = z.strictObject({
  status: z.enum([
    "verified",
    "proposed",
    "loosened",
    "unverified",
    "parse_failed",
  ]),
  trunk: z.string(),
  reason: z.string().optional(),
});
export type StandardsLimitsData = z.infer<typeof StandardsLimitsSchema>;

const landingAuthorityUncoveredSchema = z.strictObject({
  path: z.string(),
  scopes: z.array(z.string()),
  /** Owned by a `[generated.<name>]` group; display evidence only. */
  generated: z.boolean().optional(),
});

/** A read-only projection of recorded landing authority at one lifecycle moment. */
export const LandingAuthorityDataSchema = z.strictObject({
  kind: z.enum(LANDING_AUTHORITY_KINDS),
  /** Present when a grant authorizes this exact tree. */
  source: z.enum(LANDING_CONSENT_SOURCES).optional(),
  /** Standing scopes that cover this exact tree. */
  scopes: z.array(z.string()).optional(),
  /** Known standing grants when the final tree is not yet or not fully covered. */
  standing_scopes: z.array(z.string()).optional(),
  /** Changed paths that keep this tree on the conversational path. */
  uncovered: z.array(landingAuthorityUncoveredSchema).optional(),
  /** Distinct scope names across every uncovered path. */
  uncovered_scopes: z.array(z.string()).optional(),
  /** Uncovered paths matching no configured scope. */
  uncovered_unscoped_total: z.number().int().nonnegative().optional(),
  /** Uncovered paths owned by a `[generated.<name>]` group. */
  uncovered_generated_total: z.number().int().nonnegative().optional(),
  warnings: z.array(z.string()).optional(),
});
export type LandingAuthorityData = z.infer<typeof LandingAuthorityDataSchema>;

/** Compact authority retains the decision and a bounded changed-path sample. */
const LandingAuthoritySummarySchema = LandingAuthorityDataSchema.omit({
  uncovered: true,
}).extend({
  uncovered: z.array(landingAuthorityUncoveredSchema).max(6).optional(),
  uncovered_total: z.number().int().nonnegative().optional(),
});

/** One checkpoint as served to the agent: the question to judge and the
 * matched evidence behind its trigger. */
export const ServedCheckpointDataSchema = z.strictObject({
  id: z.string(),
  mode: z.enum(CHECKPOINT_MODES),
  ...CHECKPOINT_QUESTION_PRESENTATION_FIELDS,
  /** The changed paths the trigger matched — the subject's evidence. */
  matched: z.array(z.string()),
  related: z.array(RelatedCheckpointEvidenceSchema).optional(),
});
export type ServedCheckpointData = z.infer<typeof ServedCheckpointDataSchema>;

/** The gate's checkpoint state for one run: what awaits a conclusion, the
 * current conclusions (agent evidence, separate from machine results), the
 * fired advisory checkpoints, and any fail-open accounts. */
export const GateCheckpointsDataSchema = z.strictObject({
  /** The merge-base commit whose `[checkpoints]` configuration governed. */
  policy: z.string().optional(),
  /** Stop checkpoints refusing this run until each records a conclusion. */
  outstanding: z.array(ServedCheckpointDataSchema).optional(),
  declared_met: z.array(CheckpointMetConclusionSchema).optional(),
  declared_unmet: z.array(CheckpointUnmetConclusionSchema).optional(),
  /** Advise-mode checkpoints that fired — served, never blocking. */
  advise: z.array(ServedCheckpointDataSchema).optional(),
  /** Present only for explicit `done --ci` report mode. */
  review: CheckpointReviewReportSchema.optional(),
  /** Typed evidence behind every fail-open advisory. */
  drops: z.array(CheckpointDropSchema).optional(),
  /** Plain-language accounts of anything that failed open. */
  advisories: z.array(z.string()).optional(),
});
export type GateCheckpointsData = z.infer<typeof GateCheckpointsDataSchema>;

// checkpoints (the read verb) ──────────────────────────────────────────────

/** One checkpoint's structural trigger preview against the current diff. A
 * read surface never runs a `when` command, so a configured one is reported
 * honestly as still pending rather than decided. */
export const CheckpointTriggerPreviewSchema = z.strictObject({
  /** Whether every structural predicate holds against the current diff. */
  holds: z.boolean(),
  /** Present (true) when the trigger holds but a configured `when` command
   * still has the last word at `done`. */
  when_pending: z.boolean().optional(),
  /** The matched paths, when the trigger holds. */
  matched: z.array(z.string()).optional(),
  related: z.array(RelatedCheckpointEvidenceSchema).optional(),
  /** The first predicate that vetoed, when it does not hold. */
  vetoed_by: z.enum(TRIGGER_VETOES).optional(),
});
export type CheckpointTriggerPreviewData = z.infer<
  typeof CheckpointTriggerPreviewSchema
>;

/** The openQuestion states the checkpoints report distinguishes. `reopened` marks
 * a recorded conclusion a later relevant change unbound — it must be declared
 * again before `done` proceeds. */
export const OPEN_QUESTION_STATES = [
  "awaiting_declaration",
  "declared_met",
  "declared_unmet",
  "reopened",
] as const;
export type OpenQuestionState = (typeof OPEN_QUESTION_STATES)[number];

/** The declaration recorded on one openQuestion — agent evidence, so every
 * rendering says "declared met" / "declared unmet", never bare "met". */
export const OpenQuestionDeclarationSchema = z.strictObject({
  conclusion: z.enum(["met", "unmet"]),
  /** The agent's one-paragraph rationale (unmet only) — opaque evidence,
   * rendered only through escaping boundaries. */
  why: z.string().optional(),
  declared_at: z.string(),
  /** False when a later relevant change reopened the openQuestion: the recorded
   * conclusion does not bind to the current subject. */
  current: z.boolean(),
});
/** One checkpoint's effort-scoped openQuestion: the record that it fired, and any
 * declaration bound to it. */
export const OpenQuestionDataSchema = z.strictObject({
  state: z.enum(OPEN_QUESTION_STATES),
  /** The resolved-definition hash the openQuestion is about. */
  definition_hash: z.string(),
  /** The subject fingerprint the openQuestion is about — what a declaration binds
   * to, and what a variance authorization later names. */
  subject: z.string(),
  /** The matched paths the openQuestion recorded — the subject's evidence. */
  matched: z.array(z.string()),
  related: z.array(RelatedCheckpointEvidenceSchema).optional(),
  opened_at: z.string(),
  reopened_at: z.string().optional(),
  declaration: OpenQuestionDeclarationSchema.optional(),
  /** Present (true) on a current declared-unmet conclusion: landing requires
   * an owner-authorized variance. */
  variance_required: z.boolean().optional(),
});
export type OpenQuestionData = z.infer<typeof OpenQuestionDataSchema>;

/** One governing checkpoint's report row: the resolved policy entry, its
 * structural preview against the current diff, and this effort's open question. */
export const CheckpointReportSchema = z.strictObject({
  id: z.string(),
  mode: z.enum(CHECKPOINT_MODES),
  ...CHECKPOINT_QUESTION_PRESENTATION_FIELDS,
  /** One-line deterministic trigger summary (selector, thresholds, `when`). */
  trigger: z.string(),
  /** The canonical strict-gate decision projected from trigger state,
   * persisted question lifetime, subject currency, and declarations. */
  obligation: z.enum(CHECKPOINT_OBLIGATION_STATES),
  /** Absent when the effort diff could not be read (nothing can fire). */
  preview: CheckpointTriggerPreviewSchema.optional(),
  /** Absent when this checkpoint has not fired for this effort. */
  open_question: OpenQuestionDataSchema.optional(),
});
export type CheckpointReportData = z.infer<typeof CheckpointReportSchema>;

/** One recorded openQuestion whose checkpoint sits outside the current
 * governing policy (removed, renamed, or landed differently) — kept visible
 * so recorded judgments never silently vanish, though no declaration can act
 * on it until a governing trigger fires again. */
export const UngovernedOpenQuestionSchema = z.strictObject({
  id: z.string(),
  open_question: OpenQuestionDataSchema,
});
export type UngovernedOpenQuestionData = z.infer<
  typeof UngovernedOpenQuestionSchema
>;

/** `checkpoints` — the read verb: governing policy, effort state, preview. */
export const CheckpointsDataSchema = z.strictObject({
  /** The merge-base commit whose `[checkpoints]` configuration governs. */
  policy: z.string().optional(),
  /** The governing checkpoints, one report row each. */
  checkpoints: z.array(CheckpointReportSchema),
  /** OpenQuestions recorded here whose checkpoint is outside the governing policy. */
  ungoverned: z.array(UngovernedOpenQuestionSchema).optional(),
  /** Observed per-checkpoint economics from the local Logbook — bounded rows
   * of plain counts with their denominators. Absent until observed history
   * exists (every rendering then states that plainly). */
  economics: CheckpointEconomicsSchema.optional(),
  /** Typed evidence behind every fail-open advisory. */
  drops: z.array(CheckpointDropSchema).optional(),
  /** Plain-language fail-open accounts (policy, diff, or store trouble). */
  advisories: z.array(z.string()).optional(),
});
export type CheckpointsData = z.infer<typeof CheckpointsDataSchema>;

/** One configured, read-only next action for previewing a changed scope. */
export const PreviewActionDataSchema = z.strictObject({
  scope: z.string(),
  command: z.string(),
});
export type PreviewActionData = z.infer<typeof PreviewActionDataSchema>;

/** `done` — the gate's own concerns ({@link import("../engine/gate/plan.ts").GateData}).
 * `failed_stage` is the closed {@link FAILED_STAGES} vocabulary (derived here, not
 * hand-listed), so the wire enum and the engine's `FailedStage` type can never drift.
 * `proof` is present on a green run over a clean committed tree ahead of the
 * trunk — the review-moment summary; `gate_proof` reports how recording it in the
 * marker file went. `standards`/`standards_limits` are present when `[standards]`
 * is configured: the per-standard measurement outcomes and the never-loosen
 * verification against the trunk. */
export const CompletionPendingSchema = z.strictObject({
  kind: z.string(),
  reason: z.string(),
});
export const GateDataSchema = z.strictObject({
  emergency_validation: z.array(EmergencyValidationSchema).optional(),
  producer_executions: ProducerExecutionsSchema.optional(),
  producer_evidence: z.array(ProducerEvidenceSchema).optional(),
  completion: z.strictObject({
    kind: z.enum(["diagnostic", "complete", "pending"]),
    candidate_id: z.string().optional(),
    proof_id: z.string().optional(),
    pending_reasons: z.array(z.string()),
    pending: z.array(CompletionPendingSchema).optional(),
  }).optional(),
  mode: z.enum(GATE_MODES).optional(),
  /** Whether this invocation executed the Gate. False on exact green Proof
   * reuse and pre-Gate checkpoint serving; optional for older producers. */
  gate_ran: z.boolean().optional(),
  failed_stage: z.enum(FAILED_STAGES).nullable(),
  scopes_changed: z.array(z.string()),
  preview_actions: z.array(PreviewActionDataSchema).optional(),
  standards: z.array(GateStandardSchema).optional(),
  standards_limits: StandardsLimitsSchema.optional(),
  landing_authority: LandingAuthorityDataSchema.optional(),
  /** Checkpoint state when any checkpoint governed this run. Also present on
   * an awaiting-declaration refusal, carrying the batched outstanding set. */
  checkpoints: GateCheckpointsDataSchema.optional(),
  proof: ProofSchema.optional(),
  gate_proof: z.strictObject({
    status: z.enum([
      "recorded",
      "diagnostic",
      "pending",
      "skipped_dirty",
      "skipped_head_moved",
      "unavailable",
      "record_failed",
      "cleared",
      "clear_failed",
    ]),
    path: z.string().optional(),
    reason: z.string().optional(),
  }).optional(),
});
export type GateData = z.infer<typeof GateDataSchema>;

/** Compact `done`: the same gate state with a compact Proof. */
export const GateWireDataSchema = GateDataSchema.omit({
  proof: true,
  landing_authority: true,
}).extend({
  proof: ProofSummarySchema.optional(),
  landing_authority: LandingAuthoritySummarySchema.optional(),
});
export type GateWireData = z.infer<typeof GateWireDataSchema>;

/** How a recorded proof stands against the current worktree and HEAD.
 * `proof` and `proof_line` are present only when the marker is honored; the
 * remaining statuses preserve why it is not. Inspection never reruns the gate. */
export const GATE_PROOF_CHECK_STATUSES = [
  "honored",
  "report_only",
  "missing",
  "stale",
  "dirty",
  "unavailable",
  "read_failed",
] as const;
export type GateProofCheckStatus = (typeof GATE_PROOF_CHECK_STATUSES)[number];

export const GateProofCheckSchema = z.strictObject({
  status: z.enum(GATE_PROOF_CHECK_STATUSES),
  path: z.string().optional(),
  recorded: z.string().optional(),
  head: z.string().optional(),
  reason: z.string().optional(),
  proof: z.string().optional(),
  proof_line: z.string().optional(),
  /** The structured Proof cached by a complete Gate result. Incomplete marker
   * state may omit it but cannot enter a reuse or landing fast path. */
  proof_data: ProofSchema.optional(),
  /** Proof-carried and live declaration-evidence uncertainty. */
  checkpoint_drops: z.array(CheckpointDropSchema).optional(),
});
export type GateProofCheckData = z.infer<typeof GateProofCheckSchema>;

/** A marker inspection without its rendered page or duplicate full Proof. */
const GateProofWireSchema = z.strictObject({
  status: z.enum(GATE_PROOF_CHECK_STATUSES),
  path: z.string().optional(),
  recorded: z.string().optional(),
  head: z.string().optional(),
  reason: z.string().optional(),
  proof: ProofSummarySchema.optional(),
  checkpoint_drops: z.array(CheckpointDropSchema).optional(),
});

const GateValidationSchema = z.strictObject({
  mode: z.enum(["proof", "rerun"]),
  proof: GateProofCheckSchema,
});
const GateValidationWireSchema = z.strictObject({
  mode: z.enum(["proof", "rerun"]),
  proof: GateProofWireSchema,
});

/** `refresh` — generated instructions, skills, provider integration artifacts, and
 * the maintained ADR index. `adr_index_written` names the ADR README whose
 * marker-delimited record lists this run regenerated (at most one path; empty
 * when the index is current or the project carries no index markers). */
export const RefreshDataSchema = z.strictObject({
  agents_written: z.array(z.string()),
  mcp_wired: z.array(z.string()),
  hooks_wired: z.array(z.string()),
  worktree_app_wired: z.array(z.string()),
  project_rules_wired: z.array(z.string()),
  proof_notes_fetch_changed: z.array(z.string()).optional(),
  adr_index_written: z.array(z.string()),
  skills: z.strictObject({
    copied: z.number(),
    linked: z.number(),
    pruned: z.number(),
  }),
  errors: z.array(z.string()),
});
export type RefreshData = z.infer<typeof RefreshDataSchema>;

/** One explicit `impact --has` observation inside the normal scope result. */
const scopeMembershipDataSchema = z.strictObject({
  scope: z.string(),
  present: z.boolean(),
});

/** `impact` — the classified scope/marker list and optional membership query. */
export const ScopesDataSchema = z.strictObject({
  scopes: z.array(z.string()),
  preview_actions: z.array(PreviewActionDataSchema).optional(),
  membership: scopeMembershipDataSchema.optional(),
});
export type ScopesData = z.infer<typeof ScopesDataSchema>;

/** How a `coupling` query is rooted: `diff` (surface what co-changes with the current
 * change set but is missing from it), `query` (one file's top co-change partners), or
 * `evidence` (the shared co-change history of TWO files — the commits where both changed).
 * The SSOT for the mode vocabulary — the schema enum below derives from it and the engine
 * core types its `mode` value as {@link CouplingMode}, so the wire enum and the engine
 * never re-list the modes out of step. Defined here (not the engine) because this
 * `shared/` module must not import `src/engine/**`. */
export const COUPLING_MODES = ["diff", "query", "evidence"] as const;
/** One `coupling` mode ({@link COUPLING_MODES}). */
export type CouplingMode = (typeof COUPLING_MODES)[number];

/** One co-change partner: the file `path` that co-changed with `from` across the mined
 * git history, carried with the evidence behind the edge in PLAIN COUNTS — `cochanges`
 * (the number of recent commits that touched both), `of` (the number that touched
 * `from`, so the evidence reads "`cochanges` of `of` commits"), `confidence`
 * (`cochanges / of`, 0–1), and `lift` (how much more than chance the two co-occur,
 * always > 1 for a kept edge). The edge also cleared a log-likelihood-ratio
 * significance test, not surfaced here. */
const couplingPartnerSchema = z.strictObject({
  path: z.string(),
  from: z.string(),
  cochanges: z.number().int(),
  of: z.number().int(),
  confidence: z.number(),
  lift: z.number(),
});

/** One commit in the `evidence`-mode shared history: its short `sha`, `date` (YYYY-MM-DD),
 * and `subject` — the same identity `update` reports for a landed commit (ADR 0064),
 * enough to judge whether two files moved as one decision or merely rode along. */
const couplingEvidenceCommitSchema = z.strictObject({
  sha: z.string(),
  date: z.string(),
  subject: z.string(),
});

/** One input path coupling did not model because a configured generated group owns it. */
const couplingGeneratedExclusionSchema = z.strictObject({
  path: z.string(),
  group: z.string(),
});

/** `coupling` — the co-change view mined from git history; `mode` picks the shape:
 * - `diff` carries the `changed` set considered and the `partners` MISSING from it;
 * - `query` carries the queried `target` and its `partners` (the capped ranked list, each
 *   entry an edge with its evidence — advisory and NOT exhaustive);
 * - `evidence` compares two files `a` and `b`: `together` commits changed both (of `of_a`
 *   that touched `a` and `of_b` that touched `b`), the most recent listed in `commits`.
 * `excluded_generated` names query arguments or current changed paths removed because a
 * `[generated.<group>]` declaration owns them. Evidence fields are absent when either
 * argument is excluded, because the pair was not modeled.
 * `partners` is always present (empty in `evidence` mode); the mode-specific fields are
 * optional so one object models every shape. */
export const CouplingDataSchema = z.strictObject({
  mode: z.enum(COUPLING_MODES),
  changed: z.array(z.string()).optional(),
  target: z.string().optional(),
  partners: z.array(couplingPartnerSchema),
  excluded_generated: z.array(couplingGeneratedExclusionSchema).optional(),
  a: z.string().optional(),
  b: z.string().optional(),
  together: z.number().int().optional(),
  of_a: z.number().int().optional(),
  of_b: z.number().int().optional(),
  commits: z.array(couplingEvidenceCommitSchema).optional(),
});
export type CouplingData = z.infer<typeof CouplingDataSchema>;

/** The fleet conditions `await` can hold for — one per call, mutually exclusive.
 * Defined here (not the engine) because the CLI flag surface, the MCP tool, and
 * the data schema all name the same closed set. */
export const AWAIT_CONDITIONS = ["green", "landed", "trunk-moved"] as const;
/** One `await` condition ({@link AWAIT_CONDITIONS}). */
export type AwaitConditionKind = (typeof AWAIT_CONDITIONS)[number];

/** A bounded, checksum-protected identifier safe for an agent to relay. */
export const ContinuationHandleSchema = z.string()
  .length(CONTINUATION_HANDLE_LENGTH)
  .regex(CONTINUATION_HANDLE_PATTERN);

/** Why one `await` call uses its reported bound: an exact caller request, the
 * long CLI allowance, a known configurable MCP client, a known strict client,
 * the conservative unknown-client fallback, or an environment-supplied
 * experimental cap sitting below the caller profile's bound. */
export const AWAIT_RETRY_BASES = [
  "explicit",
  ...AWAIT_CALL_PROFILES,
  "cache-window",
] as const;

/** The current call and its continuation share one bound vocabulary. */
export const AWAIT_TIMEOUT_BASES = AWAIT_RETRY_BASES;

/** What one `await` evaluation observed — always authoritative state (a git
 * ancestry read, a proof inspection), never logbook history. Per-condition:
 * `green` carries the sibling proof's status ({@link GateProofCheckSchema}
 * statuses, plus `no-worktree` when no checkout holds the branch) and the
 * sibling `worktree` path; `landed`/`green` carry the latest observed `tip` sha and
 * whether it `landed`; `trunk-moved` carries the trunk sha at call start and
 * now. When a met condition means `discern update` has work to bring in,
 * `behind`/`incoming_overlap`/`overlap_total` preview it (the same hot-zone
 * read `status` reports). */
const awaitObservedSchema = z.strictObject({
  proof_status: z.enum([
    ...GATE_PROOF_CHECK_STATUSES,
    "no-worktree",
  ]).optional(),
  worktree: z.string().optional(),
  tip: z.string().optional(),
  landed: z.boolean().optional(),
  trunk_start: z.string().optional(),
  trunk_head: z.string().optional(),
  behind: GitCountSchema.optional(),
  incoming_overlap: z.array(z.string()).optional(),
  overlap_total: z.number().int().optional(),
});

/** `await` — one blocking wait on a fleet condition. `met` is the verdict this
 * call ends on (a timeout is `met: false` with `ok: true` — "not yet" is an
 * answer, not a failure); `observed` is the authoritative state behind it;
 * `timeout_s` + `timeout_basis` name the transport-safe bound this call used;
 * `requested_timeout_s` records a larger caller request when that
 * request had to be capped; `resume` is the short repository-local handle that
 * preserves the original pins across calls; `retry_after_s` +
 * `retry_basis` give the next lossless call's bound. */
export const AwaitDataSchema = z.strictObject({
  condition: z.enum(AWAIT_CONDITIONS),
  branch: z.string().optional(),
  trunk: z.string(),
  met: z.boolean(),
  elapsed_ms: z.number().int(),
  timeout_s: z.number(),
  timeout_basis: z.enum(AWAIT_TIMEOUT_BASES),
  requested_timeout_s: z.number().optional(),
  observed: awaitObservedSchema,
  resume: ContinuationHandleSchema.optional(),
  retry_after_s: z.number().int().optional(),
  retry_basis: z.enum(AWAIT_RETRY_BASES).optional(),
});
export type AwaitData = z.infer<typeof AwaitDataSchema>;

/** `start` — the worktree it just created (or, in a dry-run, would create). `path`
 * is the load-bearing field: the new worktree's absolute location, which the caller
 * must re-root into (the MCP server cannot relocate the session for the agent).
 * `from` is the ref the new branch forked from — the trunk unless the caller
 * overrode it (the landing model's pull axis). `name_note` is present only when the
 * caller supplied a `name` that was normalised into the branch slug or could not be
 * used (so a random codename was substituted) — a transparency line the caller can
 * surface, and act on if it cares. */
export const StartDataSchema = z.strictObject({
  id: z.string(),
  branch: z.string(),
  path: z.string(),
  from: z.string(),
  /** Emitted only when the selected base lacks one or more trunk commits. */
  behind_trunk: z.number().int().positive().optional(),
  task: TaskMetadataDataSchema,
  name_note: z.string().optional(),
  landing_authority: LandingAuthorityDataSchema.optional(),
});
export type StartData = z.infer<typeof StartDataSchema>;

/** `worktree rename` — the metadata-only title change for this worktree. */
export const TaskRenameDataSchema = z.strictObject({
  path: z.string(),
  previous_title: z.string(),
  task: TaskMetadataDataSchema,
});
export type TaskRenameData = z.infer<typeof TaskRenameDataSchema>;

export const ProofNotesFetchSchema = z.strictObject({
  mode: z.enum(["local", "fetch"]),
  status: z.enum(["local", "wired", "unchanged", "no_remote", "failed"]),
  remotes: z.array(z.string()),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  errors: z.array(z.string()),
});
export type ProofNotesFetchData = z.infer<typeof ProofNotesFetchSchema>;

export const ProofNoteWriteSchema = z.strictObject({
  status: z.enum([
    "recorded",
    "already_present",
    "record_failed",
    "missing_proof",
  ]),
  ref: z.string(),
  commit: z.string(),
  merged_refs: z.array(z.string()),
  reason: z.string().optional(),
});
export type ProofNoteWriteData = z.infer<typeof ProofNoteWriteSchema>;

export const AcceptProofNoteSchema = z.strictObject({
  fetch: ProofNotesFetchSchema,
  write: ProofNoteWriteSchema,
});
export type AcceptProofNoteData = z.infer<typeof AcceptProofNoteSchema>;

/** `accept` — where the branch landed: `root` is the main checkout the worktree's
 * branch was landed into. The load-bearing field for the MCP working-root re-aim
 * (ADR 0062): accept removes the worktree the server operated on, and the server
 * re-aims its working root to THIS path — so a server launched inside a worktree (e.g.
 * Codex's app-managed worktree) lands back on the live main checkout, not the grave of
 * the worktree it just landed, instead of the spawn root (which is the trunk only
 * when the server was launched from the trunk). */
/** One landing-queue row: an effort's submitted revision awaiting its landing. */
export const SubmissionRowSchema = z.strictObject({
  effort: z.string(),
  branch: z.string(),
  /** The submitting worktree's path. */
  path: z.string(),
  /** The exact submitted commit. */
  head: z.string(),
  submitted_at: z.string(),
  /** Pre-authorized rows land once green without a further conversation. */
  authority: z.enum(["pre-authorized", "awaiting-owner"]),
  authority_source: z.enum(["effort-grant", "standing-grant"]).optional(),
  granted_at: z.string().optional(),
  /** 1-based place in the displayed order. */
  position: z.number().int().positive(),
  readiness: z.enum(["ready", "waiting"]),
  /** One full sentence: why the submission waits. Absent when ready. */
  reason: z.string().optional(),
  /** The trunk moved after its Proof, so its landing composes and checks the
   * combined code in an integration worktree first. */
  integration: z.boolean().optional(),
  /** The running landing currently checking this submission; read it with
   * `discern progress <handle>`. */
  operation_handle: z.string().optional(),
}).meta({
  id: "DiscernSubmissionRow",
  description:
    "One landing-queue row derived from an effort's submission record: the " +
    "branch, the exact submitted commit, whether a recorded grant covers it, " +
    "and the one sentence that says why it waits.",
});
/** One attempted landing in an acceptance call: the selected submission or
 * a further queue-walk landing. Broad terminal states stay stable; optional
 * fields carry detail a consumer may ignore. */
export const LandingOutcomeSchema = z.strictObject({
  effort: z.string(),
  branch: z.string(),
  /** The exact submitted revision this outcome describes. */
  head: z.string(),
  /** This outcome belongs to the call's selected submission. */
  selected: z.boolean(),
  /** Landed: the trunk holds it. Refused: nothing changed for it. Failed:
   * its landing stopped after effects; `landed_commit` and `reason` say
   * exactly which, and nothing implies earlier effects were undone. */
  status: z.enum(["landed", "refused", "failed"]),
  /** The exact commit that reached the trunk (equals `head` on the direct
   * path; the proven composed commit on an integrated landing). */
  landed_commit: z.string().optional(),
  /** The landing composed and checked in an integration worktree. */
  integrated: z.boolean().optional(),
  consent: LandingConsentDataSchema.optional(),
  /** One sentence: why a refused or failed landing stopped, with its route. */
  reason: z.string().optional(),
  proof_line: z.string().optional(),
}).meta({
  id: "DiscernLandingOutcome",
  description:
    "One attempted landing in an acceptance call: the submission it names, " +
    "whether it was the selected one, its broad terminal state, and the " +
    "exact commit that reached the trunk when one did.",
});
export type LandingOutcomeData = z.infer<typeof LandingOutcomeSchema>;

/** The served decision moment of a retained integration composition: which
 * composition (the receipt a continuation must name), which decision kind
 * continues it, and the checkpoint ids awaiting that decision. */
export const IntegrationJudgmentSchema = z.strictObject({
  /** The retained composition's receipt — pass it back as `composition`. */
  composition: z.string(),
  decision: z.enum(["declaration", "variance"]),
  awaiting: z.array(z.string()),
}).meta({
  id: "DiscernIntegrationJudgment",
  description:
    "The served decision moment of a retained integration composition: the " +
    "receipt a continuation must name, the decision kind that continues it, " +
    "and the checkpoint ids awaiting that decision.",
});
/** The revision a person or caller reviewed before submission. */
export const SubmissionRevisionSchema = z.strictObject({
  path: z.string(),
  branch: z.string(),
  head: z.string(),
  proof: CompletionProofPointerSchema,
});
export type SubmissionRevision = z.infer<typeof SubmissionRevisionSchema>;

export const AcceptDataSchema = z.strictObject({
  revision: SubmissionRevisionSchema.optional(),
  checkpoint_preparation: GateCheckpointsDataSchema.optional(),
  /** Present on a judgment or variance stop over a retained composition. */
  integration_judgment: IntegrationJudgmentSchema.optional(),
  emergency_validation: z.array(EmergencyValidationSchema).optional(),
  emergency: EmergencyDataSchema.optional(),
  /** The landing queue: every unlanded submission, in landing order. */
  queue: z.array(SubmissionRowSchema).optional(),
  /** Every landing this call attempted, the selected submission marked and
   * first. `landing` remains the selected landing's effect projection. */
  landings: z.array(LandingOutcomeSchema).optional(),
  /** Present after landing; read-only reviews may carry only checkpoint drops. */
  root: z.string().optional(),
  consent: LandingConsentDataSchema.optional(),
  /** Fail-open checkpoint evidence retained through review and landing. */
  checkpoint_drops: z.array(CheckpointDropSchema).optional(),
  /** Configured scope names matched by the landed paths. Optional for
   * compatibility with acceptance results written before this evidence was
   * exposed; current fresh landings emit it when at least one scope matched. */
  scopes_changed: z.array(z.string()).optional(),
  /** Exact effects already performed. Optional for additive v1 compatibility;
   * current apply results always emit it. */
  landing: AcceptLandingStateSchema.optional(),
  /** Non-blocking authority evidence the caller should surface. */
  authority_warnings: z.array(z.string()).optional(),
  gate_validation: GateValidationSchema.optional(),
  /** The proof markdown for the tree that landed — the landing record, pasteable
   * into a PR body (from the honored marker on the fast path, or the fresh gate run
   * on the slow path; absent when neither carried one). */
  proof: z.string().optional(),
  /** The system-rendered one-line proof for the tree that landed. Agents relay
   * this field verbatim at the end of their landing report. */
  proof_line: z.string().optional(),
  /** Owner-authorized variances this landing carried — one per checkpoint the
   * agent declared unmet. Distinct from declarations: a declaration is the
   * agent's recorded judgment; a variance is the owner's authorization. */
  variances: z.array(AuthorizedVarianceSchema).optional(),
  /** Exact Standard/value/reason proposal tuples the owner approved for this
   * landing. Distinct from generic landing consent and standing grants. */
  standard_approvals: z.array(StandardLimitProposalSchema).optional(),
  /** Exact proposal/token challenges awaiting owner approval. Present only on
   * the read-only proposed-Standard-limit decision stop. */
  standard_approvals_required: z.array(
    StandardLimitApprovalRequestSchema,
  ).optional(),
  /** Repository-resident proof recording and its optional fetch transport.
   * Both run after the trunk moves and therefore fail open. */
  proof_note: AcceptProofNoteSchema.optional(),
  ignored_file_changes: IgnoredFileChangeSummarySchema.optional(),
});
export type AcceptData = z.infer<typeof AcceptDataSchema>;

/** Runtime assertion for every result that has crossed the landing boundary. */
export const AppliedAcceptDataSchema = AcceptDataSchema.required({
  root: true,
  consent: true,
});
/** Compact `accept`: landing state plus its bounded Proof line. */
const AcceptWireDataSchema = AcceptDataSchema.omit({
  proof: true,
  gate_validation: true,
}).extend({
  gate_validation: GateValidationWireSchema.optional(),
});

// update ─────────────────────────────────────────────────────────────────────

/** One commit an integration brought in — {@link branchCommitSchema}, the shape
 * shared with the proof's commit list. */
const updateCommitSchema = branchCommitSchema;

/** One file an integration changed beneath the branch — {@link changedFileSchema},
 * the shape shared with the proof's diffstat. */
const updateFileSchema = changedFileSchema;

/** The SHA anchors bounding an integration — an agent diffs/logs against these to
 * pull the FULL set in one call when a list is capped. `main` is the INCOMING
 * TIP: the integration branch's tip on a default pull, or the `--from` ref's tip
 * (the field name stays `main` — the wire contract predates `--from`). `after`
 * (the merged HEAD) is absent in a `--dry-run` preview (no merge happened); the
 * predicted ranges use `before...main` (three-dot) instead of `before..after`. */
const updateRangeSchema = z.strictObject({
  base: z.string(),
  before: z.string(),
  main: z.string(),
  after: z.string().optional(),
});

/** `update` — what the merge brought in BENEATH the branch: the `commits` and
 * `files` it landed (each capped, with the pre-cap `*_total` and a `*_truncated`
 * flag), which of the branch's own files `overlap` them (re-read these for semantic
 * conflicts a clean merge can't catch), the fire-scopes the incoming change touches
 * (`scopes_incoming`), generated paths resolved without textual merging
 * (`auto_resolved`), generated groups re-run after the merge (`regenerated`), and
 * the `range` anchors for drilling in. Present only when something was — or, in a
 * preview, would be — updated (omitted on a no-op). */
export const UpdateDataSchema = z.strictObject({
  behind: z.number(),
  fast_forward: z.boolean(),
  commits: z.array(updateCommitSchema),
  commits_total: z.number(),
  commits_truncated: z.boolean(),
  files: z.array(updateFileSchema),
  files_total: z.number(),
  files_truncated: z.boolean(),
  overlap: z.array(z.string()),
  overlap_total: z.number(),
  scopes_incoming: z.array(z.string()),
  auto_resolved: z.array(z.string()).optional(),
  regenerated: z.array(z.string()).optional(),
  range: updateRangeSchema,
});
export type UpdateData = z.infer<typeof UpdateDataSchema>;

// status ──────────────────────────────────────────────────────────────────────

/** Where a `status` call is rooted: the main checkout or a linked worktree. The SSOT
 * for the location vocabulary — the schema enum below derives from it and `status.ts`
 * types its `location` value + context field as {@link Location}, so the wire enum and
 * the engine never re-list "main"/"worktree" out of step. */
export const LOCATIONS = ["main", "worktree"] as const;
/** One status location ({@link LOCATIONS}). */
export type Location = (typeof LOCATIONS)[number];

/**
 * One checkout's derived identity. `satisfies` makes every stored identity
 * field join the CLI/MCP/resource schema when it joins the shared vocabulary.
 */
const statusIdentityShape = {
  id: z.string(),
  branch: z.string(),
  site: z.string(),
  port: z.number(),
  db: z.string(),
  seed: z.number().int().nonnegative(),
} satisfies Record<WorktreeIdentityField, z.ZodType>;

/** This checkout's derived identity + resources recorded in its `.env`. */
const statusWorktreeSchema = z.strictObject({
  ...statusIdentityShape,
  resources: z.record(z.string(), z.string()),
});
export type StatusWorktree = z.infer<typeof statusWorktreeSchema>;

/** The local git situation relative to the trunk. */
const statusGitSchema = z.strictObject({
  branch: z.string(),
  trunk: z.string(),
  /** Ordinary Git-clean: no tracked changes and no untracked non-ignored files. */
  clean: z.boolean(),
  /** Count of ordinary `git status --porcelain` entries. */
  changed_files: z.number(),
  behind_trunk: GitCountSchema.nullable(),
  /** Null when the trunk branch doesn't exist locally — there is nothing to
   * count against, and an honest null beats a fabricated 0. */
  ahead_trunk: GitCountSchema.nullable(),
  /** When behind: the files THIS branch changed that the incoming trunk also
   * changed — the hot zone to re-check on updating (capped; present only in a
   * worktree that is behind and has overlap). The same intersection `update` reports. */
  incoming_overlap: z.array(z.string()).optional(),
});
export type StatusGit = z.infer<typeof statusGitSchema>;

/** What the gate WOULD fire for the current change — enumerated, never run. */
const statusGateSchema = z.strictObject({
  jobs: z.array(z.string()),
  scope_gates: z.array(z.string()),
});
export type StatusGate = z.infer<typeof statusGateSchema>;

/** One row of the fleet survey. `is_current` marks the row the status call is
 * rooted in (the main row from the main checkout; the current worktree's row under
 * `--all`); every other row is a separate line of work. */
const statusFleetLastActionSchema = z.strictObject({
  verb: z.string(),
  outcome: z.enum(["ok", "failed", "partial", "refused"]),
  at: z.string(),
  failed_stage: z.string().optional(),
});

const statusFleetRunningSchema = z.strictObject({
  verb: z.string(),
  started: z.string(),
  elapsed_ms: z.number().nonnegative(),
  typical_duration_ms: z.number().nonnegative().optional(),
});

const statusFleetFilesystemSchema = z.strictObject({
  state: z.enum(["directory", "missing", "other", "unreadable"]),
  reason: z.string().optional(),
});

const statusFleetGitFailureSchema = z.strictObject({
  command: z.string(),
  reason: z.string(),
});

const statusFleetSetupJournalSchema = z.strictObject({
  status: z.enum(["missing", "recorded", "unavailable"]),
  path: z.string().optional(),
  steps: z.array(z.strictObject({
    id: z.string(),
    command: z.string(),
    state: z.enum(["not_started", "running", "completed"]),
  })),
  reason: z.string().optional(),
});

const statusFleetSetupSchema = z.strictObject({
  state: z.enum(["ready", "incomplete", "unavailable"]),
  marker: z.enum(["present", "missing", "unavailable"]),
  journal: statusFleetSetupJournalSchema.optional(),
  repair: z.strictObject({
    kind: z.enum(["retry", "manual"]),
    command: z.string(),
    reason: z.string(),
  }).optional(),
});

const statusFleetEntrySchema = z.strictObject({
  path: z.string(),
  is_main: z.boolean(),
  is_current: z.boolean(),
  branch: z.string(),
  /** Git registration remains observable when checkout-local state is not. */
  registration: z.strictObject({
    head: z.string(),
    locked: z.boolean(),
    prunable: z.boolean(),
  }).optional(),
  /** Whether the registered checkout names a reachable local branch ref. */
  branch_reachable: z.boolean().optional(),
  /** Filesystem presence is independent of Git readability. */
  filesystem: statusFleetFilesystemSchema.optional(),
  /** Ordinary Git-clean: no tracked changes and no untracked non-ignored files.
   * Absent (with the other per-checkout git fields) when `git_unavailable` is
   * set — an unreadable checkout's state is unknown, never reported clean. */
  clean: z.boolean().optional(),
  /** Count of ordinary `git status --porcelain` entries. */
  changed_files: z.number().optional(),
  ahead: GitCountSchema.optional(),
  behind: GitCountSchema.optional(),
  last_activity: z.string().optional(),
  /** The branch's newest completed logbook verb event. */
  last_action: statusFleetLastActionSchema.optional(),
  /** A fresh effectful begin event with no paired completion. */
  running: statusFleetRunningSchema.optional(),
  /** Present when this worktree is CONTAINED: clean, idle, and its branch tip
   * a strict ancestor of the named live branch's tip — the spent early stage
   * of a `start --from` train. Advisory colour only: reclaiming the checkout
   * stays a human-confirmed action (`worktree prune --contained` or the
   * desk), and the branch ref is always kept. */
  contained_in: z.string().optional(),
  /** Present (true) when git could not run inside this worktree (a missing
   * directory, a corrupted gitlink, a permission refusal): its state is
   * UNKNOWN, so the per-checkout git fields are absent rather than fabricated —
   * consumers must fail safe, never assume clean. */
  git_unavailable: z.boolean().optional(),
  /** The command and diagnostic behind `git_unavailable`. */
  git_failure: statusFleetGitFailureSchema.optional(),
  id: z.string().optional(),
  port: z.number().optional(),
  /** Resource handles recorded in this checkout's configured env files. */
  resources: z.record(z.string(), z.string()).optional(),
  /** Setup ownership and retry evidence. */
  setup: statusFleetSetupSchema.optional(),
  /** Human task wording joined to the separately authoritative id and branch.
   * Optional for status compatibility with older producers. */
  task: TaskMetadataDataSchema.optional(),
  /** Present (true) when creation stopped before the project configuration
   * arrived. Configured checkouts with no ready marker use `setup` to report
   * incomplete setup separately. */
  broken: z.boolean().optional(),
  /** Present (true) when the row's clean HEAD has an honored proof from
   * `discern done` — reviewable without visiting the worktree. `proof` /
   * `proof_line` carry the stored page and one-line form when the marker
   * recorded them (ADR 0188), so a supervisor at the main checkout reads the
   * review summary from here (`--verbose` prints it interactively). */
  proof_honored: z.boolean().optional(),
  proof: z.string().optional(),
  proof_line: z.string().optional(),
  /** The complete proof inspection for this worktree. Existing honored-only
   * fields stay for compatibility; this additive field preserves missing,
   * stale, dirty, unavailable, and read-failed states too. */
  /** Present when this checkout's committed source has landed and the
   * checkout stayed: one sentence with why it stayed and the command that
   * finishes cleanup, the same words the effort's own status leads with. */
  gate_proof: GateProofCheckSchema.optional(),
  landing_authority: LandingAuthorityDataSchema.optional(),
  /** Present when this checkout is a landing's own integration worktree —
   * discern-owned, never an effort an agent may adopt. `live` while its
   * landing runs; `interrupted` when the owner is gone — then
   * `discern worktree prune` reclaims it, unless `awaiting_judgment` marks
   * it as deliberately retained for a served checkpoint decision that
   * `discern accept` continues from the author's worktree. */
  integration: z.strictObject({
    owner: z.enum(["live", "interrupted"]),
    /** The authoring branch whose submission the landing composes. */
    for_branch: z.string(),
    /** The copy is retained for a served checkpoint decision; it is not
     * reclaimable while its submission stands. */
    awaiting_judgment: z.boolean().optional(),
  }).optional(),
});
export type StatusFleetEntry = z.infer<typeof statusFleetEntrySchema>;

/** A fleet row without the three compatibility copies of its rendered Proof. */
const statusFleetWireEntrySchema = statusFleetEntrySchema.omit({
  proof_honored: true,
  proof: true,
  proof_line: true,
  gate_proof: true,
  landing_authority: true,
}).extend({
  gate_proof: GateProofWireSchema.optional(),
  landing_authority: LandingAuthoritySummarySchema.optional(),
});

/** One cross-worktree collision: two fleet branches whose fork diffs vs the
 * trunk touch the same paths — a semantic collision in the making even when
 * both merge cleanly. `overlap` is capped; `total` is the true count. */
const statusFleetCollisionSchema = z.strictObject({
  branches: z.tuple([z.string(), z.string()]),
  overlap: z.array(z.string()),
  total: z.number(),
});
export type StatusFleetCollision = z.infer<typeof statusFleetCollisionSchema>;

const statusFleetCollisionWireSchema = statusFleetCollisionSchema.omit({
  overlap: true,
});

/** One in-flight ADR number collision: a record number claimed by files ADDED
 * on two or more in-flight branches — different paths with one number, which
 * the changed-file collision scan can never intersect. */
const statusAdrCollisionSchema = z.strictObject({
  number: z.string(),
  branches: z.array(z.string()),
  paths: z.array(z.string()),
});
export type StatusAdrCollision = z.infer<typeof statusAdrCollisionSchema>;

const statusAdrCollisionWireSchema = statusAdrCollisionSchema.omit({
  paths: true,
});

const recentCompletedTaskSchema = z.strictObject({
  branch: z.string(),
  head: z.string().optional(),
  completed_at: z.string(),
  proof_line: z.string().optional(),
});

const parkedTaskSchema = z.strictObject({
  id: z.string(),
  branch: z.string(),
  head: z.string(),
  parked_at: z.string(),
  task: TaskMetadataDataSchema,
});

/** One unlanded effort in the landing queue, as an owner reads it: eligible
 * efforts in landing order, then provisional ones, each with its readiness and
 * the single reason it waits. Status and `accept --dry-run` derive their lists
 * from the same projection so the two surfaces agree. */

/** One path discern removed with a worktree that currently exists again. */
const reappearedWorktreePathSchema = z.strictObject({
  path: z.string(),
  removed_at: z.string(),
  kind: z.enum(["directory", "file", "symlink", "other"]),
  /** Bounded relative names found beneath a recreated directory. */
  contents: z.array(z.string()),
  contents_truncated: z.boolean(),
  entries: z.number().int().nonnegative(),
  /** Present when confirmed prune still must preserve the path. */
  cleanup_blocked_reason: z.string().optional(),
});
/** `status` — the full situation payload. The local-only heavy blocks
 * (`scopes`/`gate`) are present in the local view and omitted when leading
 * with the fleet from main; `fleet` is present only when the survey is included. */
export const StatusDataSchema = z.strictObject({
  emergency_validation: z.array(EmergencyValidationSchema).optional(),
  location: z.enum(LOCATIONS),
  root: z.string(),
  /** Project identity used by the human heading. Optional for same-major wire
   * compatibility with older status producers. */
  project: z.string().optional(),
  worktree: statusWorktreeSchema.nullable(),
  git: statusGitSchema.nullable(),
  scopes: z.array(z.string()).optional(),
  preview_actions: z.array(PreviewActionDataSchema).optional(),
  gate: statusGateSchema.optional(),
  standards: z.array(z.string()),
  gate_proof: GateProofCheckSchema.optional(),
  landed_proof: z.strictObject({
    commit: z.string(),
    /** Committer timestamp for the landed commit, when Git can read it. */
    commit_at: z.string().optional(),
    ref: z.string(),
    proof: ProofSchema,
    acceptance: AcceptanceEvidenceSchema.optional(),
    /** The payload's issuer assertion, when present. This field does not mean
     * the signature or the asserted identity has been verified. */
    issuer: ProofIssuerSchema.optional(),
    /** The durable record's signed-intent reference, when it carries one. */
    brief: z.string().optional(),
  }).optional(),
  /** The trunk tip carries a proof note in a format this binary cannot read
   * (a newer major). Explicit, so a mixed-version clone sees that evidence
   * exists instead of "no proof" (ADR 0242). */
  landed_proof_stale: z.strictObject({
    commit: z.string(),
    ref: z.string(),
    reason: z.string(),
  }).optional(),
  landed_proof_unsupported: z.strictObject({
    commit: z.string(),
    ref: z.string(),
    format: z.string(),
  }).optional(),
  /** The trunk tip landed by emergency exception. It carries no passing
   * Proof; `validation` says whether a later complete run has settled the
   * checks it skipped. */
  landed_exception: z.strictObject({
    commit: z.string(),
    ref: z.string(),
    landing_id: z.string(),
    reason: z.string(),
    exceptions: z.number().int().nonnegative(),
    validation: z.enum(["outstanding", "resolved"]),
  }).optional(),
  landing_authority: LandingAuthorityDataSchema.optional(),
  /** Tracked files the read-only refresh plan would change. This is the
   * complete convergence view. */
  pending_tracked_refresh: z.array(z.string()).optional(),
  /** Read-only refresh transformations that could not be planned. */
  tracked_refresh_plan_errors: z.array(z.string()).optional(),
  tracked_ignored_artifacts: z.array(z.string()).optional(),
  /** Evidence attached to the persisted setup completion event. */
  setup_completion: z.enum(["proven", "unproven"]).optional(),
  setup_unfinished: z.strictObject({
    pending_markers: z.array(z.string()),
    known_jobs: z.array(
      z.strictObject({
        name: z.string(),
        wired: z.boolean(),
        not_applicable: z.literal(true).optional(),
      }),
    ),
    assurance: z.lazy(() => SetupAssuranceSchema).optional(),
  }).optional(),
  /** Local `<branch_prefix>*` branches holding unlanded work with NO worktree —
   * otherwise-invisible abandoned work (main-checkout view only; present when
   * non-empty). A worktree-less ref whose tip is contained in a live branch is
   * NOT abandoned and reports under `contained_refs` instead. */
  unlanded_branches: z.array(z.string()).optional(),
  /** Branch-preserving Park records whose branch still has no checkout. */
  parked_tasks: z.array(parkedTaskSchema).optional(),
  /** Park metadata could not be read, so task wording is unavailable while
   * the underlying unlanded branches remain authoritative. */
  parked_tasks_unavailable: z.strictObject({
    reason: z.string(),
    next_command: z.string(),
  }).optional(),
  /** Worktree-less refs kept deliberately by the contained-worktree reclaim
   * (main-checkout view only; present when non-empty): each tip is a strict
   * ancestor of the named live branch, so the commits ride there until they
   * land and the ref self-cleans through the ordinary prune. Informational —
   * no action needed. */
  contained_refs: z.array(
    z.strictObject({ branch: z.string(), contained_in: z.string() }),
  ).optional(),
  /** The landing queue in order — present when at least one submission
   * awaits landing. The same derivation feeds `accept --dry-run`. */
  queue: z.array(SubmissionRowSchema).optional(),
  /** The calling checkout's most recently started long operation while it
   * is still running: the verb, the effort, the handle that reads it back,
   * and the current-state summary from progress. Absent once it finishes. */
  operation: z.strictObject({
    verb: z.string(),
    branch: z.string().optional(),
    handle: z.string(),
    latest: z.string().optional(),
  }).optional(),
  /** Newest successful task landings from the bounded local Logbook tail. */
  recent_completed_tasks: z.array(recentCompletedTaskSchema).optional(),
  /** Paths removed through discern's worktree lifecycle that currently exist
   * again without a live Git worktree registration. */
  reappeared_worktree_paths: z.array(reappearedWorktreePathSchema).optional(),
  fleet: z.array(statusFleetEntrySchema).optional(),
  /** Cross-worktree changed-file collisions (fleet view; present when
   * non-empty): pairs of fleet branches whose fork diffs touch the same
   * paths. */
  fleet_collisions: z.array(statusFleetCollisionSchema).optional(),
  /** In-flight ADR number collisions (present when non-empty): the fleet view
   * carries every contested number; the local worktree view carries the ones
   * the current branch is party to. */
  adr_collisions: z.array(statusAdrCollisionSchema).optional(),
});
export type StatusData = z.infer<typeof StatusDataSchema>;

/** Which structured status projection crossed the result boundary. */
const StatusProjectionSchema = z.strictObject({
  mode: z.enum(["orientation", "full"]),
  /** True counts for lists omitted from the bounded orientation projection. */
  omitted: z.record(z.string(), z.number().int().positive()).optional(),
});

const StatusConfigIssueDataSchema = ConfigIssueDataSchema.extend({
  projection: StatusProjectionSchema,
});

/** Compact `status`: live state without nested Proof pages. */
export const StatusWireDataSchema = StatusDataSchema.omit({
  gate_proof: true,
  landed_proof: true,
  landing_authority: true,
  fleet: true,
  fleet_collisions: true,
  adr_collisions: true,
}).extend({
  gate_proof: GateProofWireSchema.optional(),
  landed_proof: z.strictObject({
    commit: z.string(),
    commit_at: z.string().optional(),
    ref: z.string(),
    proof: ProofSummarySchema,
    issuer: ProofIssuerSchema.optional(),
    brief: z.string().optional(),
  }).optional(),
  landing_authority: LandingAuthoritySummarySchema.optional(),
  fleet: z.array(statusFleetWireEntrySchema).optional(),
  /** Total non-main worktrees before the orientation sample is capped. */
  fleet_total: z.number().int().nonnegative().optional(),
  fleet_collisions: z.array(statusFleetCollisionWireSchema).optional(),
  adr_collisions: z.array(statusAdrCollisionWireSchema).optional(),
  projection: StatusProjectionSchema,
});
export type StatusWireData = z.infer<typeof StatusWireDataSchema>;

/** Normal status data or a projected config-validation refusal. */
export const StatusResultDataSchema = z.union([
  StatusWireDataSchema,
  StatusConfigIssueDataSchema,
]);
// doctor ────────────────────────────────────────────────────────────────────

/** One doctor check ({@link import("../commands/doctor.ts").Check}). */
export const CheckSchema = z.strictObject({
  name: z.string(),
  status: z.enum(["ok", "warn", "fail"]),
  ok: z.boolean(),
  detail: z.string(),
  fix: z.string().optional(),
  warn: z.boolean().optional(),
});
export type Check = z.infer<typeof CheckSchema>;

/** The runtime-environment summary doctor reports. */
export const DoctorEnvironmentSchema = z.strictObject({
  discern: z.string(),
  platform: z.string(),
  git: z.string().optional(),
  desk_session: z.literal(true).optional(),
});
export type DoctorEnvironment = z.infer<typeof DoctorEnvironmentSchema>;

/**
 * One annotated step in a verb's execution model — what `discern doctor` prints so a
 * user (or their agent) can see exactly what runs, in order, when they call a verb.
 * `kind` is the engine's own {@link STEP_KINDS} vocabulary (derived, not re-listed);
 * `actor` marks whose command it is ({@link ACTORS}); `note` is the command or detail;
 * `hint` is the class-level expectation (idempotent / fast / built-in / …); `condition`
 * is when the step actually fires (a dirty worktree, a changed scope). discern renders
 * the facts and the expectations — it does NOT judge them; a consuming agent draws the
 * conclusions (ADR 0063).
 */
export const ExecutionStepSchema = z.strictObject({
  kind: stepKindEnum,
  label: z.string(),
  actor: z.enum(ACTORS),
  note: z.string().optional(),
  hint: z.string().optional(),
  condition: z.string().optional(),
});
export type ExecutionStep = z.infer<typeof ExecutionStepSchema>;

/** One configurable verb's execution model: its trigger (`when`) and its ordered,
 * annotated {@link ExecutionStep}s. The gate verbs' steps are derived from the real
 * plan builders; the worktree verbs' from an authored conditional model + live config
 * (their plans need runtime worktree state), so neither can drift from reality. */
export const VerbPlanSchema = z.strictObject({
  verb: z.string(),
  when: z.string(),
  steps: z.array(ExecutionStepSchema),
});
export type VerbPlan = z.infer<typeof VerbPlanSchema>;

/** Typed provider trust guidance: prose is separate from literal machine facts. */
export const ProviderTrustDataSchema = z.strictObject({
  provider: z.string(),
  required: z.boolean(),
  explanation: z.string(),
  actions: z.array(z.strictObject({
    kind: z.enum(TRUST_ACTION_KINDS),
    instruction: z.string(),
    facts: z.array(z.strictObject({
      kind: z.enum(TRUST_FACT_KINDS),
      value: z.string(),
    })),
  })),
});

/** `doctor` — the install-verification payload. `execution_model` is the per-verb
 * ordered step list (optional: omitted only when no config can be read at all). */
export const DoctorDataSchema = z.strictObject({
  discern_version: z.string(),
  environment: DoctorEnvironmentSchema,
  checks: z.array(CheckSchema),
  provider_trust: z.array(ProviderTrustDataSchema).optional(),
  execution_model: z.array(VerbPlanSchema).optional(),
});
export type DoctorData = z.infer<typeof DoctorDataSchema>;

// improvement ───────────────────────────────────────────────────────────────

/** A pointer to the project material a subjective review item is judged against. */
const reviewEvidenceSchema = z.strictObject({
  source: z.string(),
  excerpt: z.string(),
});

/** One deterministic rule's evaluated result. Exported so the improvement `RuleStatus`
 * SSOT (an engine type this shared module can't import) is tied to `status` here by a
 * guard in `improve_catalog_test.ts`. */
export const ruleResultSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  status: z.enum(["pass", "partial", "fail"]),
  weight: z.number(),
  detail: z.string(),
  fix: z.string().optional(),
  teach: z.string(),
});

/** One boundary guard on a review's question: a configured checkpoint serving
 * it, so the flow is guarded at the gate while the improvement review audits what already exists. */
const boundaryGuardSchema = z.strictObject({
  checkpoint: z.string(),
  mode: z.enum(CHECKPOINT_MODES),
});

/** One open subjective review item for the agent to judge. */
const reviewResultSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  ask: z.string(),
  teach: z.string(),
  against: reviewEvidenceSchema.optional(),
  boundary: z.array(boundaryGuardSchema).optional(),
});

/** One reviewed category's evaluated result. */
const improvementCategorySchema = z.strictObject({
  name: z.string(),
  title: z.string(),
  score: z.number(),
  weight: z.number(),
  weak: z.number(),
  rules: z.array(ruleResultSchema),
  reviews: z.array(reviewResultSchema),
});

/** The coach's single prioritized next action. Exported so the engine
 * `NEXT_ACTION_KINDS` SSOT (which this shared module can't import) is tied to
 * the `kind` enum by a guard in `improve_catalog_test.ts`. */
export const nextActionSchema = z.strictObject({
  kind: z.enum(["fix", "review", "decide"]),
  category: z.string(),
  id: z.string(),
  title: z.string(),
  action: z.string(),
  why: z.string(),
  against: reviewEvidenceSchema.optional(),
});

/** One evidence-backed owner decision from the checkpoint loop: review a
 * frequently-varied checkpoint, or graduate a recurring finding class into
 * one. `evidence` is required — a recommendation without project-local counts
 * behind it is a generic exhortation the coach never issues. Exported so the
 * engine `CHECKPOINT_RECOMMENDATION_IDS` SSOT is tied to the `id` enum by a
 * guard in `improve_catalog_test.ts`. */
export const checkpointRecommendationSchema = z.strictObject({
  id: z.enum(["checkpoints.review", "checkpoints.graduate"]),
  subject: z.string(),
  title: z.string(),
  action: z.string(),
  why: z.string(),
  evidence: reviewEvidenceSchema,
});

/** `improvement` — baseline health, open reviews, and the prioritized next action. */
export const ImprovementDataSchema = z.strictObject({
  score: z.number(),
  weak: z.number(),
  open_reviews: z.number(),
  next_action: nextActionSchema,
  recommendations: z.array(checkpointRecommendationSchema).optional(),
  categories: z.array(improvementCategorySchema),
  history: z.strictObject({
    findings: z.array(PatternsFindingSchema),
  }),
});
export type ImprovementData = z.infer<typeof ImprovementDataSchema>;

// patterns ─────────────────────────────────────────────────────────────────

/** The `patterns` verb's detector vocabulary and data shapes live in their own
 * dependency-light module (`patterns_vocabulary.ts`) so the logbook subsystem
 * can share them from inside its no-network wall; re-exported here so wire
 * consumers keep one import site. */
export {
  boundedPatternEvidenceCondition,
  DETECTOR_FAMILIES,
  DETECTOR_SCOPES,
  DETECTOR_STATUSES,
  DETECTOR_TIERS,
  PATTERN_EVIDENCE_CONDITION_VALUES_MAX,
  PATTERN_EVIDENCE_VALUE_KINDS,
  PATTERN_INVESTIGATION_OBSERVATIONS_MAX,
  PatternEvidenceBasisSchema,
  PatternEvidenceConditionSchema,
  PatternInvestigationBoundarySchema,
  PatternInvestigationObservationSchema,
  PatternInvestigationSchema,
  PATTERNS_INVESTIGATIONS_MAX,
  PatternsArchiveEntrySchema,
  PatternsArchivesDataSchema,
  PatternsDataSchema,
  PatternsFindingSchema,
  PatternsResetDataSchema,
  PatternsSealDataSchema,
  PatternsStatsSchema,
} from "./patterns_vocabulary.ts";
export {
  CHECKPOINT_ECONOMICS_ROWS_MAX,
  CheckpointEconomicsRowSchema,
  CheckpointEconomicsSchema,
} from "./patterns_vocabulary.ts";
export type {
  CheckpointEconomics,
  CheckpointEconomicsRow,
} from "./patterns_vocabulary.ts";
export type {
  DetectorFamily,
  DetectorScope,
  DetectorStatus,
  DetectorTier,
  PatternEvidenceBasis,
  PatternEvidenceCondition,
  PatternEvidenceValueKind,
  PatternInvestigation,
  PatternInvestigationBoundary,
  PatternInvestigationObservation,
  PatternsArchiveEntry,
  PatternsArchivesData,
  PatternsData,
  PatternsDetector,
  PatternsFinding,
  PatternsResetData,
  PatternsSealData,
  PatternsStats,
} from "./patterns_vocabulary.ts";
import {
  CheckpointEconomicsSchema,
  PatternsArchivesDataSchema,
  PatternsDataSchema,
  PatternsFindingSchema,
  PatternsResetDataSchema,
  PatternsSealDataSchema,
} from "./patterns_vocabulary.ts";

// docs / help ──────────────────────────────────────────────────────────────

/** One recursive command-model node selected by `help --json`. */
export interface HelpCommandData {
  readonly path: string[];
  readonly description: string;
  readonly aliases: string[];
  readonly hidden: boolean;
  readonly args: Array<{
    name: string;
    optional: boolean;
    variadic: boolean;
  }>;
  readonly usage: string;
  readonly options: Array<{
    flags: string[];
    description: string;
    type_definition: string;
    arity: number;
    value_types: string[];
    default_value: unknown;
    hidden: boolean;
    global: boolean;
  }>;
  readonly children: HelpCommandData[];
}

export const HelpCommandDataSchema: z.ZodType<HelpCommandData> = z.lazy(() =>
  z.strictObject({
    path: z.array(z.string()),
    description: z.string(),
    aliases: z.array(z.string()),
    hidden: z.boolean(),
    args: z.array(z.strictObject({
      name: z.string(),
      optional: z.boolean(),
      variadic: z.boolean(),
    })),
    usage: z.string(),
    options: z.array(z.strictObject({
      flags: z.array(z.string()),
      description: z.string(),
      type_definition: z.string(),
      arity: z.number().int().nonnegative(),
      value_types: z.array(z.string()),
      default_value: z.unknown(),
      hidden: z.boolean(),
      global: z.boolean(),
    })),
    children: z.array(HelpCommandDataSchema),
  })
);

/** `help` — the selected live CLI command model. */
export const HelpDataSchema = z.strictObject({
  command: HelpCommandDataSchema,
});

/** One doc's record (no content). Frontmatter values travel as these
 * structured fields — never inside rendered content — and appear only when
 * they say something: `publish` only when false, the rest only when present. */
const docRecordSchema = z.strictObject({
  /** Canonical value accepted by the same documentation verb. */
  target: z.string().optional(),
  path: z.string(),
  section: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  publish: z.boolean().optional(),
  order: z.number().optional(),
  aliases: z.array(z.string()).optional(),
  page_id: z.string().optional(),
  manual_kind: z.enum(MANUAL_KINDS).optional(),
});
export type DocRecord = z.infer<typeof docRecordSchema>;

/** One decision a doc cites: its number, slug, and link destination. */
const adrCitationSchema = z.strictObject({
  number: z.string(),
  slug: z.string(),
  path: z.string(),
});

/** One top-level subtree in the no-argument project-map overview. */
const mapRegionSchema = z.strictObject({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  page_count: z.number(),
  pages_changed_at: z.string().optional(),
  code_changes_since: z.number().optional(),
});

/** One ranked documentation hit. `target` is the canonical value a caller can
 * pass back to the same verb; ranking scores stay private implementation detail. */
const docSearchResultSchema = z.strictObject({
  target: z.string(),
  path: z.string(),
  section: z.string(),
  title: z.string(),
  description: z.string(),
  page_id: z.string().optional(),
  manual_kind: z.enum(MANUAL_KINDS).optional(),
  match: z.enum(["complete", "partial", "metadata"]),
  heading: z.string().optional(),
  snippet: z.string(),
});
export type DocSearchResult = z.infer<typeof docSearchResultSchema>;

/**
 * `map`/`help` — the documentation payload, across every mode: the index
 * (`map_dir`/`count`/`docs`; `help` omits `map_dir`), an empty tree
 * (`count:0`), a single doc (`doc` with content), an ambiguous match
 * (`candidates`), nearest-match instructions for a not-found (`suggestions`), or a
 * ranked search (`query`/`results`, optionally narrowed to `scope`). Modeled as
 * one object with mode-specific optionals.
 */
export const DocsDataSchema = z.strictObject({
  map_dir: z.string().optional(),
  count: z.number().optional(),
  docs: z.array(docRecordSchema).optional(),
  regions: z.array(mapRegionSchema).optional(),
  doc: docRecordSchema.extend({
    /** Canonical value accepted by the same documentation verb to fetch this page. */
    target: z.string(),
    content: z.string(),
    cited_adrs: z.array(adrCitationSchema).optional(),
  }).optional(),
  candidates: z.array(z.string()).optional(),
  suggestions: z.array(docRecordSchema).optional(),
  query: z.string().optional(),
  scope: z.string().optional(),
  results: z.array(docSearchResultSchema).optional(),
  truncated: z.boolean().optional(),
});
export type DocsData = z.infer<typeof DocsDataSchema>;

// setup step ──────────────────────────────────────────────────────────────────

/** Setup routing is always exactly one runnable command, never a shell chain. */
const SetupNextActionCommandSchema = z.string().trim().min(1).refine(
  isSingleRunnableSetupCommand,
  { message: "setup next_action must be one runnable command" },
);

/**
 * The structured **spine** of one setup page (ADR 0078) — navigation and
 * completion-proof rails ONLY. The warm behavioral/consent instructions stay in the
 * prose `instructions` field, never flattened into these terse fields (the two-lane
 * rule: structured fields get summarized and weakened; prose gets followed). The
 * page parser ({@link import("./setup_pages.ts")}) validates each step's authored
 * TOML block against this, so a malformed spine fails loudly rather than serving
 * half a page.
 */
export const SETUP_PAGE_SPINE_COMMON_SHAPE = {
  phase: z.string().trim().min(1),
  stable_target: z.string().trim().min(1),
  intent: z.string().trim().min(1),
  files_to_read: z.array(z.string().trim().min(1)).min(1),
  must_do: z.array(z.string().trim().min(1)).min(1),
  authority_boundaries: z.array(z.string().trim().min(1)).min(1),
  what_not_to_do: z.array(z.string().trim().min(1)).min(1),
  completion_check: z.string().trim().min(1),
  stop_conditions: z.array(z.string().trim().min(1)).min(1),
  recovery: z.array(z.string().trim().min(1)).min(1),
  next_action: SetupNextActionCommandSchema,
} as const;

export const SetupPageSpineSchema = z.strictObject({
  ...SETUP_PAGE_SPINE_COMMON_SHAPE,
  /** Typed routing state derived from the canonical human-moment registry. The
   * complete semantic contract is carried once in `instructions`. */
  owner_moments: z.array(SetupHumanMomentProjectionSchema),
  /** Backward-compatible decision summaries derived from `owner_moments`. */
  human_decisions: z.array(z.string().trim().min(1)),
  /** Backward-compatible relay messages derived from `owner_moments`. */
  relay: z.array(z.string().trim().min(1)).min(1).optional(),
});
export type SetupPageSpine = z.infer<typeof SetupPageSpineSchema>;

/**
 * `setup step` — one numbered setup page: the structured `spine` plus the warm
 * prose `instructions` the agent follows verbatim. Every result representation carries
 * both; terminal and Markdown presentations lead with the prose (ADR 0078).
 */
export const SetupStepDataSchema = z.strictObject({
  step: z.number(),
  title: z.string(),
  spine: SetupPageSpineSchema,
  instructions: z.string(),
  /** The page spine's canonical continuation, repeated at the result boundary so
   * every setup result exposes one directly runnable command. */
  next_action: SetupNextActionCommandSchema,
});
export type SetupStepData = z.infer<typeof SetupStepDataSchema>;

/** Recovery-only setup payload for a result that cannot provide its normal
 * phase-specific data. */
const SetupNextActionOnlyDataSchema = z.strictObject({
  next_action: SetupNextActionCommandSchema,
});

export const SetupStepResultDataSchema = z.union([
  SetupStepDataSchema,
  SetupNextActionOnlyDataSchema,
]);

// setup verify ──────────────────────────────────────────────────────────────────

/**
 * One pre-existing thing `begin` must work around — a heads-up for the human to weigh
 * before scaffolding, never a blocker (`verify` only ever observes). The `kind` is the
 * machine lane; the human-facing reason rides `detail`.
 */
export const SetupVerifyConflictSchema = z.strictObject({
  kind: z.enum([
    "existing_instructions",
    "dirty_worktree",
    "not_a_repo",
    "missing_git_identity",
  ]),
  detail: z.string(),
});
export type SetupVerifyConflict = z.infer<typeof SetupVerifyConflictSchema>;

/**
 * The grounded, read-only findings `verify` reports about THIS repo — the machine lane
 * of the preflight. The consent conversation itself never rides these fields; it stays
 * in the `instructions` prose. A new finding (e.g. a new repo probe) enrolls HERE,
 * so the schema and the real output can't drift (ADR 0041).
 */
export const SetupVerifyFindingsSchema = z.strictObject({
  git: z.strictObject({
    repo: z.boolean(),
    clean: z.boolean(),
    uncommitted: z.number(),
    /** Whether a commit identity (user.name + user.email) resolves here — the
     * precheck that keeps setup's own commits from failing mid-flow. */
    identity: z.boolean(),
  }),
  docs: z.strictObject({
    exists: z.boolean(),
  }),
  existing_instructions: z.array(z.string()),
  agents_detected: z.array(z.string()),
  agents_effective: z.array(z.string()),
  worktree_path: z.string(),
  project_identity: z.strictObject({
    proposed_name: z.string().trim().min(1),
    evidence: z.array(z.strictObject({
      source: z.string().trim().min(1),
      location: z.string().trim().min(1),
      value: z.string().trim().min(1),
    })).min(1),
    fallback_only: z.boolean(),
    requires_confirmation: z.literal(true),
  }),
});
/**
 * `setup verify` — the read-only preflight payload (ADR 0075), two shapes under one
 * schema:
 *   - the FRESH preflight: the structured machine lane (`findings`/`conflicts`/`ready`)
 *     plus the consent `instructions` — the warm prose the agent relays VERBATIM and never
 *     summarizes — and the `next_action` funnel into `begin`;
 *   - the redirect (phase ≠ fresh): just `phase` + `next_action`.
 * The two-lane split mirrors `setup step` (ADR 0078): consent/behavioral instructions
 * stay prose, because agents summarize and weaken the same content when it arrives as
 * structured fields. `phase` mirrors `SetupPhase` (shared/setup_state.ts).
 */
export const SetupVerifyDataSchema = z.strictObject({
  phase: z.enum(["fresh", "in_progress", "done"]),
  next_action: SetupNextActionCommandSchema,
  ready: z.boolean().optional(),
  findings: SetupVerifyFindingsSchema.optional(),
  conflicts: z.array(SetupVerifyConflictSchema).optional(),
  instructions: z.string().optional(),
});
export type SetupVerifyData = z.infer<typeof SetupVerifyDataSchema>;

// setup done ──────────────────────────────────────────────────────────────────

/** One known job's coverage state at completion — mirrors
 * {@link import("./setup_assurance.ts").KnownJobAssurance}. The `state` enum is
 * DERIVED from `KNOWN_JOB_STATES` (the SSOT). `self_supplied` marks a deferred
 * job wired only with discern's own commands (rendered as housekeeping) — an
 * additive optional marker, because the public result contract closes the
 * `state` vocabulary within a schema major (ADR 0208/0220). */
export const KnownJobAssuranceSchema = z.strictObject({
  name: z.string(),
  state: z.enum(KNOWN_JOB_STATES),
  /** An absent job excluded from the applicable denominator. Optional keeps
   * result schema v1 additive for consumers pinned before this marker existed. */
  not_applicable: z.literal(true).optional(),
  reason: z.string().optional(),
  self_supplied: z.literal(true).optional(),
});

/** The rolled-up known-job coverage `setup done` reports — mirrors
 * {@link import("./setup_assurance.ts").SetupAssurance}. */
/** Setup's account of standards, evidence reuse, and coordination; additive. */
export const CompletionAssuranceSchema = z.strictObject({
  standards: z.array(z.string()),
  shared: z.array(z.strictObject({
    producer: z.string(),
    standards: z.array(z.string()),
  })),
  candidate_bound: z.array(z.string()),
  declared: z.array(z.string()),
});

export const SetupAssuranceSchema = z.strictObject({
  known_jobs: z.array(KnownJobAssuranceSchema),
  enforced: z.number(),
  total: z.number(),
  /** Additive counts exposing the full canonical population and its exclusions.
   * `total` remains the verdict denominator for older consumers. */
  known_total: z.number().optional(),
  not_applicable: z.number().optional(),
  verdict: z.enum(ASSURANCE_VERDICTS),
  /** Present when completion derived the standards, reuse, and coordination facts. */
  completion: CompletionAssuranceSchema.optional(),
});

/** The provider-aware reactivation handoff — mirrors `reactivationHandoff()`'s return
 * (`src/lib/providers.ts`): the summary plus one derived step per configured agent that
 * wired something loading at session start, including any human-only setup advice that
 * must precede the fresh session. */
export const ReactivationSchema = z.strictObject({
  summary: z.string(),
  per_agent: z.array(
    z.strictObject({
      agent: z.string(),
      label: z.string(),
      step: z.string(),
      check_kind: z.enum(["mcp", "cli"]),
      check: z.string(),
      recovery: z.string(),
      cli_fallback: z.string(),
      trust: ProviderTrustDataSchema,
    }),
  ),
});

/** Where the finished setup lives and how to land it (the snake_case wire shape of
 * `LandingSummary` plus the exact land command). */
export const SetupDoneLandingSchema = z.strictObject({
  in_repo: z.boolean(),
  branch: z.string(),
  target: z.string(),
  on_target: z.boolean(),
  /** True only on the dedicated `discern-setup` branch — the one branch
   * `setup accept` lands; false steers the agent to a manual merge instead. */
  on_setup_branch: z.boolean(),
  command: z.string(),
});

const SetupCompletionListSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  items: z.array(z.string().trim().min(1)),
}).refine((value) => value.count === value.items.length, {
  message: "count must equal the number of inventory items",
});

/** Qualitative project context plus mechanical counts and lists quoted by setup's
 * closing relay. Every field derives from final authorities after Proof, never
 * agent recollection or arithmetic. */
export const SetupCompletionInventorySchema = z.strictObject({
  project_context: z.strictObject({
    primary_subsystem: z.strictObject({
      region: z.string().trim().min(1),
      page: z.string().trim().min(1),
      title: z.string().trim().min(1),
      start_here: z.string().trim().min(1),
      boundary: z.string().trim().min(1),
      non_obvious_invariant: z.string().trim().min(1),
    }).nullable(),
    principles: SetupCompletionListSchema,
    instruction_sources: z.array(z.string().trim().min(1)),
  }),
  map_regions: SetupCompletionListSchema,
  ledger_items: SetupCompletionListSchema,
  jobs: z.strictObject({
    enforced: z.array(z.string()),
    deferred: z.array(z.string()),
    absent: z.array(z.string()),
    not_applicable: z.array(z.string()),
  }),
});
/** How one successful `setup done` invocation reached the completed state. */
export const SETUP_DONE_SUCCESS_KINDS = [
  "created",
  "replayed",
  "validated",
  "unproven",
] as const;
export type SetupDoneSuccessKind = typeof SETUP_DONE_SUCCESS_KINDS[number];

/**
 * `setup done` — the completion payload (ADR 0065/0078/0086). The structured fields
 * carry assurance, landing, inventory, and phase-appropriate activation facts. The `instructions` prose is
 * the ready-to-relay completion message a courier agent hands its human — carried
 * verbatim in every representation, never flattened into fields (ADR 0086).
 */
const SetupDoneBaseSchema = z.strictObject({
  bootstrapped: z.literal(true),
  /** Whether this invocation created, replayed, validated, or recorded without Proof
   * the marker-bearing completion state. */
  completion: z.enum(SETUP_DONE_SUCCESS_KINDS),
  /** True only when this invocation crossed a write boundary. */
  effects_performed: z.boolean(),
  /** True only when this invocation executed the main-checkout Gate. */
  gate_ran: z.boolean(),
  /** Evidence attached to the persisted setup completion event. */
  setup_completion: z.enum(["proven", "unproven"]),
  unproven: z.boolean(),
  gate_proven: z.boolean(),
  /** Whether the required worktree-viability probe ran green. False only on
   * explicitly unproven completion. */
  worktree_proven: z.boolean(),
  marker_committed: z.boolean(),
  /** The git stderr line explaining a FAILED completion-marker auto-commit
   * (absent when committed, skipped deliberately, or outside git). */
  marker_commit_error: z.string().optional(),
  /** The ready-to-relay one-line rendering from that honored Proof. */
  proof_line: z.string().optional(),
  leftover: z.array(z.string()),
  assurance: SetupAssuranceSchema,
  inventory: SetupCompletionInventorySchema,
  landing: SetupDoneLandingSchema,
  /** Present only when setup is already on the trunk. An unlanded
   * result must lead with landing and must not instruct a premature restart. */
  reactivation: ReactivationSchema.optional(),
  /** Optional ongoing work, available only after activation succeeds. */
  optional_improvement: z.strictObject({
    verb: z.string(),
    command: z.string(),
    after: z.literal("activation_verified"),
  }).optional(),
  instructions: z.string(),
  /** The first phase-correct command after this result. */
  next_action: SetupNextActionCommandSchema,
}).superRefine((data, context) => {
  const activationEligible = data.gate_proven && !data.unproven &&
    (!data.landing.in_repo || data.landing.on_target);
  if ((data.setup_completion === "unproven") !== data.unproven) {
    context.addIssue({
      code: "custom",
      path: ["unproven"],
      message: "unproven must match setup_completion",
    });
  }
  if (!activationEligible && data.reactivation !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["reactivation"],
      message:
        "reactivation is available only after proved setup reaches the trunk",
    });
  }
  if (!activationEligible && data.optional_improvement !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["optional_improvement"],
      message:
        "improvement is available only after proved setup reaches the trunk",
    });
  }
  if (
    data.optional_improvement !== undefined && data.reactivation === undefined
  ) {
    context.addIssue({
      code: "custom",
      path: ["optional_improvement"],
      message: "improvement requires the preceding activation handoff",
    });
  }
});
/** In-process completion retains the complete current marker inspection. */
export const SetupDoneDataSchema = SetupDoneBaseSchema.safeExtend({
  proof: GateProofCheckSchema.optional(),
});
export type SetupDoneData = z.infer<typeof SetupDoneDataSchema>;

/** Setup-completion transaction stages named by structured refusal payloads. */
export const SETUP_DONE_COMPLETION_STAGES = [
  "marker_commit",
  "refresh",
  "doctor",
  "worktree_probe",
  "done",
  "proof",
] as const;
export type SetupDoneCompletionStage =
  (typeof SETUP_DONE_COMPLETION_STAGES)[number];

const SetupDoneIncompleteDataSchema = z.strictObject({
  next_action: SetupNextActionCommandSchema,
  leftover: z.array(z.string()),
  unmet: z.array(z.strictObject({
    step: z.number().int(),
    name: z.string(),
    describe: z.string(),
    passed: z.boolean(),
  })),
});

const SetupDoneUncommittedDataSchema = z.strictObject({
  next_action: SetupNextActionCommandSchema,
  uncommitted: z.array(z.string()),
  stage: z.enum(["refresh", "final_tree"]).optional(),
});

const SetupDoneGateFailureDataSchema = z.strictObject({
  stage: z.enum(SETUP_DONE_COMPLETION_STAGES),
  /** What happened to the exact marker commit this invocation owned. */
  rollback: z.enum([
    "not_needed",
    "owned_commit_removed",
    "retained",
  ]),
  /** A concise description of the state left on disk and in Git. */
  state: z.string().trim().min(1),
  /** The one supported next command or edit boundary. */
  next_action: SetupNextActionCommandSchema,
  /** Self-contained recovery that never requires raw ref movement or broad cleanup. */
  recovery: z.string().trim().min(1),
});

/** Every structured refusal payload emitted by `setup done`. */
export const SetupDoneFailureDataSchema = z.union([
  SetupDoneIncompleteDataSchema,
  SetupDoneUncommittedDataSchema,
  SetupDoneGateFailureDataSchema,
  SetupNextActionOnlyDataSchema,
]);
export type SetupDoneFailureData = z.infer<
  typeof SetupDoneFailureDataSchema
>;

// CLI-only installer/configuration result payloads ────────────────────────────

const setupProjectSchema = z.strictObject({
  slug: z.string(),
  agents: z.array(z.string()),
});

const setupProgressSchema = z.strictObject({
  pending_markers: z.array(z.string()),
  known_jobs: z.array(
    z.strictObject({
      name: z.string(),
      wired: z.boolean(),
      not_applicable: z.literal(true).optional(),
    }),
  ),
  assurance: z.lazy(() => SetupAssuranceSchema).optional(),
});

/**
 * Required instruction-compilation postcondition shared by setup and upgrade.
 * An empty `compiled` list is unambiguous: `complete` means every artifact was
 * already current; `partial` carries non-empty failures plus safe-rerun facts.
 */
export const InstructionRefreshDataSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("complete"),
    compiled: z.array(z.string()),
  }),
  z.strictObject({
    status: z.literal("partial"),
    compiled: z.array(z.string()),
    failures: z.array(z.strictObject({
      kind: z.literal("artifact"),
      evidence: z.string().trim().min(1),
    })).min(1),
    effects_preserved: z.literal(true),
    recovery: z.strictObject({
      command: z.literal("discern refresh"),
      safe_to_retry: z.literal(true),
    }),
  }),
]);
export type InstructionRefreshData = z.infer<
  typeof InstructionRefreshDataSchema
>;

/** Build the one discriminated refresh fact from typed apply outcomes. */
export function instructionRefreshData(
  compiled: readonly string[],
  errors: readonly string[],
): InstructionRefreshData {
  const failures = errors.flatMap((error) => {
    const evidence = error.trim();
    return evidence === "" ? [] : [{ kind: "artifact" as const, evidence }];
  });
  return failures.length === 0
    ? { status: "complete", compiled: [...compiled] }
    : {
      status: "partial",
      compiled: [...compiled],
      failures,
      effects_preserved: true,
      recovery: { command: "discern refresh", safe_to_retry: true },
    };
}

/** `setup` — the read-only welcome and its current setup phase. */
export const SetupWelcomeDataSchema = z.strictObject({
  phase: z.enum(["fresh", "in_progress", "done"]),
  complete: z.boolean(),
  setup_completion: z.enum(["proven", "unproven"]).optional(),
  next_action: SetupNextActionCommandSchema,
  agent_instructions: z.string().optional(),
  human_framing: z.string().optional(),
  progress: setupProgressSchema.optional(),
});

/** `setup begin` — the scaffold preview, outcome, or structured refusal. */
export const SetupBeginDataSchema = z.strictObject({
  complete: z.boolean().optional(),
  next_action: SetupNextActionCommandSchema,
  already_set_up: z.boolean().optional(),
  message: z.string().optional(),
  project: setupProjectSchema.optional(),
  config_fills: z.strictObject({
    filled: z.array(z.string()),
    skipped: z.array(z.string()),
  }).optional(),
  plan: z.array(
    z.strictObject({
      path: z.string(),
      action: z.enum(["create", "skip", "merge", "append", "remove"]),
      note: z.string().optional(),
    }),
  ).optional(),
  command: z.string().optional(),
  bootstrapped: z.boolean().optional(),
  branch: z.string().nullable().optional(),
  machinery_committed: z.boolean().optional(),
  /** The git stderr line explaining a FAILED machinery auto-commit (absent when
   * committed, or when the skip was deliberate). */
  machinery_commit_error: z.string().optional(),
  discern_version: z.string().optional(),
  written: z.array(z.string()).optional(),
  instruction_refresh: InstructionRefreshDataSchema.optional(),
  mcp_wired: z.array(z.string()).optional(),
  hooks_wired: z.array(z.string()).optional(),
  worktree_app_wired: z.array(z.string()).optional(),
  project_rules_wired: z.array(z.string()).optional(),
  skeletons: z.array(z.string()).optional(),
  skipped: z.array(z.string()).optional(),
  instructions: z.string().optional(),
  /** Ready-to-relay progress message derived from the setup human-moment authority. */
  human_relay: z.string().optional(),
  page: SetupStepDataSchema.nullable().optional(),
  changes: z.array(z.string()).optional(),
});
export type SetupBeginData = z.infer<typeof SetupBeginDataSchema>;

/** `setup accept` landing preview/result. Proof refusals carry the same payload
 * with `landed: false`, so every surface can report the failed evidence state. */
export const SetupAcceptDataSchema = z.strictObject({
  next_action: SetupNextActionCommandSchema,
  landed: z.boolean(),
  branch: z.string(),
  target: z.string(),
  fast_forward: z.boolean(),
  branch_deleted: z.boolean(),
  /** Canonical inspection used at the setup landing boundary. */
  proof: GateProofCheckSchema,
  /** Ready-to-relay line from the Proof that names the landed commit. */
  proof_line: z.string().optional(),
  /** Full commit object id pinned by Proof and used by the target transition. */
  validated_commit: z.string().optional(),
  /** True when a moved target was merged into setup and the merge commit earned
   * its own canonical Proof before landing. */
  merge_validated: z.boolean(),
  /** Durable landed-Proof record, present after the target transition. */
  proof_note: AcceptProofNoteSchema.optional(),
  /** Whether ignored checkout-local agent artifacts were materialized before
   * the target moved. */
  local_artifacts_converged: z.boolean(),
  local_artifact_errors: z.array(z.string()).optional(),
  tracked_refresh_pending: z.array(z.string()).optional(),
  tracked_refresh_errors: z.array(z.string()).optional(),
  /** Whether the surviving checkout's worktree-local Gate Proof cache was
   * retired after its durable Proof note was written. */
  proof_cleared: z.boolean().optional(),
  proof_clear_error: z.string().optional(),
  /** Provider-specific fresh-session checks printed only after a successful land. */
  reactivation: ReactivationSchema.optional(),
  /** Why the fresh session is required, derived from the setup human-moment authority. */
  activation_context: z.string().trim().min(1).optional(),
  optional_improvement: z.strictObject({
    command: z.string(),
    after: z.literal("activation_verified"),
  }).optional(),
});
export type SetupAcceptData = z.infer<typeof SetupAcceptDataSchema>;

/** A successful setup-acceptance no-op. The reason is explicit because an
 * absent landing payload cannot distinguish idempotence from an omitted
 * required landing outcome. */
export const SetupAcceptNoOpDataSchema = z.strictObject({
  next_action: SetupNextActionCommandSchema,
  completion: z.strictObject({
    status: z.literal("no_op"),
    reason: z.enum(["no_git_repository", "already_on_target"]),
  }),
  target: z.string(),
});
export type SetupAcceptNoOpData = z.infer<typeof SetupAcceptNoOpDataSchema>;

const configEditSchema = z.strictObject({
  key: z.string(),
  literal: z.string().nullable().describe(
    "TOML value to set, or null to delete this key.",
  ),
});

const configEditDataSchema = z.strictObject({
  operation: z.literal("edit"),
  file: z.string(),
  edits: z.array(configEditSchema),
});

const configScalarDataSchema = z.strictObject({
  operation: z.literal("get"),
  key: z.string(),
  value: z.string(),
});

const configArrayDataSchema = z.strictObject({
  operation: z.enum(["array", "subsections", "keys"]),
  key: z.string(),
  values: z.array(z.string()),
});

const configHasDataSchema = z.strictObject({
  operation: z.literal("has"),
  key: z.string(),
  present: z.boolean(),
});

/**
 * `config` — a discriminated union over edits, all shell-friendly reads, and
 * the explanation. Human reads keep their bare output; `--json` projects the
 * same fact into one typed envelope.
 */
export const ConfigDataSchema = z.discriminatedUnion("operation", [
  configEditDataSchema,
  configScalarDataSchema,
  configArrayDataSchema,
  configHasDataSchema,
  configExplainDataSchema,
]);
export type ConfigData = z.infer<typeof ConfigDataSchema>;

const thirdPartyComponentSchema = z.strictObject({
  name: z.string(),
  version: z.string(),
  registry: z.string(),
  license: z.string(),
});

const firstPartyLegalDocumentSchema = z.strictObject({
  key: z.string(),
  kind: z.enum(FIRST_PARTY_LEGAL_DOCUMENT_KINDS),
  identifier: z.string(),
  title: z.string(),
  path: z.string(),
  text: z.string(),
});

/** `licenses` — first-party documents and bundled components. */
export const LicensesDataSchema = z.strictObject({
  documents: z.array(firstPartyLegalDocumentSchema),
  components: z.array(thirdPartyComponentSchema),
});
export type LicensesData = z.infer<typeof LicensesDataSchema>;

/** Data carried by the hidden `triangle` verb. */
export const TriangleDataSchema = z.strictObject({
  mark: z.string(),
  art: z.string(),
});
export type TriangleData = z.infer<typeof TriangleDataSchema>;

const projectScriptSchema = z.strictObject({
  name: z.string(),
  description: z.string().optional(),
});

/** Bare `scripts` — the discoverable project-script listing. */
export const ScriptsDataSchema = z.strictObject({
  scripts: z.array(projectScriptSchema),
  directory: z.string(),
});
export type ScriptsData = z.infer<typeof ScriptsDataSchema>;

const identityFieldDataSchema = z.strictObject({
  kind: z.literal("field"),
  field: z.enum(WORKTREE_FIELDS),
  value: z.string(),
});

const identityResourceDataSchema = z.strictObject({
  kind: z.literal("resource"),
  name: z.string(),
  value: z.string(),
});

const identityResourcesDataSchema = z.strictObject({
  kind: z.literal("resources"),
  resources: z.record(z.string(), z.string()),
});

/** `identity` — one selected identity value or the declared resource map. */
export const IdentityDataSchema = z.discriminatedUnion("kind", [
  identityFieldDataSchema,
  identityResourceDataSchema,
  identityResourcesDataSchema,
]);
export type IdentityData = z.infer<typeof IdentityDataSchema>;

const migrationStepSchema = z.strictObject({
  from: z.number(),
  to: z.number(),
  describe: z.string(),
});

const configReconcileOperationSchema = z.strictObject({
  kind: z.enum(CONFIG_RECONCILE_OPERATION_KINDS),
  path: z.string(),
});

const gitignoreReconcileOperationSchema = z.strictObject({
  kind: z.enum(["create-block", "replace-block"]),
  path: z.string(),
});

const gitattributesReconcileOperationSchema = z.strictObject({
  kind: z.enum(["create-block", "replace-block", "remove-block"]),
  path: z.string(),
});

const refusedGitattributesPatternSchema = z.strictObject({
  group: z.string(),
  pattern: z.string(),
  reason: z.string(),
});

const upgradeSchemaSnapshotSchema = z.strictObject({
  recorded: z.number().optional(),
  from: z.number().optional(),
  current: z.number(),
});

/** `upgrade` — read-only checks, dry-runs, apply summaries, and refusal details. */
export const UpgradeDataSchema = z.strictObject({
  check: z.boolean().optional(),
  schema: upgradeSchemaSnapshotSchema.optional(),
  pending_migrations: z.array(migrationStepSchema).optional(),
  pending_reconciliation: z.array(configReconcileOperationSchema).optional(),
  config_template_available: z.boolean().optional(),
  pending_gitignore_reconciliation: z.array(gitignoreReconcileOperationSchema)
    .optional(),
  gitignore_template_available: z.boolean().optional(),
  pending_gitattributes_reconciliation: z.array(
    gitattributesReconcileOperationSchema,
  ).optional(),
  untranslated_gitattributes_patterns: z.array(
    refusedGitattributesPatternSchema,
  ).optional(),
  changes: z.array(z.string()).optional(),
  /** Completion records written by a newer discern than this build. */
  newer_records: z.array(z.string()).optional(),
  issues: z.array(ConfigIssueSchema).optional(),
  discern_version: z.string().optional(),
  migrations_applied: z.array(migrationStepSchema).optional(),
  config_reconciled: z.array(configReconcileOperationSchema).optional(),
  gitignore_reconciled: z.array(gitignoreReconcileOperationSchema).optional(),
  gitattributes_reconciled: z.array(gitattributesReconcileOperationSchema)
    .optional(),
  skills: z.strictObject({
    copied: z.number(),
    linked: z.number(),
    pruned: z.number(),
  }).nullable().optional(),
  mcp_wired: z.array(z.string()).optional(),
  hooks_wired: z.array(z.string()).optional(),
  worktree_app_wired: z.array(z.string()).optional(),
  project_rules_wired: z.array(z.string()).optional(),
  instruction_refresh: InstructionRefreshDataSchema.optional(),
});
export type UpgradeData = z.infer<typeof UpgradeDataSchema>;

/** `uninstall` data: the removal plan/outcome (removed files, stripped co-owned
 * files, kept user content, and the binary-removal hint), or the active
 * worktrees on a refusal. All optional so the same shape covers a plan, an
 * applied run, and a refusal. */
export const UninstallDataSchema = z.strictObject({
  removed: z.array(z.string()).optional(),
  /** Absolute `discern/` runtime-state dirs removed from Git's admin area. */
  removed_runtime_state: z.array(z.string()).optional(),
  stripped: z.array(z.string()).optional(),
  kept: z.array(z.string()).optional(),
  binary_hint: z.string().optional(),
  worktrees: z.array(z.string()).optional(),
  /** Ledger-recorded resources blocking an uninstall (`provisioned_resources`). */
  resources: z.array(z.string()).optional(),
  /** Whether the bundled templates needed for exact co-owned-file stripping resolved. */
  templates_available: z.boolean().optional(),
  /** Co-owned files that may retain template-seeded entries, with the reason. */
  incomplete_strips: z.array(z.strictObject({
    rel: z.string(),
    reason: z.string(),
  })).optional(),
  /** Positively-owned clone-local Git-config entries removed by this plan. */
  removed_git_config: z.array(z.string()).optional(),
  /** Git-config entries retained because project-owned state still needs them. */
  kept_git_config: z.array(z.string()).optional(),
  /** Private local refs uninstall deliberately leaves byte-for-byte untouched. */
  retained_refs: z.array(z.string()).optional(),
  /** Exact opt-in commands for deleting each retained private ref. */
  optional_cleanup: z.array(z.string()).optional(),
  /** Git-config/ref discovery failures that block an uninstall. */
  git_config_errors: z.array(z.string()).optional(),
});
export type UninstallData = z.infer<typeof UninstallDataSchema>;

const skillListingSchema = z.strictObject({
  name: z.string(),
  source: z.enum(["authored", "bundled"]),
  // True when this authored skill shadows a bundled built-in.
  overrides_bundled: z.boolean(),
  // True when a bundled built-in of this name exists (shadowed or not).
  has_bundled: z.boolean(),
  // True when `[skills].exclude` drops this skill from materialization.
  excluded: z.boolean(),
});

/** A listing row for `discern skills list` — inferred from the schema so the
 * row builder (`listSkills` in `src/lib/skills.ts`) and the published contract
 * are one shape: a field on either side the other doesn't model is a COMPILE
 * error. */
export type SkillListing = z.infer<typeof skillListingSchema>;

const skillMaterializeSchema = z.strictObject({
  copied: z.number(),
  linked: z.number(),
  pruned: z.number(),
  errors: z.array(z.string()),
});

/** `skills list` — the effective built-in/authored skill set. */
export const SkillsListDataSchema = z.strictObject({
  skills: z.array(skillListingSchema),
});
export type SkillsListData = z.infer<typeof SkillsListDataSchema>;

/** `skills eject` — where a bundled skill was copied and how materialization went. */
export const SkillsEjectDataSchema = z.strictObject({
  name: z.string(),
  dest_abs: z.string(),
  dest_rel: z.string(),
  skills_dir_persisted: z.boolean(),
  materialized: skillMaterializeSchema,
});
export type SkillsEjectData = z.infer<typeof SkillsEjectDataSchema>;

// ── per-verb output schemas (the envelope with `data` narrowed) ──────────────
// Advertised by the MCP server as each tool's `outputSchema`; the SDK validates a
// call's `structuredContent` against `<schema>.shape`. The data-less verbs use the
// bare {@link EnvelopeSchema}.

/** `setup` output: envelope + the read-only welcome or boundary-recovery data. */
export const SetupOutputSchema = resultOutputSchema(
  "setup",
  z.union([SetupWelcomeDataSchema, SetupNextActionOnlyDataSchema]),
);

/** `setup begin` output: envelope + scaffold preview/outcome `data`. */
export const SetupBeginOutputSchema = resultOutputSchema(
  "setup begin",
  SetupBeginDataSchema,
);

/** `done` output: envelope + the gate's `data`. */
export const FinishOutputSchema = resultOutputSchema(
  "done",
  GateWireDataSchema,
);

/** `prepare` output: producer executions and explicit measurement-free feedback. */
export const PrepareOutputSchema = resultOutputSchema(
  "prepare",
  StandaloneValidationDataSchema,
);

/** `test` output: declared producer executions and already-supplied readings, without Proof. */
export const TestOutputSchema = resultOutputSchema(
  "test",
  StandaloneValidationDataSchema,
);

/** `await` output: envelope + the observed-condition `data`. */
export const AwaitOutputSchema = resultOutputSchema("await", AwaitDataSchema);

/** `standards` output: envelope + the per-standard readings, and — on a `--pin`
 * that tightened limits — the applied pins. */
export const StandardsOutputSchema = resultOutputSchema(
  "standards",
  StandardsDataSchema,
);

/** `standards propose` output: the exact proposal transaction or refusal. */
export const StandardsProposeOutputSchema = resultOutputSchema(
  "standards propose",
  StandardsDataSchema,
);

/** `refresh` output: envelope + the generated-artifact summary `data`. */
export const RefreshOutputSchema = resultOutputSchema(
  "refresh",
  RefreshDataSchema,
);

/** `tidy` output: plan/steps only (except top-level config parse errors). */
export const TidyOutputSchema = datalessResultOutputSchema("tidy");

/** `status` output: envelope + the situation `data`. */
export const StatusOutputSchema = exactDataResultOutputSchema(
  "status",
  StatusResultDataSchema,
);

/** `doctor` output: envelope + the install-check `data`. */
export const DoctorOutputSchema = resultOutputSchema(
  "doctor",
  DoctorDataSchema,
);

/** `impact` output: envelope + the scope-list `data`. */
export const ImpactOutputSchema = resultOutputSchema(
  "impact",
  ScopesDataSchema,
);

/** `coupling` output: envelope + the co-change `data`. */
export const CouplingOutputSchema = resultOutputSchema(
  "coupling",
  CouplingDataSchema,
);

/** `patterns` output: envelope + the logbook-reader `data`. */
export const PatternsOutputSchema = resultOutputSchema(
  "patterns",
  PatternsDataSchema,
);

/** `patterns reset` output: envelope + the deletion `data`. CLI-only; the
 * owner-confirmed lifecycle action stays off the MCP surface. */
export const PatternsResetOutputSchema = resultOutputSchema(
  "patterns reset",
  PatternsResetDataSchema,
);

/** `patterns seal` output: envelope + the sealed destination and source. */
export const PatternsSealOutputSchema = resultOutputSchema(
  "patterns seal",
  PatternsSealDataSchema,
);

/** `patterns archives` output: envelope + the discoverable sealed files. */
export const PatternsArchivesOutputSchema = resultOutputSchema(
  "patterns archives",
  PatternsArchivesDataSchema,
);

/** `start` output: envelope + the new-worktree `data`. */
export const StartOutputSchema = resultOutputSchema("start", StartDataSchema);

/** `worktree rename` output: envelope + the changed task projection. */
export const TaskRenameOutputSchema = resultOutputSchema(
  "worktree rename",
  TaskRenameDataSchema,
);

/** Submission records a revision and observes authority; it starts no landing. */
export const SubmitDataSchema = SubmissionRevisionSchema.extend({
  state: z.enum(["planned", "queued"]),
  authority: LandingAuthorityDataSchema,
  replaces: z.string().optional(),
  submission_id: z.string().optional(),
  submitted_at: z.string().optional(),
});
export type SubmitData = z.infer<typeof SubmitDataSchema>;
export const SubmitOutputSchema = resultOutputSchema(
  "submit",
  SubmitDataSchema,
);

/** `accept` output: the reviewed revision on a preview and landing evidence on apply. */
export const AcceptOutputSchema = resultOutputSchema(
  "accept",
  AcceptWireDataSchema,
);

/** `update` output: envelope + the "what landed beneath the branch" `data`. */
export const UpdateOutputSchema = resultOutputSchema(
  "update",
  UpdateDataSchema,
);

/** `improvement` output: envelope + the coaching `data`. */
export const ImprovementOutputSchema = resultOutputSchema(
  "improvement",
  ImprovementDataSchema,
);

/** `checkpoints` output: envelope + the checkpoint report `data`. */
export const CheckpointsOutputSchema = resultOutputSchema(
  "checkpoints",
  CheckpointsDataSchema,
);

/** Engine-observed producer lifecycle; unit counts never determine a verdict. */
export const PRODUCER_WORK_STATES = [
  "running",
  "passed",
  "failed",
  "cancelled",
] as const;

/** One producer's own reported work, as a reconnect reading retains it. */
export const ProgressWorkSchema = z.object({
  producer: z.string(),
  /** Engine-observed state; an absent state is unknown, including older records. */
  state: z.enum(PRODUCER_WORK_STATES).optional(),
  units: z.object({
    kind: z.string(),
    completed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().nullable(),
  }).optional(),
  results: z.object({
    passed: z.number().int().nonnegative().optional(),
    failed: z.number().int().nonnegative().optional(),
    skipped: z.number().int().nonnegative().optional(),
  }).optional(),
  active: z.array(z.string()).readonly().optional(),
  elapsed_ms: z.number().int().nonnegative().optional(),
  partial: z.boolean().optional(),
  output_path: z.string().optional(),
});

export type ProgressWork = z.infer<typeof ProgressWorkSchema>;

/** A wait ends independently of other work in the same operation. */
export const PROGRESS_WAIT_STATES = [
  "waiting",
  "resumed",
  "unmet",
  "cancelled",
  "failed",
  "unavailable",
] as const;

/** Persisted observation, never a lock, queue position, or completion authority. */
export const ProgressWaitSchema = z.object({
  id: z.string(),
  kind: z.string(),
  state: z.enum(PROGRESS_WAIT_STATES),
  reason: z.string(),
  next: z.string(),
  started_at: z.number(),
  updated_at: z.number(),
  elapsed_ms: z.number().nonnegative(),
  finished_at: z.number().optional(),
  capacity: z.object({
    in_use: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  }).optional(),
  condition: AwaitDataSchema.pick({
    condition: true,
    branch: true,
    trunk: true,
    observed: true,
    timeout_s: true,
    resume: true,
  }).optional(),
});
export type ProgressWait = z.infer<typeof ProgressWaitSchema>;

/** One failure a producer established while it was still running. */
export const ProgressFailureSchema = z.object({
  producer: z.string(),
  name: z.string(),
  message: z.string(),
  file: z.string().optional(),
  line: z.number().int().nonnegative().optional(),
  reproduce_cmd: z.string().optional(),
  partial: z.boolean(),
});

/** The latest progress fact, exactly as live observers received it. */
export const ProgressFactSchema = z.object({
  phase: z.enum(["producer", "queue", "pending", "operation"]),
  state: z.string(),
  candidate_id: z.string().nullable(),
  reason: z.string(),
  operation_handle: z.string().optional(),
  next: z.string().optional(),
  owner_must_act: z.boolean().optional(),
  work: ProgressWorkSchema.optional(),
  attempt_id: z.string().optional(),
});

/** One named timing boundary; each category is its own recorded fact. */
export const ProgressTimingSchema = z.object({
  category: z.string(),
  interval_id: z.string(),
  started_at: z.number(),
  finished_at: z.number(),
});

/** `progress` data: one journalled long operation read back. */
export const ProgressDataSchema = z.object({
  handle: z.string(),
  /** Complete journal facts, including omitted telemetry and the retained result. */
  record_path: z.string().optional(),
  operation: z.object({
    verb: z.string(),
    path: z.string(),
    branch: z.string().optional(),
    started_at: z.number(),
    finished_at: z.number().optional(),
  }),
  executor: z.enum(["running", "gone", "unknown"]),
  executor_reason: z.string().optional(),
  observed_at: z.number().optional(),
  last_activity_at: z.number().optional(),
  waits: z.array(ProgressWaitSchema).optional(),
  outcome: z.enum(["completed", "failed", "cancelled"]).optional(),
  progress: ProgressFactSchema.optional(),
  producers: z.array(ProgressWorkSchema).optional(),
  failures: z.array(ProgressFailureSchema).optional(),
  timings: z.array(ProgressTimingSchema).optional(),
  result: z.unknown().optional(),
  result_truncated: z.boolean().optional(),
  result_path: z.string().optional(),
  /** Why only a reduced account of an oversized result could be kept. */
  result_retention_error: z.string().optional(),
  /** The composed sentences every surface presents, in order. */
  account: z.array(z.string()),
});

/** `progress` output: envelope + the reconnect reading `data`. */
export const ProgressOutputSchema = resultOutputSchema(
  "progress",
  ProgressDataSchema,
);

/** `map` output: envelope + the project-map `data`. */
export const MapOutputSchema = resultOutputSchema("map", DocsDataSchema);

/** `docs` output: envelope + the bundled documentation `data`. */
export const DocsOutputSchema = resultOutputSchema("docs", DocsDataSchema);

/** `help` output: envelope + the selected typed command-model node. */
export const HelpOutputSchema = resultOutputSchema("help", HelpDataSchema);

/** `setup step` output: envelope + the structured page `data`. CLI-only (setup is
 * not an MCP tool), but modeled here so the page parser validates against one
 * source and a faithfulness test can pin the real serialized output to it. */
export const SetupStepOutputSchema = resultOutputSchema(
  "setup step",
  SetupStepResultDataSchema,
);

/** `setup verify` output: envelope + the preflight `data` (fresh or redirect). CLI-only
 * (setup is not an MCP tool), modeled here so a faithfulness test can pin the real
 * serialized output — including the consent `instructions` — to one source (ADR 0041). */
export const SetupVerifyOutputSchema = resultOutputSchema(
  "setup verify",
  SetupVerifyDataSchema,
);

/** `setup done` output: envelope + completion or structured refusal `data`.
 * CLI-only (setup is not an MCP tool), but every emitted alternative is modeled
 * here so tests and published consumers validate against one source (ADR 0041). */
export const SetupDoneOutputSchema = resultOutputSchema(
  "setup done",
  z.union([
    SetupDoneBaseSchema.safeExtend({ proof: GateProofWireSchema.optional() }),
    SetupDoneFailureDataSchema,
  ]),
);

/** `setup accept` output: envelope + the landing preview/result `data`. */
export const SetupAcceptOutputSchema = resultOutputSchema(
  "setup accept",
  z.union([
    SetupAcceptDataSchema.extend({ proof: GateProofWireSchema }),
    SetupAcceptNoOpDataSchema,
    SetupNextActionOnlyDataSchema,
  ]),
);

/** `config` output: envelope + applied/planned TOML edits. */
export const ConfigOutputSchema = resultOutputSchema(
  "config",
  ConfigDataSchema,
);

/** `licenses` output: envelope + first-party documents and component inventory. */
export const LicensesOutputSchema = resultOutputSchema(
  "licenses",
  LicensesDataSchema,
);

/** Output contract for the hidden `triangle` verb. */
export const TriangleOutputSchema = resultOutputSchema(
  "triangle",
  TriangleDataSchema,
);

/** Bare `scripts` output: envelope + executable Project Script listing. */
export const ScriptsOutputSchema = resultOutputSchema(
  "scripts",
  ScriptsDataSchema,
);

/** `identity` output: envelope + a structured field/resource projection. */
export const IdentityOutputSchema = resultOutputSchema(
  "identity",
  IdentityDataSchema,
);

/** `desk --json` is a controlled refusal and carries no data. */
export const DeskOutputSchema = datalessResultOutputSchema("desk");

/** `enter --json` is a controlled refusal and carries no data. */
export const EnterOutputSchema = datalessResultOutputSchema("enter");

/** Bare `discern --json` is a controlled command-required refusal. */
export const DiscernOutputSchema = datalessResultOutputSchema("discern");

/** A bare `worktree --json` is a controlled subcommand-required refusal. */
export const WorktreeOutputSchema = datalessResultOutputSchema("worktree");

/** `worktree ensure --json` is a pure envelope; context travels as hints. */
export const WorktreeEnsureOutputSchema = datalessResultOutputSchema(
  "worktree ensure",
);

/** A bare `skills --json` is a controlled subcommand-required refusal. */
export const SkillsOutputSchema = datalessResultOutputSchema("skills");

/** `upgrade` output: envelope + migration/reconciliation summary data. */
export const UpgradeOutputSchema = resultOutputSchema(
  "upgrade",
  UpgradeDataSchema,
);

/** `uninstall` output: envelope + the removal plan/outcome data. */
export const UninstallOutputSchema = resultOutputSchema(
  "uninstall",
  UninstallDataSchema,
);

/** `worktree setup` output: envelope only (except top-level config parse errors). */
export const WorktreeSetupOutputSchema = datalessResultOutputSchema(
  "worktree setup",
);

/** `worktree teardown` output: envelope only (except top-level config parse errors). */
export const WorktreeTeardownOutputSchema = datalessResultOutputSchema(
  "worktree teardown",
);

/** `worktree drop` output: envelope only (except top-level config parse errors). */
export const WorktreeDropOutputSchema = datalessResultOutputSchema(
  "worktree drop",
);

/** `worktree park` output: envelope only (except top-level config parse errors). */
export const WorktreeParkOutputSchema = datalessResultOutputSchema(
  "worktree park",
);

/** `worktree prune` output: envelope only (except top-level config parse errors). */
export const WorktreePruneOutputSchema = datalessResultOutputSchema(
  "worktree prune",
);

/** `skills list` output: envelope + effective skill listing data. */
export const SkillsListOutputSchema = resultOutputSchema(
  "skills list",
  SkillsListDataSchema,
);

/** `skills eject` output: envelope + ejection/materialization data. */
export const SkillsEjectOutputSchema = resultOutputSchema(
  "skills eject",
  SkillsEjectDataSchema,
);
