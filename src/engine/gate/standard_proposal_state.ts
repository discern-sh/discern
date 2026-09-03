/** Read-only authority for persisted Standard limit proposals. Gate, pin,
 * proposal creation, Proof, and acceptance consume this module without
 * depending on the effectful proposal command. */

import { z } from "@zod/zod";
import { CONFIG_REL, installedConfigRel } from "../../shared/env.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import type { Diagnostic } from "../../shared/result.ts";
import {
  type StandardLimitProposalData,
  StandardLimitProposalSchema,
} from "../../shared/result_schemas.ts";
import { runGit } from "../../shared/subprocess.ts";
import { pathMatchesPattern } from "../scopes/glob.ts";
import { repoPathPrefix } from "../scopes/scopes.ts";
import type { PlannedStandard } from "./standard_plan.ts";
import {
  readTrunkConfig,
  standardDefinitionFingerprint,
  type TrunkConfigRead,
} from "./standard_limits.ts";
import { inspectFreshStandardMeasurementEvidence } from "./proof.ts";

export const PROPOSAL_STORE_VERSION = 2;

const StandardLimitProposalStoreSchema = z.strictObject({
  version: z.literal(PROPOSAL_STORE_VERSION),
  proposals: z.array(StandardLimitProposalSchema),
}).refine(
  ({ proposals }) =>
    new Set(proposals.map((proposal) => proposal.standard)).size ===
      proposals.length,
  "proposal Standards must be unique",
);

export type StandardLimitProposalStore = z.infer<
  typeof StandardLimitProposalStoreSchema
>;

export interface ActiveStandardLimitProposals {
  readonly active: ReadonlyMap<string, StandardLimitProposalData>;
  readonly stale: readonly {
    readonly proposal: StandardLimitProposalData;
    readonly reason: string;
  }[];
}

/** Copy one tuple so persisted, Proof, and transaction evidence never aliases
 * a mutable path array supplied by another layer. */
export function cloneStandardLimitProposal(
  proposal: StandardLimitProposalData,
): StandardLimitProposalData {
  return { ...proposal, evidence_paths: [...proposal.evidence_paths] };
}

/** Canonical exact identity shared by Gate reuse and acceptance. */
export function standardLimitProposalIdentity(
  proposal: StandardLimitProposalData,
): string {
  return JSON.stringify([
    proposal.standard,
    proposal.commit,
    proposal.bound_commit,
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
export function sameStandardLimitProposalSet(
  left: readonly StandardLimitProposalData[],
  right: readonly StandardLimitProposalData[],
): boolean {
  const keys = (items: readonly StandardLimitProposalData[]): string[] =>
    items.map(standardLimitProposalIdentity).sort();
  const leftKeys = keys(left);
  const rightKeys = keys(right);
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index]);
}

/** Parse the one canonical persisted proposal store. */
function parseProposalStore(
  raw: string,
): StandardLimitProposalStore | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    const current = StandardLimitProposalStoreSchema.safeParse(parsed);
    return current.success ? current.data : undefined;
  } catch {
    // discern-best-effort: standard-proposal-store-decode-fallback
    return undefined;
  }
}

/** Read absent state as an empty store, while preserving malformed/unreadable. */
export async function readProposalStore(
  root: string,
): Promise<
  | { readonly status: "ok"; readonly store: StandardLimitProposalStore }
  | { readonly status: "malformed" | "unavailable"; readonly reason: string }
> {
  const path = await gitAdminStatePath(root, "standardLimitProposals");
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
      return {
        status: "ok",
        store: { version: PROPOSAL_STORE_VERSION, proposals: [] },
      };
    }
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const store = parseProposalStore(raw);
  return store === undefined
    ? {
      status: "malformed",
      reason: "the Standard proposal record is malformed",
    }
    : { status: "ok", store };
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

/** Verify that the immutable proposal commit is the config-only child of its
 * original measured source. */
export async function proposalCommitShape(
  root: string,
  proposal: StandardLimitProposalData,
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
  proposal: StandardLimitProposalData,
  trunk: TrunkConfigRead,
  mainBranch: string,
  byName: ReadonlyMap<string, PlannedStandard>,
  head: string,
  configRel: string,
): Promise<string | undefined> {
  if (proposal.bound_commit !== head) {
    return `it is bound to commit ${
      proposal.bound_commit.slice(0, 12)
    }, not current HEAD ${head.slice(0, 12)}`;
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
  return await proposalCommitShape(root, proposal, configRel);
}

/** Inspect proposal authority for Gate and acceptance. */
export async function inspectActiveStandardLimitProposals(
  root: string,
  mainBranch: string,
  standards: readonly PlannedStandard[],
): Promise<ActiveStandardLimitProposals> {
  const read = await readProposalStore(root);
  if (read.status !== "ok") {
    return { active: new Map(), stale: [] };
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
  const active = new Map<string, StandardLimitProposalData>();
  const stale: {
    proposal: StandardLimitProposalData;
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

/** A stale proposal is focused only while its Standard needs the exception. */
export function staleProposalDiagnostic(
  standard: string,
  reason: string,
): Diagnostic {
  return {
    tool: `standard:${standard}`,
    severity: "error",
    message:
      `standard '${standard}' has a stale proposed limit: ${reason}. The proposal authorizes nothing. Restore the trunk limit before creating a different proposal, or commit the final descendant and repeat the unchanged proposal command to renew its evidence.`,
    reproduce_cmd: "discern standards",
  };
}
