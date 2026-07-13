/**
 * Class-level well-formedness guard for EVERY bundled skill (`templates/skills/*`).
 *
 * This test is itself an instance of the discipline it protects: it does not check
 * one skill, it iterates the canonical set — `bundledSkillNames()` over
 * `resolveBundledSkillsDir()`, the SAME single source of truth the materializer
 * drives off — so a newly-added skill auto-enrolls and a malformed or mis-named one
 * fails the gate. Each bundled skill must be a directory holding a `SKILL.md` whose
 * frontmatter parses (via `parseSkillFrontmatter`, the one skill-frontmatter reader),
 * carries a non-empty `name` and `description`, and whose `name` equals its directory.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { resolveBundledSkillsDir } from "../src/lib/paths.ts";
import { bundledSkillNames, parseSkillFrontmatter } from "../src/lib/skills.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

Deno.test("bundled skills: every one is well-formed (frontmatter name === directory)", async () => {
  const dir = await resolveBundledSkillsDir();
  const names = await bundledSkillNames();
  assert(
    names.length > 0,
    "expected at least one bundled skill under templates/skills/",
  );

  for (const name of names) {
    // One try per skill so EVERY failure mode — no SKILL.md, an unparseable fence,
    // an empty or mismatched field — is reported with the offending skill named.
    try {
      const text = await Deno.readTextFile(join(dir, name, "SKILL.md"));
      const fm = parseSkillFrontmatter(text);
      assert(fm.name.trim().length > 0, "frontmatter 'name' is empty");
      assert(
        fm.description.trim().length > 0,
        "frontmatter 'description' is empty",
      );
      assertEquals(
        fm.name,
        name,
        "frontmatter 'name' must equal the skill's directory name",
      );
      // Every bundled skill carries the discern attribution in its frontmatter, so
      // provenance travels with the file wherever it materializes. Checked over the
      // canonical set, so a new skill added without it fails the gate. Asserted on
      // the raw frontmatter text (the flat reader deliberately surfaces only
      // name/description); the exact author string is the single source below.
      const fence = text.indexOf("\n---", 3);
      const front = fence === -1 ? text : text.slice(0, fence);
      assert(
        front.includes('author: "discern | https://discern.sh"'),
        "frontmatter 'metadata.author' must be the discern attribution",
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`bundled skill '${name}' is malformed: ${detail}`);
    }
  }
});

Deno.test("bundled skills: the install-surface doc's table lists every one", async () => {
  // The bundled-skills table in the configured map is
  // hand-authored prose with no compiler behind it, so a newly added skill can
  // silently ship undocumented (it happened: the table once lacked a skill the
  // binary bundled). Iterate the SAME canonical set the materializer drives off,
  // so a new skill auto-enrols here and the doc must name it or the gate fails.
  const doc = await Deno.readTextFile(
    join(REPO_AUTHORED_PATHS.map, "80-development", "install-surface.md"),
  );
  const names = await bundledSkillNames();
  const missing = names.filter((name) => !doc.includes(`\`${name}\``));
  assertEquals(
    missing,
    [],
    `${REPO_AUTHORED_PATHS.mapRel}/80-development/install-surface.md's bundled-skills table must name every bundled skill`,
  );
});
