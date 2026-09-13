import type { ProducerBoundary } from "./execute.ts";
/** Standalone work observes the working checkout and never reserves a completion attempt. */
import type { DiscernConfig } from "../../shared/config_schema.ts";
import { SYSTEM_SECURE_ENTROPY } from "../../shared/entropy.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { runGit } from "../../shared/subprocess.ts";
import type {
  DiagnosticExecution,
  ValidationDemand,
} from "../completion/protocol.ts";
import { CandidateSchema } from "../completion/candidate.ts";
import { newAttemptIdentity } from "../completion/identity.ts";
import { withCompletionCheckout } from "../operation_lock.ts";
import { seedForBranch } from "../worktree/identity.ts";
import { configuredValidation } from "./configuration.ts";
import { requirementSetIdentity } from "./catalog.ts";
import {
  executePublicValidation,
  type PublicValidationCapacity,
  type PublicValidationRun,
} from "./public_run.ts";

/** The reference names committed comparison coordinates; dirty bytes are captured in the snapshot.
 * No candidate, attempt, environment release, component receipt or Proof is published here.
 */
export async function standaloneValidation(input: {
  readonly root: string;
  readonly config: DiscernConfig;
  readonly scopes: readonly string[];
  readonly base?: string;
  readonly mode?: "strict" | "report";
  readonly kind: "test" | "standalone";
  readonly standards?: readonly string[];
  readonly signal?: AbortSignal;
  readonly producerBoundary?: ProducerBoundary;
  readonly capacity?: PublicValidationCapacity;
  readonly onProgress?: Parameters<
    typeof executePublicValidation
  >[0]["onProgress"];
}): Promise<PublicValidationRun> {
  const root = await Deno.realPath(input.root);
  return await withCompletionCheckout(root, async (signal) => {
    const stageDependencies = input.kind === "standalone" &&
      input.standards === undefined;
    const configured = await configuredValidation(
      input.config,
      input.scopes,
      stageDependencies,
    );
    const mode = input.mode ?? "strict";
    const effort = `diagnostic-${await sha256Hex(root)}`;
    const facts = await runGit(["rev-parse", "HEAD", "HEAD^{tree}"], {
      cwd: root,
    });
    if (!facts.success) {
      throw new Error(
        "Standalone validation needs a committed comparison reference; commit the initial project before running this command.",
      );
    }
    const [head, tree] = facts.stdout.trim().split("\n");
    const branch = await runGit(["symbolic-ref", "--quiet", "HEAD"], {
      cwd: root,
    });
    const candidateId = SYSTEM_SECURE_ENTROPY.uuid();
    const executor = {
      operation_id: SYSTEM_SECURE_ENTROPY.uuid(),
      originating_effort: effort,
      started_at: SYSTEM_CLOCK.wallNow(),
    };
    const attempt = newAttemptIdentity({
      candidate_id: candidateId,
      executor,
      sequence: 1,
      rerun_of: null,
    });
    const reference = await sha256Hex(
      JSON.stringify(["standalone-reference", head]),
    );
    const candidate = CandidateSchema.parse({
      attempt_id: attempt.id,
      // Detached diagnostics have no authored branch and never become a candidate record.
      sources: [{
        effort_id: effort,
        branch: branch.success
          ? branch.stdout.trim()
          : "refs/heads/discern-diagnostic-reference",
        head,
        tree,
      }],
      predecessor: input.base === undefined
        ? head
        : (await runGit(["rev-parse", "--verify", `${input.base}^{commit}`], {
          cwd: root,
        })).stdout.trim(),
      head,
      tree,
      policy: reference,
      requirement_set: await requirementSetIdentity(
        configured.obligations.map((obligation) => obligation.requirement),
      ),
    });
    const execution: DiagnosticExecution = {
      diagnostic: true,
      attempt: { identity: attempt, subjects: [], mode, purpose: "diagnostic" },
      path: root,
      seed: seedForBranch(
        branch.success
          ? branch.stdout.trim().replace(/^refs\/heads\//u, "")
          : head ?? "diagnostic",
      ),
      candidate_id: candidateId,
      candidate,
      signal,
    };
    const demand: ValidationDemand = input.kind === "test"
      ? {
        kind: "test",
        mode,
        readings: "already-produced",
        producers: [...configured.stages].filter(([, stage]) =>
          stage === "test"
        ).map(([selector]) => selector),
      }
      : {
        kind: "standalone",
        mode,
        requirements: configured.obligations.filter((entry) =>
          input.standards === undefined ||
          entry.requirement.kind === "standard" &&
            input.standards.includes(entry.requirement.id)
        ).map((entry) => entry.requirement),
      };
    return await executePublicValidation({
      root,
      config: input.config,
      scopes: input.scopes,
      claimed: execution,
      demand,
      stageDependencies,
      ...(input.capacity === undefined ? {} : { capacity: input.capacity }),
      ...(input.producerBoundary === undefined
        ? {}
        : { producerBoundary: input.producerBoundary }),
      ...(input.onProgress === undefined
        ? {}
        : { onProgress: input.onProgress }),
    });
  }, input.signal);
}
