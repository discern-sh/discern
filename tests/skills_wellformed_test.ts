/**
 * Class-level well-formedness guard for EVERY skill this repo ships or runs:
 * the bundled set (`templates/skills/*`) AND the repo's own authored skills
 * (the configured `[skills].dir`).
 *
 * This test is itself an instance of the discipline it protects: it does not
 * check one skill, it iterates the canonical sets — `bundledSkillNames()` over
 * `resolveBundledSkillsDir()` and the configured authored dir — the SAME
 * sources the materializer drives off, so a newly-added skill in either
 * container auto-enrols and a malformed or mis-named one fails the gate.
 * "Well-formed" is `skillFrontmatterIssues`, the one validator the engine's
 * gate precondition also applies: valid YAML whose `name`/`description` are
 * non-empty strings, with `name` equal to the directory.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { resolveBundledSkillsDir } from "../src/lib/paths.ts";
import {
  bundledSkillNames,
  SKILL_DESCRIPTION_MAX_LENGTH,
  skillFrontmatterIssues,
} from "../src/lib/skills.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

/** Every skill directory under `dir`, with its SKILL.md text; [] when absent. */
async function skillsUnder(
  dir: string,
): Promise<{ name: string; text: string }[]> {
  const out: { name: string; text: string }[] = [];
  let entries: Deno.DirEntry[];
  try {
    entries = (await Array.fromAsync(Deno.readDir(dir)))
      .filter((e) => e.isDirectory)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  for (const entry of entries) {
    out.push({
      name: entry.name,
      text: await Deno.readTextFile(join(dir, entry.name, "SKILL.md")),
    });
  }
  return out;
}

Deno.test("every bundled and authored skill is well-formed", async () => {
  const bundled = await skillsUnder(await resolveBundledSkillsDir());
  assert(
    bundled.length > 0,
    "expected at least one bundled skill under templates/skills/",
  );
  const populations = [
    { label: "bundled", skills: bundled },
    {
      label: "authored",
      skills: await skillsUnder(REPO_AUTHORED_PATHS.skills),
    },
  ];

  const failures: string[] = [];
  for (const { label, skills } of populations) {
    for (const { name, text } of skills) {
      for (const issue of skillFrontmatterIssues(text, name)) {
        failures.push(`${label} skill '${name}': ${issue}`);
      }
    }
  }
  assertEquals(
    failures,
    [],
    "every SKILL.md must carry frontmatter every consumer's YAML parser " +
      "reads to the same valid identity",
  );
});

Deno.test("bundled skills: every one carries the discern attribution", async () => {
  const dir = await resolveBundledSkillsDir();
  for (const name of await bundledSkillNames()) {
    // Provenance travels with the file wherever it materializes. Asserted on
    // the raw frontmatter text (the flat reader deliberately surfaces only
    // name/description); the exact author string is the single source below.
    const text = await Deno.readTextFile(join(dir, name, "SKILL.md"));
    const fence = text.indexOf("\n---", 3);
    const front = fence === -1 ? text : text.slice(0, fence);
    assert(
      front.includes('author: "discern | https://discern.sh"'),
      `bundled skill '${name}': frontmatter 'metadata.author' must be the ` +
        "discern attribution",
    );
  }
});

Deno.test("bundled skills: every catalog table lists every one", async () => {
  // These tables are hand-authored prose with no compiler behind them, so a newly
  // added skill can silently ship undocumented. Iterate the SAME canonical set the
  // materializer drives off, so a new skill auto-enrols here and every public or
  // contributor catalog must name it or the gate fails.
  const names = await bundledSkillNames();
  const catalogs = [
    join(REPO_AUTHORED_PATHS.map, "45-skills", "bundled-skills.md"),
    join(REPO_AUTHORED_PATHS.map, "80-development", "install-surface.md"),
  ];
  for (const catalog of catalogs) {
    const doc = await Deno.readTextFile(catalog);
    const missing = names.filter((name) => !doc.includes(`\`${name}\``));
    assertEquals(
      missing,
      [],
      `${catalog}'s bundled-skills table must name every bundled skill`,
    );
  }
});

// ── the validator itself, against adversarial fixtures ──────────────────────
// Every fixture uses names unrelated to any real skill, so the guard provably
// rejects the MECHANISM, not a remembered instance.

/** A frontmatter block over a minimal body. */
function skillDoc(...blockLines: string[]): string {
  return ["---", ...blockLines, "---", "", "# A skill", "", "Body."].join("\n");
}

Deno.test("a valid identity passes, extra keys and nested metadata allowed", () => {
  assertEquals(
    skillFrontmatterIssues(
      skillDoc(
        "name: brew-perfect-coffee",
        "description: Brew a cup worth drinking. Use when the pot is empty.",
        "metadata:",
        '  author: "someone | https://example.com"',
        '  version: "1.0"',
      ),
      "brew-perfect-coffee",
    ),
    [],
  );
});

Deno.test("a continuation line hiding an inline colon is rejected", () => {
  // The shape that shipped: `description:` with the text on the next line and
  // an inline `: ` in it, which YAML reads as a nested mapping, not text.
  const withColon = skillFrontmatterIssues(
    skillDoc(
      "name: prune-the-orchard",
      "description:",
      "  Keep the trees healthy. Out of season: prune nothing at all.",
    ),
    "prune-the-orchard",
  );
  assertEquals(withColon.length, 1);
  assert(withColon[0]?.includes("nested mapping"), withColon[0]);

  // Without the colon the continuation is a plain multi-line YAML string —
  // every consumer reads it correctly, so it is valid.
  assertEquals(
    skillFrontmatterIssues(
      skillDoc(
        "name: prune-the-orchard",
        "description:",
        "  Keep the trees healthy all year round.",
      ),
      "prune-the-orchard",
    ),
    [],
  );
});

Deno.test("an unquoted inline `: ` is rejected as invalid YAML", () => {
  const issues = skillFrontmatterIssues(
    skillDoc(
      "name: tune-the-engine",
      "description: Covers the full loop: measure, adjust, and re-run.",
    ),
    "tune-the-engine",
  );
  assertEquals(issues.length, 1);
  assert(issues[0]?.includes("not valid YAML"), issues[0]);
});

Deno.test("a block-scalar description is valid — YAML is YAML", () => {
  assertEquals(
    skillFrontmatterIssues(
      skillDoc(
        "name: chart-the-stars",
        "description: >-",
        "  Map the night sky one constellation at a time.",
      ),
      "chart-the-stars",
    ),
    [],
  );
});

Deno.test("a missing, empty, or mis-typed identity field is rejected", () => {
  const missing = skillFrontmatterIssues(
    skillDoc("name: sort-the-library"),
    "sort-the-library",
  );
  assertEquals(missing.length, 1);
  assert(missing[0]?.startsWith("description:"), missing[0]);

  const listName = skillFrontmatterIssues(
    skillDoc(
      "name:",
      "  - sort-the-library",
      "description: Shelve every book.",
    ),
    "sort-the-library",
  );
  assertEquals(listName.length, 1);
  assert(listName[0]?.includes("a list"), listName[0]);
});

Deno.test("frontmatter fences must open the file and close", () => {
  assertEquals(skillFrontmatterIssues("# No block\n", "any-name"), [
    "missing opening '---' frontmatter fence",
  ]);
  assertEquals(
    skillFrontmatterIssues("---\nname: any-name\n\n# Doc\n", "any-name"),
    ["unterminated frontmatter fence (no closing '---')"],
  );
});

Deno.test("the name must match the directory and the consumer contract", () => {
  const renamed = skillFrontmatterIssues(
    skillDoc("name: polish-the-brass", "description: Make the rails shine."),
    "shine-the-rails",
  );
  assertEquals(renamed.length, 1);
  assert(renamed[0]?.includes('directory "shine-the-rails"'), renamed[0]);

  const shouty = skillFrontmatterIssues(
    skillDoc("name: Polish The Brass", "description: Make the rails shine."),
    "Polish The Brass",
  );
  assertEquals(shouty.length, 1);
  assert(shouty[0]?.includes("lowercase"), shouty[0]);
});

Deno.test("the description honours the consumer length ceiling", () => {
  const long = "x".repeat(SKILL_DESCRIPTION_MAX_LENGTH + 1);
  const issues = skillFrontmatterIssues(
    skillDoc("name: weave-a-basket", `description: ${long}`),
    "weave-a-basket",
  );
  assertEquals(issues.length, 1);
  assert(
    issues[0]?.includes(`${SKILL_DESCRIPTION_MAX_LENGTH}`),
    issues[0],
  );
});
