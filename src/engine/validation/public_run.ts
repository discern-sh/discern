import { selectDemandObligations } from "./demand.ts";
import { validationInputSelection } from "./input_selection.ts";
import { resolveProducerGraph } from "./catalog.ts";
import type { ProducerBoundary } from "./execute.ts";
import { protocolOutputPath, readArtifact } from "./artifacts.ts";
import { SYSTEM_CLOCK } from "../../shared/clock.ts";
import {
  emitCompletionEvent,
  emitCompletionProgress,
  emitComponentUse,
  executionEvent,
} from "../completion/events.ts";
import type { EnvReader } from "../../shared/env.ts";
/** Public commands demand one canonical producer graph and project its actual executions. */
import type { DiscernConfig } from "../../shared/config_schema.ts";
import type { GateStandard } from "../../shared/result_schemas.ts";
import type {
  ProducerDemand,
  ProducerEvaluator,
  ValidationDemand,
  ValidationExecution,
  ValidationPlan,
  ValidationSubject,
} from "../completion/protocol.ts";
import type { JobResult } from "../jobs/types.ts";
import type { RunOptions } from "../jobs/runner.ts";
import {
  type ConfiguredValidation,
  configuredValidation,
} from "./configuration.ts";
import {
  prepareValidationSnapshot,
  type ValidationSnapshot,
} from "./catalog.ts";
import { executeDiagnosticValidation } from "./execute.ts";
import { createProducerEvaluator } from "./evaluator.ts";
import {
  createDiagnosticValidationRuntime,
  createValidationRuntime,
  observeCompletionRecords,
  observeValidationInputs,
} from "./runtime.ts";
import { bindExecutionValidation } from "../execution/validation_binding.ts";
import {
  candidateConditions,
  ContextFactsSchema,
  currentValidationConditions,
} from "./context.ts";
import { retainArtifact } from "./artifacts.ts";
import { buildStandardPlan, standardJobLabel } from "../gate/standard_plan.ts";
import {
  heldVerdict,
  standardPinEvidence,
  type StandardVerdict,
} from "./metrics.ts";
import { standardHeld, standardVerdict } from "./metrics.ts";

import {
  TEST_RUN_SLOT_ENV,
  TEST_RUN_SLOT_VALUE,
  type TestRunSlotHold,
} from "../test_run_slots.ts";
import { buildTestRunSlots, type TestRunSlots } from "../gate/test_slots.ts";
import { makeOut, type Out } from "../output.ts";
import type { ComponentEvidence } from "../completion/evidence.ts";

/** The command owns one capacity observation and its live presentation. */
export interface PublicValidationCapacity {
  readonly slots: TestRunSlots | undefined;
  readonly out: Out;
  readonly runner?: RunOptions;
}

export interface PublicValidationRun {
  readonly configured: ConfiguredValidation;
  readonly snapshot: ValidationSnapshot;
  readonly evaluator: ProducerEvaluator;
  readonly plan: ValidationPlan;
  readonly execution: ValidationSubject;
  readonly outcome: ValidationExecution;
  readonly results: ReadonlyMap<string, JobResult>;
  readonly standards: readonly GateStandard[];
  readonly standard_verdicts: ReadonlyMap<string, StandardVerdict>;
  readonly producer_executions: Readonly<Record<string, number>>;
  readonly waited_ms: number;
}

/** Labels follow the public scheduler's existing job, generated-group and scope vocabulary. */
export function producerLabel(selector: string): string {
  if (selector.startsWith("jobs.discern-generated-")) {
    return `generated:${selector.slice("jobs.discern-generated-".length)}`;
  }
  if (selector.startsWith("jobs.")) return selector.slice("jobs.".length);
  if (selector.startsWith("scopes.")) {
    return `scope:${selector.slice("scopes.".length, -".gate".length)}`;
  }
  return selector.startsWith("standards.")
    ? standardJobLabel(selector.slice("standards.".length))
    : selector;
}

/** All process effects remain below the environment lease; diagnostic results stay transient. */
export async function executePublicValidation(input: {
  readonly root: string;
  readonly config: DiscernConfig;
  readonly scopes: readonly string[];
  readonly claimed: ValidationSubject;
  readonly demand: ValidationDemand;
  readonly stageDependencies?: boolean;
  readonly bindComposition?: boolean;
  readonly rerun_of?: string;
  readonly producerBoundary?: ProducerBoundary;
  readonly capacity?: PublicValidationCapacity;
  readonly onProgress?: (
    fact: {
      producer: string;
      state: "running" | "finished";
      result?: JobResult;
    },
  ) => void;
}, hostEnv: EnvReader = Deno.env): Promise<PublicValidationRun> {
  const { root, config, demand } = input;
  const startedAt = SYSTEM_CLOCK.wallNow();
  const diagnostic = "diagnostic" in input.claimed;
  const configured = await configuredValidation(
    config,
    input.scopes,
    input.stageDependencies,
  );
  const results = new Map<string, JobResult>();
  const counts: Record<string, number> = {};
  const inherited = await observeCompletionRecords(root);
  const observation = diagnostic ? { ...inherited, records: [] } : inherited;
  const overrides = { [TEST_RUN_SLOT_ENV]: TEST_RUN_SLOT_VALUE };
  const seed = "diagnostic" in input.claimed
    ? input.claimed.seed
    : input.claimed.environment.ownership.kind === "borrowed"
    ? input.claimed.environment.ownership.identity.seed
    : 0;
  const conditions = await currentValidationConditions(
    root,
    configured,
    demand.context,
    seed,
    overrides,
    hostEnv,
  );
  const graph = resolveProducerGraph(
    configured.producers,
    configured.obligations,
  );
  const declarations = configured.obligations.map((entry, index) => {
    const producer = graph.selectors[index];
    if (producer === undefined) throw new Error("Missing declared producer.");
    return { ...entry, producer };
  });
  const selected = demand.kind === "done"
    ? declarations
    : selectDemandObligations(
      declarations.map((entry) => entry.requirement),
      declarations,
      graph.producers,
      demand,
      input.claimed.candidate,
    );
  const selection = validationInputSelection(
    graph.producers,
    selected,
    demand.kind === "test" ? demand.producers : [],
  );
  const toolchain = selection.toolchain;
  const inputs = await observeValidationInputs(root, toolchain, selection);
  const snapshot = await prepareValidationSnapshot({
    candidate_id: input.claimed.candidate_id,
    candidate: input.claimed.candidate,
    producers: configured.producers,
    ordering: configured.ordering,
    obligations: configured.obligations,
    observedRequirements: selected.map((entry) => entry.requirement),
    inputs,
    conditions: await candidateConditions(
      input.claimed.candidate_id,
      configured,
      conditions,
      observation,
      root,
    ),
  });
  const { slots, out } = input.capacity ??
    {
      slots: buildTestRunSlots(root, config),
      out: makeOut(false, { quiet: true }),
    };
  let hold: TestRunSlotHold | undefined;
  let acquiring: Promise<void> | undefined;
  let slotUsers = 0;
  const needsSlot = (producer: ProducerDemand): boolean =>
    configured.stages.get(producer.selector) === "test" ||
    producer.consumers.some((consumer) =>
      consumer.requirement.kind === "standard"
    ) ||
    // A recipe that observes the accounting marker must execute with that fact true.
    producer.recipe.environment.includes(TEST_RUN_SLOT_ENV);
  const abort = new AbortController();
  let execution: ValidationSubject = {
    ...input.claimed,
    signal: AbortSignal.any([input.claimed.signal, abort.signal]),
  };
  const runtime =
    (diagnostic ? createDiagnosticValidationRuntime : createValidationRuntime)({
      root,
      conditions,
      environment: overrides,
      commandEnvironment: (selector) =>
        selector.startsWith("extract:") ||
          plan.producers.some((producer) =>
            producer.selector === selector && needsSlot(producer)
          )
          ? overrides
          : {},
      inheritedEnvironment: hostEnv,
      timeout: config.gate.timeout,
      timeouts: configured.timeouts,
      jobLabel: producerLabel,
      ...(input.capacity?.runner === undefined
        ? {}
        : { presentation: input.capacity.runner }),
      verifyConditions: async () => {
        if (
          JSON.stringify(
            await observeValidationInputs(root, toolchain, selection),
          ) !==
            JSON.stringify(inputs)
        ) throw new Error("Candidate inputs changed during validation.");
      },
      onResult: (selector, result) => {
        if (selector.startsWith("extract:")) return;
        results.set(producerLabel(selector), {
          ...result,
          label: producerLabel(selector),
        });
        input.onProgress?.({ producer: selector, state: "finished", result });
        emitCompletionProgress({
          phase: "producer",
          state: "finished",
          candidate_id: input.claimed.candidate_id,
          reason: `${selector}: ${result.status}`,
        });
        if (config.gate.fail_fast && result.code !== 0) abort.abort();
      },
    });
  let contextArtifact: ComponentEvidence["artifacts"][number] | undefined;
  const withSlot = async <T>(
    needed: boolean,
    claimed: ValidationSubject,
    run: () => Promise<T>,
  ): Promise<T> => {
    if (!needed || slots === undefined) return await run();
    slotUsers++;
    try {
      acquiring ??= (async () => {
        emitCompletionProgress({
          phase: "queue",
          state: "waiting",
          candidate_id: claimed.candidate_id,
          reason:
            "Waiting for test-run capacity; independent checks can continue.",
        });
        hold = await slots.acquire(out, claimed.signal);
      })();
      await acquiring;
      claimed.signal.throwIfAborted();
      return await run();
    } finally {
      if (--slotUsers === 0) {
        hold?.release();
        hold = undefined;
        acquiring = undefined;
      }
    }
  };
  const observedRuntime = {
    ...runtime,
    extract: (
      ...args: Parameters<typeof runtime.extract>
    ): ReturnType<typeof runtime.extract> =>
      withSlot(true, args[2], () => runtime.extract(...args)),
    onCapture: async (
      producer: ProducerDemand,
      capture: import("./execute.ts").ProducerCapture,
    ): Promise<void> => {
      if (capture.result !== undefined) {
        const label = producerLabel(producer.selector);
        results.set(label, { ...capture.result, label });
      }
      await input.producerBoundary?.after(producer, capture);
    },
    produce: async (producer: ProducerDemand, claimed: ValidationSubject) => {
      await input.producerBoundary?.before(producer, plan);
      claimed.signal.throwIfAborted();
      const captured = await withSlot(
        needsSlot(producer),
        claimed,
        () => {
          claimed.signal.throwIfAborted();
          counts[producer.selector] = (counts[producer.selector] ?? 0) + 1;
          input.onProgress?.({ producer: producer.selector, state: "running" });
          emitCompletionProgress({
            phase: "producer",
            state: "running",
            candidate_id: claimed.candidate_id,
            reason: `Running ${producer.selector}.`,
          });
          return runtime.produce(producer, claimed);
        },
      );
      return contextArtifact === undefined ? captured : {
        ...captured,
        artifacts: [...captured.artifacts, contextArtifact],
      };
    },
  };
  const evaluator = createProducerEvaluator({
    root,
    snapshot,
    observe: () =>
      diagnostic
        ? Promise.resolve(observation)
        : observeCompletionRecords(root),
    runtime: observedRuntime,
    ...(input.rerun_of === undefined ? {} : { rerun_of: input.rerun_of }),
  });
  const observed = await evaluator.observe(snapshot.candidate_id);
  const plan = evaluator.plan(observed, demand, snapshot.candidate_id);
  if (input.bindComposition && plan.blockers.length === 0) {
    if (!("fence" in execution)) {
      throw new Error("Diagnostics cannot bind a completion attempt.");
    }
    execution = await bindExecutionValidation(root, execution, plan);
  }
  if ("diagnostic" in execution) {
    execution = {
      ...execution,
      attempt: {
        ...execution.attempt,
        subjects: snapshot.obligations.filter((obligation) =>
          plan.producers.some((producer) =>
            producer.evidence_subjects.includes(obligation.applicability)
          )
        ).map((obligation) => obligation.subject),
      },
    };
  }
  if (!diagnostic && plan.blockers.length === 0) {
    const facts = ContextFactsSchema.parse({
      version: ContextFactsSchema.shape.version.value,
      candidate_id: snapshot.candidate_id,
      context: conditions.context,
      seed: conditions.seed,
      identity: conditions.identity,
      environment_digests: conditions.environment_digests,
    });
    contextArtifact = await retainArtifact(
      root,
      {
        attempt_id: execution.attempt.identity.id,
        candidate_id: snapshot.candidate_id,
        context: demand.context,
      },
      "context/facts.json",
      new TextEncoder().encode(JSON.stringify(facts)),
    );
  }
  let outcome: ValidationExecution;
  try {
    outcome = plan.blockers.length > 0
      ? { evidence: [], blockers: plan.blockers }
      : "diagnostic" in execution
      ? await executeDiagnosticValidation(
        snapshot,
        plan,
        execution,
        observedRuntime,
      )
      : await evaluator.execute(plan, execution);
  } finally {
    hold?.release();
  }
  // A process may exit clean while its evidence fails checkout or claim verification.
  for (const obligation of snapshot.obligations) {
    if (obligation.requirement.kind === "standard") continue;
    const component = outcome.evidence.find((entry) =>
      entry.applicability.protected_definitions ===
        obligation.applicability.protected_definitions
    );
    if (component === undefined || !("reason" in component.outcome)) continue;
    const label = producerLabel(obligation.producer);
    const prior = results.get(label);
    if (
      prior?.status === "failed" ||
      prior === undefined && (counts[obligation.producer] ?? 0) === 0
    ) continue;
    results.set(label, {
      label,
      durationS: 0,
      outputLines: 0,
      errorLikeLines: 0,
      ...prior,
      status: "failed",
      code: 1,
      failureMessage: component.outcome.reason,
    });
  }
  const standards: GateStandard[] = [];
  const verdicts = new Map<string, StandardVerdict>();
  for (const standard of buildStandardPlan(config).standards) {
    const obligation = snapshot.obligations.find((entry) =>
      entry.requirement.kind === "standard" &&
      entry.requirement.id === standard.name &&
      entry.requirement.context === demand.context
    );
    if (obligation === undefined) continue;
    const failedIds = plan.blockers.flatMap((blocker) =>
      blocker.kind === "validation-failed" ? blocker.evidence_ids : []
    );
    const retainedFailure = observed.records.flatMap(({ reading }) =>
      reading.kind === "recorded" && reading.record.kind === "evidence" &&
        failedIds.includes(reading.record.id)
        ? [reading.record.data]
        : []
    ).find((entry) =>
      entry.applicability.protected_definitions ===
        obligation.applicability.protected_definitions &&
      entry.applicability.context === demand.context
    );
    const component = outcome.evidence.find((entry) =>
      entry.applicability.protected_definitions ===
        obligation.applicability.protected_definitions
    ) ?? retainedFailure;
    let value: number | undefined;
    let from: string | undefined;
    let reason: string | undefined;
    if (component?.outcome.kind === "passed") {
      const verdict = standardVerdict(
        standard,
        component.outcome.metrics,
        obligation.extent,
      );
      verdicts.set(standard.name, verdict);
      value = verdict.value;
    } else if (component !== undefined) {
      reason = "reason" in component.outcome
        ? component.outcome.reason
        : "Standard evidence is incomplete.";
      const outputPath = await protocolOutputPath(
        obligation.input.extraction === null
          ? obligation.producer
          : `extract:${obligation.subject}`,
      );
      const outputArtifact = component.artifacts.find((artifact) =>
        artifact.path === outputPath
      );
      let output: string | undefined;
      if (outputArtifact !== undefined) {
        try {
          output = new TextDecoder("utf-8", { fatal: true }).decode(
            await readArtifact(root, outputArtifact),
          );
        } catch (error) {
          reason += ` Captured output is unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      }
      verdicts.set(standard.name, {
        held: false,
        reason,
        ...(output === undefined ? {} : { output }),
      });
    } else if (
      plan.reused.some((reuse) =>
        reuse.requirement.id === standard.name &&
        reuse.requirement.kind === "standard"
      )
    ) {
      const records = observed.records.flatMap(({ reading }) =>
        reading.kind === "recorded" ? [reading.record] : []
      );
      const receipt = plan.reused.find((reuse) =>
        reuse.requirement.kind === "standard" &&
        reuse.requirement.id === standard.name &&
        reuse.requirement.context === demand.context
      );
      const selected = records.find((record) =>
        record.kind === "evidence" && record.id === receipt?.evidence_id
      );
      if (
        selected?.kind === "evidence" && selected.data.outcome.kind === "passed"
      ) {
        const verdict = standardVerdict(
          standard,
          selected.data.outcome.metrics,
          obligation.extent,
        );
        verdicts.set(standard.name, verdict);
        value = verdict.value;
        const origin = records.find((record) =>
          record.kind === "candidate" &&
          record.id === selected.data.candidate_id
        );
        if (origin?.kind !== "candidate") {
          throw new Error(
            "Reused measurement has no retained candidate provenance.",
          );
        }
        from = origin.data.head;
      }
    }
    const producerResult = results.get(producerLabel(obligation.producer));
    const duration = producerResult?.durationS ?? 0;
    const held = value !== undefined && standardHeld(standard, value);
    const reading: GateStandard = {
      name: standard.name,
      direction: standard.direction,
      limit: standard.limit,
      margin: standard.margin,
      measurement: value === undefined && component === undefined
        ? "skipped"
        : from === undefined
        ? "measured"
        : "replayed",
      ...(value === undefined ? {} : {
        value,
        verdict: held ? heldVerdict(standard, value) : "regressed",
        ...standardPinEvidence(standard, value),
      }),
      ...(from === undefined
        ? { duration_s: duration }
        : { replayed_from: from }),
    };
    standards.push(reading);
    if (component !== undefined || from !== undefined) {
      const label = standardJobLabel(standard.name);
      const readingOnly = demand.kind === "test";
      results.set(label, {
        ...(producerResult ?? {}),
        ...(producerResult?.timedOut === undefined ? {} : {
          timedOut: {
            ...producerResult.timedOut,
            key: standard.timeout === undefined
              ? "[gate].timeout"
              : `[standards.${standard.name}].timeout`,
          },
        }),
        label,
        status: held || readingOnly && value !== undefined ? "ok" : "failed",
        code: held || readingOnly && value !== undefined ? 0 : 1,
        durationS: duration,
        outputLines: 0,
        errorLikeLines: 0,
        ...(!held && !readingOnly
          ? {
            failureMessage: reason ?? verdicts.get(standard.name)?.reason ??
              `Standard ${standard.name} measured ${
                value ?? "no finite value"
              }; required ${
                standard.direction === "up" ? ">=" : "<="
              } ${standard.limit}.`,
          }
          : {}),
      });
    }
  }
  for (
    const reuse of plan.reused.filter((entry) =>
      entry.requirement.kind !== "standard"
    )
  ) {
    const label = reuse.requirement.kind === "scope"
      ? `scope:${reuse.requirement.id}`
      : reuse.requirement.id;
    results.set(label, {
      label,
      status: "ok",
      code: 0,
      durationS: 0,
      outputLines: 0,
      errorLikeLines: 0,
    });
  }
  for (const reuse of plan.reused) {
    const reading = observation.records.find((record) =>
      record.selector.kind === "evidence" &&
      record.selector.id === reuse.evidence_id
    )?.reading;
    if (reading?.kind === "recorded" && reading.record.kind === "evidence") {
      emitComponentUse(
        execution,
        reading.record.data,
        reuse.evidence_id,
        "reused",
        0,
        SYSTEM_CLOCK.wallNow(),
      );
    }
  }
  const finishedAt = SYSTEM_CLOCK.wallNow();
  emitCompletionEvent(
    executionEvent(
      execution,
      `${execution.attempt.identity.id}:validation`,
      finishedAt,
      {
        kind: "timing",
        interval_id: execution.attempt.identity.id,
        category: "execution",
        started_at: startedAt,
        finished_at: finishedAt,
      },
    ),
  );
  for (const blocker of outcome.blockers) {
    emitCompletionProgress({
      phase: "pending",
      state: blocker.kind,
      candidate_id: execution.candidate_id,
      reason: "reason" in blocker ? blocker.reason : JSON.stringify(blocker),
    });
  }
  return {
    configured,
    snapshot,
    evaluator,
    plan,
    execution,
    outcome,
    results,
    standards,
    standard_verdicts: verdicts,
    producer_executions: counts,
    waited_ms: slots?.waitedMs ?? 0,
  };
}
