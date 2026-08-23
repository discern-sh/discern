/**
 * Reuse-canonical instructions modelling (Phase A, deliverable 2).
 *
 * Cursor and Copilot read the canonical `AGENTS.md` natively and need no
 * vendor-specific instruction file. The registry models that as
 * `instructionFile.reuseCanonical`: they do not write a duplicate file of their own,
 * but they still require the canonical file to exist for the configured set.
 *
 * These tests exercise that model with a synthetic provider set. The pure cores
 * (`emittedInstructionPaths`, the renderer's `agentFileContents`) take the instructions
 * entries as input, so the behaviour is pinned without an install.
 */

import { assert, assertEquals } from "@std/assert";
import {
  atImportPointer,
  emitsInstructionFile,
  emittedInstructionPaths,
  type InstructionFile,
} from "../src/lib/providers.ts";
import { agentFileContents } from "../src/engine/instruction_render.ts";
import { ignoreCovers } from "../src/lib/agent_gitignore.ts";
import { fromFileUrl, join } from "@std/path";
import { CONTEXT_LOADED_ARTIFACT } from "../src/shared/file_ownership.ts";
import { rebaseMarkdownLinks } from "../src/lib/markdown_links.ts";

/** The canonical full-body file (codex → AGENTS.md). */
const CANONICAL: InstructionFile = {
  path: "AGENTS.md",
  ownership: { generated: true },
  writtenArtifact: CONTEXT_LOADED_ARTIFACT,
  canonical: true,
};
/** A pointer mirror (claude_code → CLAUDE.md → @AGENTS.md). */
const POINTER: InstructionFile = {
  path: "CLAUDE.md",
  ownership: { generated: true },
  writtenArtifact: CONTEXT_LOADED_ARTIFACT,
  canonical: false,
  pointer: atImportPointer,
};
/** A SYNTHETIC reuse-canonical provider: reads AGENTS.md natively. */
const REUSE: InstructionFile = {
  path: "AGENTS.md",
  ownership: { generated: true },
  writtenArtifact: CONTEXT_LOADED_ARTIFACT,
  canonical: false,
  reuseCanonical: true,
};

/** A synthetic canonical provider whose full-body file is nested. */
const NESTED_CANONICAL: InstructionFile = {
  path: "config/agent/AGENTS.md",
  ownership: { generated: true },
  writtenArtifact: CONTEXT_LOADED_ARTIFACT,
  canonical: true,
};

Deno.test("emitsInstructionFile: false only for a reuse-canonical entry", () => {
  assertEquals(emitsInstructionFile(CANONICAL), true);
  assertEquals(emitsInstructionFile(POINTER), true);
  assertEquals(emitsInstructionFile(REUSE), false);
});

Deno.test("emittedInstructionPaths: a reuse-canonical entry adds no duplicate path", () => {
  // codex (AGENTS.md) + a reuse-canonical agent (also reads AGENTS.md) + claude
  // (CLAUDE.md). The reuse-canonical entry must not leak a second AGENTS.md.
  assertEquals(
    emittedInstructionPaths([CANONICAL, REUSE, POINTER]),
    ["AGENTS.md", "CLAUDE.md"],
  );
  // Order-independent and dedup holds whatever the position of the reuse entry.
  assertEquals(
    emittedInstructionPaths([REUSE, POINTER, CANONICAL]),
    ["CLAUDE.md", "AGENTS.md"],
  );
});

Deno.test("emittedInstructionPaths: a reuse-canonical-only set still emits the canonical", () => {
  assertEquals(emittedInstructionPaths([REUSE]), ["AGENTS.md"]);
  assertEquals(emittedInstructionPaths([REUSE, POINTER]), [
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

Deno.test("agentFileContents: a synthetic nested provider receives a body rendered for its own path", () => {
  const source = "[guide](./guide.md)\n";
  const files = agentFileContents(
    [NESTED_CANONICAL],
    (outputPath) =>
      rebaseMarkdownLinks(source, "discern/instructions.md", outputPath),
  );
  assertEquals(
    files.get(NESTED_CANONICAL.path),
    "[guide](../../discern/guide.md)\n",
  );
});

Deno.test("reuse-canonical: the read path is tracked — never ignored by the seed fragment", () => {
  // A reuse-canonical provider's `path` (the canonical it reads) is a compiled
  // instruction file, tracked by default so a bare clone carries it — an ignore
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
