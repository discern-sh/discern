/**
 * Unit coverage for `src/lib/skills.ts` — the bundled⊕authored resolution,
 * override-by-name, the `.claude/skills/` materialization (bundled copied,
 * authored symlinked, stale pruned, foreign entries left alone), and `eject`.
 *
 * These drive the module directly against the repo's REAL bundled skills (the
 * compiler resolves `templates/skills/` by walking up from the source), so they
 * exercise the same code paths a real install hits.
 */

import {
  assert,
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import {
  type DiscernConfig,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import {
  bundledSkillNames,
  claudeSkillsDirOf,
  ejectSkill,
  listSkills,
  materializeSkills,
  resolveEffectiveSkills,
} from "../src/lib/skills.ts";
import { modeOf, withTempDir } from "./helpers.ts";

/** True when anything exists at the absolute `path` (following symlinks). */
async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A config with the default `[skills].dir = skills`. */
function cfg(dir = "skills"): DiscernConfig {
  return parseConfigOrThrow(`[skills]\ndir = "${dir}"\n`);
}

/** Write an authored skill dir with a stub SKILL.md under `<root>/skills/<name>`. */
async function authoredSkill(root: string, name: string): Promise<void> {
  await Deno.mkdir(join(root, "skills", name), { recursive: true });
  await Deno.writeTextFile(
    join(root, "skills", name, "SKILL.md"),
    `# ${name}\nauthored\n`,
  );
}

Deno.test("bundledSkillNames lists the shipped built-ins, sorted", async () => {
  const names = await bundledSkillNames();
  // The repo ships these built-ins; assert membership + sortedness (not an exact
  // set, so adding a built-in later doesn't break this test).
  for (
    const n of [
      "document-subsystem",
      "handoff-worktree",
      "write-adr",
    ]
  ) {
    assert(
      names.includes(n),
      `expected bundled skill ${n} in ${names.join(",")}`,
    );
  }
  assertEquals([...names], [...names].sort());
});

Deno.test("resolveEffectiveSkills: bundled-only when no authored dir", async () => {
  await withTempDir(async (root) => {
    const eff = await resolveEffectiveSkills(root, cfg());
    assert(eff.length >= 3);
    assert(eff.every((e) => e.source === "bundled" && !e.overridesBundled));
    assert(eff.some((e) => e.name === "write-adr"));
  });
});

Deno.test("resolveEffectiveSkills: authored overrides a bundled name; unique authored stands alone", async () => {
  await withTempDir(async (root) => {
    await authoredSkill(root, "document-subsystem"); // shadows a built-in
    await authoredSkill(root, "my-skill"); // unique
    const eff = await resolveEffectiveSkills(root, cfg());
    const byName = new Map(eff.map((e) => [e.name, e]));

    const overridden = byName.get("document-subsystem");
    assertExists(overridden);
    assertEquals(overridden.source, "authored");
    assertEquals(overridden.overridesBundled, true);

    const mine = byName.get("my-skill");
    assertExists(mine);
    assertEquals(mine.source, "authored");
    assertEquals(mine.overridesBundled, false);

    // A non-overridden built-in stays bundled.
    const writeAdr = byName.get("write-adr");
    assertExists(writeAdr);
    assertEquals(writeAdr.source, "bundled");
  });
});

Deno.test("listSkills annotates source / override / hasBundled", async () => {
  await withTempDir(async (root) => {
    await authoredSkill(root, "document-subsystem");
    await authoredSkill(root, "my-skill");
    const rows = new Map(
      (await listSkills(root, cfg())).map((r) => [r.name, r]),
    );

    assertEquals(rows.get("document-subsystem"), {
      name: "document-subsystem",
      source: "authored",
      overridesBundled: true,
      hasBundled: true,
    });
    assertEquals(rows.get("my-skill"), {
      name: "my-skill",
      source: "authored",
      overridesBundled: false,
      hasBundled: false,
    });
    const writeAdr = rows.get("write-adr");
    assertExists(writeAdr);
    assertEquals(writeAdr.source, "bundled");
  });
});

Deno.test("materializeSkills: bundled copied, authored symlinked", async () => {
  await withTempDir(async (root) => {
    await authoredSkill(root, "my-skill");
    await authoredSkill(root, "document-subsystem"); // override → symlink, not copy
    const res = await materializeSkills(root, cfg());
    assert(res.copied >= 2, `expected the non-overridden built-ins copied`);
    assertEquals(res.linked, 2); // my-skill + the document-subsystem override
    assertEquals(res.pruned, 0);

    const sk = claudeSkillsDirOf(root);
    // A non-overridden built-in is a real directory (copy).
    const wa = await Deno.lstat(join(sk, "write-adr"));
    assert(wa.isDirectory && !wa.isSymlink);
    // An authored skill is a relative symlink into ./skills/.
    const mine = await Deno.lstat(join(sk, "my-skill"));
    assert(mine.isSymlink);
    assertEquals(
      await Deno.readLink(join(sk, "my-skill")),
      "../../skills/my-skill",
    );
    // The override is a symlink too (authored wins over the bundled copy).
    assert((await Deno.lstat(join(sk, "document-subsystem"))).isSymlink);
  });
});

Deno.test("materializeSkills: prunes a removed authored skill's dangling link", async () => {
  await withTempDir(async (root) => {
    await authoredSkill(root, "temp");
    await materializeSkills(root, cfg());
    assert(
      await exists(join(claudeSkillsDirOf(root), "temp", "SKILL.md")),
    );

    await Deno.remove(join(root, "skills/temp"), { recursive: true });
    const res = await materializeSkills(root, cfg());
    assertEquals(res.pruned, 1);
    assertEquals(
      await exists(join(claudeSkillsDirOf(root), "temp")),
      false,
    );
  });
});

Deno.test("materializeSkills: leaves a foreign entry (unmanaged name, live target) alone", async () => {
  await withTempDir(async (root) => {
    const sk = claudeSkillsDirOf(root);
    await Deno.mkdir(sk, { recursive: true });
    // A user's own real dir under an unmanaged name.
    await Deno.mkdir(join(sk, "mine-real"));
    await Deno.writeTextFile(join(sk, "mine-real/SKILL.md"), "real");
    // A user's symlink to a live target outside the managed set.
    await Deno.mkdir(join(root, "external"));
    await Deno.writeTextFile(join(root, "external/SKILL.md"), "x");
    await Deno.symlink("../../external", join(sk, "mine-link"));

    await materializeSkills(root, cfg());

    assert(
      await exists(join(sk, "mine-real/SKILL.md")),
      "real dir survives",
    );
    assert(
      (await Deno.lstat(join(sk, "mine-link"))).isSymlink,
      "live link survives",
    );
  });
});

Deno.test("ejectSkill copies a built-in into [skills].dir, writable, then refuses to clobber", async () => {
  await withTempDir(async (root) => {
    const res = await ejectSkill(root, cfg(), "write-adr");
    assertEquals(res.destRel, join("skills", "write-adr"));
    assert(await exists(join(root, "skills/write-adr/SKILL.md")));
    // Writable (the embedded FS reports read-only; eject must restore owner write).
    assertEquals(
      (await modeOf(root, "skills/write-adr/SKILL.md")) & 0o600,
      0o600,
    );

    // Re-ejecting over an existing authored copy refuses (never clobbers edits).
    await assertRejects(
      () => ejectSkill(root, cfg(), "write-adr"),
      Error,
      "already exists",
    );
  });
});

Deno.test("ejectSkill rejects an unknown skill, listing the available ones", async () => {
  await withTempDir(async (root) => {
    const err = await assertRejects(
      () => ejectSkill(root, cfg(), "nope"),
      Error,
      'no bundled skill named "nope"',
    );
    assertStringIncludes((err as Error).message, "write-adr");
  });
});
