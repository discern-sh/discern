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
 * MCP analog of the gate's guidance-currency check.
 *
 * Layer note: this is a `shared/` module — it depends only on `result.ts`, the
 * feature SSOT (`features.ts`), and Zod, never on `src/engine/**`, so the engine
 * cores import their data types FROM here (engine → shared), never the reverse.
 */

import { z } from "@zod/zod";
import { type Feature, FEATURES } from "./features.ts";
import {
  ACTORS,
  DIAGNOSTIC_SEVERITIES,
  FAILED_STAGES,
  STEP_DISPOSITIONS,
  STEP_KINDS,
  STEP_OUTCOMES,
} from "./result.ts";
import { ASSURANCE_VERDICTS, CAPABILITY_STATES } from "./setup_assurance.ts";

// ── ring 1+2 mirrors: the plan / step / diagnostic sub-shapes ────────────────
// Zod mirrors of the `result.ts` interfaces `serializeResult` emits. The closed
// vocabularies (disposition / step-kind / outcome) are DERIVED from their result.ts
// const tuples — not hand-listed — so the wire enum and the TS union are one source
// and a new member enrolls in both from a single edit. The object shapes (which Zod
// can't enumerate from an interface) stay proven faithful by the result-schema test
// running real finish/graduate results through them.

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

/** Mirror of {@link import("./result.ts").StepResultJson} — a step + its outcome. */
export const StepResultJsonSchema = z.strictObject({
  kind: stepKindEnum,
  label: z.string(),
  disposition: dispositionEnum,
  note: z.string().optional(),
  group: z.string().optional(),
  outcome: outcomeEnum,
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
 * The envelope fields every {@link import("./result.ts").DiscernResult} serializes
 * to EXCEPT `data`, mirroring `serializeResult` exactly: `ok`/`verb` always present,
 * everything else optional (`serializeResult` drops undefined fields, so a refusal
 * envelope `{ok, verb, error, message}` validates too). `data` is added separately —
 * the data-bearing verbs narrow it (below), the data-less verbs FORBID it (so a
 * future payload can't slip in unmodelled). Composed into the output schemas below;
 * locked to `serializeResult` by the result-schema test.
 */
const ENVELOPE_BASE_FIELDS = {
  ok: z.boolean(),
  verb: z.string(),
  dry_run: z.boolean().optional(),
  plan: PlanJsonSchema.optional(),
  steps: z.array(StepResultJsonSchema).optional(),
  diagnostics: z.array(DiagnosticSchema).optional(),
  hints: z.array(z.string()).optional(),
  error: z.string().optional(),
  message: z.string().optional(),
};

const ENVELOPE_BASE_FIELDS_WITHOUT_VERB = {
  ok: z.boolean(),
  dry_run: z.boolean().optional(),
  plan: PlanJsonSchema.optional(),
  steps: z.array(StepResultJsonSchema).optional(),
  diagnostics: z.array(DiagnosticSchema).optional(),
  hints: z.array(z.string()).optional(),
  error: z.string().optional(),
  message: z.string().optional(),
};

/** The general "any envelope" schema, with `data` left open (`unknown`). Locked to
 * `serializeResult` by the result-schema test (a maximal result carries `data`). */
export const EnvelopeSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: z.unknown().optional(),
});

/**
 * The envelope for the data-LESS verbs (`prepare`, `test`, `ratchets`): strict and
 * WITHOUT a `data` field. They carry no `data` today, and this makes that a checked
 * invariant — a result that grows a `data` payload fails its faithfulness test (and the
 * SDK's output validation) until the payload is modelled, the SSOT guard the bare
 * {@link EnvelopeSchema} (`data: unknown`) can't give. (`graduate` graduated out of this
 * set — it carries a {@link GraduateDataSchema} landing root on an apply; its dry-run
 * preview is still data-less.)
 */
export const DatalessEnvelopeSchema = z.strictObject(ENVELOPE_BASE_FIELDS);

export const ConfigIssueSchema = z.strictObject({
  path: z.string(),
  message: z.string(),
});

const ConfigIssueDataSchema = z.strictObject({
  issues: z.array(ConfigIssueSchema),
});

function dataSchemaWithConfigIssues<T extends z.ZodType>(
  dataSchema: T,
): z.ZodUnion<[T, typeof ConfigIssueDataSchema]> {
  return z.union([dataSchema, ConfigIssueDataSchema]);
}

function resultOutputSchema<T extends z.ZodType>(
  verb: string,
  dataSchema: T,
): z.ZodObject<
  typeof ENVELOPE_BASE_FIELDS_WITHOUT_VERB & {
    verb: z.ZodLiteral<string>;
    data: z.ZodOptional<z.ZodUnion<[T, typeof ConfigIssueDataSchema]>>;
  }
> {
  return z.strictObject({
    ...ENVELOPE_BASE_FIELDS_WITHOUT_VERB,
    verb: z.literal(verb),
    data: dataSchemaWithConfigIssues(dataSchema).optional(),
  });
}

function datalessResultOutputSchema(
  verb: string,
): z.ZodObject<
  typeof ENVELOPE_BASE_FIELDS_WITHOUT_VERB & {
    verb: z.ZodLiteral<string>;
    data: z.ZodOptional<typeof ConfigIssueDataSchema>;
  }
> {
  return z.strictObject({
    ...ENVELOPE_BASE_FIELDS_WITHOUT_VERB,
    verb: z.literal(verb),
    data: ConfigIssueDataSchema.optional(),
  });
}

// ── per-verb `data` schemas (the source; the core's `data` type infers from it) ──

/** `finish` — the gate's own concerns ({@link import("../engine/gate/plan.ts").GateData}).
 * `failed_stage` is the closed {@link FAILED_STAGES} vocabulary (derived here, not
 * hand-listed), so the wire enum and the engine's `FailedStage` type can never drift. */
export const GateDataSchema = z.strictObject({
  failed_stage: z.enum(FAILED_STAGES).nullable(),
  scopes_changed: z.array(z.string()),
  gate_receipt: z.strictObject({
    status: z.enum([
      "recorded",
      "skipped_dirty",
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

export const GateReceiptCheckSchema = z.strictObject({
  status: z.enum([
    "honored",
    "missing",
    "stale",
    "dirty",
    "unavailable",
    "read_failed",
  ]),
  path: z.string().optional(),
  recorded: z.string().optional(),
  head: z.string().optional(),
  reason: z.string().optional(),
});
export type GateReceiptCheckData = z.infer<typeof GateReceiptCheckSchema>;

const GateValidationSchema = z.strictObject({
  mode: z.enum(["receipt", "rerun"]),
  receipt: GateReceiptCheckSchema,
});
export type GateValidationData = z.infer<typeof GateValidationSchema>;

/** `refresh` — generated guidance, skills, and provider integration artifacts. */
export const RefreshDataSchema = z.strictObject({
  agents_written: z.array(z.string()),
  mcp_wired: z.array(z.string()),
  worktree_app_wired: z.array(z.string()),
  project_rules_wired: z.array(z.string()),
  skills: z.strictObject({
    copied: z.number(),
    linked: z.number(),
    pruned: z.number(),
  }),
  errors: z.array(z.string()),
});
export type RefreshData = z.infer<typeof RefreshDataSchema>;

/** `scopes` — the classified scope/marker list. */
export const ScopesDataSchema = z.strictObject({
  scopes: z.array(z.string()),
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
 * and `subject` — the same identity `integrate` reports for a landed commit (ADR 0064),
 * enough to judge whether two files moved as one decision or merely rode along. */
const couplingEvidenceCommitSchema = z.strictObject({
  sha: z.string(),
  date: z.string(),
  subject: z.string(),
});

/** `coupling` — the co-change view mined from git history; `mode` picks the shape:
 * - `diff` carries the `changed` set considered and the `partners` MISSING from it;
 * - `query` carries the queried `target` and its `partners` (the capped ranked list, each
 *   entry an edge with its evidence — advisory and NOT exhaustive);
 * - `evidence` compares two files `a` and `b`: `together` commits changed both (of `of_a`
 *   that touched `a` and `of_b` that touched `b`), the most recent listed in `commits`.
 * `partners` is always present (empty in `evidence` mode); the mode-specific fields are
 * optional so one object models every shape. */
export const CouplingDataSchema = z.strictObject({
  mode: z.enum(COUPLING_MODES),
  changed: z.array(z.string()).optional(),
  target: z.string().optional(),
  partners: z.array(couplingPartnerSchema),
  a: z.string().optional(),
  b: z.string().optional(),
  together: z.number().int().optional(),
  of_a: z.number().int().optional(),
  of_b: z.number().int().optional(),
  commits: z.array(couplingEvidenceCommitSchema).optional(),
});
export type CouplingData = z.infer<typeof CouplingDataSchema>;

/** `start` — the worktree it just created (or, in a dry-run, would create). `path`
 * is the load-bearing field: the new worktree's absolute location, which the caller
 * must re-root into (the MCP server cannot relocate the session for the agent). */
export const StartDataSchema = z.strictObject({
  id: z.string(),
  branch: z.string(),
  path: z.string(),
});
export type StartData = z.infer<typeof StartDataSchema>;

/** `graduate` — where the branch landed: `root` is the main checkout the worktree's
 * branch was graduated into. The load-bearing field for the MCP working-root re-aim
 * (ADR 0062): graduate removes the worktree the server operated on, and the server
 * re-aims its working root to THIS path — so a server launched inside a worktree (e.g.
 * Codex's app-managed worktree) lands back on the live main checkout, not the grave of
 * the worktree it just graduated, instead of the spawn root (which is the trunk only
 * when the server was launched from the trunk). */
export const GraduateDataSchema = z.strictObject({
  root: z.string(),
  gate_validation: GateValidationSchema.optional(),
  ignored_file_changes: z.strictObject({
    status: z.enum([
      "disabled",
      "baseline_missing",
      "unavailable",
      "unchanged",
      "changed",
    ]),
    changed_roots: z.array(z.string()),
    changed_total: z.number(),
    truncated: z.boolean(),
  }).optional(),
});
export type GraduateData = z.infer<typeof GraduateDataSchema>;

// integrate ─────────────────────────────────────────────────────────────────────

/** One commit an integration brought in (short sha + subject). */
const integrateCommitSchema = z.strictObject({
  sha: z.string(),
  subject: z.string(),
});

/** One file an integration changed beneath the branch. `added`/`removed` are null
 * for a binary file; `status` is git's single-letter code (`A`/`M`/`D`/`T`). */
const integrateFileSchema = z.strictObject({
  path: z.string(),
  status: z.string(),
  added: z.number().nullable(),
  removed: z.number().nullable(),
});

/** The SHA anchors bounding an integration — an agent diffs/logs against these to
 * pull the FULL set in one call when a list is capped. `after` (the merged HEAD) is
 * absent in a `--dry-run` preview (no merge happened); the predicted ranges use
 * `before...main` (three-dot) instead of `before..after`. */
const integrateRangeSchema = z.strictObject({
  base: z.string(),
  before: z.string(),
  main: z.string(),
  after: z.string().optional(),
});

/** `integrate` — what the merge brought in BENEATH the branch: the `commits` and
 * `files` it landed (each capped, with the pre-cap `*_total` and a `*_truncated`
 * flag), which of the branch's own files `overlap` them (re-read these for semantic
 * conflicts a clean merge can't catch), the fire-scopes the incoming change touches
 * (`scopes_incoming`), and the `range` anchors for drilling in. Present only when
 * something was — or, in a preview, would be — integrated (omitted on a no-op). */
export const IntegrateDataSchema = z.strictObject({
  behind: z.number(),
  fast_forward: z.boolean(),
  commits: z.array(integrateCommitSchema),
  commits_total: z.number(),
  commits_truncated: z.boolean(),
  files: z.array(integrateFileSchema),
  files_total: z.number(),
  files_truncated: z.boolean(),
  overlap: z.array(z.string()),
  overlap_total: z.number(),
  scopes_incoming: z.array(z.string()),
  range: integrateRangeSchema,
});
export type IntegrateData = z.infer<typeof IntegrateDataSchema>;

// status ──────────────────────────────────────────────────────────────────────

/** Where a `status` call is rooted: the main checkout or a linked worktree. The SSOT
 * for the location vocabulary — the schema enum below derives from it and `status.ts`
 * types its `location` value + context field as {@link Location}, so the wire enum and
 * the engine never re-list "main"/"worktree" out of step. */
export const LOCATIONS = ["main", "worktree"] as const;
/** One status location ({@link LOCATIONS}). */
export type Location = (typeof LOCATIONS)[number];

/** This worktree's derived identity + the resources recorded in its `.env`. */
const statusWorktreeSchema = z.strictObject({
  id: z.string(),
  branch: z.string(),
  site: z.string(),
  port: z.number(),
  db: z.string(),
  resources: z.record(z.string(), z.string()),
});
export type StatusWorktree = z.infer<typeof statusWorktreeSchema>;

/** The local git situation relative to the integration branch. */
const statusGitSchema = z.strictObject({
  branch: z.string(),
  integration_branch: z.string(),
  /** Ordinary Git-clean: no tracked changes and no untracked non-ignored files. */
  clean: z.boolean(),
  /** Count of ordinary `git status --porcelain` entries. */
  changed_files: z.number(),
  behind_integration: z.number().nullable(),
  ahead_integration: z.number(),
  /** When behind: the files THIS branch changed that the incoming integration branch
   * also changed — the hot zone to re-check on integrating (capped; present only in a
   * worktree that is behind and has overlap). The same intersection `integrate` reports. */
  incoming_overlap: z.array(z.string()).optional(),
});
export type StatusGit = z.infer<typeof statusGitSchema>;

/** What the gate WOULD fire for the current change — enumerated, never run. */
const statusGateSchema = z.strictObject({
  capabilities: z.array(z.string()),
  checks: z.array(z.string()),
  scope_gates: z.array(z.string()),
});
export type StatusGate = z.infer<typeof statusGateSchema>;

/** One row of the fleet survey. `is_current` marks the row the status call is
 * rooted in (the main row from the main checkout; the current worktree's row under
 * `--all`); every other row is a separate line of work. */
const statusFleetEntrySchema = z.strictObject({
  path: z.string(),
  is_main: z.boolean(),
  is_current: z.boolean(),
  branch: z.string(),
  /** Ordinary Git-clean: no tracked changes and no untracked non-ignored files. */
  clean: z.boolean(),
  /** Count of ordinary `git status --porcelain` entries. */
  changed_files: z.number(),
  ahead: z.number(),
  behind: z.number(),
  last_activity: z.string().optional(),
  id: z.string().optional(),
  port: z.number().optional(),
});
export type StatusFleetEntry = z.infer<typeof statusFleetEntrySchema>;

/** The feature-toggle snapshot status reports — one boolean per {@link FEATURES}
 * entry, derived from that SSOT so a newly-added feature can't silently go
 * unreported (the shape is pinned to FEATURES by a guard test in
 * `result_schemas_test.ts`). */
const statusFeaturesSchema = z.strictObject(
  Object.fromEntries(FEATURES.map((f) => [f, z.boolean()])) as Record<
    Feature,
    z.ZodBoolean
  >,
);
export type StatusFeatures = z.infer<typeof statusFeaturesSchema>;

/** `status` — the full situation payload. The local-only heavy blocks
 * (`scopes`/`gate`) are present in the local view and omitted when leading
 * with the fleet from main; `fleet` is present only when the survey is included. */
export const StatusDataSchema = z.strictObject({
  location: z.enum(LOCATIONS),
  root: z.string(),
  worktree: statusWorktreeSchema.nullable(),
  git: statusGitSchema.nullable(),
  scopes: z.array(z.string()).optional(),
  gate: statusGateSchema.optional(),
  features: statusFeaturesSchema,
  ratchets: z.array(z.string()),
  gate_receipt: GateReceiptCheckSchema.optional(),
  stale_generated: z.array(z.string()).optional(),
  stale_materialized: z.array(z.string()).optional(),
  setup_unfinished: z.strictObject({
    pending_markers: z.array(z.string()),
    capabilities: z.array(
      z.strictObject({ name: z.string(), wired: z.boolean() }),
    ),
  }).optional(),
  fleet: z.array(statusFleetEntrySchema).optional(),
});
export type StatusData = z.infer<typeof StatusDataSchema>;

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

/** `doctor` — the install-verification payload. `execution_model` is the per-verb
 * ordered step list (optional: omitted only when no config can be read at all). */
export const DoctorDataSchema = z.strictObject({
  kit_version: z.string(),
  environment: DoctorEnvironmentSchema,
  checks: z.array(CheckSchema),
  execution_model: z.array(VerbPlanSchema).optional(),
});
export type DoctorData = z.infer<typeof DoctorDataSchema>;

// improve ───────────────────────────────────────────────────────────────────

/** A pointer to the project material a subjective review item is judged against. */
const reviewEvidenceSchema = z.strictObject({
  source: z.string(),
  excerpt: z.string(),
});

/** One deterministic rule's evaluated result. Exported so the improve `RuleStatus`
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

/** One open subjective review item for the agent to judge. */
const reviewResultSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  ask: z.string(),
  teach: z.string(),
  against: reviewEvidenceSchema.optional(),
});

/** One reviewed category's evaluated result. */
const improveCategorySchema = z.strictObject({
  name: z.string(),
  title: z.string(),
  score: z.number(),
  weight: z.number(),
  weak: z.number(),
  rules: z.array(ruleResultSchema),
  reviews: z.array(reviewResultSchema),
});

/** The coach's single prioritized next action. */
const nextActionSchema = z.strictObject({
  kind: z.enum(["fix", "review"]),
  category: z.string(),
  id: z.string(),
  title: z.string(),
  action: z.string(),
  why: z.string(),
});

/** `improve` — baseline health, open reviews, and the prioritized next action. */
export const ImproveDataSchema = z.strictObject({
  score: z.number(),
  weak: z.number(),
  open_reviews: z.number(),
  next_action: nextActionSchema,
  categories: z.array(improveCategorySchema),
});
export type ImproveData = z.infer<typeof ImproveDataSchema>;

// docs / help ──────────────────────────────────────────────────────────────

/** One doc's record (no content). */
const docRecordSchema = z.strictObject({
  path: z.string(),
  section: z.string(),
  slug: z.string(),
  title: z.string(),
});
export type DocRecord = z.infer<typeof docRecordSchema>;

/**
 * `docs`/`help` — the documentation payload, across every mode: the index
 * (`docs_dir`/`count`/`docs`), an empty tree (`count:0`), a single doc
 * (`doc` with content), or an ambiguous match (`candidates`). Modeled as one object
 * with mode-specific optionals (a not-found is a bare error envelope with no data).
 */
export const DocsDataSchema = z.strictObject({
  docs_dir: z.string().optional(),
  count: z.number().optional(),
  docs: z.array(docRecordSchema).optional(),
  doc: docRecordSchema.extend({ content: z.string() }).optional(),
  candidates: z.array(z.string()).optional(),
});
export type DocsData = z.infer<typeof DocsDataSchema>;

// setup:step ──────────────────────────────────────────────────────────────────

/**
 * The machine-readable **spine** of one setup page (ADR 0078) — navigation and
 * completion-proof rails ONLY. The warm behavioral/consent guidance stays in the
 * prose `guidance` field, never flattened into these terse fields (the two-lane
 * rule: structured fields get summarized and weakened; prose gets followed). The
 * page parser ({@link import("./setup_pages.ts")}) validates each step's authored
 * TOML block against this, so a malformed spine fails loudly rather than serving
 * half a page.
 */
export const SetupPageSpineSchema = z.strictObject({
  intent: z.string(),
  files_to_read: z.array(z.string()),
  must_do: z.array(z.string()),
  what_not_to_do: z.array(z.string()),
  completion_check: z.string(),
  next_action: z.string(),
});
export type SetupPageSpine = z.infer<typeof SetupPageSpineSchema>;

/**
 * `setup:step` — one numbered setup page: the machine `spine` plus the warm prose
 * `guidance` the agent follows verbatim. `setup step <n> --json` carries BOTH
 * lanes; the human rendering leads with the prose (ADR 0078).
 */
export const SetupStepDataSchema = z.strictObject({
  step: z.number(),
  title: z.string(),
  spine: SetupPageSpineSchema,
  guidance: z.string(),
});
export type SetupStepData = z.infer<typeof SetupStepDataSchema>;

// setup:verify ──────────────────────────────────────────────────────────────────

/**
 * One pre-existing thing `begin` must work around — a heads-up for the human to weigh
 * before scaffolding, never a blocker (`verify` only ever observes). The `kind` is the
 * machine lane; the human-facing reason rides `detail`.
 */
export const SetupVerifyConflictSchema = z.strictObject({
  kind: z.enum([
    "existing_docs",
    "existing_instructions",
    "dirty_tree",
    "not_a_repo",
  ]),
  detail: z.string(),
});
export type SetupVerifyConflict = z.infer<typeof SetupVerifyConflictSchema>;

/**
 * The grounded, read-only findings `verify` reports about THIS repo — the machine lane
 * of the preflight. The consent conversation itself never rides these fields; it stays
 * in the `guidance` prose. A new finding (e.g. a docs-tree-under-another-name
 * detection) enrolls HERE, so the schema and the real output can't drift (ADR 0041).
 */
export const SetupVerifyFindingsSchema = z.strictObject({
  git: z.strictObject({
    repo: z.boolean(),
    clean: z.boolean(),
    uncommitted: z.number(),
  }),
  docs: z.strictObject({
    exists: z.boolean(),
    suggested_discern_dir: z.string().nullable().optional(),
  }),
  existing_instructions: z.array(z.string()),
  agents_detected: z.array(z.string()),
  agents_effective: z.array(z.string()),
  worktree_path: z.string(),
});
export type SetupVerifyFindings = z.infer<typeof SetupVerifyFindingsSchema>;

/**
 * `setup:verify` — the read-only preflight payload (ADR 0075), two shapes under one
 * schema:
 *   - the FRESH preflight: the structured machine lane (`findings`/`conflicts`/`ready`)
 *     plus the consent `guidance` — the warm prose the agent relays VERBATIM and never
 *     summarizes — and the `next_action` funnel into `begin`;
 *   - the redirect (phase ≠ fresh): just `phase` + `next_action`.
 * The two-lane split mirrors `setup:step` (ADR 0078): consent/behavioral instructions
 * stay prose, because agents summarize and weaken the same content when it arrives as
 * structured fields. `phase` mirrors `SetupPhase` (shared/setup_state.ts).
 */
export const SetupVerifyDataSchema = z.strictObject({
  phase: z.enum(["fresh", "in_progress", "done"]),
  next_action: z.string(),
  ready: z.boolean().optional(),
  findings: SetupVerifyFindingsSchema.optional(),
  conflicts: z.array(SetupVerifyConflictSchema).optional(),
  guidance: z.string().optional(),
});
export type SetupVerifyData = z.infer<typeof SetupVerifyDataSchema>;

// setup:done ──────────────────────────────────────────────────────────────────

/** One capability's honest coverage state at completion — mirrors
 * {@link import("./setup_assurance.ts").CapabilityAssurance}. The `state` enum is
 * DERIVED from `CAPABILITY_STATES` (the SSOT), so a new state enrolls here from one edit. */
export const CapabilityAssuranceSchema = z.strictObject({
  name: z.string(),
  state: z.enum(CAPABILITY_STATES),
  reason: z.string().optional(),
});

/** The rolled-up per-capability coverage `setup done` reports — mirrors
 * {@link import("./setup_assurance.ts").SetupAssurance}. */
export const SetupAssuranceSchema = z.strictObject({
  capabilities: z.array(CapabilityAssuranceSchema),
  enforced: z.number(),
  total: z.number(),
  verdict: z.enum(ASSURANCE_VERDICTS),
});

/** The provider-aware reactivation handoff — mirrors `reactivationHandoff()`'s return
 * (`src/lib/providers.ts`): the summary plus one derived step per configured agent that
 * wired something loading at session start. */
export const ReactivationSchema = z.strictObject({
  summary: z.string(),
  per_agent: z.array(
    z.strictObject({
      agent: z.string(),
      label: z.string(),
      step: z.string(),
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
  command: z.string(),
});

/**
 * `setup:done` — the completion payload (ADR 0065/0078/0086). The structured pieces
 * (assurance / landing / reactivation / coach) are the machine lane; the `guidance`
 * prose is the ready-to-relay completion message a courier agent hands its human —
 * carried verbatim and identical to the human render, never flattened into fields
 * (ADR 0086, the two-lane rule).
 */
export const SetupDoneDataSchema = z.strictObject({
  bootstrapped: z.literal(true),
  forced: z.boolean(),
  gate_proven: z.boolean(),
  /** Whether the worktree-viability probe (ADR 0090) actually ran green — false when it
   * was skipped (worktrees off, an uncreatable probe, or `--force`). */
  worktree_proven: z.boolean(),
  marker_committed: z.boolean(),
  leftover: z.array(z.string()),
  assurance: SetupAssuranceSchema,
  landing: SetupDoneLandingSchema,
  reactivation: ReactivationSchema,
  coach: z.strictObject({ verb: z.string(), command: z.string() }),
  guidance: z.string(),
});
export type SetupDoneData = z.infer<typeof SetupDoneDataSchema>;

// CLI-only installer/configuration result payloads ────────────────────────────

const setupProjectSchema = z.strictObject({
  slug: z.string(),
  agents: z.array(z.string()),
});

const setupProgressSchema = z.strictObject({
  pending_markers: z.array(z.string()),
  capabilities: z.array(
    z.strictObject({ name: z.string(), wired: z.boolean() }),
  ),
});

/** `setup` / `setup begin` / the fresh welcome redirect. One schema covers the
 * phased setup surface because the emitted `verb` is deliberately still `setup` for
 * the welcome and begin paths. Mode-specific fields are optional; command-specific
 * sub-verbs (`setup:verify`, `setup:step`, `setup:done`, `setup:land`) have their
 * own narrowed schemas below. */
export const SetupDataSchema = z.strictObject({
  phase: z.enum(["fresh", "in_progress", "done"]).optional(),
  complete: z.boolean().optional(),
  next_action: z.string().optional(),
  agent_guidance: z.string().optional(),
  human_framing: z.string().optional(),
  progress: setupProgressSchema.optional(),
  already_set_up: z.boolean().optional(),
  message: z.string().optional(),
  project: setupProjectSchema.optional(),
  plan: z.array(
    z.strictObject({
      path: z.string(),
      action: z.enum(["create", "skip", "merge", "append"]),
      note: z.string().optional(),
    }),
  ).optional(),
  guidance: z.string().optional(),
  command: z.string().optional(),
  bootstrapped: z.boolean().optional(),
  branch: z.string().nullable().optional(),
  machinery_committed: z.boolean().optional(),
  kit_version: z.string().optional(),
  written: z.array(z.string()).optional(),
  compiled: z.array(z.string()).optional(),
  mcp_wired: z.array(z.string()).optional(),
  worktree_app_wired: z.array(z.string()).optional(),
  project_rules_wired: z.array(z.string()).optional(),
  guidelines_compiled: z.boolean().optional(),
  guidelines_errors: z.array(z.string()).optional(),
  skeletons: z.array(z.string()).optional(),
  skipped: z.array(z.string()).optional(),
  instructions: z.string().optional(),
  page: SetupStepDataSchema.nullable().optional(),
  changes: z.array(z.string()).optional(),
});
export type SetupData = z.infer<typeof SetupDataSchema>;

/** `setup:land` — setup branch landing preview/result. Refusals carry no data. */
export const SetupLandDataSchema = z.strictObject({
  landed: z.boolean(),
  branch: z.string(),
  target: z.string(),
  fast_forward: z.boolean(),
  branch_deleted: z.boolean(),
});
export type SetupLandData = z.infer<typeof SetupLandDataSchema>;

const configEditSchema = z.strictObject({
  key: z.string(),
  literal: z.string(),
});

/** `config` — every config subcommand reports the file and applied/planned edits. */
export const ConfigDataSchema = z.strictObject({
  file: z.string(),
  edits: z.array(configEditSchema),
});
export type ConfigData = z.infer<typeof ConfigDataSchema>;

/** `preset` — preset application, preview, and unknown-preset discovery payloads. */
export const PresetDataSchema = z.strictObject({
  preset: z.string().optional(),
  available: z.array(z.string()).optional(),
  plan: z.array(
    z.strictObject({
      path: z.string(),
      action: z.enum(["create", "skip", "merge", "append"]),
      note: z.string().optional(),
    }),
  ).optional(),
  config_fills: z.boolean().optional(),
  written: z.array(z.string()).optional(),
});
export type PresetData = z.infer<typeof PresetDataSchema>;

const migrationStepSchema = z.strictObject({
  from: z.number(),
  to: z.number(),
  describe: z.string(),
});

const configReconcileOperationSchema = z.strictObject({
  kind: z.enum(["section", "key"]),
  path: z.string(),
});

const gitignoreReconcileOperationSchema = z.strictObject({
  kind: z.enum(["create-block", "replace-block"]),
  path: z.string(),
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
  changes: z.array(z.string()).optional(),
  issues: z.array(ConfigIssueSchema).optional(),
  kit_version: z.string().optional(),
  migrations_applied: z.array(migrationStepSchema).optional(),
  config_reconciled: z.array(configReconcileOperationSchema).optional(),
  gitignore_reconciled: z.array(gitignoreReconcileOperationSchema).optional(),
  skills: z.strictObject({
    copied: z.number(),
    linked: z.number(),
    pruned: z.number(),
  }).nullable().optional(),
  agents_written: z.array(z.string()).optional(),
  mcp_wired: z.array(z.string()).optional(),
  project_rules_wired: z.array(z.string()).optional(),
  guidelines_compiled: z.boolean().optional(),
  guidelines_errors: z.array(z.string()).optional(),
});
export type UpgradeData = z.infer<typeof UpgradeDataSchema>;

const skillListingSchema = z.strictObject({
  name: z.string(),
  source: z.enum(["authored", "bundled"]),
  overridesBundled: z.boolean(),
  hasBundled: z.boolean(),
});

const skillMaterializeSchema = z.strictObject({
  copied: z.number(),
  linked: z.number(),
  pruned: z.number(),
  errors: z.array(z.string()),
});

/** `skills:list` — the effective built-in/authored skill set. */
export const SkillsListDataSchema = z.strictObject({
  skills: z.array(skillListingSchema),
});
export type SkillsListData = z.infer<typeof SkillsListDataSchema>;

/** `skills:eject` — where a bundled skill was copied and how materialization went. */
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

/** `setup` output: envelope + the phased setup/welcome `data`. */
export const SetupOutputSchema = resultOutputSchema("setup", SetupDataSchema);

/** `finish` output: envelope + the gate's `data`. */
export const FinishOutputSchema = resultOutputSchema("finish", GateDataSchema);

/** `prepare` output: envelope only (except top-level config parse errors). */
export const PrepareOutputSchema = datalessResultOutputSchema("prepare");

/** `test` output: envelope only (except top-level config parse errors). */
export const TestOutputSchema = datalessResultOutputSchema("test");

/** `ratchets` output: envelope only (except top-level config parse errors). */
export const RatchetsOutputSchema = datalessResultOutputSchema("ratchets");

/** `refresh` output: envelope + the generated-artifact summary `data`. */
export const RefreshOutputSchema = resultOutputSchema(
  "refresh",
  RefreshDataSchema,
);

/** `status` output: envelope + the situation `data`. */
export const StatusOutputSchema = resultOutputSchema(
  "status",
  StatusDataSchema,
);

/** `doctor` output: envelope + the install-check `data`. */
export const DoctorOutputSchema = resultOutputSchema(
  "doctor",
  DoctorDataSchema,
);

/** `scopes` output: envelope + the scope-list `data`. */
export const ScopesOutputSchema = resultOutputSchema(
  "scopes",
  ScopesDataSchema,
);

/** `coupling` output: envelope + the co-change `data`. */
export const CouplingOutputSchema = resultOutputSchema(
  "coupling",
  CouplingDataSchema,
);

/** `start` output: envelope + the new-worktree `data`. */
export const StartOutputSchema = resultOutputSchema("start", StartDataSchema);

/** `graduate` output: envelope + the landing-root `data` (present on an apply; a
 * dry-run preview carries none). */
export const GraduateOutputSchema = resultOutputSchema(
  "graduate",
  GraduateDataSchema,
);

/** `integrate` output: envelope + the "what landed beneath the branch" `data`. */
export const IntegrateOutputSchema = resultOutputSchema(
  "integrate",
  IntegrateDataSchema,
);

/** `improve` output: envelope + the coaching `data`. */
export const ImproveOutputSchema = resultOutputSchema(
  "improve",
  ImproveDataSchema,
);

/** `docs` output: envelope + the documentation `data`. */
export const DocsOutputSchema = resultOutputSchema("docs", DocsDataSchema);

/** `help` output: envelope + the bundled documentation `data`. */
export const HelpOutputSchema = resultOutputSchema("help", DocsDataSchema);

/** `setup:step` output: envelope + the structured page `data`. CLI-only (setup is
 * not an MCP tool), but modeled here so the page parser validates against one
 * source and a faithfulness test can pin the real serialized output to it. */
export const SetupStepOutputSchema = resultOutputSchema(
  "setup:step",
  SetupStepDataSchema,
);

/** `setup:verify` output: envelope + the preflight `data` (fresh or redirect). CLI-only
 * (setup is not an MCP tool), modeled here so a faithfulness test can pin the real
 * serialized output — including the consent `guidance` — to one source (ADR 0041). */
export const SetupVerifyOutputSchema = resultOutputSchema(
  "setup:verify",
  SetupVerifyDataSchema,
);

/** `setup:done` output: envelope + the completion `data`. CLI-only (setup is not an MCP
 * tool), modeled here so a faithfulness test can pin the real serialized output —
 * including the completion `guidance` — to one source (ADR 0041). */
export const SetupDoneOutputSchema = resultOutputSchema(
  "setup:done",
  SetupDoneDataSchema,
);

/** `setup:land` output: envelope + the landing preview/result `data`. */
export const SetupLandOutputSchema = resultOutputSchema(
  "setup:land",
  SetupLandDataSchema,
);

/** `config` output: envelope + applied/planned TOML edits. */
export const ConfigOutputSchema = resultOutputSchema(
  "config",
  ConfigDataSchema,
);

/** `preset` output: envelope + preset preview/application/discovery data. */
export const PresetOutputSchema = resultOutputSchema(
  "preset",
  PresetDataSchema,
);

/** `upgrade` output: envelope + migration/reconciliation summary data. */
export const UpgradeOutputSchema = resultOutputSchema(
  "upgrade",
  UpgradeDataSchema,
);

/** `worktree setup` output: envelope only (except top-level config parse errors). */
export const WorktreeSetupOutputSchema = datalessResultOutputSchema(
  "worktree setup",
);

/** `worktree teardown` output: envelope only (except top-level config parse errors). */
export const WorktreeTeardownOutputSchema = datalessResultOutputSchema(
  "worktree teardown",
);

/** `worktree prune` output: envelope only (except top-level config parse errors). */
export const WorktreePruneOutputSchema = datalessResultOutputSchema(
  "worktree prune",
);

/** `skills:list` output: envelope + effective skill listing data. */
export const SkillsListOutputSchema = resultOutputSchema(
  "skills:list",
  SkillsListDataSchema,
);

/** `skills:eject` output: envelope + ejection/materialization data. */
export const SkillsEjectOutputSchema = resultOutputSchema(
  "skills:eject",
  SkillsEjectDataSchema,
);
