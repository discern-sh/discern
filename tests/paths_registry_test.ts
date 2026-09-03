/**
 * The paths registry (ADR 0102) and its satellites: the schema's path defaults,
 * the resolver outputs, and the shipped template's path values must all equal
 * the registry — driven off the registry itself, so a new source path auto
 * enrols here and a satellite that hard-codes its own default fails the gate.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { parse as parseToml } from "@std/toml";
import {
  instructionSeedRel,
  isConcretePath,
  NAMESPACE_DIR,
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
} from "../src/shared/paths_registry.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import {
  resolveBriefPath,
  resolveMapDir,
  resolveScriptsDir,
  resolveSkillsDir,
  resolveTodoPath,
} from "../src/lib/paths.ts";
import {
  defaultDocumentationScopes,
  defaultInstructionScopes,
} from "../src/lib/config.ts";

Deno.test("registry defaults follow the namespace policy and classify gate-neutral sources", () => {
  for (const name of SOURCE_PATH_NAMES) {
    const entry = SOURCE_PATHS[name];
    assert(
      entry.defaultPath.startsWith(NAMESPACE_DIR),
      `${name}: default "${entry.defaultPath}" must live under ${NAMESPACE_DIR}`,
    );
    if (name === "map") {
      assertEquals(entry.defaultPath, "discern/map/");
    }
    assertEquals(
      entry.gateNeutral,
      name !== "scripts",
      `${name}: executable Project Scripts are the only gated authored source`,
    );
    assert(entry.description.length > 0, `${name}: needs a description`);
  }
});

Deno.test("the schema's path defaults equal the registry", () => {
  const c = parseConfigOrThrow("");
  // The dotted config key → the defaulted value the schema produced. Driven off
  // the registry's own key strings, so a renamed or added key must appear here.
  const valueAt = (dotted: string): unknown => {
    let node: unknown = c;
    for (const seg of dotted.split(".")) {
      node = (node as Record<string, unknown>)[seg];
    }
    return node;
  };
  for (const name of SOURCE_PATH_NAMES) {
    const entry = SOURCE_PATHS[name];
    if (entry.key === null) {
      continue; // the brief: fixed location, no config key (ADR 0102)
    }
    const value = valueAt(entry.key);
    const expected = Array.isArray(value)
      ? [entry.defaultPath]
      : entry.defaultPath;
    assertEquals(
      value,
      expected,
      `schema default for [${entry.key}] must come from the registry`,
    );
  }
});

Deno.test("the resolvers read through the registry defaults", () => {
  const c = parseConfigOrThrow("");
  const root = "/tmp/registry-probe";
  assertEquals(
    resolveMapDir(root, c).abs,
    join(root, SOURCE_PATHS.map.defaultPath),
  );
  assertEquals(
    resolveSkillsDir(root, c).abs,
    join(root, SOURCE_PATHS.skills.defaultPath),
  );
  assertEquals(
    resolveScriptsDir(root, c).abs,
    join(root, SOURCE_PATHS.scripts.defaultPath),
  );
  assertEquals(
    resolveTodoPath(root, c).abs,
    join(root, SOURCE_PATHS.todo.defaultPath),
  );
  assertEquals(
    resolveBriefPath(root).abs,
    join(root, SOURCE_PATHS.brief.defaultPath),
  );
});

Deno.test("the shipped template's path values equal the registry defaults", async () => {
  let t = await Deno.readTextFile(
    new URL("../templates/discern.toml.tmpl", import.meta.url),
  );
  // The map dir arrives as a token whose default fill is the registry's
  // (DEFAULTS.mapDir); the other fills are irrelevant to the path keys.
  const fills: Record<string, string> = {
    project_slug: "demo",
    branch_prefix: "agent/",
    gotchas_doc: "",
    agents_array: '"claude_code", "codex"',
    map_dir: SOURCE_PATHS.map.defaultPath,
    scopes_neutral: defaultDocumentationScopes().join(", "),
    scopes_instructions: defaultInstructionScopes().join(", "),
    artifact_provenance_marker: "discern provenance marker",
    discern_version: "0.0.0",
    project_name: "Demo",
  };
  for (const [k, v] of Object.entries(fills)) t = t.replaceAll(`{{${k}}}`, v);
  const raw = parseToml(t) as Record<string, unknown>;
  const valueAt = (dotted: string): unknown => {
    let node: unknown = raw;
    for (const seg of dotted.split(".")) {
      node = (node as Record<string, unknown>)[seg];
    }
    return node;
  };
  for (const name of SOURCE_PATH_NAMES) {
    const entry = SOURCE_PATHS[name];
    if (entry.key === null) {
      continue; // the brief has no template key
    }
    const value = valueAt(entry.key);
    const expected = Array.isArray(value)
      ? [entry.defaultPath]
      : entry.defaultPath;
    assertEquals(
      value,
      expected,
      `template value for [${entry.key}] must equal the registry default`,
    );
  }
});

Deno.test("instructionSeedRel picks the first concrete source, else the registry default", () => {
  assertEquals(instructionSeedRel([]), SOURCE_PATHS.instructions.defaultPath);
  assertEquals(
    instructionSeedRel(["conventions/*.md"]),
    SOURCE_PATHS.instructions.defaultPath,
  );
  assertEquals(
    instructionSeedRel(["conventions/*.md", "rules.md"]),
    "rules.md",
  );
  assert(isConcretePath("discern/instructions.md"));
  assert(!isConcretePath("instructions/*.md"));
});
