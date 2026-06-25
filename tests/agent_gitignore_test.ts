/**
 * Registry-driven `.gitignore` convergence (`reconcileAgentIgnores` /
 * `ensureAgentArtifactsIgnored`): the forward-looking complement to the seed
 * fragment, ensuring an EXISTING install ignores every current-registry agent
 * artifact on upgrade — additively, idempotently, and without a per-agent migration.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  ensureAgentArtifactsIgnored,
  reconcileAgentIgnores,
} from "../src/lib/agent_gitignore.ts";
import { agentArtifactPaths } from "../src/lib/providers.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("an install already covering every artifact is an untouched no-op", () => {
  // The seed fragment's actual shape: guidance files + the .claude/* wildcard +
  // the explicit .agents/skills/ rule. Nothing should be added.
  const existing = [
    "node_modules/",
    "/AGENTS.md",
    "/CLAUDE.md",
    "/GEMINI.md",
    "/.claude/*",
    "!/.claude/settings.json",
    "/.agents/skills/",
    "",
  ].join("\n");
  const { text, added } = reconcileAgentIgnores(existing);
  assertEquals(added, []);
  assertEquals(text, existing); // byte-identical — never reorders or rewrites
});

Deno.test("the .claude/* wildcard covers .claude/skills (no redundant rule added)", () => {
  // Only the wildcard, no explicit /.claude/skills/ — must still count as covered.
  const existing =
    "/AGENTS.md\n/CLAUDE.md\n/GEMINI.md\n/.claude/*\n/.agents/skills/\n";
  assertEquals(reconcileAgentIgnores(existing).added, []);
});

Deno.test("a hypothetical new agent's artifacts are appended (the convergence guarantee)", () => {
  // Simulate a registry that grew a 4th agent with a brand-new file + skills dir.
  const existing = "/AGENTS.md\n/CLAUDE.md\n/.claude/*\n/.agents/skills/\n";
  const artifacts = {
    guidanceFiles: ["AGENTS.md", "CLAUDE.md", "CURSOR.md"],
    skillsDirs: [".claude/skills", ".agents/skills", ".cursor/skills"],
  };
  const { text, added } = reconcileAgentIgnores(existing, artifacts);
  assertEquals(added, ["/CURSOR.md", "/.cursor/skills/"]);
  assert(text.includes("/CURSOR.md"));
  assert(text.includes("/.cursor/skills/"));
  // Re-running is idempotent: the second pass finds them covered.
  assertEquals(reconcileAgentIgnores(text, artifacts).added, []);
});

Deno.test("reconcile defaults to the live registry and finds the real fragment current", () => {
  // The real registry's artifacts against a fragment that already lists them.
  const { guidanceFiles, skillsDirs } = agentArtifactPaths();
  const lines = [
    ...guidanceFiles.map((f) => `/${f}`),
    "/.claude/*",
    ...skillsDirs.filter((d) => !d.startsWith(".claude/")).map((d) => `/${d}/`),
  ];
  assertEquals(reconcileAgentIgnores(`${lines.join("\n")}\n`).added, []);
});

Deno.test("ensureAgentArtifactsIgnored: no .gitignore → nothing to amend", async () => {
  await withTempDir(async (root) => {
    assertEquals(await ensureAgentArtifactsIgnored(root), []);
  });
});

Deno.test("ensureAgentArtifactsIgnored: backfills a missing artifact and persists it", async () => {
  await withTempDir(async (root) => {
    const path = join(root, ".gitignore");
    // An install missing every agent rule (e.g. a hand-rolled .gitignore).
    await Deno.writeTextFile(path, "node_modules/\n");
    const added = await ensureAgentArtifactsIgnored(root);
    assert(added.length > 0, "should have backfilled the registry's artifacts");
    const after = await Deno.readTextFile(path);
    for (const f of agentArtifactPaths().guidanceFiles) {
      assert(after.includes(`/${f}`), `missing ${f}`);
    }
    // Idempotent: a second run is a no-op.
    assertEquals(await ensureAgentArtifactsIgnored(root), []);
  });
});
