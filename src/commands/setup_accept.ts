/**
 * `discern setup accept` — land the finished setup onto the integration branch.
 *
 * A fresh `discern setup begin` isolates its several commits on a dedicated `discern-setup`
 * branch (ADR 0065), so after `setup done` discern exists on that branch but NOT
 * on `main`. A novice who restarts and switches to `main` can appear to "lose" discern
 * entirely. This command closes that gap deterministically: it fast-forwards the
 * integration branch to the proved setup commit, or proves a setup-side merge first
 * when the integration branch moved. It then deletes the contained setup branch,
 * leaving the user on `main` with discern in place. It lands
 * ONLY that dedicated branch: run from any other branch it refuses, because the
 * merge takes whatever the current branch contains and an ordinary branch's own
 * commits would be swept onto the trunk with no review.
 *
 * It is the main-checkout counterpart to `discern accept` (which lands a linked
 * WORKTREE's branch): same Proof validation, tracked-refresh boundary, exact commit
 * transition, durable Proof note, and checkout convergence, without resource or
 * worktree teardown.
 * Choosing instead to leave the branch for review, or to discard it, is simply not
 * running this command; `setup done` spells out all three options.
 */

import { join } from "@std/path";
import {
  type DiscernConfig,
  loadConfig,
  resolveConfiguredAgents,
} from "../shared/config_schema.ts";
import {
  type CommandRef,
  discernCommand,
} from "../shared/command_reference.ts";
import { findRoot, NO_PROJECT_MESSAGE } from "../shared/env.ts";
import { emitResult } from "../shared/emit.ts";
import { Logger } from "../lib/log.ts";
import { discernMergeArgs, runGit } from "../shared/subprocess.ts";
import { SETUP_BRANCH } from "../shared/setup_state.ts";
import {
  type Diagnostic,
  type ErrorSlug,
  renderHumanOutputGroups,
} from "../shared/result.ts";
import {
  fastForwardCheckedOutBranch,
  integrationBranch,
} from "../engine/worktree/git.ts";
import { deleteAutomaticallyOwnedBranch } from "../engine/worktree/ownership.ts";
import { finishResult } from "../engine/gate/finish.ts";
import { clearGateProof, inspectGateProof } from "../engine/gate/proof.ts";
import {
  proofNotesFetchSucceeded,
  reconcileProofNotesFetch,
  writeProofNote,
} from "../engine/gate/proof_notes.ts";
import {
  instructionRefreshErrors,
  materializeLocalRefreshArtifacts,
} from "../engine/instructions.ts";
import { planTrackedRefresh } from "../engine/tracked_refresh.ts";
import { trunkManagedVersionBoundary } from "../engine/managed_version.ts";
import { plainModeEnabled } from "../lib/terminal_interaction.ts";
import type { CliModelProvider } from "../shared/cli_reference_codegen.ts";
import type {
  GateProofCheckData,
  Proof,
  SetupAcceptData,
  SetupAcceptNoOpData,
} from "../shared/result_schemas.ts";
import {
  plannedFilesystemWrites,
  plannedGitMutationWrites,
  preflightSetupEffects,
  setupEffectPlan,
  type SetupRequiredEffect,
  setupRequiredEffect,
} from "../shared/setup_effects.ts";
import {
  writePreflightDiagnostic,
  writePreflightFailureMessage,
} from "../shared/write_preflight.ts";
import {
  reactivationHandoff,
  writtenProviderArtifactPathsForAgents,
} from "../lib/providers.ts";
import { fire, HINTS, hintTexts } from "../shared/hints.ts";
import {
  assertSetupHumanSurfaceConsumption,
  type SetupHumanMoment,
  setupHumanMomentsForSurface,
} from "../shared/setup_experience.ts";

/** Resolve the activation handoff consumed after setup acceptance. */
function setupAcceptanceActivationMoment(): SetupHumanMoment {
  const moment = setupHumanMomentsForSurface("setup-accept").find(
    (candidate) => candidate.id === "activation-handoff",
  );
  if (moment === undefined) {
    throw new Error("Setup acceptance activation moment is not configured.");
  }
  return moment;
}
const ACTIVATION_MOMENT = setupAcceptanceActivationMoment();
assertSetupHumanSurfaceConsumption("setup-accept", [ACTIVATION_MOMENT.id]);

/** Options for `discern setup accept` (global flags + preview). */
export interface SetupAcceptOptions {
  json: boolean;
  noColor: boolean;
  dryRun: boolean;
  /** Fully attached live command tree supplied by the binary entry point. */
  cliModel: CliModelProvider;
}

/** The exact command a user runs to land their setup — the one string `setup done`
 * and any instructions quote, so the verb name lives in one place. */
export const ACCEPT_COMMAND = "discern setup accept";

/** The same command as a typed reference, derived from the one string above,
 * for the registered hints that carry it across delivery surfaces. */
export const ACCEPT_COMMAND_REF: CommandRef = discernCommand(
  ACCEPT_COMMAND.replace(/^discern /, ""),
);

/** A light, read-only account of where finished setup work lives and how to land it —
 * what `setup done` reports without running the merge. */
export interface LandingSummary {
  /** True when the project is inside a git work tree (a branch exists to land). */
  inRepo: boolean;
  /** The current branch, or "" when detached / not in a repo. */
  branch: string;
  /** The integration branch the work lands onto. */
  target: string;
  /** True when the work already lives on the integration branch (nothing to land). */
  onTarget: boolean;
  /**
   * True when the current branch is the dedicated `discern-setup` branch — the ONLY
   * branch `setup accept` lands. Computed here, once, so every surface that recommends
   * landing (`setup done`'s hints, its "What's next" step, the relay message) keys
   * off the same predicate the land command itself enforces: an in-place
   * (`--allow-dirty`) setup on the user's own branch is steered to a manual merge,
   * never to a command that would sweep that branch's own commits onto the trunk.
   */
  onSetupBranch: boolean;
}

/** Resolve where the just-finished setup lives relative to the integration branch —
 * read-only, for `setup done`'s "where your work is + how to land it" report. */
export async function landingSummary(
  root: string,
  config: DiscernConfig,
): Promise<LandingSummary> {
  const target = integrationBranch(config.repository.trunk);
  const inRepo =
    (await runGit(["rev-parse", "--is-inside-work-tree"], { cwd: root }))
      .success;
  if (!inRepo) {
    return {
      inRepo: false,
      branch: "",
      target,
      onTarget: false,
      onSetupBranch: false,
    };
  }
  const branch = (await runGit(["branch", "--show-current"], { cwd: root }))
    .stdout.trim();
  return {
    inRepo: true,
    branch,
    target,
    onTarget: branch === target,
    onSetupBranch: branch === SETUP_BRANCH,
  };
}

/** The complete current Proof setup acceptance may land. */
interface CurrentSetupProof {
  inspection: GateProofCheckData;
  head: string;
  data: Proof;
  line: string;
}

/** The one recovery served for every incomplete or non-current setup Proof. */
const PROOF_RECOVERY =
  "Return to the setup branch, make it clean, run `discern setup done`, then retry `discern setup accept`.";

/** Narrow a canonical inspection to the complete Proof setup acceptance needs. */
function currentSetupProof(
  inspection: GateProofCheckData,
): CurrentSetupProof | undefined {
  if (
    inspection.status !== "honored" || inspection.head === undefined ||
    inspection.proof_data === undefined || inspection.proof_line === undefined
  ) {
    return undefined;
  }
  return {
    inspection,
    head: inspection.head,
    data: inspection.proof_data,
    line: inspection.proof_line,
  };
}

/** The common payload fields for preview, refusal, and apply. */
function setupAcceptData(
  branch: string,
  target: string,
  fastForward: boolean,
  proof: GateProofCheckData,
  fields: Partial<SetupAcceptData> = {},
): SetupAcceptData {
  return {
    next_action: ACCEPT_COMMAND,
    landed: false,
    branch,
    target,
    fast_forward: fastForward,
    branch_deleted: false,
    proof,
    merge_validated: false,
    local_artifacts_converged: false,
    ...fields,
  };
}

/** Emit a landing refusal/no-op (human + `--json`) and return its exit code. */
function emitAccept(
  opts: SetupAcceptOptions,
  log: Logger,
  result:
    & {
      message: string;
      detail?: string[];
      diagnostics?: Diagnostic[];
      data?: SetupAcceptData | SetupAcceptNoOpData | { next_action: string };
      code: number;
    }
    & (
      | { ok: true; error?: never }
      | { ok: false; error?: ErrorSlug }
    ),
): number {
  if (opts.json) {
    const fields = {
      verb: "setup accept",
      message: result.message,
      ...(result.diagnostics === undefined
        ? {}
        : { diagnostics: result.diagnostics }),
      ...(result.data === undefined ? {} : { data: result.data }),
    };
    emitResult(
      result.ok ? { ok: true, ...fields } : {
        ok: false,
        ...(result.error === undefined ? {} : { error: result.error }),
        ...fields,
      },
    );
  } else {
    if (result.ok) {
      log.ok(result.message);
    } else {
      log.error(result.message);
    }
    for (const d of result.detail ?? []) {
      log.detail(d);
    }
    for (const diagnostic of result.diagnostics ?? []) {
      log.detail(diagnostic.message);
      log.detail(`Retry: ${diagnostic.reproduce_cmd}`);
    }
  }
  return result.code;
}

/** Refuse a missing, stale, dirty, unreadable, or incomplete setup Proof. */
function emitProofRefusal(
  opts: SetupAcceptOptions,
  log: Logger,
  config: DiscernConfig,
  branch: string,
  target: string,
  fastForward: boolean,
  proof: GateProofCheckData,
): number {
  const markerReason = config.meta.bootstrapped
    ? undefined
    : "the setup branch does not record [meta].bootstrapped = true";
  const proofReason = proof.status === "honored"
    ? "the current gate Proof does not contain its structured Proof and relay line"
    : proof.reason === undefined
    ? `the current gate Proof is ${proof.status}`
    : `the current gate Proof is ${proof.status}: ${proof.reason}`;
  const reason = markerReason ?? proofReason;
  return emitAccept(opts, log, {
    ok: false,
    error: proof.status === "dirty" ? "dirty_worktree" : "precondition_failed",
    message: `Setup acceptance refused because ${reason}. ${PROOF_RECOVERY}`,
    detail: [
      `Proof status: ${proof.status}`,
      ...(proof.recorded === undefined
        ? []
        : [`Recorded commit: ${proof.recorded}`]),
      ...(proof.head === undefined ? [] : [`Current commit: ${proof.head}`]),
    ],
    data: setupAcceptData(branch, target, fastForward, proof, {
      next_action: "discern setup done",
    }),
    code: 1,
  });
}

/**
 * Validate and land the dedicated setup branch. The plan is computed from current
 * refs and canonical Gate Proof before any effect. A moved target is merged into the
 * setup branch and the resulting commit earns a new Proof before the target moves.
 */
export async function runSetupAccept(
  opts: SetupAcceptOptions,
): Promise<number> {
  const log = new Logger({ json: opts.json, noColor: opts.noColor });
  const root = await findRoot();
  if (root === undefined) {
    return emitAccept(opts, log, {
      ok: false,
      error: "not_initialized",
      message: NO_PROJECT_MESSAGE,
      data: { next_action: "discern setup verify" },
      code: 1,
    });
  }
  let config: DiscernConfig;
  try {
    config = await loadConfig(root);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return emitAccept(opts, log, {
      ok: false,
      error: "invalid_config",
      message:
        `Setup acceptance cannot read discern.toml: ${detail}. Run \`discern doctor\` for the exact correction before retrying.`,
      data: { next_action: "discern doctor" },
      code: 1,
    });
  }
  const target = integrationBranch(config.repository.trunk);
  const run = (args: string[]) => runGit(args, { cwd: root });

  if (config.meta.setup_completion === "unproven") {
    return emitAccept(opts, log, {
      ok: false,
      error: "precondition_failed",
      message:
        `Setup completion is recorded as unproven, so it cannot be accepted. ${PROOF_RECOVERY}`,
      data: { next_action: "discern setup done" },
      code: 1,
    });
  }

  // Outside a Git repository there is no branch to land.
  if (!(await run(["rev-parse", "--is-inside-work-tree"])).success) {
    return emitAccept(opts, log, {
      ok: false,
      error: "no_repository",
      message:
        "Setup acceptance requires one Git repository. Run `git init`, then run `discern setup verify` to restart the repository-backed journey.",
      data: {
        next_action: "git init",
      },
      code: 1,
    });
  }

  const branch = (await run(["branch", "--show-current"])).stdout.trim();
  if (branch === "") {
    return emitAccept(opts, log, {
      ok: false,
      error: "detached_head",
      message:
        `The checkout has a detached HEAD. Check out ${SETUP_BRANCH}, then retry ${ACCEPT_COMMAND}.`,
      data: { next_action: `git checkout ${SETUP_BRANCH}` },
      code: 1,
    });
  }
  if (branch === target) {
    return emitAccept(opts, log, {
      ok: true,
      message:
        `The checkout is already on ${target}; there is no setup branch to land.`,
      data: {
        next_action: "discern status",
        completion: {
          status: "no_op",
          reason: "already_on_target",
        },
        target,
      },
      code: 0,
    });
  }
  // Land ONLY the dedicated setup branch. This command fast-forwards (or merges)
  // the CURRENT branch onto the integration branch — run from an ordinary branch
  // it would sweep that branch's own commits onto the trunk with no review.
  if (branch !== SETUP_BRANCH) {
    return emitAccept(opts, log, {
      ok: false,
      error: "not_on_setup_branch",
      message:
        `You are on \`${branch}\`, not the \`${SETUP_BRANCH}\` branch this command lands. ` +
        `Landing here would sweep \`${branch}\`'s own commits onto \`${target}\`. ` +
        `If your finished setup lives on \`${SETUP_BRANCH}\`, check it out and re-run \`${ACCEPT_COMMAND}\`. ` +
        `If you set up on \`${branch}\` deliberately (--allow-dirty), merge it your usual way ` +
        `(\`git checkout ${target} && git merge ${branch}\`) when you're ready.`,
      data: { next_action: `git checkout ${SETUP_BRANCH}` },
      code: 1,
    });
  }
  if (!(await run(["rev-parse", "--verify", "--quiet", target])).success) {
    // The common shape of this: a brand-new repository whose first commits were
    // born on the setup branch, so the integration branch never came into being.
    // Serve the exact creation-then-land step in the message itself, so it rides
    // both surfaces identically, rather than dead-ending.
    return emitAccept(opts, log, {
      ok: false,
      error: "no_target",
      message:
        `The trunk branch \`${target}\` does not exist in this repository. In a ` +
        `brand-new repository the first commits are born on \`${branch}\`, so there is no ` +
        `\`${target}\` to land onto. Create it at your setup's tip, then land: ` +
        `\`git branch ${target} && ${ACCEPT_COMMAND}\`. ` +
        `(If this project updates on a different branch, set [repository].trunk to it instead.)`,
      data: { next_action: `git branch ${target}` },
      code: 1,
    });
  }

  const targetTipRun = await run([
    "rev-parse",
    "--verify",
    `refs/heads/${target}^{commit}`,
  ]);
  const branchTipRun = await run([
    "rev-parse",
    "--verify",
    `refs/heads/${branch}^{commit}`,
  ]);
  const targetTip = targetTipRun.stdout.trim();
  const branchTip = branchTipRun.stdout.trim();
  if (
    !targetTipRun.success || !branchTipRun.success || targetTip === "" ||
    branchTip === ""
  ) {
    return emitAccept(opts, log, {
      ok: false,
      error: "precondition_failed",
      message:
        `Git could not resolve the setup and target commits. Nothing changed. Retry ${ACCEPT_COMMAND}.`,
      data: { next_action: ACCEPT_COMMAND },
      code: 1,
    });
  }

  // This plan fact is read before Proof validation and every mutation.
  const fastForward =
    (await run(["merge-base", "--is-ancestor", targetTip, branchTip])).success;
  const inspected = await inspectGateProof(root);
  let validated = currentSetupProof(inspected);
  if (!config.meta.bootstrapped || validated === undefined) {
    return emitProofRefusal(
      opts,
      log,
      config,
      branch,
      target,
      fastForward,
      inspected,
    );
  }

  // Preview carries the same Proof inspection the apply path will require.
  if (opts.dryRun) {
    const data = setupAcceptData(branch, target, fastForward, inspected, {
      next_action: ACCEPT_COMMAND,
      proof_line: validated.line,
      ...(fastForward ? { validated_commit: validated.head } : {}),
    });
    if (opts.json) {
      emitResult({
        ok: true,
        verb: "setup accept",
        dry_run: true,
        data,
      });
    } else {
      log.line(renderHumanOutputGroups([
        {
          id: "accept-plan",
          items: [
            `Dry run: \`${ACCEPT_COMMAND}\` would:`,
            fastForward
              ? `  • fast-forward ${target} to the proved setup commit`
              : `  • merge ${target} into ${branch} and prove the merge commit`,
            `  • record the landed Proof note`,
            `  • materialize checkout-local agent artifacts`,
            `  • delete the merged ${branch}`,
          ],
        },
        { id: "proof", items: [validated.line] },
        {
          id: "dry-run-verdict",
          items: ["No changes were made (--dry-run)."],
        },
      ]));
    }
    return 0;
  }

  // All required landing writes derive from the effect plan and are proved in
  // this invocation before merge, materialization, checkout, or ref movement.
  const gitWrites = await plannedGitMutationWrites(
    root,
    "setup acceptance",
  );
  const checkoutWrites = await plannedFilesystemWrites(
    root,
    "setup acceptance checkout",
  );
  const materializeWrites = (await Promise.all([
    root,
    ...writtenProviderArtifactPathsForAgents(
      resolveConfiguredAgents(config),
    ).map((path) => join(root, path)),
  ].map((path) =>
    plannedFilesystemWrites(path, "setup acceptance local artifact")
  ))).flat();
  const gitEffect = (
    kind:
      | "accept-merge"
      | "accept-ref-advance"
      | "accept-proof-note"
      | "accept-branch-delete",
  ): SetupRequiredEffect | undefined => {
    const [first, ...rest] = gitWrites;
    return first === undefined
      ? undefined
      : setupRequiredEffect(kind, first, ...rest);
  };
  const effects: SetupRequiredEffect[] = [
    setupRequiredEffect(
      "accept-materialize",
      materializeWrites[0] ?? checkoutWrites[0],
      ...materializeWrites.slice(1),
    ),
    setupRequiredEffect(
      "accept-checkout",
      checkoutWrites[0],
      ...checkoutWrites.slice(1),
      ...gitWrites,
    ),
  ];
  if (!fastForward) {
    const mergeEffect = gitEffect("accept-merge");
    if (mergeEffect !== undefined) effects.push(mergeEffect);
  }
  for (
    const kind of [
      "accept-ref-advance",
      "accept-proof-note",
      "accept-branch-delete",
    ] as const
  ) {
    const effect = gitEffect(kind);
    if (effect !== undefined) effects.push(effect);
  }
  const writeAuthority = await preflightSetupEffects(
    setupEffectPlan("accept", effects),
  );
  if (!writeAuthority.ok) {
    return emitAccept(opts, log, {
      ok: false,
      error: "write_access",
      message: writePreflightFailureMessage(writeAuthority),
      diagnostics: [
        writePreflightDiagnostic(writeAuthority, ACCEPT_COMMAND),
      ],
      data: setupAcceptData(branch, target, fastForward, inspected, {
        next_action: ACCEPT_COMMAND,
        proof_line: validated.line,
      }),
      code: 1,
    });
  }

  let mergeValidated = false;
  if (!fastForward) {
    // Build the merge on the setup branch, keeping the target untouched. Merge the
    // target commit sampled by the plan, then require a fresh canonical Proof for
    // the merge result. The original setup Proof is not reused for a changed tree.
    const merge = await run(discernMergeArgs(branch, targetTip));
    if (!merge.success) {
      await run(["merge", "--abort"]);
      return emitAccept(opts, log, {
        ok: false,
        error: "conflict",
        message:
          `Merging ${target} into ${branch} did not complete. The target branch is unchanged. ` +
          `Resolve the integration on ${branch}, run \`discern setup done\`, then retry \`${ACCEPT_COMMAND}\`.`,
        detail: [merge.stderr.trim()].filter((detail) => detail !== ""),
        data: setupAcceptData(branch, target, false, inspected, {
          next_action: "discern setup done",
          proof_line: validated.line,
        }),
        code: 1,
      });
    }

    const gate = await finishResult(root, {
      cliModel: opts.cliModel,
      surface: opts.json
        ? { kind: "quiet" }
        : { kind: "human", plain: plainModeEnabled() },
    });
    if (!gate.ok) {
      const failedProof = await inspectGateProof(root);
      return emitAccept(opts, log, {
        ok: false,
        error: "gate_failed",
        message:
          `The merged setup commit did not pass the gate. ${target} is unchanged. ${PROOF_RECOVERY}`,
        data: setupAcceptData(branch, target, false, failedProof, {
          next_action: "discern setup done",
        }),
        code: 1,
      });
    }
    const mergedInspection = await inspectGateProof(root);
    const mergedProof = currentSetupProof(mergedInspection);
    if (mergedProof === undefined) {
      return emitProofRefusal(
        opts,
        log,
        config,
        branch,
        target,
        false,
        mergedInspection,
      );
    }
    validated = mergedProof;
    mergeValidated = true;
  }

  // A Proof records the Gate implementation that wrote it. Re-plan the current
  // tracked refresh authority at the landing boundary so an older Proof cannot
  // bypass a newer convergence requirement.
  const landingConfig = await loadConfig(root);
  if (!landingConfig.meta.bootstrapped) {
    return emitProofRefusal(
      opts,
      log,
      landingConfig,
      branch,
      target,
      fastForward,
      validated.inspection,
    );
  }
  const trackedRefresh = await planTrackedRefresh(root, landingConfig);
  const adoptionRefusal = trackedRefresh.unavailable ??
    await trunkManagedVersionBoundary(
      root,
      landingConfig,
    );
  if (adoptionRefusal !== undefined) {
    return emitAccept(opts, log, {
      ok: false,
      error: "precondition_failed",
      message: adoptionRefusal,
      data: {
        ...setupAcceptData(branch, target, fastForward, validated.inspection),
        next_action: trackedRefresh.unavailable === undefined
          ? "discern upgrade --dry-run"
          : "discern releases",
      },
      code: 1,
    });
  }
  if (
    trackedRefresh.unavailable === undefined &&
    (trackedRefresh.changes.length > 0 || trackedRefresh.errors.length > 0)
  ) {
    const pending = trackedRefresh.changes.map((change) => change.path);
    return emitAccept(opts, log, {
      ok: false,
      error: "precondition_failed",
      message:
        `Tracked refresh work remains on the proved setup tree. ${target} is unchanged. Run \`discern refresh\`, commit the result, run \`discern setup done\`, then retry \`${ACCEPT_COMMAND}\`.`,
      detail: [...pending, ...trackedRefresh.errors],
      data: setupAcceptData(
        branch,
        target,
        fastForward,
        validated.inspection,
        {
          next_action: "discern refresh",
          proof_line: validated.line,
          validated_commit: validated.head,
          merge_validated: mergeValidated,
          tracked_refresh_pending: pending,
          tracked_refresh_errors: [...trackedRefresh.errors],
        },
      ),
      code: 1,
    });
  }

  // Converge ignored checkout-local artifacts before the target moves. The final
  // tracked tree already passed the Gate; this writer cannot change tracked files.
  const localRefresh = await materializeLocalRefreshArtifacts(root, log);
  const localErrors = instructionRefreshErrors(localRefresh);
  if (localErrors.length > 0) {
    return emitAccept(opts, log, {
      ok: false,
      error: "partial_materialization",
      message:
        `Checkout-local agent artifacts could not be materialized. ${target} is unchanged. Fix the reported errors, then retry \`${ACCEPT_COMMAND}\`.`,
      detail: localErrors,
      data: setupAcceptData(
        branch,
        target,
        fastForward,
        validated.inspection,
        {
          next_action: "discern refresh",
          proof_line: validated.line,
          validated_commit: validated.head,
          merge_validated: mergeValidated,
          local_artifact_errors: localErrors,
        },
      ),
      code: 1,
    });
  }

  // Close the validation-to-landing window while the setup branch is still checked
  // out. Ref movement cannot substitute a different commit for the proved one.
  const setupNow = await run([
    "rev-parse",
    "--verify",
    `refs/heads/${branch}^{commit}`,
  ]);
  const targetNow = await run([
    "rev-parse",
    "--verify",
    `refs/heads/${target}^{commit}`,
  ]);
  if (
    setupNow.stdout.trim() !== validated.head ||
    targetNow.stdout.trim() !== targetTip
  ) {
    return emitAccept(opts, log, {
      ok: false,
      error: "precondition_failed",
      message:
        `The setup or target branch moved after validation. Nothing was landed. ${PROOF_RECOVERY}`,
      data: setupAcceptData(
        branch,
        target,
        fastForward,
        validated.inspection,
        {
          next_action: "discern setup done",
          proof_line: validated.line,
          validated_commit: validated.head,
          merge_validated: mergeValidated,
          local_artifacts_converged: true,
        },
      ),
      code: 1,
    });
  }

  const checkout = await run(["checkout", "--quiet", target]);
  if (!checkout.success) {
    return emitAccept(opts, log, {
      ok: false,
      error: "checkout_failed",
      message:
        `Git could not check out ${target}. Your proved work remains on ${branch}.`,
      detail: [checkout.stderr.trim()],
      data: setupAcceptData(
        branch,
        target,
        fastForward,
        validated.inspection,
        {
          next_action: ACCEPT_COMMAND,
          proof_line: validated.line,
          validated_commit: validated.head,
          merge_validated: mergeValidated,
          local_artifacts_converged: true,
        },
      ),
      code: 1,
    });
  }

  const transition = await fastForwardCheckedOutBranch(
    root,
    target,
    targetTip,
    validated.head,
  );
  if (transition.kind !== "updated") {
    const partiallyLanded = transition.kind === "checkout-failed" &&
      !transition.rolledBack;
    if (!partiallyLanded) {
      await run(["checkout", "--quiet", branch]);
    }
    return emitAccept(opts, log, {
      ok: false,
      error: partiallyLanded ? "partial_acceptance" : "apply_failed",
      message: partiallyLanded
        ? `${target} advanced to the proved commit, but its checked-out files could not be converged or rolled back. Stop and inspect the checkout before continuing.`
        : `The exact-commit landing was refused because the checkout or ${target} moved. Nothing was landed. ${PROOF_RECOVERY}`,
      detail: [transition.detail],
      data: setupAcceptData(
        branch,
        target,
        fastForward,
        validated.inspection,
        {
          next_action: partiallyLanded ? "git status --short" : ACCEPT_COMMAND,
          landed: partiallyLanded,
          proof_line: validated.line,
          validated_commit: validated.head,
          merge_validated: mergeValidated,
          local_artifacts_converged: true,
        },
      ),
      code: 1,
    });
  }

  // The target now names the validated commit. Durable Proof recording follows the
  // normal acceptance rule and is fail-open after this boundary.
  const proofFetch = await reconcileProofNotesFetch(
    root,
    landingConfig.repository.proof_notes,
  );
  const proofWrite = await writeProofNote(
    root,
    validated.head,
    validated.data,
  );
  const proofNote = { fetch: proofFetch, write: proofWrite };

  // This checkout survives setup acceptance, unlike an ordinary accepted
  // worktree. Retire its worktree-local cache after the durable note is written.
  const cleared = await clearGateProof(root);
  const proofCleared = cleared.status === "cleared";

  // The setup branch is fully contained in the target branch. Retire only the
  // exact dedicated ref at the commit the accepted Proof identified; a moved
  // or unexpectedly checked-out branch remains visible instead.
  const branchDeletion = await deleteAutomaticallyOwnedBranch({
    repoRoot: root,
    branch,
    expectedCommit: validated.head,
    ownership: { kind: "setup", branch },
    mergedInto: target,
  });
  const branchDeleted = branchDeletion.kind !== "refused";
  const reactivation = reactivationHandoff(landingConfig);
  const postLandingHints = hintTexts([
    ...(reactivation.per_agent.length > 0
      ? [fire(HINTS["setup-reactivate-tools"])]
      : []),
    fire(HINTS["setup-improvement-after-activation"]),
  ]);

  const data: SetupAcceptData = {
    next_action: "discern status",
    landed: true,
    branch,
    target,
    fast_forward: fastForward,
    branch_deleted: branchDeleted,
    proof: validated.inspection,
    proof_line: validated.line,
    validated_commit: validated.head,
    merge_validated: mergeValidated,
    proof_note: proofNote,
    local_artifacts_converged: true,
    proof_cleared: proofCleared,
    reactivation,
    optional_improvement: {
      command: "discern improvement --json",
      after: "activation_verified",
    },
    ...(reactivation.per_agent.length === 0
      ? {}
      : { activation_context: ACTIVATION_MOMENT.why }),
    ...(proofCleared || cleared.reason === undefined
      ? {}
      : { proof_clear_error: cleared.reason }),
  };
  if (opts.json) {
    emitResult({
      ok: true,
      verb: "setup accept",
      message: `Setup landed onto ${target}.`,
      hints: postLandingHints,
      data,
    });
    return 0;
  }
  log.ok(
    fastForward
      ? `Setup landed. ${target} now names the proved setup commit.`
      : `Setup landed. ${target} now names the separately proved merge commit.`,
  );
  log.line(validated.line);
  log.info(`You are now on ${target} with discern set up.`);
  if (branchDeleted) {
    log.info(`Deleted the merged ${branch} branch.`);
  } else {
    const reason = branchDeletion.kind === "refused"
      ? `: ${branchDeletion.reason}`
      : "";
    log.info(
      `Left the ${branch} branch in place${reason}. It is fully merged; ` +
        `delete it with \`git branch -d ${branch}\` when ready.`,
    );
  }
  if (!proofNotesFetchSucceeded(proofFetch)) {
    log.warn(
      `Proof note fetch configuration did not converge: ${
        proofFetch.errors.join("; ")
      }`,
    );
  }
  if (
    proofWrite.status !== "recorded" &&
    proofWrite.status !== "already_present"
  ) {
    log.warn(
      `The landing Proof note was not recorded: ${
        proofWrite.reason ?? proofWrite.status
      }`,
    );
  }
  if (!proofCleared) {
    log.warn(
      `The setup checkout's gate Proof cache could not be cleared: ${
        cleared.reason ?? cleared.status
      }`,
    );
  }
  if (reactivation.per_agent.length === 0) {
    log.info("No configured provider needs a fresh-session activation step.");
  } else {
    log.info(ACTIVATION_MOMENT.why);
    log.line("Activate discern from a fresh provider session:");
    for (const agent of reactivation.per_agent) {
      log.line(`  • ${agent.label}: ${agent.step}`);
    }
  }
  log.info(
    "Only after every applicable activation check succeeds, optionally run `discern improvement --json` for an owner review.",
  );
  return 0;
}
