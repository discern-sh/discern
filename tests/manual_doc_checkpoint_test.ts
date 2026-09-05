/** Shared-reader and purpose-specific manual checkpoint matcher coverage. */

import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import {
  assert,
  assertEquals,
  assertFalse,
  assertStrictEquals,
  assertThrows,
} from "@std/assert";
import {
  CANONICAL_MANUAL_CHECKPOINT_MODEL,
  isCanonicalManualPath,
  matchesManualPage,
  parseManualCheckpointInput,
} from "../scripts/manual_doc_checkpoint.ts";
import {
  CHECKPOINT_WHEN_INPUT_VERSION,
  type CheckpointWhenInput,
} from "../src/shared/checkpoints.ts";
import { DISCERN_ENVIRONMENT_VARIABLES } from "../src/shared/environment_variables.ts";
import { GIT_REPOSITORY_LOCATION_ENVIRONMENT } from "../src/shared/subprocess.ts";
import {
  isManualMarkdownPath,
  MANUAL_KIND_REGISTRY,
  MANUAL_PUBLIC_READER_CHECKPOINT_ID,
  MANUAL_SECTION_REGISTRY,
  type ManualKind,
  manualKindForCheckpoint,
  REPOSITORY_MANUAL_REL,
} from "../src/shared/manual.ts";
import { loadConfig } from "../src/shared/config_schema.ts";
import { resolveCheckpoints } from "../src/engine/checkpoints/policy.ts";
import { evaluateStructuralTrigger } from "../src/engine/checkpoints/triggers.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";
import { assertTerminalTextIncludes, withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const SCRIPT = join(
  REPO_ROOT,
  "scripts",
  "manual_doc_checkpoint.ts",
);
const DENO_CONFIG = join(REPO_ROOT, "deno.json");
const DECODER = new TextDecoder();
const CHECKPOINT_IDS = [
  MANUAL_PUBLIC_READER_CHECKPOINT_ID,
  ...MANUAL_KIND_REGISTRY.map((entry) => entry.checkpointId),
];

interface MatcherResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Render one strict manual page for matcher boundary fixtures. */
function page(
  id: string,
  kind: ManualKind,
  publish = true,
): string {
  return [
    "---",
    `id: ${id}`,
    `title: ${JSON.stringify(id)}`,
    `description: ${
      JSON.stringify(
        "A complete manual fixture description that is long enough for strict validation.",
      )
    }`,
    "order: 10",
    `publish: ${publish}`,
    `kind: ${kind}`,
    "aliases:",
    `  - ${JSON.stringify(`${id} alias`)}`,
    "---",
    "",
    `# ${id}`,
    "",
    "Fixture body.",
    "",
  ].join("\n");
}

/** Build one valid policy-commit-governed matcher input. */
function matcherInput(
  checkpointId: string,
  policyCommit: string,
  changedFiles: CheckpointWhenInput["changed_files"] = [],
): CheckpointWhenInput {
  return {
    version: CHECKPOINT_WHEN_INPUT_VERSION,
    checkpoint: { id: checkpointId, mode: "stop" },
    policy_commit: policyCommit,
    changed_files: changedFiles,
  };
}

/** Execute the narrow matcher with every ambient Git route poisoned. */
async function runMatcher(
  cwd: string,
  checkpointId: string,
  input: unknown,
): Promise<MatcherResult> {
  const inputPath = join(cwd, "checkpoint-input.json");
  await Deno.writeTextFile(inputPath, JSON.stringify(input));
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
      checkpointId,
    ],
    cwd,
    env: {
      ...Object.fromEntries(
        GIT_REPOSITORY_LOCATION_ENVIRONMENT.map((name) => [name, "poison"]),
      ),
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

Deno.test("manual matcher boundary accepts only its exact registered checkpoint", () => {
  for (const id of CHECKPOINT_IDS) {
    const valid = matcherInput(id, "a".repeat(40));
    assertEquals(parseManualCheckpointInput(JSON.stringify(valid), id), valid);
    assertThrows(() =>
      parseManualCheckpointInput(JSON.stringify({ ...valid, version: 2 }), id)
    );
    assertThrows(() =>
      parseManualCheckpointInput(JSON.stringify(valid), "unknown-checkpoint")
    );
    assertThrows(() =>
      parseManualCheckpointInput(
        JSON.stringify({
          ...valid,
          changed_files: [{
            path: "../outside.md",
            kind: "modified",
            insertions: 1,
            deletions: 0,
            binary: false,
          }],
        }),
        id,
      )
    );
  }
});

Deno.test("public-reader configuration admits a single authored page in every section and excludes generated output", async () => {
  const { checkpoints } = resolveCheckpoints(await loadConfig(REPO_ROOT));
  const checkpoint = checkpoints.find((entry) =>
    entry.id === MANUAL_PUBLIC_READER_CHECKPOINT_ID
  );
  assert(checkpoint !== undefined);
  assertEquals(checkpoint.mode, "stop");
  const paths = [
    `${REPOSITORY_MANUAL_REL}/README.md`,
    ...MANUAL_SECTION_REGISTRY.map((section) =>
      `${REPOSITORY_MANUAL_REL}/${section.dir}/future-page.md`
    ),
  ];
  for (const path of paths) {
    for (const generated of [false, true]) {
      const result = evaluateStructuralTrigger(checkpoint, {
        files: [{
          path,
          generated,
          kind: "modified",
          insertions: 1,
          deletions: 0,
          binary: false,
        }],
        baseFiles: [],
      });
      assertEquals(result.holds, !generated, `${path}: generated=${generated}`);
    }
  }
});

Deno.test("manual matcher derives all kinds and sections from canonical registries", () => {
  assertEquals(
    CANONICAL_MANUAL_CHECKPOINT_MODEL.rootRel,
    REPOSITORY_MANUAL_REL,
  );
  assertStrictEquals(
    CANONICAL_MANUAL_CHECKPOINT_MODEL.isMarkdownPath,
    isManualMarkdownPath,
  );
  assertStrictEquals(
    CANONICAL_MANUAL_CHECKPOINT_MODEL.kindForCheckpoint,
    manualKindForCheckpoint,
  );
  for (const registration of MANUAL_KIND_REGISTRY) {
    const path = `${REPOSITORY_MANUAL_REL}/00-start/${registration.kind}.md`;
    assert(matchesManualPage(
      path,
      page(`${registration.kind}-fixture`, registration.kind),
      registration.checkpointId,
    ));
    assert(matchesManualPage(
      path,
      page(`${registration.kind}-fixture`, registration.kind),
      MANUAL_PUBLIC_READER_CHECKPOINT_ID,
    ));
    assertFalse(matchesManualPage(
      path,
      page(`${registration.kind}-fixture`, registration.kind, false),
      MANUAL_PUBLIC_READER_CHECKPOINT_ID,
    ));
    const other = MANUAL_KIND_REGISTRY.find((entry) =>
      entry.kind !== registration.kind
    );
    if (other !== undefined) {
      assertFalse(matchesManualPage(
        path,
        page(`${registration.kind}-fixture`, registration.kind),
        other.checkpointId,
      ));
    }
  }
  assertFalse(matchesManualPage(
    `${REPOSITORY_MANUAL_REL}/00-start/withheld.md`,
    page("withheld-fixture", "tutorial", false),
    "manual-tutorial-comprehension",
  ));
  assertFalse(isCanonicalManualPath("project/map/00-orientation/README.md"));
  assertFalse(isCanonicalManualPath("project/manual/_private/notes.md"));
});

Deno.test("manual matcher model seam enrolls a future section and member without path copies", () => {
  const futureModel = {
    rootRel: REPOSITORY_MANUAL_REL,
    isMarkdownPath: (relative: string): boolean =>
      relative.startsWith("50-future/") && relative.endsWith(".md"),
    kindForCheckpoint: (id: string): ManualKind | undefined =>
      id === "manual-future-comprehension" ? "guide" : undefined,
  };
  const path = `${REPOSITORY_MANUAL_REL}/50-future/new-member.md`;
  assert(isCanonicalManualPath(path, futureModel));
  assert(matchesManualPage(
    path,
    page("future-member", "guide"),
    "manual-future-comprehension",
    futureModel,
  ));
  assert(matchesManualPage(
    path,
    page("future-member", "guide"),
    MANUAL_PUBLIC_READER_CHECKPOINT_ID,
    futureModel,
  ));
});

Deno.test("manual matcher emits exact added, modified, and deleted kind matches", async () => {
  await withTempDir(async (dir) => {
    const section = join(dir, REPOSITORY_MANUAL_REL, "00-start");
    await ensureDir(section);
    const deletedRel = `${REPOSITORY_MANUAL_REL}/00-start/deleted.md`;
    const modifiedRel = `${REPOSITORY_MANUAL_REL}/00-start/modified.md`;
    await Deno.writeTextFile(
      join(dir, deletedRel),
      page("deleted", "tutorial"),
    );
    await Deno.writeTextFile(
      join(dir, modifiedRel),
      page("modified", "tutorial"),
    );
    await gitInit(dir);
    const policyCommit = await gitOut(dir, "rev-parse", "HEAD");

    await Deno.remove(join(dir, deletedRel));
    await Deno.writeTextFile(
      join(dir, modifiedRel),
      `${page("modified", "tutorial")}Changed.\n`,
    );
    const addedRel = `${REPOSITORY_MANUAL_REL}/00-start/added.md`;
    const guideRel = `${REPOSITORY_MANUAL_REL}/00-start/guide.md`;
    const withheldRel = `${REPOSITORY_MANUAL_REL}/00-start/withheld.md`;
    await Deno.writeTextFile(join(dir, addedRel), page("added", "tutorial"));
    await Deno.writeTextFile(join(dir, guideRel), page("guide", "guide"));
    await Deno.writeTextFile(
      join(dir, withheldRel),
      page("withheld", "tutorial", false),
    );

    const changed = [addedRel, deletedRel, guideRel, modifiedRel, withheldRel]
      .sort().map((path) => ({
        path,
        kind: path === deletedRel
          ? "deleted" as const
          : path === modifiedRel
          ? "modified" as const
          : "added" as const,
        insertions: path === deletedRel ? 0 : 1,
        deletions: path === deletedRel ? 1 : 0,
        binary: false,
      }));
    const result = await runMatcher(
      dir,
      "manual-tutorial-comprehension",
      matcherInput(
        "manual-tutorial-comprehension",
        policyCommit,
        changed,
      ),
    );
    assertEquals(result.code, 0, result.stderr);
    assertEquals(
      result.stdout.trim().split("\n"),
      [addedRel, deletedRel, modifiedRel].sort().map((path) =>
        `DISCERN_MATCH ${path}`
      ),
      JSON.stringify(result),
    );
    const shared = await runMatcher(
      dir,
      MANUAL_PUBLIC_READER_CHECKPOINT_ID,
      matcherInput(MANUAL_PUBLIC_READER_CHECKPOINT_ID, policyCommit, changed),
    );
    assertEquals(shared.code, 0, shared.stderr);
    assertEquals(shared.stderr, "");
    assertEquals(
      shared.stdout.trim().split("\n"),
      [addedRel, deletedRel, guideRel, modifiedRel].sort().map((path) =>
        `DISCERN_MATCH ${path}`
      ),
    );
    const skipped = await runMatcher(
      dir,
      MANUAL_PUBLIC_READER_CHECKPOINT_ID,
      matcherInput(MANUAL_PUBLIC_READER_CHECKPOINT_ID, policyCommit, [
        ...changed.filter((file) => file.path === withheldRel),
        {
          path: "project/map/README.md",
          kind: "modified",
          insertions: 1,
          deletions: 0,
          binary: false,
        },
      ]),
    );
    assertEquals(skipped, { code: 10, stdout: "", stderr: "" });
  });
});

Deno.test("manual matcher fires closed for malformed, invalid UTF-8, oversized, binary, and traversal input", async () => {
  await withTempDir(async (dir) => {
    const section = join(dir, REPOSITORY_MANUAL_REL, "00-start");
    await ensureDir(section);
    const rel = `${REPOSITORY_MANUAL_REL}/00-start/page.md`;
    await Deno.writeTextFile(join(dir, rel), page("page", "tutorial"));
    await gitInit(dir);
    const policyCommit = await gitOut(dir, "rev-parse", "HEAD");
    const changed = (binary = false): CheckpointWhenInput["changed_files"] => [{
      path: rel,
      kind: "modified",
      insertions: 1,
      deletions: 0,
      binary,
    }];
    for (const id of CHECKPOINT_IDS) {
      const assertClosed = async (input: unknown): Promise<void> => {
        const result = await runMatcher(dir, id, input);
        assertEquals(result.code, 0, result.stderr);
        assertTerminalTextIncludes(result.stderr, "firing closed");
      };

      await Deno.writeTextFile(join(dir, rel), "---\nkind: tutorial\n");
      await assertClosed(matcherInput(id, policyCommit, changed()));
      await Deno.writeFile(join(dir, rel), new Uint8Array([0xff, 0xfe]));
      await assertClosed(matcherInput(id, policyCommit, changed()));
      await Deno.writeTextFile(
        join(dir, rel),
        page("page", "tutorial") + "x".repeat(1024 * 1024),
      );
      await assertClosed(matcherInput(id, policyCommit, changed()));
      await assertClosed(matcherInput(id, policyCommit, changed(true)));
      await assertClosed({
        ...matcherInput(id, policyCommit),
        changed_files: [{
          path: "../outside.md",
          kind: "modified",
          insertions: 1,
          deletions: 0,
          binary: false,
        }],
      });
    }
  });
});
