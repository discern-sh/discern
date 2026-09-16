/** Map source evidence follows real links and the exact review subject. */
import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { discoverDocs } from "../src/lib/docs.ts";
import { buildMapOverview, mapPageFreshness } from "../src/lib/map_overview.ts";
import { mapSourcePaths } from "../src/lib/map_sources.ts";
import { collectMapSources } from "../src/engine/checkpoints/map_sources.ts";
import { resolveCheckpoints } from "../src/engine/checkpoints/policy.ts";
import { evaluateStructuralTrigger } from "../src/engine/checkpoints/triggers.ts";
import type { EffortDiff } from "../src/engine/checkpoints/types.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { fire, HINTS } from "../src/shared/hints.ts";
import { git, gitInit, gitOut } from "./engine_helpers.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("map source links use rendered links without treating examples or directories as coverage", () => {
  const markdown = [
    "[implementation](../../../src/one%20file.ts#entry)",
    "[folder](../../../src/)",
    "[map](../other.md)",
    "[external](https://example.com/source.ts)",
    "<!-- [hidden](../../../src/hidden.ts) -->",
    "`[literal](../../../src/literal.ts)`",
    "```md\n[fenced](../../../src/fenced.ts)\n```",
    "[invalid](../../../src/%FF)",
  ].join("\n\n");
  assertEquals(
    mapSourcePaths(
      "/project",
      "discern/map",
      "discern/map/runtime/README.md",
      markdown,
    ),
    ["src/one file.ts"],
  );
});

Deno.test("nested configured maps measure each page and root against their own source history", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(join(root, "guide", "map", "runtime"), {
      recursive: true,
    });
    await Deno.mkdir(join(root, "src"));
    await Deno.writeTextFile(join(root, "src", "unit[one].ts"), "first\n");
    await Deno.writeTextFile(join(root, "src", "unitn.ts"), "unrelated\n");
    await Deno.writeTextFile(
      join(root, "guide/map/README.md"),
      "# Project\n\n[Source](../../src/unit[one].ts).\n",
    );
    await Deno.writeTextFile(
      join(root, "guide/map/runtime/README.md"),
      "# Runtime\n\n[Source](../../../src/unit[one].ts).\n",
    );
    await gitInit(root);
    await Deno.writeTextFile(join(root, "src/unit[one].ts"), "second\n");
    await git(root, "add", "src/unit[one].ts");
    await git(root, "commit", "-qm", "Change source");
    await Deno.writeTextFile(join(root, "src/unitn.ts"), "still unrelated\n");
    await git(root, "add", "src/unitn.ts");
    await git(root, "commit", "-qm", "Change a filename matching a glob");
    await Deno.writeTextFile(
      join(root, "guide/map/runtime/untracked.md"),
      "# New\n\n[Source](../../../src/unit[one].ts).\n",
    );
    const tree = await discoverDocs({ cwd: root, dir: "guide/map" });
    assertExists(tree);
    const overview = await buildMapOverview(tree);
    assertEquals(
      overview[0]?.code_changes_since,
      1,
      JSON.stringify({ root: tree.root, directory: tree.docsDir, overview }),
    );
    const unknown = overview[0]?.pages.find((page) =>
      page.target.endsWith("untracked")
    );
    assertExists(unknown);
    assertEquals(unknown.code_changes_since, undefined);
    const front = tree.entries.find((entry) => entry.relToDocs === "README.md");
    assertExists(front);
    const facts = await mapPageFreshness(tree, front);
    assertEquals(facts.code_changes_since, 1);
    assertEquals(facts.source_paths, ["src/unit[one].ts"]);
  });
});

Deno.test("map checkpoint evidence preserves base links and reads the pinned candidate instead of dirty files", async () => {
  await withTempDir(async (root) => {
    const directory = "guide/map";
    const page = `${directory}/_internal/runtime.md`;
    await Deno.mkdir(join(root, directory, "_internal"), { recursive: true });
    await Deno.mkdir(join(root, "src"));
    await Deno.writeTextFile(
      join(root, page),
      "# Runtime\n\n[Source](../../../src/unit[one].ts).\n",
    );
    await Deno.writeTextFile(join(root, "src/unit[one].ts"), "first\n");
    await gitInit(root);
    const base = await gitOut(root, "rev-parse", "HEAD");
    // Removing a link does not remove the explanation from this change's review.
    await Deno.writeTextFile(
      join(root, page),
      "# Runtime\n\nThe explanation now omits its evidence.\n",
    );
    await Deno.writeTextFile(join(root, "src/unit[one].ts"), "second\n");
    await git(root, "add", "-A");
    await git(root, "commit", "-qm", "Change source and explanation");
    const current = await gitOut(root, "rev-parse", "HEAD");
    await Deno.writeTextFile(
      join(root, page),
      "# Dirty\n\n[Unproven](../../../src/other.ts).\n",
    );
    const { checkpoints } = resolveCheckpoints(
      parseConfigOrThrow(
        `[map]\ndir = "${directory}/"\n[checkpoints.map-drift]\n`,
      ),
    );
    const def = checkpoints[0];
    assertExists(def);
    const paths = [page, "src/unit[one].ts"];
    const diff: EffortDiff = {
      baseFiles: paths.map((path) => ({ path, generated: false })),
      files: paths.map((path) => ({
        path,
        generated: false,
        kind: "modified",
        insertions: 1,
        deletions: 1,
        binary: false,
      })),
    };
    const evidence = await collectMapSources(
      root,
      base,
      diff,
      checkpoints,
      current,
    );
    assertEquals(evidence.mapSources, {
      complete: true,
      pages: [{ path: page, sources: ["src/unit[one].ts"] }],
    });
    const outcome = evaluateStructuralTrigger(def, evidence);
    assert(outcome.holds);
    assertEquals(outcome.related, [{
      kind: "map_explanation",
      forPath: "src/unit[one].ts",
      path: page,
    }]);
    const hint = fire(HINTS["checkpoint-advise"], {
      id: def.id,
      question: def.question,
      matched: ["src/unit[one].ts"],
      related: [{
        kind: "map_explanation",
        for_path: "src/unit[one].ts",
        path: page,
      }],
    });
    assertStringIncludes(hint.text, "links to");
    assertStringIncludes(hint.text, page);
  });
});
