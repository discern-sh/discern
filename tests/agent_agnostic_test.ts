/**
 * Agent-agnosticism guard. discern is stack- AND agent-neutral: the only
 * agent-specific paths it builds belong to the agent-integration FEATURES it
 * provides to end users — materializing skills into each agent's skills dir
 * (`.claude/skills/`, the cross-tool `.agents/skills/`) and writing the
 * `.claude/settings.json` hooks (all in the feature layer under `src/lib`, the
 * provider registry, / `src/commands`). The stack-neutral ENGINE (`src/engine/**`)
 * and the GENERIC resource tests must NEVER build such a path — assuming it exists,
 * is gitignored, or stays the de-facto agent config dir is exactly the coupling
 * discern forbids. This pins the invariant: it would have caught a resource test
 * that scratched markers under `.claude/`, and an orphan sweep that hardcoded
 * `.claude/worktrees`.
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

/**
 * Agent-specific path fragments the stack-neutral engine must never CONSTRUCT — the
 * directories discern's feature layer materializes into. `.agents/skills` (the
 * cross-tool skills standard for Codex/Gemini) is the `/skills` form deliberately,
 * so it never false-matches `config.guidance.agents`.
 */
const FORBIDDEN_AGENT_PATHS = [".claude", ".agents/skills"];

Deno.test("the stack-neutral engine builds no agent-specific (.claude) path", async () => {
  const offenders: string[] = [];
  for await (
    const entry of walk(join(REPO, "src", "engine"), { exts: [".ts"] })
  ) {
    const code = codeOnly(await Deno.readTextFile(entry.path));
    if (FORBIDDEN_AGENT_PATHS.some((p) => code.includes(p))) {
      offenders.push(relative(REPO, entry.path));
    }
  }
  assert(
    offenders.length === 0,
    `the engine must be agent-agnostic, but these BUILD an agent-specific path (one of ${
      FORBIDDEN_AGENT_PATHS.join(", ")
    }): ${
      offenders.join(", ")
    }. An agent-specific path belongs in the feature layer (src/lib skills/settings/` +
      `providers), or is discovered from git — never hardcoded in the stack-neutral engine.`,
  );
});

Deno.test("the generic resource tests and the shared engine harness build no agent-specific path", async () => {
  for (
    const rel of [
      "tests/worktree_resources_test.ts",
      "tests/engine_worktree_resources_test.ts",
      // The shared engine-test harness: `addWorktree` once placed test worktrees
      // under `.claude/worktrees`; it now resolves the default sibling through the
      // production `resolveWorktreeRoot`, so this guard keeps it agent-neutral.
      "tests/engine_helpers.ts",
    ]
  ) {
    const code = codeOnly(await Deno.readTextFile(join(REPO, rel)));
    const hit = FORBIDDEN_AGENT_PATHS.find((p) => code.includes(p));
    assert(
      hit === undefined,
      `${rel} must not build an agent-specific path (found \`${hit}\`) — a worktree/` +
        `resource test's checkouts and markers belong in a neutral location (a sibling ` +
        `or external temp dir), never an agent-specific path that merely happens to be ` +
        `gitignored.`,
    );
  }
});
