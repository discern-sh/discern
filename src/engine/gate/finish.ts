import { retainResultDiagnostics } from "./diagnostic_output.ts";
import {
  emergencyValidationStatus,
  resolveEmergencyValidation,
} from "../emergency/obligations.ts";
import { describeDirtyPaths } from "./proof.ts";
import { GATE_FAILED_STAGE_LABEL } from "./presentation.ts";
import type { ProducerBoundary } from "../validation/execute.ts";
import { createGeneratedBuildBoundary } from "./generated_drift.ts";
import { resolveGeneratedGroups } from "../../shared/generated_artifacts.ts";
import { captureCandidateReview } from "./candidate_review.ts";
import type { CompletionArtifact } from "../completion/artifacts.ts";
import type { CompletionSession } from "../completion/source_tip.ts";
import { configuredValidation } from "../validation/configuration.ts";
import { standaloneValidation } from "../validation/diagnostics.ts";
import {
  executePublicValidation,
  producerLabel,
  type PublicValidationRun,
} from "../validation/public_run.ts";
import { completionTreeRefusal, runCompleteGate } from "./complete_gate.ts";
import { reusableGreenProof } from "./review_release.ts";
import { retainProofPresentation } from "./proof_presentation.ts";
import { readCompleteProof } from "./completion_proof.ts";
import type { CompletionProofPointer } from "../../shared/completion_proof.ts";
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
  gateLiveAdmissionGroups,
  gatePlanToEngine,
  type JobGroup,
} from "./plan.ts";
import {
  gateOutputIsLive,
  type GateOutputSurface,
  gateOutputTtyWidth,
  gateRunContext,
  type GateRunPolicy,
  resolveGateRunPolicy,
} from "./execute.ts";
import {
  type AdminStateWriteAuthority,
  currentTreeIdentity,
  inspectLastGateRun,
  pinValidatedTree,
  preflightAdminStateWrites,
  recordGateOutcome,
  recordLastGateRun,
  sameTreeIdentity,
  UNCHANGED_TREE_RERUN_SLUG,
} from "./proof.ts";
import { sweepDueTempArtifacts } from "./temp_artifact_sweep.ts";
import { duplicateAdrNumbers } from "../../lib/adr_numbers.ts";
import { checkDocsIntegrity } from "../../lib/map_integrity.ts";
import type { CliModelProvider } from "../../shared/cli_reference_codegen.ts";
import { adrIndexState } from "../../lib/adr_index.ts";
import { buildGateProof } from "./proof_render.ts";
import { renderSlotWait } from "./slot_wait_render.ts";
import { renderDoneTtyProofPanel, renderDoneTtySummary } from "./done_tty.ts";
import { createGateTtyProgress, renderGateTtyTable } from "./gate_tty.ts";
import { cmdsInStage } from "./stages.ts";
import { buildStandardPlan, standardJobLabel } from "./standard_plan.ts";
import { fmtRate } from "../validation/metrics.ts";
import { verifyTrunkLimits } from "./standard_limits.ts";
import {
  inspectActiveStandardLimitProposals,
  staleProposalDiagnostic,
  standardLimitProposalIdentity,
} from "./standard_proposal_state.ts";
import { planStandardJobsFromConfig } from "./standards_gate.ts";
import type {
  GateStandard,
  PreviewActionData,
  StandardLimitProposalData,
  StandardsLimitsData,
} from "../../shared/result_schemas.ts";
import { createTreeDriftBoundary, treeDriftDiagnostic } from "./tree_drift.ts";
import { renderFailureTail } from "./failure_tail.ts";
import { renderGatePlan } from "./presentation.ts";
import { gateFailureGotchasTail, type GotchasFailureTail } from "./gotchas.ts";
import {
  adrIndexDiagnostic,
  adrNumbersDiagnostic,
  instructionDiagnostic,
  mapIntegrityDiagnostic,
  skillFrontmatterDiagnostic,
  skillsDiagnostic,
  trackedArtifactsDiagnostic,
  trackedRefreshDiagnostic,
} from "./preflight_diagnostics.ts";
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
import {
  gateCheckpointsData,
  proofCheckpointsData,
} from "./checkpoint_projection.ts";
import { couplingGateHints } from "../coupling/coupling.ts";
import { colorEnabled, makeOut, type Out, outSink } from "../output.ts";
import { observedGateOperation } from "./observed_operation.ts";
import {
  type GateProgressPresenterSlot,
  registerGateProgressPresenter,
} from "./progress_presenter.ts";
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
  mergeHintTexts,
} from "../../shared/hints.ts";
import { observeResult } from "../../shared/result_capture.ts";
import {
  type CheckpointGateResolution,
  type DonePreambleOperations,
  resolveDonePreamble,
} from "./done_preamble.ts";
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
import { checkInstructionCurrent } from "../instruction_render.ts";
import { checkSkillsCurrent, checkSkillsWellformed } from "../../lib/skills.ts";
import { trackedDiscernIgnoredArtifacts } from "../../lib/agent_gitignore.ts";
import {
  writePreflightDiagnostic,
  type WritePreflightFailure,
  writePreflightFailureMessage,
} from "../../shared/write_preflight.ts";
import { planTrackedRefresh } from "../tracked_refresh.ts";

/** Candidate coordination wraps the gate's existing plan, judgment and validation seams. */
async function runGate(
  root: string,
  surface: GateOutputSurface,
  signal: AbortSignal | undefined,
  presentation: Parameters<typeof runCandidateGate>[3],
): ReturnType<typeof runCandidateGate> {
  // The whole gate run is one journalled operation: a lost observer reconnects
  // to its facts and retained result instead of re-running anything. The live
  // presenter registers into the slot once the run's output policy exists.
  return await observedGateOperation(
    root,
    "done",
    signal,
    (presenterSlot) =>
      runGateBody(root, surface, signal, presentation, presenterSlot),
    (completed) => completed.result,
  );
}

/** The gate execution behind the journalled, observed operation boundary. */
async function runGateBody(
  root: string,
  surface: GateOutputSurface,
  signal: AbortSignal | undefined,
  presentation: Parameters<typeof runCandidateGate>[3],
  presenterSlot: GateProgressPresenterSlot,
): ReturnType<typeof runCandidateGate> {
  presentation = { ...presentation, presenterSlot };
  const completed = await runCompleteGate<
    Awaited<ReturnType<typeof runCandidateGate>>
  >(
    root,
    {
      mode: presentation.checkpointRequest?.mode ??
        presentation.checkpoints?.mode ?? "strict",
      rerun: presentation.rerun ?? false,
      ...(presentation.standalone === undefined
        ? {}
        : { standalone: presentation.standalone }),
      ...(signal === undefined ? {} : { signal }),
    },
    async (session) => {
      if (session === undefined) {
        const gate = await runCandidateGate(
          root,
          surface,
          signal,
          presentation,
        );
        return { value: gate, passed: gate.result.ok };
      }
      let checkpoints = presentation.checkpoints;
      const request = presentation.checkpointRequest;
      if (request !== undefined) {
        const preamble = await resolveDonePreamble(root, request, {
          ...donePreambleOperations(
            session.execution.candidate.predecessor,
          ),
          reusableGreenProof: () => Promise.resolve(undefined),
        });
        if (preamble.kind !== "proceed") {
          return {
            value: await unrunGateResult(root, surface, preamble.result),
            passed: false,
            blockers: [{
              kind: "missing-judgment" as const,
              subjects: [preamble.result.error ?? "candidate-checkpoints"],
            }],
          };
        }
        checkpoints = preamble.preflight;
      }
      const gate = await runCandidateGate(root, surface, signal, {
        ...presentation,
        ...(checkpoints === undefined ? {} : { checkpoints }),
        completion: session,
      });
      return {
        value: gate,
        passed: gate.result.ok,
        ...(gate.review === undefined ? {} : { review: gate.review }),
        ...(gate.validationRun === undefined
          ? {}
          : { validation: gate.validationRun }),
      };
    },
    (result) => unrunGateResult(root, surface, result),
  );
  const emergencyValidation = await emergencyValidationStatus(root);
  if (emergencyValidation.length && completed.result.data !== undefined) {
    completed.result.data.emergency_validation = emergencyValidation;
  }
  await retainResultDiagnostics(root, completed.result);
  return completed;
}

/** A precondition refusal carries a normal gate result without starting any producer. */
async function unrunGateResult(
  root: string,
  surface: GateOutputSurface,
  result: DiscernResult<GateData>,
): ReturnType<typeof runCandidateGate> {
  const cfg = await loadConfig(root);
  return {
    result,
    failedStage: "check/test",
    cfg,
    policy: resolveGateRunPolicy(cfg.gate.stream, surface),
    out: makeOut(false, { quiet: surface.kind === "quiet-result" }),
    changed: [],
    gotchasTail: undefined,
    outputWithheld: false,
    presentationWritable: true,
    finalize: () => Promise.resolve(false),
  };
}

/** Run the complete gate against the selected immutable candidate and policy base. */
async function runCandidateGate(
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
    checkpointRequest?: {
      mode: "strict" | "report";
      declarations: DeclarationRequest;
      rerunRequested: boolean;
      ciRecovery: boolean;
    };
    completion?: CompletionSession;
    policyBase?: string;
    standalone?: boolean;
    rerun?: boolean;
    /** Where this run registers its live completion-fact presenter. */
    presenterSlot?: GateProgressPresenterSlot;
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
    validationRun?: PublicValidationRun;
    review?: CompletionArtifact;
    finalize: (pointer: CompletionProofPointer) => Promise<boolean>;
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
  if (presentation.presenterSlot !== undefined) {
    registerGateProgressPresenter(
      presentation.presenterSlot,
      policy.output.kind,
      progress,
      runOpts.write,
    );
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
  const merged = await assertMainMerged(
    root,
    presentation.policyBase ?? mainBranch,
  );
  if (merged.kind === "behind") {
    failedStage = "merge";
  } else if (merged.kind === "missing") {
    mergeWarning = fire(HINTS["missing-trunk-branch"], {
      branch: merged.branch,
    });
    runOut.warn(mergeWarning.text);
  }

  // 1a. The standard protection (Tier 1) — every existing [standards]
  //     definition and limit against the trunk's committed copy, deletions
  //     included.
  //     Placed HERE, directly after the merge check: it is the cheapest
  //     precondition after it (one git read, milliseconds), it guards the very
  //     config every later job table was built from, and the merge check must
  //     precede it so the baseline is the freshest merged-in trunk copy. Not
  //     configurable — an escape hatch here would defeat the guarantee the
  //     product leads with. An unreadable local trunk and an invalid trunk
  //     config both fail closed; a remote-tracking ref never substitutes for
  //     the configured local ref.
  const policyBase = presentation.policyBase ??
    presentation.completion?.execution.candidate.predecessor ??
    mainBranch;
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
      { predecessor: policyBase },
    );
    const verification = await verifyTrunkLimits(
      root,
      policyBase,
      stdPlan.standards,
      proposalInspection.active,
      cfg,
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
      verification.summary.status === "parse_failed" ||
      verification.summary.status === "unverified"
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

  const impact = await classifyScopeImpact(root, cfg, policyBase);
  const changed = impact.scopes;
  const plan = buildGatePlan(
    cfg,
    changed,
    dryRunStandardJobs(cfg),
    presentation.checkpoints?.mode ?? "strict",
    impact.previewActions,
  );
  progress?.replaceGroups(plan.groups);
  let validation: ValidationStart | undefined;
  if (cfg.project.logbook) {
    validation = await validationBoundaryNotReached(
      root,
      cfg,
      VALIDATION_RUNS.done,
      plan.groups,
      presentation.validationCaptureOptions ?? {},
    );
  }
  let validationRun: PublicValidationRun | undefined;
  let treeDriftDiag: Diagnostic | undefined;
  let scopeDriftDiag: Diagnostic | undefined;
  let generatedDiagnostics: Diagnostic[] = [];
  let generatedFailureRemedies: FiredHint[] | undefined;
  if (failedStage === null) {
    const configured = await configuredValidation(cfg, changed);
    const generatedBoundary = createGeneratedBuildBoundary(
      root,
      resolveGeneratedGroups(cfg),
      configured.stages,
    );
    const treeBoundary = await createTreeDriftBoundary(
      root,
      configured.stages,
      treePin.clean,
    );
    let validationCapture: Promise<ValidationStart> | undefined;
    const producerBoundary: ProducerBoundary = {
      after: async (producer, capture): Promise<void> => {
        await treeBoundary.observer.after(producer, capture);
        await generatedBoundary.observer.after(producer, capture);
      },
      before: async (
        ...args: Parameters<ProducerBoundary["before"]>
      ): Promise<void> => {
        await generatedBoundary.observer.before(...args);
        await treeBoundary.observer.before(...args);
        const stage = configured.stages.get(args[0].selector);
        if (cfg.project.logbook && (stage === "check" || stage === "test")) {
          validationCapture ??= captureValidationStart(
            root,
            cfg,
            VALIDATION_RUNS.done,
            plan.groups,
            presentation.validationCaptureOptions ?? {},
          );
          validation = await validationCapture;
        }
      },
    };
    const announcedGroups = new Set<string>();
    const onProgress = (
      { producer, state }: { producer: string; state: "running" | "finished" },
    ): void => {
      if (state !== "running") return;
      const group = plan.groups.find((item) =>
        item.jobs.some((job) => job.label === producerLabel(producer))
      );
      if (group !== undefined && !announcedGroups.has(group.stage)) {
        announcedGroups.add(group.stage);
        runOut.heading(group.heading);
      }
    };
    validationRun = presentation.completion === undefined
      ? await standaloneValidation({
        root,
        config: cfg,
        scopes: changed,
        kind: "standalone",
        base: policyBase,
        mode: presentation.checkpoints?.mode ?? "strict",
        ...(signal === undefined ? {} : { signal }),
        onProgress,
        producerBoundary,
        capacity: { slots, out: runOut, runner: runOpts },
      })
      : await executePublicValidation({
        root,
        config: cfg,
        scopes: changed,
        claimed: presentation.completion.execution,
        demand: {
          kind: "done",
          requirements: configured.obligations.map((entry) =>
            entry.requirement
          ),
          mode: presentation.completion.mode,
        },
        bindAttempt: true,
        ...(presentation.completion.rerun_of === undefined
          ? {}
          : { rerun_of: presentation.completion.rerun_of }),
        onProgress,
        producerBoundary,
        capacity: { slots, out: runOut, runner: runOpts },
      });
    generatedDiagnostics = generatedBoundary.diagnostics;
    generatedFailureRemedies = generatedBoundary.hints;
    for (const [label, result] of validationRun.results) {
      results.set(label, result);
    }
    if (validationRun.outcome.blockers.length > 0) {
      failedStage = plan.groups.find((group) =>
        group.jobs.some((job) => {
          const result = results.get(job.label);
          return result !== undefined && result.code !== 0 &&
            result.cancelled !== true;
        })
      )?.stage ?? "check/test";
    }
    const strands = treeBoundary.strands();
    if (generatedDiagnostics.length > 0) {
      failedStage = "generated_drift";
    } else if (strands.length > 0) {
      failedStage = "tree_drift";
      treeDriftDiag = await treeDriftDiagnostic(root, strands);
    } else if (treeBoundary.unavailable() && failedStage === null) {
      failedStage = "tree_drift";
      treeDriftDiag = {
        tool: "tree-drift",
        severity: "error",
        message:
          "Tracked checkout observation is unavailable; no reusable Proof can be issued.",
        reproduce_cmd: "git status --short",
      };
    }
  }

  if (failedStage === null && presentation.completion === undefined) {
    const currentScopes =
      (await classifyScopeImpact(root, cfg, policyBase)).scopes;
    const missingScopes = currentScopes.filter((scope) =>
      !changed.includes(scope)
    );
    if (missingScopes.length > 0) {
      failedStage = "scope_gates";
      scopeDriftDiag = {
        tool: "scope-selection",
        severity: "error",
        message: `Project commands changed the scope selection: ${
          missingScopes.join(", ")
        }. These scopes were absent from this run's validation demand. Run discern prepare, review the changed files, then run discern done on the prepared committed source or use --standalone for fresh diagnostics.`,
        reproduce_cmd: "discern prepare",
      };
    }
  }

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
  const standardsData: GateStandard[] = [
    ...(validationRun?.standards ??
      stdPlan.standards.map((standard): GateStandard => ({
        name: standard.name,
        direction: standard.direction,
        limit: standard.limit,
        margin: standard.margin,
        measurement: "skipped",
      }))),
  ];
  if (result.data !== undefined) {
    if (standardsData.length > 0) {
      result.data.standards = standardsData;
    }
    if (standardsLimits !== undefined) {
      result.data.standards_limits = standardsLimits;
    }
  }
  for (const o of standardsData) {
    if (o.value === undefined) {
      continue;
    }
    const step = (result.steps ?? []).find(
      (s) => s.step.label === standardJobLabel(o.name),
    );
    if (step !== undefined && step.step.note !== undefined) {
      step.step.note = o.measurement === "replayed"
        ? `${step.step.note}, measured ${
          fmtRate(o.value)
        }; replayed from ${o.replayed_from} (inputs unchanged)`
        : `${step.step.note}, measured ${fmtRate(o.value)}`;
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
  if (scopeDriftDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), scopeDriftDiag];
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
  // Landing evidence is published only after the complete Proof is assembled.
  const gateProof: NonNullable<GateData["gate_proof"]> = {
    status: presentation.completion === undefined
      ? treePin.clean ? "diagnostic" : "skipped_dirty"
      : "pending",
    // Two facts a standalone run can carry, in the order they are true:
    // standalone feedback never issues Proof, and a full run would also need
    // the tree clean. The dirt is stated beside the rule, never as its cause.
    reason: presentation.completion === undefined
      ? treePin.clean
        ? "Standalone feedback does not issue Proof. A full discern done run on this clean committed tree does."
        : `Standalone feedback does not issue Proof. A full discern done run does, and it needs a clean committed tree; this tree was not clean when the run began${
          describeDirtyPaths(treePin.dirtyPaths)
        }.`
      : "Complete Proof is pending.",
  };
  if (result.data !== undefined) {
    result.data.gate_proof = gateProof;
    result.data.producer_executions = { ...validationRun?.producer_executions };
    if ((validationRun?.producer_evidence.length ?? 0) > 0) {
      result.data.producer_evidence = [
        ...validationRun?.producer_evidence ?? [],
      ];
    }
    result.data.completion = {
      kind: presentation.completion === undefined ? "diagnostic" : "pending",
      pending_reasons: presentation.completion === undefined
        ? []
        : ["Complete Proof is pending."],
    };
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
  // Checkpoint deliveries ride the envelope's one advisory channel: evidence-drop
  // accounts as notices, each fired advise-mode question served in full, and
  // — on a green run with a declared-unmet conclusion standing — the landing
  // consequence, so a green Proof is never mistaken for a landable one.
  const checkpointAdvisoryHints = checkpointDropAccounts(
    checkpointPreflight?.drops ?? [],
  ).map(
    (advisory) => fire(HINTS["checkpoint-advisory"], { advisory }),
  );
  const strandUnavailableHint =
    checkpointPreflight?.drops.some((drop) =>
        drop.reason === "strand_check_unavailable"
      )
      ? fire(HINTS["gate-strand-check-unavailable"], {})
      : undefined;
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
  // On failure, the stage remedy leads the envelope: the terminal renderer and
  // accept both read that first hint as their headline.
  const leadingFailureHints = failedStage !== null ? jobOutputHints : [];
  const trailingJobHints = failedStage === null ? jobOutputHints : [];
  const hints: FiredHint[] = [
    ...leadingFailureHints,
    ...(failedStage === null && gateProof.status === "skipped_dirty"
      ? [fire(HINTS["gate-proof-skipped-dirty"], { reason: gateProof.reason })]
      : []),
    ...(inProgress !== undefined ? [inProgress] : []),
    ...(mergeWarning !== undefined ? [mergeWarning] : []),
    ...(divergenceWarning !== undefined ? [divergenceWarning] : []),
    ...(limitsWarning !== undefined ? [limitsWarning] : []),
    ...(strandUnavailableHint === undefined ? [] : [strandUnavailableHint]),
    ...checkpointAdvisoryHints,
    // The fleet test-run cap's wait notices (the same lines the human run
    // narrated live), so a --json/MCP caller sees why the run took longer.
    ...(slots?.waits ?? []),
    ...reportHints,
    ...varianceHints,
    ...buildGateHints(
      plan.previewActions,
      failedStage,
      gotchasTail,
      false,
      undefined,
    ),
    ...adviseHints,
    ...trailingJobHints,
    ...couplingHints,
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
    ...(failedStage !== null || presentation.completion === undefined ? {} : {
      review: await captureCandidateReview(
        root,
        presentation.completion,
        checkpointPreflight === undefined
          ? undefined
          : proofCheckpointsData(checkpointPreflight),
        [...standardLimitProposals.values()],
      ),
    }),
    ...(validationRun === undefined ? {} : { validationRun }),
    finalize: async (pointer): Promise<boolean> => {
      const complete = await readCompleteProof(root, pointer);
      const proof = await buildGateProof(
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
        complete,
      );
      const recorded = writeAuthority === undefined
        ? {
          status: "unavailable" as const,
          reason: writeAccessFailure === undefined
            ? "Write authority was not established."
            : writePreflightFailureMessage(writeAccessFailure),
        }
        : await recordGateOutcome(
          root,
          writeAuthority,
          true,
          { ...treePin, head: complete.candidate.head },
          proof,
          checkpointPreflight?.evidence,
          checkpointPreflight?.mode ?? "strict",
          pointer,
        );
      if (recorded.status === "recorded" && proof !== undefined) {
        await retainProofPresentation(root, pointer, proof);
        if (proof.mode !== "report") {
          await resolveEmergencyValidation(root, pointer);
        }
      }
      if (result.data !== undefined) {
        const emergencyValidation = await emergencyValidationStatus(root);
        if (emergencyValidation.length) {
          result.data.emergency_validation = emergencyValidation;
        }
        result.data.gate_proof = recorded;
        if (proof !== undefined) result.data.proof = proof;
        const resolution = await inspectLandingAuthority(root, mainBranch);
        const authority = landingAuthorityProjection(resolution);
        if (authority !== undefined) result.data.landing_authority = authority;
        const proofHints = buildGateHints(
          plan.previewActions,
          null,
          undefined,
          proof !== undefined,
          resolution,
        );
        const recordingHint = gateProofHint(recorded, null);
        const logbookHints = proof === undefined || !cfg.meta.bootstrapped
          ? []
          : proofFindingHints(
            (await inlineFindingRoutes(root, cfg)).done,
            proof.branch,
          );
        const existingHintIds = new Set(
          firedHintsFromTexts(result.hints).map((hint) => hint.id),
        );
        result.hints = mergeHintTexts(
          result.hints ?? [],
          hintTexts([
            ...proofHints,
            ...(recordingHint === undefined ? [] : [recordingHint]),
            ...logbookHints,
          ].filter((hint) => !existingHintIds.has(hint.id))),
        );
      }
      if (writeAuthority !== undefined) {
        await recordLastGateRun(
          root,
          writeAuthority,
          true,
          await gateRunEvidenceIdentity(root, checkpointPreflight),
          checkpointPreflight?.mode ?? "strict",
        );
      }
      return recorded.status === "recorded" && proof !== undefined;
    },
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
      case "diagnostic":
      case "pending":
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
 * `gotchas_doc` is set). On success: update changed documentation and view a previewable change.
 */
function buildGateHints(
  previewActions: readonly PreviewActionData[],
  failedStage: FailedStage | null,
  gotchasTail: GotchasFailureTail | undefined,
  proofEmitted: boolean,
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
  for (const action of previewActions) {
    hints.push(fire(HINTS["gate-previewable-change"], action));
  }
  return hints;
}

const DONE_TTY_ROUTINE_HINT_IDS = new Set([
  HINTS["gate-update-docs"].id,
]);

/**
 * Keep exceptional human advisories above the compact proof, while leaving
 * its routine follow-ups in the envelope. The highlighted line already names
 * the full proof and every required obligation.
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
  expectedPredecessor?: string,
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
      preflight: await runCheckpointReport(
        root,
        cfg,
        signal,
        expectedPredecessor,
      ),
    };
  }
  const outcome = await runCheckpointPreflight(
    root,
    cfg,
    request,
    undefined,
    signal,
    expectedPredecessor,
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
      `\`--rerun\` to run the gate on it anyway; the rerun is ` +
      `recorded. Nothing has run — the tree is untouched.`,
    hints: hintTexts([fire(hint)]),
  };
}

interface ActiveStandardLimitProposalState {
  readonly trunk: string;
  readonly proposals: StandardLimitProposalData[];
}

/** Read the exact live proposal set and its resolved trunk. Undefined makes
 * cache reuse fail closed; the full Gate remains the authoritative fallback. */
async function activeStandardLimitProposalState(
  root: string,
): Promise<ActiveStandardLimitProposalState | undefined> {
  try {
    const cfg = await loadConfig(root);
    const plan = buildStandardPlan(cfg);
    const trunk = integrationBranch(cfg.repository.trunk);
    const inspected = await inspectActiveStandardLimitProposals(
      root,
      trunk,
      plan.standards,
    );
    return {
      trunk,
      proposals: [...inspected.active.values()].sort((left, right) =>
        left.standard.localeCompare(right.standard)
      ),
    };
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
  checkpoint?: Pick<CheckpointPreflight, "evidence" | "policyCommit">,
): Promise<string | undefined> {
  const state = await activeStandardLimitProposalState(root);
  if (state === undefined) {
    return checkpoint?.evidence;
  }
  return JSON.stringify({
    version: 1,
    checkpoints: checkpoint?.evidence ?? null,
    checkpoint_policy: checkpoint?.policyCommit ?? null,
    standard_proposals: state.proposals.map(standardLimitProposalIdentity),
  });
}

const DONE_PREAMBLE_OPERATIONS = {
  reusableGreenProof: (root) =>
    reusableGreenProof(root, activeStandardLimitProposalState),
  resolveCheckpointGate,
  unchangedTreeRerunRefusal,
  gateRunEvidenceIdentity,
} satisfies DonePreambleOperations;

/** Report comparisons name the fetched predecessor before checkpoint inspection. */
function donePreambleOperations(
  predecessor?: string,
): DonePreambleOperations {
  return {
    ...DONE_PREAMBLE_OPERATIONS,
    ...(predecessor === undefined ? {} : {
      resolveCheckpointGate: (root, declarations, mode, ci, signal) =>
        resolveCheckpointGate(
          root,
          declarations,
          mode,
          ci,
          signal,
          predecessor,
        ),
    } satisfies Partial<DonePreambleOperations>),
  };
}

/** The output contract an in-process full-gate caller must choose explicitly. */
export type FinishResultSurface =
  | { kind: "quiet" }
  | { kind: "human"; plain: boolean };

/** Options for an in-process full-gate run. The required surface prevents a new
 * composite command from inheriting machine silence while a person waits. */
export interface FinishResultOptions {
  policyBase?: string;
  standalone?: boolean;
  surface: FinishResultSurface;
  /** Fully attached live command tree, owned and injected by the entry point. */
  cliModel: CliModelProvider;
  dryRun?: boolean;
  /** Deliberately execute the Gate even when exact current Proof is reusable. */
  rerun?: boolean;
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
 * executes the Gate on an exact already-judged state. Aborting `signal`
 * tree-kills the in-flight gate jobs and
 * returns the run as failed-with-cancellations.
 */
export async function finishResult(
  root: string,
  opts: FinishResultOptions,
): Promise<DiscernResult<GateData>> {
  const treeRefusal = await completionTreeRefusal(root, opts.standalone);
  if (treeRefusal !== undefined) return treeRefusal;
  const mode = opts.ci === true ? "report" as const : "strict" as const;
  if (opts.policyBase !== undefined && (!opts.ci || !opts.standalone)) {
    const refusal: DiscernResult<GateData> = {
      ok: false,
      verb: "done",
      error: "invalid_arguments",
      message:
        "An explicit policy base is available only for standalone CI reports; strict completion always checks against the trunk's current tip.",
    };
    return refusal;
  }
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
  const rerunRequested = opts.rerun === true || opts.standalone === true;
  const terminal = terminalContext();
  const preamble = await resolveDonePreamble(
    root,
    {
      mode,
      declarations,
      rerunRequested,
      ciRecovery: terminal.ciRequestsStaticOutput,
      deferRerunGuard: !opts.standalone &&
        (await pinValidatedTree(root)).clean,
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    },
    donePreambleOperations(opts.policyBase),
  );
  if (preamble.kind !== "proceed") return preamble.result;
  if (opts.surface.kind === "quiet") {
    return (await runGate(root, { kind: "quiet-result" }, opts.signal, {
      cliModel: opts.cliModel,
      ...(opts.policyBase === undefined ? {} : { policyBase: opts.policyBase }),
      ...(opts.standalone === undefined ? {} : { standalone: opts.standalone }),
      ...(opts.rerun === undefined ? {} : { rerun: opts.rerun }),
      ...(preamble.preflight === undefined
        ? {}
        : { checkpoints: preamble.preflight }),
      checkpointRequest: {
        mode,
        declarations,
        rerunRequested,
        ciRecovery: terminal.ciRequestsStaticOutput,
      },
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
      ...(opts.policyBase === undefined ? {} : { policyBase: opts.policyBase }),
      ...(opts.standalone === undefined ? {} : { standalone: opts.standalone }),
      ...(opts.rerun === undefined ? {} : { rerun: opts.rerun }),
      ...(preamble.preflight === undefined
        ? {}
        : { checkpoints: preamble.preflight }),
      checkpointRequest: {
        mode,
        declarations,
        rerunRequested,
        ciRecovery: terminal.ciRequestsStaticOutput,
      },
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

/** Both author and candidate preconditions preserve the full served question. */
function renderGateRefusal(out: Out, result: DiscernResult<GateData>): void {
  out.errorBlock(result.message ?? "The gate refused to run.");
  const hints = interactiveHintTexts(result.hints);
  if (hints.length > 0) out.group("next");
  for (const hint of hints) out.warn(hint);
}

/** Run `done`. Returns a process exit code. */
export async function runFinish(
  root: string,
  opts: {
    json: boolean;
    standalone?: boolean;
    policyBase?: string;
    /** Fully attached live command tree, owned and injected by the entry point. */
    cliModel: CliModelProvider;
    dryRun?: boolean;
    rerun?: boolean;
    ci?: boolean;
    plain?: boolean;
    met?: string[];
    unmet?: { id: string; why: string };
  },
): Promise<number> {
  const treeRefusal = await completionTreeRefusal(root, opts.standalone);
  if (treeRefusal !== undefined) {
    observeResult(treeRefusal);
    emitResult(treeRefusal);
    return 1;
  }
  const mode = opts.ci === true ? "report" as const : "strict" as const;
  if (opts.policyBase !== undefined && (!opts.ci || !opts.standalone)) {
    const refusal: DiscernResult<GateData> = {
      ok: false,
      verb: "done",
      error: "invalid_arguments",
      message:
        "An explicit policy base is available only for standalone CI reports; strict completion always uses its recorded queue predecessor.",
    };
    observeResult(refusal);
    emitResult(refusal);
    return 1;
  }
  if (opts.dryRun ?? false) {
    return await dryRunGate(root, opts.json, mode);
  }
  const declarations: DeclarationRequest = {
    met: opts.met ?? [],
    ...(opts.unmet !== undefined ? { unmet: opts.unmet } : {}),
  };
  const rerunRequested = opts.rerun === true || opts.standalone === true;
  const terminal = terminalContext();
  const preamble = await resolveDonePreamble(
    root,
    {
      mode,
      declarations,
      rerunRequested,
      ciRecovery: terminal.ciRequestsStaticOutput,
      deferRerunGuard: !opts.standalone &&
        (await pinValidatedTree(root)).clean,
    },
    donePreambleOperations(opts.policyBase),
  );
  if (preamble.kind === "reuse") {
    observeResult(preamble.result);
    if (opts.json) {
      emitResult(preamble.result);
    } else {
      makeOut(colorEnabled()).ok(
        preamble.result.message ??
          "Current green Proof reused; no gate job ran.",
      );
    }
    return 0;
  }
  if (preamble.kind === "refuse") {
    const refusal = preamble.result;
    observeResult(refusal); // the logbook records the refusal with its slug
    if (opts.json) {
      emitResult(refusal);
      return 1;
    }
    renderGateRefusal(makeOut(colorEnabled()), refusal);
    return 1;
  }
  const preflight = preamble.preflight;
  const gateRun = (): ReturnType<typeof runGate> =>
    runGate(
      root,
      opts.json
        ? { kind: "quiet-result", terminal }
        : { kind: "human", plain: opts.plain ?? false, terminal },
      undefined,
      {
        cliModel: opts.cliModel,
        ...(opts.policyBase === undefined
          ? {}
          : { policyBase: opts.policyBase }),
        ...(opts.standalone === undefined
          ? {}
          : { standalone: opts.standalone }),
        ...(opts.rerun === undefined ? {} : { rerun: opts.rerun }),
        ...(preflight === undefined ? {} : { checkpoints: preflight }),
        checkpointRequest: {
          mode,
          declarations,
          rerunRequested,
          ciRecovery: terminal.ciRequestsStaticOutput,
        },
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
  if (!result.ok && result.data?.gate_ran === false) {
    renderGateRefusal(out, result);
    return 1;
  }
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
      `${GATE_FAILED_STAGE_LABEL[failedStage]} failed.`;
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
