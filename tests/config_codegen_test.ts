import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import {
  configSectionNames,
  isJsonObject,
  recordConfigPaths,
  renderConfigDocSchemaJson,
  renderConfigReferenceDoc,
} from "../src/shared/config_codegen.ts";
import {
  DEFAULT_AGENTS,
  parseConfig,
  parseConfigOrThrow,
  resolveConfiguredAgents,
} from "../src/shared/config_schema.ts";
import { KNOWN_JOBS } from "../src/shared/capabilities.ts";
import { SOURCE_PATHS } from "../src/shared/paths_registry.ts";
import {
  CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  CONFIG_SCHEMA_ID,
  PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY,
} from "../src/shared/public_schemas.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../src/lib/version.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";

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
  assertEquals(schema.$id, CONFIG_SCHEMA_ID);
  assertEquals(
    schema[PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY],
    CONFIG_SCHEMA_COMPATIBILITY_POLICY,
  );
  // The document is strict (an editor flags a typo'd key).
  assertEquals(schema.additionalProperties, false);
});

Deno.test("the generated jobs object exposes known names and the custom table arm", () => {
  const schema = JSON.parse(renderConfigDocSchemaJson()) as {
    properties: { jobs: { allOf: Record<string, unknown>[] } };
  };
  const jobs = schema.properties.jobs;
  const named = jobs.allOf.find((arm) => isJsonObject(arm.properties));
  assert(named !== undefined);
  const properties = named.properties as Record<string, unknown>;
  // The fixed properties enumerate EXACTLY the known-name vocabulary, while
  // additionalProperties carries the stage-bearing custom table.
  assertEquals(
    Object.keys(properties).sort(),
    Object.keys(KNOWN_JOBS).sort(),
  );
  assertEquals(named.required, undefined);
  const custom = named.additionalProperties;
  assert(isJsonObject(custom));
  assertEquals(custom.required, ["stage", "run"]);
  const patterned = jobs.allOf.find((arm) => isJsonObject(arm.propertyNames));
  assert(
    patterned !== undefined,
    "job names must carry the shared key pattern",
  );
});

// ── docs config-reference ────────────────────────────────────────────────────

Deno.test("the configured map's config reference matches the generator (run `deno task codegen`)", async () => {
  const path = `${REPO_AUTHORED_PATHS.map}/70-reference/config-reference.md`;
  const committed = await Deno.readTextFile(path);
  assertEquals(
    committed,
    await canonicalGeneratedMarkdown(path, renderConfigReferenceDoc()),
    `${REPO_AUTHORED_PATHS.mapRel}/70-reference/config-reference.md is stale — run \`deno task codegen\``,
  );
});

Deno.test("the generated config reference carries the section's full frontmatter", () => {
  const doc = renderConfigReferenceDoc();
  assertStringIncludes(doc, "title: Config reference");
  assertStringIncludes(doc, "order: 20");
  assertStringIncludes(doc, "publish: true");
  assertStringIncludes(doc, "  - discern.toml");
  assertStringIncludes(doc, "  - worktree.resources.<name>.create");
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
  assert(doc.includes("numbers that can never get worse"));
  assert(doc.includes("isolated-worktree workflow"));
});

Deno.test("the reference's [guidance].agents row matches what the resolver actually does (no misleading [] default)", () => {
  // B43's docs half: the reference once printed `[]` as the default, which read as
  // "no agents by default" when the resolver actually emits the default pair —
  // and made the true "no agents" choice inexpressible. The key is now optional, so
  // the row must NOT advertise `[]` as its default, and its prose must document
  // both readings the resolver implements (omit → default pair, explicit [] → none).
  const doc = renderConfigReferenceDoc();
  const row = doc.split("\n").find((l) =>
    l.startsWith("| `agents`") && l.includes("CLAUDE.md")
  );
  assert(row !== undefined, "the [guidance].agents row should be present");
  // The default cell is `—` (no default), never a literal empty array.
  assert(
    !/\|\s*`\[\]`\s*\|/.test(row),
    `the agents row must not document a [] default: ${row}`,
  );
  // Prose documents the two distinct readings the resolver honors.
  assert(row.includes("OMIT"), row);
  assert(row.includes("empty list"), row);

  // And it is faithful: the resolver really does treat unset as the default pair
  // and explicit [] as no agents (the same behaviour the prose promises).
  assertEquals(resolveConfiguredAgents(parseConfigOrThrow("")), [
    ...DEFAULT_AGENTS,
  ]);
  assertEquals(
    resolveConfiguredAgents(parseConfigOrThrow("[guidance]\nagents = []\n")),
    [],
  );
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
    map_dir: SOURCE_PATHS.map.defaultPath,
    scopes_neutral: '"${map.dir}"',
    scopes_previewable: '"public/**"',
    kit_version: KIT_VERSION,
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

Deno.test("discern.toml.tmpl starts at byte zero with the public config schema id", async () => {
  const template = await Deno.readFile(
    new URL("../templates/discern.toml.tmpl", import.meta.url),
  );
  const marker = new TextEncoder().encode(`#:schema ${CONFIG_SCHEMA_ID}\n`);
  assertEquals(
    template.slice(0, marker.length),
    marker,
    "templates/discern.toml.tmpl must begin with the public config schema marker",
  );
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
// sections (checks / scopes / standards / worktree.resources) may diverge — those
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

/**
 * Owner-decided template sections: scaffold parity never fills them, and the
 * repo carries each only as the exact value the owner recorded. Changing one is
 * a consent change — amend the record here, deliberately, in its own commit.
 * (Jack, 2026-07-28: green docs-scope changes land without a conversation.)
 */
const ROOT_CONFIG_OWNER_DECISIONS: Record<string, unknown> = {
  acceptance: { pre_authorized: ["docs"] },
};

// Makes the "a new template key (like [worktree.setup].ensure) is forgotten in the
// repo's own config" class of drift impossible: it walks the keys the template
// actually ships and fails on any the root omits. Driven off the live template +
// schema, so a future fixed key auto-enrolls — no hand-kept list to maintain.
Deno.test("the repo's own discern.toml carries every fixed key the template ships (no drift)", async () => {
  const template = parseToml(await renderedTemplate());
  const root = parseToml(
    await Deno.readTextFile(new URL("../discern.toml", import.meta.url)),
  );
  for (
    const [section, decision] of Object.entries(ROOT_CONFIG_OWNER_DECISIONS)
  ) {
    assert(
      hasConfigPath(template, section),
      `owner-decision exception names no template section: ${section}`,
    );
    assertEquals(
      root[section],
      decision,
      `discern.toml [${section}] must match the recorded owner decision — ` +
        `a grant change is a consent change; amend the record in this test ` +
        `deliberately, in its own commit`,
    );
  }
  const missing = fixedKeyPaths(template).filter((p) => {
    const section = p.split(".")[0] ?? "";
    return !Object.hasOwn(ROOT_CONFIG_OWNER_DECISIONS, section) &&
      !hasConfigPath(root, p);
  });
  assertEquals(
    missing,
    [],
    `discern.toml has drifted from the template — missing key(s): ${
      missing.join(", ")
    }. Keep the root config at parity with templates/discern.toml.tmpl ` +
      `(own values/comments fine; extra checks/scopes/standards/resources allowed).`,
  );
});
