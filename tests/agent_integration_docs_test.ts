/**
 * Guards that hold the integrations docs to the provider registry.
 *
 * Coverage: every supported agent (`AGENT_NAMES`, the registry the schema and
 * installer share) must have an integration doc — adding a provider without
 * documenting it fails the gate, driven off the registry so a new member
 * auto-enrols (ADR 0051).
 *
 * Signposting: a reuse-canonical (IDE-first) agent — Cursor, Copilot, and
 * Antigravity next — reads `AGENTS.md` natively and often runs with no CLI
 * binary on PATH, so PATH auto-detect can't find it. Its integration doc is the
 * compensating surface: it signposts the IDE-only user to configure the agent
 * explicitly. This guard drives off the reuse-canonical subset of the provider
 * registry (ADR 0031), so a new IDE-first agent red-lights until its doc
 * carries the signpost — the hand-listed {cursor, copilot} pair it replaces
 * would have shipped Antigravity invisible.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import { providerFor } from "../src/lib/providers.ts";
import { extractTitle } from "../src/lib/docs.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

/** The IDE-first agents (read the canonical file, emit no vendor file), derived
 * from the registry — the exact set that needs an explicit-config signpost. */
function reuseCanonicalAgents(): readonly string[] {
  return AGENT_NAMES.filter(
    (n) => providerFor(n)?.guidanceFile.reuseCanonical === true,
  );
}

/** Every integration doc, read once. Docs are tied back to registry entries by
 * CONTENT — the `# <label> integration` title for coverage, the explicit
 * `agents = ["<name>"]` config line for signposting — never by a
 * hand-maintained agent→filename map that could drift. */
async function integrationDocs(): Promise<
  Array<{ file: string; text: string }>
> {
  const dir = join(REPO_AUTHORED_PATHS.map, "60-agent-integrations");
  const docs: Array<{ file: string; text: string }> = [];
  for await (const entry of Deno.readDir(dir)) {
    if (
      entry.isFile && entry.name.endsWith(".md") && entry.name !== "README.md"
    ) {
      docs.push({
        file: entry.name,
        text: await Deno.readTextFile(join(dir, entry.name)),
      });
    }
  }
  return docs;
}

Deno.test("every supported agent provider has an integration doc", async () => {
  // The tie is the page's own title: every integration doc opens with
  // `# <label> integration`, and `label` comes from the provider registry — so
  // the check follows a provider rename and a new provider auto-enrols.
  const docs = await integrationDocs();
  for (const name of AGENT_NAMES) {
    const label = providerFor(name)?.label;
    assert(label !== undefined, `no provider registered for "${name}"`);
    assert(
      docs.some((d) => extractTitle(d.text) === `${label} integration`),
      `the provider registry supports "${name}" but no ${REPO_AUTHORED_PATHS.mapRel}/60-agent-integrations/ ` +
        `page documents it — add one titled "# ${label} integration" ` +
        `(mirror the existing provider pages)`,
    );
  }
});

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

  const docs = await integrationDocs();

  for (const name of agents) {
    const doc = docs.find((d) => d.text.includes(`agents = ["${name}"]`));
    assert(
      doc !== undefined,
      `no integration doc signposts IDE-only "${name}" users — a reuse-canonical agent ` +
        `whose CLI isn't on PATH is invisible to setup without a ${REPO_AUTHORED_PATHS.mapRel}/60-agent-integrations/ ` +
        `page carrying agents = ["${name}"]. Add one (mirror cursor.md / github-copilot.md).`,
    );
    for (
      const needle of [
        "\n## Using the IDE\n",
        "[project].agents",
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
