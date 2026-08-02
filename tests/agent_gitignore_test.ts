/**
 * `.gitignore` convergence for the discern-owned block. The shipped fragment is
 * the prose source; the reconciler owns exactly one delimited block, absorbs
 * legacy discern-owned fragments/rules, and derives agent artifacts from the
 * provider registry so setup and upgrade cannot drift apart.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import {
  canonicalDiscernGitignoreBlock,
  DISCERN_GITIGNORE_BEGIN,
  DISCERN_GITIGNORE_END,
  ensureDiscernGitignoreBlock,
  ignoreCovers,
  reconcileDiscernGitignore,
  trackedDiscernIgnoredArtifacts,
} from "../src/lib/agent_gitignore.ts";
import { withTempDir } from "./helpers.ts";
import { git, gitInit } from "./engine_helpers.ts";

const REPO = join(dirname(fromFileUrl(import.meta.url)), "..");
const FRAGMENT = await Deno.readTextFile(
  join(REPO, "templates", ".gitignore.fragment"),
);

Deno.test("the .claude/* wildcard covers .claude/skills (no redundant rule added)", () => {
  // Only the wildcard, no explicit /.claude/skills/ — must still count as covered.
  const existing =
    "/AGENTS.md\n/CLAUDE.md\n/GEMINI.md\n/.claude/*\n/.agents/skills/\n";
  const lines = existing.split("\n").map((line) => line.trim());
  assert(ignoreCovers(lines, ".claude/skills", true));
});

Deno.test("an ancestor wildcard covers a NESTED guidance file too (no redundant rule)", () => {
  // File-coverage is ancestor-aware (symmetric with dir-coverage): `/.cursor/*`
  // already ignores a nested guidance file `.cursor/rules.md`, so nothing is added.
  const existing = "/.cursor/*\n";
  const lines = existing.split("\n").map((line) => line.trim());
  assert(ignoreCovers(lines, ".cursor/rules.md", false));
});

Deno.test("canonical block auto-includes a hypothetical new agent's IGNORED artifacts only", () => {
  // Simulate a registry that grew another agent: its materialized dir and local
  // state widen into the block; its compiled guidance file — tracked by
  // default — never does.
  const fragment =
    `${DISCERN_GITIGNORE_BEGIN}\n/.agents/skills/\n${DISCERN_GITIGNORE_END}\n`;
  const artifacts = {
    guidanceFiles: ["AGENTS.md", "CURSOR.md"],
    materializedDirs: [".agents/skills", ".cursor/skills"],
    localStateFiles: [".cursor/settings.local.json"],
  };
  const block = canonicalDiscernGitignoreBlock(fragment, artifacts);
  assertStringIncludes(block, "/.cursor/skills/");
  assertStringIncludes(block, "/.cursor/settings.local.json");
  assert(!block.includes("/CURSOR.md"), block);
  assert(!block.includes("/AGENTS.md"), block);
});

Deno.test("an install already carrying the canonical block is an untouched no-op", () => {
  const existing = [
    "node_modules/",
    "",
    canonicalDiscernGitignoreBlock(FRAGMENT).trimEnd(),
    "",
    "coverage/",
    "",
  ].join("\n");
  const result = reconcileDiscernGitignore(existing, FRAGMENT);
  assertEquals(result.operations, []);
  assertEquals(result.text, existing);
});

Deno.test("the pasted messy legacy sample normalizes to one current block plus user macOS rules", () => {
  const messy = [
    DISCERN_GITIGNORE_BEGIN,
    "...",
    "/AGENTS.md",
    "/CLAUDE.md",
    "...",
    "/.agents/skills/",
    "# Per-branch work evidence captured by the gate (runtime store, not source).",
    "",
    "# --- macOS ---",
    ".DS_Store",
    "**/.DS_Store",
    "",
    "# discern: materialized/compiled artifacts (re-published on upgrade)",
    "",
    "# discern: generated/ephemeral artifacts",
    "/GEMINI.md",
    "",
  ].join("\n");

  const result = reconcileDiscernGitignore(messy, FRAGMENT);
  assert(result.text.startsWith(canonicalDiscernGitignoreBlock(FRAGMENT)));
  assertStringIncludes(
    result.text,
    `${DISCERN_GITIGNORE_END}\n\n# --- macOS ---\n.DS_Store\n**/.DS_Store`,
  );
  assertOneDiscernBlock(result.text);
  assert(!/^# discern:/m.test(result.text), result.text);
});

Deno.test("user lines before and after a legacy block are preserved", () => {
  const existing = [
    "build/",
    "",
    DISCERN_GITIGNORE_BEGIN,
    "/CLAUDE.md",
    "",
    "# Project-owned ignores",
    "coverage/",
    "!/AGENTS.md",
    "",
  ].join("\n");

  const result = reconcileDiscernGitignore(existing, FRAGMENT);
  assertStringIncludes(
    result.text,
    `build/\n\n${canonicalDiscernGitignoreBlock(FRAGMENT)}`,
  );
  assertStringIncludes(
    result.text,
    `${DISCERN_GITIGNORE_END}\n\n# Project-owned ignores\ncoverage/\n!/AGENTS.md\n`,
  );
});

Deno.test("scattered legacy discern rules are absorbed into the canonical block", () => {
  const existing = [
    "dist/",
    "/CLAUDE.md",
    "# Project-owned ignores",
    "/.agents/skills/",
    "coverage/",
    "",
  ].join("\n");

  const result = reconcileDiscernGitignore(existing, FRAGMENT);
  assertOneDiscernBlock(result.text);
  assertStringIncludes(result.text, "dist/");
  assertStringIncludes(result.text, "# Project-owned ignores\ncoverage/");
  const afterBlock = result.text.slice(
    result.text.indexOf(DISCERN_GITIGNORE_END) + DISCERN_GITIGNORE_END.length,
  );
  assert(!afterBlock.includes("/CLAUDE.md"), result.text);
  assert(!afterBlock.includes("/.agents/skills/"), result.text);
});

Deno.test("reconcile narrows a previous install's over-wide block to enumerated ownership", () => {
  // The block earlier versions shipped ignored the compiled guidance files and
  // wildcarded /.claude/*. Reconcile must rewrite it to the narrow form so the
  // previously ignored guidance files become trackable, with user rules intact.
  const legacyBlock = [
    DISCERN_GITIGNORE_BEGIN,
    "# These are discern's agent files, materialized skills,",
    "# and local provider state.",
    "/AGENTS.md",
    "/CLAUDE.md",
    "/GEMINI.md",
    "/.claude/*",
    "!/.claude/settings.json",
    "/.agents/skills/",
    DISCERN_GITIGNORE_END,
  ].join("\n");
  const existing = `dist/\n\n${legacyBlock}\n\ncoverage/\n`;

  const result = reconcileDiscernGitignore(existing, FRAGMENT);
  assertStringIncludes(result.text, canonicalDiscernGitignoreBlock(FRAGMENT));
  assert(!result.text.includes("/AGENTS.md"), result.text);
  assert(!result.text.includes("/CLAUDE.md"), result.text);
  assert(!result.text.includes("/GEMINI.md"), result.text);
  assert(!result.text.includes("/.claude/*"), result.text);
  assertOneDiscernBlock(result.text);
  assertStringIncludes(result.text, "dist/");
  assertStringIncludes(result.text, "coverage/");
});

Deno.test("ensureDiscernGitignoreBlock: no .gitignore creates the canonical block", async () => {
  await withTempDir(async (root) => {
    const result = await ensureDiscernGitignoreBlock(root);
    assertEquals(result.templateAvailable, true);
    assert(result.operations.length > 0);
    assertEquals(
      await Deno.readTextFile(join(root, ".gitignore")),
      canonicalDiscernGitignoreBlock(FRAGMENT),
    );
  });
});

Deno.test("trackedDiscernIgnoredArtifacts flags forced materialized/local paths — never a user's or guidance file", async () => {
  await withTempDir(async (root) => {
    await Deno.writeTextFile(join(root, ".gitignore"), "node_modules/\n");
    await ensureDiscernGitignoreBlock(root);
    await Deno.mkdir(join(root, ".claude"));
    await Deno.mkdir(join(root, ".claude", "skills", "x"), { recursive: true });
    await Deno.mkdir(join(root, ".claude", "commands"), { recursive: true });
    // Tracked by design: the compiled guidance files, the co-managed settings,
    // and a user's own slash command under .claude/ — none may be flagged.
    await Deno.writeTextFile(join(root, "AGENTS.md"), "compiled\n");
    await Deno.writeTextFile(join(root, "CLAUDE.md"), "@AGENTS.md\n");
    await Deno.writeTextFile(join(root, ".claude", "settings.json"), "{}\n");
    await Deno.writeTextFile(
      join(root, ".claude", "commands", "x.md"),
      "a user's own slash command\n",
    );
    // Forced into the index despite the block: machine-local state and a
    // materialized skills file — both must be flagged.
    await Deno.writeTextFile(
      join(root, ".claude", "settings.local.json"),
      "{}\n",
    );
    await Deno.writeTextFile(
      join(root, ".claude", "skills", "x", "SKILL.md"),
      "materialized\n",
    );
    await gitInit(root);
    await git(root, "add", "AGENTS.md", "CLAUDE.md");
    await git(root, "add", ".claude/settings.json", ".claude/commands/x.md");
    await git(root, "add", "-f", ".claude/settings.local.json");
    await git(root, "add", "-f", ".claude/skills/x/SKILL.md");

    const tracked = await trackedDiscernIgnoredArtifacts(root);
    assertEquals(tracked.paths.sort(), [
      ".claude/settings.local.json",
      ".claude/skills/x/SKILL.md",
    ]);
    assertEquals(tracked.repairTargets.sort(), [
      ".claude/settings.local.json",
      ".claude/skills",
    ]);
  });
});

/** Require exactly one opening and closing marker around Discern's managed ignore block. */
function assertOneDiscernBlock(text: string): void {
  assertEquals(text.match(new RegExp(DISCERN_GITIGNORE_BEGIN, "g"))?.length, 1);
  assertEquals(text.match(new RegExp(DISCERN_GITIGNORE_END, "g"))?.length, 1);
}
