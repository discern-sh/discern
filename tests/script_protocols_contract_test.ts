import { assert, assertEquals } from "@std/assert";
import { buildConventionsManifest } from "../scripts/contract_manifests.ts";
import { checkpointWhenInput } from "../src/engine/checkpoints/preflight.ts";
import type {
  ResolvedCheckpoint,
  StructuralTriggerOutcome,
} from "../src/engine/checkpoints/types.ts";
import { DISCERN_METRIC_LINE_PREFIX } from "../src/engine/validation/metrics.ts";
import {
  CHECKPOINT_WHEN_FIRE_EXIT_CODE,
  CHECKPOINT_WHEN_INPUT_FIELDS,
  CHECKPOINT_WHEN_INPUT_VERSION,
  CHECKPOINT_WHEN_MATCH_LINE_PREFIX,
  CHECKPOINT_WHEN_PASS_EXIT_CODE,
} from "../src/shared/checkpoints.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";

/** Narrow an unknown manifest member to its object shape. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

Deno.test("the conventions manifest derives both script protocols from runtime constants", () => {
  const protocols = buildConventionsManifest().script_protocols;
  assert(isRecord(protocols));
  assertEquals(protocols.metric, {
    line_prefix: DISCERN_METRIC_LINE_PREFIX,
    line_grammar: `${DISCERN_METRIC_LINE_PREFIX} <name> <number>`,
  });
  assertEquals(protocols.checkpoint_when, {
    input_environment_variable: DISCERN_ENVIRONMENT_VARIABLES.checkpointInput,
    input_version: CHECKPOINT_WHEN_INPUT_VERSION,
    input_fields: [...CHECKPOINT_WHEN_INPUT_FIELDS],
    match_line_prefix: CHECKPOINT_WHEN_MATCH_LINE_PREFIX,
    fire_exit_status: CHECKPOINT_WHEN_FIRE_EXIT_CODE,
    pass_exit_status: CHECKPOINT_WHEN_PASS_EXIT_CODE,
  });
});

Deno.test("the checkpoint writer matches the published input field protocol", () => {
  const definition = {
    id: "protocol-fixture",
    mode: "stop",
    question: "Is the protocol fixture current?",
    includeGenerated: false,
    excludePaths: [],
    unlessChanged: [],
    kinds: [],
    addsMatching: [],
    removesMatching: [],
    newDirectory: false,
    deletionDominant: false,
    similarNewFile: false,
  } satisfies ResolvedCheckpoint;
  const structural = {
    holds: true,
    matched: ["src/example.ts"],
    whenPending: true,
    related: [],
    changed: [{
      path: "src/example.ts",
      generated: false,
      kind: "modified",
      insertions: 2,
      deletions: 1,
      binary: false,
    }],
    history: {
      status: "available",
      count: 1,
      commits: ["a".repeat(40)],
      fingerprint: "history-fixture",
    },
  } satisfies StructuralTriggerOutcome;
  const input = checkpointWhenInput(
    definition,
    "b".repeat(40),
    structural,
  );
  assertEquals(Object.keys(input), [...CHECKPOINT_WHEN_INPUT_FIELDS]);
  assertEquals(input.version, CHECKPOINT_WHEN_INPUT_VERSION);

  const protocols = buildConventionsManifest().script_protocols;
  assert(isRecord(protocols));
  assert(isRecord(protocols.checkpoint_when));
  assertEquals(
    Object.keys(input),
    protocols.checkpoint_when.input_fields,
  );
  assertEquals(input.version, protocols.checkpoint_when.input_version);
});
