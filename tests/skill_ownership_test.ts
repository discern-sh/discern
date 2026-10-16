/**
 * Entry-level ownership of the shared provider skills directories (ADR 0425).
 * discern owns exactly the entries its materialization record names; every
 * other entry — a skill a third-party installer placed, a hand-placed drop-in —
 * stays untouched and visible to Git. These cases drive real materialization
 * against a real Git repository, so "ignored" means what Git says.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  checkSkillsCurrent,
  materializeSkills,
  planMaterializeSkills,
} from "../src/lib/skills.ts";
import {
  isDiscernSkillsIgnore,
  MATERIALIZED_MANIFEST,
  readMaterializedNames,
  renderSkillsIgnore,
  SKILLS_IGNORE_FILE,
  skillsIgnoreMatches,
  surveySkillsDir,
} from "../src/lib/skill_ownership.ts";
import { skillsDirsForAgents } from "../src/lib/providers.ts";
import {
  type DiscernConfig,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import { targetExists } from "../src/shared/fs_presence.ts";
import { fakeEnv, withTempDir } from "./helpers.ts";
import { statusMaterialCurrency } from "../src/engine/status/material_currency.ts";
import { HINTS } from "../src/shared/hints.ts";
import { gitInit, gitOut } from "./engine_helpers.ts";

const [SKILLS_DIR = ""] = skillsDirsForAgents(["claude_code"]);
const DIRS = [SKILLS_DIR];
const BUNDLED = "discern-write-adr";

/** A Claude Code project with authored skills under `skills/`. */
function cfg(extra = ""): DiscernConfig {
  return parseConfigOrThrow(
    `[project]\nagents = ["claude_code"]\n[skills]\ndir = "skills"\n${extra}`,
  );
}

/** Initialize a Git repository with one committed file. */
async function initRepo(root: string): Promise<void> {
  await Deno.writeTextFile(join(root, "README.md"), "project\n");
  await gitInit(root);
}

/** Place a skill directory with one SKILL.md at a project-relative path. */
async function placeSkill(
  root: string,
  rel: string,
  body: string,
): Promise<void> {
  await Deno.mkdir(join(root, rel), { recursive: true });
  await Deno.writeTextFile(join(root, rel, "SKILL.md"), body);
}

/** Git's own verdict on every file under the skills dir: `??` visible, `!!`
 * ignored. Files and symlinks are listed individually, never collapsed. */
async function gitVerdicts(root: string): Promise<Map<string, string>> {
  const out = await gitOut(
    root,
    "status",
    "--porcelain",
    "-z",
    "--ignored",
    "--untracked-files=all",
    "--",
    SKILLS_DIR,
  );
  const verdicts = new Map<string, string>();
  for (const record of out.split("\0").filter((r) => r !== "")) {
    verdicts.set(record.slice(3), record.slice(0, 2));
  }
  return verdicts;
}

Deno.test("materialization leaves another tool's skill untouched, visible to Git, and ignores only its own entries", async () => {
  await withTempDir(async (root) => {
    await initRepo(root);
    const foreign = `${SKILLS_DIR}/foreign-skill`;
    await placeSkill(root, foreign, "installed by a third-party tool\n");

    await materializeSkills(root, cfg(), DIRS);

    assertEquals(
      await Deno.readTextFile(join(root, foreign, "SKILL.md")),
      "installed by a third-party tool\n",
    );
    const recorded = await readMaterializedNames(join(root, SKILLS_DIR));
    assert(recorded.has(BUNDLED));
    assert(!recorded.has("foreign-skill"));

    const verdicts = await gitVerdicts(root);
    assertEquals(verdicts.get(`${foreign}/SKILL.md`), "??");
    assertEquals(verdicts.get(`${SKILLS_DIR}/${BUNDLED}/SKILL.md`), "!!");
    assertEquals(verdicts.get(`${SKILLS_DIR}/${MATERIALIZED_MANIFEST}`), "!!");
    assertEquals(verdicts.get(`${SKILLS_DIR}/${SKILLS_IGNORE_FILE}`), "!!");
    const visible = [...verdicts].filter(([, v]) => v === "??").map(([p]) => p);
    assertEquals(visible, [`${foreign}/SKILL.md`]);

    const drift = await checkSkillsCurrent(root, cfg());
    assertEquals(
      drift.map((d) => [d.reason, d.name]),
      [["foreign", "foreign-skill"]],
    );
  });
});

Deno.test("an authored skill's symlink is ignored and a later foreign install is not", async () => {
  await withTempDir(async (root) => {
    await initRepo(root);
    await placeSkill(root, "skills/my-skill", "# my-skill\n");
    await Deno.writeTextFile(join(root, ".gitignore"), "");
    await materializeSkills(root, cfg(), DIRS);
    // A tool installed after discern writes its skill beside discern's.
    await placeSkill(root, `${SKILLS_DIR}/late-skill`, "late\n");

    const verdicts = await gitVerdicts(root);
    assertEquals(verdicts.get(`${SKILLS_DIR}/my-skill`), "!!");
    assertEquals(verdicts.get(`${SKILLS_DIR}/late-skill/SKILL.md`), "??");
  });
});

Deno.test("an entry under a discern skill's name that discern did not place is refused, never replaced", async () => {
  for (
    const fixture of [
      { label: "bundled", name: BUNDLED, authored: false },
      { label: "authored", name: "shared-name", authored: true },
    ]
  ) {
    await withTempDir(async (root) => {
      if (fixture.authored) {
        await placeSkill(root, `skills/${fixture.name}`, "# authored\n");
      }
      const contested = `${SKILLS_DIR}/${fixture.name}`;
      await placeSkill(root, contested, "a foreign skill\n");

      const plan = await planMaterializeSkills(root, cfg(), DIRS);
      const directory = plan.directories[0];
      assert(directory !== undefined);
      assertEquals(
        directory.conflicts.map((c) => c.name),
        [fixture.name],
        fixture.label,
      );
      assert(
        directory.operations.every((op) => op.targetRel !== contested),
        `${fixture.label}: the plan must not touch ${contested}`,
      );
      assertEquals(plan.errors.length, 1, fixture.label);
      assertStringIncludes(plan.errors[0] ?? "", contested);

      const result = await materializeSkills(root, cfg(), DIRS);
      assertEquals(result.errors.length, 1, fixture.label);
      assertEquals(
        await Deno.readTextFile(join(root, contested, "SKILL.md")),
        "a foreign skill\n",
        `${fixture.label}: the foreign entry survives`,
      );
      const recorded = await readMaterializedNames(join(root, SKILLS_DIR));
      assert(!recorded.has(fixture.name), fixture.label);
      const ignore = await Deno.readTextFile(
        join(root, SKILLS_DIR, SKILLS_IGNORE_FILE),
      );
      assert(!ignore.includes(`/${fixture.name}\n`), fixture.label);

      const drift = await checkSkillsCurrent(root, cfg());
      assertEquals(
        drift.filter((d) => d.reason !== "foreign").map((d) => [
          d.reason,
          d.name,
        ]),
        [["conflict", fixture.name]],
        fixture.label,
      );
    });
  }
});

Deno.test("an entry identical to discern's output is adopted, not rewritten or refused", async () => {
  await withTempDir(async (root) => {
    await materializeSkills(root, cfg(), DIRS);
    await Deno.remove(join(root, SKILLS_DIR, MATERIALIZED_MANIFEST));

    const plan = await planMaterializeSkills(root, cfg(), DIRS);
    const directory = plan.directories[0];
    assert(directory !== undefined);
    assertEquals(directory.conflicts, []);
    assertEquals(
      directory.operations.map((op) => op.kind),
      ["manifest"],
      "only the record is rewritten; every current entry is adopted in place",
    );
    await materializeSkills(root, cfg(), DIRS);
    assert(
      (await readMaterializedNames(join(root, SKILLS_DIR))).has(BUNDLED),
    );
  });
});

Deno.test("an ignore file discern did not write is a conflict and stays untouched", async () => {
  await withTempDir(async (root) => {
    const ignoreRel = `${SKILLS_DIR}/${SKILLS_IGNORE_FILE}`;
    await Deno.mkdir(join(root, SKILLS_DIR), { recursive: true });
    await Deno.writeTextFile(join(root, ignoreRel), "/*\n");

    const result = await materializeSkills(root, cfg(), DIRS);
    assertEquals(result.errors.length, 1);
    assertStringIncludes(result.errors[0] ?? "", ignoreRel);
    assertEquals(await Deno.readTextFile(join(root, ignoreRel)), "/*\n");
    assert(await targetExists(join(root, SKILLS_DIR, BUNDLED, "SKILL.md")));

    const survey = await surveySkillsDir(root, SKILLS_DIR);
    assertEquals(survey?.control, [MATERIALIZED_MANIFEST]);
    assert(survey?.foreign.some((e) => e.name === SKILLS_IGNORE_FILE));
    const drift = await checkSkillsCurrent(root, cfg());
    assertEquals(
      drift.filter((d) => d.reason === "conflict").map((d) => d.name),
      [SKILLS_IGNORE_FILE],
    );
  });
});

Deno.test("only recorded entries are pruned — an unrecorded entry survives even when it dangles or the record is corrupt", async () => {
  await withTempDir(async (root) => {
    await materializeSkills(root, cfg(), DIRS);
    const abs = join(root, SKILLS_DIR);
    await Deno.symlink("../../skills/gone", join(abs, "dangling-link"));

    const excluded = cfg(`exclude = ["${BUNDLED}"]\n`);
    const result = await materializeSkills(root, excluded, DIRS);
    assertEquals(result.pruned, 1, "the recorded, now-excluded skill");
    assert(!(await targetExists(join(abs, BUNDLED))));
    assert((await Deno.lstat(join(abs, "dangling-link"))).isSymlink);

    await Deno.writeTextFile(join(abs, MATERIALIZED_MANIFEST), "{not json");
    await placeSkill(root, `${SKILLS_DIR}/left-behind`, "x\n");
    const corrupt = await planMaterializeSkills(root, excluded, DIRS);
    assert(
      corrupt.directories[0]?.operations.every((op) => op.kind !== "stale"),
      "a corrupt record authorizes no removal",
    );
  });
});

Deno.test("the ignore file escapes entry names so each rule matches exactly one entry", async () => {
  await withTempDir(async (root) => {
    await initRepo(root);
    const names = ["star*name", "bracket[x]", "question?", "trailing "];
    const abs = join(root, SKILLS_DIR);
    await Deno.mkdir(abs, { recursive: true });
    for (const name of names) {
      await placeSkill(root, `${SKILLS_DIR}/${name}`, "owned\n");
    }
    // Look-alikes each pattern would swallow if it were not escaped.
    for (const name of ["starXname", "bracketx", "questionQ", "trailing"]) {
      await placeSkill(root, `${SKILLS_DIR}/${name}`, "not owned\n");
    }
    await Deno.writeTextFile(
      join(abs, SKILLS_IGNORE_FILE),
      renderSkillsIgnore(names, fakeEnv()),
    );
    const verdicts = await gitVerdicts(root);
    for (const name of names) {
      assertEquals(verdicts.get(`${SKILLS_DIR}/${name}/SKILL.md`), "!!", name);
    }
    for (const name of ["starXname", "bracketx", "questionQ", "trailing"]) {
      assertEquals(verdicts.get(`${SKILLS_DIR}/${name}/SKILL.md`), "??", name);
    }
  });
});

Deno.test("discern recognizes its ignore file under either attribution setting and compares rules, not bytes", () => {
  const attributed = renderSkillsIgnore(["a"], fakeEnv());
  const plain = renderSkillsIgnore(
    ["a"],
    fakeEnv({ DISCERN_NO_ATTRIBUTION: "1" }),
  );
  assert(attributed !== plain);
  for (const text of [attributed, plain]) {
    assert(isDiscernSkillsIgnore(text));
    assert(skillsIgnoreMatches(text, ["a"]));
    assert(!skillsIgnoreMatches(text, ["a", "b"]));
  }
  assert(!isDiscernSkillsIgnore("/*\n"));
});

Deno.test("status names a skills conflict with its own choice-shaped hint", async () => {
  await withTempDir(async (root) => {
    await materializeSkills(root, cfg(), DIRS);
    await Deno.remove(join(root, SKILLS_DIR, BUNDLED), { recursive: true });
    await placeSkill(root, `${SKILLS_DIR}/${BUNDLED}`, "not discern's\n");
    await Deno.writeTextFile(
      join(root, SKILLS_DIR, MATERIALIZED_MANIFEST),
      "[]\n",
    );

    const currency = await statusMaterialCurrency(root, cfg());
    const ids = currency.artifactHints.map((hint) => hint.id);
    assert(ids.includes(HINTS["materialized-skills-conflict"].id), `${ids}`);
    const conflict = currency.artifactHints.find((hint) =>
      hint.id === HINTS["materialized-skills-conflict"].id
    );
    assertStringIncludes(conflict?.text ?? "", `${SKILLS_DIR}/${BUNDLED}`);
    assertStringIncludes(conflict?.text ?? "", "[skills].exclude");
  });
});
