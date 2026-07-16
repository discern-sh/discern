/**
 * The standards denominators measure PROSE, never metadata: the public-doc
 * word count and Vale's staged input both exclude frontmatter, and the Vale
 * stage mirrors `.vale.ini`'s `_private` exclusion (staged paths no longer
 * match the config glob, so the skip must be re-applied at staging).
 */

import { join } from "@std/path";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  blankFrontmatter,
  restoreStagePaths,
  stageProseInput,
} from "../scripts/prose_lib.ts";
import { withTempDir } from "./helpers.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";

const FRONTMATTERED = "---\n" +
  "title: Meta words that must not count\n" +
  "aliases:\n  - extra\n" +
  "---\n" +
  "# Doc\n\nSeven words of actual prose live here.\n";

Deno.test("blankFrontmatter removes the block but keeps line numbers stable", () => {
  const blanked = blankFrontmatter(FRONTMATTERED);
  assertEquals(
    blanked.split("\n").length,
    FRONTMATTERED.split("\n").length,
    "line count is preserved so Vale diagnostics stay accurate",
  );
  assert(!blanked.includes("Meta words"));
  assertStringIncludes(blanked, "Seven words of actual prose");
  // A block-less doc passes through byte-identical.
  assertEquals(blankFrontmatter("# Plain\n\nBody.\n"), "# Plain\n\nBody.\n");
});

Deno.test("stageProseInput blanks frontmatter and skips _private", async () => {
  await withTempDir(async (dir) => {
    const map = join(dir, "map");
    await Deno.mkdir(join(map, "_private"), { recursive: true });
    await Deno.mkdir(join(map, "10-tier"), { recursive: true });
    await Deno.writeTextFile(join(map, "10-tier/page.md"), FRONTMATTERED);
    await Deno.writeTextFile(
      join(map, "_private/notes.md"),
      "# Unshipped notes\n",
    );

    const stage = await stageProseInput(map);
    try {
      const staged = await Deno.readTextFile(join(stage, "10-tier/page.md"));
      assert(!staged.includes("Meta words"));
      assertStringIncludes(staged, "Seven words of actual prose");

      let sawPrivate = false;
      try {
        await Deno.stat(join(stage, "_private/notes.md"));
        sawPrivate = true;
      } catch {
        // absent, as required
      }
      assertEquals(sawPrivate, false, "_private never reaches Vale's input");

      // Diagnostics map back to the real tree.
      assertEquals(
        restoreStagePaths(`${stage}/10-tier/page.md:3:1 alert`, stage, map),
        `${map}/10-tier/page.md:3:1 alert`,
      );
    } finally {
      await Deno.remove(stage, { recursive: true });
    }
  });
});

Deno.test("the public-doc word count excludes frontmatter", async () => {
  await withTempDir(async (dir) => {
    const map = join(dir, "map");
    await Deno.mkdir(join(map, "10-tier"), { recursive: true });
    await Deno.writeTextFile(join(map, "10-tier/page.md"), FRONTMATTERED);

    const run = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-read",
        join(REPO_ROOT, "scripts/public_doc_density.ts"),
        map,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(run.code, 0, new TextDecoder().decode(run.stderr));
    const stdout = new TextDecoder().decode(run.stdout);
    // "# Doc" + "Seven words of actual prose live here." = 8 words; the
    // frontmatter's words never count.
    assertStringIncludes(stdout, "DISCERN_METRIC public_doc_words 8");
    assertStringIncludes(stdout, "DISCERN_METRIC public_doc_leaves 1");
  });
});
