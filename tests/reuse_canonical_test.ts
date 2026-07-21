/**
 * Reuse-canonical guidance modelling (Phase A, deliverable 2).
 *
 * Cursor and Copilot read the canonical `AGENTS.md` natively and need no
 * vendor-specific guidance file. The registry models that as
 * `guidanceFile.reuseCanonical`: they do not write a duplicate file of their own,
 * but they still require the canonical file to exist for the configured set.
 *
 * These tests exercise that model with a synthetic provider set. The pure cores
 * (`emittedGuidancePaths`, the renderer's `agentFileContents`) take the guidance
 * entries as input, so the behaviour is pinned without an install.
 */

import { assert, assertEquals } from "@std/assert";
import {
  atImportPointer,
  emitsGuidanceFile,
  emittedGuidancePaths,
  type GuidanceFile,
} from "../src/lib/providers.ts";
import { agentFileContents } from "../src/engine/guidance_render.ts";
import { ignoreCovers } from "../src/lib/agent_gitignore.ts";
import { fromFileUrl, join } from "@std/path";

/** The canonical full-body file (codex → AGENTS.md). */
const CANONICAL: GuidanceFile = {
  path: "AGENTS.md",
  ownership: { generated: true },
  canonical: true,
};
/** A pointer mirror (claude_code → CLAUDE.md → @AGENTS.md). */
const POINTER: GuidanceFile = {
  path: "CLAUDE.md",
  ownership: { generated: true },
  canonical: false,
  pointer: atImportPointer,
};
/** A SYNTHETIC reuse-canonical provider: reads AGENTS.md natively. */
const REUSE: GuidanceFile = {
  path: "AGENTS.md",
  ownership: { generated: true },
  canonical: false,
  reuseCanonical: true,
};

Deno.test("emitsGuidanceFile: false only for a reuse-canonical entry", () => {
  assertEquals(emitsGuidanceFile(CANONICAL), true);
  assertEquals(emitsGuidanceFile(POINTER), true);
  assertEquals(emitsGuidanceFile(REUSE), false);
});

Deno.test("emittedGuidancePaths: a reuse-canonical entry adds no duplicate path", () => {
  // codex (AGENTS.md) + a reuse-canonical agent (also reads AGENTS.md) + claude
  // (CLAUDE.md). The reuse-canonical entry must not leak a second AGENTS.md.
  assertEquals(
    emittedGuidancePaths([CANONICAL, REUSE, POINTER]),
    ["AGENTS.md", "CLAUDE.md"],
  );
  // Order-independent and dedup holds whatever the position of the reuse entry.
  assertEquals(
    emittedGuidancePaths([REUSE, POINTER, CANONICAL]),
    ["CLAUDE.md", "AGENTS.md"],
  );
});

Deno.test("emittedGuidancePaths: a reuse-canonical-only set still emits the canonical", () => {
  assertEquals(emittedGuidancePaths([REUSE]), ["AGENTS.md"]);
  assertEquals(emittedGuidancePaths([REUSE, POINTER]), [
    "AGENTS.md",
    "CLAUDE.md",
  ]);
});

Deno.test("agentFileContents: reuse-canonical adds no duplicate when canonical is present", () => {
  const body = "# the compiled body\nA rule.\n";
  const files = agentFileContents([CANONICAL, REUSE, POINTER], body);
  // Exactly two files written — the reuse-canonical agent contributes no duplicate
  // AGENTS.md write when the canonical provider already contributes it.
  assertEquals([...files.keys()].sort(), ["AGENTS.md", "CLAUDE.md"]);
  // The canonical holds the full body; the pointer imports it.
  assertEquals(files.get("AGENTS.md"), body);
  assertEquals(files.get("CLAUDE.md"), "@AGENTS.md\n");
});

Deno.test("agentFileContents: a reuse-canonical agent alone emits the canonical it reads", () => {
  const body = "# body\n";
  const files = agentFileContents([REUSE], body);
  assertEquals([...files.keys()], ["AGENTS.md"]);
  assertEquals(files.get("AGENTS.md"), body);
});

Deno.test("agentFileContents: reuse-canonical supplies the canonical for pointer companions", () => {
  const body = "# the compiled body\nA rule.\n";
  const files = agentFileContents([REUSE, POINTER], body);
  assertEquals([...files.keys()], ["AGENTS.md", "CLAUDE.md"]);
  assertEquals(files.get("AGENTS.md"), body);
  assertEquals(files.get("CLAUDE.md"), "@AGENTS.md\n");
});

Deno.test("reuse-canonical: the read path is tracked — never ignored by the seed fragment", () => {
  // A reuse-canonical provider's `path` (the canonical it reads) is a compiled
  // guidance file, tracked by default so a bare clone carries it — an ignore
  // rule for it would blind exactly the agents that read it natively.
  const repo = fromFileUrl(new URL("../", import.meta.url));
  const lines = Deno.readTextFileSync(
    join(repo, "templates", ".gitignore.fragment"),
  ).split("\n").map((l) => l.trim());
  assert(
    !ignoreCovers(lines, REUSE.path, false),
    `the canonical file ${REUSE.path} a reuse-canonical provider reads must stay trackable`,
  );
});
