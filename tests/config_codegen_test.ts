/**
 * The committed config artifacts stay in lockstep with their generators: the
 * JSON Schemas and the generated reference pages must equal the codegen output
 * byte for byte, so a schema change that lands without `deno task codegen`
 * fails here, in the gate's test stage.
 *
 * The build stage guards the same fact from the other side: the
 * `[generated.codegen]` group (ADR 0247) reruns the generator on every full
 * gate and fails on drift. That redundancy is deliberate — this family names
 * the exact artifact and equality remedy and runs under bare `deno task test`,
 * while the build-stage attribution holds even paths no test asserts on. Do
 * not thin one side because the other exists.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { join } from "@std/path";
import { Ajv2020 } from "ajv-2020";
import {
  configSectionNames,
  isJsonObject,
  recordConfigPaths,
  renderConfigDocSchemaJson,
  renderConfigReferenceDoc,
  renderConfigSchemaJson,
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
  PUBLIC_SCHEMA_PUBLICATIONS,
  SETUP_CONFIG_SCHEMA_ID,
} from "../src/shared/public_schemas.ts";
import { withTempDir } from "./helpers.ts";
import { scaffoldEngine } from "./engine_helpers.ts";
import { KIT_VERSION, SCHEMA_VERSION } from "../src/lib/version.ts";
import {
  defaultDocumentationScopePaths,
  defaultDocumentationScopes,
  defaultInstructionScopePaths,
  defaultInstructionScopes,
} from "../src/lib/config.ts";
import { REPO_AUTHORED_PATHS } from "./repo_authored_paths.ts";
import { canonicalGeneratedMarkdown } from "./tidy_helpers.ts";
import { generatedArtifactMarkerBody } from "../src/shared/brand.ts";
import { ARTIFACT_PROVENANCE_SOURCES } from "../src/shared/file_ownership.ts";

/** Traverse a dotted config path through JSON Schema property nodes, asserting every segment exists. */
function schemaNodeAt(
  schema: Record<string, unknown>,
  dottedPath: string,
): Record<string, unknown> {
  let node = schema;
  for (const segment of dottedPath.split(".")) {
    const properties = node.properties;
    assert(isJsonObject(properties), `${dottedPath} has no properties`);
    const child = properties[segment];
    assert(isJsonObject(child), `${dottedPath} has no ${segment} schema`);
    node = child;
  }
  return node;
}

/** Expose the validator's full error set when a compatibility fixture is rejected. */
function assertSchemaAccepts(
  validate: ReturnType<Ajv2020["compile"]>,
  value: unknown,
): void {
  assert(
    validate(value),
    `schema rejected ${JSON.stringify(value)}:\n${
      JSON.stringify(validate.errors, null, 2)
    }`,
  );
}

// These prove the committed, shipped artifacts stay in lockstep with the canonical
// Zod schema (ADR 0026): a schema change that isn't regenerated (`deno task
// codegen`) fails here, in the gate's test stage — the drift guard.

Deno.test("schema/discern-config.schema.json matches the generator (run `deno task codegen`)", async () => {
  const committed = await Deno.readTextFile(
    new URL("../schema/discern-config.schema.json", import.meta.url),
  );
  assertEquals(
    committed,
    renderConfigSchemaJson(),
    "schema/discern-config.schema.json is stale — run `deno task codegen`",
  );
});

Deno.test("schema/discern-setup-config.schema.json matches the generator (run `deno task codegen`)", async () => {
  const committed = await Deno.readTextFile(
    new URL("../schema/discern-setup-config.schema.json", import.meta.url),
  );
  assertEquals(
    committed,
    renderConfigDocSchemaJson(),
    "schema/discern-setup-config.schema.json is stale — run `deno task codegen`",
  );
});

Deno.test("the generated config schemas fix the two historical staleness bugs", () => {
  const artifacts = [
    {
      name: "live config",
      json: renderConfigSchemaJson(),
      id: CONFIG_SCHEMA_ID,
    },
    {
      name: "setup config document",
      json: renderConfigDocSchemaJson(),
      id: SETUP_CONFIG_SCHEMA_ID,
    },
  ];
  for (const { name, json, id } of artifacts) {
    const schema = JSON.parse(json) as Record<string, unknown>;
    // Bug 2: no reference to the abolished `.discern/config.toml` path anywhere.
    assert(
      !json.includes(".discern"),
      `${name}: must not reference any .discern/ path`,
    );
    assertEquals(schema.$id, id, name);
    assertEquals(
      schema[PUBLIC_SCHEMA_COMPATIBILITY_POLICY_KEY],
      CONFIG_SCHEMA_COMPATIBILITY_POLICY,
      name,
    );
    // Both schemas are strict (an editor flags a typo'd key).
    assertEquals(schema.additionalProperties, false, name);
  }
  // Bug 1: the document's agents enum must include gemini (KNOWN_AGENTS, not
  // just two). The live schema's [project].agents enums the same catalogue, so
  // the two schemas share one provider-name authority.
  assert(
    renderConfigDocSchemaJson().includes('"gemini"'),
    "the setup document's agents enum must include gemini",
  );
});

Deno.test("the generated config schema publishes path and uniqueness rules", () => {
  const live = JSON.parse(renderConfigSchemaJson()) as Record<string, unknown>;
  for (const source of Object.values(SOURCE_PATHS)) {
    if (source.key === null) continue;
    const node = schemaNodeAt(live, source.key);
    const pathNode = source.key === "instructions.sources" ? node.items : node;
    assert(isJsonObject(pathNode), `${source.key} has no item schema`);
    assert(
      typeof pathNode.pattern === "string" && pathNode.pattern !== "",
      `${source.key} must publish its path pattern`,
    );
  }

  const envFiles = schemaNodeAt(live, "worktree.env_files");
  assertEquals(envFiles.uniqueItems, true);
  assert(isJsonObject(envFiles.items));
  assert(
    typeof envFiles.items.pattern === "string" &&
      envFiles.items.pattern !== "",
    "worktree.env_files items must publish their path pattern",
  );

  const setup = JSON.parse(renderConfigDocSchemaJson()) as Record<
    string,
    unknown
  >;
  const setupMapDir = schemaNodeAt(setup, "map.dir");
  assert(
    typeof setupMapDir.pattern === "string" && setupMapDir.pattern !== "",
    "the setup document must publish map.dir's path pattern",
  );

  const validate = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: true,
  }).compile(live);
  assertSchemaAccepts(validate, {
    project: { todo: "././TODO.md" },
    instructions: { sources: ["././instructions.md", "./docs/**/*.md"] },
    skills: { dir: "././playbooks/" },
    map: { dir: "././docs/map" },
    scripts: { dir: "tools/" },
    worktree: { env_files: ["././runtime", "config/secrets"] },
  });
  assertEquals(validate({ project: { todo: "../TODO.md" } }), false);
  assertEquals(
    validate({ project: { todo: "nested/.git/TODO.md" } }),
    false,
  );
  assertEquals(
    validate({ worktree: { env_files: ["runtime", "runtime"] } }),
    false,
  );
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

Deno.test("the generated applicability list enrolls exactly the canonical known jobs", () => {
  const live = JSON.parse(renderConfigSchemaJson()) as Record<string, unknown>;
  const notApplicable = schemaNodeAt(live, "assurance.not_applicable");
  assertEquals(notApplicable.uniqueItems, true);
  assert(isJsonObject(notApplicable.items));
  assertEquals(
    [...(notApplicable.items.enum as string[])].sort(),
    Object.keys(KNOWN_JOBS).sort(),
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
  assertStringIncludes(
    doc,
    "Fresh setup seeds `[scopes.map]` with the map and deferred-work ledger.",
  );
  assertStringIncludes(
    doc,
    "Upgrade leaves existing named scopes unchanged",
  );
  assertStringIncludes(
    doc,
    "(`added` \\| `modified` \\| `deleted`)[]",
  );
});

Deno.test("the reference's [project].agents row matches what the resolver actually does (no misleading [] default)", () => {
  // B43's docs half: the reference once printed `[]` as the default, which read as
  // "no agents by default" when the resolver actually emits the default pair —
  // and made the true "no agents" choice inexpressible. The key is now optional, so
  // the row must NOT advertise `[]` as its default, and its prose must document
  // both readings the resolver implements (omit → default pair, explicit [] → none).
  const doc = renderConfigReferenceDoc();
  const row = doc.split("\n").find((l) =>
    l.startsWith("| `agents`") && l.includes("CLAUDE.md")
  );
  assert(row !== undefined, "the [project].agents row should be present");
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
    resolveConfiguredAgents(parseConfigOrThrow("[project]\nagents = []\n")),
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
    scopes_neutral: defaultDocumentationScopes().join(", "),
    scopes_instructions: defaultInstructionScopes().join(", "),
    scopes_previewable: '"public/**"',
    artifact_provenance_marker: generatedArtifactMarkerBody(
      ARTIFACT_PROVENANCE_SOURCES.config,
    ),
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

Deno.test("a fresh config seeds separate documentation and instructions scopes", async () => {
  const rendered = await renderedTemplate();
  const raw = parseToml(rendered) as Record<string, unknown>;
  const scopes = raw.scopes as Record<string, Record<string, unknown>>;
  assertEquals(Object.keys(scopes), ["map", "instructions"]);
  assertEquals(scopes.map?.paths, defaultDocumentationScopePaths());
  assertEquals(scopes.map?.neutral, true);
  assertEquals(scopes.instructions?.paths, defaultInstructionScopePaths());
  assertEquals(scopes.instructions?.neutral, true);
  for (const path of defaultDocumentationScopePaths()) {
    assert(
      !defaultInstructionScopePaths().includes(path),
      `${path} must belong to the documentation seed only`,
    );
  }
  assertStringIncludes(rendered, 'pre_authorized = [] # e.g. ["map"]');
});

// ── the schema-marker class guard ─────────────────────────────────────────────
// The pre-launch defect class: a discern.toml whose `#:schema` line names a
// schema that rejects the file. The line's predecessor guard pinned the id
// alone, which ENFORCED the bug while the id served the setup-document schema —
// a shape that refuses every real config table. This guard closes the whole
// loop instead — first line → registered publication → committed artifact →
// validation of the parsed file — for both a freshly scaffolded config and this
// repo's own, so the template and its schema can never diverge silently again.

/** The `#:schema <url>` marker required at byte zero (editors read it there). */
function schemaMarkerUrl(configText: string, label: string): string {
  const firstLine = configText.split("\n", 1)[0] ?? "";
  const url = /^#:schema (\S+)$/.exec(firstLine)?.[1];
  assert(
    url !== undefined,
    `${label} must start at byte zero with '#:schema <url>'; first line: ${firstLine}`,
  );
  return url;
}

/** Assert one discern.toml names the public config schema and validates against
 * the committed artifact that id resolves to in the publication registry. */
async function assertConfigValidatesAgainstNamedSchema(
  path: string | URL,
  label: string,
): Promise<void> {
  const text = await Deno.readTextFile(path);
  const url = schemaMarkerUrl(text, label);
  assertEquals(
    url,
    CONFIG_SCHEMA_ID,
    `${label} must name the public config schema`,
  );
  const publication = PUBLIC_SCHEMA_PUBLICATIONS.find((p) => p.id === url);
  assert(
    publication !== undefined,
    `${label} names ${url}, which is not a registered public schema id`,
  );
  const artifact = JSON.parse(
    await Deno.readTextFile(
      new URL(`../${publication.artifactPath}`, import.meta.url),
    ),
  ) as Record<string, unknown>;
  const validate = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: true,
  }).compile(artifact);
  const valid = validate(parseToml(text));
  assert(
    valid === true,
    `${label} does not validate against ${publication.artifactPath}:\n` +
      JSON.stringify(validate.errors, null, 2),
  );
}

Deno.test("a scaffolded discern.toml validates against the schema its own #:schema line names", async () => {
  await withTempDir(async (dir) => {
    await scaffoldEngine(dir);
    await assertConfigValidatesAgainstNamedSchema(
      join(dir, "discern.toml"),
      "the scaffolded discern.toml",
    );
  });
});

Deno.test("the repo's own discern.toml validates against the schema its own #:schema line names", async () => {
  await assertConfigValidatesAgainstNamedSchema(
    new URL("../discern.toml", import.meta.url),
    "discern.toml",
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
  acceptance: { pre_authorized: ["map"] },
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
