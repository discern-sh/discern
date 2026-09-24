/**
 * The semantic completion authority for every public result verb.
 *
 * `DiscernResult` makes structural contradictions unrepresentable; this module
 * makes the meaning of `ok` uniform. A policy names the typed postconditions a
 * verb requires, the degradations it may report as advisories, and how refusal,
 * cancellation, partial effects, no-ops, and recovery are classified. The
 * public result-contract registry proves one-to-one parity with this table.
 */

import {
  type DiscernResult,
  type ErrorSlug,
  type ResultAdvisory,
  type ResultAdvisoryKind,
  stepResultSatisfiesCompletion,
} from "./result.ts";
import { appendHintTexts, fire, firedHintsFromTexts, HINTS } from "./hints.ts";
import { SETUP_BRANCH } from "./git_conventions.ts";
import {
  ACCEPT_PROOF_NOTE_RETRY,
  PROOF_NOTE_FETCH_REPAIR,
  PROOF_NOTE_MISSING,
  proofNoteOwed,
  setupProofNoteRetry,
} from "./proof_note_recovery.ts";

export const RESULT_REQUIRED_POSTCONDITIONS = [
  "declared-outcome",
  "executed-steps",
  "instruction-refresh",
  "refresh-artifacts",
  "doctor-checks",
  "gate-finish",
  "setup-completion",
  "setup-landing",
  "accept-landing",
  "skill-materialization",
] as const;
export type ResultRequiredPostcondition =
  (typeof RESULT_REQUIRED_POSTCONDITIONS)[number];

export const RESULT_COMPLETION_STATES = [
  "required-success",
  "required-failure",
  "partial-effect",
  "refusal",
  "cancellation",
  "no-op",
  "optional-advisory",
] as const;
export type ResultCompletionState = (typeof RESULT_COMPLETION_STATES)[number];

export type ResultCancellationPolicy =
  | "failure"
  | "successful-no-effect"
  | "not-applicable";
export type ResultApplicability = "failure" | "not-applicable";
export type ResultNoOpPolicy = "success" | "not-applicable";
export type ResultRecoveryOwner = "caller" | "discern" | "owner" | "none";

/** One verb's complete semantic state table. */
export interface ResultCompletionPolicy {
  readonly requiredPostconditions: readonly ResultRequiredPostcondition[];
  readonly optionalAdvisories: readonly ResultAdvisoryKind[];
  readonly refusal: "failure";
  readonly cancellation: ResultCancellationPolicy;
  readonly partialEffect: ResultApplicability;
  readonly noOp: ResultNoOpPolicy;
  readonly recoveryOwner: ResultRecoveryOwner;
}

interface PolicyOptions {
  readonly required?: readonly ResultRequiredPostcondition[];
  readonly advisories?: readonly ResultAdvisoryKind[];
  readonly cancellation?: ResultCancellationPolicy;
  readonly partialEffect?: ResultApplicability;
  readonly noOp?: ResultNoOpPolicy;
  readonly recoveryOwner?: ResultRecoveryOwner;
}

/** Build one read-only/observational policy without hiding its state choices. */
function observationPolicy(
  options: PolicyOptions = {},
): ResultCompletionPolicy {
  return {
    requiredPostconditions: options.required ?? ["declared-outcome"],
    optionalAdvisories: options.advisories ?? [],
    refusal: "failure",
    cancellation: options.cancellation ?? "not-applicable",
    partialEffect: options.partialEffect ?? "not-applicable",
    noOp: options.noOp ?? "success",
    recoveryOwner: options.recoveryOwner ?? "caller",
  };
}

/** Build one plan/apply policy; a failed or cancelled required step is red. */
function effectPolicy(options: PolicyOptions = {}): ResultCompletionPolicy {
  return {
    requiredPostconditions: options.required ?? [
      "declared-outcome",
      "executed-steps",
    ],
    optionalAdvisories: options.advisories ?? [],
    refusal: "failure",
    cancellation: options.cancellation ?? "failure",
    partialEffect: options.partialEffect ?? "failure",
    noOp: options.noOp ?? "success",
    recoveryOwner: options.recoveryOwner ?? "caller",
  };
}

/**
 * Exactly one completion policy per serialized verb. Literal keys are retained
 * for the compile-time parity assertion in `result_contracts.ts`; the exported
 * widened view below supports lookup by a runtime discriminator.
 */
export const RESULT_COMPLETION_POLICY_DEFINITIONS = {
  discern: observationPolicy(),
  help: observationPolicy(),
  setup: observationPolicy(),
  "setup begin": effectPolicy({
    required: [
      "declared-outcome",
      "executed-steps",
      "instruction-refresh",
    ],
    advisories: ["setup-machinery-commit-failed"],
  }),
  "setup verify": observationPolicy(),
  "setup step": observationPolicy(),
  "setup done": effectPolicy({
    required: [
      "declared-outcome",
      "executed-steps",
      "setup-completion",
    ],
    advisories: [
      "checkpoint-evidence-dropped",
      "setup-unproven-completion",
      "proof-recording-unavailable",
      "acceptance-cleanup-incomplete",
      "setup-marker-commit-failed",
    ],
  }),
  "setup accept": effectPolicy({
    required: [
      "declared-outcome",
      "executed-steps",
      "setup-landing",
    ],
    advisories: [
      "proof-recording-unavailable",
      "acceptance-cleanup-incomplete",
    ],
    noOp: "success",
    recoveryOwner: "owner",
  }),
  upgrade: effectPolicy({
    required: [
      "declared-outcome",
      "executed-steps",
      "instruction-refresh",
    ],
    advisories: ["generated-attribute-pattern-untranslated"],
  }),
  uninstall: effectPolicy({
    advisories: ["uninstall-strip-incomplete"],
    cancellation: "successful-no-effect",
  }),
  doctor: observationPolicy({
    required: ["declared-outcome", "doctor-checks"],
    advisories: ["doctor-warning"],
  }),
  licenses: observationPolicy(),
  releases: observationPolicy(),
  triangle: observationPolicy(),
  map: observationPolicy(),
  docs: observationPolicy(),
  config: effectPolicy(),
  done: effectPolicy({
    required: ["declared-outcome", "executed-steps", "gate-finish"],
    advisories: [
      "checkpoint-evidence-dropped",
      "execution-cap-unavailable",
      "governing-config-key-ignored",
      "landing-authority-unverified",
      "proof-recording-unavailable",
      "standards-limits-unverified",
    ],
  }),
  prepare: effectPolicy({
    advisories: [
      "execution-cap-unavailable",
      "governing-config-key-ignored",
    ],
  }),
  test: effectPolicy({ advisories: ["execution-cap-unavailable"] }),
  improvement: observationPolicy(),
  checkpoints: observationPolicy({
    advisories: ["checkpoint-evidence-dropped"],
  }),
  progress: observationPolicy(),
  standards: effectPolicy({
    advisories: [
      "execution-cap-unavailable",
      "standards-limits-unverified",
    ],
  }),
  "standards propose": effectPolicy(),
  refresh: effectPolicy({
    required: [
      "declared-outcome",
      "executed-steps",
      "refresh-artifacts",
    ],
  }),
  tidy: effectPolicy(),
  impact: observationPolicy(),
  coupling: observationPolicy(),
  await: observationPolicy({ cancellation: "successful-no-effect" }),
  patterns: observationPolicy(),
  "patterns reset": effectPolicy({ cancellation: "successful-no-effect" }),
  "patterns seal": effectPolicy({ cancellation: "successful-no-effect" }),
  "patterns archives": observationPolicy(),
  desk: effectPolicy({ cancellation: "successful-no-effect" }),
  enter: observationPolicy(),
  status: observationPolicy({
    advisories: ["landing-authority-unverified"],
  }),
  start: effectPolicy({
    advisories: [
      "landing-authority-unverified",
      "optional-resource-unavailable",
    ],
    noOp: "not-applicable",
  }),
  accept: effectPolicy({
    required: ["declared-outcome", "executed-steps", "accept-landing"],
    advisories: [
      "acceptance-cleanup-incomplete",
      "checkpoint-evidence-dropped",
      "checkout-clean-observation-unavailable",
      "ignored-file-observation-unavailable",
      "landing-authority-unverified",
      "proof-recording-unavailable",
    ],
    noOp: "success",
    recoveryOwner: "owner",
  }),
  update: effectPolicy(),
  identity: observationPolicy(),
  scripts: effectPolicy(),
  worktree: observationPolicy(),
  "worktree setup": effectPolicy({
    advisories: ["optional-resource-unavailable"],
  }),
  "worktree ensure": effectPolicy({
    advisories: ["optional-resource-unavailable"],
  }),
  "worktree rename": effectPolicy(),
  "worktree teardown": effectPolicy(),
  "worktree drop": effectPolicy(),
  "worktree park": effectPolicy(),
  "worktree prune": effectPolicy({ cancellation: "successful-no-effect" }),
  skills: observationPolicy(),
  "skills list": observationPolicy(),
  "skills eject": effectPolicy({
    required: [
      "declared-outcome",
      "executed-steps",
      "skill-materialization",
    ],
  }),
} as const satisfies Readonly<Record<string, ResultCompletionPolicy>>;

export type RegisteredCompletionPolicyVerb =
  keyof typeof RESULT_COMPLETION_POLICY_DEFINITIONS;

/** Runtime lookup view keyed by the envelope discriminator. */
export const RESULT_COMPLETION_POLICIES: Readonly<
  Record<string, ResultCompletionPolicy>
> = RESULT_COMPLETION_POLICY_DEFINITIONS;

export interface CompletionPolicyCoverage {
  readonly missing: string[];
  readonly stale: string[];
  readonly duplicates: string[];
}

/**
 * Reconcile an injected live verb universe against an injected policy entry set.
 * Injection lets the guard prove missing, stale, and duplicate future members.
 */
export function completionPolicyCoverage(
  verbs: readonly string[],
  entries: readonly (readonly [string, ResultCompletionPolicy])[] = Object
    .entries(RESULT_COMPLETION_POLICIES),
): CompletionPolicyCoverage {
  const expected = new Set(verbs);
  const counts = new Map<string, number>();
  for (const [verb] of entries) {
    counts.set(verb, (counts.get(verb) ?? 0) + 1);
  }
  return {
    missing: [...expected].filter((verb) => !counts.has(verb)).sort(),
    stale: [...counts.keys()].filter((verb) => !expected.has(verb)).sort(),
    duplicates: [...counts.entries()].flatMap(([verb, count]) =>
      count > 1 ? [`${verb}: ${count}`] : []
    ).sort(),
  };
}

/** Abstract state-table verdict used by the exhaustive policy audit. */
export function completionStateVerdict(
  policy: ResultCompletionPolicy,
  state: ResultCompletionState,
): boolean {
  switch (state) {
    case "required-success":
      return true;
    case "no-op":
      return policy.noOp === "success";
    case "optional-advisory":
      return policy.optionalAdvisories.length > 0;
    case "required-failure":
    case "partial-effect":
    case "refusal":
      return false;
    case "cancellation":
      return policy.cancellation === "successful-no-effect";
  }
}

type UnknownRecord = Readonly<Record<string, unknown>>;

/** Narrow an unknown result payload value to a non-array record. */
function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

/** Keep only record members from an unknown array-shaped payload value. */
function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      const item = record(entry);
      return item === undefined ? [] : [item];
    })
    : [];
}

/** Return one trimmed non-empty string from an unknown payload value. */
function nonBlank(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/** Keep the trimmed non-empty string members of an unknown array value. */
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
      const text = nonBlank(entry);
      return text === undefined ? [] : [text];
    })
    : [];
}

/**
 * The retry each note-recording verb serves when its landing's Proof note is
 * owed. Each landing keeps what its retry needs — the effort's checkout for
 * acceptance, the setup branch for setup acceptance — so every entry names a
 * live command; a verb that owes a note without an entry is an invariant
 * failure, never a vague recovery.
 */
export const PROOF_NOTE_RETRIES: Readonly<
  Record<string, (data: UnknownRecord | undefined) => string>
> = {
  accept: () => ACCEPT_PROOF_NOTE_RETRY,
  "setup accept": (data) =>
    setupProofNoteRetry(
      nonBlank(data?.branch) ?? SETUP_BRANCH,
      nonBlank(data?.target) ?? "the trunk",
    ),
};

interface RequiredPostconditionFailure {
  readonly error: ErrorSlug;
  readonly message: string;
}

/** Construct one classified required-postcondition failure. */
function failed(
  error: ErrorSlug,
  message: string,
): RequiredPostconditionFailure {
  return { error, message };
}

/** Evaluate setup or upgrade's discriminated instruction-refresh outcome. */
function instructionRefreshFailure(
  result: DiscernResult,
): RequiredPostconditionFailure | undefined {
  const data = record(result.data);
  const refresh = record(data?.instruction_refresh);
  if (refresh === undefined) {
    const observationalMode = result.steps === undefined &&
      (data?.already_set_up === true || data?.check === true ||
        data?.phase === "fresh" || data?.phase === "in_progress" ||
        data?.phase === "done");
    return result.dry_run === true || observationalMode ? undefined : failed(
      "partial_refresh",
      "The applied result omitted its required discriminated instruction-refresh outcome.",
    );
  }
  if (refresh.status !== "complete") {
    return failed(
      "partial_refresh",
      "The required instruction refresh did not complete; applied effects were preserved and the result names a safe retry.",
    );
  }
  return undefined;
}

/** Emergency success is separate from ordinary Proof and landing. */
function emergencyCompletionFailure(
  data: Record<string, unknown>,
  emergency: Record<string, unknown>,
): RequiredPostconditionFailure | undefined {
  const independent = ["proof", "proof_line", "proof_note", "landing", "queue"]
    .every((key) => data[key] === undefined);
  const prepared = emergency.outcome === "prepared" &&
    nonBlank(emergency.preparation) !== undefined &&
    emergency.confirmation === undefined && emergency.landing_id === undefined;
  const landed = emergency.outcome === "landed" &&
    ["landing_id", "candidate_id", "reason"].every((key) =>
      nonBlank(emergency[key]) !== undefined
    ) && Array.isArray(emergency.exceptions) &&
    emergency.note === "published" &&
    (emergency.cleanup === "removed" || emergency.cleanup === "kept");
  return independent && (prepared || landed) ? undefined : failed(
    "partial_acceptance",
    "Emergency success requires a preparation receipt or a recorded landing with settled cleanup. It cannot carry ordinary Proof or acceptance claims. Preserve the recorded effects before recovery.",
  );
}

/** Evaluate one named typed postcondition against an unevaluated result. */
function requiredFailure(
  postcondition: ResultRequiredPostcondition,
  result: DiscernResult,
): RequiredPostconditionFailure | undefined {
  const data = record(result.data);
  switch (postcondition) {
    case "declared-outcome":
      return result.ok
        ? undefined
        : failed("precondition_failed", "The verb reported non-completion.");
    case "executed-steps": {
      const requiredFailures =
        result.steps?.filter((step) => !stepResultSatisfiesCompletion(step)) ??
          [];
      return requiredFailures.length === 0 ? undefined : failed(
        result.verb === "accept" &&
          record(data?.landing)?.trunk_landed === true
          ? "partial_acceptance"
          : "apply_failed",
        result.verb === "accept" &&
          record(data?.landing)?.trunk_landed === true
          ? `${requiredFailures.length} required post-landing step(s) failed after the trunk moved; data.landing and steps preserve the exact effects and recovery evidence.`
          : `${requiredFailures.length} required step(s) failed or were cancelled.`,
      );
    }
    case "instruction-refresh":
      return instructionRefreshFailure(result);
    case "refresh-artifacts": {
      if (result.dry_run === true) return undefined;
      if (data === undefined || !Array.isArray(data.errors)) {
        return failed(
          "partial_refresh",
          "The applied refresh result omitted its required artifact-error account.",
        );
      }
      const errors = Array.isArray(data?.errors) ? data.errors : [];
      return errors.length === 0 ? undefined : failed(
        "partial_refresh",
        `${errors.length} required refresh artifact(s) did not complete; successful effects were preserved.`,
      );
    }
    case "doctor-checks": {
      if (data === undefined || !Array.isArray(data.checks)) {
        return failed(
          "precondition_failed",
          "Doctor omitted its required typed check outcomes.",
        );
      }
      const failures = records(data?.checks).filter((check) =>
        check.status === "fail" ||
        (check.ok === false && check.warn !== true && check.status !== "warn")
      );
      return failures.length === 0 ? undefined : failed(
        "precondition_failed",
        `${failures.length} required doctor check(s) failed.`,
      );
    }
    case "gate-finish":
      if (result.dry_run === true) return undefined;
      if (data === undefined || !("failed_stage" in data)) {
        return failed(
          "gate_failed",
          "The gate result omitted its required finish-stage verdict.",
        );
      }
      return data.failed_stage === null ? undefined : failed(
        "gate_failed",
        `The gate did not complete its required ${
          String(data.failed_stage)
        } stage.`,
      );
    case "setup-completion":
      return result.dry_run === true || data?.bootstrapped === true
        ? undefined
        : failed("incomplete", "Setup did not reach its completion marker.");
    case "setup-landing": {
      const completion = record(data?.completion);
      return result.dry_run === true || data?.landed === true ||
          (completion?.status === "no_op" &&
            (completion.reason === "no_git_repository" ||
              completion.reason === "already_on_target"))
        ? undefined
        : failed("apply_failed", "Setup did not land on its declared target.");
    }
    case "accept-landing": {
      if (result.dry_run === true) return undefined;
      const submission = record(data?.submission);
      if (submission !== undefined) {
        return submission.state === "queued" &&
            typeof submission.submission_id === "string" &&
            submission.submission_id !== "" &&
            typeof submission.submitted_at === "string" &&
            submission.submitted_at !== "" &&
            record(data?.revision) !== undefined &&
            data?.landing === undefined && data?.emergency === undefined
          ? undefined
          : failed(
            "apply_failed",
            "Queue-only acceptance did not record the reviewed submission.",
          );
      }
      const emergency = record(data?.emergency);
      if (emergency !== undefined) {
        return emergencyCompletionFailure(data ?? {}, emergency);
      }
      const landing = record(data?.landing);
      if (landing === undefined) {
        return failed(
          "partial_acceptance",
          "Acceptance omitted the required typed landing-effect state.",
        );
      }
      // The landing is the required effect. A kept checkout is a recorded
      // disposition (later commits, uncommitted changes), never a partial
      // transaction: a genuinely failed cleanup step fails the executed-steps
      // postcondition with its own recovery evidence.
      if (landing.trunk_landed !== true) {
        return failed(
          "partial_acceptance",
          "Acceptance performed only part of its required landing transaction; data.landing records the exact effects.",
        );
      }
      // A queue walk's required outcome covers every landing it attempted: a
      // later refusal or failure makes the call false even though the
      // selected submission landed and stays landed. Effects are preserved,
      // never implied undone.
      const walked = records(data?.landings).filter((outcome) =>
        outcome.status !== "landed"
      );
      return walked.length === 0 ? undefined : failed(
        "partial_acceptance",
        `The selected submission landed and stays landed, but ${
          walked.length === 1
            ? "a further landing in the queue walk"
            : `${walked.length} further landings in the queue walk`
        } did not complete; data.landings records each attempted outcome and its route.`,
      );
    }
    case "skill-materialization": {
      if (result.dry_run === true) return undefined;
      const materialized = record(data?.materialized);
      if (materialized === undefined) {
        return failed(
          "partial_materialization",
          "Skill ejection omitted its required materialization outcome.",
        );
      }
      const errors = Array.isArray(materialized?.errors)
        ? materialized.errors
        : [];
      return errors.length === 0 ? undefined : failed(
        "partial_materialization",
        `${errors.length} required skill materialization target(s) did not complete.`,
      );
    }
  }
}

/** Build one stable identity for deduplicating an exact advisory record. */
function advisoryKey(advisory: ResultAdvisory): string {
  return `${advisory.kind}\u0000${
    advisory.evidence.join("\u0000")
  }\u0000${advisory.next_action}`;
}

/** Lift the optional degradation facts elected by one verb's policy. */
function derivedAdvisories(
  result: DiscernResult,
  policy: ResultCompletionPolicy,
): ResultAdvisory[] {
  const allowed = new Set(policy.optionalAdvisories);
  const found: ResultAdvisory[] = [...(result.advisories ?? [])];
  const data = record(result.data);
  const add = (
    kind: ResultAdvisoryKind,
    evidence: readonly string[],
    nextAction: string,
  ): void => {
    if (!allowed.has(kind) || evidence.length === 0) return;
    found.push({ kind, evidence: [...evidence], next_action: nextAction });
  };

  for (const step of result.steps ?? []) {
    if (step.advisory !== undefined) found.push(step.advisory);
  }

  const machineryError = nonBlank(data?.machinery_commit_error);
  if (machineryError !== undefined) {
    add(
      "setup-machinery-commit-failed",
      [machineryError],
      "Commit the scaffolded discern wiring after fixing the reported Git failure, then continue setup.",
    );
  }
  const markerCommitError = nonBlank(data?.marker_commit_error);
  if (markerCommitError !== undefined) {
    add(
      "setup-marker-commit-failed",
      [markerCommitError],
      "Commit the setup completion marker after repairing the reported Git failure, then run `discern setup done` before relying on the unproven completion.",
    );
  }
  if (data?.setup_completion === "unproven") {
    add(
      "setup-unproven-completion",
      ["Setup completion bypassed gate Proof and the worktree-viability Proof."],
      "Run `discern doctor`, then `discern done`, and review the resulting Proof before relying on this setup.",
    );
  }

  for (const check of records(data?.checks)) {
    if (check.status !== "warn" && check.warn !== true) continue;
    const name = nonBlank(check.name) ?? "doctor check";
    const detail = nonBlank(check.detail) ?? "warning evidence unavailable";
    const fix = nonBlank(check.fix);
    if (fix === undefined) {
      throw new Error(
        `internal result invariant: doctor advisory '${name}' has no next action`,
      );
    }
    add("doctor-warning", [`${name}: ${detail}`], fix);
  }

  for (const item of records(data?.untranslated_gitattributes_patterns)) {
    const group = nonBlank(item.group) ?? "generated path group";
    const pattern = nonBlank(item.pattern) ?? "unknown pattern";
    const reason = nonBlank(item.reason) ?? "pattern was not translated";
    add(
      "generated-attribute-pattern-untranslated",
      [`${group}: ${pattern} — ${reason}`],
      "Review the generated-path pattern, choose an exact supported attribute rule, then run `discern doctor`.",
    );
  }

  for (const item of records(data?.incomplete_strips)) {
    const rel = nonBlank(item.rel) ?? "shared file";
    const reason = nonBlank(item.reason) ?? "template-owned entries remain";
    add(
      "uninstall-strip-incomplete",
      [`${rel}: ${reason}`],
      "Remove the listed discern-owned entries by hand after verifying the remaining content is project-owned.",
    );
  }

  const standardsLimits = record(data?.standards_limits);
  if (standardsLimits?.status === "unverified") {
    add(
      "standards-limits-unverified",
      [nonBlank(standardsLimits.reason) ?? "the trunk limits were unavailable"],
      "Make the trunk configuration available, then re-run the same gate or standards command.",
    );
  }

  const gateProof = record(data?.gate_proof);
  if (
    gateProof?.status === "unavailable" ||
    gateProof?.status === "record_failed" ||
    gateProof?.status === "clear_failed"
  ) {
    add(
      "proof-recording-unavailable",
      [
        nonBlank(gateProof.reason) ??
          `Proof state: ${String(gateProof.status)}`,
      ],
      "Repair the reported Proof storage problem, then re-run the command that records or clears Proof.",
    );
  }

  const proofNote = record(data?.proof_note);
  const proofFetch = record(proofNote?.fetch);
  const proofWrite = record(proofNote?.write);
  if (proofFetch?.status === "failed") {
    add(
      "proof-recording-unavailable",
      strings(proofFetch.errors),
      PROOF_NOTE_FETCH_REPAIR,
    );
  }
  if (
    proofWrite?.status === "record_failed" ||
    proofWrite?.status === "missing_proof"
  ) {
    let nextAction = PROOF_NOTE_MISSING;
    if (proofNoteOwed(proofWrite)) {
      const retry = PROOF_NOTE_RETRIES[result.verb];
      if (retry === undefined) {
        throw new Error(
          `internal result invariant: \`discern ${result.verb}\` owes a Proof note but names no retry`,
        );
      }
      nextAction = retry(data);
    }
    add(
      "proof-recording-unavailable",
      [
        nonBlank(proofWrite.reason) ??
          `Proof note: ${String(proofWrite.status)}`,
      ],
      nextAction,
    );
  }

  const checkpointContainers = [
    data?.checkpoint_drops,
    data?.drops,
    record(data?.checkpoints)?.drops,
    record(data?.proof)?.checkpoint_drops,
  ];
  for (const drop of checkpointContainers.flatMap(records)) {
    const scope = drop.scope === "checkpoint"
      ? nonBlank(drop.checkpoint) ?? "checkpoint"
      : "checkpoint policy";
    const reason = nonBlank(drop.reason) ?? "enforcement evidence unavailable";
    const account = nonBlank(drop.account) ?? "no further account was recorded";
    add(
      "checkpoint-evidence-dropped",
      [`${scope}: ${reason} — ${account}`],
      "Review the typed checkpoint drop, restore the missing evidence where possible, and re-run the same command before relying on checkpoint enforcement.",
    );
  }

  // A branch kept for an owed Proof note is the note's retry route, never
  // leftover cleanup.
  if (
    data?.landed === true && data.branch_deleted === false &&
    !proofNoteOwed(proofWrite)
  ) {
    const branch = nonBlank(data.branch) ?? "the landed branch";
    add(
      "acceptance-cleanup-incomplete",
      [`${branch} remains after landing.`],
      `Delete ${branch} after confirming it is fully merged.`,
    );
  }
  const proofClearError = nonBlank(data?.proof_clear_error);
  if (proofClearError !== undefined) {
    add(
      "acceptance-cleanup-incomplete",
      [proofClearError],
      "Clear the stale local gate Proof after confirming the landed commit remains recorded.",
    );
  }

  const ignored = record(data?.ignored_file_changes);
  if (
    ignored?.status === "baseline_missing" || ignored?.status === "unavailable"
  ) {
    add(
      "ignored-file-observation-unavailable",
      [`Ignored-file observation: ${String(ignored.status)}.`],
      "Inspect checkout-local generated files in the landed checkout before relying on their convergence.",
    );
  }

  const authorityWarnings = [
    ...strings(data?.authority_warnings),
    ...strings(record(data?.landing_authority)?.warnings),
  ];
  for (const warning of authorityWarnings) {
    const evidence = nonBlank(warning);
    if (evidence !== undefined) {
      add(
        "landing-authority-unverified",
        [evidence],
        "Review the exact landing authority and obtain owner consent before any uncovered landing action.",
      );
    }
  }

  const hintAdvisories = {
    "gate-test-slots-unavailable": "execution-cap-unavailable",
    "gate-standards-limits-unverified": "standards-limits-unverified",
    "standards-limits-unverified": "standards-limits-unverified",
    "gate-proof-unavailable": "proof-recording-unavailable",
  } as const satisfies Readonly<Record<string, ResultAdvisoryKind>>;
  for (const hint of firedHintsFromTexts(result.hints)) {
    const kind = hintAdvisories[hint.id as keyof typeof hintAdvisories];
    if (kind === undefined) continue;
    add(kind, [hint.text], hint.text);
  }

  const unique = new Map(
    found.map((advisory) => [advisoryKey(advisory), advisory]),
  );
  return [...unique.values()];
}

/** Reject an advisory missing evidence, recovery, or verb-policy enrollment. */
function validateAdvisories(
  result: DiscernResult,
  policy: ResultCompletionPolicy,
  advisories: readonly ResultAdvisory[],
): void {
  const allowed = new Set(policy.optionalAdvisories);
  for (const advisory of advisories) {
    if (!allowed.has(advisory.kind)) {
      throw new Error(
        `internal result invariant: \`discern ${result.verb}\` does not permit advisory kind '${advisory.kind}'`,
      );
    }
    if (
      advisory.evidence.length === 0 ||
      advisory.evidence.some((item) => item.trim() === "") ||
      advisory.next_action.trim() === ""
    ) {
      throw new Error(
        `internal result invariant: advisory '${advisory.kind}' needs non-blank evidence and next_action`,
      );
    }
  }
}

/**
 * Derive and validate one core verdict before any renderer sees it. Unknown
 * discriminators are left unchanged so synthetic schema fixtures remain usable;
 * registry parity prevents a production verb from taking that path.
 */
export function evaluateResultCompletion<TData>(
  result: DiscernResult<TData>,
): DiscernResult<TData> {
  const policy = RESULT_COMPLETION_POLICIES[result.verb];
  if (policy === undefined) return result;

  const advisories = derivedAdvisories(result, policy);
  validateAdvisories(result, policy, advisories);
  const advisoryFields = advisories.length === 0 ? {} : { advisories };

  const required = new Set(policy.requiredPostconditions);
  const evaluationOrder: readonly ResultRequiredPostcondition[] = [
    "instruction-refresh",
    "refresh-artifacts",
    "doctor-checks",
    "gate-finish",
    "setup-completion",
    "setup-landing",
    "accept-landing",
    "skill-materialization",
    "executed-steps",
    "declared-outcome",
  ];
  const failure = evaluationOrder
    .filter((postcondition) => required.has(postcondition))
    .map((postcondition) => requiredFailure(postcondition, result))
    .find((candidate): candidate is RequiredPostconditionFailure =>
      candidate !== undefined
    );

  if (!result.ok) {
    const classified = failure ?? failed(
      "precondition_failed",
      "The verb did not satisfy its declared completion contract.",
    );
    const needsCompletionMessage = result.message === undefined &&
      (result.diagnostics?.length ?? 0) === 0;
    return {
      ...result,
      ...advisoryFields,
      error: result.error ?? classified.error,
      ...(needsCompletionMessage ? { message: classified.message } : {}),
    };
  }
  if (failure === undefined) {
    return { ...result, ...advisoryFields };
  }

  const { ok: _reportedOk, ...fields } = result;
  return {
    ...fields,
    ...advisoryFields,
    ok: false,
    error: failure.error,
    message: failure.message,
    hints: appendHintTexts(result.hints, [
      fire(HINTS["result-completion-failed"], { verb: result.verb }),
    ]),
  };
}
