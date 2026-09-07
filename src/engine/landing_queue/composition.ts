import { emitCompletionProgress } from "../completion/events.ts";
import { ON_DISK_FORMATS } from "../../shared/on_disk_formats.ts";
/** Immutable composition in an explicitly claimed checkout; source branches never move. */
import { type Candidate, CandidateSchema } from "../completion/candidate.ts";
import {
  candidateRef,
  type SourceRevision,
  SourceRevisionSchema,
} from "../completion/identity.ts";
import type {
  ClaimedExecution,
  CompletionBlocker,
} from "../completion/protocol.ts";
import {
  type PublicationFence,
  readCompletionRecord,
  writeCompletionRecord,
} from "../completion/store.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { runGit } from "../../shared/subprocess.ts";
import { splitNulRecords } from "../../shared/git_paths.ts";
import {
  commitUpdateRegeneration,
  resolveCommonGitDir,
  updateMain,
} from "../worktree/git.ts";
import { requireQueue, withQueueLock } from "./repository.ts";
import { sameSource } from "./model.ts";
import { generatedGroupForPath } from "../../shared/generated_artifacts.ts";
import { type CompositionRecipe, convergeGenerated } from "./generation.ts";
import { saveEnvironmentArtifact } from "../execution/artifacts.ts";
import { artifactPath } from "../execution/artifact_read.ts";
import { decodeJson } from "../../shared/runtime_decode.ts";
import { readTextIfExists } from "../../shared/fs_presence.ts";

/** A failed Git observation cannot become an empty identity. */
export async function gitValue(
  root: string,
  args: readonly string[],
): Promise<string> {
  return (await gitOutput(root, args)).trim();
}

/** Keep NUL-delimited path bytes intact, including leading whitespace. */
async function gitOutput(
  root: string,
  args: readonly string[],
): Promise<string> {
  const result = await runGit([...args], { cwd: root });
  if (!result.success) {
    throw new Error(
      result.stderr || "Git could not establish the composition subject.",
    );
  }
  return result.stdout;
}

/** Resolve a mutable source branch once into immutable commit and tree coordinates. */
export async function observeSource(
  root: string,
  effort: string,
  branch: string,
): Promise<SourceRevision> {
  const head = await gitValue(root, [
    "rev-parse",
    "--verify",
    `${branch}^{commit}`,
  ]);
  return SourceRevisionSchema.parse({
    effort_id: effort,
    branch,
    head,
    tree: await gitValue(root, ["rev-parse", `${head}^{tree}`]),
  });
}

/** Dependencies are observed against immutable published tips; branch names never select a merge. */
export async function discoverSourceDependencies(
  root: string,
  source: SourceRevision,
  trunk: string,
  sources: readonly SourceRevision[],
): Promise<SourceRevision[]> {
  const dependencies: SourceRevision[] = [];
  for (const other of sources) {
    if (other.effort_id === source.effort_id) continue;
    const contained = await runGit([
      "merge-base",
      "--is-ancestor",
      other.head,
      source.head,
    ], { cwd: root });
    const landed = await runGit([
      "merge-base",
      "--is-ancestor",
      other.head,
      trunk,
    ], { cwd: root });
    if (
      (!contained.success && contained.code !== 1) ||
      (!landed.success && landed.code !== 1)
    ) {
      throw new Error("Source dependency ancestry is unavailable.");
    }
    if (contained.success && !landed.success) {
      const prior = dependencies.findIndex((source) =>
        source.effort_id === other.effort_id
      );
      const existing = dependencies[prior];
      if (existing === undefined) dependencies.push(other);
      else if (existing.head !== other.head) {
        const older = await runGit([
          "merge-base",
          "--is-ancestor",
          existing.head,
          other.head,
        ], { cwd: root });
        const newer = await runGit([
          "merge-base",
          "--is-ancestor",
          other.head,
          existing.head,
        ], { cwd: root });
        if (older.success) dependencies[prior] = other;
        else if (!newer.success) {
          throw new Error(
            "The source contains divergent revisions of one effort; resolve its source authority before composing.",
          );
        }
      }
    }
  }
  return dependencies;
}

/** Expired, terminal, and superseded attempts cannot perform composition publication. */
export async function requireLiveFence(
  root: string,
  fence: PublicationFence,
  clock: Clock,
): Promise<void> {
  const reading = await readCompletionRecord(root, {
    kind: "attempt",
    id: fence.attempt_id,
  });
  if (
    reading.kind !== "recorded" || reading.record.kind !== "attempt" ||
    (reading.record.data.state.kind !== "claimed" &&
      reading.record.data.state.kind !== "composing") ||
    reading.record.data.state.claim.token !== fence.token ||
    reading.record.data.state.claim.expires_at <= clock.wallNow()
  ) {
    throw new Error(
      "The composition attempt was superseded or requires recovery.",
    );
  }
}

/** Only declared generator groups and compiler-owned outputs permit convergence. */
function owns(recipe: CompositionRecipe, path: string): boolean {
  return recipe.built_in_paths.includes(path) ||
    generatedGroupForPath(recipe.groups, path) !== undefined;
}

/** Call within EnvironmentExecutor.execute: its lifetime capability holds checkout exclusion. */
export async function composeCandidate(input: {
  readonly root: string;
  readonly execution: ClaimedExecution;
  readonly recipe: CompositionRecipe;
  /** Re-establish the declared environment for merged dependencies before generators execute. */
  readonly prepare: () => Promise<void>;
  readonly dependencies: readonly SourceRevision[];
  readonly predecessor: Candidate["expected_predecessor"];
  readonly policy: string;
  readonly requirement_set: string;
  /** Resolve obligations from the fully composed tree before publishing its receipt. */
  readonly requirements?: (path: string) => Promise<string>;
  readonly clock?: Clock;
}): Promise<Candidate | CompletionBlocker> {
  const { execution, recipe } = input;
  const clock = input.clock ?? SYSTEM_CLOCK;
  const path = execution.environment.path;
  const source = execution.candidate.source;
  await requireLiveFence(input.root, execution.fence, clock);
  const environment = await readCompletionRecord(input.root, {
    kind: "environment",
    id: execution.environment_id,
  });
  if (
    environment.kind !== "recorded" ||
    environment.record.kind !== "environment" ||
    environment.record.data.state.kind !== "executing" ||
    environment.record.data.state.attempt_id !== execution.fence.attempt_id ||
    environment.record.data.state.claim.token !== execution.fence.token ||
    environment.record.data.path !== path ||
    await resolveCommonGitDir(input.root) !== await resolveCommonGitDir(path)
  ) {
    return {
      kind: "environment-unavailable",
      reason:
        "Composition requires the current exclusive environment claim in this repository.",
    };
  }
  if (
    await gitValue(path, ["rev-parse", "HEAD"]) !== source.head ||
    await gitValue(path, [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]) !== ""
  ) {
    return {
      kind: "missing-judgment",
      subjects: ["composition-checkout-changed"],
    };
  }
  const contained = await runGit([
    "merge-base",
    "--is-ancestor",
    input.predecessor.head,
    source.head,
  ], { cwd: path });
  if (!contained.success && contained.code !== 1) {
    throw new Error("Expected predecessor ancestry is unavailable.");
  }
  let merge: string | null = null;
  let regeneration: string | null = null;
  if (!contained.success) {
    const branch = await runGit(["symbolic-ref", "--quiet", "HEAD"], {
      cwd: path,
    });
    if (
      branch.success || branch.code !== 1 ||
      execution.environment.state.kind !== "executing"
    ) {
      return {
        kind: "environment-unavailable",
        reason:
          "Temporary composition requires the released environment's exclusively claimed detached checkout.",
      };
    }
    const outcome = await updateMain(path, undefined, {
      from: input.predecessor.head,
      autoResolvable: (file) => owns(recipe, file),
    });
    if (outcome.kind === "conflict" && !outcome.aborted) {
      return {
        kind: "recovery-incomplete",
        record_id: execution.environment_id,
        recovery: {
          phase: "install",
          reason:
            "The substantive merge could not be aborted; recover the recorded environment before another attempt.",
          children_quiescent: false,
          drift: {
            kind: "uncaptured",
            reason:
              "The environment must capture the incomplete merge before restoring its source.",
          },
          retained_paths: [path],
          frozen_cleanup: [],
        },
      };
    }
    if (outcome.kind === "conflict") {
      return { kind: "missing-judgment", subjects: outcome.files };
    }
    if (outcome.kind !== "updated") {
      return {
        kind: "environment-unavailable",
        reason:
          `Composition is ${outcome.kind}; reconcile the checkout before retrying.`,
      };
    }
    merge = outcome.after;
    await requireLiveFence(input.root, execution.fence, clock);
    emitCompletionProgress({
      phase: "environment",
      state: "preparing-composition",
      candidate_id: execution.candidate_id,
      reason:
        "Preparing the merged candidate before generation and validation.",
    });
    await input.prepare();
    await requireLiveFence(input.root, execution.fence, clock);
    const convergence = await convergeGenerated(execution, recipe);
    if (convergence !== undefined) return convergence;
    const changed = splitNulRecords(
      await gitOutput(path, [
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        "HEAD",
      ]),
    );
    const untracked = splitNulRecords(
      await gitOutput(path, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]),
    );
    const paths = [...new Set([...changed, ...untracked])];
    const authored = paths.filter((file) => !owns(recipe, file));
    if (authored.length > 0) {
      return { kind: "missing-judgment", subjects: authored };
    }
    if (paths.length > 0) {
      const committed = await commitUpdateRegeneration(path, paths);
      if (!committed.success) {
        return {
          kind: "environment-unavailable",
          reason: committed.stderr ||
            "Generated convergence could not be committed.",
        };
      }
      regeneration = await gitValue(path, ["rev-parse", "HEAD"]);
    }
  }
  await requireLiveFence(input.root, execution.fence, clock);
  const [head, tree] = (await gitValue(path, [
    "rev-parse",
    "HEAD",
    "HEAD^{tree}",
  ])).split("\n");
  if (head === undefined || tree === undefined) {
    throw new Error("Git returned an incomplete candidate identity.");
  }
  const candidate = CandidateSchema.parse({
    attempt_id: execution.fence.attempt_id,
    source,
    dependencies: [...input.dependencies],
    expected_predecessor: input.predecessor,
    head,
    tree,
    policy: input.policy,
    requirement_set: input.requirements === undefined
      ? input.requirement_set
      : await input.requirements(path),
    composition: {
      ...recipe.identity,
      merge_commit: merge,
      regeneration_commit: regeneration,
    },
  });
  await saveEnvironmentArtifact(
    await Deno.realPath(input.root),
    {
      attempt_id: execution.fence.attempt_id,
      candidate_id: execution.candidate_id,
      context: "local",
    },
    "queue-composition",
    candidate,
  );
  return candidate;
}

/** Only the composition executor writes this create-only receipt after its generator run. */
async function compositionReceiptMatches(
  root: string,
  candidate: Candidate,
): Promise<boolean> {
  const path = await artifactPath(
    await Deno.realPath(root),
    candidate.attempt_id,
    "environment/queue-composition.json",
  );
  const raw = await readTextIfExists(path);
  return raw !== undefined &&
    JSON.stringify(decodeJson(CandidateSchema, raw, path)) ===
      JSON.stringify(candidate);
}

/** A source-only measurement retains its exact comparison object without selecting queue work. */
export async function retainMeasurementCandidate(
  root: string,
  id: string,
  candidate: Candidate,
  fence: PublicationFence,
  clock: Clock = SYSTEM_CLOCK,
): Promise<void> {
  return await retainCandidate(
    root,
    id,
    candidate,
    fence,
    "source-measurement",
    clock,
  );
}

/** Queued composition requires the current queue selection as well as its live execution fence. */
export async function publishCandidate(
  root: string,
  id: string,
  candidate: Candidate,
  fence: PublicationFence,
  clock: Clock = SYSTEM_CLOCK,
): Promise<void> {
  return await retainCandidate(root, id, candidate, fence, "queue", clock);
}

/** Both retention paths create immutable objects only; neither path issues readiness or Proof. */
async function retainCandidate(
  root: string,
  id: string,
  candidate: Candidate,
  fence: PublicationFence,
  selection: "queue" | "source-measurement",
  clock: Clock,
): Promise<void> {
  CandidateSchema.parse(candidate);
  await withQueueLock(root, async () => {
    await requireLiveFence(root, fence, clock);
    const attempt = await readCompletionRecord(root, {
      kind: "attempt",
      id: fence.attempt_id,
    });
    if (
      attempt.kind !== "recorded" || attempt.record.kind !== "attempt" ||
      attempt.record.data.identity.candidate_id !== id
    ) throw new Error("Candidate belongs to another attempt identity.");
    if (candidate.attempt_id !== fence.attempt_id) {
      throw new Error("Candidate names another attempt.");
    }
    if (selection === "queue") {
      const queue = await requireQueue(root);
      const selected = queue.record.data.entries.find((entry) =>
        entry.source.effort_id === candidate.source.effort_id
      );
      if (
        selected?.candidate_id !== id || selected.state !== "active" ||
        selected.invalidation !== null ||
        !sameSource(selected.source, candidate.source)
      ) {
        throw new Error(
          "Candidate selection was superseded before publication.",
        );
      }
    } else if (
      candidate.head !== candidate.source.head ||
      candidate.tree !== candidate.source.tree ||
      candidate.dependencies.length !== 0 ||
      candidate.composition.merge_commit !== null ||
      candidate.composition.regeneration_commit !== null ||
      await gitValue(root, ["rev-parse", candidate.source.branch]) !==
        candidate.source.head ||
      await gitValue(root, ["rev-parse", "HEAD"]) !== candidate.source.head
    ) {
      throw new Error(
        "Standalone measurement retention requires the unchanged authored source; update before measuring a composition.",
      );
    }
    // Queue candidates must reproduce composition; source-only measurements prove
    // their unchanged authored coordinates above and never claim generated convergence.
    if (
      selection === "queue" && !await compositionReceiptMatches(root, candidate)
    ) {
      throw new Error(
        "Candidate lacks the exact completed composition receipt.",
      );
    }
    const ref = candidateRef(id, candidate.attempt_id);
    const existing = await runGit(["rev-parse", "--verify", "--quiet", ref], {
      cwd: root,
    });
    if (existing.success && existing.stdout.trim() !== candidate.head) {
      throw new Error(
        "Candidate ref already retains another immutable object.",
      );
    }
    if (!existing.success && existing.code !== 1) {
      throw new Error("Candidate ref observation is unavailable.");
    }
    if (!existing.success) {
      await gitValue(root, [
        "update-ref",
        ref,
        candidate.head,
        "0".repeat(candidate.head.length),
      ]);
    }
    if (
      await gitValue(root, ["rev-parse", `${ref}^{tree}`]) !== candidate.tree
    ) throw new Error("Candidate tree differs from its retained object.");
    const current = await readCompletionRecord(root, { kind: "candidate", id });
    if (
      current.kind === "recorded" && current.record.kind === "candidate" &&
      JSON.stringify(current.record.data) === JSON.stringify(candidate)
    ) return;
    const outcome = await writeCompletionRecord(
      root,
      {
        version: ON_DISK_FORMATS.completionRecord.version,
        kind: "candidate",
        id,
        revision: 1,
        data: candidate,
      },
      null,
      fence,
      clock,
    );
    if (outcome.kind !== "written") {
      throw new Error(
        `Candidate publication ${outcome.kind}; retain the ref and reconcile its record.`,
      );
    }
  });
}

/** Authority readers reject any head beyond the recorded composition and generated commit. */
export async function verifyComposition(
  root: string,
  candidate: Candidate,
  recipe: CompositionRecipe,
): Promise<boolean> {
  if (!await compositionReceiptMatches(root, candidate)) return false;
  if (
    JSON.stringify({
      procedure: candidate.composition.procedure,
      generated_ownership: candidate.composition.generated_ownership,
      generators: candidate.composition.generators,
    }) !== JSON.stringify(recipe.identity)
  ) return false;
  const merge = candidate.composition.merge_commit;
  const regeneration = candidate.composition.regeneration_commit;
  if (
    await gitValue(root, ["rev-parse", `${candidate.head}^{tree}`]) !==
      candidate.tree
  ) return false;
  if (merge === null) {
    return regeneration === null && candidate.head === candidate.source.head;
  }
  const parents = (await gitValue(root, ["show", "-s", "--format=%P", merge]))
    .split(" ");
  if (merge === candidate.expected_predecessor.head) {
    const contained = await runGit([
      "merge-base",
      "--is-ancestor",
      candidate.source.head,
      merge,
    ], { cwd: root });
    if (!contained.success) return false;
  } else if (
    JSON.stringify(parents) !==
      JSON.stringify([
        candidate.source.head,
        candidate.expected_predecessor.head,
      ])
  ) return false;
  if (regeneration === null) return candidate.head === merge;
  if (
    candidate.head !== regeneration ||
    await gitValue(root, ["show", "-s", "--format=%P", regeneration]) !== merge
  ) return false;
  const diff = await runGit(
    ["diff", "--no-renames", "--name-only", "-z", merge, regeneration],
    { cwd: root },
  );
  return diff.success &&
    splitNulRecords(diff.stdout).every((path) => owns(recipe, path));
}
