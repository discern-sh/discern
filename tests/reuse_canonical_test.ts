/**
 * Reuse-canonical guidance modelling (Phase A, deliverable 2).
 *
 * Some agents (Cursor, Copilot, Antigravity — added in later plans) read the
 * canonical `AGENTS.md` natively and need NO file of their own. The registry models
 * that as `guidanceFile.reuseCanonical`, and every emit site / aggregator gates on
 * {@link emitsGuidanceFile}, so such a provider is written and counted exactly once
 * (by the canonical provider), never duplicated.
 *
 * No real reuse-canonical vendor exists yet, so these exercise the machinery with a
 * SYNTHETIC provider set — the pure cores (`emittedGuidancePaths`, the renderer's
 * `agentFileContents`) take the guidance entries as input, so a synthetic set proves
 * the behaviour without an install.
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
const CANONICAL: GuidanceFile = { path: "AGENTS.md", canonical: true };
/** A pointer mirror (claude_code → CLAUDE.md → @AGENTS.md). */
const POINTER: GuidanceFile = {
  path: "CLAUDE.md",
  canonical: false,
  pointer: atImportPointer,
};
/** A SYNTHETIC reuse-canonical provider: reads AGENTS.md natively, emits nothing. */
const REUSE: GuidanceFile = {
  path: "AGENTS.md",
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
  // (CLAUDE.md). The reuse-canonical entry must NOT leak a second AGENTS.md.
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

Deno.test("agentFileContents: reuse-canonical emits no file; the others are correct", () => {
  const body = "# the compiled body\nA rule.\n";
  const files = agentFileContents([CANONICAL, REUSE, POINTER], body);
  // Exactly two files written — the reuse-canonical agent contributes nothing
  // (no duplicate AGENTS.md write).
  assertEquals([...files.keys()].sort(), ["AGENTS.md", "CLAUDE.md"]);
  // The canonical holds the full body; the pointer imports it.
  assertEquals(files.get("AGENTS.md"), body);
  assertEquals(files.get("CLAUDE.md"), "@AGENTS.md\n");
});

Deno.test("agentFileContents: a reuse-canonical agent alone (no canonical configured) emits nothing", () => {
  // Defensive: if only the reuse-canonical agent is configured, there is no
  // canonical file to point at, so nothing is emitted — it can't fabricate one.
  const files = agentFileContents([REUSE], "# body\n");
  assertEquals(files.size, 0);
});

Deno.test("reuse-canonical: the read path is still gitignore-covered by the seed fragment", () => {
  // A reuse-canonical provider emits nothing, but its `path` (the canonical it
  // reads) must remain a covered build artifact — it is, because the canonical
  // provider contributes that same path to the seed fragment.
  const repo = fromFileUrl(new URL("../", import.meta.url));
  const lines = Deno.readTextFileSync(
    join(repo, "templates", ".gitignore.fragment"),
  ).split("\n").map((l) => l.trim());
  assert(
    ignoreCovers(lines, REUSE.path, false),
    `the canonical file ${REUSE.path} a reuse-canonical provider reads must be gitignored`,
  );
});
