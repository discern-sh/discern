import {
  selectedValidationBoundary,
  selectedValidationInput,
  type ValidationInputSelection,
} from "./input_selection.ts";
import { gitPathRecord } from "../../shared/git_paths.ts";
import {
  emitCompletionEvent,
  emitCompletionProgress,
  executionEvent,
} from "../completion/events.ts";
import { checkoutChangesMessage } from "../../shared/checkout_changes.ts";
import { validationInputFile } from "./inputs.ts";
/** Production adapters use existing supervised jobs, common records and bounded artifacts. */
import { join } from "@std/path";
import type {
  CompletionObservation,
  ProducerDemand,
  ValidationSubject,
} from "../completion/protocol.ts";
import {
  COMPLETION_FAMILIES,
  type RecordSelector,
} from "../completion/records.ts";
import { openCompletionRecordStore } from "../completion/store.ts";
import { RecordIdSchema } from "../completion/identity.ts";
import type { EnvReader } from "../../shared/env.ts";
import { spawnedByEnv } from "../../shared/invocation_context.ts";
import { jobEnvironment } from "../jobs/command.ts";
import { AttemptSchema } from "../completion/attempt.ts";
import { CandidateSchema } from "../completion/candidate.ts";
import { runGit } from "../../shared/subprocess.ts";
import { type Clock, SYSTEM_CLOCK } from "../../shared/clock.ts";
import { lstatIfExists } from "../../shared/fs_presence.ts";
import { containedCheckoutFile } from "./inputs.ts";
import { readCompleteCapture, runCapturedCommands } from "../jobs/captured.ts";
import {
  commands,
  type ResolvedObligation,
  type ValidationConditions,
  type ValidationInputs,
} from "./catalog.ts";
import {
  artifactStamp,
  captureProducedArtifact,
  protocolOutputPath,
  readArtifact,
  retainArtifact,
} from "./artifacts.ts";
import {
  GATE_TIMEOUT_KEY,
  type JobResult,
  type JobTimeout,
} from "../jobs/types.ts";
import type { RunOptions } from "../jobs/runner.ts";
import type { ProducerCapture, ValidationRuntime } from "./execute.ts";

/** Read-only inventory preserves unavailable/newer readings for fail-closed planning. */
export async function observeCompletionRecords(
  root: string,
  clock: Clock = SYSTEM_CLOCK,
  families: readonly (keyof typeof COMPLETION_FAMILIES)[] = Object.keys(
    COMPLETION_FAMILIES,
  ) as (keyof typeof COMPLETION_FAMILIES)[],
): Promise<CompletionObservation> {
  const store = await openCompletionRecordStore(root);
  if (store === undefined) {
    throw new Error("completion record storage is unavailable");
  }
  const selectors: RecordSelector[] = [];
  for (
    const kind of families
  ) {
    try {
      for await (const entry of Deno.readDir(join(store.directory, kind))) {
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
        reading: await store.read(selector),
      })),
    ),
    trunk: trunk.stdout.trim(),
    observed_at: clock.wallNow(),
  };
}

/**
 * Whether completion records can be observed from `root`: inside a work tree
 * whose HEAD resolves. A repository with no commit yet, or a directory outside
 * Git, has no completion history to read, so read-only callers skip rather
 * than fail.
 */
export async function observableCompletionCheckout(
  root: string,
): Promise<boolean> {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], {
    cwd: root,
  });
  if (!inside.success || inside.stdout.trim() !== "true") return false;
  const head = await runGit(["rev-parse", "--verify", "HEAD^{commit}"], {
    cwd: root,
  });
  return head.success;
}

/** Observe present checkout bytes, including literal names and link text, plus identity files. */
export async function observeValidationInputs(
  root: string,
  toolchain: readonly string[] = [],
  selection?: ValidationInputSelection,
): Promise<ValidationInputs> {
  const listed = await runGit([
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "-z",
  ], { cwd: root, maxOutputBytes: 16 * 1024 * 1024, timeoutMs: 60_000 });
  if (!listed.success) {
    throw new Error("cannot enumerate declared validation inputs");
  }
  const files: Record<string, ValidationInputs["files"][string]> = {};
  for (
    const path of [
      ...new Set([...listed.stdout.split("\0").filter(Boolean), ...toolchain]),
    ].sort()
  ) {
    const requested = selectedValidationInput(path, selection);
    const boundary = selectedValidationBoundary(path, selection);
    if (!requested && !boundary) continue;
    const entry = gitPathRecord(path);
    if (entry.kind === "directory") {
      if (!boundary) continue;
      await containedCheckoutFile(root, entry.path);
      throw new Error(
        `Validation input ${
          JSON.stringify(path)
        } is a Git directory record, not captured file bytes. Commit or reconcile the nested repository before validating this source.`,
      );
    }
    const safe = await containedCheckoutFile(root, path);
    const stat = await lstatIfExists(safe);
    if (stat === undefined) continue;
    if (!stat.isFile && !stat.isSymlink) {
      if (!boundary) continue;
      throw new Error(
        `Validation input is not a regular file or link: ${path}`,
      );
    }
    if (!requested) continue;
    const bytes = stat.isSymlink
      ? new TextEncoder().encode(await Deno.readLink(safe))
      : await readCompleteCapture(safe);
    files[path] = await validationInputFile(
      bytes,
      stat.isSymlink
        ? "120000"
        : ((stat.mode ?? 0) & 0o111) === 0
        ? "100644"
        : "100755",
    );
  }
  return {
    files,
    complete: toolchain.every((path) => Object.hasOwn(files, path)),
  };
}

/** A validation adapter never installs, restores or changes the checkout it runs in. */
export interface ValidationRuntimeOptions {
  readonly root: string;
  readonly conditions: ValidationConditions;
  readonly environment: Readonly<Record<string, string>>;
  /** Accounting markers apply only to commands whose capacity is accounted. */
  readonly commandEnvironment?: (
    selector: string,
  ) => Readonly<Record<string, string>>;
  readonly inheritedEnvironment: EnvReader;
  readonly timeout: number;
  readonly timeouts?: ReadonlyMap<string, JobTimeout>;
  readonly presentation?: RunOptions;
  readonly jobLabel?: (selector: string) => string;
  /** Re-observe applicable toolchain, environment, resource and input identity at effects. */
  readonly verifyConditions: () => Promise<void>;
  readonly clock?: Clock;
  readonly onStart?: (label: string) => void;
  readonly onResult?: (label: string, result: JobResult) => void;
}

/** A durable runtime verifies the live candidate and attempt at every effect. */
export function createValidationRuntime(
  options: ValidationRuntimeOptions,
): ValidationRuntime {
  return runtime(options);
}

/** Standalone feedback shares capture and extraction but cannot publish completion evidence. */
export function createDiagnosticValidationRuntime(
  options: ValidationRuntimeOptions,
): ValidationRuntime {
  return runtime(options, true);
}

/** Captured producer and extraction effects share the same explicit execution-subject boundary. */
function runtime(
  options: ValidationRuntimeOptions,
  diagnostic = false,
): ValidationRuntime {
  const clock = options.clock ?? SYSTEM_CLOCK;
  const subject = (
    execution: ValidationSubject,
  ): { attempt_id: string; candidate_id: string } => ({
    attempt_id: execution.attempt.identity.id,
    candidate_id: execution.candidate_id,
  });
  const run = async (
    label: string,
    runCommands: readonly string[],
    timeout: JobTimeout,
    execution: ValidationSubject,
    stdin?: Uint8Array,
  ): Promise<ProducerCapture> => {
    const executionId = `${execution.attempt.identity.id}:${label}`;
    const role = label.startsWith("extract:") ? "extractor" : "producer";
    const publicLabel = options.jobLabel?.(label) ?? label;
    let started: { wall: number; monotonic: number } | undefined;
    const result = await runCapturedCommands({
      root: options.root,
      label: publicLabel,
      commands: runCommands,
      onSpawn: (spawned) => {
        started = { wall: clock.wallNow(), monotonic: clock.monotonicNow() };
        emitCompletionEvent(
          executionEvent(execution, `${executionId}:started`, started.wall, {
            kind: "command-started",
            execution_id: executionId,
            producer: label,
            role,
          }),
        );
        options.onStart?.(label);
        // Publish the transcript location the moment it exists, so an
        // interrupted producer's output stays reachable through the journal.
        if (role === "producer" && spawned.outputPath !== undefined) {
          emitCompletionProgress({
            phase: "producer",
            state: "running",
            candidate_id: execution.candidate_id,
            reason:
              `Running ${publicLabel}; its output is being captured at ${spawned.outputPath}.`,
            work: {
              producer: publicLabel,
              state: "running",
              output_path: spawned.outputPath,
            },
          });
        }
      },
      ...(options.presentation === undefined
        ? {}
        : { presentation: options.presentation }),
      timeout: timeout.seconds,
      timeoutKey: timeout.key,
      signal: execution.signal,
      environment: options.commandEnvironment?.(label) ?? options.environment,
      ...(stdin === undefined ? {} : { stdin }),
    });
    if (started !== undefined) {
      const finished = clock.wallNow();
      emitCompletionEvent(
        executionEvent(execution, `${executionId}:finished`, finished, {
          kind: "command-finished",
          execution_id: executionId,
          producer: label,
          role,
          outcome: result.result.cancelled
            ? "cancelled"
            : result.result.status === "ok"
            ? "passed"
            : "failed",
          started_at: started.wall,
          finished_at: finished,
          duration_ms: Math.max(0, clock.monotonicNow() - started.monotonic),
        }),
      );
    }
    options.onResult?.(label, result.result);
    const artifacts = result.capture_complete
      ? [
        await retainArtifact(
          options.root,
          subject(execution),
          await protocolOutputPath(label),
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
      result: result.result,
      output: result.stdout,
      artifacts,
      ...(result.result.status === "ok" ? {} : {
        reason: `${
          result.result.failureMessage ??
            `command failed (${result.result.code})`
        }; stdout: ${result.output_path ?? "unavailable"}; diagnostics: ${
          result.result.outputPath ?? "unavailable"
        }`,
      }),
    };
  };
  return {
    verify: async (execution, verification): Promise<void> => {
      if (execution.signal.aborted && !verification?.allowCancelled) {
        throw new Error("validation cancelled");
      }
      if (
        await Deno.realPath(options.root) !==
          await Deno.realPath(execution.path)
      ) throw new Error("validation checkout path differs from its claim");
      if (diagnostic) {
        if (
          !("diagnostic" in execution) ||
          execution.attempt.purpose !== "diagnostic"
        ) {
          throw new Error(
            "Standalone execution cannot supply completion evidence.",
          );
        }
        return;
      }
      if (!("fence" in execution)) {
        throw new Error(
          "Completion validation requires a durable execution claim.",
        );
      }
      const store = await openCompletionRecordStore(options.root);
      if (store === undefined) {
        throw new Error(
          "Cannot verify completion records; common Git administration is unavailable. Preserve the checkout for recovery.",
        );
      }
      const [attempt, candidate, head, status] = await Promise.all(
        [
          store.read({
            kind: "attempt",
            id: execution.fence.attempt_id,
          }),
          store.read({
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
        candidate.kind !== "recorded" ||
        candidate.record.kind !== "candidate" ||
        JSON.stringify(candidate.record.data) !==
          JSON.stringify(CandidateSchema.parse(execution.candidate))
      ) throw new Error("validation claim was lost or superseded");
      if (!head.success || !status.success) {
        throw new Error(
          "Cannot verify the candidate checkout; preserve it and inspect Git before retrying validation.",
        );
      }
      if (head.stdout.trim() !== execution.candidate.head) {
        throw new Error(
          "Candidate HEAD changed during validation; preserve the checkout and prepare the intended committed revision before retrying.",
        );
      }
      if (status.stdout !== "") {
        throw new Error(checkoutChangesMessage(status.stdout));
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
      if (execution.seed !== options.conditions.seed) {
        throw new Error(
          "checkout seed differs from planned applicability",
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
        options.timeouts?.get(producer.selector) ??
          {
            seconds: producer.recipe.timeout ?? options.timeout,
            key: GATE_TIMEOUT_KEY,
          },
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
          artifact.candidate_id !== execution.candidate_id
        ) throw new Error("required attempt artifact is absent or mismatched");
        stdin = await readArtifact(options.root, artifact);
      }
      const result = await run(
        `extract:${obligation.subject}`,
        extraction.run,
        options.timeouts?.get(`standards.${obligation.requirement.id}`) ??
          { seconds: options.timeout, key: GATE_TIMEOUT_KEY },
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
