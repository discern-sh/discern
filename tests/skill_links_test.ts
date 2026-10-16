/**
 * Linked authored skills: an entry under `[skills].dir` that links to a skill
 * directory elsewhere in the project materializes like a real directory, and a
 * link discern refuses (dangling, absolute, or resolving outside the project)
 * is reported instead of silently vanishing.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, join, relative } from "@std/path";
import {
  type DiscernConfig,
  parseConfigOrThrow,
  resolveConfiguredAgents,
} from "../src/shared/config_schema.ts";
import {
  checkSkillsCurrent,
  checkSkillsWellformed,
  listSkills,
  materializeSkills,
  planMaterializeSkills,
  resolveEffectiveSkills,
  scanAuthoredSkills,
  unknownExcludedSkills,
} from "../src/lib/skills.ts";
import { skillsDirsForAgents } from "../src/lib/providers.ts";
import { withTempDir } from "./helpers.ts";

/** A config whose authored skills live under `skills/`. */
function cfg(exclude: readonly string[] = []): DiscernConfig {
  return parseConfigOrThrow(
    `[skills]\ndir = "skills"\nexclude = ${JSON.stringify(exclude)}\n`,
  );
}

/** Write a well-formed skill directory at `dir`, named by its basename. */
async function skillAt(dir: string): Promise<void> {
  const name = dir.split("/").at(-1) ?? "";
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: Do the ${name} task.\n---\n\n# ${name}\n`,
  );
}

/** Link `skills/<name>` to `target`, written exactly as given. */
async function linkSkill(
  root: string,
  name: string,
  target: string,
): Promise<void> {
  await Deno.mkdir(join(root, "skills"), { recursive: true });
  await Deno.symlink(target, join(root, "skills", name));
}

/** A project holding one real skill and one skill linked from elsewhere in it. */
async function linkedProject(root: string): Promise<void> {
  await skillAt(join(root, "skills", "real"));
  await skillAt(join(root, "shared", "skills", "linked"));
  await linkSkill(root, "linked", "../shared/skills/linked");
}

/** Every configured agent skills directory for `config`. */
function agentDirs(config: DiscernConfig): string[] {
  return skillsDirsForAgents(resolveConfiguredAgents(config));
}

Deno.test("scanAuthoredSkills follows in-project links and reports every refused one", async () => {
  await withTempDir(async (outside) => {
    await skillAt(join(outside, "elsewhere"));
    await withTempDir(async (root) => {
      await linkedProject(root);
      await skillAt(join(root, "shared", "skills", "absolute"));
      await Deno.writeTextFile(join(root, "shared", "notes.md"), "notes\n");
      await Deno.writeTextFile(join(root, "skills", "README.md"), "index\n");
      await linkSkill(root, "file-link", "../shared/notes.md");
      await linkSkill(root, "dangling", "../shared/skills/missing");
      await linkSkill(
        root,
        "absolute",
        join(root, "shared", "skills", "absolute"),
      );
      await linkSkill(
        root,
        "escapes",
        relative(join(root, "skills"), join(outside, "elsewhere")),
      );
      await linkSkill(root, "project-root", "..");
      await linkSkill(root, "loop", "loop");

      const scan = await scanAuthoredSkills(root, cfg());
      assertEquals(
        scan.skills.map((skill) => [skill.name, skill.contentAbs]),
        [
          ["linked", join(root, "shared", "skills", "linked")],
          ["real", join(root, "skills", "real")],
        ],
        "real directories and in-project links are skills; files are not",
      );
      assertEquals(
        scan.linkIssues.map((issue) => [issue.name, issue.problem]),
        [
          ["absolute", "absolute"],
          ["dangling", "dangling"],
          ["escapes", "escapes"],
          ["loop", "dangling"],
          ["project-root", "escapes"],
        ],
      );
      for (const issue of scan.linkIssues) {
        assertStringIncludes(issue.message, `skills/${issue.name}`);
        assertStringIncludes(issue.message, issue.target);
        assertStringIncludes(issue.message, "does not materialize this skill");
      }
    });
  });
});

Deno.test("a linked skill materializes like a real directory through a chain every copy of the checkout resolves inside itself", async () => {
  await withTempDir(async (root) => {
    await linkedProject(root);
    const config = cfg();
    const dirs = agentDirs(config);
    assert(dirs.length > 0, "the default config configures an agent");

    assertEquals(
      (await resolveEffectiveSkills(root, config))
        .filter((skill) => skill.source === "authored")
        .map((skill) => skill.name),
      ["linked", "real"],
    );
    assertEquals(
      (await listSkills(root, config)).find((row) => row.name === "linked")
        ?.source,
      "authored",
    );

    const result = await materializeSkills(root, config, dirs);
    assertEquals(result.errors, []);
    assertEquals(result.linked, 2 * dirs.length);
    for (const dir of dirs) {
      const materialized = join(root, dir, "linked");
      assert((await Deno.lstat(materialized)).isSymlink);
      assertEquals(
        await Deno.readLink(materialized),
        relative(join(root, dir), join(root, "skills", "linked")),
      );
      assertStringIncludes(
        await Deno.readTextFile(join(materialized, "SKILL.md")),
        "name: linked",
      );
    }
    assertEquals(await checkSkillsCurrent(root, config), []);
    assertEquals(await checkSkillsWellformed(root, config), []);

    // The checks read the skill's content through the link.
    await Deno.writeTextFile(
      join(root, "shared", "skills", "linked", "SKILL.md"),
      "---\nname: other\ndescription: Mismatched.\n---\n",
    );
    assertEquals(
      (await checkSkillsWellformed(root, config)).map((skill) => skill.file),
      [join("skills", "linked", "SKILL.md")],
    );

    // A worktree is another checkout of the same committed links: every hop
    // must stay relative so the copy resolves inside itself.
    await withTempDir(async (elsewhere) => {
      const copy = join(elsewhere, "checkout");
      const cp = await new Deno.Command("cp", { args: ["-RP", root, copy] })
        .output();
      assert(cp.success, new TextDecoder().decode(cp.stderr));
      const realCopy = await Deno.realPath(copy);
      for (const dir of dirs) {
        const resolved = await Deno.realPath(
          join(copy, dir, "linked", "SKILL.md"),
        );
        assertEquals(
          resolved,
          join(realCopy, "shared", "skills", "linked", "SKILL.md"),
        );
      }
    });
  });
});

Deno.test("a refused skill link warns on refresh and stays a known name for [skills].exclude", async () => {
  await withTempDir(async (root) => {
    await skillAt(join(root, "skills", "real"));
    await linkSkill(root, "dangling", "../shared/missing");
    const config = cfg(["dangling"]);
    const [issue] = (await scanAuthoredSkills(root, config)).linkIssues;
    assert(issue !== undefined);

    const plan = await planMaterializeSkills(root, config, agentDirs(config));
    assertEquals(plan.warnings, [issue.message]);
    assert(
      !(await resolveEffectiveSkills(root, config)).some((skill) =>
        skill.name === "dangling"
      ),
    );
    assertEquals(await unknownExcludedSkills(root, config), []);
    assertEquals(dirname(issue.path), "skills");
  });
});
