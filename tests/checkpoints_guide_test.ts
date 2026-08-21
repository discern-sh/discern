/** Public checkpoint-guide recipes: each example is copyable configuration,
 * and the gallery carries the nine scenarios promised by the narrative. */

import { assert, assertEquals } from "@std/assert";
import { resolveCheckpoints } from "../src/engine/checkpoints/policy.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";

const EXPECTED_RECIPE_IDS = [
  "ci-workflow",
  "dependencies",
  "error-copy-added",
  "error-copy-removed",
  "new-adr",
  "new-subsystem",
  "public-api",
  "release-note",
  "security-sensitive",
  "source-without-tests",
] as const;

Deno.test("the public guide ships nine parseable checkpoint recipes", async () => {
  const recipes = await Deno.readTextFile(
    new URL(
      "../project/map/20-quality-gate/checkpoint-recipes.md",
      import.meta.url,
    ),
  );
  const blocks = [...recipes.matchAll(/```toml\n([\s\S]*?)\n```/g)].map(
    (match) => match[1] ?? "",
  );
  assertEquals(blocks.length, 9);

  const ids: string[] = [];
  for (const block of blocks) {
    assert(
      block.trimStart().startsWith("#"),
      "each recipe starts with guidance",
    );
    const config = parseConfigOrThrow(block);
    const resolved = resolveCheckpoints(config, {});
    assertEquals(resolved.drops, []);
    assertEquals(
      resolved.checkpoints.length,
      Object.keys(config.checkpoints).length,
    );
    ids.push(...resolved.checkpoints.map((checkpoint) => checkpoint.id));
  }
  assertEquals(ids.sort(), [...EXPECTED_RECIPE_IDS].sort());
});

Deno.test("the checkpoint guide routes readers to its recipe gallery", async () => {
  const guide = await Deno.readTextFile(
    new URL("../project/map/20-quality-gate/checkpoints.md", import.meta.url),
  );
  assert(
    guide.includes("[checkpoint recipes](checkpoint-recipes.md)"),
    "the trigger guide must link its companion recipe gallery",
  );
});

Deno.test("the checkpoint placement skill routes the complete trigger model", async () => {
  const skill = await Deno.readTextFile(
    new URL(
      "../templates/skills/discern-place-a-checkpoint/SKILL.md",
      import.meta.url,
    ),
  );
  assert(
    skill.includes(
      "discern docs map/20-quality-gate/checkpoints.md --raw",
    ),
    "the authoring skill must route agents to the complete public field model",
  );
});
