import { readEmergencyPreparation } from "./review.ts";
import type { EnvironmentArtifact } from "../execution/types.ts";
import { landingNeedsRecovery } from "../landing_queue/convergence.ts";
/** Read-only emergency subject and short-lived, exact owner-confirmation challenge. */
import { type Candidate, CandidateSchema } from "../completion/candidate.ts";
import type { CompletionObservation } from "../completion/protocol.ts";
import type { LifecycleContext } from "../worktree/lifecycle.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { DISCERN_VERSION } from "../../lib/version.ts";
import { runGit } from "../../shared/subprocess.ts";
import { pinValidatedTree } from "../gate/proof.ts";
import { resolveIdentity } from "../worktree/identity.ts";
import {
  inLinkedWorktree,
  inspectGitOperation,
  integrationBranch,
  mainRepoPath,
} from "../worktree/git.ts";
import { inspectInterruptedAcceptance } from "../worktree/acceptance_transaction.ts";
import {
  discoverSourceDependencies,
  gitValue,
  observeSource,
} from "../landing_queue/composition.ts";
import { registeredSourcePath } from "../landing_queue/public_authority.ts";
import { observedRecords, observeQueue } from "../landing_queue/repository.ts";
import {
  evaluatePredecessorPolicy,
  predecessorPolicyIdentity,
} from "../landing_queue/policy.ts";
import { compositionRecipe } from "../landing_queue/generation.ts";
import { observeCandidateValidation } from "../validation/candidate_observation.ts";
import { requirementSetIdentity } from "../validation/catalog.ts";
import { inspectCheckpointObligations } from "../checkpoints/inspection.ts";
import { configuredValidation } from "../validation/configuration.ts";
import { classifyScopeImpact } from "../scopes/scopes.ts";
import { sameSource } from "../landing_queue/model.ts";
import { type EmergencyExceptions, emergencyExceptions } from "./evidence.ts";

export const EMERGENCY_CONFIRMATION_MS = 15 * 60_000;
export interface EmergencyPlan {
  readonly root: string;
  readonly trunk: string;
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly reason: string;
  readonly exceptions: EmergencyExceptions;
  readonly observation: CompletionObservation;
  readonly review?: EnvironmentArtifact;
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
  const source = await observeSource(
    ctx.cwd,
    identity.id,
    await gitValue(ctx.cwd, ["symbolic-ref", "--quiet", "HEAD"]),
  );
  if (
    await registeredSourcePath(root, source) !== await Deno.realPath(ctx.cwd)
  ) {
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
  const observation = await observeQueue(root, trunk);
  if (
    observation.records.some(({ reading }) =>
      reading.kind !== "recorded" && reading.kind !== "missing"
    )
  ) {
    throw new Error(
      "Completion records are unreadable or unsupported. Preserve them and restore their reader before emergency integration.",
    );
  }
  const records = observedRecords(observation);
  for (const record of records) {
    if (
      record.kind === "landing" && await landingNeedsRecovery(root, record.data)
    ) {
      const action = record.data.claim.kind === "exception"
        ? `discern accept emergency --recover ${record.id}`
        : "discern accept";
      throw new Error(
        `Landing ${record.id} has unfinished settlement or checkout convergence. Run ${action} before preparing a new emergency plan.`,
      );
    }
  }
  const contained = await runGit([
    "merge-base",
    "--is-ancestor",
    observation.trunk,
    source.head,
  ], { cwd: root });
  if (!contained.success) {
    throw new Error(
      "The repair must contain actual trunk. Run discern update in this worktree, review and commit its result, then prepare a new emergency plan.",
    );
  }
  if (source.head === observation.trunk) {
    throw new Error(
      "This source is already on trunk. Use discern done to validate its current obligations.",
    );
  }
  const dependencies = await discoverSourceDependencies(
    root,
    source,
    observation.trunk,
    records.filter((record) => record.kind === "queue").flatMap((record) =>
      record.data.entries.map((entry) => entry.source)
    ),
  );
  if (dependencies.length) {
    throw new Error(
      "The repair contains unlanded work from another effort. Prepare a repair against actual trunk without those sources before requesting emergency authorization.",
    );
  }
  const policy = await predecessorPolicyIdentity(root, observation.trunk);
  const recipe = await compositionRecipe(
    ctx.cwd,
    ctx.config,
    DISCERN_VERSION,
    Math.max(1, ctx.config.gate.timeout),
    {},
  );
  const retained = records.find((record) =>
    record.kind === "candidate" && sameSource(record.data.source, source) &&
    record.data.head === source.head &&
    record.data.expected_predecessor.head === observation.trunk &&
    record.data.expected_predecessor.candidate_id === null &&
    record.data.dependencies.length === 0 && record.data.policy === policy
  );
  const id = retained?.kind === "candidate" ? retained.id : emergencyId(
    await sha256Hex(JSON.stringify([source, observation.trunk, policy])),
  );
  let candidate: Candidate = retained?.kind === "candidate" ? retained.data : {
    source,
    attempt_id: id,
    head: source.head,
    tree: source.tree,
    dependencies: [],
    expected_predecessor: { head: observation.trunk, candidate_id: null },
    policy,
    requirement_set: await requirementSetIdentity(
      (await configuredValidation(
        ctx.config,
        (await classifyScopeImpact(ctx.cwd, ctx.config)).scopes,
      )).obligations.map((entry) => entry.requirement),
    ),
    composition: {
      ...recipe.identity,
      merge_commit: null,
      regeneration_commit: null,
    },
  };
  const validation = await observeCandidateValidation({
    root: ctx.cwd,
    candidate_id: id,
    candidate,
    observation,
    context: "local",
  });
  candidate = {
    ...candidate,
    requirement_set: await requirementSetIdentity(
      validation.snapshot.requirements,
    ),
  };
  const policyBlockers = await evaluatePredecessorPolicy({
    root: ctx.cwd,
    config: validation.config,
    candidate,
    standards: validation.standards,
    current: { judgments: [], variances: [], proposals: [] },
    authorized: { judgments: [], variances: [], proposals: [] },
  });
  if (policyBlockers.length) {
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
      "Every configured machine obligation has current passing evidence. Use discern accept --dry-run to inspect ordinary acceptance. If this exact proven source was already integrated externally, use discern accept --reconcile --target <effort-id> --dry-run.",
    );
  }
  return {
    root: await Deno.realPath(root),
    trunk,
    candidate_id: id,
    candidate,
    reason: reason.trim(),
    exceptions,
    observation,
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
      predecessor: plan.candidate.expected_predecessor.head,
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

/** Hash every owner-relevant fact; observation counters and unrelated queue entries grant nothing. */
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
