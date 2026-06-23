import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { compileGuidelines } from "../src/engine/guidelines.ts";

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
    // The authored demo is symlinked; the bundled built-ins are copied.
    assertEquals(first.skillsLinked, 1);
    assert(first.skillsCopied >= 1, "expected bundled built-ins to be copied");
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
    assertStringIncludes(agentsMd, "discern finish");
    assertStringIncludes(agentsMd, "My own rule.");
    assert(
      agentsMd.indexOf("discern finish") < agentsMd.indexOf("My own rule."),
      "built-in guidance should come before the user's sources",
    );
    // CLAUDE.md is NOT a byte-for-byte duplicate: it is exactly the `@AGENTS.md`
    // import (no banner — Claude Code strips HTML comments anyway), so the two can
    // never drift and the pointer text never churns.
    const claude = await Deno.readTextFile(join(tmp, "CLAUDE.md"));
    assertEquals(claude, "@AGENTS.md\n");

    // The authored skill is a relative symlink into ./skills/.
    const link = join(tmp, ".claude/skills/demo");
    assert((await Deno.lstat(link)).isSymlink, "expected a symlink");
    assertEquals(await Deno.readLink(link), "../../skills/demo");
    // A bundled built-in is copied in as a real directory (not a symlink).
    const builtin = await Deno.lstat(join(tmp, ".claude/skills/write-adr"));
    assert(builtin.isDirectory && !builtin.isSymlink);

    // --- prune: remove the authored skill, re-run → the dangling link is gone --
    await Deno.remove(join(tmp, "skills/demo"), { recursive: true });
    const second = await compileGuidelines(tmp);
    assertEquals(second.skillsLinked, 0);
    assertEquals(second.skillsPruned, 1);
    assertEquals(
      await Deno.lstat(link).then(() => true).catch(() => false),
      false,
      "expected the dangling skill link to be pruned",
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
    assertStringIncludes(claudeOnly, "discern finish");
    assert(
      !claudeOnly.includes("@AGENTS.md"),
      "no import line when there is no canonical file to point at",
    );
  } finally {
    await Deno.remove(b, { recursive: true });
  }
});
