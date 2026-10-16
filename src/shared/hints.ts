/**
 * The hint registry — the single table of every advisory hint the engine and
 * installer can emit into a result's `hints[]` channel (ADR 0172). Entries live
 * in one catalog per emitting surface under `./hints/`; this module composes
 * them and owns the channel: firing, recovery, and terminal projection.
 *
 * A hint is an entry here, never an inline string at an emission site: the
 * closed set is what lets the gate validate quoted `discern` commands against
 * the live verb registry, lets renderers drop agent-only hints by id instead
 * of string equality, lets the logbook record which hints fired, and lets
 * tests assert a hint by rendering its entry rather than pinning prose.
 *
 * In process a fired hint is an id/text pair ({@link FiredHint}); on the wire
 * the envelope's `hints` stays `string[]`, so ids never reach a public
 * contract. Entry documentation carries rationale and provenance; rendered
 * template text stays self-contained (no internal decision numbers — the
 * ADR-citation guard holds for these strings like any other).
 */

import {
  appendHintTexts,
  firedHintsFromTexts,
  hintTexts,
} from "./hint_projection.ts";
import type { DiscernResult, ErrorSlug, FailedStage } from "./result.ts";
import {
  extractCommandRefs,
  renderCommandRefsCli,
} from "./command_reference.ts";
import type {
  GeneratedDriftRemedyParams,
  HintAudience,
  HintDef,
} from "./hints/define.ts";
import { STATUS_HINTS } from "./hints/status.ts";
import { ARTIFACT_HINTS } from "./hints/artifacts.ts";
import { ANALYSIS_HINTS } from "./hints/analysis.ts";
import { GATE_HINTS } from "./hints/gate.ts";
import { STANDARDS_HINTS } from "./hints/standards.ts";
import { LIFECYCLE_HINTS } from "./hints/lifecycle.ts";
import { SETUP_HINTS } from "./hints/setup.ts";
import { COMMAND_HINTS } from "./hints/commands.ts";
export {
  appendHintTexts,
  firedHintsFromTexts,
  hintTexts,
  mergeHintTexts,
  resolveHintTextsForSurface,
  resolveResultHintsForSurface,
} from "./hint_projection.ts";
export {
  defineHint,
  type HintAudience,
  type HintCategory,
  type HintDef,
  type HintFollowThroughRule,
} from "./hints/define.ts";

/** A hint fired at a call site: the in-process pair; only `text` reaches the wire. */
export interface FiredHint {
  readonly id: string;
  /** Canonical wire text; terminal renderers may use `interactiveText`. */
  readonly text: string;
  /**
   * The authored template text with its command-reference tokens intact,
   * retained only when it differs from `text` — the representation a
   * non-CLI surface re-renders from ({@link resolveHintTextsForSurface}).
   */
  readonly authored?: string;
  /** Human-terminal projection when it differs from the wire text. */
  readonly interactiveText?: string;
}

/**
 * Fire a registry entry. A parameterless entry (`HintDef<undefined>`) is fired with
 * no second argument; a parameterized one requires its params — the
 * conditional tuple makes the compiler enforce both.
 *
 * The template's command-reference tokens resolve to their CLI spelling here.
 * That canonical text reaches the wire; an optional terminal projection rides
 * beside it, while the authored token form remains available to MCP.
 */
export function fire<P>(
  def: HintDef<P>,
  ...params: P extends void ? [] : [params: P]
): FiredHint {
  const [p] = params;
  // The tuple type above guarantees `p` is `P` exactly when the template
  // needs it; the cast bridges what the conditional tuple cannot express.
  const authored = def.template(p as P);
  const text = renderCommandRefsCli(authored);
  const interactiveAuthored = def.interactiveTemplate?.(p as P);
  const interactiveText = interactiveAuthored === undefined
    ? undefined
    : renderCommandRefsCli(interactiveAuthored);
  return {
    id: def.id,
    text,
    ...(text === authored ? {} : { authored }),
    ...(interactiveText === undefined || interactiveText === text
      ? {}
      : { interactiveText }),
  };
}

/**
 * Fire a decision reserved for the owner. Fleet-status composition routes
 * every cross-effort lifecycle judgment through this assertion, so a new
 * sibling cannot silently become the reading agent's next step.
 */
export function fireOwnerAttention<P>(
  def: HintDef<P>,
  ...params: P extends void ? [] : [params: P]
): FiredHint {
  if (def.category !== "owner-attention") {
    throw new Error(
      `owner-attention hint ${def.id} is classified as ${def.category}`,
    );
  }
  const fired = fire(def, ...params);
  const callerCommands = fired.authored === undefined
    ? []
    : extractCommandRefs(fired.authored).filter((reference) =>
      reference.executor === "caller"
    );
  if (callerCommands.length > 0) {
    throw new Error(
      `owner-attention hint ${def.id} carries an agent-executed command`,
    );
  }
  return fired;
}

/**
 * Merge catalogs into one registry, refusing an id two catalogs both
 * claim: an object spread would let the later entry silently replace the
 * earlier one.
 */
export function mergeHintCatalogs<C extends readonly object[]>(
  ...catalogs: C
): UnionToIntersection<C[number]> {
  const merged: Record<string, unknown> = {};
  for (const catalog of catalogs) {
    for (const [id, def] of Object.entries(catalog)) {
      if (Object.hasOwn(merged, id)) {
        throw new Error(`hint id ${id} is registered by two catalogs`);
      }
      merged[id] = def;
    }
  }
  return merged as UnionToIntersection<C[number]>;
}

/** The intersection of every member of a union. */
type UnionToIntersection<U> =
  (U extends unknown ? (member: U) => void : never) extends
    (member: infer I) => void ? I : never;

/**
 * The registry: every hint, keyed by id. Each catalog holds the entries of
 * the surface that emits them; this is the one table emission sites fire from
 * and the closed set the guards, renderers, and logbook key on.
 */
export const HINTS = mergeHintCatalogs(
  STATUS_HINTS,
  ARTIFACT_HINTS,
  ANALYSIS_HINTS,
  GATE_HINTS,
  STANDARDS_HINTS,
  LIFECYCLE_HINTS,
  SETUP_HINTS,
  COMMAND_HINTS,
);

const ACTIONABLE_HINT_IDS = new Set(
  Object.values(HINTS)
    .filter((def) => def.category === "next-step")
    .map((def) => def.id),
);

/** Evidence the generic failure-recovery instruction can truthfully cite. */
export const FAILURE_RECOVERY_EVIDENCE = ["message", "diagnostic"] as const;
export type FailureRecoveryEvidence =
  (typeof FAILURE_RECOVERY_EVIDENCE)[number];

/** Whether one canonical error family may use the evidence-backed generic
 * floor or must carry a narrower registered instruction. This total satellite
 * of {@link ErrorSlug} records the semantic audit: a new slug cannot compile
 * until its recovery contract is classified. */
export type FailureRecoveryMode = "evidence" | "tailored";

/** Error-less applied failures form one explicit compatibility family. Their
 * first diagnostic or message is the only recovery evidence available; a
 * data-only result still fails closed at the boundary. */
export const ERRORLESS_FAILURE_RECOVERY: FailureRecoveryMode = "evidence";

export const ERROR_FAILURE_RECOVERY = {
  active_worktrees: "evidence",
  ambiguous: "tailored",
  apply_failed: "evidence",
  awaiting_consent: "tailored",
  awaiting_declaration: "tailored",
  awaiting_variance: "tailored",
  awaiting_standard_approval: "tailored",
  below_min_score: "tailored",
  brief_unparseable: "evidence",
  checkout_failed: "evidence",
  checkpoint_evidence_unavailable: "evidence",
  config_template_unavailable: "evidence",
  confirmation_required: "evidence",
  conflict: "evidence",
  desk_already_active: "evidence",
  detached_head: "evidence",
  diagrams_misaligned: "evidence",
  dirty_worktree: "evidence",
  edit_failed: "evidence",
  gate_failed: "evidence",
  gitignore_template_unavailable: "evidence",
  identity_failed: "evidence",
  incomplete: "tailored",
  internal_error: "evidence",
  invalid_arguments: "evidence",
  invalid_config: "evidence",
  invalid_config_file: "evidence",
  invalid_migrated_config: "evidence",
  invalid_settings_file: "evidence",
  invalid_toml: "evidence",
  invalid_value: "evidence",
  no_docs: "evidence",
  no_map: "evidence",
  no_project: "evidence",
  no_repository: "evidence",
  no_trunk: "evidence",
  not_main_checkout: "evidence",
  not_on_trunk: "evidence",
  not_on_setup_branch: "evidence",
  partial_acceptance: "tailored",
  partial_materialization: "tailored",
  partial_refresh: "tailored",
  pin_failed: "evidence",
  proposal_failed: "evidence",
  proposal_stale: "evidence",
  precondition_failed: "evidence",
  provisioned_resources: "evidence",
  read_failed: "evidence",
  report_only_proof: "tailored",
  renamed_command: "evidence",
  renamed_config_key: "evidence",
  schema_version_too_new: "evidence",
  script_not_executable: "evidence",
  script_not_a_command: "evidence",
  setup_plan_failed: "evidence",
  setup_unfinished: "evidence",
  skills_eject_failed: "evidence",
  tables_malformed: "evidence",
  templates_not_found: "evidence",
  tidy_parse_failed: "evidence",
  tidy_write_failed: "evidence",
  unchanged_tree_rerun: "tailored",
  unknown_category: "evidence",
  unknown_command: "tailored",
  unknown_key: "evidence",
  unknown_standard: "evidence",
  unknown_step: "evidence",
  unknown_target: "tailored",
  write_denied: "evidence",
} as const satisfies Record<ErrorSlug, FailureRecoveryMode>;

const FAILURE_RECOVERY_EVIDENCE_READERS = {
  message: (result: DiscernResult): boolean =>
    result.message !== undefined && result.message.trim().length > 0,
  diagnostic: (result: DiscernResult): boolean =>
    result.diagnostics?.[0] !== undefined,
} satisfies Record<
  FailureRecoveryEvidence,
  (result: DiscernResult) => boolean
>;

/** Whether the generic instruction can point at evidence the envelope carries. */
export function hasFailureRecoveryEvidence(result: DiscernResult): boolean {
  return FAILURE_RECOVERY_EVIDENCE.some((evidence) =>
    FAILURE_RECOVERY_EVIDENCE_READERS[evidence](result)
  );
}

/** Resolve the recovery contract for a failed result. */
export function failureRecoveryMode(
  result: DiscernResult,
): FailureRecoveryMode {
  return result.error === undefined
    ? ERRORLESS_FAILURE_RECOVERY
    : ERROR_FAILURE_RECOVERY[result.error];
}

/** Fire the registered actionable floor for a failed result. */
export function failureRecoveryHint(verb: string): FiredHint {
  return fire(HINTS["failure-recovery"], { verb });
}

/** Project the actionable fallback onto an envelope without losing its identity. */
export function failureRecoveryHintTexts(verb: string): string[] {
  return hintTexts([failureRecoveryHint(verb)]);
}

/**
 * Whether an envelope carries at least one fired, registered `next-step`
 * instruction. Plain strings, unknown ids, notices, and guardrails do not
 * satisfy recovery: only identity retained by {@link hintTexts} counts.
 */
export function hasRegisteredActionableHint(
  texts: readonly string[] | undefined,
): boolean {
  return firedHintsFromTexts(texts).some((hint) =>
    ACTIONABLE_HINT_IDS.has(hint.id)
  );
}

/** Whether the result explicitly carries the generic recovery fallback. */
export function hasGenericFailureRecoveryHint(
  texts: readonly string[] | undefined,
): boolean {
  return firedHintsFromTexts(texts).some((hint) =>
    hint.id === "failure-recovery"
  );
}

/**
 * Add the registered recovery floor to a failed result only when its audited
 * family permits it, no narrower next step is present, and the result carries
 * the message or diagnostic the instruction tells the caller to use. Both CLI
 * and MCP call this before serialization, so their wire envelopes and locally
 * observed hint ids stay identical. Every other failure must supply a tailored
 * next step.
 */
export function withFailureRecoveryHint<TData>(
  result: DiscernResult<TData>,
): DiscernResult<TData> {
  if (
    result.ok || hasRegisteredActionableHint(result.hints) ||
    failureRecoveryMode(result) !== "evidence" ||
    !hasFailureRecoveryEvidence(result)
  ) {
    return result;
  }
  return {
    ...result,
    hints: appendHintTexts(result.hints, [failureRecoveryHint(result.verb)]),
  };
}

/** Bind a parameterized entry to its example for parameterless totality audits. */
function exampleBoundHint<P>(def: HintDef<P>): HintDef<undefined> {
  const interactive = def.interactiveTemplate;
  return {
    ...def,
    example: undefined,
    template: (): string => def.template(def.example),
    interactiveTemplate: interactive === undefined
      ? undefined
      : (): string => interactive(def.example),
  };
}

/** Failed-stage lookup into the registry. Total over {@link FailedStage}, so a
 * new stage cannot compile until its remedy is registered and enrolled here. */
export const GATE_FAILURE_REMEDIES = {
  fix: HINTS["gate-failure-fix"],
  build: HINTS["gate-failure-build"],
  check: HINTS["gate-failure-check"],
  test: HINTS["gate-failure-test"],
  "check/test": HINTS["gate-failure-check-test"],
  scope_gates: HINTS["gate-failure-scope-gates"],
  tree_drift: HINTS["gate-failure-tree-drift"],
  generated_drift: exampleBoundHint(HINTS["gate-failure-generated-drift"]),
  refresh_drift: HINTS["gate-failure-refresh-drift"],
  tracked_artifacts: HINTS["gate-failure-tracked-artifacts"],
  instructions: HINTS["gate-failure-instructions"],
  skills: HINTS["gate-failure-skills"],
  skill_frontmatter: HINTS["gate-failure-skill-frontmatter"],
  adr_numbers: HINTS["gate-failure-adr-numbers"],
  adr_index: HINTS["gate-failure-adr-index"],
  map_integrity: HINTS["gate-failure-map-integrity"],
  merge: HINTS["gate-failure-merge"],
  standards: HINTS["gate-failure-standards"],
  write_denied: HINTS["gate-failure-write-denied"],
  validation_inputs: HINTS["gate-failure-validation-inputs"],
} as const satisfies Record<FailedStage, HintDef<undefined>>;

/** Fire the registered remedy for a failed gate stage. Generated-drift callers
 * pass the owning group; the example fallback keeps closed-set audits total
 * before the stage gains its wave-2 producer. */
export function gateFailureRemedy(
  stage: FailedStage,
  generated?: GeneratedDriftRemedyParams,
): FiredHint {
  if (stage === "generated_drift" && generated !== undefined) {
    return fire(HINTS["gate-failure-generated-drift"], generated);
  }
  return fire(GATE_FAILURE_REMEDIES[stage]);
}

/** True when a fired registry entry targets the requested audience. */
export function hintHasAudience(
  fired: FiredHint,
  audience: HintAudience,
): boolean {
  const defs = Object.values(HINTS) as readonly {
    readonly id: string;
    readonly audience: HintAudience;
  }[];
  return defs.some((def) => def.id === fired.id && def.audience === audience);
}

/**
 * The fired entries the interactive terminal presentation prints: agent-audience
 * entries drop, everything else passes in order. The wire result always carries
 * the full channel.
 */
export function interactiveHints(
  fired: readonly FiredHint[],
): FiredHint[] {
  return fired
    .filter((hint) => !hintHasAudience(hint, "agent"))
    .map((hint) =>
      hint.interactiveText === undefined
        ? hint
        : { ...hint, text: hint.interactiveText }
    );
}

/**
 * Project a result's wire hints for an interactive terminal presentation. Entries
 * whose recovered in-process identity is agent-audience drop; texts with no
 * identity pass through unchanged. Pass the envelope's own `hints` array —
 * identity recovery keys on the exact array object, so a copy loses it.
 */
export function interactiveHintTexts(
  texts: readonly string[] | undefined,
): string[] {
  if (texts === undefined) {
    return [];
  }
  const drop = new Set(
    firedHintsFromTexts(texts)
      .filter((hint) => hintHasAudience(hint, "agent"))
      .map((hint) => hint.text),
  );
  const replacements = new Map(
    firedHintsFromTexts(texts)
      .filter((hint) => !hintHasAudience(hint, "agent"))
      .flatMap((hint) =>
        hint.interactiveText === undefined
          ? []
          : [[hint.text, hint.interactiveText] as const]
      ),
  );
  return texts
    .filter((text) => !drop.has(text))
    .map((text) => replacements.get(text) ?? text);
}
