/**
 * Agent-agnosticism guard. discern is stack- AND agent-neutral: the only
 * Claude-specific paths it builds belong to the agent-integration FEATURES it
 * provides to end users — materializing skills into `.claude/skills/` and writing
 * the `.claude/settings.json` hooks (both in the installer/feature layer under
 * `src/lib` / `src/commands`). The stack-neutral ENGINE (`src/engine/**`) and the
 * GENERIC resource tests must NEVER build a path like `.claude/` — assuming it
 * exists, is gitignored, or stays the de-facto Claude config dir is exactly the
 * coupling discern forbids. This pins the invariant: it would have caught a
 * resource test that scratched markers under `.claude/`, and an orphan sweep that
 * hardcoded `.claude/worktrees`.
 *
 * It scans CODE only — comments are stripped first, so explaining the rule (or a
 * skills/settings feature) by NAME is fine; only constructing a `.claude` path is
 * a violation.
 */

import { assert } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, join, relative } from "@std/path";

const REPO = fromFileUrl(new URL("../", import.meta.url));

/** Source with block + line comments removed, so the scan sees code, not prose. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

Deno.test("the stack-neutral engine builds no agent-specific (.claude) path", async () => {
  const offenders: string[] = [];
  for await (
    const entry of walk(join(REPO, "src", "engine"), { exts: [".ts"] })
  ) {
    if (codeOnly(await Deno.readTextFile(entry.path)).includes(".claude")) {
      offenders.push(relative(REPO, entry.path));
    }
  }
  assert(
    offenders.length === 0,
    `the engine must be agent-agnostic, but these BUILD a \`.claude\` path: ${
      offenders.join(", ")
    }. An agent-specific path belongs in the feature layer (src/lib skills/settings), ` +
      `or is discovered from git — never hardcoded in the stack-neutral engine.`,
  );
});

Deno.test("the generic resource tests build no agent-specific (.claude) path", async () => {
  for (
    const rel of [
      "tests/worktree_resources_test.ts",
      "tests/engine_worktree_resources_test.ts",
    ]
  ) {
    assert(
      !codeOnly(await Deno.readTextFile(join(REPO, rel))).includes(".claude"),
      `${rel} must not build a \`.claude\` path — a resource test's markers/scratch ` +
        `belong in an external temp dir (a nested withTempDir), never an ` +
        `agent-specific path that merely happens to be gitignored.`,
    );
  }
});
