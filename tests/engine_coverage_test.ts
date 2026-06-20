/**
 * Coverage guard — every PUBLIC engine recipe must be exercised by a test.
 *
 * A recipe is "public" if it carries a `# desc:` line (it shows up as a verb in
 * `agent --help`). This test enumerates them from templates/.icculus/engine/ and
 * fails if any is neither invoked directly by a `runAgent(...)` call in the
 * engine suite nor listed in COVERED_TRANSITIVELY below.
 *
 * It is the structural backstop for the class of regression that hid the
 * `guidelines` noglob break: a recipe with zero execution coverage breaking
 * silently because nothing — not even `finish` — runs it. When you add a recipe,
 * give it a direct test (see engine_worktree_test.ts) or, if `finish` already
 * drives it, add it to COVERED_TRANSITIVELY with a note. The list only shrinks.
 */

import { assertEquals } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { walk } from "@std/fs";

const REPO_ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const ENGINE = join(REPO_ROOT, "templates", ".icculus", "engine");
const TESTS = join(REPO_ROOT, "tests");

/**
 * Public recipes exercised only THROUGH `finish` (no direct runAgent verb),
 * mapped to where they are asserted. This set may shrink, never silently grow —
 * a recipe here that becomes directly tested is flagged for removal.
 */
const COVERED_TRANSITIVELY: Record<string, string> = {
  "changed-scopes": "driven by `finish`; asserted in engine_side_gates_test.ts",
};

/** Recipe file names carrying a `# desc:` line — i.e. the public verbs. */
async function publicRecipes(): Promise<string[]> {
  const names: string[] = [];
  for await (const e of walk(ENGINE, { includeDirs: false })) {
    if (/^# desc:/m.test(await Deno.readTextFile(e.path))) names.push(e.name);
  }
  return names.sort();
}

/** Recipe names invoked directly by a `runAgent(...)` call in the engine tests. */
async function directlyInvoked(): Promise<Set<string>> {
  const verbs = new Set<string>();
  for await (const e of walk(TESTS, { includeDirs: false })) {
    if (!/^engine_.*_test\.ts$/.test(e.name)) continue;
    if (e.name === "engine_coverage_test.ts") continue; // don't scan ourselves
    const text = await Deno.readTextFile(e.path);
    for (const m of text.matchAll(/runAgent\([\s\S]*?\[\s*"([^"]+)"/g)) {
      // The dispatcher maps a `:`-verb (worktree:exit) to a `-`-file name.
      verbs.add(m[1]!.replaceAll(":", "-"));
    }
  }
  return verbs;
}

Deno.test("every public engine recipe is exercised by a test", async () => {
  const recipes = await publicRecipes();
  const invoked = await directlyInvoked();

  const uncovered = recipes.filter(
    (r) => !invoked.has(r) && !(r in COVERED_TRANSITIVELY),
  );
  assertEquals(
    uncovered,
    [],
    "public recipes with no test coverage — add a direct test (see " +
      "engine_worktree_test.ts), or if `finish` drives it add it to " +
      `COVERED_TRANSITIVELY:\n  ${uncovered.join("\n  ")}`,
  );

  // Keep the transitive list honest: anything now directly tested must leave it.
  const stale = Object.keys(COVERED_TRANSITIVELY).filter((r) => invoked.has(r));
  assertEquals(
    stale,
    [],
    `now directly tested — remove from COVERED_TRANSITIVELY:\n  ${
      stale.join("\n  ")
    }`,
  );
});
