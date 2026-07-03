import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { compileGuidelines } from "../src/engine/guidelines.ts";
import {
  GUIDANCE_BASELINES_REL,
  listRescuedArtifacts,
} from "../src/lib/rescue.ts";

/** Scaffold a temp project with a discern.toml, a guidance source, and one
 * authored skill (under ./skills/). Built-in guidance + bundled skills come from
 * the repo's own templates/ tree (resolved by the compiler). */
async function scaffold(): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "discern-guidelines-test-" });
  await Deno.writeTextFile(
    join(tmp, "discern.toml"),
    [
      "[guidance]",
      'agents = ["claude_code", "codex"]',
      'sources = ["guidance.md"]',
      "[skills]",
      'dir = "skills"',
      "",
    ].join("\n"),
  );
  await Deno.writeTextFile(
    join(tmp, "guidance.md"),
    "# Project guidance\nMy own rule.\n",
  );
  await Deno.mkdir(join(tmp, "skills/demo"), { recursive: true });
  await Deno.writeTextFile(join(tmp, "skills/demo/SKILL.md"), "demo skill");
  return tmp;
}

Deno.test("compileGuidelines: built-in + sources (no banner); copies built-ins, symlinks authored, prunes", async () => {
  const tmp = await scaffold();
  try {
    const first = await compileGuidelines(tmp);
    // Provider files written in [guidance].agents order.
    assertEquals(first.agentsWritten, ["CLAUDE.md", "AGENTS.md"]);
    // Skills materialize into BOTH configured agents' dirs: Claude's .claude/skills
    // and Codex's shared .agents/skills. So the authored demo is symlinked twice and
    // the bundled built-ins copied twice — the counts sum across the two dirs.
    assertEquals(first.skillsLinked, 2);
    assert(
      first.skillsCopied >= 2,
      "expected bundled built-ins copied into both dirs",
    );
    assertEquals(first.skillsPruned, 0);

    // AGENTS.md is the canonical agent file: NO banner — it opens with discern's
    // built-in harness guidance (the base section's first heading), then names the
    // gate command, then the user's own guidance.md appended after it. The prime
    // attention spot is real guidance, not a deterrent (ADR 0034).
    const agentsMd = await Deno.readTextFile(join(tmp, "AGENTS.md"));
    assert(
      agentsMd.startsWith("# Working with the discern harness"),
      "expected the guidance itself at the top — no banner",
    );
    assert(
      !agentsMd.includes("<!-- GENERATED"),
      "the generated file carries no HTML-comment banner",
    );
    assertStringIncludes(agentsMd, "discern_finish");
    assertStringIncludes(agentsMd, "My own rule.");
    assert(
      agentsMd.indexOf("discern_finish") < agentsMd.indexOf("My own rule."),
      "built-in guidance should come before the user's sources",
    );
    // CLAUDE.md is NOT a byte-for-byte duplicate: it is exactly the `@AGENTS.md`
    // import (no banner — Claude Code strips HTML comments anyway), so the two can
    // never drift and the pointer text never churns.
    const claude = await Deno.readTextFile(join(tmp, "CLAUDE.md"));
    assertEquals(claude, "@AGENTS.md\n");

    // The authored skill is a relative symlink into ./skills/ — in BOTH agent dirs.
    const link = join(tmp, ".claude/skills/demo");
    assert((await Deno.lstat(link)).isSymlink, "expected a symlink");
    assertEquals(await Deno.readLink(link), "../../skills/demo");
    assert(
      (await Deno.lstat(join(tmp, ".agents/skills/demo"))).isSymlink,
      "expected the authored skill in the shared .agents/skills dir too",
    );
    // A bundled built-in is copied in as a real directory (not a symlink).
    const builtin = await Deno.lstat(
      join(tmp, ".claude/skills/discern-write-adr"),
    );
    assert(builtin.isDirectory && !builtin.isSymlink);

    // --- prune: remove the authored skill, re-run → the dangling link is gone --
    // from BOTH dirs (so pruned counts 2).
    await Deno.remove(join(tmp, "skills/demo"), { recursive: true });
    const second = await compileGuidelines(tmp);
    assertEquals(second.skillsLinked, 0);
    assertEquals(second.skillsPruned, 2);
    assertEquals(
      await Deno.lstat(link).then(() => true).catch(() => false),
      false,
      "expected the dangling skill link to be pruned",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("compileGuidelines: rescues generated-file edits without source-edit noise", async () => {
  const tmp = await scaffold();
  try {
    const first = await compileGuidelines(tmp);
    assertEquals(first.rescuedArtifacts, []);

    await Deno.writeTextFile(
      join(tmp, "guidance.md"),
      "# Project guidance\nMy own rule.\nSource-only change.\n",
    );
    const sourceOnly = await compileGuidelines(tmp);
    assertEquals(sourceOnly.rescuedArtifacts, []);
    assertEquals(await listRescuedArtifacts(tmp), []);

    const claudePath = join(tmp, "CLAUDE.md");
    await Deno.writeTextFile(
      claudePath,
      `${await Deno.readTextFile(
        claudePath,
      )}\n# Local memory\nRemember the launch checklist.\n`,
    );
    await Deno.writeTextFile(
      join(tmp, "guidance.md"),
      "# Project guidance\nMy own rule.\nSource-only change.\nSecond source change.\n",
    );

    const rescued = await compileGuidelines(tmp);
    assertEquals(await Deno.readTextFile(claudePath), "@AGENTS.md\n");
    assertEquals(rescued.rescuedArtifacts.length, 1);
    const rescueRel = rescued.rescuedArtifacts[0];
    assert(rescueRel !== undefined);
    const rescueText = await Deno.readTextFile(join(tmp, rescueRel));
    assertStringIncludes(rescueText, "Remember the launch checklist.");
    assertStringIncludes(rescued.hints.join("\n"), "guidance.md");
    assertEquals(await listRescuedArtifacts(tmp), rescued.rescuedArtifacts);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("compileGuidelines: rescues generated-file edits when no baseline exists yet", async () => {
  const tmp = await scaffold();
  try {
    const first = await compileGuidelines(tmp);
    assertEquals(first.rescuedArtifacts, []);
    await Deno.remove(join(tmp, GUIDANCE_BASELINES_REL));

    const claudePath = join(tmp, "CLAUDE.md");
    await Deno.writeTextFile(
      claudePath,
      `${await Deno.readTextFile(
        claudePath,
      )}\n# Local memory\nTyped before this discern version shipped.\n`,
    );
    await Deno.writeTextFile(
      join(tmp, "guidance.md"),
      "# Project guidance\nMy own rule.\nSource-only change.\n",
    );

    const rescued = await compileGuidelines(tmp);
    assertEquals(await Deno.readTextFile(claudePath), "@AGENTS.md\n");
    assertEquals(rescued.rescuedArtifacts.length, 1);
    const rescueRel = rescued.rescuedArtifacts[0];
    assert(rescueRel !== undefined);
    const rescueText = await Deno.readTextFile(join(tmp, rescueRel));
    assertStringIncludes(
      rescueText,
      "Typed before this discern version shipped.",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("compileGuidelines respects [features]: guidance off compiles nothing; skills off materializes nothing", async () => {
  // guidance off → no agent files, but skills still materialize (jobs are gated
  // independently).
  const a = await Deno.makeTempDir({ prefix: "discern-guidelines-off-" });
  try {
    await Deno.writeTextFile(
      join(a, "discern.toml"),
      '[features]\nguidance = false\n[guidance]\nagents = ["claude_code"]\n',
    );
    const r = await compileGuidelines(a);
    assertEquals(r.agentsWritten, []);
    assertEquals(
      await Deno.lstat(join(a, "CLAUDE.md")).then(() => true).catch(() =>
        false
      ),
      false,
      "no agent file when guidance is off",
    );
    assert(
      r.skillsCopied >= 1,
      "skills still materialize when only guidance is off",
    );
  } finally {
    await Deno.remove(a, { recursive: true });
  }

  // skills off → nothing under .claude/skills/, but guidance still compiles.
  const b = await Deno.makeTempDir({ prefix: "discern-skills-off-" });
  try {
    await Deno.writeTextFile(
      join(b, "discern.toml"),
      '[features]\nskills = false\n[guidance]\nagents = ["claude_code"]\n',
    );
    const r = await compileGuidelines(b);
    assertEquals(r.skillsCopied, 0);
    assertEquals(r.skillsLinked, 0);
    assertEquals(
      await Deno.lstat(join(b, ".claude/skills")).then(() => true).catch(() =>
        false
      ),
      false,
      "no .claude/skills when skills is off",
    );
    assertEquals(r.agentsWritten, ["CLAUDE.md"]);
    // With no tracked AGENTS.md emitted, CLAUDE.md falls back to the FULL guidance
    // (there is nothing to point at) rather than a dangling `@AGENTS.md` import.
    const claudeOnly = await Deno.readTextFile(join(b, "CLAUDE.md"));
    assertStringIncludes(claudeOnly, "discern_finish");
    assert(
      !claudeOnly.includes("@AGENTS.md"),
      "no import line when there is no canonical file to point at",
    );
  } finally {
    await Deno.remove(b, { recursive: true });
  }
});
