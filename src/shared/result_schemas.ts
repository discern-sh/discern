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
 * Layer note: this is a `shared/` module — it depends only on `result.ts` and
 * Zod, never on `src/engine/**`, so the engine
 * cores import their data types FROM here (engine → shared), never the reverse.
 */

import { z } from "@zod/zod";
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
  STEP_DISPOSITIONS,
  STEP_KINDS,
  STEP_OUTCOMES,
} from "./result.ts";
import { ASSURANCE_VERDICTS, KNOWN_JOB_STATES } from "./setup_assurance.ts";
import { LANDING_AUTHORITY_KINDS, LANDING_CONSENT_SOURCES } from "./consent.ts";

export {
  ACCEPT_LANDING_STATE_FIELDS,
  ACCEPT_LANDING_STATE_SHAPE,
  type AcceptLandingState,
  AcceptLandingStateSchema,
};

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
  error: z.enum(ERROR_SLUGS).optional(),
  message: z.string().optional(),
};

const ENVELOPE_BASE_FIELDS_WITHOUT_VERB = {
  ok: z.boolean(),
  dry_run: z.boolean().optional(),
  plan: PlanJsonSchema.optional(),
  steps: z.array(StepResultJsonSchema).optional(),
  diagnostics: z.array(DiagnosticSchema).optional(),
  hints: z.array(z.string()).optional(),
  error: z.enum(ERROR_SLUGS).optional(),
  message: z.string().optional(),
};

/** The general "any envelope" schema, with `data` left open (`unknown`). Locked to
 * `serializeResult` by the result-schema test (a maximal result carries `data`). */
export const EnvelopeSchema = z.strictObject({
  ...ENVELOPE_BASE_FIELDS,
  data: z.unknown().optional(),
});

/**
 * The envelope for the data-LESS verbs (`prepare`, `test`, `standards`): strict and
 * WITHOUT a `data` field. They carry no `data` today, and this makes that a checked
 * invariant — a result that grows a `data` payload fails its faithfulness test (and the
 * SDK's output validation) until the payload is modelled, the SSOT guard the bare
 * {@link EnvelopeSchema} (`data: unknown`) can't give. (`accept` moved out of this
 * set — it carries a {@link AcceptDataSchema} landing root on an apply; its dry-run
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
 * The **receipt** — the deterministic review claim a green gate emits over a
 * clean committed tree, in two renderings from one set of facts (ADR 0188): the
 * branch, the validated commit (`head`, abbreviated), and the whole-diff stats
 * vs the trunk; `line` — the one sentence an agent closes its report with; and
 * `markdown` — the review page the owner pulls from discern. Derived ONCE from
 * the result envelope: both renderings are a function of these fields plus the
 * envelope's `steps[]` (what ran, with command and duration), never a second
 * computation. Commit and per-file lists are git's to report (`git diff
 * <trunk>...<branch>`), so they are not mirrored here.
 */
export const ReceiptSchema = z.strictObject({
  branch: z.string(),
  trunk: z.string(),
  head: z.string(),
  files_total: z.number(),
  insertions: z.number(),
  deletions: z.number(),
  line: z.string(),
  markdown: z.string(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

/** How one configured standard's measurement went in a gate run. The SSOT for the
 * measurement-disposition vocabulary — the engine types its outcomes from these. */
export const STANDARD_MEASUREMENTS = [
  "measured", // the run command executed inside the gate's parallel group
  "replayed", // the recorded baseline value stood in — its inputs were untouched
  "deferred", // measure = "on-demand": the gate skipped only the measurement
  "skipped", // the gate aborted (fail-fast, an earlier stage) before it ran
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
 * deferred/skipped and for an unreadable metric — the diagnostic carries why), the
 * measurement's wall-clock cost, and — for a replay — the commit whose recorded
 * measurement stood in. */
export const GateStandardSchema = z.strictObject({
  name: z.string(),
  direction: z.enum(["up", "down"]),
  limit: z.number(),
  measurement: z.enum(STANDARD_MEASUREMENTS),
  value: z.number().optional(),
  verdict: z.enum(STANDARD_VERDICTS).optional(),
  duration_s: z.number().optional(),
  replayed_from: z.string().optional(),
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
export type PinnedLimit = z.infer<typeof PinnedLimitSchema>;

/** The `standards` verb's `data`: the per-standard readings (the same shape the
 * gate carries in `GateData.standards`, so one consumer reads both), and — on a
 * `--pin` that tightened limits — the applied pins. Both optional: a refusal or
 * an empty config carries neither. */
export const StandardsDataSchema = z.strictObject({
  standards: z.array(GateStandardSchema).optional(),
  pinned: z.array(PinnedLimitSchema).optional(),
});
export type StandardsData = z.infer<typeof StandardsDataSchema>;

/** How the gate's never-loosen verification of `[standards]` limits against the
 * trunk went: `verified` (none loosened — vacuously so for limits new on the
 * branch or a trunk with no config yet), `loosened` (a limit loosened or an
 * entry deleted — the gate fails; per-standard diagnostics carry both values),
 * `unverified` (the trunk cannot be read — an unborn repo or an unfetched CI
 * clone; the gate proceeds LOUDLY, never silently), or `parse_failed` (the
 * trunk's config was fetched but does not parse — the gate fails). */
export const StandardsLimitsSchema = z.strictObject({
  status: z.enum(["verified", "loosened", "unverified", "parse_failed"]),
  trunk: z.string(),
  reason: z.string().optional(),
});
export type StandardsLimitsData = z.infer<typeof StandardsLimitsSchema>;

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
  uncovered: z.array(z.strictObject({
    path: z.string(),
    scopes: z.array(z.string()),
  })).optional(),
  warnings: z.array(z.string()).optional(),
});
export type LandingAuthorityData = z.infer<typeof LandingAuthorityDataSchema>;

/** `done` — the gate's own concerns ({@link import("../engine/gate/plan.ts").GateData}).
 * `failed_stage` is the closed {@link FAILED_STAGES} vocabulary (derived here, not
 * hand-listed), so the wire enum and the engine's `FailedStage` type can never drift.
 * `receipt` is present on a green run over a clean committed tree ahead of the
 * trunk — the review-moment summary; `gate_receipt` reports how recording it in the
 * marker file went. `standards`/`standards_limits` are present when `[standards]`
 * is configured: the per-standard measurement outcomes and the never-loosen
 * verification against the trunk. */
export const GateDataSchema = z.strictObject({
  failed_stage: z.enum(FAILED_STAGES).nullable(),
  scopes_changed: z.array(z.string()),
  standards: z.array(GateStandardSchema).optional(),
  standards_limits: StandardsLimitsSchema.optional(),
  landing_authority: LandingAuthorityDataSchema.optional(),
  receipt: ReceiptSchema.optional(),
  gate_receipt: z.strictObject({
    status: z.enum([
      "recorded",
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

/** How the current worktree's recorded receipt stands against HEAD. Present only
 * when the record is honored (it names exactly the current clean HEAD):
 * `receipt` is the stored receipt page, and `receipt_line` the stored one-line
 * form — the only receipt content an agent puts in a message (ADR 0188). Both
 * come from the marker, without re-running the gate. */
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
  receipt: z.string().optional(),
  receipt_line: z.string().optional(),
  /** The structured receipt cached by current writers. Older markers carry only
   * the rendered forms and therefore omit this field. */
  receipt_data: ReceiptSchema.optional(),
});
export type GateReceiptCheckData = z.infer<typeof GateReceiptCheckSchema>;

const GateValidationSchema = z.strictObject({
  mode: z.enum(["receipt", "rerun"]),
  receipt: GateReceiptCheckSchema,
});
export type GateValidationData = z.infer<typeof GateValidationSchema>;

/** `refresh` — generated guidance, skills, provider integration artifacts, and
 * the maintained ADR index. `adr_index_written` names the ADR README whose
 * marker-delimited record lists this run regenerated (at most one path; empty
 * when the index is current or the project carries no index markers). */
export const RefreshDataSchema = z.strictObject({
  agents_written: z.array(z.string()),
  mcp_wired: z.array(z.string()),
  hooks_wired: z.array(z.string()),
  worktree_app_wired: z.array(z.string()),
  project_rules_wired: z.array(z.string()),
  receipt_notes_fetch_changed: z.array(z.string()).optional(),
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

/** The fleet conditions `await` can hold for — one per call, mutually exclusive.
 * Defined here (not the engine) because the CLI flag surface, the MCP tool, and
 * the data schema all name the same closed set. */
export const AWAIT_CONDITIONS = ["green", "landed", "trunk-moved"] as const;
/** One `await` condition ({@link AWAIT_CONDITIONS}). */
export type AwaitConditionKind = (typeof AWAIT_CONDITIONS)[number];

/** Why a not-met `await` suggested the retry delay it did: `running` — the
 * awaited work is in flight and a duration prior bounds the remainder;
 * `no-prior` — work is in flight but no completed sample prices its verb;
 * `idle` — nothing is in flight, so a longer backoff; `logbook-off` — the
 * logbook is disabled, so no timing evidence exists and the delay is a flat
 * default. */
export const AWAIT_RETRY_BASES = [
  "running",
  "no-prior",
  "idle",
  "logbook-off",
] as const;

/** Why this call used its reported timeout: an exact caller request, or the
 * same repository evidence vocabulary that prices a follow-up wait. */
export const AWAIT_TIMEOUT_BASES = [
  "explicit",
  ...AWAIT_RETRY_BASES,
] as const;

/** What one `await` evaluation observed — always authoritative state (a git
 * ancestry read, a receipt inspection), never logbook history. Per-condition:
 * `green` carries the sibling receipt's status ({@link GateReceiptCheckSchema}
 * statuses, plus `no-worktree` when no checkout holds the branch) and the
 * sibling `worktree` path; `landed`/`green` carry the pinned `tip` sha and
 * whether it `landed`; `trunk-moved` carries the trunk sha at call start and
 * now. When a met condition means `discern update` has work to bring in,
 * `behind`/`incoming_overlap`/`overlap_total` preview it (the same hot-zone
 * read `status` reports). */
const awaitObservedSchema = z.strictObject({
  receipt_status: z.enum([
    "honored",
    "missing",
    "stale",
    "dirty",
    "unavailable",
    "read_failed",
    "no-worktree",
  ]).optional(),
  worktree: z.string().optional(),
  tip: z.string().optional(),
  landed: z.boolean().optional(),
  trunk_start: z.string().optional(),
  trunk_head: z.string().optional(),
  behind: z.number().int().optional(),
  incoming_overlap: z.array(z.string()).optional(),
  overlap_total: z.number().int().optional(),
});

/** The in-flight work that priced an `await` bound — advisory logbook evidence,
 * never part of the condition itself. `branch` identifies the selected action
 * even when `--trunk-moved` considers the whole fleet; the median remains the
 * compact "typical" reading while P90 is the conservative upper-bound input. */
const awaitRunningSchema = z.strictObject({
  verb: z.string(),
  branch: z.string(),
  started: z.string(),
  elapsed_ms: z.number().int(),
  typical_duration_ms: z.number().int().optional(),
  p90_duration_ms: z.number().int().optional(),
  duration_samples: z.number().int().optional(),
});

/** `await` — one blocking wait on a fleet condition. `met` is the verdict this
 * call ends on (a timeout is `met: false` with `ok: true` — "not yet" is an
 * answer, not a failure); `observed` is the authoritative state behind it;
 * `timeout_seconds` + `timeout_basis` name the bound this call used;
 * `retry_after_seconds` + `retry_basis` price another bounded wait, with
 * `running` carrying the in-flight evidence when repository history supplied
 * the number. */
export const AwaitDataSchema = z.strictObject({
  condition: z.enum(AWAIT_CONDITIONS),
  branch: z.string().optional(),
  trunk: z.string(),
  met: z.boolean(),
  waited_ms: z.number().int(),
  timeout_seconds: z.number(),
  timeout_basis: z.enum(AWAIT_TIMEOUT_BASES),
  observed: awaitObservedSchema,
  retry_after_seconds: z.number().int().optional(),
  retry_basis: z.enum(AWAIT_RETRY_BASES).optional(),
  running: awaitRunningSchema.optional(),
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
  name_note: z.string().optional(),
  landing_authority: LandingAuthorityDataSchema.optional(),
});
export type StartData = z.infer<typeof StartDataSchema>;

/** The recorded consent evidence used by one successful landing. */
export const LandingConsentDataSchema = z.strictObject({
  source: z.enum(LANDING_CONSENT_SOURCES),
  /** Present only for a standing grant: the scopes that covered changed paths. */
  scopes: z.array(z.string()).optional(),
});
export type LandingConsentData = z.infer<typeof LandingConsentDataSchema>;

export const ReceiptNotesFetchSchema = z.strictObject({
  mode: z.enum(["local", "fetch"]),
  status: z.enum(["local", "wired", "unchanged", "no_remote", "failed"]),
  remotes: z.array(z.string()),
  added: z.array(z.string()),
  removed: z.array(z.string()),
  errors: z.array(z.string()),
});
export type ReceiptNotesFetchData = z.infer<typeof ReceiptNotesFetchSchema>;

export const ReceiptNoteWriteSchema = z.strictObject({
  status: z.enum([
    "recorded",
    "already_present",
    "record_failed",
    "missing_receipt",
  ]),
  ref: z.string(),
  commit: z.string(),
  merged_refs: z.array(z.string()),
  reason: z.string().optional(),
});
export type ReceiptNoteWriteData = z.infer<typeof ReceiptNoteWriteSchema>;

export const AcceptReceiptNoteSchema = z.strictObject({
  fetch: ReceiptNotesFetchSchema,
  write: ReceiptNoteWriteSchema,
});
export type AcceptReceiptNoteData = z.infer<typeof AcceptReceiptNoteSchema>;

/** `accept` — where the branch landed: `root` is the main checkout the worktree's
 * branch was landed into. The load-bearing field for the MCP working-root re-aim
 * (ADR 0062): accept removes the worktree the server operated on, and the server
 * re-aims its working root to THIS path — so a server launched inside a worktree (e.g.
 * Codex's app-managed worktree) lands back on the live main checkout, not the grave of
 * the worktree it just landed, instead of the spawn root (which is the trunk only
 * when the server was launched from the trunk). */
export const AcceptDataSchema = z.strictObject({
  root: z.string(),
  consent: LandingConsentDataSchema,
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
  /** The receipt markdown for the tree that landed — the landing record, pasteable
   * into a PR body (from the honored marker on the fast path, or the fresh gate run
   * on the slow path; absent when neither carried one). */
  receipt: z.string().optional(),
  /** The system-rendered one-line receipt for the tree that landed. Agents relay
   * this field verbatim at the end of their landing report. */
  receipt_line: z.string().optional(),
  /** Repository-resident receipt recording and its optional fetch transport.
   * Both run after the trunk moves and therefore fail open. */
  receipt_note: AcceptReceiptNoteSchema.optional(),
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
export type AcceptData = z.infer<typeof AcceptDataSchema>;

// update ─────────────────────────────────────────────────────────────────────

/** One commit an integration brought in — {@link branchCommitSchema}, the shape
 * shared with the receipt's commit list. */
const updateCommitSchema = branchCommitSchema;

/** One file an integration changed beneath the branch — {@link changedFileSchema},
 * the shape shared with the receipt's diffstat. */
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
 * (`scopes_incoming`), and the `range` anchors for drilling in. Present only when
 * something was — or, in a preview, would be — updated (omitted on a no-op). */
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

/** The local git situation relative to the trunk. */
const statusGitSchema = z.strictObject({
  branch: z.string(),
  trunk: z.string(),
  /** Ordinary Git-clean: no tracked changes and no untracked non-ignored files. */
  clean: z.boolean(),
  /** Count of ordinary `git status --porcelain` entries. */
  changed_files: z.number(),
  behind_trunk: z.number().nullable(),
  /** Null when the trunk branch doesn't exist locally — there is nothing to
   * count against, and an honest null beats a fabricated 0. */
  ahead_trunk: z.number().nullable(),
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

const statusFleetEntrySchema = z.strictObject({
  path: z.string(),
  is_main: z.boolean(),
  is_current: z.boolean(),
  branch: z.string(),
  /** Ordinary Git-clean: no tracked changes and no untracked non-ignored files.
   * Absent (with the other per-checkout git fields) when `git_unavailable` is
   * set — an unreadable checkout's state is unknown, never reported clean. */
  clean: z.boolean().optional(),
  /** Count of ordinary `git status --porcelain` entries. */
  changed_files: z.number().optional(),
  ahead: z.number().optional(),
  behind: z.number().optional(),
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
  id: z.string().optional(),
  port: z.number().optional(),
  /** Present (true) when the worktree's creation never completed — its project
   * config is missing from the checkout (a crashed `start`'s signature; config
   * presence is the deliberate signal, not the ready sentinel, so a healthy
   * pre-sentinel worktree is never falsely flagged and a sentinel-less one that
   * self-heals next session isn't either). Not a healthy fleet member; the
   * hints carry the removal path (`discern worktree drop`). */
  broken: z.boolean().optional(),
  /** Present (true) when the row's clean HEAD has an honored receipt from
   * `discern done` — reviewable without visiting the worktree. `receipt` /
   * `receipt_line` carry the stored page and one-line form when the marker
   * recorded them (ADR 0188), so a supervisor at the main checkout reads the
   * review summary from here (`--verbose` prints it interactively). */
  receipt_honored: z.boolean().optional(),
  receipt: z.string().optional(),
  receipt_line: z.string().optional(),
  landing_authority: LandingAuthorityDataSchema.optional(),
});
export type StatusFleetEntry = z.infer<typeof statusFleetEntrySchema>;

/** One cross-worktree collision: two fleet branches whose fork diffs vs the
 * trunk touch the same paths — a semantic collision in the making even when
 * both merge cleanly. `overlap` is capped; `total` is the true count. */
const statusFleetCollisionSchema = z.strictObject({
  branches: z.tuple([z.string(), z.string()]),
  overlap: z.array(z.string()),
  total: z.number(),
});
export type StatusFleetCollision = z.infer<typeof statusFleetCollisionSchema>;

/** One in-flight ADR number collision: a record number claimed by files ADDED
 * on two or more in-flight branches — different paths with one number, which
 * the changed-file collision scan can never intersect. */
const statusAdrCollisionSchema = z.strictObject({
  number: z.string(),
  branches: z.array(z.string()),
  paths: z.array(z.string()),
});
export type StatusAdrCollision = z.infer<typeof statusAdrCollisionSchema>;

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
  standards: z.array(z.string()),
  gate_receipt: GateReceiptCheckSchema.optional(),
  landed_receipt: z.strictObject({
    commit: z.string(),
    ref: z.string(),
    receipt: ReceiptSchema,
  }).optional(),
  landing_authority: LandingAuthorityDataSchema.optional(),
  stale_generated: z.array(z.string()).optional(),
  stale_materialized: z.array(z.string()).optional(),
  stale_integrations: z.array(z.string()).optional(),
  /** The maintained ADR index does not match the record files on disk (at
   * most one path — the ADR README; present when stale). */
  stale_adr_index: z.array(z.string()).optional(),
  tracked_ignored_artifacts: z.array(z.string()).optional(),
  setup_unfinished: z.strictObject({
    pending_markers: z.array(z.string()),
    known_jobs: z.array(
      z.strictObject({ name: z.string(), wired: z.boolean() }),
    ),
  }).optional(),
  /** Local `<branch_prefix>*` branches holding unlanded work with NO worktree —
   * otherwise-invisible abandoned work (main-checkout view only; present when
   * non-empty). A worktree-less ref whose tip is contained in a live branch is
   * NOT abandoned and reports under `contained_refs` instead. */
  unlanded_branches: z.array(z.string()).optional(),
  /** Worktree-less refs kept deliberately by the contained-worktree reclaim
   * (main-checkout view only; present when non-empty): each tip is a strict
   * ancestor of the named live branch, so the commits ride there until they
   * land and the ref self-cleans through the ordinary prune. Informational —
   * no action needed. */
  contained_refs: z.array(
    z.strictObject({ branch: z.string(), contained_in: z.string() }),
  ).optional(),
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

/** `doctor` — the install-verification payload. `execution_model` is the per-verb
 * ordered step list (optional: omitted only when no config can be read at all). */
export const DoctorDataSchema = z.strictObject({
  kit_version: z.string(),
  environment: DoctorEnvironmentSchema,
  checks: z.array(CheckSchema),
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

/** One open subjective review item for the agent to judge. */
const reviewResultSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  ask: z.string(),
  teach: z.string(),
  against: reviewEvidenceSchema.optional(),
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

/** The coach's single prioritized next action. */
const nextActionSchema = z.strictObject({
  kind: z.enum(["fix", "review"]),
  category: z.string(),
  id: z.string(),
  title: z.string(),
  action: z.string(),
  why: z.string(),
  against: reviewEvidenceSchema.optional(),
});

/** `improvement` — baseline health, open reviews, and the prioritized next action. */
export const ImprovementDataSchema = z.strictObject({
  score: z.number(),
  weak: z.number(),
  open_reviews: z.number(),
  next_action: nextActionSchema,
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
  DETECTOR_FAMILIES,
  DETECTOR_SCOPES,
  DETECTOR_STATUSES,
  DETECTOR_TIERS,
  PatternsDataSchema,
  PatternsFindingSchema,
  PatternsResetDataSchema,
} from "./patterns_vocabulary.ts";
export type {
  DetectorFamily,
  DetectorScope,
  DetectorStatus,
  DetectorTier,
  PatternsData,
  PatternsDetector,
  PatternsFinding,
  PatternsResetData,
} from "./patterns_vocabulary.ts";
import {
  PatternsDataSchema,
  PatternsFindingSchema,
  PatternsResetDataSchema,
} from "./patterns_vocabulary.ts";

// docs / help ──────────────────────────────────────────────────────────────

/** One doc's record (no content). Frontmatter values travel as these
 * structured fields — never inside rendered content — and appear only when
 * they say something: `publish` only when false, the rest only when present. */
const docRecordSchema = z.strictObject({
  path: z.string(),
  section: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  publish: z.boolean().optional(),
  order: z.number().optional(),
  aliases: z.array(z.string()).optional(),
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
  match: z.enum(["complete", "partial", "metadata"]),
  heading: z.string().optional(),
  snippet: z.string(),
});
export type DocSearchResult = z.infer<typeof docSearchResultSchema>;

/**
 * `map`/`help` — the documentation payload, across every mode: the index
 * (`map_dir`/`count`/`docs`; `help` omits `map_dir`), an empty tree
 * (`count:0`), a single doc (`doc` with content), an ambiguous match
 * (`candidates`), nearest-match guidance for a not-found (`suggestions`), or a
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
 * `setup step` — one numbered setup page: the machine `spine` plus the warm prose
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

// setup verify ──────────────────────────────────────────────────────────────────

/**
 * One pre-existing thing `begin` must work around — a heads-up for the human to weigh
 * before scaffolding, never a blocker (`verify` only ever observes). The `kind` is the
 * machine lane; the human-facing reason rides `detail`.
 */
export const SetupVerifyConflictSchema = z.strictObject({
  kind: z.enum([
    "existing_instructions",
    "dirty_tree",
    "not_a_repo",
    "missing_git_identity",
  ]),
  detail: z.string(),
});
export type SetupVerifyConflict = z.infer<typeof SetupVerifyConflictSchema>;

/**
 * The grounded, read-only findings `verify` reports about THIS repo — the machine lane
 * of the preflight. The consent conversation itself never rides these fields; it stays
 * in the `guidance` prose. A new finding (e.g. a new repo probe) enrolls HERE,
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
});
export type SetupVerifyFindings = z.infer<typeof SetupVerifyFindingsSchema>;

/**
 * `setup verify` — the read-only preflight payload (ADR 0075), two shapes under one
 * schema:
 *   - the FRESH preflight: the structured machine lane (`findings`/`conflicts`/`ready`)
 *     plus the consent `guidance` — the warm prose the agent relays VERBATIM and never
 *     summarizes — and the `next_action` funnel into `begin`;
 *   - the redirect (phase ≠ fresh): just `phase` + `next_action`.
 * The two-lane split mirrors `setup step` (ADR 0078): consent/behavioral instructions
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
  reason: z.string().optional(),
  self_supplied: z.literal(true).optional(),
});

/** The rolled-up known-job coverage `setup done` reports — mirrors
 * {@link import("./setup_assurance.ts").SetupAssurance}. */
export const SetupAssuranceSchema = z.strictObject({
  known_jobs: z.array(KnownJobAssuranceSchema),
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
  /** True only on the dedicated `discern-setup` branch — the one branch
   * `setup accept` lands; false steers the agent to a manual merge instead. */
  on_setup_branch: z.boolean(),
  command: z.string(),
});

/**
 * `setup done` — the completion payload (ADR 0065/0078/0086). The structured pieces
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
  /** The git stderr line explaining a FAILED completion-marker auto-commit
   * (absent when committed, skipped deliberately, or outside git). */
  marker_commit_error: z.string().optional(),
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
  known_jobs: z.array(
    z.strictObject({ name: z.string(), wired: z.boolean() }),
  ),
});

/** `setup` / `setup begin` / the fresh welcome redirect. One schema covers the
 * phased setup surface because the emitted `verb` is deliberately still `setup` for
 * the welcome and begin paths. Mode-specific fields are optional; command-specific
 * sub-verbs (`setup verify`, `setup step`, `setup done`, `setup accept`) have their
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
  /** The git stderr line explaining a FAILED machinery auto-commit (absent when
   * committed, or when the skip was deliberate). */
  machinery_commit_error: z.string().optional(),
  kit_version: z.string().optional(),
  written: z.array(z.string()).optional(),
  compiled: z.array(z.string()).optional(),
  mcp_wired: z.array(z.string()).optional(),
  hooks_wired: z.array(z.string()).optional(),
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

/** `setup accept` — setup branch landing preview/result. Refusals carry no data. */
export const SetupAcceptDataSchema = z.strictObject({
  landed: z.boolean(),
  branch: z.string(),
  target: z.string(),
  fast_forward: z.boolean(),
  branch_deleted: z.boolean(),
});
export type SetupAcceptData = z.infer<typeof SetupAcceptDataSchema>;

const configEditSchema = z.strictObject({
  key: z.string(),
  literal: z.string(),
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
 * `config` — a discriminated union over edits and all shell-friendly reads.
 * Human reads keep their bare output; `--json` projects the same fact into one
 * typed envelope.
 */
export const ConfigDataSchema = z.discriminatedUnion("operation", [
  configEditDataSchema,
  configScalarDataSchema,
  configArrayDataSchema,
  configHasDataSchema,
]);
export type ConfigData = z.infer<typeof ConfigDataSchema>;

const thirdPartyComponentSchema = z.strictObject({
  name: z.string(),
  version: z.string(),
  registry: z.string(),
  license: z.string(),
});

/** `licenses` — the components embedded in this binary. */
export const LicensesDataSchema = z.strictObject({
  components: z.array(thirdPartyComponentSchema),
});
export type LicensesData = z.infer<typeof LicensesDataSchema>;

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
  field: z.string(),
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
  /** Dotted config paths the preset fills (or would fill, on a dry-run). */
  config_fills_applied: z.array(z.string()).optional(),
  /** Dotted config paths kept as the project's own — already set, so the
   * preset's fill was skipped (fills never overwrite a present value). */
  config_fills_skipped: z.array(z.string()).optional(),
  written: z.array(z.string()).optional(),
});
export type PresetData = z.infer<typeof PresetDataSchema>;

const migrationStepSchema = z.strictObject({
  from: z.number(),
  to: z.number(),
  describe: z.string(),
});

const configReconcileOperationSchema = z.strictObject({
  kind: z.enum(["section", "key", "banner"]),
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
  hooks_wired: z.array(z.string()).optional(),
  worktree_app_wired: z.array(z.string()).optional(),
  project_rules_wired: z.array(z.string()).optional(),
  guidelines_compiled: z.boolean().optional(),
  guidelines_errors: z.array(z.string()).optional(),
});
export type UpgradeData = z.infer<typeof UpgradeDataSchema>;

/** `uninstall` data: the removal plan/outcome (removed files, stripped co-owned
 * files, kept user content, and the binary-removal hint), or the active
 * worktrees on a refusal. All optional so the same shape covers a plan, an
 * applied run, and a refusal. */
export const UninstallDataSchema = z.strictObject({
  removed: z.array(z.string()).optional(),
  stripped: z.array(z.string()).optional(),
  kept: z.array(z.string()).optional(),
  binary_hint: z.string().optional(),
  worktrees: z.array(z.string()).optional(),
});
export type UninstallData = z.infer<typeof UninstallDataSchema>;

const skillListingSchema = z.strictObject({
  name: z.string(),
  source: z.enum(["authored", "bundled"]),
  // True when this authored skill shadows a bundled built-in.
  overridesBundled: z.boolean(),
  // True when a bundled built-in of this name exists (shadowed or not).
  hasBundled: z.boolean(),
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

/** `setup` output: envelope + the phased setup/welcome `data`. */
export const SetupOutputSchema = resultOutputSchema("setup", SetupDataSchema);

/** `done` output: envelope + the gate's `data`. */
export const FinishOutputSchema = resultOutputSchema("done", GateDataSchema);

/** `prepare` output: envelope only (except top-level config parse errors). */
export const PrepareOutputSchema = datalessResultOutputSchema("prepare");

/** `test` output: envelope only (except top-level config parse errors). */
export const TestOutputSchema = datalessResultOutputSchema("test");

/** `await` output: envelope + the observed-condition `data`. */
export const AwaitOutputSchema = resultOutputSchema("await", AwaitDataSchema);

/** `standards` output: envelope + the per-standard readings, and — on a `--pin`
 * that tightened limits — the applied pins. */
export const StandardsOutputSchema = resultOutputSchema(
  "standards",
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
export const StatusOutputSchema = resultOutputSchema(
  "status",
  StatusDataSchema,
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

/** `patterns reset` output: envelope + the deletion `data`. CLI-only (the one
 * destructive member of the patterns family stays off the MCP surface). */
export const PatternsResetOutputSchema = resultOutputSchema(
  "patterns reset",
  PatternsResetDataSchema,
);

/** `start` output: envelope + the new-worktree `data`. */
export const StartOutputSchema = resultOutputSchema("start", StartDataSchema);

/** `accept` output: envelope + the landing-root `data` (present on an apply; a
 * dry-run preview carries none). */
export const AcceptOutputSchema = resultOutputSchema(
  "accept",
  AcceptDataSchema,
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

/** `map` output: envelope + the project-map `data`. */
export const MapOutputSchema = resultOutputSchema("map", DocsDataSchema);

/** `docs` output: envelope + the bundled documentation `data`. */
export const DocsOutputSchema = resultOutputSchema("docs", DocsDataSchema);

/** `setup step` output: envelope + the structured page `data`. CLI-only (setup is
 * not an MCP tool), but modeled here so the page parser validates against one
 * source and a faithfulness test can pin the real serialized output to it. */
export const SetupStepOutputSchema = resultOutputSchema(
  "setup step",
  SetupStepDataSchema,
);

/** `setup verify` output: envelope + the preflight `data` (fresh or redirect). CLI-only
 * (setup is not an MCP tool), modeled here so a faithfulness test can pin the real
 * serialized output — including the consent `guidance` — to one source (ADR 0041). */
export const SetupVerifyOutputSchema = resultOutputSchema(
  "setup verify",
  SetupVerifyDataSchema,
);

/** `setup done` output: envelope + the completion `data`. CLI-only (setup is not an MCP
 * tool), modeled here so a faithfulness test can pin the real serialized output —
 * including the completion `guidance` — to one source (ADR 0041). */
export const SetupDoneOutputSchema = resultOutputSchema(
  "setup done",
  SetupDoneDataSchema,
);

/** `setup accept` output: envelope + the landing preview/result `data`. */
export const SetupAcceptOutputSchema = resultOutputSchema(
  "setup accept",
  SetupAcceptDataSchema,
);

/** `config` output: envelope + applied/planned TOML edits. */
export const ConfigOutputSchema = resultOutputSchema(
  "config",
  ConfigDataSchema,
);

/** `licenses` output: envelope + embedded component inventory. */
export const LicensesOutputSchema = resultOutputSchema(
  "licenses",
  LicensesDataSchema,
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

/** Bare `discern --json` is a controlled command-required refusal. */
export const DiscernOutputSchema = datalessResultOutputSchema("discern");

/** A bare `worktree --json` is a controlled subcommand-required refusal. */
export const WorktreeOutputSchema = datalessResultOutputSchema("worktree");

/** A bare `skills --json` is a controlled subcommand-required refusal. */
export const SkillsOutputSchema = datalessResultOutputSchema("skills");

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
