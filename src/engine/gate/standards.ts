import { fmtRate, standardHeld } from "../validation/metrics.ts";
import { measureDeclaredStandards } from "../validation/measurement.ts";
/**
 * Standalone standards demand the shared producer graph and preserve valid
 * component evidence for pin and proposal operations. Every invocation checks
 * held definitions and limits against its current committed predecessor before
 * changing a limit. Required measurements and process failures use the same
 * evaluator as done; standalone execution cannot admit a landing candidate.
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { colorEnabled, makeOut, outSink } from "../output.ts";
import {
  buildStandardPlan,
  buildStandardSelectionPlan,
  type PlannedStandard,
  standardJobLabel,
  standardPinEligibility,
  type StandardPlan,
  standardPlanToEngine,
} from "./standard_plan.ts";
import {
  appliedResult,
  BUILT_IN_STEP_LABELS,
  type Diagnostic,
  type DiscernResult,
  type PlanStep,
  previewResult,
  renderPlan,
  renderStepResults,
  type StepResult,
  verbatimStepLabel,
} from "../../shared/result.ts";
import { emitResult } from "../../shared/emit.ts";
import {
  fire,
  type FiredHint,
  HINTS,
  hintTexts,
  interactiveHintTexts,
} from "../../shared/hints.ts";
import { observeResult } from "../../shared/result_capture.ts";
import { setupInProgressHint } from "../../shared/setup_state.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES,
} from "../../shared/discern_commit.ts";
import { isAbsolute, join } from "@std/path";
import { CONFIG_REL, installedConfigRel } from "../../shared/env.ts";
import { TomlEditor } from "../../lib/toml_edit.ts";
import type {
  GateStandard,
  StandardsData,
} from "../../shared/result_schemas.ts";
import type { JobTimeout } from "../jobs/types.ts";
import { gateTimeoutBudget } from "./execute.ts";
import { buildTestRunSlots, type TestRunSlots } from "./test_slots.ts";
import { renderSlotWait } from "./slot_wait_render.ts";
import {
  standardDefinitionFingerprint,
  type TrunkLimitsVerification,
  verifyTrunkLimits,
} from "./standard_limits.ts";
import {
  type AdminStateWriteAuthority,
  clearStandardMeasurements,
  gateProofHasCompleteEvidence,
  inspectGateProof,
  pinValidatedTree,
  preflightAdminStateWrites,
  recordFreshStandardMeasurementEvidence,
  recordStandardMeasurements,
  type ValidatedTreePin,
} from "./proof.ts";
import {
  preflightPlannedWrites,
  writePreflightDiagnostic,
  type WritePreflightFailure,
  writePreflightFailureMessage,
} from "../../shared/write_preflight.ts";
import { assertMainMerged, integrationBranch } from "../worktree/git.ts";
import { writeDiscernToml } from "../../lib/tidy_format.ts";
import {
  inspectActiveStandardLimitProposals,
  staleProposalDiagnostic,
} from "./standard_proposal_state.ts";
import {
  invalidStandardSelectionResult,
  standardsCleanTreeMessage,
  standardsPinCleanTreeMessage,
  unverifiedTrunkHint,
} from "./standards_selection.ts";

export { readTrunkConfig, type TrunkConfigRead } from "./standard_limits.ts";

/** One standard's measured outcome, carried alongside its {@link StepResult} so the
 * `--pin` pass can read the value the check computed without measuring a second time. */
interface StandardOutcome {
  standard: PlannedStandard;
  held: boolean;
  /** The value compared to the limit (rate or count); absent when unmeasurable. */
  value?: number;
  /** Whole-second scheduler duration for a fresh measurement. */
  durationS?: number;
}

/** The outcome of applying a standard plan: whether all held, the per-step
 * results, the per-standard measured outcomes the pin pass reads, the
 * envelope-facing readings (`GateData.standards`' shape, so both surfaces
 * report standards identically), and one diagnostic per failure carrying its
 * reason. */
interface StandardExecution {
  producer_executions: Readonly<Record<string, number>>;
  waited_ms: number;
  ok: boolean;
  results: StepResult[];
  outcomes: StandardOutcome[];
  readings: GateStandard[];
  diagnostics: Diagnostic[];
}

/** Represent a plan-to-step cardinality mismatch as a failed internal step. */
function standardPlanIntegrityResult(
  plan: StandardPlan,
  steps: readonly PlanStep[],
): StepResult {
  return {
    step: {
      kind: "standard",
      label: BUILT_IN_STEP_LABELS.planIntegrity,
      disposition: "gate",
      note:
        `internal error: planned ${plan.standards.length} standard(s) but projected ${steps.length} step(s).`,
    },
    outcome: "failed",
  };
}

/** Refuse execution when projected standard steps differ from the plan. */
export function standardPlanIntegrityFailure(
  plan: StandardPlan,
  steps: readonly PlanStep[],
): StepResult | undefined {
  return steps.length === plan.standards.length
    ? undefined
    : standardPlanIntegrityResult(plan, steps);
}

/** Convert Tier-1 diagnostics from the gate's scheduler namespace to the plain
 * labels and reproduce command the standalone result has always exposed. */
function standaloneVerificationDiagnostics(
  verification: TrunkLimitsVerification,
): Diagnostic[] {
  const prefix = standardJobLabel("");
  return verification.diagnostics.map((diagnostic) =>
    diagnostic.tool.startsWith(prefix)
      ? {
        ...diagnostic,
        tool: diagnostic.tool.slice(prefix.length),
        reproduce_cmd: "discern standards",
      }
      : diagnostic
  );
}

/** Synthetic standalone steps for deleted standards and global trunk-parse
 * failures, neither of which has a branch measurement job to serialize. */
function standaloneVerificationSteps(
  plan: StandardPlan,
  verification: TrunkLimitsVerification,
): StepResult[] {
  const configured = new Set(plan.standards.map((standard) => standard.name));
  const diagnostics = standaloneVerificationDiagnostics(verification);
  const steps: StepResult[] = [];
  const globalFailure = diagnostics.find((diagnostic) =>
    diagnostic.tool === "standards"
  );
  if (globalFailure !== undefined) {
    steps.push({
      step: {
        kind: "standards-limits-check",
        label: BUILT_IN_STEP_LABELS.trunkLimits,
        disposition: "gate",
        note: globalFailure.message,
      },
      outcome: "failed",
    });
  }
  for (const name of verification.blockedStandards) {
    if (configured.has(name)) {
      continue;
    }
    steps.push({
      step: {
        kind: "standard",
        label: verbatimStepLabel(name),
        disposition: "gate",
        note: "deleted on this branch; restore its trunk limit",
      },
      outcome: "failed",
    });
  }
  return steps;
}

import { jobFailureMessage, TIMEOUT_DIAGNOSTIC_RULE } from "./plan.ts";

/** Apply the declared standard selection through the same dependency planner as done and test. */
async function executeStandardPlan(
  plan: StandardPlan,
  root: string,
  verification: TrunkLimitsVerification | undefined,
  opts: {
    timeout: JobTimeout;
    slots: TestRunSlots | undefined;
    kind?: "standards" | "pin" | "proposal";
    verificationPlan?: StandardPlan;
    signal?: AbortSignal;
  },
): Promise<StandardExecution> {
  const steps = standardPlanToEngine(plan).steps;
  const blocked = verification?.blockedStandards ?? new Set<string>();
  const names = plan.standards.filter((standard) => !blocked.has(standard.name))
    .map((standard) => standard.name);
  const measured = names.length === 0 ||
      verification?.diagnostics.some((diagnostic) =>
        diagnostic.tool === "standards"
      )
    ? undefined
    : await measureDeclaredStandards(
      root,
      names,
      opts.kind ?? "standards",
      opts.signal,
      { slots: opts.slots, out: makeOut(false, { quiet: true }) },
    );
  const pending = measured !== undefined && "kind" in measured
    ? measured
    : undefined;
  const validation = measured !== undefined && !("kind" in measured)
    ? measured
    : undefined;
  const outcomes: StandardOutcome[] = [];
  const readings: GateStandard[] = [];
  const results: StepResult[] = [];
  const diagnostics: Diagnostic[] = verification === undefined
    ? []
    : standaloneVerificationDiagnostics(verification);
  for (const [index, standard] of plan.standards.entries()) {
    const step = steps[index];
    if (step === undefined) {
      throw new Error("Standard plan projection is incomplete.");
    }
    const reading = blocked.has(standard.name)
      ? undefined
      : validation?.standards.find((reading) => reading.name === standard.name);
    const job = validation?.results.get(standardJobLabel(standard.name));
    const held = reading?.value !== undefined &&
      standardHeld(standard, reading.value);
    readings.push(
      reading ??
        {
          name: standard.name,
          direction: standard.direction,
          limit: standard.limit,
          margin: standard.margin,
          measurement: "skipped",
        },
    );
    outcomes.push({
      standard,
      held,
      ...(reading?.value === undefined ? {} : { value: reading.value }),
      ...(reading?.duration_s === undefined
        ? {}
        : { durationS: reading.duration_s }),
    });
    results.push({
      step: {
        ...step,
        ...(reading?.measurement === "replayed"
          ? { disposition: "skip" as const }
          : {}),
        note: `${
          validation?.standard_verdicts.get(standard.name)?.summary ??
            step.note ?? standard.name
        }${
          reading?.value === undefined
            ? ""
            : `, measured ${fmtRate(reading.value)}${
              reading.measurement === "replayed"
                ? " (valid evidence reused)"
                : ""
            }`
        }`,
      },
      outcome: job?.cancelled === true
        ? "cancelled"
        : held
        ? (reading?.measurement === "replayed" ? "skipped" : "ok")
        : "failed",
      ...(reading?.duration_s === undefined
        ? {}
        : { durationS: reading.duration_s }),
    });
    if (!held && !blocked.has(standard.name)) {
      diagnostics.push({
        tool: standard.name,
        severity: "error",
        ...(job?.timedOut === undefined
          ? {}
          : { rule: TIMEOUT_DIAGNOSTIC_RULE }),
        message: pending !== undefined
          ? `Measurement did not complete (${pending.kind}): ${
            "reason" in pending
              ? pending.reason
              : pending.kind === "recovery-incomplete"
              ? pending.recovery.reason
              : JSON.stringify(pending)
          }`
          : job?.timedOut !== undefined
          ? jobFailureMessage(standard.name, job)
          : validation?.standard_verdicts.get(standard.name)?.reason ??
            (job === undefined
              ? `Standard '${standard.name}' did not satisfy its required ${
                standard.direction === "up" ? "floor" : "ceiling"
              } ${standard.limit}.`
              : jobFailureMessage(standard.name, job)),
        reproduce_cmd: standard.command || `discern standards ${standard.name}`,
        ...(validation?.standard_verdicts.get(standard.name)?.output ===
            undefined
          ? {}
          : {
            output: validation.standard_verdicts.get(standard.name)?.output,
          }),
        ...(job?.outputPath === undefined
          ? {}
          : { output_path: job.outputPath }),
      });
    }
  }
  if (verification !== undefined) {
    results.push(
      ...standaloneVerificationSteps(
        opts.verificationPlan ?? plan,
        verification,
      ),
    );
  }
  return {
    ok: !(verification?.blocking ?? false) &&
      outcomes.every((outcome) => outcome.held) &&
      (validation?.outcome.blockers.length ?? 0) === 0,
    outcomes,
    readings,
    results,
    diagnostics,
    producer_executions: validation?.producer_executions ?? {},
    waited_ms: validation?.waited_ms ?? 0,
  };
}

/** Convert an execution to the verb envelope. The explicit `ok` assignment is
 * what keeps an externally-cancelled all-skipped run red. The readings ride
 * `data.standards` — the same shape the gate reports — so downstream consumers
 * (the logbook recorder included) read one vocabulary from both surfaces. */
function standardExecutionResult(execution: StandardExecution): DiscernResult {
  const { results, diagnostics } = execution;
  const result = appliedResult("standards", results);
  result.ok = execution.ok;
  if (diagnostics.length > 0) {
    result.diagnostics = diagnostics;
  }
  if (execution.readings.length === 0) {
    return result;
  }
  return {
    ...result,
    data: {
      standards: execution.readings,
      producer_executions: { ...execution.producer_executions },
    } satisfies StandardsData,
  };
}

/** Process-backed evidence for one named Standard operation. Proposal creation
 * and renewal use this boundary after validating their own Git and authority
 * preconditions. It executes the canonical target-only selection, records only
 * measured readings, and reports whether the exact clean tree accepted that
 * evidence. A breached metric leaves `executionOk` false while retaining its
 * numeric reading for the proposal decision. */
export interface StandardEvidenceMeasurement {
  readonly plan: StandardPlan;
  readonly readings: readonly GateStandard[];
  readonly diagnostics: readonly Diagnostic[];
  readonly executionOk: boolean;
  readonly evidenceRecorded: boolean;
  readonly pin: ValidatedTreePin;
  readonly waitedMs?: number;
}

/** Measure one named Standard set through the shared process-group executor. */
export async function measureStandardEvidence(
  root: string,
  cfg: DiscernConfig,
  plan: StandardPlan,
  names: readonly string[],
  authority: AdminStateWriteAuthority,
  signal?: AbortSignal,
): Promise<StandardEvidenceMeasurement> {
  const selection = buildStandardSelectionPlan(plan, names, true);
  const pin = await pinValidatedTree(root);
  const slots = buildTestRunSlots(root, cfg);
  const execution = await executeStandardPlan(
    selection.execution,
    root,
    undefined,
    {
      timeout: gateTimeoutBudget(cfg),
      kind: "proposal",
      slots,
      ...(signal === undefined ? {} : { signal }),
    },
  );
  const evidenceRecorded = authority.root === root &&
    await pinTreeChangeMessage(root, pin) === undefined &&
    execution.readings.every((reading) => reading.value !== undefined);
  return {
    plan: selection.execution,
    readings: execution.readings,
    diagnostics: execution.diagnostics,
    executionOk: execution.ok,
    evidenceRecorded,
    pin,
    ...(slots?.waitedMs === undefined ? {} : { waitedMs: slots.waitedMs }),
  };
}

/** Route a plain check's outcome into the measurement proof: green over a clean
 * tree records every measured value against the HEAD pinned before the measurements
 * ran (for a `--pin` on that same clean HEAD to reuse), red clears any proof
 * (fail-closed). The caller already preflighted `authority`; the writer remains
 * best-effort only against a later point-in-time failure. Returns whether a
 * reusable proof now exists. */
async function recordCheckMeasurements(
  root: string,
  authority: AdminStateWriteAuthority,
  execution: StandardExecution,
  pin: ValidatedTreePin,
  completeProject: boolean,
  config: DiscernConfig,
): Promise<boolean> {
  await recordFreshStandardMeasurementEvidence(
    root,
    authority,
    execution.readings,
    pin,
  );
  if (!execution.ok) {
    await clearStandardMeasurements(root, authority);
    return false;
  }
  if (!completeProject) {
    return false;
  }
  const values: Record<string, number> = {};
  const durations: Record<string, number> = {};
  const definitions: Record<string, string> = {};
  for (const o of execution.outcomes) {
    if (o.value === undefined) {
      return false;
    }
    values[o.standard.name] = o.value;
    definitions[o.standard.name] = await standardDefinitionFingerprint(
      o.standard.name,
      config,
    );
    if (o.durationS !== undefined) {
      durations[o.standard.name] = o.durationS;
    }
  }
  return await recordStandardMeasurements(
    root,
    authority,
    values,
    definitions,
    pin,
    durations,
  );
}

// ── `--pin`: capture a measured improvement into the limit (ADR 0106) ──────────

/** One limit the pin pass will tighten: the standard, the value it measured, and the
 * new limit computed from it (measured ∓ margin, in the tightening direction). */
interface PinnedStandard {
  standard: PlannedStandard;
  measured: number;
  newLimit: number;
}

/** A `standard` step for the pin result: always "ok" (a failing standard aborts the pin
 * before any pin step is built), noting what was pinned or that there was nothing to. */
function pinStep(name: string, note: string): StepResult {
  return {
    step: {
      kind: "standard",
      label: verbatimStepLabel(name),
      disposition: "run",
      note,
    },
    outcome: "ok",
  };
}

/** Preserve an Error message and stringify non-Error standards failures. */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Re-verify the exact clean tree captured before a pin read or measured values.
 * A mismatch is reported before {@link applyPinEdits} can write anything. */
async function pinTreeChangeMessage(
  root: string,
  pin: ValidatedTreePin,
): Promise<string | undefined> {
  const recovery =
    "Settle the worktree at the commit you want to measure, then re-run `discern standards --pin`.";
  if (pin.head === undefined) {
    return "Couldn't pin the measured limits because discern could not read HEAD before the pin began. " +
      recovery;
  }
  if (!pin.clean) {
    const paths = pin.dirtyPaths.length > 0
      ? ` Uncommitted paths: ${pin.dirtyPaths.join(", ")}.`
      : "";
    return `Couldn't pin the measured limits because the worktree changed before the pin began.${paths} ${recovery}`;
  }

  const current = await pinValidatedTree(root);
  if (current.head === undefined) {
    return "Couldn't pin the measured limits because discern could not read HEAD after measuring. " +
      recovery;
  }
  if (current.head !== pin.head) {
    return `Couldn't pin the measured limits because HEAD moved while the pin was running (started at ${pin.head}, now ${current.head}). ${recovery}`;
  }
  if (!current.clean) {
    const paths = current.dirtyPaths.length > 0
      ? ` Uncommitted paths: ${current.dirtyPaths.join(", ")}.`
      : " Git status could not confirm that the worktree was clean.";
    return `Couldn't pin the measured limits because the worktree changed while the pin was running.${paths} ${recovery}`;
  }
  return undefined;
}

/** A successful preflight for every built-in mutation `standards --pin` may
 * perform after measuring: validation-state markers, discern.toml, and Git's
 * common metadata for the commit. The brand forces the mutator to consume it. */
declare const PIN_WRITE_AUTHORITY: unique symbol;
interface PinWriteAuthority {
  readonly root: string;
  readonly configRel: string;
  readonly configPath: string;
  readonly admin: AdminStateWriteAuthority;
  readonly [PIN_WRITE_AUTHORITY]: true;
}

type PinWritePreflight =
  | { ok: true; authority: PinWriteAuthority }
  | WritePreflightFailure;

/** Resolve Git-reported relative paths against the repository root. */
function absoluteFromRoot(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path);
}

/** Probe the complete predictable write surface before a pin pays for any metric.
 * Git itself uses create+rename lockfiles, represented by the common-dir probe. */
async function preflightPinWrites(root: string): Promise<PinWritePreflight> {
  const admin = await preflightAdminStateWrites(root);
  if (!admin.ok) {
    return admin;
  }
  const configRel = (await installedConfigRel(root)) ?? CONFIG_REL;
  const configPath = join(root, configRel);
  const common = await runGit(["rev-parse", "--git-common-dir"], { cwd: root });
  const commonRaw = common.stdout.trim();
  if (!common.success || commonRaw === "") {
    return {
      ok: false,
      path: root,
      description: "the Git metadata needed to commit pinned limits",
      reason: common.stderr.trim() ||
        "Git could not resolve its common directory",
    };
  }
  const commonDir = absoluteFromRoot(root, commonRaw);
  const probed = await preflightPlannedWrites([
    {
      kind: "existing-file",
      path: configPath,
      description: configRel,
    },
    {
      kind: "directory-entry",
      path: commonDir,
      description: "the Git metadata needed to commit pinned limits",
    },
  ]);
  if (!probed.ok) {
    return probed;
  }
  return {
    ok: true,
    authority: {
      root,
      configRel,
      configPath,
      admin: admin.authority,
    } as PinWriteAuthority,
  };
}

/** Return the shared write-preflight refusal with a reproducible diagnostic. */
function standardsWriteAccessFailure(
  failure: WritePreflightFailure,
  reproduceCmd: string,
): DiscernResult {
  return {
    ok: false,
    verb: "standards",
    error: "write_access",
    message: writePreflightFailureMessage(failure),
    diagnostics: [writePreflightDiagnostic(failure, reproduceCmd)],
  };
}

/** Restore `rel`'s working-tree and index copy to HEAD, undoing a half-applied pin.
 * The clean-tree precondition guaranteed `rel` matched HEAD before the pin began, so
 * `git checkout HEAD -- <rel>` returns both the file and its staged copy to exactly
 * that state — leaving no trace of the failed attempt for the clean-tree guard to
 * trip over on the retry. Best-effort: reported in the failure message if it fails. */
async function restorePinEdits(root: string, rel: string): Promise<boolean> {
  const restore = await runGit(["checkout", "HEAD", "--", rel], { cwd: root });
  return restore.success;
}

/** Rewrite the pinned limits in discern.toml (comment-preservingly, via {@link
 * TomlEditor}) and commit that file ALONE with an audit message. The clean-tree
 * precondition guarantees the config is the only change the commit carries — which is
 * what makes the commit gate-neutral and its proof safe to carry forward.
 *
 * The write → stage → commit sequence is a multi-step mutation, so ANY step that
 * fails after the file is rewritten rolls the config back to HEAD before returning —
 * otherwise a failed commit would leave discern.toml modified and staged, and the
 * natural retry (`discern standards --pin` again) is then refused by the clean-tree
 * guard, stranding the user. Returns an error string on failure (noting if the
 * rollback itself could not run), undefined on success. */
async function applyPinEdits(
  root: string,
  pins: PinnedStandard[],
  authority: PinWriteAuthority,
): Promise<string | undefined> {
  if (authority.root !== root) {
    return "the pin write-authority token belongs to a different worktree";
  }
  const rel = authority.configRel;
  const path = authority.configPath;
  let text: string;
  try {
    text = await Deno.readTextFile(path);
  } catch (error) {
    // Nothing has changed yet — no rollback needed.
    return `could not read ${rel}: ${errText(error)}`;
  }

  /** Undo a partial pin, folding any rollback failure into the reported reason. */
  const failWithRollback = async (reason: string): Promise<string> => {
    if (await restorePinEdits(root, rel)) {
      return reason;
    }
    return `${reason} (and discern could not restore ${rel} to HEAD — run \`git checkout HEAD -- ${rel}\` before retrying)`;
  };

  try {
    const editor = new TomlEditor(text);
    for (const p of pins) {
      editor.setNumber(`standards.${p.standard.name}.limit`, p.newLimit);
    }
    await writeDiscernToml(path, editor.toString());
  } catch (error) {
    return await failWithRollback(
      `could not rewrite ${rel}: ${errText(error)}`,
    );
  }
  const add = await runGit(["add", "--", rel], { cwd: root });
  if (!add.success) {
    return await failWithRollback(
      `could not stage ${rel}: ${add.stderr.trim()}`,
    );
  }
  const commit = await commitDiscernChanges({
    site: DISCERN_AUTHORED_COMMIT_SITES.standardsPin,
    values: {
      pins: pins.map((pin) => ({
        name: pin.standard.name,
        direction: pin.standard.direction,
        previousLimit: pin.standard.limit,
        newLimit: pin.newLimit,
        measured: fmtRate(pin.measured),
      })),
    },
    cwd: root,
    pathspecs: [rel],
  });
  if (!commit.success) {
    return await failWithRollback(
      `could not commit the re-pin: ${commit.stderr.trim()}`,
    );
  }
  return undefined;
}

interface StandardsResultBuild {
  result: DiscernResult;
  firedHints: FiredHint[];
}

/** Pair a standards result with the fired hints its surface must observe. */
function standardsBuild(
  result: DiscernResult,
  firedHints: FiredHint[] = [],
  waitedMs?: number,
): StandardsResultBuild {
  if (waitedMs !== undefined) {
    result.waitedMs = waitedMs;
  }
  return { result, firedHints };
}

/**
 * Apply `standards --pin` (ADR 0106): measure every standard, and for each one asked for
 * — all of them, or the named subset — that improved past its limit by more than its
 * margin, tighten the limit toward the measured value, commit that change on its own,
 * and carry any gate proof forward across the (gate-neutral) commit so
 * `accept` need not re-run the whole gate. When a green check already measured this
 * exact clean HEAD, its measurement proof stands in for the measurements — the
 * check → pin flow measures once — with only the never-loosen half re-checked live
 * (main can advance while HEAD stands still). A FAILING standard pins nothing — you can't
 * capture a good state from a red tree — and returns the ordinary failing result.
 * `dryRun` renders the pin plan and measures NOTHING (the universal dry-run contract,
 * ADR 0027) — it cannot say what a pin would change, because slack is only knowable by
 * measuring; the plain check's green result already hints any pinnable slack.
 */
async function pinStandardsResult(
  root: string,
  cfg: DiscernConfig,
  plan: StandardPlan,
  opts: {
    dryRun: boolean;
    names: string[];
    verification?: TrunkLimitsVerification;
    signal?: AbortSignal;
  },
): Promise<StandardsResultBuild> {
  if (
    plan.standards.length === 0 &&
    !(opts.verification?.blocking ?? false)
  ) {
    return standardsBuild(appliedResult("standards", []), [
      fire(HINTS["standards-pin-empty"]),
    ]);
  }

  // A named standard that doesn't exist would otherwise pin nothing, silently.
  const known = new Set(plan.standards.map((r) => r.name));
  const unknown = opts.names.filter((n) => !known.has(n));
  if (unknown.length > 0) {
    return standardsBuild({
      ok: false,
      verb: "standards",
      error: "unknown_standard",
      message: `no standard named ${
        unknown.join(", ")
      }. Configured standards: ${[...known].join(", ")}.`,
    });
  }

  if (opts.dryRun) {
    // A dry-run renders the pin plan and runs NOTHING — the same contract as every
    // other discern dry-run (ADR 0027). It cannot report what a pin WOULD change:
    // slack is only knowable by measuring, and the measurements are the slow thing
    // a dry-run promises not to run. The plain check already measured — a green
    // result's hints name any pinnable slack — so check → pin needs no preview
    // measurement in between.
    const proof = await inspectGateProof(root);
    const selection = buildStandardSelectionPlan(
      plan,
      opts.names,
      gateProofHasCompleteEvidence(proof),
    );
    const targets = new Set(selection.targets.map((standard) => standard.name));
    const steps: PlanStep[] = selection.execution.standards
      .map((r) => ({
        kind: "standard",
        label: verbatimStepLabel(r.name),
        disposition: "run",
        note: targets.has(r.name)
          ? `would measure ${r.metric}, then tighten the ${
            r.direction === "up" ? "floor" : "ceiling"
          } past ${r.limit} by any slack beyond margin ${r.margin}`
          : `would measure ${r.metric} to verify the complete standard set before changing only the named limit`,
      }));
    return standardsBuild(
      previewResult("standards", {
        title: "Pin plan",
        details: [],
        steps,
      }),
      [
        fire(HINTS["standards-pin-dry-run"]),
      ],
    );
  }

  // Pinning writes and commits, so it needs a clean tree.
  const dirty = await standardsPinCleanTreeMessage(root);
  if (dirty !== undefined) {
    return standardsBuild({
      ok: false,
      verb: "standards",
      error: "dirty_worktree",
      message: dirty,
    });
  }

  const writePreflight = await preflightPinWrites(root);
  if (!writePreflight.ok) {
    return standardsBuild(
      standardsWriteAccessFailure(
        writePreflight,
        "discern standards --pin",
      ),
    );
  }
  const writeAuthority = writePreflight.authority;

  // Pin the tree before any measurement proof is read or measurement runs. The
  // mutation below re-validates this exact HEAD and full cleanliness immediately
  // before writing, so limits can only describe the tree that supplied the values.
  const treePin = await pinValidatedTree(root);

  // Capture the pre-pin vouch BEFORE anything changes: only an honored proof may be
  // carried across the commit we are about to make (ADR 0106 / 0067).
  const priorProof = await inspectGateProof(root);
  const selection = buildStandardSelectionPlan(
    plan,
    opts.names,
    gateProofHasCompleteEvidence(priorProof),
  );

  const verification = opts.verification;
  if (verification === undefined) {
    throw new Error(
      "internal error: a real standards pin has no trunk-limits verification",
    );
  }
  const slots = buildTestRunSlots(root, cfg);
  const execution = await executeStandardPlan(
    selection.execution,
    root,
    verification,
    {
      timeout: gateTimeoutBudget(cfg),
      slots,
      verificationPlan: plan,
      kind: "pin",
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    },
  );
  const slotWaits = slots?.waits ?? [];
  const { ok, outcomes } = execution;
  const reusedCount =
    execution.readings.filter((reading) => reading.measurement === "replayed")
      .length;
  const reuseHint = reusedCount > 0
    ? fire(HINTS["standards-pin-reused-measurements"])
    : undefined;

  // A red standard blocks the whole pin: don't capture a state the gate wouldn't hold.
  if (!ok) {
    const failing = [
      ...new Set([
        ...outcomes.filter((o) => !o.held).map((o) => o.standard.name),
        ...verification.blockedStandards,
      ]),
    ];
    return standardsBuild(
      standardExecutionResult(execution),
      [
        ...slotWaits,
        fire(HINTS["standards-pin-blocked"], { failingNames: failing }),
      ],
      slots?.waitedMs,
    );
  }

  const targets = new Set(selection.targets.map((standard) => standard.name));
  const considered = outcomes.filter((outcome) =>
    targets.has(outcome.standard.name)
  );

  const pins: PinnedStandard[] = [];
  const steps: StepResult[] = [];
  for (const o of considered) {
    const r = o.standard;
    const bound = r.direction === "up" ? "floor" : "ceiling";
    const eligibility = o.value === undefined
      ? { eligible: false as const }
      : standardPinEligibility({
        direction: r.direction,
        value: o.value,
        margin: r.margin,
        limit: r.limit,
      });
    const newLimit = eligibility.eligible ? eligibility.target : undefined;
    if (o.value === undefined || newLimit === undefined) {
      const seen = o.value === undefined
        ? ""
        : ` (measured ${fmtRate(o.value)})`;
      steps.push(
        pinStep(r.name, `held ${bound} ${r.limit} — nothing to pin${seen}`),
      );
      continue;
    }
    pins.push({ standard: r, measured: o.value, newLimit });
    steps.push(
      pinStep(
        r.name,
        `pinned ${bound} ${r.limit} → ${newLimit} (measured ${
          fmtRate(o.value)
        })`,
      ),
    );
  }

  if (pins.length === 0) {
    return standardsBuild(
      {
        ...appliedResult("standards", steps),
        ...(execution.readings.length > 0
          ? {
            data: {
              standards: execution.readings,
              producer_executions: { ...execution.producer_executions },
            } satisfies StandardsData,
          }
          : {}),
      },
      [
        ...slotWaits,
        ...(reuseHint !== undefined ? [reuseHint] : []),
        fire(HINTS["standards-pin-no-slack"]),
      ],
      slots?.waitedMs,
    );
  }

  const treeChanged = await pinTreeChangeMessage(root, treePin);
  if (treeChanged !== undefined) {
    return standardsBuild(
      {
        ok: false,
        verb: "standards",
        error: "pin_failed",
        message: treeChanged,
      },
      [],
      slots?.waitedMs,
    );
  }
  const failure = await applyPinEdits(root, pins, writeAuthority);
  if (failure !== undefined) {
    return standardsBuild(
      {
        ok: false,
        verb: "standards",
        error: "pin_failed",
        message: failure,
      },
      [],
      slots?.waitedMs,
    );
  }

  return standardsBuild(
    {
      ...appliedResult("standards", steps),
      data: {
        producer_executions: { ...execution.producer_executions },
        ...(execution.readings.length > 0
          ? { standards: execution.readings }
          : {}),
        pinned: pins.map((p) => ({
          name: p.standard.name,
          from: p.standard.limit,
          to: p.newLimit,
          measured: p.measured,
        })),
      } satisfies StandardsData,
    },
    [
      ...slotWaits,
      ...(reuseHint !== undefined ? [reuseHint] : []),
      fire(HINTS["standards-pin-no-proof"]),
    ],
    slots?.waitedMs,
  );
}

/**
 * Compute the `standards` {@link DiscernResult} without printing or exiting — the
 * entry point the MCP server renders, and the source the CLI's `--json` serializes.
 * The on-demand pass reads the trunk baseline once, then runs every unblocked
 * measurement fresh in one parallel, fail-fast-off group. Each job carries its
 * timeout and the caller's cancellation signal into the shared runner. `dryRun`
 * returns the plan with no git or measurement; an empty config is a clean pass.
 * Non-dry checks require a clean tree unless forced for standard authoring. The
 * executor stays quiet so the result envelope remains the only rendering source.
 *
 * With `pin`, it instead runs the pin pass (ADR 0106): measure, tighten each
 * asked-for limit that improved past its margin, commit that change alone, and carry
 * a gate proof forward across it. Positional names restrict an ordinary check
 * and the pin target (empty = all). `dryRun` previews without measuring in BOTH
 * modes; a green check's hints name any pinnable slack, so check → pin is the whole
 * flow.
 */
export async function standardsResult(
  root: string,
  opts: {
    dryRun?: boolean;
    force?: boolean;
    pin?: boolean;
    pinNames?: string[];
    signal?: AbortSignal;
  } = {},
): Promise<DiscernResult> {
  if (opts.signal?.aborted === true) {
    return {
      ok: false,
      verb: "standards",
      message: "Standard measurement was cancelled before it started.",
    };
  }
  const cfg = await loadConfig(root);
  const plan = buildStandardPlan(cfg);
  const names = opts.pinNames ?? [];
  const selectionError = invalidStandardSelectionResult(plan, names);
  if (selectionError !== undefined) return selectionError;
  let result: DiscernResult;
  const firedHints: FiredHint[] = [];
  let verification: TrunkLimitsVerification | undefined;
  if (!(opts.dryRun ?? false)) {
    const mainBranch = integrationBranch(cfg.repository.trunk);
    const proposals = await inspectActiveStandardLimitProposals(
      root,
      mainBranch,
      plan.standards,
    );
    verification = await verifyTrunkLimits(
      root,
      mainBranch,
      plan.standards,
      proposals.active,
      cfg,
    );
    for (const stale of proposals.stale) {
      if (verification.blockedStandards.has(stale.proposal.standard)) {
        verification.diagnostics.unshift(
          staleProposalDiagnostic(stale.proposal.standard, stale.reason),
        );
      }
    }
  }
  if (opts.pin ?? false) {
    let behindHint: FiredHint | undefined;
    if (!(opts.dryRun ?? false)) {
      const mainBranch = integrationBranch(cfg.repository.trunk);
      const merged = await assertMainMerged(root, mainBranch);
      if (merged.kind === "behind") {
        behindHint = fire(HINTS["standards-pin-behind"], {
          behind: merged.behind,
          trunk: mainBranch,
        });
      }
    }
    const built = await pinStandardsResult(root, cfg, plan, {
      dryRun: opts.dryRun ?? false,
      names,
      ...(verification !== undefined ? { verification } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    });
    result = built.result;
    firedHints.push(...built.firedHints);
    if (behindHint !== undefined) {
      firedHints.push(behindHint);
    }
  } else if (opts.dryRun ?? false) {
    const selection = buildStandardSelectionPlan(plan, names, true);
    result = previewResult(
      "standards",
      standardPlanToEngine(selection.execution),
    );
  } else {
    if (verification === undefined) {
      throw new Error(
        "internal error: a real standards run has no trunk-limits verification",
      );
    }
    if (plan.standards.length === 0 && !verification.blocking) {
      result = appliedResult("standards", []);
      firedHints.push(fire(HINTS["standards-none-configured"]));
    } else {
      const dirtyMessage = (opts.force ?? false)
        ? undefined
        : await standardsCleanTreeMessage(root);
      if (dirtyMessage !== undefined) {
        result = {
          ok: false,
          verb: "standards",
          error: "dirty_worktree",
          message: dirtyMessage,
        };
      } else {
        const writePreflight = await preflightAdminStateWrites(root);
        if (!writePreflight.ok) {
          result = standardsWriteAccessFailure(
            writePreflight,
            "discern standards",
          );
        } else {
          // Pin the tree before the measurements: the proof may only vouch for
          // the exact tree the parallel jobs read.
          const treePin = await pinValidatedTree(root);
          const slots = buildTestRunSlots(root, cfg);
          const selection = buildStandardSelectionPlan(plan, names, true);
          const execution = await executeStandardPlan(
            selection.execution,
            root,
            verification,
            {
              timeout: gateTimeoutBudget(cfg),
              slots,
              ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
            },
          );
          firedHints.push(...(slots?.waits ?? []));
          const { outcomes } = execution;
          result = standardExecutionResult(execution);
          if (slots?.waitedMs !== undefined) {
            result.waitedMs = slots.waitedMs;
          }
          const proofed = await recordCheckMeasurements(
            root,
            writePreflight.authority,
            execution,
            treePin,
            selection.execution.standards.length === plan.standards.length,
            cfg,
          );
          if (result.ok) {
            const slack = outcomes.flatMap((o) => {
              if (!o.held || o.value === undefined) {
                return [];
              }
              const standard = o.standard;
              const eligibility = standardPinEligibility({
                direction: standard.direction,
                value: o.value,
                margin: standard.margin,
                limit: standard.limit,
              });
              if (!eligibility.eligible) {
                return [];
              }
              const newLimit = eligibility.target;
              const bound: "floor" | "ceiling" = standard.direction === "up"
                ? "floor"
                : "ceiling";
              return [
                {
                  name: standard.name,
                  bound,
                  limit: standard.limit,
                  measured: fmtRate(o.value),
                  newLimit,
                },
              ];
            });
            if (slack.length > 0) {
              firedHints.push(
                fire(HINTS["standards-pinnable-slack"], {
                  standards: slack,
                  proofed,
                }),
              );
            }
          }
        }
      }
    }
  }
  if (verification !== undefined) {
    const warning = unverifiedTrunkHint(verification);
    if (warning !== undefined) {
      firedHints.push(warning);
    }
  }
  // Pre-setup, lead with the "setup unfinished" advisory (ADR 0065): standards is
  // un-gated during setup, so its output must not read as a finished project.
  const inProgress = setupInProgressHint(cfg.meta.bootstrapped);
  if (inProgress !== undefined) {
    firedHints.unshift(inProgress);
  }
  if (firedHints.length > 0) {
    result.hints = hintTexts(firedHints);
  }
  return result;
}

/** Render every human standards surface from the same quiet execution envelope. */
function renderStandardsResult(
  result: DiscernResult,
  opts: { pin: boolean },
): void {
  const out = makeOut(colorEnabled(), { quiet: false });
  if (result.plan !== undefined) {
    renderPlan(outSink(out), result.plan);
  }
  if ((result.steps ?? []).length > 0) {
    renderStepResults(outSink(out), {
      title: "Standard results",
      steps: result.steps ?? [],
    });
  }
  if (!result.ok && result.message !== undefined) {
    out.group("failure");
    out.error(result.message);
  }
  if ((result.diagnostics ?? []).length > 0) out.group("diagnostics");
  for (const diagnostic of result.diagnostics ?? []) {
    if (diagnostic.output !== undefined && diagnostic.output !== "") {
      out.raw(
        diagnostic.output.endsWith("\n")
          ? diagnostic.output
          : `${diagnostic.output}\n`,
      );
    }
    out.error(diagnostic.message);
  }
  renderSlotWait(out, result.waitedMs);
  const hints = interactiveHintTexts(result.hints);
  if (hints.length > 0) out.group("next");
  for (const hint of hints) {
    if (hint.startsWith("Standards limits are UNVERIFIED")) {
      out.warn(hint);
    } else {
      out.info(hint);
    }
  }
  if (
    result.dry_run !== true && !opts.pin && result.message === undefined &&
    result.ok
  ) {
    const count = (result.steps ?? []).filter((step) =>
      step.step.kind === "standard"
    ).length;
    if (count > 0) {
      out.group("verdict");
      out.ok(`All ${count} standard(s) held.`);
    }
  } else if (!result.ok && result.message === undefined) {
    out.group("verdict");
    out.error("One or more standards failed.");
  }
}

/** Run `standards`. Returns a process exit code (non-zero if any standard failed). */
export async function runStandards(
  root: string,
  opts: {
    json?: boolean;
    dryRun?: boolean;
    force?: boolean;
    pin?: boolean;
    pinNames?: string[];
    signal?: AbortSignal;
  } = {},
): Promise<number> {
  const json = opts.json ?? false;
  const dryRun = opts.dryRun ?? false;
  const force = opts.force ?? false;
  const pin = opts.pin ?? false;
  const pinNames = opts.pinNames ?? [];

  const result = await standardsResult(root, {
    dryRun,
    force,
    pin,
    pinNames,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  });
  observeResult(result); // the logbook recorder lifts step timings from it
  if (json) {
    emitResult(result);
  } else {
    renderStandardsResult(result, { pin });
  }
  return result.ok ? 0 : 1;
}
