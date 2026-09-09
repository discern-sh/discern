/**
 * The setup **environment probe**: prove a declared `[execution.<context>]`
 * contract in a throwaway worktree before setup completes.
 *
 * A declaration says a project can prepare a checkout for a differing
 * candidate and return it to source-ready state. Setup does not take that on
 * trust. Inside the disposable probe worktree, this module enrolls the
 * checkout as a borrowed environment, releases it, and drives the real
 * environment executor three times against a candidate whose tree differs from
 * the source: once where validation passes, once where it fails, and once where
 * it is cancelled mid-validation. Each time the executor must return the
 * checkout to the exact source branch, head, index, and file state through the
 * project's own restore procedure. The probe then retires its enrollment.
 *
 * What the probe establishes is the environment contract: preparation runs,
 * the candidate is installed, and return is verified after every outcome.
 * It issues no Proof, records no evidence, and touches only state it created.
 * A same-commit rebuild or a clean `git status` alone proves none of this; the
 * executor's own return verification does.
 */

import { join } from "@std/path";
import type {
  DiscernConfig,
  EnvironmentDeclaration,
} from "../../shared/config_schema.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { runGit } from "../../shared/subprocess.ts";
import { statIfExists } from "../../shared/fs_presence.ts";
import type { EnvironmentProbeSummary } from "../../shared/environment_probe.ts";
import { pathMatchesPattern } from "../scopes/glob.ts";
import { bytesDigest } from "../validation/artifacts.ts";
import type { Candidate } from "../completion/candidate.ts";
import {
  type Executor,
  newAttemptIdentity,
  type SourceRevision,
} from "../completion/identity.ts";
import type { ValidationPlan } from "../completion/protocol.ts";
import { withCompletionCheckout } from "../operation_lock.ts";
import {
  loadIdentitySettings,
  resolveIdentity,
  resourceForId,
} from "../worktree/identity.ts";
import { worktreeGitKey } from "../worktree/git.ts";
import { createEnvironmentExecutor } from "./executor.ts";
import { createNativeExecutionLifetime } from "./lifetime.ts";
import { validationWorkspace } from "./public_environment.ts";
import {
  registerExecutionEnvironment,
  releaseExecutionEnvironment,
  requireEnvironment,
  retireBorrowedEnrollment,
} from "./registry.ts";
import { errorReason } from "./types.ts";

/** The tracked file the probe's differing candidate adds; never present in source. */
export const PROBE_CANDIDATE_PATH = "environment-probe-candidate.txt";
/** The owned untracked file the probe writes while a candidate is installed. */
export const PROBE_OUTPUT_PATH = "environment-probe-output.txt";

/** The three outcomes every declared environment must return from. */
export const PROBE_EXERCISES = ["success", "failure", "cancellation"] as const;
export type ProbeExercise = (typeof PROBE_EXERCISES)[number];

/** Where a probe stopped when it could not establish the contract. */
export type ProbeStage = "enroll" | "release" | ProbeExercise | "retire";

/** One declared context's probe result. */
export type EnvironmentProbeOutcome =
  | {
    readonly kind: "proven";
    readonly context: string;
    readonly environment_id: string;
    readonly exercised: readonly ProbeExercise[];
    /** The exact source the checkout returned to after every exercise. */
    readonly source: { readonly branch: string; readonly head: string };
  }
  | {
    readonly kind: "failed";
    readonly context: string;
    readonly environment_id?: string;
    readonly stage: ProbeStage;
    readonly detail: string;
  };

/** The setup-wide result: the public summary plus each context's outcome. */
export interface EnvironmentProbeReport extends EnvironmentProbeSummary {
  readonly outcomes: readonly EnvironmentProbeOutcome[];
}

/** One Git value from the probe checkout; a failure is a probe failure, never an empty identity. */
async function gitValue(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGit([...args], { cwd });
  if (!result.success) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

/** Mint a commit whose tree adds one tracked file, without touching the checkout or index. */
async function differingCandidateCommit(
  cwd: string,
  sourceHead: string,
): Promise<{ head: string; tree: string }> {
  const blob = await runGit(["hash-object", "-w", "--stdin"], {
    cwd,
    stdin: "discern environment probe candidate\n",
  });
  if (!blob.success) throw new Error(blob.stderr.trim());
  const listing = await runGit(["ls-tree", "-z", sourceHead], { cwd });
  if (!listing.success) throw new Error(listing.stderr.trim());
  const entries = listing.stdout.split("\0").filter(Boolean);
  if (
    entries.some((entry) =>
      entry.slice(entry.indexOf("\t") + 1) ===
        PROBE_CANDIDATE_PATH
    )
  ) {
    throw new Error(
      `The source already tracks ${PROBE_CANDIDATE_PATH}; the probe cannot add a differing file.`,
    );
  }
  const tree = await runGit(["mktree", "-z"], {
    cwd,
    stdin:
      [...entries, `100644 blob ${blob.stdout.trim()}\t${PROBE_CANDIDATE_PATH}`]
        .join("\0") + "\0",
  });
  if (!tree.success) throw new Error(tree.stderr.trim());
  const commit = await runGit([
    "commit-tree",
    tree.stdout.trim(),
    "-p",
    sourceHead,
    "-m",
    "discern environment probe candidate",
  ], { cwd });
  if (!commit.success) throw new Error(commit.stderr.trim());
  return { head: commit.stdout.trim(), tree: tree.stdout.trim() };
}

/**
 * Digest every ignored file the declaration says its return procedure restores.
 * Git cleanliness says nothing about these files, so the probe compares them
 * itself before the first exercise and after every return.
 */
async function declaredIgnoredFingerprint(
  cwd: string,
  ignored: readonly string[],
): Promise<Map<string, string>> {
  const fingerprint = new Map<string, string>();
  if (ignored.length === 0) return fingerprint;
  const listing = await runGit(
    ["ls-files", "-z", "--others", "--ignored", "--exclude-standard"],
    { cwd },
  );
  if (!listing.success) throw new Error(listing.stderr.trim());
  for (const path of listing.stdout.split("\0").filter(Boolean)) {
    if (!ignored.some((pattern) => pathMatchesPattern(path, pattern))) continue;
    const bytes = await Deno.readFile(join(cwd, path));
    fingerprint.set(path, await bytesDigest(bytes));
  }
  return fingerprint;
}

/** Name every declared ignored file whose bytes differ from the source fingerprint. */
function ignoredDrift(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const drift: string[] = [];
  for (const [path, digest] of before) {
    const current = after.get(path);
    if (current === undefined) drift.push(`${path} (missing)`);
    else if (current !== digest) drift.push(`${path} (changed)`);
  }
  for (const path of after.keys()) {
    if (!before.has(path)) drift.push(`${path} (new)`);
  }
  return drift.sort();
}

/** Confirm the checkout sits on the recorded source with nothing left behind. */
async function assertSourceReady(
  cwd: string,
  source: SourceRevision,
  declaration: EnvironmentDeclaration,
  ignoredBefore: ReadonlyMap<string, string>,
): Promise<void> {
  const branch = await gitValue(cwd, ["symbolic-ref", "HEAD"]);
  const head = await gitValue(cwd, ["rev-parse", "HEAD"]);
  const status = await gitValue(cwd, ["status", "--porcelain"]);
  const leftovers = (await Promise.all(
    [PROBE_CANDIDATE_PATH, PROBE_OUTPUT_PATH].map(async (path) =>
      await statIfExists(join(cwd, path)) === undefined ? [] : [path]
    ),
  )).flat();
  const drift = ignoredDrift(
    ignoredBefore,
    await declaredIgnoredFingerprint(cwd, declaration.ignored),
  );
  const problems = [
    branch === source.branch ? undefined : `HEAD is on ${branch}`,
    head === source.head ? undefined : `HEAD is ${head.slice(0, 12)}`,
    status === "" ? undefined : "the checkout or index has changes",
    leftovers.length === 0
      ? undefined
      : `probe files remain: ${leftovers.join(", ")}`,
    drift.length === 0
      ? undefined
      : `the declared restore left ignored output different from the source: ${
        drift.join(", ")
      }`,
  ].filter((problem): problem is string => problem !== undefined);
  if (problems.length > 0) {
    throw new Error(
      `The checkout did not return to its source (${source.branch} at ${
        source.head.slice(0, 12)
      }): ${problems.join("; ")}.`,
    );
  }
}

/** A caller's progress sink; setup narrates each stage from it. */
export type ProbeObserver = (event: {
  readonly context: string;
  readonly stage: ProbeStage;
  readonly state: "started" | "finished";
}) => void;

/** Probe one declared context inside the checkout's completion scope. */
async function probeContext(
  probeDir: string,
  config: DiscernConfig,
  context: string,
  declaration: EnvironmentDeclaration,
  observe: ProbeObserver,
): Promise<EnvironmentProbeOutcome> {
  let stage: ProbeStage = "enroll";
  const enter = (next: ProbeStage): void => {
    observe({ context, stage, state: "finished" });
    stage = next;
    observe({ context, stage, state: "started" });
  };
  let environmentId: string | undefined;
  observe({ context, stage, state: "started" });
  try {
    return await withCompletionCheckout(probeDir, async (signal) => {
      const dirty = await gitValue(probeDir, ["status", "--porcelain"]);
      if (dirty !== "") {
        throw new Error(
          "The probe worktree has uncommitted changes; the probe touches only state it creates, so it will not proceed.",
        );
      }
      const settings = await loadIdentitySettings(probeDir);
      const identity = await resolveIdentity(probeDir, probeDir);
      const branch = await gitValue(probeDir, ["symbolic-ref", "HEAD"]);
      const source: SourceRevision = {
        effort_id: identity.id,
        branch,
        head: await gitValue(probeDir, ["rev-parse", "HEAD"]),
        tree: await gitValue(probeDir, ["rev-parse", "HEAD^{tree}"]),
      };
      const actor: Executor = {
        operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
        originating_effort: identity.id,
        started_at: SYSTEM_CLOCK.wallNow(),
      };
      const id = SYSTEM_SECURE_ENTROPY.uuid();
      environmentId = id;
      const lifetime = createNativeExecutionLifetime(probeDir);
      const workspace = validationWorkspace(probeDir, config, id, settings);
      const resources = declaration.resources.length > 0
        ? declaration.resources
        : await worktreeGitKey(probeDir) === undefined
        ? []
        : Object.keys(config.worktree.resources);
      await registerExecutionEnvironment(probeDir, id, {
        path: probeDir,
        ownership: {
          kind: "borrowed",
          source,
          identity: {
            worktree_id: identity.id,
            seed: identity.seed,
            resources: Object.fromEntries(
              resources.map((name) => [
                name,
                resourceForId(settings.slug, identity.id, name),
              ]),
            ),
          },
        },
      }, declaration);
      const release = async (): Promise<void> => {
        enter("release");
        const current = await requireEnvironment(probeDir, id);
        await releaseExecutionEnvironment(
          probeDir,
          id,
          current.stamp,
          actor,
          declaration,
          { lifetime, workspace },
          { signal },
        );
      };
      const minted = await differingCandidateCommit(probeDir, source.head);
      const digest = await sha256Hex(`discern environment probe ${id}`);
      const candidate: Candidate = {
        attempt_id: SYSTEM_SECURE_ENTROPY.uuid(),
        source,
        dependencies: [],
        expected_predecessor: { head: source.head, candidate_id: null },
        head: minted.head,
        tree: minted.tree,
        policy: digest,
        requirement_set: digest,
        composition: {
          procedure: digest,
          generated_ownership: digest,
          generators: digest,
          merge_commit: null,
          regeneration_commit: null,
        },
      };
      const plan: ValidationPlan = {
        candidate_id: SYSTEM_SECURE_ENTROPY.uuid(),
        candidate,
        // Diagnostic purpose: probe attempts never count as completion work.
        demand: {
          kind: "test",
          context,
          mode: "strict",
          producers: [],
          readings: "already-produced",
        },
        producers: [],
        reused: [],
        blockers: [],
      };
      const ignoredBefore = await declaredIgnoredFingerprint(
        probeDir,
        declaration.ignored,
      );
      let sequence = 0;
      const exercised: ProbeExercise[] = [];
      for (const exercise of PROBE_EXERCISES) {
        await release();
        enter(exercise);
        const controller = new AbortController();
        const executor = createEnvironmentExecutor({
          root: probeDir,
          environmentId: id,
          declaration,
          workspace,
          lifetime,
          leaseMs: Math.max(1, config.gate.timeout) * 1_000 * 4 + 60_000,
          signal: AbortSignal.any([signal, controller.signal]),
          reserveAttempt: (planned, executor) =>
            Promise.resolve(newAttemptIdentity({
              candidate_id: planned.candidate_id,
              executor,
              sequence: ++sequence,
              rerun_of: null,
            })),
          validationOutcome: (value) => value === true ? "passed" : "failed",
        });
        const observed = await executor.observe(id);
        const selected = executor.plan({
          trunk: source.head,
          observed_at: SYSTEM_CLOCK.wallNow(),
          records: [{
            selector: { kind: "environment", id },
            reading: observed,
          }],
        }, plan);
        if ("kind" in selected) {
          throw new Error(
            `The released environment could not be planned for a differing candidate: ${
              "reason" in selected ? selected.reason : selected.kind
            }`,
          );
        }
        const claimed = await executor.claim(selected, actor);
        if ("kind" in claimed) {
          throw new Error(
            `The environment could not be claimed: ${
              "reason" in claimed ? claimed.reason : claimed.kind
            }`,
          );
        }
        const result = await executor.execute(claimed, async () => {
          // Candidate output: the differing commit is installed, detached.
          const head = await gitValue(probeDir, ["rev-parse", "HEAD"]);
          const candidateFile = await statIfExists(
            join(probeDir, PROBE_CANDIDATE_PATH),
          );
          if (head !== minted.head || candidateFile === undefined) {
            throw new Error(
              `Preparation did not install the candidate: HEAD is ${
                head.slice(0, 12)
              } and ${PROBE_CANDIDATE_PATH} is ${
                candidateFile === undefined ? "absent" : "present"
              }.`,
            );
          }
          // Owned drift the return must capture and remove.
          await Deno.writeTextFile(
            join(probeDir, PROBE_OUTPUT_PATH),
            `probe ${exercise}\n`,
          );
          if (exercise === "cancellation") controller.abort();
          return exercise === "success";
        });
        if (result.returned.kind !== "restored") {
          const reason = result.returned.kind === "recovery-incomplete"
            ? result.returned.recovery.reason
            : result.returned.kind;
          throw new Error(
            `After ${exercise}, the checkout did not return through the declared restore procedure: ${reason}`,
          );
        }
        await assertSourceReady(probeDir, source, declaration, ignoredBefore);
        exercised.push(exercise);
      }
      enter("retire");
      const current = await requireEnvironment(probeDir, id);
      await retireBorrowedEnrollment(
        probeDir,
        id,
        current.stamp,
        actor,
        lifetime,
      );
      return {
        kind: "proven",
        context,
        environment_id: id,
        exercised,
        source: { branch: source.branch, head: source.head },
      };
    });
  } catch (error) {
    return {
      kind: "failed",
      context,
      ...(environmentId === undefined ? {} : { environment_id: environmentId }),
      stage,
      detail: errorReason(error),
    };
  }
}

/**
 * Probe every required context that declares an environment. Contexts without a
 * declaration are reported, not probed: they validate and land in order.
 */
export async function probeExecutionEnvironments(
  probeDir: string,
  config: DiscernConfig,
  observe: ProbeObserver = () => {},
): Promise<EnvironmentProbeReport> {
  const proven: string[] = [];
  const undeclared: string[] = [];
  const outcomes: EnvironmentProbeOutcome[] = [];
  for (const context of config.completion.required_contexts) {
    const declaration = config.execution[context];
    if (declaration === undefined) {
      undeclared.push(context);
      continue;
    }
    const outcome = await probeContext(
      probeDir,
      config,
      context,
      declaration,
      observe,
    );
    outcomes.push(outcome);
    if (outcome.kind === "proven") proven.push(context);
  }
  return { proven, undeclared, outcomes };
}
