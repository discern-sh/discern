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
import { gitInit } from "./engine_helpers.ts";

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

Deno.test("an ancestor wildcard covers a NESTED guidance file too (no redundant rule)", () => {
  // File-coverage is ancestor-aware (symmetric with dir-coverage): `/.cursor/*`
  // already ignores a nested guidance file `.cursor/rules.md`, so nothing is added.
  const existing = "/.cursor/*\n";
  const artifacts = { guidanceFiles: [".cursor/rules.md"], skillsDirs: [] };
  assertEquals(reconcileAgentIgnores(existing, artifacts).added, []);
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

Deno.test("ensureAgentArtifactsIgnored: respects a deliberately git-tracked guidance file", async () => {
  await withTempDir(async (root) => {
    // ADR 0034 makes tracking a guidance file a per-project choice. A repo that
    // commits AGENTS.md (e.g. to render on its forge) and does NOT ignore it must not
    // have the ignore silently re-added on upgrade — but the untracked ones still get it.
    await Deno.writeTextFile(join(root, "AGENTS.md"), "tracked on purpose\n");
    await Deno.writeTextFile(join(root, ".gitignore"), "node_modules/\n");
    await gitInit(root); // commits AGENTS.md + .gitignore on main

    const added = await ensureAgentArtifactsIgnored(root);
    assert(
      !added.includes("/AGENTS.md"),
      `tracked AGENTS.md must not be re-ignored; added=${added.join(",")}`,
    );
    // The other (untracked) guidance files are still ignored — the guard is per-file.
    assert(
      added.includes("/CLAUDE.md"),
      `untracked CLAUDE.md should still be ignored; added=${added.join(",")}`,
    );
    assert(
      !(await Deno.readTextFile(join(root, ".gitignore"))).includes(
        "/AGENTS.md",
      ),
    );
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
