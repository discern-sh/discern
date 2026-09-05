/** Production adapters use existing supervised jobs, common records and bounded artifacts. */
import { join } from "@std/path";
import type {
  ClaimedExecution,
  CompletionObservation,
  ProducerDemand,
} from "../completion/protocol.ts";
import {
  COMPLETION_FAMILIES,
  type RecordSelector,
} from "../completion/records.ts";
import { readCompletionRecord } from "../completion/store.ts";
import { RecordIdSchema } from "../completion/identity.ts";
import type { EnvReader } from "../../shared/env.ts";
import { spawnedByEnv } from "../../shared/invocation_context.ts";
import { jobEnvironment } from "../jobs/command.ts";
import { AttemptSchema, EnvironmentSchema } from "../completion/environment.ts";
import { CandidateSchema } from "../completion/candidate.ts";
import { runGit } from "../../shared/subprocess.ts";
import { gitAdminStatePath } from "../../shared/git_admin_state.ts";
import { sha256Hex } from "../../shared/sha256.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { resolveContainedProjectWritePath } from "../../shared/project_path.ts";
import { readCompleteCapture, runCapturedCommands } from "../jobs/captured.ts";
import {
  commands,
  type ResolvedObligation,
  type ValidationConditions,
  type ValidationInputs,
} from "./catalog.ts";
import {
  artifactStamp,
  bytesDigest,
  captureProducedArtifact,
  readArtifact,
  retainArtifact,
} from "./artifacts.ts";
import type { ProducerCapture, ValidationRuntime } from "./execute.ts";

/** Read-only inventory preserves unavailable/newer readings for fail-closed planning. */
export async function observeCompletionRecords(
  root: string,
  clock: Clock = SYSTEM_CLOCK,
): Promise<CompletionObservation> {
  const directory = await gitAdminStatePath(root, "completionRecords");
  if (directory === undefined) {
    throw new Error("completion record storage is unavailable");
  }
  const selectors: RecordSelector[] = [];
  for (
    const kind of Object.keys(
      COMPLETION_FAMILIES,
    ) as (keyof typeof COMPLETION_FAMILIES)[]
  ) {
    try {
      for await (const entry of Deno.readDir(join(directory, kind))) {
        if (entry.name.endsWith(".json")) {
          selectors.push({
            kind,
            id: RecordIdSchema.parse(entry.name.slice(0, -5)),
          });
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  const trunk = await runGit(["rev-parse", "HEAD"], { cwd: root });
  if (!trunk.success) throw new Error("cannot observe validation checkout");
  return {
    records: await Promise.all(
      selectors.map(async (selector) => ({
        selector,
        reading: await readCompletionRecord(root, selector),
      })),
    ),
    trunk: trunk.stdout.trim(),
    observed_at: clock.wallNow(),
  };
}

/** Read the committed checkout's complete file universe plus explicit identity files. */
export async function observeValidationInputs(
  root: string,
  toolchain: readonly string[] = [],
): Promise<ValidationInputs> {
  const listed = await runGit(["ls-files", "-z"], { cwd: root });
  if (!listed.success) {
    throw new Error("cannot enumerate declared validation inputs");
  }
  const files: Record<string, ValidationInputs["files"][string]> = {};
  for (
    const path of [
      ...new Set([...listed.stdout.split("\0").filter(Boolean), ...toolchain]),
    ].sort()
  ) {
    const safe = await resolveContainedProjectWritePath(
      root,
      path,
      "validation input",
    );
    const stat = await Deno.stat(safe);
    const bytes = await readCompleteCapture(safe);
    const text = new TextDecoder().decode(bytes);
    files[path] = {
      digest: await sha256Hex(
        JSON.stringify([stat.mode, await bytesDigest(bytes)]),
      ),
      bytes: bytes.length,
      lines: text.split("\n").length - 1,
      words: text.split(/\s+/u).filter(Boolean).length,
    };
  }
  return { files, complete: true };
}

/** A validation adapter never installs, restores or changes an environment checkout. */
export function createValidationRuntime(options: {
  readonly root: string;
  readonly conditions: ValidationConditions;
  readonly environment: Readonly<Record<string, string>>;
  readonly inheritedEnvironment: EnvReader;
  readonly timeout: number;
  /** Re-observe applicable toolchain, environment, resource and input identity at effects. */
  readonly verifyConditions: () => Promise<void>;
  readonly clock?: Clock;
}): ValidationRuntime {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const context = options.conditions.context;
  const subject = (
    execution: ClaimedExecution,
  ): { attempt_id: string; candidate_id: string; context: string } => ({
    attempt_id: execution.attempt.identity.id,
    candidate_id: execution.candidate_id,
    context,
  });
  const run = async (
    label: string,
    runCommands: readonly string[],
    timeout: number,
    execution: ClaimedExecution,
    stdin?: Uint8Array,
  ): Promise<ProducerCapture> => {
    const result = await runCapturedCommands({
      root: options.root,
      label,
      commands: runCommands,
      timeout,
      signal: execution.signal,
      environment: options.environment,
      ...(stdin === undefined ? {} : { stdin }),
    });
    const artifacts = result.capture_complete
      ? [
        await retainArtifact(
          options.root,
          subject(execution),
          `output/${await sha256Hex(label)}/stdout.log`,
          result.stdout,
        ),
      ]
      : [];
    return {
      outcome: result.result.cancelled
        ? "cancelled"
        : result.result.status === "ok"
        ? "passed"
        : "failed",
      complete: result.capture_complete,
      output: result.stdout,
      artifacts,
      ...(result.result.status === "ok" ? {} : {
        reason: `${
          result.result.failureMessage ??
            `command failed (${result.result.code})`
        }; stdout: ${result.output_path}; diagnostics: ${
          result.result.outputPath ?? "unavailable"
        }`,
      }),
    };
  };
  return {
    verify: async (execution): Promise<void> => {
      if (execution.signal.aborted) throw new Error("validation cancelled");
      if (
        await Deno.realPath(options.root) !==
          await Deno.realPath(execution.environment.path)
      ) throw new Error("validation environment path differs from its claim");
      const [attempt, environment, candidate, head, status] = await Promise.all(
        [
          readCompletionRecord(options.root, {
            kind: "attempt",
            id: execution.fence.attempt_id,
          }),
          readCompletionRecord(options.root, {
            kind: "environment",
            id: execution.environment_id,
          }),
          readCompletionRecord(options.root, {
            kind: "candidate",
            id: execution.candidate_id,
          }),
          runGit(["rev-parse", "HEAD"], { cwd: options.root }),
          runGit(["status", "--porcelain", "-z", "--untracked-files=all"], {
            cwd: options.root,
          }),
        ],
      );
      if (
        attempt.kind !== "recorded" || attempt.record.kind !== "attempt" ||
        attempt.record.data.state.kind !== "claimed" ||
        attempt.record.data.state.claim.token !== execution.fence.token ||
        attempt.record.data.state.claim.expires_at <= clock.wallNow() ||
        JSON.stringify(attempt.record.data) !==
          JSON.stringify(AttemptSchema.parse(execution.attempt)) ||
        environment.kind !== "recorded" ||
        environment.record.kind !== "environment" ||
        JSON.stringify(environment.record.data) !==
          JSON.stringify(EnvironmentSchema.parse(execution.environment)) ||
        candidate.kind !== "recorded" ||
        candidate.record.kind !== "candidate" ||
        JSON.stringify(candidate.record.data) !==
          JSON.stringify(CandidateSchema.parse(execution.candidate))
      ) throw new Error("validation claim was lost or superseded");
      if (
        !head.success || head.stdout.trim() !== execution.candidate.head ||
        !status.success || status.stdout !== ""
      ) {
        throw new Error(
          "candidate checkout changed; preserve mutations and prepare a new immutable candidate with the complete requirement set",
        );
      }
      await options.verifyConditions();
      const effective = {
        ...await jobEnvironment(options.root, options.environment),
        ...spawnedByEnv(),
      };
      for (
        const [name, expected] of Object.entries(options.conditions.environment)
      ) {
        if (
          (effective[name] ?? options.inheritedEnvironment.get(name)) !==
            expected
        ) {
          throw new Error(
            "declared producer environment changed after demand planning",
          );
        }
      }
      if (
        execution.environment.ownership.kind === "borrowed" &&
        execution.environment.ownership.identity.seed !==
          options.conditions.seed
      ) {
        throw new Error(
          "candidate environment seed differs from planned applicability",
        );
      }
    },
    produce: async (
      producer: ProducerDemand,
      execution,
    ): Promise<ProducerCapture> => {
      const previous = await Promise.all(
        producer.recipe.artifacts.map((path) =>
          artifactStamp(options.root, path)
        ),
      );
      const capture = await run(
        producer.selector,
        commands(producer.recipe.run),
        producer.recipe.timeout ?? options.timeout,
        execution,
      );
      if (capture.outcome !== "passed" || !capture.complete) return capture;
      const artifacts = [...capture.artifacts];
      for (let index = 0; index < producer.recipe.artifacts.length; index++) {
        const path = producer.recipe.artifacts[index];
        const stamp = previous[index];
        if (path === undefined || stamp === undefined) {
          throw new Error("missing artifact baseline");
        }
        artifacts.push(
          await captureProducedArtifact(
            options.root,
            subject(execution),
            path,
            stamp,
          ),
        );
      }
      return { ...capture, artifacts };
    },
    extract: async (
      obligation: ResolvedObligation,
      capture,
      execution,
    ): Promise<ProducerCapture> => {
      const extraction = obligation.input.extraction;
      if (extraction === null) return capture;
      let stdin = capture.output;
      if (extraction.input.kind === "artifact") {
        const path = extraction.input.path;
        const artifact = capture.artifacts.find((a) => a.path === path);
        if (
          artifact === undefined ||
          artifact.attempt_id !== execution.attempt.identity.id ||
          artifact.candidate_id !== execution.candidate_id ||
          artifact.context !== context
        ) throw new Error("required attempt artifact is absent or mismatched");
        stdin = await readArtifact(options.root, artifact);
      }
      const result = await run(
        `extract:${obligation.subject}`,
        extraction.run,
        options.timeout,
        execution,
        stdin,
      );
      return {
        ...result,
        artifacts: [...capture.artifacts, ...result.artifacts],
      };
    },
  };
}
