/**
 * Post-landing convergence of the main checkout — the fail-open tail that
 * materializes local agent artifacts, runs the repository ensure commands,
 * proves the landing checkout with the smoke jobs, and reports whether
 * tracked files stayed clean. Every step is non-fatal: the landing is already
 * durable, so nothing here may roll it back or turn it red. Extracted from
 * the landing coordinator so the coordinator holds decisions and this module
 * holds the convergence sequence; the emergency route converges through the
 * same functions.
 */

import { resolveTemplatesDir } from "../../lib/paths.ts";
import { loadConfig } from "../../shared/config_schema.ts";
import { directoryExists } from "../../shared/fs_presence.ts";
import {
  fire,
  hasRegisteredActionableHint,
  HINTS,
  hintTexts,
  mergeHintTexts,
} from "../../shared/hints.ts";
import {
  BUILT_IN_STEP_LABELS,
  verbatimStepLabel,
} from "../../shared/result.ts";
import {
  gateRunContext,
  resolveGateRunPolicy,
  runJobGroups,
} from "../gate/execute.ts";
import { type JobGroup, serializeJobSteps } from "../gate/plan.ts";
import { materializeLocalRefreshArtifacts } from "../instructions.ts";
import { hasUncommittedTrackedChanges } from "./git.ts";
import {
  failedRefreshRun,
  instructionRefreshRun,
  remapWorktreeLocalTemplatesDir,
  runEnsureCommands,
} from "./lifecycle.ts";
import type { AcceptPlan } from "./plan.ts";
import type { AcceptExecutionProgress, EffortCheckout } from "./accept.ts";

// ── convergence ──────────────────────────────────────────────────────────────

/** Remap worktree-local templates into the landed checkout when that directory exists. */
async function postLandingLocalTemplatesDir(
  worktreePath: string,
  mainRepo: string,
): Promise<string | undefined> {
  let templatesDir: string | undefined;
  try {
    templatesDir = await resolveTemplatesDir();
  } catch {
    // discern-best-effort: accept-post-landing-templates-fallback
    return undefined;
  }
  const remapped = remapWorktreeLocalTemplatesDir(
    templatesDir,
    worktreePath,
    mainRepo,
  );
  return remapped !== undefined && await directoryExists(remapped)
    ? remapped
    : undefined;
}

/** Converge the main checkout on the landed tree; every step is non-fatal. */
export async function convergeMainCheckout(
  effort: EffortCheckout,
  plan: AcceptPlan,
  progress: AcceptExecutionProgress,
  signal: AbortSignal | undefined,
): Promise<void> {
  const { mainRepo, trunk } = effort;
  const log = effort.ctx.log;
  const results = progress.steps;
  const diagnostics = progress.diagnostics;
  let hints: string[] = [];

  let trackedDirtyAfterLanding: boolean | undefined;
  try {
    trackedDirtyAfterLanding = await hasUncommittedTrackedChanges(mainRepo);
  } catch {
    // discern-best-effort: accept-post-landing-dirty-baseline-fallback
    trackedDirtyAfterLanding = undefined;
  }

  log.info("Materializing local agent artifacts in the landing checkout…");
  const templatesDir = await postLandingLocalTemplatesDir(
    effort.path,
    mainRepo,
  );
  let refresh;
  try {
    const refreshed = templatesDir === undefined
      ? await materializeLocalRefreshArtifacts(mainRepo, log)
      : await materializeLocalRefreshArtifacts(mainRepo, log, templatesDir);
    refresh = instructionRefreshRun(refreshed, mainRepo);
  } catch (error) {
    refresh = failedRefreshRun(
      [error instanceof Error ? error.message : String(error)],
      mainRepo,
    );
    log.warn(
      "Local Agent artifact materialization reported an error — continuing.",
    );
  }
  hints = mergeHintTexts(hints, refresh.hints);
  diagnostics.push(...refresh.diagnostics);
  results.push({
    step: {
      kind: "refresh",
      label: BUILT_IN_STEP_LABELS.materializeLocalAgentArtifacts,
      disposition: "run",
      note:
        "materialized only the trunk checkout's local/ignored agent artifacts",
    },
    outcome: refresh.ok ? "ok" : "failed",
  });
  if (!refresh.ok) {
    hints = mergeHintTexts(
      hints,
      hintTexts([fire(HINTS["accept-refresh-failed"], { trunk, mainRepo })]),
    );
  }

  let landingConfig = effort.ctx.config;
  try {
    landingConfig = await loadConfig(mainRepo);
  } catch {
    log.warn(
      "Could not reload the landed config in the main checkout — using the validated worktree config for convergence.",
    );
  }

  const ensured = await runEnsureCommands(
    effort.ctx,
    plan.repositoryEnsureSteps,
    {
      fatal: false,
      cwd: mainRepo,
      scope: "repository",
      ...(signal === undefined ? {} : { signal }),
    },
  );
  for (const [index, command] of plan.repositoryEnsureSteps.entries()) {
    results.push({
      step: {
        kind: "repository-ensure",
        label: verbatimStepLabel(command),
        disposition: "run",
        note: "converge the trunk checkout on the landed tree",
      },
      outcome: ensured.outcomes[index] ?? "failed",
    });
  }
  diagnostics.push(...ensured.diagnostics);
  hints = mergeHintTexts(hints, ensured.hints);

  if (plan.smokeSteps.length > 0) {
    const group: JobGroup = {
      stage: "test",
      mode: "parallel",
      heading: "Proving the landing checkout is ready...",
      display: "Smoke",
      jobs: plan.smokeSteps.map((job) => ({
        label: job.label,
        command: job.command,
        kind: "known",
        reportStage: "test",
        willRun: true,
        ...(job.timeout !== undefined ? { timeout: job.timeout } : {}),
      })),
    };
    try {
      log.info("Running the smoke job in the landing checkout...");
      const run = gateRunContext(
        mainRepo,
        landingConfig,
        resolveGateRunPolicy(landingConfig.gate.stream, {
          kind: "quiet-result",
        }),
        signal,
      );
      const tested = await runJobGroups(
        [group],
        run.runOpts,
        run.runOut,
        run.slots,
      );
      const smoke = await serializeJobSteps(mainRepo, [group], tested.results);
      results.push(...smoke.steps);
      diagnostics.push(...smoke.diagnostics);
      hints = mergeHintTexts(hints, hintTexts(smoke.hints));
      if (tested.failedStage === null) log.ok("Landing-checkout smoke passed.");
      else log.warn("Landing-checkout smoke failed — the landing is kept.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const smoke of plan.smokeSteps) {
        results.push({
          step: {
            kind: "job",
            label: verbatimStepLabel(smoke.label),
            disposition: "run",
            note: smoke.command,
            group: "Smoke",
          },
          outcome: "failed",
        });
        diagnostics.push({
          tool: smoke.label,
          severity: "error",
          message:
            `Landing-checkout smoke could not run in ${mainRepo}: ${reason}. Fix the command or its prerequisites, then run it again from that checkout.`,
          reproduce_cmd: smoke.command,
        });
      }
      log.warn("Landing-checkout smoke could not complete — continuing.");
    }
  }

  let checkoutClean: boolean | undefined;
  if (trackedDirtyAfterLanding === true) {
    checkoutClean = false;
  } else if (trackedDirtyAfterLanding === false) {
    try {
      checkoutClean = !(await hasUncommittedTrackedChanges(mainRepo) ?? true);
    } catch {
      // discern-best-effort: accept-post-convergence-clean-check-fallback
      checkoutClean = false;
    }
  }
  results.push({
    step: {
      kind: "checkout-clean-check",
      label: BUILT_IN_STEP_LABELS.checkTrunkCheckout,
      disposition: "run",
      note: checkoutClean === undefined
        ? "the immediate post-fast-forward tracked baseline was unavailable"
        : trackedDirtyAfterLanding === true
        ? "tracked changes existed immediately after the fast-forward checkout"
        : "report tracked files changed by post-landing convergence",
    },
    outcome: checkoutClean === true ? "ok" : "failed",
    ...(checkoutClean === undefined
      ? {
        advisory: {
          kind: "checkout-clean-observation-unavailable" as const,
          evidence: [
            "Git could not establish the tracked checkout baseline after the trunk fast-forward.",
          ],
          next_action:
            `Run \`git status --short\` in ${mainRepo} before relying on post-landing checkout convergence.`,
        },
      }
      : {}),
  });
  if (checkoutClean === false) {
    hints = mergeHintTexts(
      hints,
      hintTexts([
        fire(HINTS["accept-convergence-changed-tracked"], { trunk, mainRepo }),
      ]),
    );
    log.warn(
      "Post-landing convergence changed tracked files in the trunk checkout — review git status after cleanup.",
    );
  }
  if (diagnostics.length > 0 && !hasRegisteredActionableHint(hints)) {
    hints = mergeHintTexts(
      hints,
      hintTexts([fire(HINTS["lifecycle-convergence-failed"])]),
    );
  }
  progress.convergenceHints.push(...hints);
}
