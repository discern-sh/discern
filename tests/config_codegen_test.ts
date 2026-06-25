import { assert, assertEquals } from "@std/assert";
import {
  configSectionNames,
  renderConfigDocSchemaJson,
  renderConfigReferenceDoc,
} from "../src/shared/config_codegen.ts";
import { parseConfig } from "../src/shared/config_schema.ts";
import { SCHEMA_VERSION } from "../src/lib/version.ts";

// These prove the committed, shipped artifacts stay in lockstep with the canonical
// Zod schema (ADR 0026): a schema change that isn't regenerated (`deno task
// codegen`) fails here, in the gate's test stage — the drift guard.

Deno.test("schema/discern-config.schema.json matches the generator (run `deno task codegen`)", async () => {
  const committed = await Deno.readTextFile(
    new URL("../schema/discern-config.schema.json", import.meta.url),
  );
  assertEquals(
    committed,
    renderConfigDocSchemaJson(),
    "schema/discern-config.schema.json is stale — run `deno task codegen`",
  );
});

Deno.test("the generated editor schema fixes the two historical staleness bugs", () => {
  const json = renderConfigDocSchemaJson();
  const schema = JSON.parse(json) as Record<string, unknown>;
  // Bug 1: the agents enum must include gemini (KNOWN_AGENTS, not just two).
  assert(json.includes('"gemini"'), "agents enum must include gemini");
  // Bug 2: no reference to the abolished `.discern/config.toml` path anywhere.
  assert(
    !json.includes(".discern/config.toml"),
    "must not reference the abolished .discern/config.toml path",
  );
  assert(!json.includes(".discern"), "must not reference any .discern/ path");
  // The $id points at the root discern.toml schema, generated (not hand-typed).
  assert(String(schema.$id).endsWith("schema/discern-config.schema.json"));
  // The document is strict (an editor flags a typo'd key).
  assertEquals(schema.additionalProperties, false);
});

Deno.test("the generated capabilities object is closed and not all-required", () => {
  const schema = JSON.parse(renderConfigDocSchemaJson()) as {
    properties: { capabilities: Record<string, unknown> };
  };
  const caps = schema.properties.capabilities;
  // A closed set (no unknown capability) …
  assertEquals(caps.additionalProperties, false);
  // … but every entry is optional — a doc may fill just one capability.
  assertEquals(caps.required, undefined);
  assertEquals(
    Object.keys(caps.properties as Record<string, unknown>).sort(),
    ["build", "format", "lint", "test", "typecheck"],
  );
});

// ── docs config-reference ────────────────────────────────────────────────────

Deno.test("docs/10-installer/config-reference.md matches the generator (run `deno task codegen`)", async () => {
  const committed = await Deno.readTextFile(
    new URL("../docs/10-installer/config-reference.md", import.meta.url),
  );
  assertEquals(
    committed,
    renderConfigReferenceDoc(),
    "docs/10-installer/config-reference.md is stale — run `deno task codegen`",
  );
});

Deno.test("the docs reference documents every section, with its describe() prose", () => {
  const doc = renderConfigReferenceDoc();
  for (const section of configSectionNames()) {
    assert(
      doc.includes(`\`[${section}`),
      `config-reference should document the [${section}] section`,
    );
  }
  // a couple of describe() strings render verbatim (prose comes from the schema)
  assert(doc.includes("never-loosen"));
  assert(doc.includes("git-worktree workflow"));
});

// ── template ↔ schema drift guards (the template stays hand-authored, ADR 0005,
//    but cannot silently diverge from the schema) ──────────────────────────────

/** The shipped template with its tokens filled, as `discern init` renders it. */
async function renderedTemplate(): Promise<string> {
  let t = await Deno.readTextFile(
    new URL("../templates/discern.toml.tmpl", import.meta.url),
  );
  const fills: Record<string, string> = {
    project_slug: "demo",
    branch_prefix: "agent/",
    gotchas_doc: "",
    agents_array: '"claude_code", "codex"',
    scopes_neutral: '"docs/"',
    scopes_previewable: '"public/**"',
    kit_version: "1.0.0",
    project_name: "Demo",
  };
  for (const [k, v] of Object.entries(fills)) t = t.replaceAll(`{{${k}}}`, v);
  return t;
}

Deno.test("the shipped discern.toml.tmpl renders to a config that VALIDATES under the schema", async () => {
  const { config, issues } = parseConfig(await renderedTemplate());
  assertEquals(issues, [], "the template must produce a schema-valid config");
  assert(config !== undefined);
});

// `init` stamps the live SCHEMA_VERSION over the template's literal, so a stale
// literal is invisible at runtime — but the seed is a reference users read, and
// the literal had silently drifted (8 while the build was at 11). Bind it to the
// one source of truth so a future SCHEMA_VERSION bump that forgets the seed fails
// here instead of shipping a misleading number.
Deno.test("discern.toml.tmpl's [meta].schema_version tracks the live SCHEMA_VERSION", async () => {
  const { config } = parseConfig(await renderedTemplate());
  assertEquals(
    config?.meta.schema_version,
    SCHEMA_VERSION,
    "templates/discern.toml.tmpl [meta].schema_version is stale — bump it to match SCHEMA_VERSION in src/lib/version.ts",
  );
});

Deno.test("every schema section appears in discern.toml.tmpl (no silent section drift)", async () => {
  const t = await Deno.readTextFile(
    new URL("../templates/discern.toml.tmpl", import.meta.url),
  );
  for (const section of configSectionNames()) {
    // A section appears as a `[section]` header or a `[section.<name>]` table —
    // active or in a commented example/doc block.
    assert(
      t.includes(`[${section}]`) || t.includes(`[${section}.`),
      `discern.toml.tmpl should document the [${section}] section`,
    );
  }
});
