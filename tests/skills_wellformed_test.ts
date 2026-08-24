/**
 * Class-level well-formedness guard for EVERY skill this repo ships or runs:
 * the bundled set (`templates/skills/*`) AND the repo's own authored skills
 * (the configured `[skills].dir`).
 *
 * This test is itself an instance of the discipline it protects: it does not
 * check one skill, it declares the Git-derived bundled and configured skill
 * containers, so a newly-added skill in either one auto-enrols and a malformed
 * or mis-named entry fails the gate.
 * "Well-formed" is `skillFrontmatterIssues`, the one validator the engine's
 * gate precondition also applies: valid YAML whose `name`/`description` are
 * non-empty strings, with `name` equal to the directory.
 */

import { assert, assertEquals } from "@std/assert";
import { basename, dirname, join, relative } from "@std/path";
import {
  SKILL_DESCRIPTION_MAX_LENGTH,
  skillFrontmatterIssues,
} from "../src/lib/skills.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

const BUNDLED_SKILLS = "templates/skills";
const AUTHORED_SKILLS = relative(REPO_ROOT, REPO_AUTHORED_PATHS.skills);

/** Whether one repo-relative path is a skill entry in the named container. */
function skillEntryUnder(rel: string, container: string): boolean {
  return rel.startsWith(`${container}/`) && rel.endsWith("/SKILL.md");
}

/** Read declared SKILL.md files with their directory-derived names. */
async function skillEntries(
  files: readonly string[],
): Promise<{ name: string; text: string }[]> {
  return await Promise.all(files.map(async (rel) => ({
    name: basename(dirname(rel)),
    text: await Deno.readTextFile(join(REPO_ROOT, rel)),
  })));
}

Deno.test("every bundled and authored skill is well-formed", async () => {
  const files = await structuralGuardScope({
    guard: "tests/skills_wellformed_test.ts#skill-frontmatter",
    universe: "authored-text",
    narrow: {
      reason:
        "Skill frontmatter governs each bundled and configured SKILL.md entry.",
      include: (rel) =>
        skillEntryUnder(rel, BUNDLED_SKILLS) ||
        skillEntryUnder(rel, AUTHORED_SKILLS),
    },
  });
  const bundled = await skillEntries(
    files.filter((rel) => skillEntryUnder(rel, BUNDLED_SKILLS)),
  );
  assert(
    bundled.length > 0,
    "expected at least one bundled skill under templates/skills/",
  );
  const populations = [
    { label: "bundled", skills: bundled },
    {
      label: "authored",
      skills: await skillEntries(
        files.filter((rel) => skillEntryUnder(rel, AUTHORED_SKILLS)),
      ),
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
  const files = await structuralGuardScope({
    guard: "tests/skills_wellformed_test.ts#bundled-skill-attribution",
    universe: "authored-text",
    narrow: {
      reason: "Attribution travels with every bundled SKILL.md entry.",
      include: (rel) => skillEntryUnder(rel, BUNDLED_SKILLS),
    },
  });
  for (const { name, text } of await skillEntries(files)) {
    // Provenance travels with the file wherever it materializes. Asserted on
    // the raw frontmatter text (the flat reader deliberately surfaces only
    // name/description); the exact author string is the single source below.
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
  const catalogRels = new Set([
    join(REPO_AUTHORED_PATHS.mapRel, "45-skills", "bundled-skills.md"),
    join(REPO_AUTHORED_PATHS.mapRel, "80-development", "install-surface.md"),
  ]);
  const files = await structuralGuardScope({
    guard: "tests/skills_wellformed_test.ts#bundled-skill-catalogs",
    universe: "authored-text",
    narrow: {
      reason:
        "Bundled SKILL.md entries and their two public catalogs form this parity contract.",
      include: (rel) =>
        skillEntryUnder(rel, BUNDLED_SKILLS) || catalogRels.has(rel),
    },
  });
  const names = (await skillEntries(
    files.filter((rel) => skillEntryUnder(rel, BUNDLED_SKILLS)),
  )).map((skill) => skill.name);
  for (const rel of files.filter((path) => catalogRels.has(path))) {
    const doc = await Deno.readTextFile(join(REPO_ROOT, rel));
    const missing = names.filter((name) => !doc.includes(`\`${name}\``));
    assertEquals(
      missing,
      [],
      `${rel}'s bundled-skills table must name every bundled skill`,
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
