/**
 * Class guard for authored-change checkpoint evaluation.
 *
 * Predicate: every checkpoint calculation consumes the effort model after all
 * paths owned by the governing config's generated groups have been classified,
 * and excludes generated paths by default. Membership comes from parsed
 * `[generated.*]` entries, so a differently named future group/container enters
 * without this test or the engine learning its name.
 *
 * Scope: checkpoint changed paths and merge-base sibling paths. Generator
 * commands, Linguist presentation, Standards, and non-checkpoint scope
 * classification are deliberately independent consumers and stay out.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { withTempDir } from "./helpers.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { collectEffortDiff } from "../src/engine/checkpoints/diff.ts";
import {
  evaluateStructuralTrigger,
} from "../src/engine/checkpoints/triggers.ts";
import type {
  EffortDiff,
  EffortFileChange,
  ResolvedCheckpoint,
} from "../src/engine/checkpoints/types.ts";
import { loadGoverningPolicy } from "../src/engine/checkpoints/policy.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  type ResolvedGeneratedGroup,
  resolveGeneratedGroups,
} from "../src/shared/generated_artifacts.ts";

interface ClassifiedChange extends EffortFileChange {
  generated: boolean;
}

interface ClassifiedBasePath {
  path: string;
  generated: boolean;
}

interface ClassifiedEffortDiff extends Omit<EffortDiff, "files" | "baseFiles"> {
  files: readonly ClassifiedChange[];
  baseFiles: readonly ClassifiedBasePath[];
}

interface AuthoredCheckpoint extends ResolvedCheckpoint {
  includeGenerated: boolean;
  excludePaths: readonly string[];
}

/** Invoke the intended additive collector contract while this detector leads
 * the implementation. The cast keeps the red guard compilable against the old
 * two-argument implementation. */
async function classifiedDiff(
  root: string,
  base: string,
  groups: readonly ResolvedGeneratedGroup[],
): Promise<ClassifiedEffortDiff> {
  const collect = collectEffortDiff as unknown as (
    root: string,
    base: string,
    groups: readonly ResolvedGeneratedGroup[],
  ) => Promise<ClassifiedEffortDiff | undefined>;
  const result = await collect(root, base, groups);
  assert(result !== undefined);
  return result;
}

/** Build one classified changed-file fixture with optional metric overrides. */
function change(
  path: string,
  generated: boolean,
  over: Partial<EffortFileChange> = {},
): ClassifiedChange {
  return {
    path,
    kind: "modified",
    insertions: 1,
    deletions: 0,
    binary: false,
    ...over,
    generated,
  };
}

/** Build one resolved authored-change checkpoint fixture. */
function checkpoint(
  over: Partial<AuthoredCheckpoint> = {},
): AuthoredCheckpoint {
  return {
    id: "authored-probe",
    mode: "stop",
    question: "The authored change is judged.",
    includeGenerated: false,
    excludePaths: [],
    unlessChanged: [],
    deletionDominant: false,
    similarNewFile: false,
    ...over,
  };
}

Deno.test("every governing generated group classifies changed and base paths", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, "built"), { recursive: true });
    await Deno.mkdir(join(dir, "telemetry"), { recursive: true });
    await Deno.writeTextFile(join(dir, "authored.ts"), "export const n = 1;\n");
    await Deno.writeTextFile(join(dir, "built", "client.ts"), "old\n");
    await Deno.writeTextFile(join(dir, "telemetry", "snapshot.json"), "{}\n");
    await gitInit(dir);
    const base = await gitOut(dir, "rev-parse", "HEAD");

    await Deno.writeTextFile(join(dir, "authored.ts"), "export const n = 2;\n");
    await Deno.writeTextFile(join(dir, "built", "client.ts"), "new\n");
    await Deno.writeTextFile(
      join(dir, "telemetry", "snapshot.json"),
      '{"new":true}\n',
    );

    const config = parseConfigOrThrow(`
[generated.codegen]
paths = ["built/**"]
run = "build-client"

# Adversarial future sibling: its unrelated name must require no detector or
# engine membership edit.
[generated.telemetry-export]
paths = ["telemetry/**"]
run = "export-telemetry"
`);
    const groups = resolveGeneratedGroups(config);
    const diff = await classifiedDiff(dir, base, groups);
    const changed = new Map(diff.files.map((file) => [file.path, file]));
    assertEquals(changed.get("authored.ts")?.generated, false);
    assertEquals(changed.get("built/client.ts")?.generated, true);
    assertEquals(changed.get("telemetry/snapshot.json")?.generated, true);
    assertEquals(
      diff.baseFiles.find((file) => file.path === "built/client.ts")
        ?.generated,
      true,
    );
    assertEquals(
      diff.baseFiles.find((file) => file.path === "telemetry/snapshot.json")
        ?.generated,
      true,
    );
  });
});

Deno.test("generated and explicitly excluded paths leave structural calculations before conditions", () => {
  const diff = {
    files: [
      change("src/authored.ts", false),
      change("generated/client.ts", true, {
        insertions: 0,
        deletions: 500,
      }),
      change("notes/noise.md", false),
    ],
    baseFiles: [],
  } satisfies ClassifiedEffortDiff;

  assertEquals(
    evaluateStructuralTrigger(checkpoint({ minChangedFiles: 3 }), diff),
    { holds: false, vetoedBy: "min_changed_files" },
  );
  assertEquals(
    evaluateStructuralTrigger(
      checkpoint({
        includeGenerated: true,
        minChangedFiles: 3,
      }),
      diff,
    ).holds,
    true,
  );
  assertEquals(
    evaluateStructuralTrigger(
      checkpoint({
        selector: { globs: ["generated/**"] },
      }),
      diff,
    ) as unknown,
    { holds: false, vetoedBy: "generated_only" },
  );
  assertEquals(
    evaluateStructuralTrigger(
      checkpoint({
        selector: { globs: ["notes/**"] },
        excludePaths: ["notes/**"],
      }),
      diff,
    ) as unknown,
    { holds: false, vetoedBy: "excluded_only" },
  );
  assertEquals(
    evaluateStructuralTrigger(
      checkpoint({ deletionDominant: true }),
      diff,
    ),
    { holds: false, vetoedBy: "deletion_dominant" },
  );
  assertEquals(
    evaluateStructuralTrigger(
      checkpoint({
        unlessChanged: ["generated/**"],
      }),
      diff,
    ).holds,
    true,
  );
  assertEquals(
    evaluateStructuralTrigger(
      checkpoint({
        unlessChanged: ["notes/**"],
        excludePaths: ["notes/**"],
      }),
      diff,
    ).holds,
    true,
  );
});

Deno.test("generated similar siblings are invisible by default and related evidence stays typed", () => {
  const diff = {
    files: [change("src/service_v2.ts", false, { kind: "added" })],
    baseFiles: [{ path: "src/service.ts", generated: true }],
  } satisfies ClassifiedEffortDiff;
  assertEquals(
    evaluateStructuralTrigger(
      checkpoint({ similarNewFile: true }),
      diff as unknown as EffortDiff,
    ),
    { holds: false, vetoedBy: "similar_new_file" },
  );
  const included = evaluateStructuralTrigger(
    checkpoint({ similarNewFile: true, includeGenerated: true }),
    diff as unknown as EffortDiff,
  );
  assert(included.holds);
  assertEquals(included.matched, ["src/service_v2.ts"]);
  assertEquals(
    (included as unknown as { related: unknown }).related,
    [{
      kind: "similar_existing",
      forPath: "src/service_v2.ts",
      path: "src/service.ts",
    }],
  );
});

Deno.test("the merge-base supplies generated ownership and branch-local self-exemption fails", async () => {
  await withTempDir(async (dir) => {
    const governing = `
[repository]
trunk = "main"

[generated.codegen]
paths = ["generated/**"]
run = "codegen"

[checkpoints.authored]
paths = ["src/**"]
question = "The authored change is judged."
`;
    await Deno.writeTextFile(join(dir, "discern.toml"), governing);
    await Deno.mkdir(join(dir, "src"), { recursive: true });
    await Deno.writeTextFile(join(dir, "src", "entry.ts"), "old\n");
    await gitInit(dir);
    await git(dir, "checkout", "-q", "-b", "agent/probe");

    // The branch tries to classify its authored source as generated and opt the
    // checkpoint out. Neither candidate-side edit may govern this effort.
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      governing.replace(
        'paths = ["generated/**"]',
        'paths = ["generated/**", "src/**"]',
      ).replace(
        'question = "The authored change is judged."',
        'include_generated = false\nexclude_paths = ["src/**"]\nquestion = "The authored change is judged."',
      ),
    );
    await git(dir, "add", "discern.toml");
    await git(dir, "commit", "-q", "-m", "try self exemption", "--no-gpg-sign");

    const policy = await loadGoverningPolicy(dir, parseConfigOrThrow(""));
    const governingGroups = (policy as unknown as {
      generatedGroups: readonly ResolvedGeneratedGroup[];
    }).generatedGroups;
    assertEquals(governingGroups.map((group) => group.paths), [
      ["generated/**"],
    ]);
    const resolved = policy.checkpoints[0] as AuthoredCheckpoint | undefined;
    assert(resolved !== undefined);
    assertEquals(resolved.includeGenerated, false);
    assertEquals(resolved.excludePaths, []);
  });
});
