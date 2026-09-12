import { readEmergencyPreparation } from "./review.ts";
/** Read-only emergency subject and short-lived, exact owner-confirmation challenge. */
import type { CompletionArtifact } from "../completion/artifacts.ts";
import { type Candidate, CandidateSchema } from "../completion/candidate.ts";
import type { CompletionRecord } from "../completion/records.ts";
import type { LifecycleContext } from "../worktree/lifecycle.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { runGit } from "../../shared/subprocess.ts";
import { pinValidatedTree } from "../gate/proof.ts";
import { verifyTrunkLimits } from "../gate/standard_limits.ts";
import { inspectActiveStandardLimitProposals } from "../gate/standard_proposal_state.ts";
import { resolveIdentity } from "../worktree/identity.ts";
import {
  inLinkedWorktree,
  inspectGitOperation,
  integrationBranch,
  mainRepoPath,
} from "../worktree/git.ts";
import { inspectInterruptedAcceptance } from "../worktree/acceptance_transaction.ts";
import { worktreePathForEffortBranch } from "../worktree/target_resolution.ts";
import {
  gitValue,
  observeSource,
  predecessorPolicyIdentity,
  recordedCandidate,
} from "../completion/source.ts";
import { observeCandidateValidation } from "../validation/candidate_observation.ts";
import { requirementSetIdentity } from "../validation/catalog.ts";
import { inspectCheckpointObligations } from "../checkpoints/inspection.ts";
import { configuredValidation } from "../validation/configuration.ts";
import { classifyScopeImpact } from "../scopes/scopes.ts";
import { observeCompletionRecords } from "../validation/runtime.ts";
import { type EmergencyExceptions, emergencyExceptions } from "./evidence.ts";

export const EMERGENCY_CONFIRMATION_MS = 15 * 60_000;
export interface EmergencyPlan {
  /** The main checkout the repair lands in. */
  readonly root: string;
  /** The repair's own registered worktree. */
  readonly worktree: string;
  readonly branch: string;
  readonly trunk: string;
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly reason: string;
  readonly exceptions: EmergencyExceptions;
  readonly review?: CompletionArtifact;
}

/** Stable UUID-shaped coordinates are derived from the approved immutable subject, never a branch selector. */
export function emergencyId(digest: string): string {
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${
    digest.slice(13, 16)
  }-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

/** Emergency integration accepts one source containing actual trunk; update resolves a differing base before review. */
export async function observeEmergencySubject(
  ctx: LifecycleContext,
  reason: string,
): Promise<EmergencyPlan> {
  if (reason.trim() === "") {
    throw new Error(
      "Give the owner a concrete emergency reason with --reason.",
    );
  }
  if (!await inLinkedWorktree(ctx.cwd)) {
    throw new Error(
      "Prepare this emergency in the repair's recorded worktree. Use --recover from a surviving checkout for an interrupted landing.",
    );
  }
  const root = await mainRepoPath(ctx.cwd);
  if (root === undefined) {
    throw new Error(
      "The main checkout is unavailable; preserve the repair and restore repository access.",
    );
  }
  const trunk = integrationBranch(ctx.config.repository.trunk);
  const pin = await pinValidatedTree(ctx.cwd);
  if (!pin.clean) {
    throw new Error(
      "The repair has uncommitted changes. Preserve and commit the reviewed source before preparing the emergency.",
    );
  }
  if ((await inspectGitOperation(ctx.cwd)).kind !== "none") {
    throw new Error(
      "Resolve the repair checkout's active Git operation before preparing the emergency.",
    );
  }
  if ((await inspectInterruptedAcceptance(ctx.cwd, trunk)).kind !== "none") {
    throw new Error(
      "An earlier acceptance journal needs recovery. Run discern accept before preparing another integration.",
    );
  }
  const identity = await resolveIdentity(ctx.cwd, ctx.cwd);
  const branchRef = await gitValue(ctx.cwd, [
    "symbolic-ref",
    "--quiet",
    "HEAD",
  ]);
  const source = await observeSource(ctx.cwd, identity.id, branchRef);
  const branch = branchRef.slice("refs/heads/".length);
  const worktree = await Deno.realPath(ctx.cwd);
  if (await worktreePathForEffortBranch(root, branch) !== worktree) {
    throw new Error(
      "The repair's registered checkout and effort identity disagree. Restore their ownership records before integration.",
    );
  }
  const mainBranch = await gitValue(root, ["symbolic-ref", "--quiet", "HEAD"]);
  const mainStatus = await runGit([
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=no",
  ], { cwd: root });
  if (
    mainBranch !== `refs/heads/${trunk}` || !mainStatus.success ||
    mainStatus.stdout !== "" ||
    (await inspectGitOperation(root)).kind !== "none"
  ) {
    throw new Error(
      "Restore the main checkout to its configured trunk with clean tracked files and no active Git operation before reviewing emergency integration. Preserve all local work.",
    );
  }
  const observation = await observeCompletionRecords(root);
  if (
    observation.records.some(({ reading }) =>
      reading.kind !== "recorded" && reading.kind !== "missing"
    )
  ) {
    throw new Error(
      "Completion records are unreadable or unsupported. Preserve them and restore their reader before emergency integration.",
    );
  }
  const records: CompletionRecord[] = observation.records.flatMap((
    { reading },
  ) => reading.kind === "recorded" ? [reading.record] : []);
  const trunkHead = await gitValue(root, [
    "rev-parse",
    "--verify",
    `refs/heads/${trunk}^{commit}`,
  ]);
  const contained = await runGit([
    "merge-base",
    "--is-ancestor",
    trunkHead,
    source.head,
  ], { cwd: root });
  if (!contained.success) {
    throw new Error(
      "The repair must contain actual trunk. Run discern update in this worktree, review and commit its result, then prepare a new emergency plan.",
    );
  }
  if (source.head === trunkHead) {
    throw new Error(
      "This source is already on trunk. Use discern done to validate its current obligations.",
    );
  }
  const policy = await predecessorPolicyIdentity(root, trunkHead);
  const provisional: Candidate = {
    source,
    attempt_id: emergencyId(
      await sha256Hex(JSON.stringify([source, trunkHead, policy])),
    ),
    predecessor: trunkHead,
    head: source.head,
    tree: source.tree,
    policy,
    requirement_set: await requirementSetIdentity(
      (await configuredValidation(
        ctx.config,
        (await classifyScopeImpact(ctx.cwd, ctx.config)).scopes,
      )).obligations.map((entry) => entry.requirement),
    ),
  };
  const validation = await observeCandidateValidation({
    root: ctx.cwd,
    candidate_id: provisional.attempt_id,
    candidate: provisional,
    observation,
  });
  const requirementSet = await requirementSetIdentity(
    validation.snapshot.requirements,
  );
  const retained = recordedCandidate(records, {
    source,
    predecessor: trunkHead,
    policy,
    requirement_set: requirementSet,
  });
  const id = retained?.id ?? provisional.attempt_id;
  const candidate: Candidate = retained?.data ??
    { ...provisional, attempt_id: id, requirement_set: requirementSet };
  // Emergency integration cannot weaken ordinary policy: the repair's config
  // must hold every standard limit the trunk protects.
  const standards = [...validation.standards];
  const proposals = await inspectActiveStandardLimitProposals(
    ctx.cwd,
    trunk,
    standards,
  );
  const limits = await verifyTrunkLimits(
    ctx.cwd,
    trunk,
    standards,
    proposals.active,
    validation.config,
  );
  if (limits.blocking) {
    throw new Error(
      "The repair changes protected policy or standard limits without valid approval. Emergency integration cannot weaken ordinary policy; resolve those changes before preparing its plan.",
    );
  }
  const exceptions = await emergencyExceptions(
    root,
    validation.snapshot,
    records,
  );
  if (!exceptions.length) {
    throw new Error(
      "Every configured machine obligation has current passing evidence. Use discern done, then discern accept for ordinary landing.",
    );
  }
  return {
    root: await Deno.realPath(root),
    worktree,
    branch,
    trunk,
    candidate_id: id,
    candidate,
    reason: reason.trim(),
    exceptions,
  };
}

/** A read-only integration plan requires current checkpoint evidence before exposing confirmation. */
export async function planEmergency(
  ctx: LifecycleContext,
  reason: string,
  preparation?: string,
): Promise<EmergencyPlan> {
  const plan = await observeEmergencySubject(ctx, reason);
  if (preparation !== undefined) {
    return {
      ...plan,
      review: await readEmergencyPreparation(
        ctx.cwd,
        ctx.config,
        plan.candidate_id,
        plan.candidate,
        preparation,
      ),
    };
  }
  const checkpoints = await inspectCheckpointObligations(
    ctx.cwd,
    ctx.config,
    {
      predecessor: plan.candidate.predecessor,
      currentCommit: plan.candidate.head,
    },
  );
  if (
    checkpoints.drops.length ||
    checkpoints.entries.some((entry) =>
      entry.definition.mode === "stop" && entry.obligation.state !== "none" &&
      entry.obligation.state !== "declared_met"
    )
  ) {
    throw new Error(
      "Checkpoint judgment or its evidence is outstanding. Run accept emergency --prepare --reason <text> to settle checkpoint triggers and answer the served questions. Emergency integration cannot supply a judgment or variance.",
    );
  }
  return plan;
}

/** Hash every owner-relevant fact; observation counters grant nothing. */
export async function emergencyToken(
  plan: EmergencyPlan,
  expires: number,
): Promise<string> {
  const digest = await sha256Hex(JSON.stringify({
    expires,
    root: plan.root,
    trunk: plan.trunk,
    candidate_id: plan.candidate_id,
    candidate: {
      ...CandidateSchema.parse(plan.candidate),
      attempt_id: undefined,
    },
    reason: plan.reason,
    exceptions: plan.exceptions,
    review: plan.review,
  }));
  return `${expires}.${digest}`;
}
/** Reject an expired challenge or any change to the approved subject. */
export async function emergencyConfirmationCurrent(
  plan: EmergencyPlan,
  token: string,
  now = SYSTEM_CLOCK.wallNow(),
): Promise<boolean> {
  const expires = Number(token.split(".")[0]);
  return Number.isSafeInteger(expires) && expires > now &&
    expires <= now + EMERGENCY_CONFIRMATION_MS &&
    token === await emergencyToken(plan, expires);
}
