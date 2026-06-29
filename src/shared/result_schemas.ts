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

/** The general "any envelope" schema, with `data` left open (`unknown`). Locked to
 * `serializeResult` by the result-schema test (a maximal result carries `data`). */
export const EnvelopeSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: z.unknown().optional(),
});

/**
 * The envelope for the data-LESS verbs (`prepare`, `test`, `ratchets`, `graduate`):
 * strict and WITHOUT a `data` field. They carry no `data` today, and this makes that
 * a checked invariant — a result that grows a `data` payload fails its faithfulness
 * test (and the SDK's output validation) until the payload is modelled, the SSOT
 * guard the bare `EnvelopeSchema` (`data: unknown`) can't give.
 */
export const DatalessEnvelopeSchema = z.strictObject(ENVELOPE_BASE_FIELDS);

// ── per-verb `data` schemas (the source; the core's `data` type infers from it) ──

/** `finish` — the gate's own concerns ({@link import("../engine/gate/plan.ts").GateData}).
 * `failed_stage` is the closed {@link FAILED_STAGES} vocabulary (derived here, not
 * hand-listed), so the wire enum and the engine's `FailedStage` type can never drift. */
export const GateDataSchema = z.strictObject({
  failed_stage: z.enum(FAILED_STAGES).nullable(),
  scopes_changed: z.array(z.string()),
});
export type GateData = z.infer<typeof GateDataSchema>;

/** `changed-scopes` — the classified scope/marker list. */
export const ChangedScopesDataSchema = z.strictObject({
  scopes: z.array(z.string()),
});
export type ChangedScopesData = z.infer<typeof ChangedScopesDataSchema>;

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
  clean: z.boolean(),
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
  clean: z.boolean(),
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
 * (`changed_scopes`/`gate`) are present in the local view and omitted when leading
 * with the fleet from main; `fleet` is present only when the survey is included. */
export const StatusDataSchema = z.strictObject({
  location: z.enum(LOCATIONS),
  root: z.string(),
  worktree: statusWorktreeSchema.nullable(),
  git: statusGitSchema.nullable(),
  changed_scopes: z.array(z.string()).optional(),
  gate: statusGateSchema.optional(),
  features: statusFeaturesSchema,
  ratchets: z.array(z.string()),
  stale_generated: z.array(z.string()).optional(),
  stale_materialized: z.array(z.string()).optional(),
  setup_unfinished: z.strictObject({ pending_markers: z.array(z.string()) })
    .optional(),
  fleet: z.array(statusFleetEntrySchema).optional(),
});
export type StatusData = z.infer<typeof StatusDataSchema>;

// doctor ────────────────────────────────────────────────────────────────────

/** One doctor check ({@link import("../commands/doctor.ts").Check}). */
export const CheckSchema = z.strictObject({
  name: z.string(),
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

// audit ─────────────────────────────────────────────────────────────────────

/** A pointer to the project material a subjective review item is judged against. */
const auditEvidenceSchema = z.strictObject({
  source: z.string(),
  excerpt: z.string(),
});

/** One deterministic rule's evaluated result. Exported so the audit `RuleStatus`
 * SSOT (an engine type this shared module can't import) is tied to `status` here by a
 * guard in `audit_catalog_test.ts`. */
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
  against: auditEvidenceSchema.optional(),
});

/** One audited category's evaluated result. */
const auditCategorySchema = z.strictObject({
  name: z.string(),
  title: z.string(),
  score: z.number(),
  weight: z.number(),
  weak: z.number(),
  rules: z.array(ruleResultSchema),
  reviews: z.array(reviewResultSchema),
});

/** `audit` — the scored, weakest-first best-practices payload. */
export const AuditDataSchema = z.strictObject({
  score: z.number(),
  weak: z.number(),
  open_reviews: z.number(),
  categories: z.array(auditCategorySchema),
});
export type AuditData = z.infer<typeof AuditDataSchema>;

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

// ── per-verb output schemas (the envelope with `data` narrowed) ──────────────
// Advertised by the MCP server as each tool's `outputSchema`; the SDK validates a
// call's `structuredContent` against `<schema>.shape`. The data-less verbs use the
// bare {@link EnvelopeSchema}.

/** `finish` output: envelope + the gate's `data`. */
export const FinishOutputSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: GateDataSchema.optional(),
});

/** `status` output: envelope + the situation `data`. */
export const StatusOutputSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: StatusDataSchema.optional(),
});

/** `doctor` output: envelope + the install-check `data`. */
export const DoctorOutputSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: DoctorDataSchema.optional(),
});

/** `changed-scopes` output: envelope + the scope-list `data`. */
export const ChangedScopesOutputSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: ChangedScopesDataSchema.optional(),
});

/** `coupling` output: envelope + the co-change `data`. */
export const CouplingOutputSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: CouplingDataSchema.optional(),
});

/** `start` output: envelope + the new-worktree `data`. */
export const StartOutputSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: StartDataSchema.optional(),
});

/** `integrate` output: envelope + the "what landed beneath the branch" `data`. */
export const IntegrateOutputSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: IntegrateDataSchema.optional(),
});

/** `audit` output: envelope + the scored `data`. */
export const AuditOutputSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: AuditDataSchema.optional(),
});

/** `docs`/`help` output: envelope + the documentation `data`. */
export const DocsOutputSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: DocsDataSchema.optional(),
});
