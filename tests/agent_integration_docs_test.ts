/**
 * Guards that hold the integrations docs to the provider registry.
 *
 * Coverage: every supported agent (`AGENT_NAMES`, the registry the schema and
 * installer share) must have an integration doc — adding a provider without
 * documenting it fails the gate, driven off the registry so a new member
 * auto-enrols (ADR 0051).
 *
 * Signposting: a reuse-canonical (IDE-first) agent reads `AGENTS.md` natively
 * and may run without its terminal-agent binary on PATH. Its integration doc
 * must explain either the provider-declared IDE installation signals setup can
 * see or the explicit configuration needed when it has none. This guard drives
 * off the provider registry, so a new IDE-first agent and a later detection
 * marker both update the documentation obligation automatically.
 */

import { assert, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import { providerFor } from "../src/lib/providers.ts";
import { extractTitle } from "../src/lib/docs.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";

/** The IDE-first agents (read the canonical file, emit no vendor file). */
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

Deno.test("every reuse-canonical integration doc explains its IDE setup detection path", async () => {
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
    const provider = providerFor(name);
    assert(provider !== undefined, `no provider registered for "${name}"`);
    const doc = docs.find((d) =>
      extractTitle(d.text) === `${provider.label} integration`
    );
    assert(
      doc !== undefined,
      `no integration doc signposts IDE-only "${name}" users`,
    );
    for (
      const needle of [
        "\n## Using the IDE\n",
        "[project].agents",
        "discern refresh",
      ]
    ) {
      assertStringIncludes(
        doc.text,
        needle,
        `${doc.file}: missing IDE-signpost element "${needle}" for ${name}`,
      );
    }
    const detectsIde =
      provider.setupPresence.additionalPathBinaries.length > 0 ||
      provider.setupPresence.filesystemMarkers.length > 0;
    if (detectsIde) {
      for (const needle of ["`discern setup`", "detect"]) {
        assertStringIncludes(
          doc.text,
          needle,
          `${doc.file}: setup can detect this IDE, so the page must explain "${needle}"`,
        );
      }
    } else {
      assertStringIncludes(
        doc.text,
        `agents = ["${name}"]`,
        `${doc.file}: setup has no IDE installation signal for ${name}, so the page must carry explicit config`,
      );
    }
  }
});

Deno.test("every provider's human setup advice has provider-specific documentation", async () => {
  const docs = await integrationDocs();
  let advisedProviders = 0;
  for (const name of AGENT_NAMES) {
    const provider = providerFor(name);
    assert(provider !== undefined, `no provider registered for "${name}"`);
    const advice = provider.humanSetupAdvice;
    if (advice === undefined) {
      continue;
    }
    advisedProviders++;
    assert(
      advice.documentationTopics.length > 0,
      `${name}: human setup advice declares no documentation topics`,
    );
    const doc = docs.find((candidate) =>
      extractTitle(candidate.text) === advice.documentationTitle
    );
    assert(
      doc !== undefined,
      `no provider-specific setup doc titled "${advice.documentationTitle}" ` +
        `found for "${name}"`,
    );
    for (const topic of advice.documentationTopics) {
      assertStringIncludes(
        doc.text,
        topic,
        `${doc.file}: human setup advice requires documentation topic "${topic}"`,
      );
    }
  }
  assert(
    advisedProviders > 0,
    "expected at least one provider to declare human setup advice",
  );
});
