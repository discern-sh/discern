/**
 * `discern standards propose` — the effectful shell around the pure proposed
 * Standard limit plans. On a final clean HEAD, the command measures only its
 * named Standard, then either makes one config-only proposal commit or renews an
 * unchanged proposal's descendant binding without changing Git history. The
 * proposal record is atomic worktree-local Git administration state. A recovery
 * journal bridges the initial transaction's only multi-write gap: commit made,
 * proposal record not yet finalized.
 */

import { dirname, isAbsolute, join } from "@std/path";
import { z } from "@zod/zod";
import { type DiscernConfig, loadConfig } from "../../shared/config_schema.ts";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES,
} from "../../shared/discern_commit.ts";
import { emitResult } from "../../shared/emit.ts";
import { CONFIG_REL, installedConfigRel } from "../../shared/env.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";
import type {
  Diagnostic,
  DiscernResult,
  EnginePlan,
  StepResult,
} from "../../shared/result.ts";
import { previewResult, verbatimStepLabel } from "../../shared/result.ts";
import {
  type StandardLimitProposalData,
  StandardLimitProposalSchema,
  type StandardsData,
} from "../../shared/result_schemas.ts";
import { observeResult } from "../../shared/result_capture.ts";
import { decodeJson } from "../../shared/runtime_decode.ts";
import { runGit } from "../../shared/subprocess.ts";
import {
  preflightPlannedWrites,
  writePreflightDiagnostic,
  type WritePreflightFailure,
  writePreflightFailureMessage,
} from "../../shared/write_preflight.ts";
import { TomlEditor } from "../../lib/toml_edit.ts";
import { writeDiscernToml } from "../../lib/tidy_format.ts";
import { colorEnabled, makeOut, outSink } from "../output.ts";
import {
  inspectOnDiskJsonVersion,
  newerOnDiskFormatMessage,
  ON_DISK_FORMATS,
} from "../../shared/on_disk_formats.ts";
import { collectPaths } from "../scopes/scopes.ts";
import { integrationBranch } from "../worktree/git.ts";
import {
  buildStandardLimitProposalPlan,
  buildStandardLimitProposalRebindPlan,
  type StandardLimitProposalPlan,
  type StandardLimitProposalRefusal,
} from "./standard_proposal_plan.ts";
import { validateStandardLimitReason } from "../../shared/standard_limit_reason.ts";
import { buildStandardPlan, type PlannedStandard } from "./standard_plan.ts";
import { measureStandardEvidence } from "./standards.ts";
import {
  readTrunkConfig,
  standardDefinitionFingerprint,
} from "./standard_limits.ts";
import {
  type AdminStateWriteAuthority,
  clearGateProof,
  isWorktreeFullyClean,
  preflightAdminStateWrites,
} from "./proof.ts";
import { renderPlan, renderStepResults } from "../../shared/result.ts";
import {
  inspectActiveStandardLimitProposals,
  PROPOSAL_STORE_VERSION,
  proposalCommitShape,
  readProposalStore,
  type StandardLimitProposalStore,
} from "./standard_proposal_state.ts";
export {
  type ActiveStandardLimitProposals,
  cloneStandardLimitProposal,
  inspectActiveStandardLimitProposals,
  sameStandardLimitProposalSet,
  staleProposalDiagnostic,
  standardLimitProposalIdentity,
} from "./standard_proposal_state.ts";

const PROPOSAL_TRANSACTION_VERSION =
  ON_DISK_FORMATS.standardLimitProposalTransaction.version;

const StandardLimitProposalTransactionSchema = z.strictObject({
  version: z.literal(PROPOSAL_TRANSACTION_VERSION),
  branch: z.string().min(1),
  source_commit: z.string().min(1),
  config_path: z.string().min(1),
  proposal: StandardLimitProposalSchema.omit({
    commit: true,
    bound_commit: true,
  }),
});
type StandardLimitProposalTransaction = z.infer<
  typeof StandardLimitProposalTransactionSchema
>;

/** Proposal write authority, branded so executor calls cannot mix worktrees. */
declare const PROPOSAL_WRITE_AUTHORITY: unique symbol;
interface StandardProposalWriteAuthority {
  readonly root: string;
  readonly configRel: string;
  readonly configPath: string;
  readonly admin: AdminStateWriteAuthority;
  readonly proposalPath: string;
  readonly transactionPath: string;
  readonly [PROPOSAL_WRITE_AUTHORITY]: true;
}

type StandardProposalWritePreflight =
  | { readonly ok: true; readonly authority: StandardProposalWriteAuthority }
  | WritePreflightFailure;

/** Render an unknown caught value without throwing again. */
function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Git-reported paths may be absolute or relative to the project root. */
function absoluteFromRoot(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path);
}

/** Probe config, Git lockfile, and all proposal/evidence admin targets before
 * the transaction makes its first durable write. */
async function preflightProposalWrites(
  root: string,
): Promise<StandardProposalWritePreflight> {
  const admin = await preflightAdminStateWrites(root);
  if (!admin.ok) {
    return admin;
  }
  const proposalPath = admin.authority.paths.standardLimitProposals;
  const transactionPath =
    admin.authority.paths.standardLimitProposalTransaction;
  if (proposalPath === undefined || transactionPath === undefined) {
    return {
      ok: false,
      path: root,
      description: "the standard proposal transaction state",
      reason: "Git could not resolve its worktree-local proposal paths",
    };
  }
  const configRel = (await installedConfigRel(root)) ?? CONFIG_REL;
  const configPath = join(root, configRel);
  const common = await runGit(["rev-parse", "--git-common-dir"], { cwd: root });
  const commonRaw = common.stdout.trim();
  if (!common.success || commonRaw === "") {
    return {
      ok: false,
      path: root,
      description: "the Git metadata needed to commit the proposed limit",
      reason: common.stderr.trim() ||
        "Git could not resolve its common directory",
    };
  }
  const preflight = await preflightPlannedWrites([
    {
      kind: "existing-file",
      path: configPath,
      description: configRel,
    },
    {
      kind: "directory-entry",
      path: absoluteFromRoot(root, commonRaw),
      description: "the Git metadata needed to commit the proposed limit",
    },
    {
      kind: "directory-entry",
      path: dirname(proposalPath),
      description: "the standard proposal record",
    },
    {
      kind: "directory-entry",
      path: dirname(transactionPath),
      description: "the standard proposal recovery journal",
    },
  ]);
  if (!preflight.ok) {
    return preflight;
  }
  return {
    ok: true,
    authority: {
      root,
      configRel,
      configPath,
      admin: admin.authority,
      proposalPath,
      transactionPath,
    } as StandardProposalWriteAuthority,
  };
}

/** Atomically replace the iterable proposal authority. */
async function writeProposalStore(
  authority: StandardProposalWriteAuthority,
  proposals: readonly StandardLimitProposalData[],
): Promise<void> {
  await atomicReplaceJson(
    authority.proposalPath,
    {
      version: PROPOSAL_STORE_VERSION,
      proposals: [...proposals],
    } satisfies StandardLimitProposalStore,
    { mode: 0o600, sync: true, trailingNewline: true },
  );
}

/** Replace one Standard's record while preserving the iterable set. */
async function persistProposal(
  authority: StandardProposalWriteAuthority,
  proposal: StandardLimitProposalData,
): Promise<void> {
  const read = await readProposalStore(authority.root);
  if (read.status !== "ok") {
    throw new Error(read.reason);
  }
  const proposals = read.store.proposals
    .filter((entry) => entry.standard !== proposal.standard);
  proposals.push(proposal);
  proposals.sort((left, right) => left.standard.localeCompare(right.standard));
  await writeProposalStore(authority, proposals);
}

/** A compact exact-commit query. */
async function gitValue(
  root: string,
  args: string[],
): Promise<string | undefined> {
  const result = await runGit(args, { cwd: root });
  const value = result.stdout.trim();
  return result.success && value !== "" ? value : undefined;
}

/** Read and validate a recovery journal. */
function parseProposalTransaction(
  raw: string,
): StandardLimitProposalTransaction | undefined {
  const version = inspectOnDiskJsonVersion(
    "standardLimitProposalTransaction",
    raw,
  );
  if (version.status === "newer") {
    throw new Error(
      newerOnDiskFormatMessage(
        "standardLimitProposalTransaction",
        version.found,
      ),
    );
  }
  try {
    return decodeJson(
      StandardLimitProposalTransactionSchema,
      raw,
      "Standard limit proposal recovery journal",
    );
  } catch {
    // discern-best-effort: standard-proposal-transaction-decode-fallback
    return undefined;
  }
}

/** Remove a finished recovery journal, tolerating an already-clean retry. */
async function removeTransaction(path: string): Promise<void> {
  try {
    await Deno.remove(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }
}

/** Finish or unwind the exact known partial transaction. */
async function recoverProposalTransaction(
  authority: StandardProposalWriteAuthority,
): Promise<StandardLimitProposalData | undefined> {
  const raw = await readTextIfExists(authority.transactionPath);
  if (raw === undefined) return undefined;
  const transaction = parseProposalTransaction(raw);
  if (transaction === undefined) {
    throw new Error(
      `the standard proposal recovery journal is malformed at ${authority.transactionPath}; no project file was changed`,
    );
  }
  const [head, branch] = await Promise.all([
    gitValue(authority.root, ["rev-parse", "HEAD"]),
    gitValue(authority.root, ["branch", "--show-current"]),
  ]);
  if (head === transaction.source_commit && branch === transaction.branch) {
    // The process stopped before committing. Restore the one scoped file and
    // clear the inert journal so the fresh evidence remains usable on retry.
    const restore = await runGit(
      ["checkout", "HEAD", "--", transaction.config_path],
      { cwd: authority.root },
    );
    if (!restore.success) {
      throw new Error(
        `could not restore ${transaction.config_path} while recovering the proposal transaction: ${restore.stderr.trim()}`,
      );
    }
    await removeTransaction(authority.transactionPath);
    return undefined;
  }
  if (head === undefined || branch !== transaction.branch) {
    throw new Error(
      "the standard proposal transaction no longer belongs to the current branch/HEAD; ordinary enforcement remains active",
    );
  }
  const proposal: StandardLimitProposalData = {
    ...transaction.proposal,
    commit: head,
    bound_commit: head,
  };
  const shape = await proposalCommitShape(
    authority.root,
    proposal,
    transaction.config_path,
  );
  if (shape !== undefined) {
    throw new Error(
      `the interrupted standard proposal cannot be recovered because ${shape}; ordinary enforcement remains active`,
    );
  }
  await persistProposal(authority, proposal);
  await removeTransaction(authority.transactionPath);
  return proposal;
}

/** Restore the scoped config after a proposal apply fails before commit. */
async function restoreProposalEdit(
  root: string,
  configRel: string,
): Promise<boolean> {
  const result = await runGit(["checkout", "HEAD", "--", configRel], {
    cwd: root,
  });
  return result.success;
}

/** Apply exactly the already-planned config commit, leaving the recovery
 * journal standing if final record persistence fails. */
async function applyProposalPlan(
  root: string,
  branch: string,
  plan: StandardLimitProposalPlan,
  authority: StandardProposalWriteAuthority,
): Promise<StandardLimitProposalData> {
  if (
    await gitValue(root, ["rev-parse", "HEAD"]) !==
      plan.proposal.measured_commit || !(await isWorktreeFullyClean(root))
  ) {
    throw new Error(
      "HEAD or the worktree moved after measurement; no proposal write started",
    );
  }
  const transaction: StandardLimitProposalTransaction = {
    version: ON_DISK_FORMATS.standardLimitProposalTransaction.version,
    branch,
    source_commit: plan.proposal.measured_commit,
    config_path: authority.configRel,
    proposal: plan.proposal,
  };
  await atomicReplaceJson(authority.transactionPath, transaction, {
    mode: 0o600,
    sync: true,
    trailingNewline: true,
  });
  let text: string;
  try {
    text = await Deno.readTextFile(authority.configPath);
    const editor = new TomlEditor(text);
    editor.setNumber(
      `standards.${plan.proposal.standard}.limit`,
      plan.proposal.proposed_limit,
    );
    await writeDiscernToml(authority.configPath, editor.toString());
    const add = await runGit(["add", "--", authority.configRel], { cwd: root });
    if (!add.success) {
      throw new Error(
        `could not stage ${authority.configRel}: ${add.stderr.trim()}`,
      );
    }
    const commit = await commitDiscernChanges({
      site: DISCERN_AUTHORED_COMMIT_SITES.standardsLimitProposal,
      values: {
        standard: plan.proposal.standard,
        direction: plan.proposal.direction,
        trunkLimit: plan.proposal.trunk_limit,
        proposedLimit: plan.proposal.proposed_limit,
        measurement: plan.proposal.measurement,
        reason: plan.proposal.reason,
        evidencePaths: plan.proposal.evidence_paths,
      },
      cwd: root,
      pathspecs: [authority.configRel],
    });
    if (!commit.success) {
      throw new Error(
        `could not commit the proposed limit: ${commit.stderr.trim()}`,
      );
    }
  } catch (error) {
    if (await restoreProposalEdit(root, authority.configRel)) {
      await removeTransaction(authority.transactionPath);
    }
    throw error;
  }
  const commit = await gitValue(root, ["rev-parse", "HEAD"]);
  if (commit === undefined) {
    throw new Error(
      "the proposed-limit commit completed, but its object id could not be read; retry the command to recover the proposal record",
    );
  }
  const proposal: StandardLimitProposalData = {
    ...plan.proposal,
    commit,
    bound_commit: commit,
  };
  await persistProposal(authority, proposal);
  await removeTransaction(authority.transactionPath);
  return proposal;
}

/** Project a successfully applied proposal plan into result steps. */
function proposalSteps(plan: EnginePlan): StepResult[] {
  return plan.steps.map((step) => ({ step, outcome: "ok" }));
}

/** Build one successful proposal transaction result. */
function proposalResult(
  status:
    | "recorded"
    | "rebound"
    | "replaced"
    | "unchanged"
    | "recovered",
  proposal: StandardLimitProposalData,
  plan?: EnginePlan,
): DiscernResult<StandardsData> {
  return {
    ok: true,
    verb: "standards propose",
    ...(plan === undefined ? {} : { steps: proposalSteps(plan) }),
    data: { proposal: { status, proposal } },
  };
}

/** Build one bounded proposal refusal/failure envelope. */
function proposalFailure(
  error:
    | "invalid_value"
    | "unknown_standard"
    | "precondition_failed"
    | "dirty_worktree"
    | "proposal_failed"
    | "proposal_stale"
    | "write_access",
  message: string,
  diagnostic?: Diagnostic,
): DiscernResult {
  return {
    ok: false,
    verb: "standards propose",
    error,
    message,
    ...(diagnostic === undefined ? {} : { diagnostics: [diagnostic] }),
  };
}

/** Project a pure proposal-plan refusal into the verb's result envelope. */
function proposalPlanFailure(
  refusal: StandardLimitProposalRefusal,
): DiscernResult {
  return {
    ok: false,
    verb: "standards propose",
    error: refusal.error,
    message: refusal.message,
  };
}

type ProposalMeasurement =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly result: DiscernResult };

interface StableProposalMeasurementContext {
  readonly root: string;
  readonly cfg: DiscernConfig;
  readonly plan: ReturnType<typeof buildStandardPlan>;
  readonly standard: PlannedStandard;
  readonly head: string;
  readonly mainBranch: string;
  readonly trunkCommit: string;
  readonly signal?: AbortSignal;
}

/** Reuse exact-HEAD process evidence when present; otherwise measure only the
 * named Standard through the shared execution planner. */
async function proposalMeasurement(
  root: string,
  cfg: DiscernConfig,
  plan: ReturnType<typeof buildStandardPlan>,
  standard: PlannedStandard,
  authority: StandardProposalWriteAuthority,
  signal?: AbortSignal,
): Promise<ProposalMeasurement> {
  const measured = await measureStandardEvidence(
    root,
    cfg,
    plan,
    [standard.name],
    authority.admin,
    signal,
  );
  const reading = measured.readings.find((entry) =>
    entry.name === standard.name &&
    (entry.measurement === "measured" || entry.measurement === "replayed")
  );
  if (reading?.value === undefined || !Number.isFinite(reading.value)) {
    const diagnostic = measured.diagnostics.find((entry) =>
      entry.tool === standard.name
    ) ?? measured.diagnostics[0];
    return {
      ok: false,
      result: proposalFailure(
        "precondition_failed",
        `standard '${standard.name}' did not yield a numeric metric in its targeted measurement${
          diagnostic === undefined ? "" : `: ${diagnostic.message}`
        }. Fix the command or emitted metric, then retry this proposal command; it measures only the named standard.`,
        diagnostic,
      ),
    };
  }
  if (!measured.evidenceRecorded) {
    const pinned = measured.pin.head === undefined
      ? "the starting HEAD could not be read"
      : !measured.pin.clean
      ? "the worktree was not clean when measurement began"
      : "HEAD or the worktree changed while the measurement ran";
    return {
      ok: false,
      result: proposalFailure(
        "precondition_failed",
        `standard '${standard.name}' produced no renewable exact-HEAD evidence because ${pinned}. Restore a clean committed tree, then retry the same proposal command.`,
      ),
    };
  }
  return { ok: true, value: reading.value };
}

/** Measure once, then reject evidence if any tree identity moved meanwhile. */
async function stableProposalMeasurement(
  context: StableProposalMeasurementContext,
  authority: StandardProposalWriteAuthority,
  destination: "proposal commit" | "proposal could be renewed",
): Promise<ProposalMeasurement> {
  const measured = await proposalMeasurement(
    context.root,
    context.cfg,
    context.plan,
    context.standard,
    authority,
    context.signal,
  );
  if (!measured.ok) return measured;
  const [currentHead, currentTrunk, clean] = await Promise.all([
    gitValue(context.root, ["rev-parse", "HEAD"]),
    readTrunkConfig(context.root, context.mainBranch),
    isWorktreeFullyClean(context.root),
  ]);
  if (
    currentHead !== context.head || currentTrunk.kind !== "parsed" ||
    currentTrunk.commit !== context.trunkCommit || !clean
  ) {
    return {
      ok: false,
      result: proposalFailure(
        "proposal_stale",
        `standard '${context.standard.name}' was measured, but HEAD, the worktree, or ${context.mainBranch} moved before its ${destination}. Commit the final clean tree, update from ${context.mainBranch} if needed, then retry the same proposal command.`,
      ),
    };
  }
  return measured;
}

/** Whether one immutable proposal commit remains in the current history. */
async function isAncestorOf(
  root: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  const result = await runGit(
    ["merge-base", "--is-ancestor", ancestor, descendant],
    { cwd: root },
  );
  return result.success;
}

/** A truthful no-effect preview before the target's numeric reading is known. */
function proposalMeasurementPreview(
  standard: PlannedStandard,
  mode: "record" | "rebind",
): EnginePlan {
  return {
    title: mode === "record"
      ? "Standard limit proposal"
      : "Standard limit proposal renewal",
    details: [`standard: ${standard.name}`],
    steps: [
      {
        kind: "standard",
        label: verbatimStepLabel(standard.name),
        disposition: "run",
        note: `measure only ${standard.metric} on the current clean HEAD`,
      },
      ...(mode === "record"
        ? [{
          kind: "git" as const,
          label: verbatimStepLabel(`propose-${standard.name}`),
          disposition: "run" as const,
          note:
            "if the value breaches the trunk limit, create one config-only proposal commit",
        }]
        : [{
          kind: "standard" as const,
          label: verbatimStepLabel(`rebind-${standard.name}`),
          disposition: "run" as const,
          note:
            "if the proposal tuple and value are unchanged, renew its worktree-local evidence binding without a commit",
        }]),
    ],
  };
}

/** Compute/apply one proposal transaction. */
export async function standardsProposeResult(
  root: string,
  opts: {
    readonly name: string;
    readonly reason: string;
    readonly dryRun?: boolean;
    readonly signal?: AbortSignal;
  },
): Promise<DiscernResult> {
  const reason = validateStandardLimitReason(opts.reason);
  if (!reason.ok) {
    return proposalFailure("invalid_value", reason.message);
  }
  const initialCfg = await loadConfig(root);
  const mainBranch = integrationBranch(initialCfg.repository.trunk);
  const [branch, head] = await Promise.all([
    gitValue(root, ["branch", "--show-current"]),
    gitValue(root, ["rev-parse", "HEAD"]),
  ]);
  if (branch === undefined || branch === mainBranch) {
    return proposalFailure(
      "precondition_failed",
      `A standard limit proposal requires a named worktree branch ahead of ${mainBranch}; it never edits the trunk checkout directly.`,
    );
  }
  if (head === undefined) {
    return proposalFailure(
      "precondition_failed",
      "A standard limit proposal requires a readable current HEAD.",
    );
  }
  // Recovery itself is an apply operation. Dry-run never creates or completes
  // journals. It precedes the ordinary dirty guard because a pre-commit
  // interruption owns the one config edit that made the tree dirty.
  let authority: StandardProposalWriteAuthority | undefined;
  if (!(opts.dryRun ?? false)) {
    const preflight = await preflightProposalWrites(root);
    if (!preflight.ok) {
      return proposalFailure(
        "write_access",
        writePreflightFailureMessage(preflight),
        writePreflightDiagnostic(preflight, "discern standards propose"),
      );
    }
    authority = preflight.authority;
    try {
      const recovered = await recoverProposalTransaction(authority);
      if (recovered !== undefined) {
        return proposalResult("recovered", recovered);
      }
    } catch (error) {
      return proposalFailure("proposal_stale", errText(error));
    }
  }

  if (!(await isWorktreeFullyClean(root))) {
    return proposalFailure(
      "dirty_worktree",
      "A standard limit proposal requires a clean worktree so the config-only proposal commit cannot absorb unrelated changes. Commit or stash the current changes, take a fresh measurement, then retry.",
    );
  }
  // Recovery may have restored the pre-proposal config bytes. Plan only from
  // that post-recovery file, never the limit briefly visible on entry.
  const cfg = authority === undefined ? initialCfg : await loadConfig(root);
  const plan = buildStandardPlan(cfg);
  const standard = plan.standards.find((entry) => entry.name === opts.name);
  if (standard === undefined) {
    return proposalFailure(
      "unknown_standard",
      `no standard named '${opts.name}'. Configured standards: ${
        plan.standards.map((entry) => entry.name).join(", ") || "(none)"
      }.`,
    );
  }

  const inspection = await inspectActiveStandardLimitProposals(
    root,
    mainBranch,
    plan.standards,
  );
  const existing = inspection.active.get(opts.name);
  if (existing !== undefined) {
    if (existing.reason === reason.reason) {
      return proposalResult("unchanged", existing);
    }
    if (opts.dryRun ?? false) {
      const preview: EnginePlan = {
        title: "Standard limit proposal",
        details: [
          `standard: ${existing.standard}`,
          `replace reason: ${reason.reason}`,
        ],
        steps: [{
          kind: "standard",
          label: verbatimStepLabel(existing.standard),
          disposition: "run",
          note:
            "replace the exact proposal reason; the config commit stays unchanged",
        }],
      };
      return previewResult("standards propose", preview);
    }
    if (authority === undefined) {
      throw new Error(
        "internal error: proposal replacement has no write authority",
      );
    }
    const replaced = { ...existing, reason: reason.reason };
    try {
      await persistProposal(authority, replaced);
      await clearGateProof(root);
    } catch (error) {
      return proposalFailure(
        "proposal_failed",
        `could not replace the standard proposal reason: ${errText(error)}`,
      );
    }
    return proposalResult("replaced", replaced);
  }
  const stale = inspection.stale.find((entry) =>
    entry.proposal.standard === opts.name
  );
  const trunk = await readTrunkConfig(root, mainBranch);
  if (trunk.kind !== "parsed") {
    return proposalFailure(
      "precondition_failed",
      `the trunk standard definition cannot be verified (${
        trunk.kind === "unreadable" || trunk.kind === "parse_failed"
          ? trunk.reason
          : "discern.toml is absent"
      }). Fix or fetch ${mainBranch}, then retry.`,
    );
  }
  const trunkLimit = trunk.config.getNumber(standard.limitKey);
  if (trunkLimit === undefined) {
    return proposalFailure(
      "precondition_failed",
      `standard '${opts.name}' has no numeric limit on ${mainBranch}; it is new or malformed, not an existing held bound eligible for a proposed limit.`,
    );
  }
  const definitionFingerprint = await standardDefinitionFingerprint(
    standard.name,
    cfg,
  );
  const changedPaths = await collectPaths(root, trunk.commit, head);
  if (changedPaths === null) {
    return proposalFailure(
      "precondition_failed",
      "discern could not enumerate the changed paths responsible for this measurement; fix the Git diff and retry.",
    );
  }
  const proposalContext = {
    standard,
    reason: reason.reason,
    head,
    definitionFingerprint,
    trunk: mainBranch,
    trunkCommit: trunk.commit,
    trunkLimit,
    changedPaths,
  };
  const measurementContext: StableProposalMeasurementContext = {
    root,
    cfg,
    plan,
    standard,
    head,
    mainBranch,
    trunkCommit: trunk.commit,
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  };

  // A stale record whose branch still carries the proposed limit may renew only
  // its evidence binding. Restoring the trunk limit instead starts a new proposal
  // transaction and replaces the stale record through the ordinary path below.
  if (stale !== undefined && standard.limit !== trunkLimit) {
    const [originIsAncestor, trunkIsContained, originShapeError] = await Promise
      .all([
        isAncestorOf(root, stale.proposal.commit, head),
        isAncestorOf(root, trunk.commit, head),
        proposalCommitShape(
          root,
          stale.proposal,
          (await installedConfigRel(root)) ?? CONFIG_REL,
        ),
      ]);
    const rebindContext = {
      ...proposalContext,
      proposal: stale.proposal,
      originIsAncestor,
      trunkIsContained,
      ...(originShapeError === undefined ? {} : { originShapeError }),
    };
    const preliminary = buildStandardLimitProposalRebindPlan({
      ...rebindContext,
      measurement: stale.proposal.measurement,
    });
    if (!preliminary.ok) {
      return proposalPlanFailure(preliminary);
    }
    if (opts.dryRun ?? false) {
      return previewResult(
        "standards propose",
        proposalMeasurementPreview(standard, "rebind"),
      );
    }
    if (authority === undefined) {
      throw new Error(
        "internal error: proposal renewal has no write authority",
      );
    }
    const measured = await stableProposalMeasurement(
      measurementContext,
      authority,
      "proposal could be renewed",
    );
    if (!measured.ok) {
      return measured.result;
    }
    const rebound = buildStandardLimitProposalRebindPlan({
      ...rebindContext,
      measurement: measured.value,
    });
    if (!rebound.ok) {
      return proposalPlanFailure(rebound);
    }
    try {
      await persistProposal(authority, rebound.plan.proposal);
      await clearGateProof(root);
      return proposalResult(
        "rebound",
        rebound.plan.proposal,
        rebound.plan.engine,
      );
    } catch (error) {
      return proposalFailure(
        "proposal_failed",
        `could not renew the standard proposal binding: ${
          errText(error)
        }. The Git history and configured limit were not changed; retry the same command.`,
      );
    }
  }

  if (opts.dryRun ?? false) {
    const previewMeasurement = standard.direction === "down"
      ? trunkLimit + 1
      : trunkLimit - 1;
    const previewDecision = buildStandardLimitProposalPlan({
      ...proposalContext,
      measurement: previewMeasurement,
    });
    if (!previewDecision.ok) {
      return proposalPlanFailure(previewDecision);
    }
    return previewResult(
      "standards propose",
      proposalMeasurementPreview(standard, "record"),
    );
  }
  if (authority === undefined) {
    throw new Error("internal error: proposal apply has no write authority");
  }
  const measured = await stableProposalMeasurement(
    measurementContext,
    authority,
    "proposal commit",
  );
  if (!measured.ok) {
    return measured.result;
  }
  const decision = buildStandardLimitProposalPlan({
    ...proposalContext,
    measurement: measured.value,
  });
  if (!decision.ok) {
    return proposalPlanFailure(decision);
  }
  try {
    const proposal = await applyProposalPlan(
      root,
      branch,
      decision.plan,
      authority,
    );
    return proposalResult("recorded", proposal, decision.plan.engine);
  } catch (error) {
    return proposalFailure(
      "proposal_failed",
      `could not apply the standard limit proposal: ${
        errText(error)
      }. Retry the same command; the recovery journal will finish or safely unwind the exact transaction.`,
    );
  }
}

/** Human CLI projection from the same result envelope. */
function renderStandardsProposeResult(result: DiscernResult): void {
  const out = makeOut(colorEnabled(), { quiet: false });
  if (result.plan !== undefined) {
    renderPlan(outSink(out), result.plan);
  }
  if ((result.steps ?? []).length > 0) {
    renderStepResults(outSink(out), {
      title: "Standard proposal",
      steps: result.steps ?? [],
    });
  }
  const proposal = (result.data as StandardsData | undefined)?.proposal;
  if (proposal !== undefined) {
    out.group("owner decision required");
    out.warn(
      `${proposal.proposal.standard}: ${proposal.proposal.trunk_limit} → ${proposal.proposal.proposed_limit} (measured ${proposal.proposal.measurement})`,
    );
    out.info(`Reason: ${proposal.proposal.reason}`);
    out.info(
      "Run `discern done`; its Proof will carry this proposal. Landing still requires exact owner approval during `discern accept`.",
    );
  }
  if (!result.ok && result.message !== undefined) {
    out.group("failure");
    out.error(result.message);
  }
}

/** Render and exit one CLI proposal invocation from the shared result core. */
export async function runStandardsPropose(
  root: string,
  opts: {
    readonly name: string;
    readonly reason: string;
    readonly dryRun?: boolean;
    readonly json?: boolean;
  },
): Promise<number> {
  const result = await standardsProposeResult(root, opts);
  observeResult(result);
  if (opts.json ?? false) {
    emitResult(result);
  } else {
    renderStandardsProposeResult(result);
  }
  return result.ok ? 0 : 1;
}
