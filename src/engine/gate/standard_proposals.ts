/**
 * `discern standards propose` — the effectful shell around the pure growth
 * proposal plan. The command consumes a fresh red measurement on clean HEAD,
 * makes one config-only commit, and atomically records the exact proposal in
 * worktree-local Git administration state. A recovery journal bridges the only
 * multi-write gap: commit made, proposal record not yet finalized.
 */

import { dirname, isAbsolute, join } from "@std/path";
import { loadConfig } from "../../shared/config_schema.ts";
import { atomicReplaceJson } from "../../shared/atomic_write.ts";
import {
  commitDiscernChanges,
  DISCERN_AUTHORED_COMMIT_SITES,
} from "../../shared/discern_commit.ts";
import { emitResult } from "../../shared/emit.ts";
import { CONFIG_REL, installedConfigRel } from "../../shared/env.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import type {
  Diagnostic,
  DiscernResult,
  EnginePlan,
  StepResult,
} from "../../shared/result.ts";
import { previewResult, verbatimStepLabel } from "../../shared/result.ts";
import {
  type StandardGrowthProposalData,
  StandardGrowthProposalSchema,
  type StandardsData,
} from "../../shared/result_schemas.ts";
import { observeResult } from "../../shared/result_capture.ts";
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
import { pathMatchesPattern } from "../scopes/glob.ts";
import { collectPaths, repoPathPrefix } from "../scopes/scopes.ts";
import { integrationBranch } from "../worktree/git.ts";
import {
  buildStandardGrowthProposalPlan,
  type PlannedStandardGrowthProposal,
  type StandardGrowthProposalPlan,
} from "./standard_proposal_plan.ts";
import { validateStandardGrowthReason } from "../../shared/standard_growth_reason.ts";
import { buildStandardPlan, type PlannedStandard } from "./standard_plan.ts";
import {
  readTrunkConfig,
  standardDefinitionFingerprint,
  type TrunkConfigRead,
} from "./standard_limits.ts";
import {
  type AdminStateWriteAuthority,
  clearGateProof,
  inspectFreshStandardMeasurementEvidence,
  isWorktreeFullyClean,
  preflightAdminStateWrites,
} from "./proof.ts";
import { renderPlan, renderStepResults } from "../../shared/result.ts";

const PROPOSAL_STORE_VERSION = 1;
const PROPOSAL_TRANSACTION_VERSION = 1;

interface StandardGrowthProposalStore {
  readonly version: 1;
  readonly proposals: readonly StandardGrowthProposalData[];
}

interface StandardGrowthProposalTransaction {
  readonly version: 1;
  readonly branch: string;
  readonly source_commit: string;
  readonly config_path: string;
  readonly proposal: PlannedStandardGrowthProposal;
}

export interface ActiveStandardGrowthProposals {
  readonly active: ReadonlyMap<string, StandardGrowthProposalData>;
  readonly stale: readonly {
    readonly proposal: StandardGrowthProposalData;
    readonly reason: string;
  }[];
}

/** Copy one proposal tuple so persisted/Proof/transaction evidence never
 * aliases a mutable array supplied by another layer. */
export function cloneStandardGrowthProposal(
  proposal: StandardGrowthProposalData,
): StandardGrowthProposalData {
  return { ...proposal, evidence_paths: [...proposal.evidence_paths] };
}

/** Canonical exact identity shared by Gate reuse and acceptance. */
export function standardGrowthProposalIdentity(
  proposal: StandardGrowthProposalData,
): string {
  return JSON.stringify([
    proposal.standard,
    proposal.commit,
    proposal.measured_commit,
    proposal.definition_fingerprint,
    proposal.trunk,
    proposal.trunk_commit,
    proposal.direction,
    proposal.trunk_limit,
    proposal.proposed_limit,
    proposal.measurement,
    proposal.delta,
    proposal.reason,
    proposal.evidence_paths,
  ]);
}

/** Exact unordered-set equality for proposal authority. */
export function sameStandardGrowthProposalSet(
  left: readonly StandardGrowthProposalData[],
  right: readonly StandardGrowthProposalData[],
): boolean {
  const keys = (items: readonly StandardGrowthProposalData[]): string[] =>
    items.map(standardGrowthProposalIdentity).sort();
  const leftKeys = keys(left);
  const rightKeys = keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index]);
}

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
  const proposalPath = admin.authority.paths.standardGrowthProposals;
  const transactionPath =
    admin.authority.paths.standardGrowthProposalTransaction;
  if (proposalPath === undefined || transactionPath === undefined) {
    return {
      ok: false,
      path: root,
      description: "the Standard proposal transaction state",
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
      description: "the Standard proposal record",
    },
    {
      kind: "directory-entry",
      path: dirname(transactionPath),
      description: "the Standard proposal recovery journal",
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

/** Parse the one iterable authority file; malformed state is fail-closed. */
function parseProposalStore(
  raw: string,
): StandardGrowthProposalStore | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as { version?: unknown; proposals?: unknown };
  if (
    record.version !== PROPOSAL_STORE_VERSION ||
    !Array.isArray(record.proposals)
  ) {
    return undefined;
  }
  const proposals: StandardGrowthProposalData[] = [];
  const names = new Set<string>();
  for (const candidate of record.proposals) {
    const parsed = StandardGrowthProposalSchema.safeParse(candidate);
    if (!parsed.success || names.has(parsed.data.standard)) {
      return undefined;
    }
    names.add(parsed.data.standard);
    proposals.push(parsed.data);
  }
  return { version: 1, proposals };
}

/** Read absent state as an empty store, while preserving malformed/unreadable. */
async function readProposalStore(
  root: string,
): Promise<
  | { readonly status: "ok"; readonly store: StandardGrowthProposalStore }
  | { readonly status: "malformed" | "unavailable"; readonly reason: string }
> {
  const path = await gitAdminStatePath(root, "standardGrowthProposals");
  if (path === undefined) {
    return {
      status: "unavailable",
      reason: "Git could not resolve the proposal record",
    };
  }
  let raw: string;
  try {
    raw = await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return { status: "ok", store: { version: 1, proposals: [] } };
    }
    return { status: "unavailable", reason: errText(error) };
  }
  const store = parseProposalStore(raw);
  return store === undefined
    ? {
      status: "malformed",
      reason: "the Standard proposal record is malformed",
    }
    : { status: "ok", store };
}

/** Atomically replace the iterable proposal authority. */
async function writeProposalStore(
  authority: StandardProposalWriteAuthority,
  proposals: readonly StandardGrowthProposalData[],
): Promise<void> {
  await atomicReplaceJson(
    authority.proposalPath,
    { version: 1, proposals } satisfies StandardGrowthProposalStore,
    { mode: 0o600, sync: true, trailingNewline: true },
  );
}

/** Replace one Standard's record while preserving the iterable set. */
async function persistProposal(
  authority: StandardProposalWriteAuthority,
  proposal: StandardGrowthProposalData,
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

/** Verify that the proposal commit is the one config-only child of its measured
 * source. This makes a hand-written admin record insufficient to waive Tier 1. */
async function proposalCommitShape(
  root: string,
  proposal: StandardGrowthProposalData,
  configRel: string,
): Promise<string | undefined> {
  const prefix = await repoPathPrefix(root);
  if (prefix === undefined) {
    return "its project path inside the repository cannot be read";
  }
  const parents = await runGit(
    ["rev-list", "--parents", "--max-count=1", proposal.commit, "--"],
    { cwd: root },
  );
  if (!parents.success) {
    return "its proposal commit cannot be read";
  }
  const fields = parents.stdout.trim().split(/\s+/);
  if (
    fields.length !== 2 || fields[0] !== proposal.commit ||
    fields[1] !== proposal.measured_commit
  ) {
    return "its proposal commit is not the single child of the measured commit";
  }
  const diff = await runGit(
    [
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      proposal.measured_commit,
      proposal.commit,
      "--",
    ],
    { cwd: root },
  );
  if (!diff.success || diff.stdout !== `${prefix}${configRel}\0`) {
    return `its proposal commit changes something other than ${configRel}`;
  }
  return undefined;
}

/** Validate one persisted record against current HEAD, trunk, and config. */
async function proposalStaleness(
  root: string,
  proposal: StandardGrowthProposalData,
  trunk: TrunkConfigRead,
  mainBranch: string,
  byName: ReadonlyMap<string, PlannedStandard>,
  head: string,
  configRel: string,
): Promise<string | undefined> {
  if (proposal.commit !== head) {
    return `it names commit ${proposal.commit.slice(0, 12)}, not current HEAD ${
      head.slice(0, 12)
    }`;
  }
  if (trunk.kind !== "parsed") {
    return "the current trunk Standard definition cannot be read";
  }
  if (proposal.trunk !== mainBranch || proposal.trunk_commit !== trunk.commit) {
    return `the trunk moved or changed identity (recorded ${proposal.trunk}@${
      proposal.trunk_commit.slice(0, 12)
    }, now ${mainBranch}@${trunk.commit.slice(0, 12)})`;
  }
  const standard = byName.get(proposal.standard);
  if (standard === undefined) {
    return "the Standard was deleted or renamed";
  }
  const trunkLimit = trunk.config.getNumber(standard.limitKey);
  if (trunkLimit === undefined || trunkLimit !== proposal.trunk_limit) {
    return "the trunk limit changed";
  }
  if (
    standard.direction !== proposal.direction ||
    standard.limit !== proposal.proposed_limit ||
    proposal.measurement !== proposal.proposed_limit ||
    proposal.delta !== proposal.proposed_limit - proposal.trunk_limit
  ) {
    return "the direction, proposed limit, measurement, or delta changed";
  }
  if (
    await standardDefinitionFingerprint(standard.name, standard.spec) !==
      proposal.definition_fingerprint
  ) {
    return "the Standard definition changed";
  }
  const inputs = standard.inputs;
  if (
    inputs === undefined || inputs.length === 0 ||
    proposal.evidence_paths.length === 0 ||
    proposal.evidence_paths.some((path) =>
      !inputs.some((pattern) => pathMatchesPattern(path, pattern))
    )
  ) {
    return "the configured inputs no longer cover every responsible path";
  }
  const shape = await proposalCommitShape(root, proposal, configRel);
  if (shape !== undefined) {
    return shape;
  }
  return undefined;
}

/** Inspect proposal authority for Gate and acceptance. Stale entries are never
 * active and carry their exact recovery reason for result diagnostics. */
export async function inspectActiveStandardGrowthProposals(
  root: string,
  mainBranch: string,
  standards: readonly PlannedStandard[],
): Promise<ActiveStandardGrowthProposals> {
  const read = await readProposalStore(root);
  if (read.status !== "ok") {
    return {
      active: new Map(),
      stale: [],
    };
  }
  const [head, trunk] = await Promise.all([
    gitValue(root, ["rev-parse", "HEAD"]),
    readTrunkConfig(root, mainBranch),
  ]);
  if (head === undefined) {
    return {
      active: new Map(),
      stale: read.store.proposals.map((proposal) => ({
        proposal,
        reason: "current HEAD cannot be read",
      })),
    };
  }
  const configRel = (await installedConfigRel(root)) ?? CONFIG_REL;
  const byName = new Map(
    standards.map((standard) => [standard.name, standard]),
  );
  const freshEvidence = await inspectFreshStandardMeasurementEvidence(root);
  const active = new Map<string, StandardGrowthProposalData>();
  const stale: {
    proposal: StandardGrowthProposalData;
    reason: string;
  }[] = [];
  for (const proposal of read.store.proposals) {
    const reason = await proposalStaleness(
      root,
      proposal,
      trunk,
      mainBranch,
      byName,
      head,
      configRel,
    );
    const refreshedValue = freshEvidence.status === "honored"
      ? freshEvidence.evidence.values[proposal.standard]
      : undefined;
    const refreshFailed = freshEvidence.status === "honored" &&
      freshEvidence.evidence.failed.includes(proposal.standard);
    const measurementReason = refreshFailed
      ? "the latest fresh measurement failed"
      : refreshedValue !== undefined && refreshedValue !== proposal.measurement
      ? `the latest fresh measurement is ${refreshedValue}, not the recorded ${proposal.measurement}`
      : undefined;
    if (reason === undefined && measurementReason === undefined) {
      active.set(proposal.standard, proposal);
    } else {
      stale.push({
        proposal,
        reason: reason ?? measurementReason ?? "unknown",
      });
    }
  }
  return { active, stale };
}

/** A stale proposal is a focused diagnostic only when its Standard still needs
 * the never-loosen exception; otherwise it is inert historical admin state. */
export function staleProposalDiagnostic(
  standard: string,
  reason: string,
): Diagnostic {
  return {
    tool: `standard:${standard}`,
    severity: "error",
    message:
      `standard '${standard}' has a stale growth proposal: ${reason}. The proposal authorizes nothing; restore the trunk limit or take a fresh breached measurement and run \`discern standards propose ${standard} --reason "…"\` again.`,
    reproduce_cmd: "discern standards",
  };
}

/** Read and validate a recovery journal. */
function parseProposalTransaction(
  raw: string,
): StandardGrowthProposalTransaction | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as {
    version?: unknown;
    branch?: unknown;
    source_commit?: unknown;
    config_path?: unknown;
    proposal?: unknown;
  };
  const candidate = StandardGrowthProposalSchema.safeParse({
    ...(typeof record.proposal === "object" && record.proposal !== null
      ? record.proposal
      : {}),
    commit: record.source_commit,
  });
  if (
    record.version !== PROPOSAL_TRANSACTION_VERSION ||
    typeof record.branch !== "string" || record.branch === "" ||
    typeof record.source_commit !== "string" || record.source_commit === "" ||
    typeof record.config_path !== "string" || record.config_path === "" ||
    !candidate.success
  ) {
    return undefined;
  }
  const { commit: _commit, ...proposal } = candidate.data;
  return {
    version: 1,
    branch: record.branch,
    source_commit: record.source_commit,
    config_path: record.config_path,
    proposal,
  };
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
): Promise<StandardGrowthProposalData | undefined> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(authority.transactionPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw error;
  }
  const transaction = parseProposalTransaction(raw);
  if (transaction === undefined) {
    throw new Error(
      `the Standard proposal recovery journal is malformed at ${authority.transactionPath}; no project file was changed`,
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
      "the Standard proposal transaction no longer belongs to the current branch/HEAD; ordinary enforcement remains active",
    );
  }
  const proposal: StandardGrowthProposalData = {
    ...transaction.proposal,
    commit: head,
  };
  const shape = await proposalCommitShape(
    authority.root,
    proposal,
    transaction.config_path,
  );
  if (shape !== undefined) {
    throw new Error(
      `the interrupted Standard proposal cannot be recovered because ${shape}; ordinary enforcement remains active`,
    );
  }
  await persistProposal(authority, proposal);
  await removeTransaction(authority.transactionPath);
  return proposal;
}

/** Author the config-only proposal commit from its exact planned evidence. */
function proposalCommitMessage(
  proposal: PlannedStandardGrowthProposal,
): { subject: string; body: string } {
  const bound = proposal.direction === "up" ? "floor" : "ceiling";
  return {
    subject: `Propose Standard growth: ${proposal.standard}`,
    body:
      `Move the ${bound} from ${proposal.trunk_limit} to ${proposal.proposed_limit} after measuring ${proposal.measurement}.\n\n` +
      `Reason: ${proposal.reason}\n\n` +
      `Responsible paths:\n${
        proposal.evidence_paths.map((path) => `- ${path}`).join("\n")
      }`,
  };
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
  plan: StandardGrowthProposalPlan,
  authority: StandardProposalWriteAuthority,
): Promise<StandardGrowthProposalData> {
  const transaction: StandardGrowthProposalTransaction = {
    version: 1,
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
      site: DISCERN_AUTHORED_COMMIT_SITES.standardsGrowthProposal,
      cwd: root,
      ...proposalCommitMessage(plan.proposal),
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
  const proposal: StandardGrowthProposalData = { ...plan.proposal, commit };
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
  status: "recorded" | "replaced" | "unchanged" | "recovered",
  proposal: StandardGrowthProposalData,
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

/** Compute/apply one proposal transaction. */
export async function standardsProposeResult(
  root: string,
  opts: {
    readonly name: string;
    readonly reason: string;
    readonly dryRun?: boolean;
  },
): Promise<DiscernResult> {
  const reason = validateStandardGrowthReason(opts.reason);
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
      `Standard growth proposals require a named worktree branch ahead of ${mainBranch}; they never edit the trunk checkout directly.`,
    );
  }
  if (head === undefined) {
    return proposalFailure(
      "precondition_failed",
      "Standard growth proposals require a readable current HEAD.",
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
      "Standard growth proposals require a clean worktree so the config-only proposal commit cannot absorb unrelated changes. Commit or stash the current changes, take a fresh measurement, then retry.",
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

  const inspection = await inspectActiveStandardGrowthProposals(
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
        title: "Standard growth proposal",
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
        `could not replace the Standard proposal reason: ${errText(error)}`,
      );
    }
    return proposalResult("replaced", replaced);
  }
  const stale = inspection.stale.find((entry) =>
    entry.proposal.standard === opts.name
  );
  if (stale !== undefined && standard.limit !== stale.proposal.trunk_limit) {
    return proposalFailure(
      "proposal_stale",
      staleProposalDiagnostic(opts.name, stale.reason).message,
    );
  }

  const evidence = await inspectFreshStandardMeasurementEvidence(root);
  if (evidence.status !== "honored") {
    return proposalFailure(
      "precondition_failed",
      `standard '${opts.name}' has no fresh measured breach on current clean HEAD (${evidence.status}). Run \`discern standards\`; after it reports the breach, retry this exact proposal.`,
    );
  }
  const measurement = evidence.evidence.values[opts.name];
  if (
    measurement === undefined || evidence.evidence.failed.includes(opts.name)
  ) {
    return proposalFailure(
      "precondition_failed",
      `standard '${opts.name}' did not yield a numeric metric in the fresh measurement. Fix its command or emitted metric and re-run \`discern standards\` before proposing growth.`,
    );
  }
  const trunk = await readTrunkConfig(root, mainBranch);
  if (trunk.kind !== "parsed") {
    return proposalFailure(
      "precondition_failed",
      `the trunk Standard definition cannot be verified (${
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
      `standard '${opts.name}' has no numeric limit on ${mainBranch}; it is new or malformed, not an existing held bound eligible for growth approval.`,
    );
  }
  const changedPaths = await collectPaths(root, trunk.commit, head);
  if (changedPaths === null) {
    return proposalFailure(
      "precondition_failed",
      "discern could not enumerate the changed paths responsible for this measurement; fix the Git diff and retry.",
    );
  }
  const decision = buildStandardGrowthProposalPlan({
    standard,
    reason: reason.reason,
    head,
    definitionFingerprint: await standardDefinitionFingerprint(
      standard.name,
      standard.spec,
    ),
    trunk: mainBranch,
    trunkCommit: trunk.commit,
    trunkLimit,
    measurement,
    changedPaths,
  });
  if (!decision.ok) {
    return {
      ok: false,
      verb: "standards propose",
      error: decision.error,
      message: decision.message,
    };
  }
  if (opts.dryRun ?? false) {
    return previewResult("standards propose", decision.plan.engine);
  }
  if (authority === undefined) {
    throw new Error("internal error: proposal apply has no write authority");
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
      `could not apply the Standard growth proposal: ${
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
