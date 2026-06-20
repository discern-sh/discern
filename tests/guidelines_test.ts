import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { compileGuidelines } from "../src/engine/guidelines.ts";

/** Scaffold a temp project with config, two guideline fragments, and one skill. */
async function scaffold(): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "icculus-guidelines-test-" });
  await ensureDir(join(tmp, ".icculus"));
  await Deno.writeTextFile(
    join(tmp, ".icculus/config.toml"),
    '[project]\nagents = ["claude_code", "codex"]\n',
  );
  await ensureDir(join(tmp, ".icculus/guidelines"));
  // Two fragments — names chosen so sort order is deterministic (10 before 20).
  await Deno.writeTextFile(
    join(tmp, ".icculus/guidelines/10-first.md"),
    "# First fragment",
  );
  await Deno.writeTextFile(
    join(tmp, ".icculus/guidelines/20-second.md"),
    "# Second fragment",
  );
  await ensureDir(join(tmp, ".icculus/skills/demo"));
  await Deno.writeTextFile(
    join(tmp, ".icculus/skills/demo/SKILL.md"),
    "demo skill",
  );
  return tmp;
}

Deno.test("compileGuidelines compiles agent files, links skills, then prunes", async () => {
  const tmp = await scaffold();
  try {
    // The concatenation: each sorted source, each followed by a newline.
    const expected = "# First fragment\n# Second fragment\n";

    const first = await compileGuidelines(tmp);
    assertEquals(first.agentsWritten, ["CLAUDE.md", "AGENTS.md"]);
    assertEquals(first.skillsLinked, 1);
    assertEquals(first.skillsPruned, 0);

    // Both agent files exist with the concatenated content.
    assertEquals(await Deno.readTextFile(join(tmp, "CLAUDE.md")), expected);
    assertEquals(await Deno.readTextFile(join(tmp, "AGENTS.md")), expected);

    // The skill link is a relative symlink to the author-once skill.
    const link = join(tmp, ".claude/skills/demo");
    assert((await Deno.lstat(link)).isSymlink, "expected a symlink");
    assertEquals(await Deno.readLink(link), "../../.icculus/skills/demo");

    // --- prune: remove the skill, re-run, the dangling link is gone ----------
    await Deno.remove(join(tmp, ".icculus/skills/demo"), { recursive: true });

    const second = await compileGuidelines(tmp);
    assertEquals(second.skillsLinked, 0);
    assertEquals(second.skillsPruned, 1);
    assertEquals(
      await Deno.lstat(link).then(() => true).catch(() => false),
      false,
      "expected the dangling skill link to be pruned",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
