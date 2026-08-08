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
import { DISCERN_ENVIRONMENT_VARIABLES } from "../../shared/environment_variables.ts";
import { knownJobList, STAGES } from "../../shared/capabilities.ts";
import type { JobResult } from "../jobs/types.ts";
import {
  buildGatePlan,
  buildGateResultWithHints,
  checkTestGroups,
  composeGatePlan,
  gatePlanToEngine,
  planScopeGates,
  preCheckpointGroups,
  scopeGatesGroup,
} from "./plan.ts";
import { gateRunContext, runGroup } from "./execute.ts";
import {
  type AdminStateWriteAuthority,
  clearStandardMeasurements,
  currentTreeIdentity,
  inspectLastGateRun,
  pinValidatedTree,
  preflightAdminStateWrites,
  recordGateOutcome,
  recordLastGateRun,
  recordStandardMeasurements,
  sameTreeIdentity,
  UNCHANGED_TREE_RERUN_SLUG,
} from "./receipt.ts";
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
  liveCliModel,
} from "../../lib/map_integrity.ts";
import { type AdrIndexState, adrIndexState } from "../../lib/adr_index.ts";
import { buildGateReceipt } from "./receipt_render.ts";
import { renderSlotWait } from "./slot_wait_render.ts";
import { renderDoneTtyReceiptPanel, renderDoneTtySummary } from "./done_tty.ts";
import {
  createGateTtyProgress,
  gateTtyPresentation,
  renderGateTtyTable,
} from "./gate_tty.ts";
import { cmdsInStage } from "./stages.ts";
import { buildStandardPlan, standardJobLabel } from "./standard_plan.ts";
import {
  buildStandardJobs,
  fmtRate,
  type ResolvedStandard,
} from "./standards.ts";
import { verifyTrunkLimits } from "./standard_limits.ts";
import {
  gateStandardsData,
  planStandardJobsFromConfig,
  resolveStandardActions,
  resolveStandardActionsFromConfig,
} from "./standards_gate.ts";
import type {
  GateStandard,
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
import { gateFailureGotchasTail, type GotchasFailureTail } from "./gotchas.ts";
import { diagnosticOutputFields } from "./diagnostic_output.ts";
import { classifyScopes, PREVIEWABLE_MARKER } from "../scopes/scopes.ts";
import { couplingGateHints } from "../coupling/coupling.ts";
import { colorEnabled, makeOut, type Out, outSink } from "../output.ts";
import { assertMainMerged, detectSilentDivergence } from "../worktree/git.ts";
import {
  type Diagnostic,
  dimBlock,
  type DiscernResult,
  type FailedStage,
  previewResult,
  renderPlan,
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
import {
  inlineFindingRoutes,
  receiptFindingHints,
} from "../logbook/surfaces.ts";
import {
  inspectLandingAuthority,
  landingAuthorityProjection,
  type LandingAuthorityResolution,
  uncoveredLandingAuthorityDetails,
} from "../worktree/landing_authority.ts";
import { setupInProgressHint } from "../../shared/setup_state.ts";
import {
  checkGuidanceCurrent,
  type GuidanceDriftEntry,
} from "../guidance_render.ts";
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

/**
 * A compact, plain-text summary of how a stale generated file differs from what
 * `discern refresh` would write — the non-blank lines present in the file but NOT
 * in the recompiled body (what a refresh would remove, a hand-edit included).
 * Bounded so it never floods the diagnostic.
 */
function driftDiff(entry: GuidanceDriftEntry): string {
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
 * refresh` reproduce command, the redirect (edits belong in `[guidance].sources`,
 * not the generated file), and a capped diff of what a refresh would change — the
 * rescue, since the untracked file has no `git diff` to fall back on.
 */
async function guidanceDiagnostic(
  stale: GuidanceDriftEntry[],
): Promise<Diagnostic> {
  const files = stale.map((d) => d.path).join(", ");
  const outputFields = await diagnosticOutputFields(
    `Agent files are out of date: ${files}.\n` +
      "Run `discern refresh` to regenerate them. If you meant to change the " +
      "guidance, edit your [guidance].sources (e.g. guidance.md) instead — a direct " +
      "edit to a generated file is overwritten on the next refresh.\n\n" +
      stale.map(driftDiff).join("\n\n"),
  );
  return {
    tool: "guidance",
    severity: "error",
    message: `agent file(s) out of date: ${files}`,
    reproduce_cmd: "discern refresh",
    ...outputFields,
  };
}

/**
 * A diagnostic for stale MATERIALIZED skills: which dirs/skills drifted from the
 * effective set, and the `discern refresh` that re-materializes them. The skills
 * analog of {@link guidanceDiagnostic} — same redirect (edit the source, not the
 * generated copy), so the two generated-artifact failures read identically.
 */
async function skillsDiagnostic(
  stale: SkillsDriftEntry[],
): Promise<Diagnostic> {
  const dirs = [...new Set(stale.map((d) => d.dir))].join(", ");
  const outputFields = await diagnosticOutputFields(
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
  malformed: SkillWellformedness[],
): Promise<Diagnostic> {
  const files = malformed.map((m) => m.file).join(", ");
  const outputFields = await diagnosticOutputFields(
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
  dupes: AdrNumberDuplicate[],
): Promise<Diagnostic> {
  const numbers = dupes.map((d) => d.number).join(", ");
  const outputFields = await diagnosticOutputFields(
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
 * A diagnostic for MAP & GUIDANCE integrity findings: every finding as
 * `file:line`, grouped by rule with each rule's remedy stated once — the fix
 * is at the point of failure, and one loop from the diagnostic clears it.
 * `discern refresh` cannot help here: the SOURCE files carry the defect, so
 * the remedy is always an edit (or, for a stale example, a registry fix).
 */
async function mapIntegrityDiagnostic(
  findings: DocsIntegrityFinding[],
): Promise<Diagnostic> {
  const byRule = new Map<DocsIntegrityRule, DocsIntegrityFinding[]>();
  for (const finding of findings) {
    byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding]);
  }
  const sections = [...byRule.entries()].map(([rule, group]) =>
    `${rule}:\n` +
    group.map((f) => `  ${f.file}:${f.line} ${f.detail}`).join("\n") +
    `\n  fix: ${DOCS_INTEGRITY_REMEDIES[rule]}`
  );
  const files = [...new Set(findings.map((f) => f.file))];
  const outputFields = await diagnosticOutputFields(
    "The map or guidance references things a reader cannot follow:\n\n" +
      sections.join("\n\n"),
  );
  return {
    tool: "map-integrity",
    severity: "error",
    message: `map or guidance integrity: ${findings.length} finding(s) ` +
      `across ${files.length} file(s)`,
    reproduce_cmd: "discern done",
    ...outputFields,
  };
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
  state: Extract<AdrIndexState, { kind: "stale" | "invalid" }>,
): Promise<Diagnostic> {
  const outputFields = await diagnosticOutputFields(
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
  tracked: TrackedDiscernIgnoredArtifacts,
): Promise<Diagnostic> {
  const outputFields = await diagnosticOutputFields(
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
  json: boolean,
  signal?: AbortSignal,
  presentation: { liveWidth?: number } = {},
): Promise<
  {
    result: DiscernResult<GateData>;
    failedStage: FailedStage | null;
    cfg: DiscernConfig;
    out: Out;
    changed: string[];
    gotchasTail: GotchasFailureTail | undefined;
    liveTable: boolean;
  }
> {
  // Pin the tree identity FIRST — before any precondition or job reads it. A green
  // outcome vouches for THIS (HEAD, clean) pair; recordGateOutcome re-verifies the
  // pin at stamp time, so a commit made while the gate runs can never earn a receipt
  // naming a tree the jobs never read.
  const treePin = await pinValidatedTree(root);
  // Retention for the job output artifacts the run is about to create (ADR 0117)
  // — before jobs spawn, so the sweep can never sit on a job's kill path.
  await sweepDueTempArtifacts(root);
  const cfg = await loadConfig(root);
  const generatedGroups = resolveGeneratedGroups(cfg);
  const compactTty = presentation.liveWidth !== undefined && !json &&
    !cfg.gate.stream;
  // A regular human run narrates jobs to stdout. The compact done TTY withholds
  // routine logs while its table observes scheduler events; explicit
  // [gate].stream keeps the command-output path. --json silences both the runner
  // and Out because the envelope is the entire output (ADR 0030). The shared run
  // context is also the one `prepare`/`test` use.
  const { runOpts, out, slots } = gateRunContext(root, cfg, json, signal, {
    quietHumanRun: compactTty,
  });
  const progress = compactTty && presentation.liveWidth !== undefined
    ? createGateTtyProgress(out.raw, {
      width: presentation.liveWidth,
      color: out.color,
    })
    : undefined;
  if (progress !== undefined) {
    runOpts.observer = progress;
    const plannedChanged = await classifyScopes(root, cfg);
    progress.start(
      buildGatePlan(cfg, plannedChanged, dryRunStandardJobs(cfg)).groups,
    );
  }
  const runOut = compactTty ? makeOut(out.color, { quiet: true }) : out;

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
  const mainBranch = Deno.env.get(DISCERN_ENVIRONMENT_VARIABLES.trunk) ||
    cfg.repository.trunk;
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

  // 1a. The never-loosen verification (Tier 1, ADR 0133) — every configured
  //     [standards] limit against the trunk's committed copy, deletions included.
  //     Placed HERE, directly after the merge check: it is the cheapest
  //     precondition after it (one git read, milliseconds), it guards the very
  //     config every later job table was built from, and the merge check must
  //     precede it so the baseline is the freshest merged-in trunk copy. Not
  //     configurable — an escape hatch here would defeat the guarantee the
  //     product leads with. An unreadable trunk skips LOUDLY (a warning + the
  //     receipt discloses it); a trunk config that was fetched but does not
  //     parse fails hard; never a silent pass either way.
  const stdPlan = buildStandardPlan(cfg);
  let standardsLimits: StandardsLimitsData | undefined;
  let tier1Diagnostics: Diagnostic[] = [];
  let limitsWarning: FiredHint | undefined;
  if (failedStage === null) {
    const verification = await verifyTrunkLimits(
      root,
      mainBranch,
      stdPlan.standards,
    );
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
  //     rules, so the tracked-by-default compiled guidance files and a user's own
  //     files under a provider directory are never flagged.
  let trackedArtifactsDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const tracked = await trackedDiscernIgnoredArtifacts(root);
    if (tracked.paths.length > 0) {
      failedStage = "tracked_artifacts";
      trackedArtifactsDiag = await trackedArtifactsDiagnostic(tracked);
    }
  }

  // 1c. Generated-artifacts currency — guidance (ADR 0034) — also runs FIRST, as a
  //     fail-fast precondition beside the merge check (ADR 0056). Its verdict is
  //     invariant across the gate for the same reason the merge check's is: the gate
  //     never runs `discern refresh`, and its fix stage formats SOURCE code, never the
  //     guidance sources or the agent files those checks read —
  //     so checking here gives the same answer as checking last, while skipping the
  //     slow build/check∥test/scope-gate sweep when the only problem is stale drift the
  //     agent must `discern refresh` and re-run to clear regardless. Block a STALE agent
  //     file only (a MISSING one is tolerated: a tree that has not built them yet, or a
  //     project that deliberately keeps them untracked — see ADR 0034/0128).
  let guidanceDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const stale = (await checkGuidanceCurrent(root, cfg))
      .filter((d) => d.reason === "stale");
    if (stale.length > 0) {
      failedStage = "guidance";
      guidanceDiag = await guidanceDiagnostic(stale);
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
      skillsDiag = await skillsDiagnostic(stale);
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
      skillFrontmatterDiag = await skillFrontmatterDiagnostic(malformed);
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
      adrNumbersDiag = await adrNumbersDiagnostic(dupes);
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
      adrIndexDiag = await adrIndexDiagnostic(state);
    }
  }

  // 1d-quinquies. Map & guidance integrity — the documentation agents and the
  //     published projections read must not reference things that do not exist:
  //     dead intra-map links and anchors, metadata blocks the lenient reader
  //     would swallow, fenced `discern` examples the current CLI rejects,
  //     published pages linking into the internal trees, and citations of
  //     skills outside the effective set. Blocking, beside the other artifact
  //     preflights: each finding is a defect a reader only discovers by
  //     following the reference and failing, and no later stage can clear it.
  //     The CLI model comes from the live command registry via the core's lazy
  //     loader, so the command tree stays off every other verb's load path.
  let mapIntegrityDiag: Diagnostic | undefined;
  if (failedStage === null) {
    const findings = await checkDocsIntegrity(root, cfg, await liveCliModel());
    if (findings.length > 0) {
      failedStage = "map_integrity";
      mapIntegrityDiag = await mapIntegrityDiagnostic(findings);
    }
  }

  // 1e. Write authority — a REAL create/write/rename/remove probe, not permission
  //     metadata. The gate may need to stamp or clear its gate/measurement state
  //     after every outcome, so prove that tiny late effect before any project job
  //     can consume minutes. The branded token is then required by every writer.
  //     A denial on an otherwise-runnable gate is therefore an immediate failure,
  //     with the exact path in diagnostics, rather than a green-but-unreceipted run
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
          generatedDiagnostics = await generatedBuildDriftDiagnostics(drift);
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
  //     committed tree is seeking a receipt, and a tracked strand left by the
  //     pre-groups above already forfeits it — the standards, check∥test, and
  //     scope-gate work ahead cannot change that verdict, so stop here and
  //     surface the strands while nothing has been wasted on them. Judged only
  //     after ALL pre-groups (a later build may consume or restore a fixer's
  //     edit, and convergence edits belong in one report), and gated on the
  //     PIN's full cleanliness, never the tracked-dirty snapshot: the pin
  //     counts untracked files, so an untracked-dirty start — whose tracked
  //     snapshot is empty — must not read as receipt-eligible. A dirty start
  //     skips the checkpoint entirely: it can earn no receipt anyway, and the
  //     agent running `done` dirty is asking for the full run's feedback,
  //     which the final pass (step 5) still delivers. A failed pre-group or
  //     generated-drift verdict above wins outright — the closure yields to
  //     any recorded failure.
  const receiptEligibleAtStart = treePin.head !== undefined && treePin.clean;
  if (receiptEligibleAtStart) {
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
    ? await resolveStandardActions(root, stdPlan.standards)
    : resolveStandardActionsFromConfig(stdPlan.standards);
  const gateStandards = buildStandardJobs(root, resolved);
  const ctGroups = checkTestGroups(cfg, gateStandards.jobs);

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
    if (
      !(await runGroup(
        group,
        results,
        runOpts,
        runOut,
        slots,
        gateStandards.evaluators,
      ))
    ) {
      failedStage = group.stage;
    } else if (holdsStandards && replayFailure) {
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
  const changed = await classifyScopes(root, cfg);
  const sgGroup = scopeGatesGroup(planScopeGates(cfg, changed));
  const plan = composeGatePlan(stageGroups, sgGroup, changed);
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
  //     receipt-eligible start; this closing pass catches strands the check∥test
  //     and scope-gate stages introduced — and, on a dirty start, every stage's.
  await failOnStrandedTree();

  // 6. Assemble the executed plan + result, attaching the agent-facing hints —
  //    the same next-step advice the human tail prints, promoted into the envelope.
  const { result, firedHints: jobOutputHints } = await buildGateResultWithHints(
    plan,
    results,
    failedStage,
    generatedFailureRemedies,
  );
  if (slots?.waitedMs !== undefined) {
    result.waitedMs = slots.waitedMs;
  }
  // 6a. The standards' envelope fields (ADR 0133): the per-standard outcomes and
  //     the Tier-1 verification, plus the measured value patched into each
  //     measured step's note — the receipt renders FROM these, never a second
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
  if (guidanceDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), guidanceDiag];
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
  if (mapIntegrityDiag !== undefined) {
    result.diagnostics = [...(result.diagnostics ?? []), mapIntegrityDiag];
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
  // The receipt (v1): a GREEN run over a CLEAN committed tree ahead of the trunk
  // renders the compact review summary from this very envelope — the artifact the
  // agent relays to its owner at the review moment. Built before the marker write so
  // the marker can store the markdown beside the sha it vouches for.
  const receipt = failedStage === null
    ? await buildGateReceipt(
      root,
      mainBranch,
      result.steps ?? [],
      standardsData,
      standardsLimits,
    )
    : undefined;
  // Record the measurement receipt (ADR 0112, extended by ADR 0133): a green
  // gate over a clean committed tree records every value it holds (measured or
  // replayed — a replayed value is a real measurement of an identical input
  // set), so an immediate `standards --pin` replays instead of re-measuring and
  // the next gate run has a baseline to replay against. Durations ride along so
  // a defer decision can be made from data. Fail-closed on red: a failing
  // standard's values must not stay reusable.
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
  // after the fail-fast check. Re-check beside the receipt stamp and report the
  // new state without changing the green verdict or withholding the receipt:
  // the receipt vouches for the pinned HEAD, while `accept` retains the final
  // live-ref check. This observation can race too, so it stays advisory.
  let trunkAdvanceWarning: FiredHint | undefined;
  if (failedStage === null) {
    const stampMerge = await assertMainMerged(root, mainBranch);
    if (stampMerge.kind === "behind") {
      trunkAdvanceWarning = fire(HINTS["gate-trunk-advanced"]);
      runOut.warn(trunkAdvanceWarning.text);
    }
  }
  // Record the gate receipt (ADR 0067): a GREEN run over a CLEAN tree stamps the
  // HEAD pinned at gate start so `accept` can prove THIS tree already passed without
  // re-running the gate; a FAILED run clears any stale vouch. Write authority was a
  // fail-fast precondition; the writer remains best-effort only against a later
  // point-in-time failure, whose outcome rides in `data` for suppressed loggers.
  const gateReceipt: NonNullable<GateData["gate_receipt"]> =
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
        receipt,
      );
  // The last-run marker remembers what this run judged — every verdict, red
  // included, unlike the receipt above — so the next `done` can refuse an
  // unchanged-tree rerun unless it carries `--confirmed`.
  if (writeAuthority !== undefined) {
    await recordLastGateRun(root, writeAuthority, failedStage === null);
  }
  // A stamp refused because HEAD moved mid-run also suppresses the rendered review
  // receipt: its git facts were gathered AFTER the move, so its markdown describes a
  // tree the gate never read — the hint tells the agent to re-run on the final commit.
  const emittedReceipt = gateReceipt.status === "skipped_head_moved"
    ? undefined
    : receipt;
  const landingAuthority = failedStage === null && emittedReceipt !== undefined
    ? await inspectLandingAuthority(root, mainBranch)
    : undefined;
  if (result.data !== undefined) {
    result.data.gate_receipt = gateReceipt;
    if (emittedReceipt !== undefined) {
      result.data.receipt = emittedReceipt;
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
  // also have a real receipt to sit beside, and the formatter caps the whole
  // addition at one line after applying its stricter evidence margin.
  const logbookHints = failedStage === null && cfg.meta.bootstrapped &&
      emittedReceipt !== undefined
    ? receiptFindingHints(
      (await inlineFindingRoutes(root, cfg)).done,
      emittedReceipt.branch,
    )
    : [];
  const receiptHint = gateReceiptHint(gateReceipt, failedStage);
  const deferredStandards = standardsData
    .filter((o) => o.measurement === "deferred")
    .map((o) => o.name);
  // On failure, the stage remedy leads the envelope: the human renderer and
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
    // The fleet test-run cap's wait notices (the same lines the human run
    // narrated live), so a --json/MCP caller sees why the run took longer.
    ...(slots?.waits ?? []),
    ...(receiptHint !== undefined ? [receiptHint] : []),
    ...buildGateHints(
      cfg,
      changed,
      failedStage,
      gotchasTail,
      emittedReceipt !== undefined,
      deferredStandards,
      landingAuthority,
    ),
    ...trailingJobHints,
    ...couplingHints,
    ...logbookHints,
  ];
  if (hints.length > 0) {
    result.hints = hintTexts(hints);
  } else {
    delete result.hints;
  }
  progress?.complete(result.steps ?? []);
  return {
    result,
    failedStage,
    cfg,
    out,
    changed,
    gotchasTail,
    liveTable: progress !== undefined,
  };
}

/** Fire the post-gate hint that identifies the receipt bound to clean HEAD. */
function gateReceiptHint(
  receipt: NonNullable<GateData["gate_receipt"]>,
  failedStage: FailedStage | null,
): FiredHint | undefined {
  if (failedStage === null) {
    switch (receipt.status) {
      case "recorded":
        return undefined;
      case "skipped_dirty":
        return fire(HINTS["gate-receipt-skipped-dirty"], {
          reason: receipt.reason,
        });
      case "skipped_head_moved":
        return fire(HINTS["gate-receipt-head-moved"], {
          reason: receipt.reason,
        });
      case "record_failed":
        return fire(HINTS["gate-receipt-record-failed"], {
          reason: receipt.reason,
        });
      case "unavailable":
        return fire(HINTS["gate-receipt-unavailable"], {
          reason: receipt.reason,
        });
      case "cleared":
      case "clear_failed":
        return undefined;
    }
  }
  if (receipt.status === "clear_failed") {
    return fire(HINTS["gate-receipt-clear-failed"], {
      reason: receipt.reason,
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
  cfg: DiscernConfig,
  changed: string[],
  failedStage: FailedStage | null,
  gotchasTail: GotchasFailureTail | undefined,
  receiptEmitted: boolean,
  deferredStandards: string[],
  landingAuthority: LandingAuthorityResolution | undefined,
): FiredHint[] {
  if (failedStage !== null) {
    return gotchasTail === undefined
      ? []
      : [gotchasTail.hint, ...gotchasTail.warnings];
  }
  const receiptRoute = landingAuthority?.kind === "authorized"
    ? fire(HINTS["gate-land-under-verified-authority"], {
      source: landingAuthority.consent.source,
      scopes: landingAuthority.consent.scopes ?? [],
    })
    : landingAuthority !== undefined &&
        landingAuthorityProjection(landingAuthority) !== undefined
    ? fire(HINTS["gate-relay-uncovered-authority"], {
      uncovered: uncoveredLandingAuthorityDetails(landingAuthority),
      warnings: landingAuthority.warnings,
    })
    : fire(HINTS["gate-relay-receipt"]);
  const hints = receiptEmitted
    ? [
      fire(HINTS["gate-prove-it-works"]),
      receiptRoute,
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
  if (
    (cfg.worktree.resources.dev_server?.create ?? "") !== "" &&
    changed.includes(PREVIEWABLE_MARKER)
  ) {
    hints.push(fire(HINTS["gate-previewable-change"]));
  }
  return hints;
}

const DONE_TTY_ROUTINE_HINT_IDS = new Set([
  HINTS["gate-update-docs"].id,
  HINTS["gate-deferred-standards"].id,
]);

/**
 * Keep exceptional human advisories above the compact receipt, while leaving
 * its routine follow-ups in the envelope. The highlighted line already names
 * the full receipt, where deferred standards carry their command.
 */
function doneTtyReceiptHintTexts(
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
 * job table and highlighted one-line receipt. A pipe keeps the stored Markdown
 * page, preserving the copyable receipt surface used by scripts and agents.
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

  const receipt = result.data?.receipt;
  if (ttyWidth !== undefined && receipt !== undefined) {
    if (unfilled === STAGES.length) {
      out.ok(
        "Gate passed — but no job is wired, so nothing was actually checked (a no-op gate).",
      );
      out.warn(
        `Add a known job (${knownJobList()}) or a custom [jobs.<name>] table to discern.toml so the gate has something to run.`,
      );
    }
    for (const hint of doneTtyReceiptHintTexts(result.hints)) {
      out.info(hint);
    }
    const options = {
      width: ttyWidth,
      color: out.color,
    };
    out.group("gate-summary");
    out.raw(
      `${
        tableAlreadyRendered
          ? renderDoneTtyReceiptPanel(receipt, options)
          : renderDoneTtySummary(result.steps ?? [], receipt, options)
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
          color: out.color,
        })
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
      out.info(
        `${out.c.dim}note: ${unfilled} of ${STAGES.length} gate stages have no command yet.${out.c.reset}`,
      );
    }
  }
  if (receipt?.markdown !== undefined) {
    out.group("receipt");
    out.raw(`${dimBlock(receipt.markdown, outSink(out).dim)}\n`);
  }
  renderSlotWait(out, result.waitedMs);
  const hints = interactiveHintTexts(result.hints);
  if (hints.length > 0) out.group("next");
  for (const hint of hints) {
    out.info(hint);
  }
}

/**
 * Print the gate plan without running it (`--dry-run`): the leading fail-fast
 * preconditions (the merge check, tracked-artifacts guard, then the guidance/skills
 * currency checks), the wired job groups, and the scope-gates selected for the
 * changed scopes. Honest — it lists "what would run"; it cannot predict which jobs
 * fail-fast would skip.
 */
async function dryRunGate(
  root: string,
  json: boolean,
): Promise<number> {
  const cfg = await loadConfig(root);
  const changed = await classifyScopes(root, cfg);
  const plan = buildGatePlan(cfg, changed, dryRunStandardJobs(cfg));
  const engine = gatePlanToEngine(plan);
  if (json) {
    // A preview is a DiscernResult carrying `plan` + `dry_run` (no `steps`).
    emitResult(previewResult("done", engine));
    return 0;
  }
  renderPlan(outSink(makeOut(colorEnabled())), engine);
  return 0;
}

/**
 * The read-only refusal `done` serves when it is asked to re-run on the exact
 * tree the last run already judged, without a `--confirmed` attestation. An
 * unchanged tree expects an unchanged verdict, so the rerun is either wasted
 * gate time (the last run was green — `status` already shows the receipt) or a
 * flake probe that deserves to be deliberate and on the record (the last run
 * was red; retrying until green teaches that red is negotiable). Fires BEFORE
 * the gate machinery — the fix stage rewrites files, and a refusal must touch
 * nothing. Fail-open on every uncertainty: no marker, an unreadable identity,
 * or a differing tree all run the gate normally; `--dry-run` never refuses.
 */
async function unchangedTreeRerunRefusal(
  root: string,
  confirmed: boolean,
): Promise<DiscernResult<GateData> | undefined> {
  if (confirmed) {
    return undefined;
  }
  const last = await inspectLastGateRun(root);
  if (last === undefined) {
    return undefined;
  }
  const now = await currentTreeIdentity(root);
  if (now === undefined || !sameTreeIdentity(now, last)) {
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
      `\`--confirmed\` to re-run the gate on it anyway; the rerun is ` +
      `recorded. Nothing has run — the tree is untouched.`,
    hints: hintTexts([fire(hint)]),
  };
}

/** The output contract an in-process full-gate caller must choose explicitly. */
export type FinishResultSurface =
  | { kind: "quiet" }
  | { kind: "human"; plain: boolean };

/** Options for an in-process full-gate run. The required surface prevents a new
 * composite command from inheriting machine silence while a person waits. */
export interface FinishResultOptions {
  surface: FinishResultSurface;
  dryRun?: boolean;
  confirmed?: boolean;
  signal?: AbortSignal;
}

/**
 * Compute the `done` {@link DiscernResult} without exiting. Machine callers choose
 * `quiet`, keeping protocol stdout uncontaminated. Human composites choose `human`,
 * which preserves the same live/static/streaming job projection as standalone
 * `discern done` while leaving the composite command in charge of its own final
 * success or failure tail. Requiring that choice removes the former implicit
 * machine-quiet default from every present and future caller.
 *
 * `dryRun` returns the preview (the plan, nothing run). `confirmed` attests that a
 * rerun on the unchanged last-judged tree is deliberate; without it that rerun
 * refuses read-only. Aborting `signal` tree-kills the in-flight gate jobs and
 * returns the run as failed-with-cancellations.
 */
export async function finishResult(
  root: string,
  opts: FinishResultOptions,
): Promise<DiscernResult<GateData>> {
  if (opts.dryRun ?? false) {
    const cfg = await loadConfig(root);
    const changed = await classifyScopes(root, cfg);
    return previewResult(
      "done",
      gatePlanToEngine(buildGatePlan(cfg, changed, dryRunStandardJobs(cfg))),
    );
  }
  const refusal = await unchangedTreeRerunRefusal(
    root,
    opts.confirmed ?? false,
  );
  if (refusal !== undefined) {
    return refusal;
  }
  if (opts.surface.kind === "quiet") {
    return (await runGate(root, true, opts.signal)).result;
  }
  const { ttyWidth, liveWidth } = gateTtyPresentation(
    false,
    opts.surface.plain,
  );
  const gate = await runGate(root, false, opts.signal, {
    ...(liveWidth !== undefined ? { liveWidth } : {}),
  });
  if (
    ttyWidth !== undefined && !gate.liveTable && !gate.cfg.gate.stream
  ) {
    gate.out.group("gate-results");
    gate.out.raw(
      `${
        renderGateTtyTable(gate.result.steps ?? [], {
          width: ttyWidth,
          color: gate.out.color,
        })
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
    dryRun?: boolean;
    confirmed?: boolean;
    plain?: boolean;
  },
): Promise<number> {
  if (opts.dryRun ?? false) {
    return await dryRunGate(root, opts.json);
  }
  const refusal = await unchangedTreeRerunRefusal(
    root,
    opts.confirmed ?? false,
  );
  if (refusal !== undefined) {
    observeResult(refusal); // the logbook records the refusal with its slug
    if (opts.json) {
      emitResult(refusal);
      return 1;
    }
    const out = makeOut(colorEnabled());
    out.error(refusal.message ?? "The gate refused to re-run.");
    const hints = interactiveHintTexts(refusal.hints);
    if (hints.length > 0) out.group("next");
    for (const hint of hints) {
      out.warn(hint);
    }
    return 1;
  }
  const { ttyWidth, liveWidth } = gateTtyPresentation(
    opts.json,
    opts.plain ?? false,
  );
  const gateRun = (): ReturnType<typeof runGate> =>
    runGate(root, opts.json, undefined, {
      ...(liveWidth !== undefined ? { liveWidth } : {}),
    });
  const gate = await gateRun();
  const { result, failedStage, cfg, out, gotchasTail, liveTable } = gate;
  observeResult(result); // the logbook recorder lifts step timings from it
  if (opts.json) {
    emitResult(result);
    return failedStage === null ? 0 : 1;
  }
  if (failedStage !== null) {
    const headline = interactiveHintTexts(result.hints)[0] ??
      "The gate failed.";
    renderFailureTail(out, {
      verb: "done",
      headline,
      diagnostics: result.diagnostics ?? [],
      gotchas: gotchasTail,
      // The live table quiets the runner, so the tail carries the output.
      outputWithheld: liveTable,
    });
    renderSlotWait(out, result.waitedMs);
    return 1;
  }
  printSuccessTail(
    cfg,
    out,
    result,
    ttyWidth,
    liveTable,
  );
  return 0;
}
