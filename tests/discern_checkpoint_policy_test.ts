/**
 * discern's project-authored checkpoint policy.
 *
 * This guard keeps the seven judgment boundaries narrow after config parsing and
 * reference expansion. It also exercises the generated-artifact default and
 * the exact v1 facts handed to the public-document matcher.
 */

import { assert, assertEquals, assertFalse } from "@std/assert";
import { resolveCheckpoints } from "../src/engine/checkpoints/policy.ts";
import { checkpointWhenInput } from "../src/engine/checkpoints/preflight.ts";
import { evaluateStructuralTrigger } from "../src/engine/checkpoints/triggers.ts";
import type {
  EffortDiff,
  ResolvedCheckpoint,
} from "../src/engine/checkpoints/types.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { BUILT_IN_CHECKPOINTS } from "../src/shared/checkpoints.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const PROJECT_CHECKPOINT_IDS = [
  "public-doc-audience",
  "templates-stay-generic",
  "shipped-instruction-rent",
  "authority-boundary",
  "adr-quality",
  "feature-benefit-currency",
  "public-contract",
] as const;

const AUTHORITY_BOUNDARY_PATHS = [
  "src/engine/gate/execute.ts",
  "src/engine/gate/proof.ts",
  "src/engine/checkpoints/evidence.ts",
  "src/engine/checkpoints/subject.ts",
  "src/engine/checkpoints/open_questions.ts",
  "src/engine/checkpoints/preflight.ts",
  "src/shared/declarations.ts",
  "src/shared/consent.ts",
  "src/engine/worktree/effort_grant.ts",
  "src/engine/worktree/effort_grant_writer.ts",
  "src/engine/worktree/effort_grant_cleanup.ts",
  "src/engine/worktree/landing_authority.ts",
  "src/engine/worktree/acceptance_checkpoints.ts",
  "src/engine/worktree/acceptance_transaction.ts",
  "src/engine/worktree/lifecycle.ts",
] as const;

const PUBLIC_CONTRACT_PATHS = [
  "src/shared/config_schema.ts",
  "src/shared/public_schemas.ts",
  "src/shared/config_codegen.ts",
  "src/shared/result.ts",
  "src/shared/result_schemas.ts",
  "src/shared/result_contracts.ts",
  "src/shared/result_formats.ts",
  "src/shared/result_serialization.ts",
  "src/shared/result_codegen.ts",
  "src/shared/verbs.ts",
  "src/main.ts",
  "src/engine/mcp/server.ts",
  "src/engine/gate/proof_notes.ts",
  "src/engine/logbook/schema.ts",
  "scripts/public_schema_compatibility.ts",
] as const;

const CONFIG = await loadConfig(REPO_ROOT);
const RESOLUTION = resolveCheckpoints(CONFIG);

/** Return one required resolved policy entry. */
function checkpoint(id: string): ResolvedCheckpoint {
  const found = RESOLUTION.checkpoints.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`checkpoint ${id} did not resolve`);
  return found;
}

Deno.test("discern resolves exactly seven project boundary checkpoints", () => {
  assertEquals(RESOLUTION.drops, []);
  const authored = Object.keys(CONFIG.checkpoints).filter((id) =>
    !Object.hasOwn(BUILT_IN_CHECKPOINTS, id)
  );
  assertEquals(authored.sort(), [...PROJECT_CHECKPOINT_IDS].sort());

  assertEquals(checkpoint("public-doc-audience").mode, "stop");
  assertEquals(
    checkpoint("public-doc-audience").selector?.globs,
    ["project/map/**"],
  );
  assertEquals(
    checkpoint("public-doc-audience").when,
    "deno run --quiet --no-prompt --allow-read " +
      "--allow-env=DISCERN_CHECKPOINT_INPUT --allow-run=git " +
      "project/scripts/public_doc_checkpoint.ts",
  );

  assertEquals(checkpoint("templates-stay-generic").mode, "stop");
  assertEquals(
    checkpoint("templates-stay-generic").selector?.globs,
    ["templates/**"],
  );
  assertEquals(checkpoint("shipped-instruction-rent").mode, "stop");
  assertEquals(
    checkpoint("shipped-instruction-rent").selector?.globs,
    ["templates/instructions/**"],
  );

  assertEquals(checkpoint("authority-boundary").mode, "stop");
  assertEquals(
    checkpoint("authority-boundary").selector?.globs,
    AUTHORITY_BOUNDARY_PATHS,
  );
  assertFalse(
    checkpoint("authority-boundary").selector?.globs.includes("src/**") ??
      false,
  );

  assertEquals(checkpoint("adr-quality").mode, "advise");
  assertEquals(
    checkpoint("adr-quality").selector?.globs,
    ["project/map/_adr/**"],
  );
  assertEquals(checkpoint("adr-quality").kinds, ["added"]);

  assertEquals(checkpoint("public-contract").mode, "advise");
  assertEquals(
    checkpoint("public-contract").selector?.globs,
    PUBLIC_CONTRACT_PATHS,
  );
  assertFalse(
    checkpoint("public-contract").selector?.globs.includes("src/**") ?? false,
  );

  assertEquals(checkpoint("feature-benefit-currency").mode, "advise");
  assertEquals(
    checkpoint("feature-benefit-currency").selector?.globs,
    [
      "src/main.ts",
      "src/engine/**",
      "src/shared/hints.ts",
      "src/shared/result*.ts",
      "templates/**",
      "scripts/brand/claims.ts",
    ],
  );
  assertEquals(
    checkpoint("feature-benefit-currency").unlessChanged,
    [],
  );
  assertEquals(
    checkpoint("feature-benefit-currency").when,
    "deno run --quiet --no-prompt --allow-read " +
      "--allow-env=DISCERN_CHECKPOINT_INPUT --allow-run=git " +
      "project/scripts/feature_benefit_currency_checkpoint.ts",
  );
  assertEquals(
    checkpoint("feature-benefit-currency").teach,
    "The matcher compares all three canon regions independently; " +
      "an unchanged region may be correct, but it still needs review.",
  );

  const mapFocus = checkpoint("map-focus");
  assertEquals(mapFocus.minChangedFiles, 2);
  assertEquals(
    mapFocus.teach,
    "Remove stale material, link the authority, and cut mechanically derivable prose.",
  );
  assertFalse(Object.hasOwn(CONFIG.checkpoints, "map-conventions"));
});

Deno.test("boundary checkpoints exclude generated subjects by default", () => {
  for (const id of PROJECT_CHECKPOINT_IDS) {
    assertFalse(checkpoint(id).includeGenerated, id);
  }

  const generatedTemplate = {
    path:
      "templates/skills/discern-write-adr/skeleton/docs/_adr/0000-template.md",
    generated: true,
    kind: "modified" as const,
    insertions: 1,
    deletions: 1,
    binary: false,
  };
  const diff: EffortDiff = {
    files: [generatedTemplate],
    baseFiles: [{ path: generatedTemplate.path, generated: true }],
  };
  assertEquals(
    evaluateStructuralTrigger(checkpoint("templates-stay-generic"), diff),
    { holds: false, vetoedBy: "generated_only" },
  );
});

Deno.test("public-doc when input contains only authored pre-scoped facts", () => {
  const authored = {
    path: "project/map/20-quality-gate/checkpoints.md",
    generated: false,
    kind: "modified" as const,
    insertions: 5,
    deletions: 2,
    binary: false,
  };
  const generated = {
    path: "project/map/70-reference/cli-reference.md",
    generated: true,
    kind: "modified" as const,
    insertions: 20,
    deletions: 20,
    binary: false,
  };
  const diff: EffortDiff = {
    files: [generated, authored],
    baseFiles: [
      { path: authored.path, generated: false },
      { path: generated.path, generated: true },
    ],
  };
  const definition = checkpoint("public-doc-audience");
  const structural = evaluateStructuralTrigger(definition, diff);
  assert(structural.holds);
  assertEquals(structural.matched, [authored.path]);
  assertEquals(structural.whenPending, true);
  assertEquals(
    checkpointWhenInput(definition, "b".repeat(40), structural),
    {
      version: 1,
      checkpoint: { id: "public-doc-audience", mode: "stop" },
      policy_commit: "b".repeat(40),
      changed_files: [{
        path: authored.path,
        kind: "modified",
        insertions: 5,
        deletions: 2,
        binary: false,
      }],
    },
  );
});
