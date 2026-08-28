/**
 * `done` — the full quality gate. Built on the plan/apply seam (ADR 0027): a
 * pure {@link GatePlan} (the job groups + scope-gates + merge check) is computed
 * first (`buildGatePlan`, from the typed config and the changed scopes), then a
 * thin executor applies it. `--dry-run` renders the plan and touches nothing;
 * `--json` SERIALIZES (plan, results) into the result rather than re-deriving it.
 *
 * The result is the universal {@link DiscernResult} envelope (ADR 0028) every verb
 * returns: each declared job or scope gate is a `steps[]` entry, a genuine failure
 * also yields a `diagnostics[]` entry (the command to reproduce it + its captured
 * output, or — for a tool emitting SARIF or JUnit XML — normalized
 * file/line/rule findings), and
 * the gate's own `failed_stage`/`scopes_changed` ride in `data`. Human text and
 * `--json` are two renderings of that one object; {@link finishResult} returns it
 * unrendered for the MCP server. A job whose stage aborted before it ran →
 * `outcome:"skipped"`.
 */

import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { knownJobList, STAGES } from "../../shared/capabilities.ts";
import type { JobResult } from "../jobs/types.ts";
import {
  buildGatePlan,
  buildGateResultWithHints,
  checkTestGroups,
  composeGatePlan,
  gateLiveAdmissionGroups,
  gatePlanToEngine,
  type JobGroup,
  planScopeGates,
  preCheckpointGroups,
  scopeGatesGroup,
} from "./plan.ts";
import {
  gateOutputIsLive,
  type GateOutputSurface,
  gateOutputTtyWidth,
  gateRunContext,
  type GateRunPolicy,
  gateTimeoutBudget,
  resolveGateRunPolicy,
  runGroup,
} from "./execute.ts";
import {
  type AdminStateWriteAuthority,
  clearStandardMeasurements,
  currentTreeIdentity,
  inspectGateProof,
  inspectLastGateRun,
  pinValidatedTree,
  preflightAdminStateWrites,
  recordFreshStandardMeasurementEvidence,
  recordGateOutcome,
  recordLastGateRun,
  recordStandardMeasurements,
  sameTreeIdentity,
  UNCHANGED_TREE_RERUN_SLUG,
} from "./proof.ts";
import { sweepDueTempArtifacts } from "./temp_artifact_sweep.ts";
import {
  type AdrNumberDuplicate,
  duplicateAdrNumbers,
} from "../../lib/adr_numbers.ts";
import {
  checkDocsIntegrity,
  DOCS_INTEGRITY_REMEDIES,
  type DocsIntegrityFinding,
  type DocsIntegrityRule,
} from "../../lib/map_integrity.ts";
import type { CliModelProvider } from "../../shared/cli_reference_codegen.ts";
import { type AdrIndexState, adrIndexState } from "../../lib/adr_index.ts";
import { buildGateProof } from "./proof_render.ts";
import { renderSlotWait } from "./slot_wait_render.ts";
import { renderDoneTtyProofPanel, renderDoneTtySummary } from "./done_tty.ts";
import { createGateTtyProgress, renderGateTtyTable } from "./gate_tty.ts";
import { cmdsInStage } from "./stages.ts";
import { buildStandardPlan, standardJobLabel } from "./standard_plan.ts";
import {
  buildStandardJobs,
  fmtRate,
  type ResolvedStandard,
} from "./standards.ts";
import { verifyTrunkLimits } from "./standard_limits.ts";
import {
  inspectActiveStandardLimitProposals,
  sameStandardLimitProposalSet,
  staleProposalDiagnostic,
  standardLimitProposalIdentity,
} from "./standard_proposal_state.ts";
import {
  gateStandardsData,
  planStandardJobsFromConfig,
  resolveStandardActions,
  resolveStandardActionsFromConfig,
} from "./standards_gate.ts";
import type {
  GateStandard,
  PreviewActionData,
  StandardLimitProposalData,
  StandardsLimitsData,
} from "../../shared/result_schemas.ts";
import {
  type StageSnapshot,
  strandedByStage,
  treeDriftDiagnostic,
  worktreeDirtyPaths,
} from "./tree_drift.ts";
import {
  captureGeneratedBuildSnapshot,
  generatedBuildDrift,
  generatedBuildDriftDiagnostics,
} from "./generated_drift.ts";
import { resolveGeneratedGroups } from "../../shared/generated_artifacts.ts";
import { renderFailureTail } from "./failure_tail.ts";
import { renderGatePlan } from "./presentation.ts";
import { gateFailureGotchasTail, type GotchasFailureTail } from "./gotchas.ts";
import { diagnosticOutputFields } from "./diagnostic_output.ts";
import { classifyScopeImpact } from "../scopes/scopes.ts";
import {
  type CheckpointPreflight,
  type DeclarationRequest,
  runCheckpointPreflight,
  runCheckpointReport,
  type ServedCheckpoint,
} from "../checkpoints/preflight.ts";
import { inspectCheckpointNotes } from "../checkpoints/inspection.ts";
import { relatedCheckpointData } from "../checkpoints/related.ts";
import { checkpointServingText } from "../checkpoints/serving_text.ts";
import { AWAITING_DECLARATION_SLUG } from "../../shared/declarations.ts";
import { checkpointDropAccounts } from "../../shared/checkpoint_drops.ts";
import type {
  GateCheckpointsData,
  ProofCheckpointsData,
  ServedCheckpointData,
} from "../../shared/result_schemas.ts";
import { couplingGateHints } from "../coupling/coupling.ts";
import { colorEnabled, makeOut, type Out, outSink } from "../output.ts";
import { type TerminalContext, terminalContext } from "../../lib/terminal.ts";
import {
  assertMainMerged,
  detectSilentDivergence,
  integrationBranch,
} from "../worktree/git.ts";
import {
  type Diagnostic,
  dimBlock,
  type DiscernResult,
  type FailedStage,
  previewResult,
} from "../../shared/result.ts";
import type { GateData } from "../../shared/result_schemas.ts";
import { emitResult } from "../../shared/emit.ts";
import {
  fire,
  type FiredHint,
  firedHintsFromTexts,
  HINTS,
  hintTexts,
  interactiveHintTexts,
} from "../../shared/hints.ts";
import { observeResult } from "../../shared/result_capture.ts";
import { inlineFindingRoutes, proofFindingHints } from "../logbook/surfaces.ts";
import {
  attachValidationEvidence,
  completeValidationEvidence,
  VALIDATION_RUNS,
  type ValidationStart,
} from "../logbook/validation.ts";
import {
  captureValidationStart,
  validationBoundaryNotReached,
  type ValidationCaptureOptions,
} from "../logbook/validation_state.ts";
import {
  inspectLandingAuthority,
  landingAuthorityProjection,
  type LandingAuthorityResolution,
} from "../worktree/landing_authority.ts";
import { setupInProgressHint } from "../../shared/setup_state.ts";
import {
  checkInstructionCurrent,
  type InstructionDriftEntry,
} from "../instruction_render.ts";
import {
  checkSkillsCurrent,
  checkSkillsWellformed,
  type SkillsDriftEntry,
  type SkillWellformedness,
} from "../../lib/skills.ts";
import {
  gitLsFilesCommand,
  type TrackedDiscernIgnoredArtifacts,
  trackedDiscernIgnoredArtifacts,
  trackedDiscernIgnoredArtifactsHint,
} from "../../lib/agent_gitignore.ts";
import {
  writePreflightDiagnostic,
  type WritePreflightFailure,
  writePreflightFailureMessage,
} from "../../shared/write_preflight.ts";
import {
  planTrackedRefresh,
  type TrackedRefreshPlan,
} from "../tracked_refresh.ts";

/**
 * A compact, plain-text summary of how a stale generated file differs from what
 * `discern refresh` would write — the non-blank lines present in the file but NOT
 * in the recompiled body (what a refresh would remove, a hand-edit included).
 * Bounded so it never floods the diagnostic.
 */
function driftDiff(entry: InstructionDriftEntry): string {
  const expected = new Set(entry.expected.split("\n"));
  const added = (entry.actual ?? "").split("\n")
    .filter((l) => l.trim() !== "" && !expected.has(l));
  const shown = added.slice(0, 12).map((l) => `  + ${l}`);
  if (added.length > shown.length) {
    shown.push(`  … and ${added.length - shown.length} more line(s)`);
  }
  const head =
    `${entry.path}: differs from what \`discern refresh\` would write.`;
  return added.length > 0
    ? `${head}\n  These lines are in the file but not the recompiled output (a refresh removes them):\n${
      shown.join("\n")
    }`
    : `${head}\n  (the file is missing content a refresh would restore.)`;
}

/**
 * The Tier-0 {@link Diagnostic} for a stale agent file: the `discern
 * refresh` reproduce command, the redirect (edits belong in `[instructions].sources`,
 * not the generated file), and a capped diff of what a refresh would change — the
 * rescue, since the untracked file has no `git diff` to fall back on.
 */
async function instructionDiagnostic(
  root: string,
  stale: InstructionDriftEntry[],
): Promise<Diagnostic> {
  const files = stale.map((d) => d.path).join(", ");
  const outputFields = await diagnosticOutputFields(
    root,
    `Agent files are out of date: ${files}.\n` +
      "Run `discern refresh` to regenerate them. If you meant to change the " +
      "instructions, edit your [instructions].sources (e.g. instructions.md) instead — a direct " +
      "edit to a generated file is overwritten on the next refresh.\n\n" +
      stale.map(driftDiff).join("\n\n"),
  );
  return {
    tool: "instructions",
    severity: "error",
    message: `agent file(s) out of date: ${files}`,
    reproduce_cmd: "discern refresh",
    ...outputFields,
  };
}

/** The Tier-0 diagnostic for a non-empty read-only tracked-refresh plan. */
async function trackedRefreshDiagnostic(
  root: string,
  plan: TrackedRefreshPlan,
): Promise<Diagnostic> {
  const paths = plan.changes.map((change) => change.path);
  const details = plan.changes.map((change) => {
    const effects = [
      change.bytesChanged ? "bytes" : undefined,
      change.modeChanged ? "mode" : undefined,
    ].filter((effect): effect is string => effect !== undefined).join(" + ");
    return `  - ${change.path} (${effects}; ${change.kinds.join(" + ")})`;
  });
  const failures = plan.errors.map((error) => `  - ${error}`);
  const outputFields = await diagnosticOutputFields(
    root,
    "Tracked refresh artifacts are not converged. Running `discern refresh` " +
      "would change the tree, so this commit cannot earn a gate proof.\n\n" +
      (details.length > 0 ? `Planned changes:\n${details.join("\n")}\n` : "") +
      (failures.length > 0
        ? `\nPlanning errors:\n${failures.join("\n")}\n`
        : "") +
      "\nRun `discern refresh`, review and commit the named tracked files, then " +
      "re-run `discern done`.",
  );
  return {
    tool: "refresh",
    severity: "error",
    message: paths.length > 0
      ? `tracked refresh artifacts out of date: ${paths.join(", ")}`
      : "tracked refresh convergence could not be planned",
    reproduce_cmd: "discern refresh",
    ...outputFields,
  };
}

/**
 * A diagnostic for stale MATERIALIZED skills: which dirs/skills drifted from the
 * effective set, and the `discern refresh` that re-materializes them. The skills
 * analog of {@link instructionDiagnostic} — same redirect (edit the source, not the
 * generated copy), so the two generated-artifact failures read identically.
 */
async function skillsDiagnostic(
  root: string,
  stale: SkillsDriftEntry[],
): Promise<Diagnostic> {
  const dirs = [...new Set(stale.map((d) => d.dir))].join(", ");
  const outputFields = await diagnosticOutputFields(
    root,
    `Materialized skills are out of date in: ${dirs}.\n` +
      "Run `discern refresh` to re-materialize them. If you meant to change a skill, " +
      "edit its source under [skills].dir (or `discern skills eject` a bundled one) — a " +
      "direct edit to a materialized copy is overwritten on the next refresh.\n\n" +
      stale.map((d) => `  • ${d.detail}`).join("\n"),
  );
  return {
    tool: "skills",
    severity: "error",
    message: `materialized skills out of date: ${dirs}`,
    reproduce_cmd: "discern refresh",
    ...outputFields,
  };
}

/**
 * A diagnostic for MALFORMED skill frontmatter: each offending SKILL.md and its
 * problems, verbatim from the well-formedness check. Unlike the currency
 * failures, `discern refresh` cannot clear this — the SOURCE file is what every
 * consumer misreads — so the remedy is an edit, and the diagnostic says so.
 */
async function skillFrontmatterDiagnostic(
  root: string,
  malformed: SkillWellformedness[],
): Promise<Diagnostic> {
  const files = malformed.map((m) => m.file).join(", ");
  const outputFields = await diagnosticOutputFields(
    root,
    `Skill frontmatter that agent runtimes cannot read:\n\n` +
      malformed.map((m) =>
        `${m.file}:\n${m.issues.map((i) => `  • ${i}`).join("\n")}`
      ).join("\n\n") +
      "\n\nEdit each named source file. A SKILL.md opens with a `---`-fenced " +
      "YAML block whose `name:` and `description:` are non-empty strings; " +
      "a value containing `:` must be quoted.",
  );
  return {
    tool: "skill-frontmatter",
    severity: "error",
    message: `invalid SKILL.md frontmatter: ${files}`,
    reproduce_cmd: "discern done",
    ...outputFields,
  };
}

/**
 * A diagnostic for DUPLICATED ADR numbers: each number and the record files
 * claiming it. Neither refresh nor a re-run clears this — the records are
 * different files whose merge was clean, so the remedy is renumbering the
 * newer one, and the diagnostic says which files are in contention.
 */
async function adrNumbersDiagnostic(
  root: string,
  dupes: AdrNumberDuplicate[],
): Promise<Diagnostic> {
  const numbers = dupes.map((d) => d.number).join(", ");
  const outputFields = await diagnosticOutputFields(
    root,
    `ADR numbers claimed by more than one record:\n\n` +
      dupes.map((d) =>
        `${d.number}:\n${d.paths.map((p) => `  - ${p}`).join("\n")}`
      ).join("\n\n") +
      "\n\nKeep the number on the record that landed first (or the superseded " +
      "record that retired it), and move the newer record to the next free " +
      "number — filename, title, and any references to it.",
  );
  return {
    tool: "adr-numbers",
    severity: "error",
    message: `ADR number(s) claimed by more than one record: ${numbers}`,
    reproduce_cmd: "discern done",
    ...outputFields,
  };
}

/**
 * A diagnostic for MAP & INSTRUCTIONS integrity findings: every finding as
 * `file:line`, grouped by rule with each rule's remedy stated once — the fix
 * is at the point of failure, and one loop from the diagnostic clears it.
 * `discern refresh` cannot help here: the SOURCE files carry the defect, so
 * the remedy is always an edit (or, for a stale example, a registry fix).
 */
async function mapIntegrityDiagnostic(
  root: string,
  findings: DocsIntegrityFinding[],
): Promise<Diagnostic[]> {
  const byRule = new Map<DocsIntegrityRule, DocsIntegrityFinding[]>();
  for (const finding of findings) {
    byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding]);
  }
  const sections = [...byRule.entries()].map(([rule, group]) =>
    `${rule}:\n` +
    group.map((f) => `  ${f.file}:${f.line} ${f.detail}`).join("\n") +
    `\n  fix: ${DOCS_INTEGRITY_REMEDIES[rule]}`
  );
  const outputFields = await diagnosticOutputFields(
    root,
    "The map or instructions references things a reader cannot follow:\n\n" +
      sections.join("\n\n"),
  );
  return findings.map((finding) => ({
    tool: "map-integrity",
    severity: "error",
    message:
      `map or instructions integrity (${finding.rule}): ${finding.detail}`,
    reproduce_cmd: "discern done",
    file: finding.file,
    line: finding.line,
    rule: finding.rule,
    ...outputFields,
  }));
}

/**
 * A diagnostic for the maintained ADR index. STALE — the record lists between
 * the markers do not match the record files, and `discern refresh` rewrites
 * them (the currency remedy, with the capped drift diff). INVALID — the index
 * cannot be derived; the remedy follows the state's cause, so the reader is
 * never pointed at the wrong artifact: a record whose heading defeats the
 * derivation (edit that record), a start marker whose end marker is gone
 * (repair the README's pair), or an unexpected derivation failure (fix what
 * the issue reports).
 */
function adrIndexInvalidRemedy(
  state: Extract<AdrIndexState, { kind: "invalid" }>,
): string {
  switch (state.cause) {
    case "record":
      return "Fix the named record file — its first heading must carry the " +
        "record's number and a title — then run `discern refresh`.";
    case "markers":
      return `Repair the marker pair in ${state.path}: restore the missing ` +
        "END marker named above after its BEGIN marker (or remove the pair " +
        "to retire the maintained list). The record files may all be fine. " +
        "Then run `discern refresh`.";
    case "error":
      return "The derivation itself failed. Fix the underlying problem " +
        "reported above, then run `discern refresh`.";
  }
}

/** Turn an ADR index marker or title failure into an actionable map diagnostic. */
async function adrIndexDiagnostic(
  root: string,
  state: Extract<AdrIndexState, { kind: "stale" | "invalid" }>,
): Promise<Diagnostic> {
  const outputFields = await diagnosticOutputFields(
    root,
    state.kind === "stale"
      ? `The maintained ADR index is out of date: ${state.path}.\n` +
        "Run `discern refresh` to regenerate the record lists between its " +
        "markers, and commit the rewritten file. If you meant to change the " +
        "framing prose, edit outside the marked blocks — a refresh rewrites " +
        "only the lists.\n\n" +
        driftDiff({
          path: state.path,
          reason: "stale",
          expected: state.expected,
          actual: state.current,
        })
      : `The maintained ADR index in ${state.path} cannot be derived:\n\n` +
        `  ${state.issue}\n\n` +
        adrIndexInvalidRemedy(state),
  );
  return {
    tool: "adr-index",
    severity: "error",
    message: state.kind === "stale"
      ? `maintained ADR index out of date: ${state.path}`
      : `maintained ADR index cannot be derived: ${state.path}`,
    reproduce_cmd: state.kind === "stale" ? "discern refresh" : "discern done",
    ...outputFields,
  };
}

/** Explain which discern-managed ignored artifacts Git tracks and how to repair them. */
async function trackedArtifactsDiagnostic(
  root: string,
  tracked: TrackedDiscernIgnoredArtifacts,
): Promise<Diagnostic> {
  const outputFields = await diagnosticOutputFields(
    root,
    `${trackedDiscernIgnoredArtifactsHint(tracked).text}\n\n` +
      `Tracked paths:\n${tracked.paths.map((p) => `  - ${p}`).join("\n")}`,
  );
  return {
    tool: "tracked-artifacts",
    severity: "error",
    message: `discern-managed ignored artifacts are tracked by Git: ${
      tracked.paths.join(", ")
    }`,
    reproduce_cmd: gitLsFilesCommand(tracked.repairTargets),
    ...outputFields,
  };
}

/** Run the gate once: plan, apply, build the result. */
async function runGate(
  root: string,
  surface: GateOutputSurface,
  signal: AbortSignal | undefined,
  presentation: {
    /** Live CLI model injected by the fully attached entry-point command tree. */
    cliModel: CliModelProvider;
    validationCaptureOptions?: ValidationCaptureOptions;
    /** The already-settled checkpoint pre-flight (reconciliation ran before
     * the rerun guard); the gate carries its conclusions into the envelope,
     * the Proof, and the marker bindings. */
    checkpoints?: CheckpointPreflight;
  },
): Promise<
  {
    result: DiscernResult<GateData>;
    failedStage: FailedStage | null;
    cfg: DiscernConfig;
    policy: GateRunPolicy;
    out: Out;
    changed: string[];
    gotchasTail: GotchasFailureTail | undefined;
    outputWithheld: boolean;
    presentationWritable: boolean;
  }
> {
  // Pin the tree identity FIRST — before any precondition or job reads it. A green
  // outcome vouches for THIS (HEAD, clean) pair; recordGateOutcome re-verifies the
  // pin at stamp time, so a commit made while the gate runs can never earn a proof
  // naming a tree the jobs never read.
  const treePin = await pinValidatedTree(root);
  // Retention for the job output artifacts the run is about to create (ADR 0117)
  // — before jobs spawn, so the sweep can never sit on a job's kill path.
  await sweepDueTempArtifacts(root);
  const cfg = await loadConfig(root);
  const policy = resolveGateRunPolicy(cfg.gate.stream, surface);
  const generatedGroups = resolveGeneratedGroups(cfg);
  let liveGroups: readonly JobGroup[] | undefined;
  if (gateOutputIsLive(policy)) {
    // Admission remains pure so the merge check below is still the first
    // repository observation. The package fits this initial fact set and owns
    // every later resize or append-only degradation without changing policy.
    const admission = gateLiveAdmissionGroups(cfg, dryRunStandardJobs(cfg));
    liveGroups = admission.initialGroups;
  }
  // A regular human run follows the configured static transcript policy. A live
  // frame keeps complete capture while its package producer owns child text.
  // Quiet result surfaces silence both runner and Out because the envelope is the
  // entire output (ADR 0030). prepare and test consume this same policy seam.
  const { runOpts, out, runOut, flushDeferredOutput, slots } = gateRunContext(
    root,
    cfg,
    policy,
    signal,
  );
  const liveOutput = policy.output.kind === "live-frame"
    ? policy.output
    : undefined;
  const progress = liveGroups !== undefined && liveOutput !== undefined
    ? await createGateTtyProgress(out.raw, liveGroups, {
      width: liveOutput.ttyWidth,
      terminal: out.terminal,
    })
    : undefined;
  if (progress !== undefined) {
    runOpts.observer = progress;
    runOpts.outputObserver = progress;
  }
  const results = new Map<string, JobResult>();
  let failedStage: FailedStage | null = null;
  let writeAuthority: AdminStateWriteAuthority | undefined;
  let writeAccessFailure: WritePreflightFailure | undefined;
  let writeAccessDiag: Diagnostic | undefined;

  // 1. Merge precondition — checked FIRST and fail-fast (ADR 0050). HEAD is pinned
  //    for the gate, but linked worktrees share refs: a concurrent `accept` can move
  //    main while this run is in progress. A branch behind at the start must update
  //    and re-run regardless, which discards whatever the gate computed against the
  //    pre-integration tree, so front-loading still skips that doomed work. The
  //    stamp-time advisory below covers main moving during an otherwise-green run.
  //    No-op in the main checkout / outside a worktree (assertMainMerged self-skips),
  //    so the happy path pays one extra `merge-base --is-ancestor` and nothing more.
  const mainBranch = integrationBranch(cfg.repository.trunk);
  let mergeWarning: FiredHint | undefined;
  const merged = await assertMainMerged(root, mainBranch);
  if (merged.kind === "behind") {
    failedStage = "merge";
  } else if (merged.kind === "missing") {
    mergeWarning = fire(HINTS["missing-trunk-branch"], {
      branch: merged.branch,
    });
    runOut.warn(mergeWarning.text);
  }

  // 1a. The Standard protection (Tier 1) — every existing [standards]
  //     definition and limit against the trunk's committed copy, deletions
  //     included.
  //     Placed HERE, directly after the merge check: it is the cheapest
  //     precondition after it (one git read, milliseconds), it guards the very
  //     config every later job table was built from, and the merge check must
  //     precede it so the baseline is the freshest merged-in trunk copy. Not
  //     configurable — an escape hatch here would defeat the guarantee the
  //     product leads with. An unreadable trunk skips LOUDLY (a warning + the
  //     proof discloses it); a trunk config that was fetched but does not
  //     parse fails hard; never a silent pass either way.
  const stdPlan = buildStandardPlan(cfg);
  let standardsLimits: StandardsLimitsData | undefined;
  let standardLimitProposals: ReadonlyMap<
    string,
    StandardLimitProposalData
  > = new Map();
  let tier1Diagnostics: Diagnostic[] = [];
  let limitsWarning: FiredHint | undefined;
  if (failedStage === null) {
    const proposalInspection = await inspectActiveStandardLimitProposals(
      root,
      mainBranch,
      stdPlan.standards,
    );
    const verification = await verifyTrunkLimits(
      root,
      mainBranch,
      stdPlan.standards,
      proposalInspection.active,
    );
    standardLimitProposals = verification.proposals;
    for (const stale of proposalInspection.stale) {
      if (verification.blockedStandards.has(stale.proposal.standard)) {
        verification.diagnostics.unshift(
          staleProposalDiagnostic(stale.proposal.standard, stale.reason),
        );
      }
    }
    tier1Diagnostics = verification.diagnostics;
    if (verification.blocking) {
      failedStage = "standards";
    }
    // With no standards anywhere (none configured, none on the trunk), the
    // verification is vacuous — carry nothing, so a standards-free project's
    // result stays byte-identical to before.
    if (
      stdPlan.standards.length > 0 ||
      verification.summary.status === "loosened" ||
      verification.summary.status === "proposed" ||
      verification.summary.status === "parse_failed"
    ) {
      standardsLimits = verification.summary;
    }
    if (standardsLimits?.status === "unverified") {
      limitsWarning = fire(HINTS["gate-standards-limits-unverified"], {
        reason: standardsLimits.reason ?? "unknown",
        trunk: mainBranch,
      });
      runOut.warn(limitsWarning.text);
    }
  }

  // 1a-bis. Silent divergence: the gate is running in a PRISTINE worktree while
  //     the main checkout accumulates uncommitted changes — the signature of an
  //     agent that could not re-root and is editing the trunk while validating
  //     here. Advisory (a warning + hint, never a failure — the pre-existing-dirt
  //     case is legitimate), sharing status's wording via one helper.
  const divergenceWarning = await detectSilentDivergence(root, mainBranch);
  if (divergenceWarning !== undefined) {
    runOut.warn(divergenceWarning.text);
  }

  // 1b. Discern-owned ignored artifacts must not be tracked. A forced `git add -f`
  //     can put materialized skills or machine-local provider state into the index
  //     despite the canonical .gitignore block. Scoped to that block's enumerated
  //     rules, so the tracked-by-default compiled instruction files and a user's own
  //     files under a provider directory are never flagged.
  let trackedArtifactsDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const tracked = await trackedDiscernIgnoredArtifacts(root);
    if (tracked.paths.length > 0) {
      failedStage = "tracked_artifacts";
      trackedArtifactsDiag = await trackedArtifactsDiagnostic(root, tracked);
    }
  }

  // 1c. Generated-artifacts currency — instructions (ADR 0034) — also runs FIRST, as a
  //     fail-fast precondition beside the merge check (ADR 0056). Its verdict is
  //     invariant across the gate for the same reason the merge check's is: the gate
  //     never runs `discern refresh`, and its fix stage formats SOURCE code, never the
  //     instruction sources or the agent files those checks read —
  //     so checking here gives the same answer as checking last, while skipping the
  //     slow build/check∥test/scope-gate sweep when the only problem is stale drift the
  //     agent must `discern refresh` and re-run to clear regardless. Block a STALE agent
  //     file only (a MISSING one is tolerated: a tree that has not built them yet, or a
  //     project that deliberately keeps them untracked — see ADR 0034/0128).
  let instructionDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const stale = (await checkInstructionCurrent(root, cfg))
      .filter((d) => d.reason === "stale");
    if (stale.length > 0) {
      failedStage = "instructions";
      instructionDiag = await instructionDiagnostic(root, stale);
    }
  }

  // 1d. Materialized-skills currency (ADR 0034, extended to skills) — the same
  //     fail-fast precondition for the skills dirs. STALE blocks; MISSING (the whole
  //     dir absent on a fresh checkout) and FOREIGN (an unmanaged drop-in) do not.
  let skillsDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const stale = (await checkSkillsCurrent(root, cfg))
      .filter((d) => d.reason === "stale");
    if (stale.length > 0) {
      failedStage = "skills";
      skillsDiag = await skillsDiagnostic(root, stale);
    }
  }

  // 1d-bis. Skill frontmatter well-formedness — every effective skill's SKILL.md
  //     must carry frontmatter a real YAML parser reads to the same valid identity
  //     discern reads, because external agent runtimes consume the materialized
  //     copy with real YAML parsers. A malformed source ships a skill those
  //     runtimes reject or misread, so it blocks here, beside the other
  //     shipped-artifact preconditions.
  let skillFrontmatterDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const malformed = await checkSkillsWellformed(root, cfg);
    if (malformed.length > 0) {
      failedStage = "skill_frontmatter";
      skillFrontmatterDiag = await skillFrontmatterDiagnostic(root, malformed);
    }
  }

  // 1d-ter. ADR number uniqueness — a number identifies one decision forever, and
  //     two records claiming it are different files that MERGE CLEANLY: the state
  //     two in-flight branches land in whenever both picked the next free number.
  //     `discern update` brings the first lander's record into this tree, so the
  //     duplicate is visible right here, right when the second lander can still
  //     renumber cheaply. Tree-wide (not branch-relative) by design: a duplicate
  //     is wrong wherever it came from, and any branch can carry the renumber.
  let adrNumbersDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const dupes = await duplicateAdrNumbers(root, cfg.map.dir);
    if (dupes.length > 0) {
      failedStage = "adr_numbers";
      adrNumbersDiag = await adrNumbersDiagnostic(root, dupes);
    }
  }

  // 1d-quater. Maintained-ADR-index currency (the ADR 0034 pattern, extended to
  //     the record lists a refresh keeps between markers in the ADR README).
  //     Opt-in by construction: a project without the markers is never checked.
  //     STALE blocks — a record on disk the index doesn't reflect is invisible
  //     to every reader who opens the index instead of the directory — and so
  //     does INVALID (a record the derivation cannot title), since a refresh
  //     cannot heal it and the index would silently rot from there. Runs before
  //     the heavier map-integrity corpus scan: one file's state, checked cheaply.
  let adrIndexDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const state = await adrIndexState(root, cfg.map.dir);
    if (state.kind === "stale" || state.kind === "invalid") {
      failedStage = "adr_index";
      adrIndexDiag = await adrIndexDiagnostic(root, state);
    }
  }

  // 1d-quinquies. The complete tracked-refresh convergence predicate. Earlier
  //     specialist checks retain their precise remedies and stage names; this
  //     plan catches every remaining tracked writer (generated attributes, MCP,
  //     hooks, app config, project rules, and mode-only effects) through the same
  //     transformations `discern refresh` applies. It is read-only and fail-closed:
  //     a planning error cannot mint a proof whose convergence was unproved.
  let trackedRefreshDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const refreshPlan = await planTrackedRefresh(root, cfg);
    if (refreshPlan.changes.length > 0 || refreshPlan.errors.length > 0) {
      failedStage = "refresh_drift";
      trackedRefreshDiag = await trackedRefreshDiagnostic(root, refreshPlan);
    }
  }

  // 1d-sexies. Map & instructions integrity — the documentation agents and the
  //     published projections read must not reference things that do not exist:
  //     dead intra-map links and anchors, metadata blocks the lenient reader
  //     would swallow, fenced `discern` examples the current CLI rejects,
  //     published pages linking into the internal trees, and citations of
  //     skills outside the effective set. Blocking, beside the other artifact
  //     preflights: each finding is a defect a reader only discovers by
  //     following the reference and failing, and no later stage can clear it.
  //     The CLI model comes from the fully attached entry-point command tree
  //     through an explicit provider, so this lower-level preflight never
  //     imports the binary entry point that consumes it.
  let mapIntegrityDiagnostics: Diagnostic[] = [];
  if (failedStage === null) {
    const findings = await checkDocsIntegrity(
      root,
      cfg,
      presentation.cliModel(),
    );
    if (findings.length > 0) {
      failedStage = "map_integrity";
      mapIntegrityDiagnostics = await mapIntegrityDiagnostic(root, findings);
    }
  }

  // 1e. Write authority — a REAL create/write/rename/remove probe, not permission
  //     metadata. The gate may need to stamp or clear its gate/measurement state
  //     after every outcome, so prove that tiny late effect before any project job
  //     can consume minutes. The branded token is then required by every writer.
  //     A denial on an otherwise-runnable gate is therefore an immediate failure,
  //     with the exact path in diagnostics, rather than a green-but-unproofed run
  //     that `accept` has to repeat. Existing cheap preconditions retain priority;
  //     when one already blocked, a successful probe merely lets its red outcome
  //     clear stale state, and a denied probe does not hide the actionable blocker.
  const writePreflight = await preflightAdminStateWrites(root);
  if (writePreflight.ok) {
    writeAuthority = writePreflight.authority;
  } else {
    writeAccessFailure = writePreflight;
    if (failedStage === null) {
      failedStage = "write_access";
      writeAccessDiag = writePreflightDiagnostic(
        writePreflight,
        "discern done",
      );
    }
  }

  // 2. Run the declared job stage groups (fix → build → check∥test). These do
  //    not depend on the changed scopes, so they run before scope classification.
  //    ANY stage may mutate the tree — the fix stage by design, a build/test/scope
  //    gate by accident of wiring (a regenerated tracked artifact, a rewritten
  //    golden file) — so snapshot the working-tree dirty set before any group runs
  //    and again after each green group. The strand check (the checkpoint at
  //    2-bis, the final pass at step 5) flags files a
  //    stage dirtied that were committed-clean at gate start — the uncommitted gate
  //    output a green result would otherwise hide (ADR 0047, extended by ADR 0148)
  //    — and the per-group snapshots attribute each strand to the stage that
  //    produced it. Snapshots are skipped once a stage has failed (the strand
  //    check only runs on an otherwise-green gate); an unreadable snapshot voids
  //    the check (fail-open: a missing snapshot must never fabricate a failure).
  const preGroups = preCheckpointGroups(cfg);
  const dirtyAtStart = failedStage === null
    ? await worktreeDirtyPaths(root)
    : null;
  const stageSnapshots: StageSnapshot[] = [];
  let generatedDiagnostics: Diagnostic[] = [];
  let generatedFailureRemedies: FiredHint[] | undefined;
  let snapshotsValid = dirtyAtStart !== null;
  const snapshotAfter = async (stage: FailedStage): Promise<void> => {
    if (!snapshotsValid) {
      return;
    }
    const dirty = await worktreeDirtyPaths(root);
    if (dirty === null) {
      snapshotsValid = false;
      return;
    }
    stageSnapshots.push({ stage, dirty });
  };
  // The one strand verdict (ADR 0047/0148), shared by the checkpoint at 2-bis
  // and the final pass at step 5 so the two sites cannot diverge: on an
  // otherwise-green run whose snapshots are trustworthy, fail as `tree_drift`
  // when a stage left a committed-clean tracked file dirty in the LATEST
  // snapshot. Only files clean at gate start count — a stage reworking the
  // agent's own uncommitted edits (the inner loop) never trips — and each
  // strand names the stage that produced it. The `failedStage` guard makes a
  // second detection, and so a duplicate diagnostic, structurally impossible.
  let treeDriftDiag: Diagnostic | undefined;
  const failOnStrandedTree = async (): Promise<void> => {
    if (failedStage !== null || dirtyAtStart === null || !snapshotsValid) {
      return;
    }
    const strands = strandedByStage(dirtyAtStart, stageSnapshots);
    if (strands.length === 0) {
      return;
    }
    failedStage = "tree_drift";
    treeDriftDiag = await treeDriftDiagnostic(root, strands);
  };
  for (const group of preGroups) {
    if (failedStage !== null) {
      break;
    }
    const generatedBefore = group.stage === "build" &&
        generatedGroups.length > 0
      ? await captureGeneratedBuildSnapshot(root, generatedGroups)
      : undefined;
    if (!(await runGroup(group, results, runOpts, runOut, slots))) {
      failedStage = group.stage;
      break;
    }
    if (generatedBefore !== undefined && generatedBefore !== null) {
      const generatedAfter = await captureGeneratedBuildSnapshot(
        root,
        generatedGroups,
      );
      if (generatedAfter !== null) {
        const drift = generatedBuildDrift(
          generatedGroups,
          generatedBefore,
          generatedAfter,
        );
        if (drift.groups.length > 0 || drift.unownedPaths.length > 0) {
          generatedDiagnostics = await generatedBuildDriftDiagnostics(
            root,
            drift,
          );
          generatedFailureRemedies = [
            ...drift.groups.map(({ group }) =>
              fire(HINTS["gate-failure-generated-drift"], {
                group: group.name,
                run: group.run,
              })
            ),
            ...(drift.unownedPaths.length > 0
              ? [
                fire(HINTS["gate-failure-generated-undercoverage"], {
                  groups: drift.candidates.map((candidate) => candidate.name),
                }),
              ]
              : []),
          ];
          failedStage = "generated_drift";
          break;
        }
      }
    }
    await snapshotAfter(group.stage);
  }

  // 2-bis. The strand checkpoint (ADR 0262): a run that began on a clean,
  //     committed tree is seeking a proof, and a tracked strand left by the
  //     pre-groups above already forfeits it — the standards, check∥test, and
  //     scope-gate work ahead cannot change that verdict, so stop here and
  //     surface the strands while nothing has been wasted on them. Judged only
  //     after ALL pre-groups (a later build may consume or restore a fixer's
  //     edit, and convergence edits belong in one report), and gated on the
  //     PIN's full cleanliness, never the tracked-dirty snapshot: the pin
  //     counts untracked files, so an untracked-dirty start — whose tracked
  //     snapshot is empty — must not read as proof-eligible. A dirty start
  //     skips the checkpoint entirely: it can earn no proof anyway, and the
  //     agent running `done` dirty is asking for the full run's feedback,
  //     which the final pass (step 5) still delivers. A failed pre-group or
  //     generated-drift verdict above wins outright — the closure yields to
  //     any recorded failure.
  const proofEligibleAtStart = treePin.head !== undefined && treePin.clean;
  if (proofEligibleAtStart) {
    await failOnStrandedTree();
  }

  // 2a. Resolve the standards' gate actions AFTER the fix stage — a fixer's
  //     edits are changes an input-keyed replay must count — and only on the
  //     live path: when a precondition or an early stage already failed, the
  //     config-only resolution (measure/defer; replay is a run-time decision)
  //     keeps the report honest without claiming replays nothing verified.
  //     Zero cost when [standards] is empty: no jobs, no reads, no fields.
  const resolved: ResolvedStandard[] = stdPlan.standards.length === 0
    ? []
    : failedStage === null
    ? await resolveStandardActions(
      root,
      stdPlan.standards,
      new Set(standardLimitProposals.keys()),
    )
    : resolveStandardActionsFromConfig(stdPlan.standards);
  const gateStandards = buildStandardJobs(root, resolved, {
    defaultTimeout: gateTimeoutBudget(cfg),
    proposals: standardLimitProposals,
  });
  const ctGroups = checkTestGroups(cfg, gateStandards.jobs);
  let validation: ValidationStart | undefined;
  if (cfg.project.logbook) {
    // This is the shared validation boundary: every mutating fix/build group
    // has settled, and no check/test/measurement job has started. A prior red
    // records why the boundary was not reached instead of sampling another tree.
    validation = failedStage === null
      ? await captureValidationStart(
        root,
        cfg,
        VALIDATION_RUNS.done,
        ctGroups,
        presentation.validationCaptureOptions ?? {},
      )
      : await validationBoundaryNotReached(
        root,
        cfg,
        VALIDATION_RUNS.done,
        ctGroups,
        presentation.validationCaptureOptions ?? {},
      );
  }

  // 2b. The check/test groups — declared jobs AND the standards' measurement
  //     jobs under one scheduler (fail-fast, buffering, the per-job timeout).
  //     Uncapped this is the one combined check∥test group; under the fleet
  //     test-run cap the check stage runs first so it can fail before the test
  //     group waits for a slot (the split is checkTestGroups' contract).
  //     Replayed standards settle when their group is reached: their
  //     synthesized results are seeded so the serialization reads them like any
  //     other outcome — and a replayed value the branch's own tightened limit
  //     now fails is a genuine gate failure.
  let replayFailure = false;
  for (const group of ctGroups) {
    if (failedStage !== null) {
      break;
    }
    const holdsStandards = group.jobs.some((j) => j.kind === "standard");
    if (holdsStandards) {
      for (const [label, result] of gateStandards.synthesized) {
        results.set(label, result);
        if (result.code !== 0) {
          replayFailure = true;
        }
      }
    }
    const groupOk = await runGroup(
      group,
      results,
      runOpts,
      runOut,
      slots,
      gateStandards.evaluators,
    );
    gateStandards.settle(results);
    const standardFailure = group.jobs.some((job) =>
      job.kind === "standard" && (results.get(job.label)?.code ?? 0) !== 0
    );
    if (!groupOk) {
      failedStage = group.stage;
    } else if (holdsStandards && (replayFailure || standardFailure)) {
      failedStage = group.stage;
    } else {
      await snapshotAfter(group.stage);
    }
  }
  const stageGroups = [...preGroups, ...ctGroups];

  // 3. Classify the changed scopes AFTER the stage groups — preserving the gate's
  //    original timing, so a fix-stage edit is reflected and scope selection keeps
  //    its fail-open bias (it never runs FEWER gates than the post-fix tree warrants).
  //    Computed even when the merge precondition failed, so the result still lists the
  //    scopes (their gates serialize as skipped, like every other downstream step).
  const impact = await classifyScopeImpact(root, cfg);
  const changed = impact.scopes;
  const sgGroup = scopeGatesGroup(planScopeGates(cfg, changed));
  const plan = composeGatePlan(
    stageGroups,
    sgGroup,
    changed,
    presentation.checkpoints?.mode ?? "strict",
    impact.previewActions,
  );
  progress?.replaceGroups(plan.groups);

  // 4. Scope gates (only when the stage groups passed).
  if (failedStage === null && sgGroup !== undefined) {
    if (!(await runGroup(sgGroup, results, runOpts, runOut, slots))) {
      failedStage = "scope_gates";
    } else {
      await snapshotAfter("scope_gates");
    }
  }

  // 5. The final strand pass (ADR 0034's sibling; ADR 0047, extended by ADR
  //     0148): a stage may MUTATE the tree (the fix stage by design, any other by
  //     accident of wiring), but a clean gate must not hide uncommitted gate
  //     output. The checkpoint (2-bis) already settled the pre-group half for a
  //     proof-eligible start; this closing pass catches strands the check∥test
  //     and scope-gate stages introduced — and, on a dirty start, every stage's.
  await failOnStrandedTree();

  // Re-evaluate at the proof boundary. The early pass is the fast refusal;
  // this closing pass is the invariant: no green result can outlive a source,
  // config, mode, or provider-state change made while the jobs were running.
  if (failedStage === null) {
    const refreshPlan = await planTrackedRefresh(root, cfg);
    if (refreshPlan.changes.length > 0 || refreshPlan.errors.length > 0) {
      failedStage = "refresh_drift";
      trackedRefreshDiag = await trackedRefreshDiagnostic(root, refreshPlan);
    }
  }

  // 6. Assemble the executed plan + result, attaching the agent-facing hints —
  //    the same next-step advice the human tail prints, promoted into the envelope.
  const { result, firedHints: jobOutputHints } = await buildGateResultWithHints(
    root,
    plan,
    results,
    failedStage,
    generatedFailureRemedies,
  );
  if (slots?.waitedMs !== undefined) {
    result.waitedMs = slots.waitedMs;
  }
  // The checkpoint block (agent evidence) rides every completed run, green or
  // red, so a caller can always see which conclusions currently stand.
  const checkpointPreflight = presentation.checkpoints;
  const checkpointData = checkpointPreflight === undefined
    ? undefined
    : gateCheckpointsData(checkpointPreflight);
  if (result.data !== undefined && checkpointData !== undefined) {
    result.data.checkpoints = checkpointData;
  }
  // 6a. The standards' envelope fields (ADR 0133): the per-standard outcomes and
  //     the Tier-1 verification, plus the measured value patched into each
  //     measured step's note — the proof renders FROM these, never a second
  //     computation.
  const standardsData: GateStandard[] = gateStandardsData(
    resolved,
    gateStandards,
  );
  if (result.data !== undefined) {
    if (standardsData.length > 0) {
      result.data.standards = standardsData;
    }
    if (standardsLimits !== undefined) {
      result.data.standards_limits = standardsLimits;
    }
  }
  for (const o of standardsData) {
    if (o.measurement !== "measured" || o.value === undefined) {
      continue;
    }
    const step = (result.steps ?? []).find(
      (s) => s.step.label === standardJobLabel(o.name),
    );
    if (step !== undefined && step.step.note !== undefined) {
      step.step.note = `${step.step.note}, measured ${fmtRate(o.value)}`;
    }
  }
  // The fail-fast checks aren't plan-group jobs, so their diagnostics are attached
  // here, like the merge stage's failed_stage rides in `data` without a job entry.
  if (tier1Diagnostics.length > 0) {
    result.diagnostics = [
      ...tier1Diagnostics,
      ...(result.diagnostics ?? []),
    ];
  }
  if (trackedArtifactsDiag !== undefined) {
    result.diagnostics = [
      ...(result.diagnostics ?? []),
      trackedArtifactsDiag,
    ];
  }
  if (instructionDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), instructionDiag];
  }
  if (skillsDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), skillsDiag];
  }
  if (skillFrontmatterDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), skillFrontmatterDiag];
  }
  if (adrNumbersDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), adrNumbersDiag];
  }
  if (adrIndexDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), adrIndexDiag];
  }
  if (trackedRefreshDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), trackedRefreshDiag];
  }
  if (mapIntegrityDiagnostics.length > 0) {
    result.diagnostics = [
      ...(result.diagnostics ?? []),
      ...mapIntegrityDiagnostics,
    ];
  }
  if (writeAccessDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), writeAccessDiag];
  }
  if (generatedDiagnostics.length > 0) {
    result.diagnostics = [
      ...(result.diagnostics ?? []),
      ...generatedDiagnostics,
    ];
  }
  if (treeDriftDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), treeDriftDiag];
  }
  // The gotchas tail (ADR 0189) — resolved AFTER every diagnostic is attached,
  // because trap matchers read the failure's full evidence. One resolution
  // serves the envelope's hints and the human failure tail alike.
  const gotchasTail = failedStage !== null
    ? await gateFailureGotchasTail(cfg, root, {
      failedStage,
      diagnostics: result.diagnostics ?? [],
    })
    : undefined;
  // The proof (v1): a GREEN run over a CLEAN committed tree ahead of the trunk
  // renders the compact review summary from this very envelope — the artifact the
  // agent relays to its owner at the review moment. Built before the marker write so
  // the marker can store the markdown beside the sha it vouches for.
  const proof = failedStage === null
    ? await buildGateProof(
      root,
      mainBranch,
      result.steps ?? [],
      standardsData,
      standardsLimits,
      checkpointPreflight === undefined
        ? undefined
        : proofCheckpointsData(checkpointPreflight),
      checkpointPreflight?.mode ?? "strict",
      checkpointPreflight?.drops ?? [],
      [...standardLimitProposals.values()],
    )
    : undefined;
  // Record the measurement proof (ADR 0112, extended by ADR 0133): a green
  // gate over a clean committed tree records every value it holds (measured or
  // replayed — a replayed value is a real measurement of an identical input
  // set), so an immediate `standards --pin` replays instead of re-measuring and
  // the next gate run has a baseline to replay against. Durations ride along so
  // a defer decision can be made from data. Fail-closed on red: a failing
  // standard's values must not stay reusable.
  if (writeAuthority !== undefined) {
    await recordFreshStandardMeasurementEvidence(
      root,
      writeAuthority,
      standardsData,
      treePin,
    );
  }
  if (failedStage === null) {
    const values: Record<string, number> = {};
    const durations: Record<string, number> = {};
    for (const o of standardsData) {
      if (
        o.value !== undefined &&
        (o.measurement === "measured" || o.measurement === "replayed")
      ) {
        values[o.name] = o.value;
        if (o.duration_s !== undefined) {
          durations[o.name] = o.duration_s;
        }
      }
    }
    if (Object.keys(values).length > 0 && writeAuthority !== undefined) {
      await recordStandardMeasurements(
        root,
        writeAuthority,
        values,
        treePin,
        durations,
      );
    }
  } else if (
    writeAuthority !== undefined &&
    standardsData.some(
      (o) =>
        o.verdict === "regressed" ||
        (o.measurement === "measured" && o.value === undefined),
    )
  ) {
    await clearStandardMeasurements(root, writeAuthority);
  }
  // Linked worktrees share the trunk ref, so another worktree can advance it
  // after the fail-fast check. Re-check beside the proof stamp and report the
  // new state without changing the green verdict or withholding the proof:
  // the proof vouches for the pinned HEAD, while `accept` retains the final
  // live-ref check. This observation can race too, so it stays advisory.
  let trunkAdvanceWarning: FiredHint | undefined;
  if (failedStage === null) {
    const stampMerge = await assertMainMerged(root, mainBranch);
    if (stampMerge.kind === "behind") {
      trunkAdvanceWarning = fire(HINTS["gate-trunk-advanced"]);
      runOut.warn(trunkAdvanceWarning.text);
    }
  }
  // Record the gate proof (ADR 0067): a GREEN run over a CLEAN tree stamps the
  // HEAD pinned at gate start so `accept` can prove THIS tree already passed without
  // re-running the gate; a FAILED run clears any stale vouch. Write authority was a
  // fail-fast precondition; the writer remains best-effort only against a later
  // point-in-time failure, whose outcome rides in `data` for suppressed loggers.
  const gateProof: NonNullable<GateData["gate_proof"]> =
    writeAuthority === undefined
      ? {
        status: "unavailable",
        ...(writeAccessFailure !== undefined
          ? {
            path: writeAccessFailure.path,
            reason: writePreflightFailureMessage(writeAccessFailure),
          }
          : { reason: "write authority was not established" }),
      }
      : await recordGateOutcome(
        root,
        writeAuthority,
        failedStage === null,
        treePin,
        proof,
        checkpointPreflight?.evidence,
        checkpointPreflight?.mode ?? "strict",
      );
  // The last-run marker remembers what this run judged — every verdict, red
  // included, unlike the proof above — so the next `done` can resist an
  // unchanged red retry unless it carries `--rerun` (or its compatibility alias).
  if (writeAuthority !== undefined) {
    await recordLastGateRun(
      root,
      writeAuthority,
      failedStage === null,
      await gateRunEvidenceIdentity(root, checkpointPreflight?.evidence),
      checkpointPreflight?.mode ?? "strict",
    );
  }
  // A stamp refused because HEAD moved mid-run also suppresses the rendered review
  // proof: its git facts were gathered AFTER the move, so its markdown describes a
  // tree the gate never read — the hint tells the agent to re-run on the final commit.
  const emittedProof = gateProof.status === "skipped_head_moved"
    ? undefined
    : proof;
  const landingAuthority = failedStage === null && emittedProof !== undefined &&
      checkpointPreflight?.mode !== "report"
    ? await inspectLandingAuthority(root, mainBranch)
    : undefined;
  if (result.data !== undefined) {
    result.data.gate_proof = gateProof;
    if (emittedProof !== undefined) {
      result.data.proof = emittedProof;
    }
    const authorityProjection = landingAuthority === undefined
      ? undefined
      : landingAuthorityProjection(landingAuthority);
    if (authorityProjection !== undefined) {
      result.data.landing_authority = authorityProjection;
    }
  }
  // Pre-setup, lead with the "setup unfinished" advisory (ADR 0065): finish runs
  // during setup, so a green gate here must not read as "done".
  const inProgress = setupInProgressHint(cfg.meta.bootstrapped);
  // The coupling advisory (ADR 0084), behind [coupling].in_gate — at the
  // TAIL, with strand detection, because it READS THE DIFF (dependency-bearing), never a
  // fail-fast precondition. Only on a GREEN, bootstrapped run: a half-set-up install
  // behaves as if coupling were off (its in-session setup must stay uncluttered), and a
  // failed gate is not the moment for an advisory. Best-effort and never blocking — it
  // touches only `hints`, so it can't move `ok` / the exit code / `failed_stage`.
  const couplingHints =
    failedStage === null && cfg.meta.bootstrapped && cfg.coupling.in_gate
      ? await couplingGateHints(root)
      : [];
  // Logbook findings share the coupling advisory's presentation boundary:
  // green, bootstrapped, best-effort, and at the tail. A branch finding must
  // also have a real proof to sit beside, and the formatter caps the whole
  // addition at one line after applying its stricter evidence margin.
  const logbookHints = failedStage === null && cfg.meta.bootstrapped &&
      emittedProof !== undefined
    ? proofFindingHints(
      (await inlineFindingRoutes(root, cfg)).done,
      emittedProof.branch,
    )
    : [];
  const proofHint = gateProofHint(gateProof, failedStage);
  // Checkpoint deliveries ride the envelope's one advisory channel: fail-open
  // accounts as notices, each fired advise-mode question served in full, and
  // — on a green run with a declared-unmet conclusion standing — the landing
  // consequence, so a green Proof is never mistaken for a landable one.
  const checkpointAdvisoryHints = checkpointDropAccounts(
    checkpointPreflight?.drops ?? [],
  ).map(
    (advisory) => fire(HINTS["checkpoint-advisory"], { advisory }),
  );
  const adviseHints = (checkpointPreflight?.advise ?? []).map((served) =>
    fire(HINTS["checkpoint-advise"], {
      id: served.id,
      question: served.question.trim(),
      ...(served.questionFile === undefined
        ? {}
        : { questionFile: served.questionFile }),
      ...(served.reference === undefined
        ? {}
        : { reference: served.reference }),
      matched: [...served.matched],
      related: relatedCheckpointData(served.related),
    })
  );
  const varianceHints =
    failedStage === null && checkpointPreflight !== undefined &&
      checkpointPreflight.declaredUnmet.length > 0
      ? [
        fire(HINTS["gate-variance-required"], {
          ids: checkpointPreflight.declaredUnmet.map((unmet) => unmet.id),
        }),
      ]
      : [];
  const reportHints = checkpointPreflight?.mode === "report"
    ? [fire(HINTS["gate-checkpoint-review-reported"])]
    : [];
  const deferredStandards = standardsData
    .filter((o) => o.measurement === "deferred")
    .map((o) => o.name);
  // On failure, the stage remedy leads the envelope: the terminal renderer and
  // accept both read that first hint as their headline.
  const leadingFailureHints = failedStage !== null ? jobOutputHints : [];
  const trailingJobHints = failedStage === null ? jobOutputHints : [];
  const hints: FiredHint[] = [
    ...leadingFailureHints,
    ...(inProgress !== undefined ? [inProgress] : []),
    ...(mergeWarning !== undefined ? [mergeWarning] : []),
    ...(trunkAdvanceWarning !== undefined ? [trunkAdvanceWarning] : []),
    ...(divergenceWarning !== undefined ? [divergenceWarning] : []),
    ...(limitsWarning !== undefined ? [limitsWarning] : []),
    ...checkpointAdvisoryHints,
    // The fleet test-run cap's wait notices (the same lines the human run
    // narrated live), so a --json/MCP caller sees why the run took longer.
    ...(slots?.waits ?? []),
    ...(proofHint !== undefined ? [proofHint] : []),
    ...reportHints,
    ...varianceHints,
    ...buildGateHints(
      plan.previewActions,
      failedStage,
      gotchasTail,
      emittedProof !== undefined,
      deferredStandards,
      landingAuthority,
    ),
    ...adviseHints,
    ...trailingJobHints,
    ...couplingHints,
    ...logbookHints,
  ];
  if (hints.length > 0) {
    result.hints = hintTexts(hints);
  } else {
    delete result.hints;
  }
  if (validation !== undefined) {
    attachValidationEvidence(
      result,
      completeValidationEvidence(validation, result.steps),
    );
  }
  await progress?.complete(result.steps ?? []);
  const liveWriteFailed = progress?.writeFailed() ?? false;
  const deferredOutputFlushed = liveWriteFailed ? false : flushDeferredOutput();
  return {
    result,
    failedStage,
    cfg,
    policy,
    out,
    changed,
    gotchasTail,
    // A live tail is bounded and transient. Even when the deferred headings
    // flushed successfully, a failure still needs its durable diagnostic
    // excerpt and full-artifact route below the restored frame.
    outputWithheld: gateOutputIsLive(policy),
    presentationWritable: !liveWriteFailed && deferredOutputFlushed,
  };
}

/** Fire the post-gate hint that identifies the proof bound to clean HEAD. */
function gateProofHint(
  proof: NonNullable<GateData["gate_proof"]>,
  failedStage: FailedStage | null,
): FiredHint | undefined {
  if (failedStage === null) {
    switch (proof.status) {
      case "recorded":
        return undefined;
      case "skipped_dirty":
        return fire(HINTS["gate-proof-skipped-dirty"], {
          reason: proof.reason,
        });
      case "skipped_head_moved":
        return fire(HINTS["gate-proof-head-moved"], {
          reason: proof.reason,
        });
      case "record_failed":
        return fire(HINTS["gate-proof-record-failed"], {
          reason: proof.reason,
        });
      case "unavailable":
        return fire(HINTS["gate-proof-unavailable"], {
          reason: proof.reason,
        });
      case "cleared":
      case "clear_failed":
        return undefined;
    }
  }
  if (proof.status === "clear_failed") {
    return fire(HINTS["gate-proof-clear-failed"], {
      reason: proof.reason,
    });
  }
  return undefined;
}

/**
 * The agent-facing "what next" hints for a finished gate — the SINGLE source of
 * the advice that rides in the `--json` envelope (`hints`) and is printed by the
 * human success tail. On a failure: the resolved gotchas tail — the matched trap
 * entry or the doc pointer, plus any malformed-matcher warnings (when a
 * `gotchas_doc` is set). On success: update the docs, run any deferred
 * standards, view a previewable change.
 */
function buildGateHints(
  previewActions: readonly PreviewActionData[],
  failedStage: FailedStage | null,
  gotchasTail: GotchasFailureTail | undefined,
  proofEmitted: boolean,
  deferredStandards: string[],
  landingAuthority: LandingAuthorityResolution | undefined,
): FiredHint[] {
  if (failedStage !== null) {
    return gotchasTail === undefined
      ? []
      : [gotchasTail.hint, ...gotchasTail.warnings];
  }
  const proofRoute = landingAuthority?.kind === "authorized"
    ? fire(HINTS["gate-land-under-verified-authority"], {
      source: landingAuthority.consent.source,
      scopes: landingAuthority.consent.scopes ?? [],
    })
    : landingAuthority !== undefined &&
        landingAuthorityProjection(landingAuthority) !== undefined
    ? fire(HINTS["gate-relay-uncovered-authority"])
    : fire(HINTS["gate-relay-proof"]);
  const hints = proofEmitted
    ? [
      fire(HINTS["gate-prove-it-works"]),
      proofRoute,
    ]
    : [];
  hints.push(fire(HINTS["gate-update-docs"]));
  if (deferredStandards.length > 0) {
    hints.push(
      fire(HINTS["gate-deferred-standards"], {
        names: deferredStandards,
      }),
    );
  }
  for (const action of previewActions) {
    hints.push(fire(HINTS["gate-previewable-change"], action));
  }
  return hints;
}

const DONE_TTY_ROUTINE_HINT_IDS = new Set([
  HINTS["gate-update-docs"].id,
  HINTS["gate-deferred-standards"].id,
]);

/**
 * Keep exceptional human advisories above the compact proof, while leaving
 * its routine follow-ups in the envelope. The highlighted line already names
 * the full proof, where deferred standards carry their command.
 */
function doneTtyProofHintTexts(
  texts: readonly string[] | undefined,
): string[] {
  const routineTexts = new Set(
    firedHintsFromTexts(texts)
      .filter((hint) => DONE_TTY_ROUTINE_HINT_IDS.has(hint.id))
      .map((hint) => hint.text),
  );
  return interactiveHintTexts(texts).filter((text) => !routineTexts.has(text));
}

/**
 * Print the informational success tail (non-`--json`). A TTY gets the compact
 * job table and highlighted one-line proof. A pipe keeps the stored Markdown
 * page, preserving the copyable proof surface used by scripts and agents.
 */
function printSuccessTail(
  cfg: DiscernConfig,
  out: Out,
  result: DiscernResult<GateData>,
  ttyWidth?: number,
  tableAlreadyRendered = false,
): void {
  let unfilled = 0;
  for (const stage of STAGES) {
    if (cmdsInStage(cfg, stage) === ":") {
      unfilled++;
    }
  }

  const proof = result.data?.proof;
  if (ttyWidth !== undefined && proof !== undefined) {
    if (unfilled === STAGES.length) {
      out.ok(
        "Gate passed — but no job is wired, so nothing was actually checked (a no-op gate).",
      );
      out.warn(
        `Add a known job (${knownJobList()}) or a custom [jobs.<name>] table to discern.toml so the gate has something to run.`,
      );
    }
    for (const hint of doneTtyProofHintTexts(result.hints)) {
      out.info(hint);
    }
    const options = {
      width: ttyWidth,
      terminal: out.terminal,
    };
    out.group("gate-summary");
    out.raw(
      `${
        tableAlreadyRendered
          ? renderDoneTtyProofPanel(
            proof,
            options,
            result.data?.gate_proof,
            result.steps ?? [],
            result.data?.landing_authority,
          )
          : renderDoneTtySummary(
            result.steps ?? [],
            proof,
            options,
            result.data?.standards ?? [],
            result.data?.gate_proof,
            result.data?.landing_authority,
          )
      }\n`,
    );
    renderSlotWait(out, result.waitedMs);
    return;
  }

  if (ttyWidth !== undefined && !tableAlreadyRendered) {
    out.group("gate-results");
    out.raw(
      `${
        renderGateTtyTable(result.steps ?? [], {
          width: ttyWidth,
          terminal: out.terminal,
        }, result.data?.standards ?? [])
      }\n`,
    );
  }

  if (unfilled === STAGES.length) {
    out.ok(
      "Gate passed — but no job is wired, so nothing was actually checked (a no-op gate).",
    );
    out.warn(
      `Add a known job (${knownJobList()}) or a custom [jobs.<name>] table to discern.toml so the gate has something to run.`,
    );
  } else {
    out.ok("Everything built and all checks passed.");
    if (unfilled > 0) {
      // This is an intentionally pre-composed human line: applying terminalLine
      // after the package role would expose the package-owned SGR instead of
      // preserving the muted note. Dynamic facts are numeric and locally owned.
      out.raw(renderGateStageGapNote(unfilled, STAGES.length, out.terminal));
    }
  }
  if (proof?.markdown !== undefined) {
    out.group("proof");
    out.raw(`${dimBlock(proof.markdown, outSink(out).dim)}\n`);
  }
  renderSlotWait(out, result.waitedMs);
  const hints = interactiveHintTexts(result.hints);
  if (hints.length > 0) out.group("next");
  for (const hint of hints) {
    out.info(hint);
  }
}

/** Render the package-styled note for a partially wired gate. */
export function renderGateStageGapNote(
  unfilled: number,
  total: number,
  terminal: TerminalContext,
): string {
  return `${terminal.tone("→", "accent")} ${
    terminal.role(
      `note: ${unfilled} of ${total} gate stages have no command yet.`,
      "muted",
    )
  }\n`;
}

/**
 * Print the gate plan without running it (`--dry-run`): the leading fail-fast
 * preconditions (the merge check, tracked-artifacts guard, then the instructions/skills
 * and complete tracked-refresh currency checks), the wired job groups, and the scope-gates selected for the
 * changed scopes. Honest — it lists "what would run"; it cannot predict which jobs
 * fail-fast would skip.
 */
async function dryRunGate(
  root: string,
  json: boolean,
  mode: "strict" | "report" = "strict",
): Promise<number> {
  const cfg = await loadConfig(root);
  const impact = await classifyScopeImpact(root, cfg);
  const plan = buildGatePlan(
    cfg,
    impact.scopes,
    dryRunStandardJobs(cfg),
    mode,
    impact.previewActions,
  );
  const engine = gatePlanToEngine(plan);
  engine.details.push(...(await inspectCheckpointNotes(root, cfg, mode)));
  if (json) {
    // A preview is a DiscernResult carrying `plan` + `dry_run` (no `steps`).
    emitResult(previewResult("done", engine));
    return 0;
  }
  const out = makeOut(colorEnabled());
  out.group("gate-plan");
  out.raw(`${
    renderGatePlan(engine, {
      terminal: out.terminal,
      width: out.terminal.size.columns,
    })
  }\n`);
  return 0;
}

/** Project the one resolved question shape onto public snake-case fields. */
function checkpointQuestionData(
  value: {
    question: string;
    questionFile?: string;
    teach?: string;
    reference?: string;
  },
): Pick<
  ServedCheckpointData,
  "question" | "question_file" | "teach" | "reference"
> {
  return {
    question: value.question,
    ...(value.questionFile === undefined
      ? {}
      : { question_file: value.questionFile }),
    ...(value.teach === undefined ? {} : { teach: value.teach }),
    ...(value.reference === undefined ? {} : { reference: value.reference }),
  };
}

/** Project one served checkpoint onto the wire shape. */
function servedCheckpointData(served: ServedCheckpoint): ServedCheckpointData {
  return {
    id: served.id,
    mode: served.mode,
    ...checkpointQuestionData(served),
    matched: [...served.matched],
    ...(served.related.length === 0
      ? {}
      : { related: relatedCheckpointData(served.related) }),
  };
}

/** Project the pre-flight onto the envelope's `data.checkpoints` block, or
 * `undefined` when no checkpoint governed and nothing failed open (so a
 * checkpoint-free project's result stays byte-identical to before). */
function gateCheckpointsData(
  preflight: CheckpointPreflight,
): GateCheckpointsData | undefined {
  const empty = preflight.outstanding.length === 0 &&
    preflight.declaredMet.length === 0 &&
    preflight.declaredUnmet.length === 0 &&
    preflight.advise.length === 0 &&
    preflight.drops.length === 0 &&
    preflight.mode === "strict";
  if (empty) {
    return undefined;
  }
  return {
    ...(preflight.policyCommit === undefined
      ? {}
      : { policy: preflight.policyCommit }),
    ...(preflight.outstanding.length === 0
      ? {}
      : { outstanding: preflight.outstanding.map(servedCheckpointData) }),
    ...(preflight.declaredMet.length === 0 ? {} : {
      declared_met: preflight.declaredMet.map((met) => ({
        id: met.id,
        ...checkpointQuestionData(met),
        declared_at: met.declaredAt,
        matched: [...met.matched],
        ...(met.related.length === 0
          ? {}
          : { related: relatedCheckpointData(met.related) }),
      })),
    }),
    ...(preflight.declaredUnmet.length === 0 ? {} : {
      declared_unmet: preflight.declaredUnmet.map((unmet) => ({
        id: unmet.id,
        ...checkpointQuestionData(unmet),
        why: unmet.why,
        declared_at: unmet.declaredAt,
        matched: [...unmet.matched],
        ...(unmet.related.length === 0
          ? {}
          : { related: relatedCheckpointData(unmet.related) }),
      })),
    }),
    ...(preflight.advise.length === 0
      ? {}
      : { advise: preflight.advise.map(servedCheckpointData) }),
    ...(preflight.mode === "strict" ? {} : {
      review: {
        enforcement: "reported" as const,
        status: preflight.unreviewed.length === 0
          ? "not_needed" as const
          : "unreviewed" as const,
        ...(preflight.unreviewed.length === 0 ? {} : {
          unreviewed: preflight.unreviewed.map(servedCheckpointData),
        }),
      },
    }),
    ...(preflight.drops.length === 0
      ? {}
      : { drops: preflight.drops.map((drop) => ({ ...drop })) }),
    ...(preflight.drops.length === 0
      ? {}
      : { advisories: checkpointDropAccounts(preflight.drops) }),
  };
}

/** The Proof's checkpoint block: the current conclusions plus the policy
 * identity, when checkpoints governed the run. */
function proofCheckpointsData(
  preflight: CheckpointPreflight,
): ProofCheckpointsData | undefined {
  if (
    preflight.mode === "strict" &&
    preflight.declaredMet.length === 0 &&
    preflight.declaredUnmet.length === 0 &&
    preflight.drops.length === 0
  ) {
    return undefined;
  }
  return {
    ...(preflight.policyCommit === undefined
      ? {}
      : { policy: preflight.policyCommit }),
    declared_met: preflight.declaredMet.map((met) => ({
      id: met.id,
      ...checkpointQuestionData(met),
      declared_at: met.declaredAt,
      matched: [...met.matched],
      ...(met.related.length === 0
        ? {}
        : { related: relatedCheckpointData(met.related) }),
    })),
    declared_unmet: preflight.declaredUnmet.map((unmet) => ({
      id: unmet.id,
      ...checkpointQuestionData(unmet),
      why: unmet.why,
      declared_at: unmet.declaredAt,
      matched: [...unmet.matched],
      ...(unmet.related.length === 0
        ? {}
        : { related: relatedCheckpointData(unmet.related) }),
    })),
    ...(preflight.mode === "strict" ? {} : {
      review: {
        enforcement: "reported" as const,
        status: preflight.unreviewed.length === 0
          ? "not_needed" as const
          : "unreviewed" as const,
        ...(preflight.unreviewed.length === 0
          ? {}
          : { unreviewed: preflight.unreviewed.map(servedCheckpointData) }),
      },
    }),
    ...(preflight.drops.length === 0
      ? {}
      : { drops: preflight.drops.map((drop) => ({ ...drop })) }),
  };
}

/** One checkpoint's serving text in the batched refusal: id, evidence,
 * question, and any teaching — indented so the batch scans as a list. */
function serveCheckpointText(served: ServedCheckpoint): string {
  // Matched paths are working-tree-controlled text and this message renders
  // verbatim on the --markdown surface, so each path travels inside the
  // code-span escaping boundary rather than as live Markdown.
  const evidence = checkpointServingText(served);
  const lines = [
    `${served.id} — changed: ${evidence.matched}`,
    ...evidence.related,
    `  Question: ${served.question.trim()}`,
    ...(evidence.questionSource === undefined ? [] : [evidence.questionSource]),
    ...evidence.notes,
  ];
  return lines.join("\n");
}

/**
 * The read-only-in-effect refusal `done` serves while a governing `stop`
 * checkpoint has no current conclusion: every such checkpoint is batched into
 * ONE refusal with its question, matched evidence, and both recoveries. The
 * claim on every surface: no gate job ran and the project tree is unchanged —
 * the open-question record and the logbook line are the only writes, and the text
 * states them. Fires BEFORE the rerun guard and before any job or fixer.
 */
function awaitingDeclarationRefusal(
  preflight: CheckpointPreflight,
  ciRecovery: boolean,
): DiscernResult<GateData> {
  const outstanding = preflight.outstanding;
  const ids = outstanding.map((served) => served.id);
  const heading = outstanding.length === 1
    ? "This change fired one checkpoint that requires your judgment"
    : `This change fired ${outstanding.length} checkpoints that require your judgment`;
  const message = `${heading} before any gate job runs:\n\n` +
    outstanding.map(serveCheckpointText).join("\n\n") +
    "\n\nJudge each question against the changed paths, then record your " +
    "conclusion: `discern done --met <id>` (repeatable) when the question " +
    'is satisfied, or `discern done --unmet <id> --why "<rationale>"` (one ' +
    "per invocation) when it is not — the gate still runs, and the " +
    "owner decides the declared-unmet landing. No gate job ran and the " +
    "project tree is unchanged; the open-question record and the logbook line are " +
    "the only writes.";
  const checkpoints = gateCheckpointsData(preflight);
  const data: GateData = {
    gate_ran: false,
    failed_stage: null,
    scopes_changed: [],
    ...(checkpoints === undefined ? {} : { checkpoints }),
  };
  return {
    ok: false,
    verb: "done",
    error: AWAITING_DECLARATION_SLUG,
    message,
    data,
    hints: hintTexts([
      fire(HINTS["checkpoint-declare"], { ids }),
      ...(ciRecovery ? [fire(HINTS["checkpoint-ci-recovery"])] : []),
    ]),
  };
}

/** How the checkpoint gate resolved for one `done` invocation. */
type CheckpointGateResolution =
  | { kind: "refuse"; result: DiscernResult<GateData> }
  | { kind: "proceed"; preflight: CheckpointPreflight };

/**
 * Run the checkpoint pre-flight for one `done` invocation and decide whether
 * the run may proceed: an invalid declaring invocation or a still-outstanding
 * `stop` checkpoint refuses (recording every valid declaration first);
 * otherwise the run proceeds into the gate in the same invocation, carrying
 * the pre-flight for the envelope, the Proof, and the marker bindings.
 */
async function resolveCheckpointGate(
  root: string,
  request: DeclarationRequest,
  mode: "strict" | "report" = "strict",
  ciRecovery = false,
  signal?: AbortSignal,
): Promise<CheckpointGateResolution> {
  const cfg = await loadConfig(root);
  if (mode === "report") {
    if (request.met.length > 0 || request.unmet !== undefined) {
      return {
        kind: "refuse",
        result: {
          ok: false,
          verb: "done",
          error: "invalid_arguments",
          message:
            "--ci cannot be combined with declarations; CI reports checkpoint review and records no declaration.",
        },
      };
    }
    return {
      kind: "proceed",
      preflight: await runCheckpointReport(root, cfg, signal),
    };
  }
  const outcome = await runCheckpointPreflight(
    root,
    cfg,
    request,
    undefined,
    signal,
  );
  if (outcome.kind === "invalid") {
    return {
      kind: "refuse",
      result: {
        ok: false,
        verb: "done",
        error: "invalid_value",
        message: `Nothing was recorded and nothing ran: ${outcome.message}`,
      },
    };
  }
  if (outcome.preflight.outstanding.length > 0) {
    return {
      kind: "refuse",
      result: awaitingDeclarationRefusal(outcome.preflight, ciRecovery),
    };
  }
  return { kind: "proceed", preflight: outcome.preflight };
}

/**
 * The read-only refusal `done` serves when it is asked to re-run an exact tree
 * last judged red without a deliberate rerun option, or when a last-green
 * marker has no complete current Proof to reuse. A red retry deserves an
 * explicit, recorded flake probe; a green marker without canonical evidence
 * must not be upgraded into success. Fires before the Gate machinery. Fail-open
 * on marker uncertainty; `--dry-run` never reaches this boundary.
 */
async function unchangedTreeRerunRefusal(
  root: string,
  rerunRequested: boolean,
  /** The current declaration-evidence identity, when known. A conclusion or
   * rationale recorded since the last run makes this a DIFFERENT run — the
   * guard must not refuse it — and an unknown identity fails open. */
  evidenceNow?: string,
): Promise<DiscernResult<GateData> | undefined> {
  if (rerunRequested) {
    return undefined;
  }
  const last = await inspectLastGateRun(root);
  if (last === undefined || last.mode === "report") {
    return undefined;
  }
  const now = await currentTreeIdentity(root);
  if (now === undefined || !sameTreeIdentity(now, last)) {
    return undefined;
  }
  if (
    last.evidence !== undefined &&
    (evidenceNow === undefined || evidenceNow !== last.evidence)
  ) {
    return undefined;
  }
  const verdict = last.passed ? "green" : "red";
  const hint = last.passed
    ? HINTS["done-unchanged-tree-green"]
    : HINTS["done-unchanged-tree-red"];
  return {
    ok: false,
    verb: "done",
    error: UNCHANGED_TREE_RERUN_SLUG,
    message: `\`discern done\` already judged this exact tree ${verdict} at ` +
      `${now.head.slice(0, 8)}, and nothing has changed since. Pass ` +
      `\`--rerun\` to run the Gate on it anyway; the rerun is ` +
      `recorded. Nothing has run — the tree is untouched.`,
    hints: hintTexts([fire(hint)]),
  };
}

/** Read the exact live proposal set. Undefined makes cache reuse fail closed;
 * the full Gate remains the authoritative fallback. */
async function activeStandardLimitProposalSet(
  root: string,
): Promise<StandardLimitProposalData[] | undefined> {
  try {
    const cfg = await loadConfig(root);
    const plan = buildStandardPlan(cfg);
    const inspected = await inspectActiveStandardLimitProposals(
      root,
      integrationBranch(cfg.repository.trunk),
      plan.standards,
    );
    return [...inspected.active.values()].sort((left, right) =>
      left.standard.localeCompare(right.standard)
    );
  } catch {
    // discern-best-effort: gate-active-standard-proposals-fallback
    return undefined;
  }
}

/** The unchanged-tree guard also binds to current proposal authority. A reason
 * edit, revocation, trunk move, or changed fresh measurement therefore makes
 * the same Git tree a new Gate judgment instead of demanding `--rerun`. */
async function gateRunEvidenceIdentity(
  root: string,
  checkpointEvidence?: string,
): Promise<string | undefined> {
  const proposals = await activeStandardLimitProposalSet(root);
  if (proposals === undefined) {
    return checkpointEvidence;
  }
  return JSON.stringify({
    version: 1,
    checkpoints: checkpointEvidence ?? null,
    standard_proposals: proposals.map(standardLimitProposalIdentity),
  });
}

/**
 * Reuse the canonical Proof only when it completely proves this exact clean
 * HEAD. This check runs before checkpoint reconciliation, so the optimization
 * cannot mutate conclusions, run fixers, measure Standards, or invoke a
 * configured job. An incomplete legacy marker is a cache miss, never success.
 */
async function reusableGreenProof(
  root: string,
): Promise<DiscernResult<GateData> | undefined> {
  const proof = await inspectGateProof(root);
  if (
    proof.status !== "honored" || proof.proof_data === undefined ||
    proof.proof_line === undefined ||
    proof.checkpoint_drops?.some((drop) =>
        drop.reason === "declaration_evidence_unavailable"
      ) === true
  ) {
    return undefined;
  }
  const activeProposals = await activeStandardLimitProposalSet(root);
  if (
    activeProposals === undefined ||
    !sameStandardLimitProposalSet(
      proof.proof_data.standard_proposals ?? [],
      activeProposals,
    )
  ) {
    return undefined;
  }
  return {
    ok: true,
    verb: "done",
    message: "Current green Proof covers this exact tree; no Gate job ran.",
    data: {
      gate_ran: false,
      failed_stage: null,
      scopes_changed: [],
      proof: proof.proof_data,
    },
  };
}

/** A declaration changes checkpoint evidence and therefore always runs fresh. */
function hasDeclarations(request: DeclarationRequest): boolean {
  return request.met.length > 0 || request.unmet !== undefined;
}

/** The output contract an in-process full-gate caller must choose explicitly. */
export type FinishResultSurface =
  | { kind: "quiet" }
  | { kind: "human"; plain: boolean };

/** Options for an in-process full-gate run. The required surface prevents a new
 * composite command from inheriting machine silence while a person waits. */
export interface FinishResultOptions {
  surface: FinishResultSurface;
  /** Fully attached live command tree, owned and injected by the entry point. */
  cliModel: CliModelProvider;
  dryRun?: boolean;
  /** Deliberately execute the Gate even when exact current Proof is reusable. */
  rerun?: boolean;
  /** Deprecated compatibility alias for `rerun`. */
  confirmed?: boolean;
  /** Explicit CI report lane; never inferred from the environment. */
  ci?: boolean;
  /** Checkpoint ids this invocation declares met (`--met`, repeatable). */
  met?: string[];
  /** The one checkpoint this invocation declares unmet, with its required
   * rationale (`--unmet <id> --why "<rationale>"`). */
  unmet?: { id: string; why: string };
  signal?: AbortSignal;
  /** Injectable state-capture effects for in-process fault tests. */
  validationCaptureOptions?: ValidationCaptureOptions;
}

/**
 * Compute the `done` {@link DiscernResult} without exiting. Machine callers choose
 * `quiet`, keeping protocol stdout uncontaminated. Human composites choose `human`,
 * which preserves the same live/static/streaming job projection as standalone
 * `discern done` while leaving the composite command in charge of its own final
 * success or failure tail. Requiring that choice removes the former implicit
 * machine-quiet default from every present and future caller.
 *
 * `dryRun` returns the preview (the plan, nothing run). `rerun` deliberately
 * executes the Gate on an exact already-judged state; `confirmed` remains a
 * compatibility alias. Aborting `signal` tree-kills the in-flight gate jobs and
 * returns the run as failed-with-cancellations.
 */
export async function finishResult(
  root: string,
  opts: FinishResultOptions,
): Promise<DiscernResult<GateData>> {
  const mode = opts.ci === true ? "report" as const : "strict" as const;
  if (
    mode === "report" &&
    ((opts.met?.length ?? 0) > 0 || opts.unmet !== undefined)
  ) {
    return {
      ok: false,
      verb: "done",
      error: "invalid_arguments",
      message:
        "--ci cannot be combined with declarations; CI reports checkpoint review and records no declaration.",
    };
  }
  if (opts.dryRun ?? false) {
    const cfg = await loadConfig(root);
    const impact = await classifyScopeImpact(root, cfg);
    const engine = gatePlanToEngine(
      buildGatePlan(
        cfg,
        impact.scopes,
        dryRunStandardJobs(cfg),
        mode,
        impact.previewActions,
      ),
    );
    engine.details.push(...(await inspectCheckpointNotes(root, cfg, mode)));
    return previewResult("done", engine);
  }
  const declarations: DeclarationRequest = {
    met: opts.met ?? [],
    ...(opts.unmet !== undefined ? { unmet: opts.unmet } : {}),
  };
  const rerunRequested = opts.rerun === true || opts.confirmed === true;
  if (
    mode === "strict" && !rerunRequested && !hasDeclarations(declarations)
  ) {
    const reused = await reusableGreenProof(root);
    if (reused !== undefined) return reused;
  }
  const terminal = terminalContext();
  const checkpointGate = await resolveCheckpointGate(
    root,
    declarations,
    mode,
    terminal.ciRequestsStaticOutput,
    opts.signal,
  );
  if (checkpointGate.kind === "refuse") {
    return checkpointGate.result;
  }
  const refusal = mode === "report"
    ? undefined
    : await unchangedTreeRerunRefusal(
      root,
      rerunRequested,
      await gateRunEvidenceIdentity(
        root,
        checkpointGate.preflight.evidence,
      ),
    );
  if (refusal !== undefined) {
    return refusal;
  }
  if (opts.surface.kind === "quiet") {
    return (await runGate(root, { kind: "quiet-result" }, opts.signal, {
      cliModel: opts.cliModel,
      checkpoints: checkpointGate.preflight,
      ...(opts.validationCaptureOptions !== undefined
        ? { validationCaptureOptions: opts.validationCaptureOptions }
        : {}),
    })).result;
  }
  const gate = await runGate(
    root,
    {
      kind: "human",
      plain: opts.surface.plain,
      terminal,
    },
    opts.signal,
    {
      cliModel: opts.cliModel,
      checkpoints: checkpointGate.preflight,
      ...(opts.validationCaptureOptions !== undefined
        ? { validationCaptureOptions: opts.validationCaptureOptions }
        : {}),
    },
  );
  const ttyWidth = gateOutputTtyWidth(gate.policy);
  if (
    gate.presentationWritable && ttyWidth !== undefined &&
    gate.policy.output.kind === "static-grouped"
  ) {
    gate.out.group("gate-results");
    gate.out.raw(
      `${
        renderGateTtyTable(gate.result.steps ?? [], {
          width: ttyWidth,
          terminal: gate.out.terminal,
        }, gate.result.data?.standards ?? [])
      }\n`,
    );
  }
  return gate.result;
}

/** The standards jobs a `--dry-run` plan lists: the pure, config-only
 * resolution (measure or defer). A replay is a run-time decision over the tree
 * and the recorded baseline, which an honest plan cannot predict — a measured
 * standard listed here may still replay when the real run finds its inputs
 * untouched. */
function dryRunStandardJobs(
  cfg: DiscernConfig,
): ReturnType<typeof planStandardJobsFromConfig> {
  return planStandardJobsFromConfig(buildStandardPlan(cfg).standards);
}

/** Run `done`. Returns a process exit code. */
export async function runFinish(
  root: string,
  opts: {
    json: boolean;
    /** Fully attached live command tree, owned and injected by the entry point. */
    cliModel: CliModelProvider;
    dryRun?: boolean;
    rerun?: boolean;
    confirmed?: boolean;
    ci?: boolean;
    plain?: boolean;
    met?: string[];
    unmet?: { id: string; why: string };
  },
): Promise<number> {
  const mode = opts.ci === true ? "report" as const : "strict" as const;
  if (opts.dryRun ?? false) {
    return await dryRunGate(root, opts.json, mode);
  }
  const declarations: DeclarationRequest = {
    met: opts.met ?? [],
    ...(opts.unmet !== undefined ? { unmet: opts.unmet } : {}),
  };
  const rerunRequested = opts.rerun === true || opts.confirmed === true;
  if (
    mode === "strict" && !rerunRequested && !hasDeclarations(declarations)
  ) {
    const reused = await reusableGreenProof(root);
    if (reused !== undefined) {
      observeResult(reused);
      if (opts.json) {
        emitResult(reused);
      } else {
        makeOut(colorEnabled()).ok(
          reused.message ?? "Current green Proof reused; no Gate job ran.",
        );
      }
      return 0;
    }
  }
  const terminal = terminalContext();
  const checkpointGate = await resolveCheckpointGate(
    root,
    declarations,
    mode,
    terminal.ciRequestsStaticOutput,
  );
  const refusal = checkpointGate.kind === "refuse"
    ? checkpointGate.result
    : mode === "report"
    ? undefined
    : await unchangedTreeRerunRefusal(
      root,
      rerunRequested,
      await gateRunEvidenceIdentity(
        root,
        checkpointGate.preflight.evidence,
      ),
    );
  if (refusal !== undefined) {
    observeResult(refusal); // the logbook records the refusal with its slug
    if (opts.json) {
      emitResult(refusal);
      return 1;
    }
    const out = makeOut(colorEnabled());
    // Refusal messages are product-composed and may carry deliberate
    // paragraphs (the batched checkpoint serving); their newlines are real
    // structure on the terminal, never visible symbols.
    out.errorBlock(refusal.message ?? "The gate refused to run.");
    const hints = interactiveHintTexts(refusal.hints);
    if (hints.length > 0) out.group("next");
    for (const hint of hints) {
      out.warn(hint);
    }
    return 1;
  }
  const preflight = checkpointGate.kind === "proceed"
    ? checkpointGate.preflight
    : undefined;
  const gateRun = (): ReturnType<typeof runGate> =>
    runGate(
      root,
      opts.json
        ? { kind: "quiet-result", terminal }
        : { kind: "human", plain: opts.plain ?? false, terminal },
      undefined,
      {
        cliModel: opts.cliModel,
        ...(preflight === undefined ? {} : { checkpoints: preflight }),
      },
    );
  const gate = await gateRun();
  const {
    result,
    failedStage,
    cfg,
    policy,
    out,
    gotchasTail,
    outputWithheld,
    presentationWritable,
  } = gate;
  observeResult(result); // the logbook recorder lifts step timings from it
  if (opts.json) {
    emitResult(result);
    return failedStage === null ? 0 : 1;
  }
  if (!presentationWritable) return failedStage === null ? 0 : 1;
  const ttyWidth = gateOutputTtyWidth(policy);
  const staticTableRendered = ttyWidth !== undefined &&
    policy.output.kind === "static-grouped";
  if (staticTableRendered && ttyWidth !== undefined) {
    out.group("gate-results");
    out.raw(
      `${
        renderGateTtyTable(result.steps ?? [], {
          width: ttyWidth,
          terminal: out.terminal,
        }, result.data?.standards ?? [])
      }\n`,
    );
  }
  if (failedStage !== null) {
    const headline = interactiveHintTexts(result.hints)[0] ??
      "The gate failed.";
    renderFailureTail(out, {
      verb: "done",
      headline,
      diagnostics: result.diagnostics ?? [],
      failedStage,
      gotchas: gotchasTail,
      // A failed deferred flush lets the diagnostic retain the captured output.
      outputWithheld,
    });
    renderSlotWait(out, result.waitedMs);
    return 1;
  }
  printSuccessTail(
    cfg,
    out,
    result,
    ttyWidth,
    staticTableRendered || gateOutputIsLive(policy),
  );
  return 0;
}
