import { validationInputSelection } from "./input_selection.ts";
import { resolveProducerGraph } from "./catalog.ts";
/** Read-only candidate assessment shares the exact evaluator used by public completion. */
import {
  type DiscernConfig,
  parseConfigOrThrow,
} from "../../shared/config_schema.ts";
import { readCheckpointQuestionFileAtCommit } from "../../shared/checkpoint_question_files.ts";
import type { Candidate } from "../completion/candidate.ts";
import type {
  CompletionObservation,
  ProducerEvaluator,
  ValidationDemand,
} from "../completion/protocol.ts";
import { readTrunkConfig } from "../gate/standard_limits.ts";
import {
  buildStandardPlan,
  type PlannedStandard,
} from "../gate/standard_plan.ts";
import { collectPaths, scopesForPaths } from "../scopes/scopes.ts";
import {
  type ConfiguredValidation,
  configuredValidation,
} from "./configuration.ts";
import { candidateConditions } from "./context.ts";
import {
  prepareValidationSnapshot,
  type ValidationSnapshot,
} from "./catalog.ts";
import { createProducerEvaluator } from "./evaluator.ts";
import { observeCandidateInputs } from "./inputs.ts";

export interface CandidateValidationObservation {
  readonly config: DiscernConfig;
  readonly configured: ConfiguredValidation;
  readonly snapshot: ValidationSnapshot;
  readonly evaluator: ProducerEvaluator;
  readonly demand: Extract<ValidationDemand, { kind: "done" }>;
  readonly standards: readonly PlannedStandard[];
}

/** A committed candidate's config and question files are read from that same immutable subject. */
export async function candidateConfig(
  root: string,
  commit: string,
): Promise<DiscernConfig> {
  const read = await readTrunkConfig(root, commit);
  if (read.kind !== "parsed") {
    throw new Error(
      `Candidate configuration is ${read.kind}; its obligations cannot be established.`,
    );
  }
  const config = parseConfigOrThrow(read.text);
  for (const entry of Object.values(config.checkpoints)) {
    if (entry.question_file === undefined) continue;
    const question = await readCheckpointQuestionFileAtCommit(
      root,
      commit,
      entry.question_file,
    );
    if (!question.ok) {
      throw new Error(
        `Candidate checkpoint question ${entry.question_file} is ${question.reason}.`,
      );
    }
  }
  return config;
}

/** Existing context receipts describe their own executions; the observer supplies no substitute host claim. */
export async function observeCandidateValidation(input: {
  readonly root: string;
  readonly candidate_id: string;
  readonly candidate: Candidate;
  readonly observation: CompletionObservation;
  readonly context: string;
}): Promise<CandidateValidationObservation> {
  const { root, candidate, candidate_id, context } = input;
  const config = await candidateConfig(root, candidate.head);
  const paths = await collectPaths(
    root,
    candidate.predecessor,
    candidate.head,
    false,
  );
  if (paths === null) {
    throw new Error("The candidate's scope obligations cannot be observed.");
  }
  const configured = await configuredValidation(
    config,
    scopesForPaths(paths, config),
  );
  const graph = resolveProducerGraph(
    configured.producers,
    configured.obligations,
  );
  const selection = validationInputSelection(
    graph.producers,
    configured.obligations.map((entry, index) => {
      const producer = graph.selectors[index];
      if (producer === undefined) throw new Error("Missing declared producer.");
      return { ...entry, producer };
    }),
  );
  const inputs = await observeCandidateInputs(
    root,
    candidate.head,
    selection.toolchain,
    selection,
  );
  const snapshot = await prepareValidationSnapshot({
    candidate_id,
    candidate,
    producers: configured.producers,
    obligations: configured.obligations,
    ordering: configured.ordering,
    inputs,
    conditions: await candidateConditions(
      candidate_id,
      configured,
      undefined,
      input.observation,
      root,
    ),
  });
  return {
    config,
    configured,
    snapshot,
    evaluator: createProducerEvaluator({
      root,
      snapshot,
      observe: () => Promise.resolve(input.observation),
    }),
    demand: {
      kind: "done",
      mode: "strict",
      context,
      requirements: snapshot.requirements,
    },
    standards: buildStandardPlan(config).standards,
  };
}
