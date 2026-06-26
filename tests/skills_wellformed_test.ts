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
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`bundled skill '${name}' is malformed: ${detail}`);
    }
  }
});
