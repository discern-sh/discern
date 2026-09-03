/**
 * Complete refresh planning and execution.
 *
 * The read-only planner in `tracked_refresh.ts` composes every Discern-owned
 * artifact domain. This module is the thin executor: it consumes that plan,
 * reports each planned target as a step, and never reaches a writer that was
 * absent from the preview.
 */

import { ensureDir } from "@std/fs";
import { dirname } from "@std/path";
import {
  applyMaterializeSkillsPlan,
  applySkillMaterializationOperation,
  planMaterializeSkills,
} from "../lib/skills.ts";
import { skillsDirsForAgents } from "../lib/providers.ts";
import { Logger, loggerSink } from "../lib/log.ts";
import { atomicReplaceBytes } from "../shared/atomic_write.ts";
import { type DiscernConfig, loadConfig } from "../shared/config_schema.ts";
import type { EnvReader } from "../shared/env.ts";
import {
  fire,
  HINTS,
  hintTexts,
  interactiveHintTexts,
  mergeHintTexts,
} from "../shared/hints.ts";
import {
  type DiscernResult,
  renderPlan,
  type StepResult,
} from "../shared/result.ts";
import type { RefreshData } from "../shared/result_schemas.ts";
import { applyProofNotesFetchOperation } from "./gate/proof_notes.ts";
import { instructionAgents } from "./instruction_render.ts";
import {
  planRefresh,
  type RefreshEffect,
  type RefreshFileOperation,
  type RefreshPlan,
  refreshPlanToEngine,
} from "./tracked_refresh.ts";
import { applyGeneratedMergeDriverOperation } from "./generated_merge_driver.ts";

/** What one complete refresh apply accomplished. */
export interface InstructionsResult {
  /** Changed Agent-file paths, in plan order. */
  agentsWritten: string[];
  /** Tracked-capable Agent and Shared files whose bytes or mode changed. */
  trackedArtifactsChanged: string[];
  /** Managed attributes files whose discern-owned block changed. */
  gitattributesChanged: string[];
  /** Project files wiring each agent's MCP server. */
  mcpWired: string[];
  /** Provider hook/settings files re-seeded with discern's hook groups. */
  hooksWired: string[];
  /** Agent-app worktree-lifecycle files changed. */
  worktreeAppWired: string[];
  /** Project-local provider policy/rules files changed. */
  projectRulesWired: string[];
  /** Local Git config keys whose managed proof-note mappings changed. */
  proofNotesFetchChanged: string[];
  /** Maintained ADR index paths changed. */
  adrIndexWritten: string[];
  /** Agent/user-facing advice from this run. */
  hints: string[];
  /** Bundled skill trees copied. */
  skillsCopied: number;
  /** Authored skill links created. */
  skillsLinked: number;
  /** Stale managed skill entries pruned. */
  skillsPruned: number;
  /** Planning or apply failures, isolated by artifact boundary. */
  errors: string[];
}

export interface CompileInstructionsOptions {
  /** Process environment used by generated-file attribution and integrations. */
  readonly env?: EnvReader | undefined;
  /** Skip proof-note fetch transport when a caller already reconciled it. */
  readonly reconcileProofNotesFetch?: boolean | undefined;
}

/** Options specific to the public refresh result core. */
export interface RefreshResultOptions extends CompileInstructionsOptions {
  readonly dryRun?: boolean | undefined;
}

/** Internal apply output pairing the stable summary with executed steps. */
export interface RefreshApplyResult {
  readonly summary: InstructionsResult;
  readonly steps: StepResult[];
}

/** The non-blank refresh errors a caller should treat as failed artifacts. */
export function instructionRefreshErrors(
  result: Pick<InstructionsResult, "errors">,
): string[] {
  return result.errors
    .map((error) => error.trim())
    .filter((error) => error.length > 0);
}

/** Whether an instruction refresh completed without a non-blank error. */
export function instructionRefreshSucceeded(
  result: Pick<InstructionsResult, "errors">,
): boolean {
  return instructionRefreshErrors(result).length === 0;
}

/** Start an empty refresh summary with the supplied errors and hints. */
function emptySummary(errors: readonly string[] = []): InstructionsResult {
  return {
    agentsWritten: [],
    trackedArtifactsChanged: [],
    gitattributesChanged: [],
    mcpWired: [],
    hooksWired: [],
    worktreeAppWired: [],
    projectRulesWired: [],
    proofNotesFetchChanged: [],
    adrIndexWritten: [],
    hints: [],
    skillsCopied: 0,
    skillsLinked: 0,
    skillsPruned: 0,
    errors: [...errors],
  };
}

/** Add a string once while preserving first-effect order. */
function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

/** Record one successful planned effect in the stable refresh summary. */
function recordSuccessfulEffect(
  summary: InstructionsResult,
  effect: RefreshEffect,
): void {
  if (effect.artifacts.includes("agent_file")) {
    pushUnique(summary.agentsWritten, effect.target);
  }
  if (effect.artifacts.includes("gitattributes")) {
    pushUnique(summary.gitattributesChanged, effect.target);
  }
  if (effect.artifacts.includes("mcp")) {
    pushUnique(summary.mcpWired, effect.target);
  }
  if (effect.artifacts.includes("hooks")) {
    pushUnique(summary.hooksWired, effect.target);
  }
  if (effect.artifacts.includes("worktree_app")) {
    pushUnique(summary.worktreeAppWired, effect.target);
  }
  if (effect.artifacts.includes("project_rules")) {
    pushUnique(summary.projectRulesWired, effect.target);
  }
  if (effect.artifacts.includes("adr_index")) {
    pushUnique(summary.adrIndexWritten, effect.target);
  }
  // Complete-plan membership, apply accounting, and tracked convergence answer
  // different questions. An unchanged Agent file is still a real retained write
  // (and belongs in agentsWritten), while a first-install integration is excluded
  // from status/Gate drift yet must join update's generated commit when apply
  // changes its bytes. Count concrete file changes here; trackedKinds remains the
  // policy filter only for planTrackedRefresh.
  if (
    effect.type === "file" &&
    (effect.operation.bytesChanged || effect.operation.modeChanged)
  ) {
    pushUnique(summary.trackedArtifactsChanged, effect.target);
  }
  if (effect.type === "skill") {
    if (effect.operation.kind === "bundled") summary.skillsCopied++;
    if (effect.operation.kind === "authored") summary.skillsLinked++;
    if (effect.operation.kind === "stale") summary.skillsPruned++;
  }
  if (effect.type === "proof-notes-fetch") {
    for (
      const key of [
        ...effect.operation.addedKeys,
        ...effect.operation.removedKeys,
      ]
    ) {
      pushUnique(summary.proofNotesFetchChanged, key);
    }
  }
}

/** Build the summary a successful application of every planned effect yields. */
function plannedSummary(plan: RefreshPlan): InstructionsResult {
  const summary = emptySummary(plan.errors.map((error) => error.message));
  for (const effect of plan.effects) recordSuccessfulEffect(summary, effect);
  return summary;
}

/** Apply one exact file operation retained by the plan. */
async function applyRefreshFileOperation(
  operation: RefreshFileOperation,
): Promise<void> {
  if (operation.disposition === "remove") {
    try {
      await Deno.remove(operation.targetAbs);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    return;
  }
  const bytes = operation.bytes;
  if (bytes === undefined) {
    throw new Error(`refresh plan lost the bytes for ${operation.targetRel}`);
  }
  await ensureDir(dirname(operation.targetAbs));
  await atomicReplaceBytes(operation.targetAbs, bytes, {
    mode: operation.mode ?? 0o644,
    exactMode: true,
    sync: false,
  });
}

/** Apply one plan-bound effect and perform no discovery. */
async function applyRefreshEffect(
  plan: RefreshPlan,
  effect: RefreshEffect,
): Promise<void> {
  if (effect.type === "file") {
    await applyRefreshFileOperation(effect.operation);
    return;
  }
  if (effect.type === "skill") {
    await applySkillMaterializationOperation(effect.operation, plan.config);
    return;
  }
  if (effect.type === "git-config") {
    const error = await applyGeneratedMergeDriverOperation(effect.operation);
    if (error !== undefined) throw new Error(error);
    return;
  }
  const error = await applyProofNotesFetchOperation(
    plan.root,
    effect.operation,
  );
  if (error === undefined) return;
  let message = `${effect.operation.failurePrefix}: ${error}`;
  if (effect.operation.rollback !== undefined) {
    const rollback = await applyProofNotesFetchOperation(
      plan.root,
      effect.operation.rollback,
    );
    if (rollback !== undefined) {
      message += `; ${effect.operation.rollback.failurePrefix}: ${rollback}`;
    }
  }
  throw new Error(message);
}

/** Past-tense apply narration for one planned disposition. */
function appliedVerb(effect: RefreshEffect): string {
  return effect.disposition === "create"
    ? "created"
    : effect.disposition === "update"
    ? "updated"
    : "removed";
}

/** Add plan-derived hints after the actual successful set is known. */
function addRefreshHints(
  plan: RefreshPlan,
  summary: InstructionsResult,
): void {
  if (plan.mcpFirstInstall && summary.mcpWired.length > 0) {
    summary.hints.push(
      fire(
        plan.config.meta.bootstrapped
          ? HINTS["refresh-mcp-first-install"]
          : HINTS["refresh-mcp-setup-deferred"],
      ).text,
    );
  }
  const errors = instructionRefreshErrors(summary);
  if (errors.length > 0) {
    summary.hints = mergeHintTexts(
      hintTexts(
        errors.map((message) =>
          fire(HINTS["refresh-artifact-failed"], { message })
        ),
      ),
      summary.hints,
    );
  } else if (summary.trackedArtifactsChanged.length > 0) {
    summary.hints = mergeHintTexts(
      hintTexts([fire(HINTS["refresh-commit-tracked-artifacts"])]),
      summary.hints,
    );
  }
}

/**
 * Apply the complete refresh plan. A failed effect blocks later effects only in
 * its declared artifact boundary; every other planned boundary still proceeds.
 */
export async function applyRefreshPlan(
  plan: RefreshPlan,
  log = new Logger({ json: true, noColor: true }),
): Promise<RefreshApplyResult> {
  const summary = emptySummary(plan.errors.map((error) => error.message));
  const steps: StepResult[] = [];
  const failedBoundaries = new Set<string>();
  const skillsByDir = new Map<
    string,
    { copied: number; linked: number; pruned: number }
  >();
  const engine = refreshPlanToEngine(plan);
  for (const warning of plan.warnings) log.warn(`refresh: ${warning}`);
  for (const error of plan.errors) log.warn(error.message);

  for (const [index, effect] of plan.effects.entries()) {
    const step = engine.steps[index];
    if (step === undefined) {
      throw new Error("refresh engine projection lost a planned effect");
    }
    if (failedBoundaries.has(effect.boundary)) {
      steps.push({ step, outcome: "skipped" });
      continue;
    }
    try {
      await applyRefreshEffect(plan, effect);
      recordSuccessfulEffect(summary, effect);
      if (effect.type === "skill") {
        const changed = skillsByDir.get(effect.operation.dirRel) ?? {
          copied: 0,
          linked: 0,
          pruned: 0,
        };
        if (effect.operation.kind === "bundled") changed.copied++;
        if (effect.operation.kind === "authored") changed.linked++;
        if (effect.operation.kind === "stale") changed.pruned++;
        skillsByDir.set(effect.operation.dirRel, changed);
      }
      steps.push({ step, outcome: "ok" });
      log.info(`refresh: ${appliedVerb(effect)} ${effect.target}`);
    } catch (error) {
      failedBoundaries.add(effect.boundary);
      const message = `could not ${effect.disposition} ${effect.target}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      summary.errors.push(message);
      steps.push({ step, outcome: "failed" });
      log.warn(message);
    }
  }

  for (const [dir, changed] of skillsByDir) {
    log.info(
      `skills materialized into ${dir}/: ${changed.copied} bundled, ${changed.linked} authored` +
        (changed.pruned > 0 ? ` (pruned ${changed.pruned} stale)` : ""),
    );
  }
  addRefreshHints(plan, summary);
  if (summary.agentsWritten.length > 0) {
    log.ok(
      `refresh: compiled ${plan.sourceCount} source(s) + built-in instructions into ${summary.agentsWritten.length} changed Agent file(s): ${
        summary.agentsWritten.join(",")
      }`,
    );
  } else if (plan.effects.length === 0 && summary.errors.length === 0) {
    log.ok("refresh: every managed artifact is current.");
  }
  for (const hint of interactiveHintTexts(summary.hints)) log.info(hint);
  return { summary, steps };
}

/** Render the stable refresh data payload. */
function refreshData(result: InstructionsResult): RefreshData {
  return {
    agents_written: result.agentsWritten,
    mcp_wired: result.mcpWired,
    hooks_wired: result.hooksWired,
    worktree_app_wired: result.worktreeAppWired,
    project_rules_wired: result.projectRulesWired,
    proof_notes_fetch_changed: result.proofNotesFetchChanged,
    adr_index_written: result.adrIndexWritten,
    skills: {
      copied: result.skillsCopied,
      linked: result.skillsLinked,
      pruned: result.skillsPruned,
    },
    errors: instructionRefreshErrors(result),
  };
}

/** Construct the discriminated success/failure envelope fields. */
function refreshResultFields(result: InstructionsResult): {
  hints: string[];
  data: RefreshData;
} {
  return { hints: result.hints, data: refreshData(result) };
}

/**
 * The result-returning core behind `discern refresh` and `discern_refresh`.
 * A dry run renders and returns the same plan the apply path consumes.
 */
export async function refreshResult(
  root: string,
  logger = new Logger({ json: true, noColor: true }),
  options: RefreshResultOptions = {},
): Promise<DiscernResult<RefreshData>> {
  const plan = await planRefresh(root, options);
  if (options.dryRun === true) {
    const summary = plannedSummary(plan);
    addRefreshHints(plan, summary);
    const engine = refreshPlanToEngine(plan);
    logger.info("Dry run: nothing changed.");
    renderPlan(loggerSink(logger), engine);
    for (const error of summary.errors) logger.warn(error);
    const fields = {
      verb: "refresh",
      dry_run: true as const,
      plan: engine,
      ...refreshResultFields(summary),
    };
    return summary.errors.length > 0
      ? {
        ok: false,
        error: "partial_refresh",
        message:
          `${summary.errors.length} artifact(s) could not be planned; see data.errors.`,
        ...fields,
      }
      : { ok: true, ...fields };
  }

  const applied = await applyRefreshPlan(plan, logger);
  const errors = instructionRefreshErrors(applied.summary);
  const fields = {
    verb: "refresh",
    steps: applied.steps,
    ...refreshResultFields(applied.summary),
  };
  return errors.length > 0
    ? {
      ok: false,
      error: "partial_refresh",
      message:
        `${errors.length} artifact(s) failed to refresh; see data.errors.`,
      ...fields,
    }
    : { ok: true, ...fields };
}

/** Plan and apply a complete refresh for internal lifecycle callers. */
export async function compileInstructions(
  root: string,
  logger?: Logger,
  options: CompileInstructionsOptions = {},
): Promise<InstructionsResult> {
  return (await applyRefreshPlan(
    await planRefresh(root, options),
    logger ??
      new Logger({ json: false, noColor: false, humanStream: "stdout" }),
  )).summary;
}

/**
 * Apply only checkout-local materialized skills. Acceptance uses this after the
 * validated tracked refresh effects have already landed.
 */
export async function materializeLocalRefreshArtifacts(
  root: string,
  logger?: Logger,
  templatesDir?: string,
): Promise<InstructionsResult> {
  const log = logger ??
    new Logger({ json: false, noColor: false, humanStream: "stdout" });
  const config: DiscernConfig = await loadConfig(root);
  const materialized = await applyMaterializeSkillsPlan(
    await planMaterializeSkills(
      root,
      config,
      skillsDirsForAgents(instructionAgents(config)),
      templatesDir === undefined ? {} : { templatesDir },
    ),
    log,
  );
  const summary = emptySummary(materialized.errors);
  summary.skillsCopied = materialized.copied;
  summary.skillsLinked = materialized.linked;
  summary.skillsPruned = materialized.pruned;
  return summary;
}
