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
import { z } from "@zod/zod";
import { dirname, join, relative } from "@std/path";
import { walk } from "@std/fs";
import { decodeWith } from "./decode_cli_result.ts";

const MaterializedManifestSchema = z.array(z.string());
import {
  type DiscernConfig,
  parseConfigOrThrow,
} from "../src/shared/config_schema.ts";
import {
  bundledSkillNames,
  claudeSkillsDirOf,
  ejectSkill,
  listSkills,
  MATERIALIZED_MANIFEST,
  materializeSkills,
  resolveEffectiveSkills,
} from "../src/lib/skills.ts";
import { resolveBundledSkillsDir } from "../src/lib/paths.ts";
import { allSkillsDirs, skillsDirsForAgents } from "../src/lib/providers.ts";
import { placementLadderProse } from "../src/shared/questions.ts";
import { modeOf, withTempDir } from "./helpers.ts";
import { targetExists } from "../src/shared/fs_presence.ts";

/** The single Claude Code skills dir — pins the per-dir materialization mechanics
 * tests below to one directory (resolved from the registry, not a literal). */
const CLAUDE_SKILLS = skillsDirsForAgents(["claude_code"]);

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
      "discern-document-subsystem",
      "discern-write-adr",
    ]
  ) {
    assert(
      names.includes(n),
      `expected bundled skill ${n} in ${names.join(",")}`,
    );
  }
  assertEquals([...names], [...names].sort());
});

Deno.test("shipped content names no vendor-specific skills dir (stays provider-neutral)", async () => {
  // Content discern scaffolds or materializes onto an end user's machine — bundled
  // skill bodies and their skeletons, the setup instructions and scaffolded doc
  // skeletons, the built-in instructions — must not hardcode ONE provider's skills
  // directory. A skill materializes into whichever provider dir(s) the user
  // configured (`.claude/skills` for Claude Code, the shared `.agents/skills` for
  // the rest), so a `.claude/skills/…` path is a dead reference for a Codex or
  // Gemini user. Refer to a skill by its NAME instead — that's how it's invoked,
  // and it needs no path. The banned prefixes come from the provider registry
  // (`allSkillsDirs`), so a newly-added provider's dir auto-enrols: this is a
  // forcing-function over discern's own closed set, not a hand-kept denylist of
  // vendor words.
  const bundledSkills = await resolveBundledSkillsDir(); // …/templates/skills
  const templates = dirname(bundledSkills); // …/templates
  const trees = [
    bundledSkills,
    join(templates, "setup"),
    join(templates, "instructions"),
  ];
  const banned = allSkillsDirs();
  const offenders: string[] = [];
  for (const tree of trees) {
    for await (
      const entry of walk(tree, { exts: [".md"], includeDirs: false })
    ) {
      const text = await Deno.readTextFile(entry.path);
      for (const dir of banned) {
        if (text.includes(dir)) {
          offenders.push(`${relative(templates, entry.path)} names "${dir}"`);
        }
      }
    }
  }
  assertEquals(
    offenders,
    [],
    `shipped content must stay provider-neutral — reference a skill by name, not a vendor path:\n${
      offenders.join("\n")
    }`,
  );
});

Deno.test("delegate-work keeps dispatch consent and staged dependency contracts", async () => {
  const bundledDir = await resolveBundledSkillsDir();
  const text = await Deno.readTextFile(
    join(bundledDir, "discern-delegate-work", "SKILL.md"),
  );
  for (
    const [meaning, needle] of [
      [
        "dependent briefs are written while their reasoning is still present",
        "all written now",
      ],
      [
        "deferring a brief loses the context that shaped it",
        "a brief deferred until A lands gets written from a colder memory of why",
      ],
      [
        "parallel streams each own an isolated worktree",
        "run at once, each in its own worktree",
      ],
      [
        "the user controls every handoff's dispatch",
        "The user controls dispatch for every handoff",
      ],
      [
        "preparing briefs grants no authority to launch them",
        "Preparing or presenting briefs does not authorize you to dispatch them",
      ],
      [
        "launching a prompt is itself user initiation",
        "Launching a prompt counts as confirmation for the dispatch it describes",
      ],
      [
        "one-brief fan-out waits at the same consent boundary",
        "after the user dispatches the brief",
      ],
      [
        "single-brief and multi-brief handoffs share one consent rule",
        "The same consent boundary applies to a one-brief fan-out and a multi-brief set",
      ],
      [
        "the offer makes resource and concurrency costs visible",
        "State how many sessions, worktrees, and sub-agents will start",
      ],
      [
        "the agent waits for consent before starting effects",
        "Wait for the user's confirmation before starting any session, worktree, or sub-agent",
      ],
      [
        "the user remains the assumed dispatcher",
        "Assume the user will launch them",
      ],
      [
        "a capable agent offers rather than dispatching proactively",
        "offer to dispatch them and wait for explicit confirmation",
      ],
      [
        "dispatch consent is scoped to the plan the user reviewed",
        "confirmation covers only the described dispatch",
      ],
      [
        "each multi-brief receiving agent owns only its brief",
        "The agent receiving one of those briefs owns that brief only",
      ],
      [
        "each multi-brief receiver is forbidden from recreating its siblings",
        "do not launch, dispatch, or supervise the sibling briefs",
      ],
      [
        "fleet-level launch instructions stay outside child prompts",
        "explain the dispatch topology outside the copyable prompts",
      ],
      [
        "the key fixes the landing order in the brief titles",
        "The key fixes the cross-wave landing order once",
      ],
      [
        "each brief names the other in-flight streams",
        "Other streams are in flight",
      ],
      [
        "landing authority remains the user's planning-time choice",
        "is the user's call, made once at planning time; ask now",
      ],
      [
        "desk grants retain their batch workflow",
        "give that last one a batch moment",
      ],
      [
        "prose cannot manufacture landing authority",
        "text is not a grant, and the verb checks the record",
      ],
      [
        "orientation re-roots into the named worktree before any reading",
        "and re-root there before reading anything else",
      ],
      [
        "requested worktree names remain literal and slug-first",
        "one short programme slug — one word for the whole effort",
      ],
      [
        "dependent briefs use the exact returned branch",
        "capture A's exact returned branch",
      ],
      [
        "green composition follows an immutable observed commit",
        "compose from the immutable observed commit",
      ],
      [
        "intermediate stacked branches remain available and never accept",
        "keeps its branch for the dependent, and never accepts",
      ],
      [
        "dependent briefs carry the facts needed to wait",
        "Name the exact returned branch, the readiness condition, and the composition move from §2",
      ],
      [
        "the bundled await skill owns the wait procedure",
        "The `discern-await-the-fleet` skill owns the wait procedure the receiving agent follows",
      ],
      [
        "dependent briefs route the wait through the bundled await skill",
        "B's brief names the `discern-await-the-fleet` skill for that wait",
      ],
      [
        "a confirmed handoff can run without a human readiness relay",
        "one confirmation can authorize you to do so, without anyone relaying readiness by hand",
      ],
    ] as const
  ) {
    assertStringIncludes(
      text,
      needle,
      `discern-delegate-work lost this instruction: ${meaning}`,
    );
  }

  for (
    const unauthorizedDispatch of [
      "that receiving agent is the handoff's only dispatch owner",
      "the single receiving agent launches its sub-agents",
      "launch each once from this session",
    ]
  ) {
    assert(
      !text.includes(unauthorizedDispatch),
      `discern-delegate-work lets an agent dispatch without the user's initiation or confirmation: ${unauthorizedDispatch}`,
    );
  }

  for (
    const leakedProcedure of [
      "longest-safe call",
      "`data.met: false`",
      "`data.resume`",
      "`--resume`",
      "progress updates",
      "retry limit",
      "request budget",
    ]
  ) {
    assert(
      !text.includes(leakedProcedure),
      `discern-delegate-work re-describes the receiving agent's wait procedure: ${leakedProcedure}`,
    );
  }
});

Deno.test("place-a-checkpoint quotes the canonical placement ladder verbatim", async () => {
  // The ladder has one authority (PLACEMENT_LADDER in src/shared/questions.ts);
  // the question teaches interpolate it, and the authoring skill must quote
  // the same prose so the rungs can never drift between surfaces. A reworded
  // ladder updates both or fails here.
  const bundledDir = await resolveBundledSkillsDir();
  const text = await Deno.readTextFile(
    join(bundledDir, "discern-place-a-checkpoint", "SKILL.md"),
  );
  assert(
    text.includes(placementLadderProse()),
    "discern-place-a-checkpoint must render the shared placement-ladder prose " +
      "verbatim — change src/shared/questions.ts and the skill together",
  );
});

Deno.test("every skeleton path a bundled SKILL.md cites exists in that skill's source", async () => {
  // A skill that scaffolds files tells its reader to copy from its own
  // `skeleton/<path>` directory (vendor-neutral: relative to where the agent found
  // the skill). That prose path has no compiler behind it, so a renamed or moved
  // skeleton silently orphans it and the agent copies from nothing. Enumerate every
  // backtick-wrapped `skeleton/…` reference across all bundled SKILL.md bodies (a
  // new skill auto-enrols) and assert it resolves in the skill's source.
  const bundledDir = await resolveBundledSkillsDir();
  const names = await bundledSkillNames();
  const reference = /`(skeleton\/[A-Za-z0-9._/-]+?)\/?`/g;
  let checked = 0;
  for (const name of names) {
    const text = await Deno.readTextFile(join(bundledDir, name, "SKILL.md"));
    for (const match of text.matchAll(reference)) {
      const rel = match[1];
      assert(
        rel !== undefined && await targetExists(join(bundledDir, name, rel)),
        `${name}/SKILL.md cites \`${rel}\` but templates/skills/${name}/${rel} does not exist`,
      );
      checked++;
    }
  }
  assert(checked > 0, "expected at least one skeleton reference to check");
});

Deno.test("resolveEffectiveSkills: bundled-only when no authored dir", async () => {
  await withTempDir(async (root) => {
    const eff = await resolveEffectiveSkills(root, cfg());
    assert(eff.length >= 2);
    assert(eff.every((e) => e.source === "bundled" && !e.overridesBundled));
    assert(eff.some((e) => e.name === "discern-write-adr"));
  });
});

Deno.test("resolveEffectiveSkills: authored overrides a bundled name; unique authored stands alone", async () => {
  await withTempDir(async (root) => {
    await authoredSkill(root, "discern-document-subsystem"); // shadows a built-in
    await authoredSkill(root, "my-skill"); // unique
    const eff = await resolveEffectiveSkills(root, cfg());
    const byName = new Map(eff.map((e) => [e.name, e]));

    const overridden = byName.get("discern-document-subsystem");
    assertExists(overridden);
    assertEquals(overridden.source, "authored");
    assertEquals(overridden.overridesBundled, true);

    const mine = byName.get("my-skill");
    assertExists(mine);
    assertEquals(mine.source, "authored");
    assertEquals(mine.overridesBundled, false);

    // A non-overridden built-in stays bundled.
    const writeAdr = byName.get("discern-write-adr");
    assertExists(writeAdr);
    assertEquals(writeAdr.source, "bundled");
  });
});

Deno.test("listSkills annotates source / override / hasBundled", async () => {
  await withTempDir(async (root) => {
    await authoredSkill(root, "discern-document-subsystem");
    await authoredSkill(root, "my-skill");
    const rows = new Map(
      (await listSkills(root, cfg())).map((r) => [r.name, r]),
    );

    assertEquals(rows.get("discern-document-subsystem"), {
      name: "discern-document-subsystem",
      source: "authored",
      overridesBundled: true,
      hasBundled: true,
      excluded: false,
    });
    assertEquals(rows.get("my-skill"), {
      name: "my-skill",
      source: "authored",
      overridesBundled: false,
      hasBundled: false,
      excluded: false,
    });
    const writeAdr = rows.get("discern-write-adr");
    assertExists(writeAdr);
    assertEquals(writeAdr.source, "bundled");
  });
});

Deno.test("materializeSkills: bundled copied, authored symlinked", async () => {
  await withTempDir(async (root) => {
    await authoredSkill(root, "my-skill");
    await authoredSkill(root, "discern-document-subsystem"); // override → symlink, not copy
    const res = await materializeSkills(root, cfg(), CLAUDE_SKILLS);
    assert(res.copied >= 1, `expected the non-overridden built-ins copied`);
    assertEquals(res.linked, 2); // my-skill + the discern-document-subsystem override
    assertEquals(res.pruned, 0);

    const sk = claudeSkillsDirOf(root);
    // A non-overridden built-in is a real directory (copy).
    const wa = await Deno.lstat(join(sk, "discern-write-adr"));
    assert(wa.isDirectory && !wa.isSymlink);
    // An authored skill is a relative symlink into ./skills/.
    const mine = await Deno.lstat(join(sk, "my-skill"));
    assert(mine.isSymlink);
    assertEquals(
      await Deno.readLink(join(sk, "my-skill")),
      "../../skills/my-skill",
    );
    // The override is a symlink too (authored wins over the bundled copy).
    assert(
      (await Deno.lstat(join(sk, "discern-document-subsystem"))).isSymlink,
    );
  });
});

Deno.test("materializeSkills: prunes a removed authored skill's dangling link", async () => {
  await withTempDir(async (root) => {
    await authoredSkill(root, "temp");
    await materializeSkills(root, cfg(), CLAUDE_SKILLS);
    assert(
      await targetExists(join(claudeSkillsDirOf(root), "temp", "SKILL.md")),
    );

    await Deno.remove(join(root, "skills/temp"), { recursive: true });
    const res = await materializeSkills(root, cfg(), CLAUDE_SKILLS);
    assertEquals(res.pruned, 1);
    assertEquals(
      await targetExists(join(claudeSkillsDirOf(root), "temp")),
      false,
    );
  });
});

Deno.test("materializeSkills: prunes an excluded authored skill's live symlink and disowns it", async () => {
  await withTempDir(async (root) => {
    // Materialize an authored skill, then exclude it: the LIVE symlink discern
    // placed (and recorded in the manifest) must be pruned like any other entry
    // discern owns — never left behind and re-labelled a foreign drop-in.
    await authoredSkill(root, "foo");
    await materializeSkills(root, cfg(), CLAUDE_SKILLS);
    const sk = claudeSkillsDirOf(root);
    assert((await Deno.lstat(join(sk, "foo"))).isSymlink);

    const excluded = parseConfigOrThrow(
      '[skills]\ndir = "skills"\nexclude = ["foo"]\n',
    );
    const res = await materializeSkills(root, excluded, CLAUDE_SKILLS);
    assertEquals(res.pruned, 1, "the excluded skill's symlink must be pruned");
    assertEquals(await targetExists(join(sk, "foo")), false);
    // Pruning removes the LINK only — the authored source stays untouched.
    assert(await targetExists(join(root, "skills/foo/SKILL.md")));
    // And the manifest no longer carries it (nothing left to own).
    const owned = decodeWith(
      MaterializedManifestSchema,
      await Deno.readTextFile(join(sk, MATERIALIZED_MANIFEST)),
    );
    assertEquals(owned.includes("foo"), false);
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

    await materializeSkills(root, cfg(), CLAUDE_SKILLS);

    assert(
      await targetExists(join(sk, "mine-real/SKILL.md")),
      "real dir survives",
    );
    assert(
      (await Deno.lstat(join(sk, "mine-link"))).isSymlink,
      "live link survives",
    );
  });
});

Deno.test("materializeSkills: prunes a real-dir copy of a bundled skill it no longer ships, but never a drop-in", async () => {
  await withTempDir(async (root) => {
    const sk = claudeSkillsDirOf(root);
    // First materialize records discern's ownership manifest for the real bundled set.
    await materializeSkills(root, cfg(), CLAUDE_SKILLS);

    // Simulate a bundled skill a newer binary stopped shipping: a real copied dir
    // whose name discern recorded as materialized, now absent from the effective set.
    await Deno.mkdir(join(sk, "gone-skill"));
    await Deno.writeTextFile(
      join(sk, "gone-skill/SKILL.md"),
      "stale bundled copy",
    );
    const manifestPath = join(sk, MATERIALIZED_MANIFEST);
    const owned = decodeWith(
      MaterializedManifestSchema,
      await Deno.readTextFile(manifestPath),
    );
    await Deno.writeTextFile(
      manifestPath,
      JSON.stringify([...owned, "gone-skill"], null, 2),
    );

    // A genuine user drop-in (a name discern never materialized) must survive — even
    // though it is also a real dir with a SKILL.md.
    await Deno.mkdir(join(sk, "mine-real"));
    await Deno.writeTextFile(join(sk, "mine-real/SKILL.md"), "real");

    const res = await materializeSkills(root, cfg(), CLAUDE_SKILLS);

    assertEquals(
      await targetExists(join(sk, "gone-skill")),
      false,
      "an orphaned bundled-skill copy discern owned must be pruned",
    );
    assert(res.pruned >= 1, "the orphan prune should be reported");
    assert(
      await targetExists(join(sk, "mine-real/SKILL.md")),
      "a foreign drop-in discern never materialized must never be clobbered",
    );
  });
});

Deno.test("materializeSkills: writes into EVERY configured agent's dir (Claude + the shared .agents)", async () => {
  await withTempDir(async (root) => {
    await authoredSkill(root, "my-skill");
    // A default-style agent set: Claude Code + Codex → two distinct dirs.
    const dirs = skillsDirsForAgents(["claude_code", "codex"]);
    assertEquals(dirs, [".claude/skills", ".agents/skills"]);
    const res = await materializeSkills(root, cfg(), dirs);

    // The SAME effective set is reconciled into BOTH dirs.
    for (const rel of dirs) {
      assert(
        await targetExists(join(root, rel, "discern-write-adr", "SKILL.md")),
        `a bundled skill is missing from ${rel}`,
      );
      assert(
        (await Deno.lstat(join(root, rel, "my-skill"))).isSymlink,
        `the authored skill is not symlinked in ${rel}`,
      );
      assert(
        await targetExists(join(root, rel, MATERIALIZED_MANIFEST)),
        `the ownership manifest is missing from ${rel}`,
      );
    }
    // Counts sum across the dirs: one authored symlink in each of the two.
    assertEquals(res.linked, 2);
  });
});

Deno.test("ejectSkill copies a built-in into [skills].dir, writable, then refuses to clobber", async () => {
  await withTempDir(async (root) => {
    const res = await ejectSkill(root, cfg(), "discern-write-adr");
    assertEquals(res.destRel, join("skills", "discern-write-adr"));
    assert(await targetExists(join(root, "skills/discern-write-adr/SKILL.md")));
    // Writable (the embedded FS reports read-only; eject must restore owner write).
    assertEquals(
      (await modeOf(root, "skills/discern-write-adr/SKILL.md")) & 0o600,
      0o600,
    );

    // Re-ejecting over an existing authored copy refuses (never clobbers edits).
    await assertRejects(
      () => ejectSkill(root, cfg(), "discern-write-adr"),
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
    assertStringIncludes((err as Error).message, "discern-write-adr");
  });
});

// ── bundled-skill rendering (ADR 0102) ──────────────────────────────────────

Deno.test("materialization renders bundled markdown against the configured paths", async () => {
  await withTempDir(async (root) => {
    const config = parseConfigOrThrow(
      '[map]\ndir = "zz-atlas/"\n\n[project]\ntodo = "zz-ledger.md"\n',
    );
    await materializeSkills(root, config, CLAUDE_SKILLS);
    const skillsAbs = claudeSkillsDirOf(root);

    // The ADR skill's prose names the CONFIGURED map tree, not a default...
    const adr = await Deno.readTextFile(
      join(skillsAbs, "discern-write-adr", "SKILL.md"),
    );
    assertStringIncludes(adr, "zz-atlas/_adr/");
    // ...and the documenter skill names the configured ledger.
    const doc = await Deno.readTextFile(
      join(skillsAbs, "discern-document-subsystem", "SKILL.md"),
    );
    assertStringIncludes(doc, "zz-ledger.md");

    // No token survives rendering in ANY materialized markdown file — a stray
    // `{{` in output means a template failed to render.
    for await (const entry of walk(skillsAbs, { includeDirs: false })) {
      if (!entry.path.endsWith(".md")) continue;
      const text = await Deno.readTextFile(entry.path);
      assert(
        !text.includes("{{"),
        `unrendered token residue in ${relative(skillsAbs, entry.path)}`,
      );
    }
  });
});

Deno.test("ejectSkill renders markdown — an authored copy speaks the project's paths, not tokens", async () => {
  await withTempDir(async (root) => {
    const config = parseConfigOrThrow(
      '[skills]\ndir = "skills"\n\n[map]\ndir = "zz-atlas/"\n',
    );
    const r = await ejectSkill(root, config, "discern-write-adr");
    const text = await Deno.readTextFile(join(r.destAbs, "SKILL.md"));
    assertStringIncludes(text, "zz-atlas/_adr/");
    assert(!text.includes("{{"), "ejected markdown must carry no tokens");
  });
});
