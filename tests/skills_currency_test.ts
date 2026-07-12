/**
 * Currency check for materialized skills (`checkSkillsCurrent`) — the stateless
 * skills analog of `checkGuidanceCurrent` (ADR 0034). These drive the check against
 * REAL bundled skills materialized into a temp dir, then mutate the materialized
 * state and assert the drift is classified the way the gate consumes it: `stale`
 * blocks `done`, `missing`/`foreign` do not.
 */

import { assert, assertEquals } from "@std/assert";
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

Deno.test("an excluded skill is not expected on disk — its absence is no drift", async () => {
  await withTempDir(async (root) => {
    const excluded = cfg('exclude = ["discern-write-adr"]\n');
    await materializeClean(root, excluded);
    // The excluded skill was never placed, and its absence must not read as
    // drift: the currency check and the materializer share one effective set.
    assertEquals(
      await Deno.lstat(join(root, SKILLS_REL, "discern-write-adr"))
        .then(() => true).catch(() => false),
      false,
    );
    assertEquals(await checkSkillsCurrent(root, excluded), []);
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
    await Deno.remove(join(root, SKILLS_REL, "discern-write-adr"), {
      recursive: true,
    });
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

Deno.test("repointing a path key makes materialized skills `stale` until re-materialized (ADR 0102)", async () => {
  await withTempDir(async (root) => {
    const config = cfg();
    await materializeClean(root, config);
    assertEquals(await checkSkillsCurrent(root, config), []);

    // Repoint the map tree: the rendered prose changes, so the materialized
    // copies must read as stale — the refresh-after-reconfigure contract
    // guidance already has.
    const repointed = cfg('[map]\ndir = "zz-atlas/"\n');
    const drift = await checkSkillsCurrent(root, repointed);
    assert(
      drift.some((d) => d.reason === "stale"),
      `a path repoint must surface as stale drift, got: ${
        JSON.stringify(drift)
      }`,
    );

    // Re-materializing against the new config clears it.
    await materializeSkills(root, repointed, DIRS);
    assertEquals(await checkSkillsCurrent(root, repointed), []);
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

Deno.test("check/write parity: every `stale` a refresh clears, every `foreign` it leaves — for every entry kind", async () => {
  // The contract the check's classification MEANS: `stale` is drift `discern
  // refresh` will fix (the gate blocks on it and prescribes exactly that), and
  // `foreign` is an entry discern never touches. Exercise the whole
  // classification matrix — owned/unowned × real dir / live symlink / dangling
  // symlink — asserting the WRITE path honours what the CHECK reports. A new
  // divergence between the two (an entry read as `stale` that a refresh leaves
  // behind, or a `foreign` one it deletes) fails here whatever kind it is.
  const scenarios: ReadonlyArray<{
    label: string;
    name: string;
    /** Extra `[skills]` config lines for both the check and the refresh. */
    extra?: string;
    /** Arrange the entry after a clean materialize of the base config. */
    place: (root: string, abs: string) => Promise<void>;
    expect: "stale" | "foreign";
  }> = [
    {
      label: "owned real dir (a bundled skill the binary stopped shipping)",
      name: "dropped-builtin",
      place: async (_root, abs) => {
        await Deno.mkdir(join(abs, "dropped-builtin"));
        const manifest = JSON.parse(
          await Deno.readTextFile(join(abs, MATERIALIZED_MANIFEST)),
        ) as string[];
        await Deno.writeTextFile(
          join(abs, MATERIALIZED_MANIFEST),
          JSON.stringify([...manifest, "dropped-builtin"].sort(), null, 2),
        );
      },
      expect: "stale",
    },
    {
      label: "owned live symlink (an authored skill later excluded)",
      name: "mine",
      extra: 'exclude = ["mine"]\n',
      place: async () => {
        // Placed by the clean materialize below (authored → live symlink);
        // the exclusion in `extra` is what turns it non-effective.
      },
      expect: "stale",
    },
    {
      label: "dangling symlink (an authored skill deleted at source)",
      name: "mine",
      place: async (root) => {
        await Deno.remove(join(root, "skills", "mine"), { recursive: true });
      },
      expect: "stale",
    },
    {
      label: "foreign real dir (a user drop-in)",
      name: "user-dropin",
      place: async (_root, abs) => {
        await Deno.mkdir(join(abs, "user-dropin"));
        await Deno.writeTextFile(join(abs, "user-dropin/SKILL.md"), "mine");
      },
      expect: "foreign",
    },
    {
      label: "foreign live symlink (a user drop-in link)",
      name: "user-link",
      place: async (root, abs) => {
        await Deno.mkdir(join(root, "external"));
        await Deno.writeTextFile(join(root, "external/SKILL.md"), "x");
        await Deno.symlink("../../external", join(abs, "user-link"));
      },
      expect: "foreign",
    },
  ];

  for (const s of scenarios) {
    await withTempDir(async (root) => {
      await authoredSkill(root, "mine");
      await materializeClean(root, cfg());
      const abs = join(root, SKILLS_REL);
      await s.place(root, abs);

      const config = cfg(s.extra ?? "");
      const drift = await checkSkillsCurrent(root, config);
      const entry = drift.find((d) => d.name === s.name);
      assertEquals(entry?.reason, s.expect, `${s.label}: classification`);

      await materializeSkills(root, config, DIRS);
      const there = await Deno.lstat(join(abs, s.name))
        .then(() => true, () => false);
      if (s.expect === "stale") {
        assertEquals(there, false, `${s.label}: a refresh must prune it`);
        assertEquals(
          (await checkSkillsCurrent(root, config)).filter((d) =>
            d.name === s.name
          ),
          [],
          `${s.label}: after the refresh the check must be clean`,
        );
      } else {
        assertEquals(there, true, `${s.label}: a refresh must never touch it`);
        assertEquals(
          (await checkSkillsCurrent(root, config))
            .find((d) => d.name === s.name)?.reason,
          "foreign",
          `${s.label}: still foreign after a refresh, never escalated`,
        );
      }
    });
  }
});
