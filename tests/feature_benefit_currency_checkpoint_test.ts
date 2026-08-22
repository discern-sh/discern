/**
 * Feature/benefit currency checkpoint tests.
 *
 * The matrix proves that touching one region of the shared registry cannot
 * hide the other two from review. The subprocess case pins the real Git,
 * environment, input, and `DISCERN_MATCH` boundary used by checkpoint policy.
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  changedFeatureBenefitCanonSections,
  FEATURE_BENEFIT_CANON_SECTION_IDS,
  FEATURE_BENEFIT_CANON_SECTION_MARKERS,
  FEATURE_BENEFIT_CURRENCY_CHECKPOINT_ID,
  featureBenefitCanonSections,
  featureBenefitCurrencyReviewRequired,
} from "../project/scripts/feature_benefit_currency_checkpoint.ts";
import { CHECKPOINT_WHEN_INPUT_VERSION } from "../src/shared/checkpoints.ts";
import type { CheckpointWhenInput } from "../src/shared/checkpoints.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const SCRIPT = join(
  REPO_ROOT,
  "project",
  "scripts",
  "feature_benefit_currency_checkpoint.ts",
);
const DENO_CONFIG = join(REPO_ROOT, "deno.json");
const LIVE_REGISTRY = join(REPO_ROOT, "scripts", "feature_registry.ts");
const DECODER = new TextDecoder();

interface MatcherResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Build one minimal source with the production region boundaries. */
function registrySource(
  feature = "feature-v1",
  human = "human-v1",
  agent = "agent-v1",
): string {
  return [
    "untracked prelude",
    FEATURE_BENEFIT_CANON_SECTION_MARKERS.feature,
    feature,
    FEATURE_BENEFIT_CANON_SECTION_MARKERS["human-benefit"],
    human,
    FEATURE_BENEFIT_CANON_SECTION_MARKERS["agent-benefit"],
    agent,
    "",
  ].join("\n");
}

/** Construct one valid v1 matcher input. */
function matcherInput(policyCommit: string): CheckpointWhenInput {
  return {
    version: CHECKPOINT_WHEN_INPUT_VERSION,
    checkpoint: {
      id: FEATURE_BENEFIT_CURRENCY_CHECKPOINT_ID,
      mode: "advise",
    },
    policy_commit: policyCommit,
    changed_files: [{
      path: "src/main.ts",
      kind: "modified",
      insertions: 1,
      deletions: 0,
      binary: false,
    }, {
      path: "templates/instructions/built-in.md",
      kind: "modified",
      insertions: 2,
      deletions: 1,
      binary: false,
    }],
  };
}

/** Run the matcher with the same least-privilege grants as project policy. */
async function runMatcher(
  cwd: string,
  inputPath: string,
): Promise<MatcherResult> {
  const output = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--quiet",
      "--config",
      DENO_CONFIG,
      "--no-prompt",
      "--allow-read",
      `--allow-env=${DISCERN_ENVIRONMENT_VARIABLES.checkpointInput}`,
      "--allow-run=git",
      SCRIPT,
    ],
    cwd,
    env: {
      [DISCERN_ENVIRONMENT_VARIABLES.checkpointInput]: inputPath,
    },
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: output.code,
    stdout: DECODER.decode(output.stdout),
    stderr: DECODER.decode(output.stderr),
  };
}

Deno.test("currency matcher partitions the live canon registry", async () => {
  const sections = featureBenefitCanonSections(
    await Deno.readTextFile(LIVE_REGISTRY),
  );
  assertEquals(Object.keys(sections), [...FEATURE_BENEFIT_CANON_SECTION_IDS]);
  for (const id of FEATURE_BENEFIT_CANON_SECTION_IDS) {
    assertStringIncludes(
      sections[id],
      FEATURE_BENEFIT_CANON_SECTION_MARKERS[id],
    );
  }

  assertThrows(() => featureBenefitCanonSections("no section markers"));
  assertThrows(() =>
    featureBenefitCanonSections(
      registrySource() + FEATURE_BENEFIT_CANON_SECTION_MARKERS.feature,
    )
  );
});

Deno.test("currency matcher reviews every proper subset of changed canon regions", () => {
  const governing = registrySource();
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = registrySource(
      (mask & 1) === 0 ? "feature-v1" : "feature-v2",
      (mask & 2) === 0 ? "human-v1" : "human-v2",
      (mask & 4) === 0 ? "agent-v1" : "agent-v2",
    );
    const expected = FEATURE_BENEFIT_CANON_SECTION_IDS.filter((_, index) =>
      (mask & (1 << index)) !== 0
    );
    assertEquals(
      changedFeatureBenefitCanonSections(governing, candidate),
      expected,
      `mask ${mask}`,
    );
    assertEquals(
      featureBenefitCurrencyReviewRequired(governing, candidate),
      mask !== 7,
      `mask ${mask}`,
    );
  }
});

Deno.test("currency command emits exact matches until all three regions move", async () => {
  await withTempDir(async (dir) => {
    const registry = join(dir, "scripts", "feature_registry.ts");
    await ensureDir(join(dir, "scripts"));
    await Deno.writeTextFile(registry, registrySource());
    await Deno.writeTextFile(join(dir, "product.txt"), "baseline\n");
    await gitInit(dir);
    const policyCommit = await gitOut(dir, "rev-parse", "HEAD");
    const inputPath = join(dir, "checkpoint-input.json");
    await Deno.writeTextFile(
      inputPath,
      JSON.stringify(matcherInput(policyCommit)),
    );

    await Deno.writeTextFile(registry, registrySource("feature-v2"));
    const partial = await runMatcher(dir, inputPath);
    assertEquals(partial.code, 0);
    assertEquals(
      partial.stdout,
      "DISCERN_MATCH src/main.ts\n" +
        "DISCERN_MATCH templates/instructions/built-in.md\n",
    );
    assertEquals(partial.stderr, "");

    await Deno.writeTextFile(
      registry,
      registrySource("feature-v2", "human-v2", "agent-v2"),
    );
    const complete = await runMatcher(dir, inputPath);
    assertEquals(complete, { code: 1, stdout: "", stderr: "" });

    await Deno.writeTextFile(
      inputPath,
      JSON.stringify({ ...matcherInput(policyCommit), surprise: true }),
    );
    const malformed = await runMatcher(dir, inputPath);
    assertEquals(malformed.code, 2);
    assertEquals(malformed.stdout, "");
    assertTerminalTextIncludes(malformed.stderr, "wrong fields");
  });
});
