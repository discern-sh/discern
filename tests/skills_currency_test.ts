/**
 * Currency check for materialized skills (`checkSkillsCurrent`) — the stateless
 * skills analog of `checkGuidanceCurrent` (ADR 0034). These drive the check against
 * REAL bundled skills materialized into a temp dir, then mutate the materialized
 * state and assert the drift is classified the way the gate consumes it: `stale`
 * blocks `finish`, `missing`/`foreign` do not.
 */

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  type DiscernConfig,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import {
  checkSkillsCurrent,
  MATERIALIZED_MANIFEST,
  materializeSkills,
} from "../src/lib/skills.ts";
import { skillsDirsForAgents } from "../src/lib/providers.ts";
import { withTempDir } from "./helpers.ts";

/** Single-agent config so exactly one skills dir (.claude/skills) materializes. */
function cfg(extra = ""): DiscernConfig {
  return parseConfigOrThrow(
    `[guidance]\nagents = ["claude_code"]\n\n[skills]\ndir = "skills"\n${extra}`,
  );
}

const DIRS = skillsDirsForAgents(["claude_code"]); // [".claude/skills"]
const SKILLS_REL = DIRS[0];
if (SKILLS_REL === undefined) {
  throw new Error(
    "registry invariant broken: claude_code declares no skills dir",
  );
}

/** Write an authored skill so the effective set mixes copied + symlinked entries. */
async function authoredSkill(root: string, name: string): Promise<void> {
  await Deno.mkdir(join(root, "skills", name), { recursive: true });
  await Deno.writeTextFile(
    join(root, "skills", name, "SKILL.md"),
    `# ${name}\nauthored\n`,
  );
}

/** Materialize the effective set into the single Claude dir, the clean baseline. */
async function materializeClean(
  root: string,
  config: DiscernConfig,
): Promise<void> {
  await materializeSkills(root, config, DIRS);
}

Deno.test("a freshly materialized skills dir has zero drift", async () => {
  await withTempDir(async (root) => {
    const config = cfg();
    await authoredSkill(root, "mine");
    await materializeClean(root, config);
    assertEquals(await checkSkillsCurrent(root, config), []);
  });
});

Deno.test("skills feature off → the check is a no-op", async () => {
  await withTempDir(async (root) => {
    const config = cfg();
    await materializeClean(root, config);
    // Nuke a skill so a drift WOULD exist if the check ran.
    await Deno.remove(join(root, SKILLS_REL, "discern-write-adr"), { recursive: true });
    const off = cfg("\n[features]\nskills = false\n");
    assertEquals(await checkSkillsCurrent(root, off), []);
  });
});

Deno.test("a whole un-materialized dir is `missing`, not `stale` (non-blocking)", async () => {
  await withTempDir(async (root) => {
    const config = cfg();
    // Never materialize — the dir is absent, like a fresh checkout.
    const drift = await checkSkillsCurrent(root, config);
    assertEquals(
      drift.map((d) => ({ reason: d.reason, dir: d.dir })),
      [{ reason: "missing", dir: SKILLS_REL }],
    );
    // The gate only blocks on `stale`, so a missing dir never red-lights finish.
    assertEquals(drift.filter((d) => d.reason === "stale"), []);
  });
});

Deno.test("a hand-edited bundled copy is `stale`", async () => {
  await withTempDir(async (root) => {
    const config = cfg();
    await materializeClean(root, config);
    // Tamper with a copied bundled skill — content drift the manifest can't see.
    const tampered = join(root, SKILLS_REL, "discern-write-adr", "SKILL.md");
    await Deno.writeTextFile(tampered, "HAND EDITED\n", { append: true });
    const drift = await checkSkillsCurrent(root, config);
    const stale = drift.filter((d) => d.reason === "stale");
    assertEquals(stale.map((d) => d.name), ["discern-write-adr"]);
  });
});

Deno.test("an effective skill deleted from the dir is `stale`", async () => {
  await withTempDir(async (root) => {
    const config = cfg();
    await materializeClean(root, config);
    await Deno.remove(join(root, SKILLS_REL, "discern-write-adr"), { recursive: true });
    const drift = await checkSkillsCurrent(root, config);
    const stale = drift.filter((d) => d.reason === "stale");
    assertEquals(stale.map((d) => d.name), ["discern-write-adr"]);
  });
});

Deno.test("an authored symlink replaced by a real dir is `stale`", async () => {
  await withTempDir(async (root) => {
    const config = cfg();
    await authoredSkill(root, "mine");
    await materializeClean(root, config);
    // Replace the live symlink with a real directory — the wrong materialization kind.
    const link = join(root, SKILLS_REL, "mine");
    await Deno.remove(link);
    await Deno.mkdir(link);
    const drift = await checkSkillsCurrent(root, config);
    const stale = drift.filter((d) => d.reason === "stale");
    assertEquals(stale.map((d) => d.name), ["mine"]);
  });
});

Deno.test("a lingering managed entry (in the manifest, no longer effective) is `stale`", async () => {
  await withTempDir(async (root) => {
    const config = cfg();
    await materializeClean(root, config);
    // A dir discern OWNED before but that is no longer effective: add it to the
    // manifest + drop a real dir. This is the orphan the prune pass would remove.
    const abs = join(root, SKILLS_REL);
    await Deno.mkdir(join(abs, "dropped-builtin"));
    const manifest = JSON.parse(
      await Deno.readTextFile(join(abs, MATERIALIZED_MANIFEST)),
    ) as string[];
    await Deno.writeTextFile(
      join(abs, MATERIALIZED_MANIFEST),
      JSON.stringify([...manifest, "dropped-builtin"].sort(), null, 2),
    );
    const drift = await checkSkillsCurrent(root, config);
    const stale = drift.filter((d) => d.reason === "stale");
    assertEquals(stale.map((d) => d.name), ["dropped-builtin"]);
  });
});

Deno.test("a foreign drop-in is `foreign`, never `stale` (never clobbered)", async () => {
  await withTempDir(async (root) => {
    const config = cfg();
    await materializeClean(root, config);
    // A user-placed dir discern never materialized (absent from the manifest).
    await Deno.mkdir(join(root, SKILLS_REL, "user-dropin"));
    const drift = await checkSkillsCurrent(root, config);
    assertEquals(drift.filter((d) => d.reason === "stale"), []);
    const foreign = drift.filter((d) => d.reason === "foreign");
    assertEquals(foreign.map((d) => d.name), ["user-dropin"]);
  });
});
