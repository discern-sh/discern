/**
 * Guards that hold the integrations docs to the provider registry.
 *
 * Coverage: every supported agent (`AGENT_NAMES`, the registry the schema and
 * installer share) must have an integration doc — adding a provider without
 * documenting it fails the gate, driven off the registry so a new member
 * auto-enrols (ADR 0051).
 *
 * Structure: the subtree contains exactly one leaf per provider, keeping every
 * vendor-specific instruction on that provider's integration page.
 *
 * Signposting: a reuse-canonical (IDE-first) agent reads `AGENTS.md` natively
 * and may run without its terminal-agent binary on PATH. Its integration doc
 * must explain either the provider-declared IDE installation signals setup can
 * see or the explicit configuration needed when it has none. This guard drives
 * off the provider registry, so a new IDE-first agent and a later detection
 * marker both update the documentation obligation automatically.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { AGENT_NAMES } from "../src/shared/config_schema.ts";
import {
  providerFor,
  renderProviderHookSeed,
  wiredMcp,
} from "../src/lib/providers.ts";
import { extractTitle } from "../src/lib/docs.ts";
import { REPO_AUTHORED_PATHS, REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";
import {
  mcpServerArgsForNativeAgent,
  NATIVE_MCP_TIMEOUT_POLICY,
} from "../src/shared/mcp_timeout_policy.ts";

/** The IDE-first agents (read the canonical file, emit no vendor file). */
function reuseCanonicalAgents(): readonly string[] {
  return AGENT_NAMES.filter(
    (n) => providerFor(n)?.instructionFile.reuseCanonical === true,
  );
}

/** Every integration doc, read once. Docs are tied back to registry entries by
 * CONTENT — the `# <label> integration` title for coverage, the explicit
 * `agents = ["<name>"]` config line for signposting — never by a
 * hand-maintained agent→filename map that could drift. */
async function integrationDocs(): Promise<
  Array<{ file: string; text: string }>
> {
  const docs: Array<{ file: string; text: string }> = [];
  const prefix = `${REPO_AUTHORED_PATHS.mapRel}/60-agent-integrations/`;
  for (
    const rel of await structuralGuardScope({
      guard: "tests/agent_integration_docs_test.ts#provider-integration-docs",
      universe: "tracked-markdown",
      narrow: {
        reason:
          "Provider documentation parity governs leaf pages in the configured agent-integrations section, excluding its section index.",
        include: (path) =>
          path.startsWith(prefix) && path !== `${prefix}README.md` &&
          !path.slice(prefix.length).includes("/"),
      },
    })
  ) {
    docs.push({
      file: rel.slice(prefix.length),
      text: await Deno.readTextFile(join(REPO_ROOT, rel)),
    });
  }
  return docs;
}

Deno.test("every supported agent provider has exactly one integration doc", async () => {
  // The tie is the page's own title: every integration doc opens with
  // `# <label> integration`, and `label` comes from the provider registry — so
  // the check follows a provider rename and a new provider auto-enrols.
  const docs = await integrationDocs();
  const expectedTitles = AGENT_NAMES.map((name) => {
    const label = providerFor(name)?.label;
    assert(label !== undefined, `no provider registered for "${name}"`);
    return `${label} integration`;
  });
  assertEquals(
    docs.map((doc) => extractTitle(doc.text)).sort(),
    expectedTitles.toSorted(),
    `${REPO_AUTHORED_PATHS.mapRel}/60-agent-integrations must contain one page per provider`,
  );
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

Deno.test("every wired provider's integration doc carries its MCP call profile", async () => {
  const docs = await integrationDocs();
  for (const name of AGENT_NAMES) {
    const provider = providerFor(name);
    assert(provider !== undefined, `no provider registered for "${name}"`);
    const mcp = wiredMcp(provider);
    if (mcp === undefined) {
      continue;
    }
    const doc = docs.find((candidate) =>
      extractTitle(candidate.text) === `${provider.label} integration`
    );
    assert(doc !== undefined, `no integration doc found for "${name}"`);

    const args = mcpServerArgsForNativeAgent(name, ["mcp"]);
    const profileFlag = args[1];
    assert(
      profileFlag !== undefined,
      `${name}: MCP policy produced no server profile flag`,
    );
    assertStringIncludes(
      doc.text,
      profileFlag,
      `${doc.file}: generated MCP example omits ${name}'s call profile`,
    );

    const policy = NATIVE_MCP_TIMEOUT_POLICY[name];
    if (policy.capability === "configurable") {
      const configuredLiteral = mcp.configFile.endsWith(".toml")
        ? `tool_timeout_sec = ${policy.configured_seconds}`
        : `"timeout": ${policy.configured_seconds * 1000}`;
      assertStringIncludes(
        doc.text,
        configuredLiteral,
        `${doc.file}: generated MCP example omits ${name}'s configured timeout`,
      );
    } else {
      assertStringIncludes(
        doc.text,
        `${policy.strictest_surface_seconds}-second`,
        `${doc.file}: surface-dependent profile omits its shortest client bound`,
      );
      assertStringIncludes(
        doc.text,
        `${policy.await_call_seconds}-second`,
        `${doc.file}: surface-dependent profile omits its await call bound`,
      );
    }
  }
});

Deno.test("every hooks provider documents the exact registry-rendered seed in the map and manual", async () => {
  const docs = await integrationDocs();
  const manual = await Deno.readTextFile(
    join(
      REPO_ROOT,
      "project/manual/30-reference/platforms-and-providers.md",
    ),
  );
  for (const name of AGENT_NAMES) {
    const provider = providerFor(name);
    assert(provider !== undefined, `no provider registered for "${name}"`);
    if (provider.hooks === undefined) continue;
    const doc = docs.find((candidate) =>
      extractTitle(candidate.text) === `${provider.label} integration`
    );
    assert(doc !== undefined, `no integration doc found for "${name}"`);
    const fenced = `\`\`\`json\n${
      renderProviderHookSeed(provider.hooks).trimEnd()
    }\n\`\`\``;
    assertStringIncludes(
      doc.text,
      fenced,
      `${doc.file}: hook JSON must equal the provider registry rendering`,
    );
    assertStringIncludes(
      manual,
      fenced,
      `platforms-and-providers.md: ${name} hook JSON must equal the registry rendering`,
    );
  }
});

Deno.test("Copilot documentation states both supported project MCP locations without an ignores claim", async () => {
  const docs = await integrationDocs();
  const copilot = docs.find((doc) =>
    extractTitle(doc.text) === "GitHub Copilot integration"
  );
  assert(copilot !== undefined);
  assertStringIncludes(copilot.text, "`.mcp.json`");
  assertStringIncludes(copilot.text, "`.github/mcp.json`");
  assert(
    !/ignores?\s+`.github\/mcp\.json`|does not use\s+that file/iu.test(
      copilot.text,
    ),
    "Copilot supports .github/mcp.json; discern chooses the shared root file",
  );
});
