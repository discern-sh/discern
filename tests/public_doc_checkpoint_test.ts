/**
 * Public-document checkpoint matcher tests.
 *
 * The unit cases pin the versioned process boundary and prove the selector is
 * parameterized by the canonical tier and page models. The subprocess case
 * exercises the real environment/input contract, configured Map lookup, and
 * deleted-page recovery from the governing Git tree.
 */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import {
  assertEquals,
  assertFalse,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  CANONICAL_PUBLIC_DOC_CHECKPOINT_MODEL,
  isCanonicalPublicDocPath,
  matchesCanonicalPublicDoc,
  parsePublicDocCheckpointInput,
  PUBLIC_DOC_CHECKPOINT_ID,
} from "../project/scripts/public_doc_checkpoint.ts";
import { CHECKPOINT_WHEN_INPUT_VERSION } from "../src/shared/checkpoints.ts";
import type { CheckpointWhenInput } from "../src/shared/checkpoints.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import { isPublicDoc } from "../src/lib/docs.ts";
import {
  BUNDLED_PUBLIC_DOC_DIRS,
  MANUAL_SECTION_REGISTRY,
} from "../src/lib/paths.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const SCRIPT = join(
  REPO_ROOT,
  "project",
  "scripts",
  "public_doc_checkpoint.ts",
);
const DENO_CONFIG = join(REPO_ROOT, "deno.json");
const DECODER = new TextDecoder();

interface MatcherResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Construct one valid v1 matcher input. */
function matcherInput(
  policyCommit: string,
  changedFiles: CheckpointWhenInput["changed_files"] = [],
): CheckpointWhenInput {
  return {
    version: CHECKPOINT_WHEN_INPUT_VERSION,
    checkpoint: { id: PUBLIC_DOC_CHECKPOINT_ID, mode: "stop" },
    policy_commit: policyCommit,
    changed_files: changedFiles,
  };
}

/** Run the matcher command with the same least-privilege grants as policy. */
async function runMatcher(
  cwd: string,
  inputPath: string,
): Promise<MatcherResult> {
  const command = new Deno.Command(Deno.execPath(), {
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
  });
  const output = await command.output();
  return {
    code: output.code,
    stdout: DECODER.decode(output.stdout),
    stderr: DECODER.decode(output.stderr),
  };
}

Deno.test("public-doc matcher rejects malformed v1 inputs at its process boundary", () => {
  const valid = matcherInput("a".repeat(40), [{
    path: "project/map/20-quality-gate/page.md",
    kind: "modified",
    insertions: 1,
    deletions: 0,
    binary: false,
  }]);
  assertEquals(
    parsePublicDocCheckpointInput(JSON.stringify(valid)),
    valid,
  );

  const malformed: unknown[] = [
    { ...valid, version: 2 },
    { ...valid, surprise: true },
    {
      ...valid,
      changed_files: [
        { ...valid.changed_files[0], path: "../outside.md" },
      ],
    },
    {
      ...valid,
      changed_files: [
        { ...valid.changed_files[0], path: "z.md" },
        { ...valid.changed_files[0], path: "a.md" },
      ],
    },
  ];
  for (const input of malformed) {
    assertThrows(() => parsePublicDocCheckpointInput(JSON.stringify(input)));
  }
  assertThrows(() => parsePublicDocCheckpointInput("not json"));
});

Deno.test("public-doc matcher follows the canonical tier and publication model", () => {
  assertStrictEquals(
    CANONICAL_PUBLIC_DOC_CHECKPOINT_MODEL.manualSections,
    MANUAL_SECTION_REGISTRY,
  );
  assertStrictEquals(
    CANONICAL_PUBLIC_DOC_CHECKPOINT_MODEL.bundledPublicDirs,
    BUNDLED_PUBLIC_DOC_DIRS,
  );
  assertStrictEquals(
    CANONICAL_PUBLIC_DOC_CHECKPOINT_MODEL.isPublic,
    isPublicDoc,
  );

  const futureSection = "55-future-public";
  const futurePath = `custom-map/${futureSection}/page.md`;
  const registered = {
    manualSections: [
      ...MANUAL_SECTION_REGISTRY,
      { dir: futureSection, audience: "public" as const },
    ],
    bundledPublicDirs: [...BUNDLED_PUBLIC_DOC_DIRS, futureSection],
    isPublic: (): boolean => true,
  };
  assertFalse(
    isCanonicalPublicDocPath(
      futurePath,
      "custom-map/",
      { ...registered, bundledPublicDirs: BUNDLED_PUBLIC_DOC_DIRS },
    ),
  );
  assertEquals(
    matchesCanonicalPublicDoc(
      futurePath,
      "# Future page\n",
      "custom-map/",
      registered,
    ),
    true,
  );
  assertFalse(
    matchesCanonicalPublicDoc(
      futurePath,
      "# Future page\n",
      "custom-map/",
      { ...registered, isPublic: (): boolean => false },
    ),
  );
});

Deno.test("public-doc command emits exact current and deleted canonical matches", async () => {
  await withTempDir(async (dir) => {
    const publicSection = MANUAL_SECTION_REGISTRY.find((section) =>
      section.audience === "public" &&
      BUNDLED_PUBLIC_DOC_DIRS.includes(section.dir)
    );
    const contributorSection = MANUAL_SECTION_REGISTRY.find((section) =>
      section.audience === "contributor"
    );
    if (publicSection === undefined || contributorSection === undefined) {
      throw new Error("manual registry fixture needs both audience tiers");
    }

    const mapDir = "custom-map";
    const publicDir = join(dir, mapDir, publicSection.dir);
    const contributorDir = join(dir, mapDir, contributorSection.dir);
    const internalDir = join(dir, mapDir, "_internal");
    await Promise.all([
      ensureDir(publicDir),
      ensureDir(contributorDir),
      ensureDir(internalDir),
    ]);
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      `[map]\ndir = "${mapDir}/"\n`,
    );
    const deletedPath = `${mapDir}/${publicSection.dir}/deleted.md`;
    await Deno.writeTextFile(join(dir, deletedPath), "# Removed page\n");
    await gitInit(dir);
    const policyCommit = await gitOut(dir, "rev-parse", "HEAD");

    await Deno.remove(join(dir, deletedPath));
    const currentPath = `${mapDir}/${publicSection.dir}/current.md`;
    const withheldPath = `${mapDir}/${publicSection.dir}/withheld.md`;
    const contributorPath = `${mapDir}/${contributorSection.dir}/maintainer.md`;
    const internalPath = `${mapDir}/_internal/plan.md`;
    await Deno.writeTextFile(join(dir, currentPath), "# Current page\n");
    await Deno.writeTextFile(
      join(dir, withheldPath),
      "---\npublish: false\n---\n# Withheld page\n",
    );
    await Deno.writeTextFile(
      join(dir, contributorPath),
      "# Contributor page\n",
    );
    await Deno.writeTextFile(join(dir, internalPath), "# Internal page\n");

    const facts: CheckpointWhenInput["changed_files"] = [
      currentPath,
      deletedPath,
      contributorPath,
      internalPath,
      withheldPath,
    ].sort().map((path) => ({
      path,
      kind: path === deletedPath ? "deleted" as const : "added" as const,
      insertions: path === deletedPath ? 0 : 1,
      deletions: path === deletedPath ? 1 : 0,
      binary: false,
    }));
    const inputPath = join(dir, "checkpoint-input.json");
    await Deno.writeTextFile(
      inputPath,
      JSON.stringify(matcherInput(policyCommit, facts)),
    );

    const result = await runMatcher(dir, inputPath);
    assertEquals(result.code, 0, result.stderr);
    assertEquals(
      result.stdout,
      [currentPath, deletedPath].sort().map((path) => `DISCERN_MATCH ${path}\n`)
        .join(""),
    );
    assertEquals(result.stderr, "");
  });
});

Deno.test("public-doc command fails closed on invalid input", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, "discern.toml"), "");
    await gitInit(dir);
    const inputPath = join(dir, "checkpoint-input.json");
    await Deno.writeTextFile(inputPath, "{}\n");
    const result = await runMatcher(dir, inputPath);
    assertEquals(result.code, 2);
    assertEquals(result.stdout, "");
    assertTerminalTextIncludes(result.stderr, "wrong fields");
  });
});
