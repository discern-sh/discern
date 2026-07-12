/**
 * Guards for provider docs that compensate for intentionally conservative
 * PATH-only setup detection.
 *
 * A reuse-canonical (IDE-first) agent — Cursor, Copilot, and Antigravity next —
 * reads `AGENTS.md` natively and often runs with no CLI binary on PATH, so PATH
 * auto-detect can't find it. Its integration doc is the compensating surface: it
 * signposts the IDE-only user to configure the agent explicitly. This guard drives
 * off the reuse-canonical subset of the provider registry (ADR 0031), so a new
 * IDE-first agent red-lights until its doc carries the signpost — the hand-listed
 * {cursor, copilot} pair it replaces would have shipped Antigravity invisible.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import { providerFor } from "../src/lib/providers.ts";

/** The IDE-first agents (read the canonical file, emit no vendor file), derived
 * from the registry — the exact set that needs an explicit-config signpost. */
function reuseCanonicalAgents(): readonly string[] {
  return AGENT_NAMES.filter(
    (n) => providerFor(n)?.guidanceFile.reuseCanonical === true,
  );
}

Deno.test("every reuse-canonical agent's integration doc signposts IDE-only users to explicit config", async () => {
  const agents = reuseCanonicalAgents();
  // The set is registry-derived, but sanity-check it isn't empty (a refactor that
  // dropped reuseCanonical would otherwise make this guard vacuously pass).
  assert(
    agents.length >= 2,
    `expected the reuse-canonical set to include at least cursor + copilot, got: ${
      agents.join(", ")
    }`,
  );

  // Read every integration doc once; each agent's doc is the one that configures it
  // explicitly (`agents = ["<name>"]`), tying the doc to the registry name — no
  // hand-maintained agent→filename map to drift.
  const dir = new URL("../map/60-agent-integrations/", import.meta.url);
  const docs: Array<{ file: string; text: string }> = [];
  for await (const entry of Deno.readDir(dir)) {
    if (
      entry.isFile && entry.name.endsWith(".md") && entry.name !== "README.md"
    ) {
      docs.push({
        file: entry.name,
        text: await Deno.readTextFile(new URL(entry.name, dir)),
      });
    }
  }

  for (const name of agents) {
    const doc = docs.find((d) => d.text.includes(`agents = ["${name}"]`));
    assert(
      doc !== undefined,
      `no integration doc signposts IDE-only "${name}" users — a reuse-canonical agent ` +
        `whose CLI isn't on PATH is invisible to setup without a map/60-agent-integrations/ ` +
        `page carrying agents = ["${name}"]. Add one (mirror cursor.md / github-copilot.md).`,
    );
    for (
      const needle of [
        "Using the IDE, not the CLI?",
        "[guidance].agents",
        "discern refresh",
        "IDE marker detection",
      ]
    ) {
      assertStringIncludes(
        doc.text,
        needle,
        `${doc.file}: missing IDE-signpost element "${needle}" for ${name}`,
      );
    }
  }
});
