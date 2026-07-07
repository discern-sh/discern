import { assert, assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import {
  configSectionNames,
  isJsonObject,
  recordConfigPaths,
  renderConfigDocSchemaJson,
  renderConfigReferenceDoc,
} from "../src/shared/config_codegen.ts";
import { parseConfig } from "../src/shared/config_schema.ts";
import { KNOWN_CAPABILITIES } from "../src/shared/capabilities.ts";
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
  // The generated object closes over EXACTLY the known capability vocabulary —
  // derived from KNOWN_CAPABILITIES, not a hand-copied list, so a new capability
  // enrolls here automatically.
  assertEquals(
    Object.keys(caps.properties as Record<string, unknown>).sort(),
    Object.keys(KNOWN_CAPABILITIES).sort(),
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
  assert(doc.includes("isolated-worktree workflow"));
});

// ── template ↔ schema drift guards (the template stays hand-authored, ADR 0005,
//    but cannot silently diverge from the schema) ──────────────────────────────

/** The shipped template with its tokens filled, as `discern setup` renders it. */
async function renderedTemplate(): Promise<string> {
  let t = await Deno.readTextFile(
    new URL("../templates/discern.toml.tmpl", import.meta.url),
  );
  const fills: Record<string, string> = {
    project_slug: "demo",
    branch_prefix: "agent/",
    gotchas_doc: "",
    agents_array: '"claude_code", "codex"',
    docs_dir: "docs/",
    scopes_neutral: '"${docs.dir}"',
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

// `setup` stamps the live SCHEMA_VERSION over the template's literal, so a stale
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

// ── root discern.toml ↔ template parity ───────────────────────────────────────
// The repo runs on its own harness, so its root `discern.toml` doubles as a LIVE
// EXAMPLE of the shipped template — the first config a visitor reads on GitHub. It
// must therefore carry every FIXED key the template ships (its own values and
// comments, plus extras like the project's real capabilities). Only the record
// sections (checks / scopes / ratchets / worktree.resources) may diverge — those
// are the per-project customization zone.

/** The dotted paths of every FIXED scalar/array/table key literally written in a
 * parsed config `obj`, skipping the record sub-trees (the customizable "extras"
 * zone). Raw-parsed, NOT schema-defaulted: it reflects the keys a file actually
 * writes, so the comparison is template-shape ⊆ root-shape, not schema ⊆ root. */
function fixedKeyPaths(obj: unknown): string[] {
  const records = recordConfigPaths();
  const underRecord = (p: string): boolean =>
    records.some((r) => p === r || p.startsWith(`${r}.`));
  const walk = (node: unknown, prefix: string): string[] => {
    if (!isJsonObject(node)) {
      return [];
    }
    const out: string[] = [];
    for (const [key, val] of Object.entries(node)) {
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (underRecord(path)) {
        continue;
      }
      out.push(path, ...walk(val, path));
    }
    return out;
  };
  return walk(obj, "");
}

/** Whether a dotted path resolves to a present key in a parsed config object. */
function hasConfigPath(obj: unknown, path: string): boolean {
  let node: unknown = obj;
  for (const seg of path.split(".")) {
    if (!isJsonObject(node) || !Object.hasOwn(node, seg)) {
      return false;
    }
    node = node[seg];
  }
  return true;
}

// Makes the "a new template key (like [worktree.setup].ensure) is forgotten in the
// repo's own config" class of drift impossible: it walks the keys the template
// actually ships and fails on any the root omits. Driven off the live template +
// schema, so a future fixed key auto-enrolls — no hand-kept list to maintain.
Deno.test("the repo's own discern.toml carries every fixed key the template ships (no drift)", async () => {
  const template = parseToml(await renderedTemplate());
  const root = parseToml(
    await Deno.readTextFile(new URL("../discern.toml", import.meta.url)),
  );
  const missing = fixedKeyPaths(template).filter((p) =>
    !hasConfigPath(root, p)
  );
  assertEquals(
    missing,
    [],
    `discern.toml has drifted from the template — missing key(s): ${
      missing.join(", ")
    }. Keep the root config at parity with templates/discern.toml.tmpl ` +
      `(own values/comments fine; extra checks/scopes/ratchets/resources allowed).`,
  );
});
