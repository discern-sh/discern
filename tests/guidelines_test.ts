import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  compileGuidelines,
  guidanceRefreshErrors,
  guidanceRefreshSucceeded,
} from "../src/engine/guidelines.ts";
import { bundledSkillNames } from "../src/lib/skills.ts";

/** Scaffold a temp project with a discern.toml, a guidance source, and one
 * authored skill (under ./skills/). Built-in guidance + bundled skills come from
 * the repo's own templates/ tree (resolved by the compiler). */
async function scaffold(): Promise<string> {
  const tmp = await Deno.makeTempDir({ prefix: "discern-guidelines-test-" });
  await Deno.writeTextFile(
    join(tmp, "discern.toml"),
    [
      "[project]",
      'agents = ["claude_code", "codex"]',
      "[guidance]",
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
    // Provider files written in [project].agents order.
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
    // built-in guidance (the base section's first heading), then names the
    // gate command, then the user's own guidance.md appended after it. The prime
    // attention spot is real guidance, not a deterrent (ADR 0034).
    const agentsMd = await Deno.readTextFile(join(tmp, "AGENTS.md"));
    assert(
      agentsMd.startsWith("# Working in this project"),
      "expected the guidance itself at the top — no banner",
    );
    assert(
      !agentsMd.includes("<!-- GENERATED"),
      "the generated file carries no HTML-comment banner",
    );
    assertStringIncludes(agentsMd, "discern_done");
    assertStringIncludes(agentsMd, "My own rule.");
    assert(
      agentsMd.indexOf("discern_done") < agentsMd.indexOf("My own rule."),
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

Deno.test("guidance refresh status ignores blank error entries", () => {
  assertEquals(guidanceRefreshErrors({ errors: [" \n\t "] }), []);
  assertEquals(guidanceRefreshSucceeded({ errors: [" \n\t "] }), true);
  assertEquals(
    guidanceRefreshErrors({ errors: [" \n\t ", " real error "] }),
    ["real error"],
  );
  assertEquals(
    guidanceRefreshSucceeded({ errors: [" \n\t ", " real error "] }),
    false,
  );
});

Deno.test("compileGuidelines callers use the shared partial-refresh predicate", async () => {
  const root = join(dirname(fromFileUrl(import.meta.url)), "..");
  const offenders: string[] = [];
  for await (const path of sourceFiles(join(root, "src"))) {
    const rel = path.slice(root.length + 1);
    if (rel === "src/engine/guidelines.ts") {
      continue;
    }
    const text = await Deno.readTextFile(path);
    if (text.includes("compileGuidelines(") && /\.errors\.length/.test(text)) {
      offenders.push(rel);
    }
  }
  assertEquals(offenders, []);
});

Deno.test("compileGuidelines honours [skills].exclude: an excluded bundled set materializes nothing, guidance still compiles", async () => {
  const dir = await Deno.makeTempDir({ prefix: "discern-skills-excluded-" });
  try {
    const bundled = await bundledSkillNames();
    await Deno.writeTextFile(
      join(dir, "discern.toml"),
      `[skills]\nexclude = ${
        JSON.stringify(bundled)
      }\n[project]\nagents = ["claude_code"]\n`,
    );
    const r = await compileGuidelines(dir);
    assertEquals(r.skillsCopied, 0);
    assertEquals(r.skillsLinked, 0);
    assertEquals(r.agentsWritten, ["CLAUDE.md"]);
    // With no tracked AGENTS.md emitted, CLAUDE.md falls back to the FULL guidance
    // (there is nothing to point at) rather than a dangling `@AGENTS.md` import.
    const claudeOnly = await Deno.readTextFile(join(dir, "CLAUDE.md"));
    assertStringIncludes(claudeOnly, "discern_done");
    assert(
      !claudeOnly.includes("@AGENTS.md"),
      "no import line when there is no canonical file to point at",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

/** Return the source files. */
async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      yield* sourceFiles(path);
    } else if (entry.isFile && path.endsWith(".ts")) {
      yield path;
    }
  }
}
