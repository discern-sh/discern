/**
 * Engine coverage for `agent guidelines` — the recipe that compiles the agent
 * instruction files (job 1) AND links the bundled skills into `.claude/skills/`
 * (job 2) so the coding agent can discover them.
 *
 * The recipe runs under the engine's noglob default (`set -f`, ADR 0012) and
 * generates filenames by globbing (`.ai/guidelines/*.md`, `.ai/skills/*`). It
 * had no automated coverage, so when noglob landed those globs silently stopped
 * expanding: guidelines died "no sources" before linking any skill, and bundled
 * skills became invisible in every freshly-created worktree. These tests pin
 * both jobs under the real dispatcher (marker set → noglob active), and run in
 * CI's dash/bash matrix because the file matches `engine_*_test.ts`.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { exists } from "@std/fs";
import { withTempDir } from "./helpers.ts";
import { runAgent, scaffoldEngine } from "./engine_helpers.ts";

Deno.test("engine guidelines: compiles agent files and links skills under noglob", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Precondition: the scaffold ships the bundled skills and a guideline source.
    assert(
      await exists(join(dir, ".ai/skills/handoff-worktree/SKILL.md")),
      "scaffold should include the bundled skills",
    );

    const r = await runAgent(dir, ["guidelines"]);
    assertEquals(r.code, 0, r.output);

    // Job 1: the configured agent file (claude_code → CLAUDE.md) was compiled.
    assert(
      await exists(join(dir, "CLAUDE.md")),
      `CLAUDE.md missing\n${r.output}`,
    );

    // Job 2: the skill symlink exists AND resolves to a real SKILL.md — exactly
    // what the agent reads to discover a project skill. Checking the path
    // *through* the link proves it is not dangling.
    assert(
      await exists(join(dir, ".claude/skills/handoff-worktree/SKILL.md")),
      `.claude/skills/handoff-worktree must resolve to a SKILL.md\n${r.output}`,
    );
    assertStringIncludes(r.stdout, "skills linked into .claude/skills/");
  });
});

Deno.test("engine guidelines: links skills even with no guideline sources (jobs are independent)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    // Remove every guideline source: job 1 has nothing to compile, but job 2
    // (skill links) must still run — a freshly-scaffolded project must not lose
    // skill discovery just because it has not authored guidelines yet.
    await Deno.remove(join(dir, ".ai/guidelines"), { recursive: true });

    const r = await runAgent(dir, ["guidelines"]);
    assertEquals(r.code, 0, r.output);
    assert(
      await exists(join(dir, ".claude/skills/handoff-worktree/SKILL.md")),
      `skills must link independently of guideline compilation\n${r.output}`,
    );
  });
});

Deno.test("engine guidelines: compiled agent files are world-readable (0644, not the 0600 mktemp leak)", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);

    const r = await runAgent(dir, ["guidelines"]);
    assertEquals(r.code, 0, r.output);

    // The compiled body is built in a mktemp file (mode 0600); without an
    // explicit normalise, `cp` carries that onto CLAUDE.md and the generated
    // file is owner-only — surprising for a readable source artifact. Assert the
    // group/other read bits survive, which is exactly the regression we fix.
    const mode = (await Deno.stat(join(dir, "CLAUDE.md"))).mode ?? 0;
    assertEquals(
      mode & 0o044,
      0o044,
      `CLAUDE.md must be group/other-readable; got mode ${
        (mode & 0o777).toString(8)
      }`,
    );
  });
});
