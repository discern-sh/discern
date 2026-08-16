/**
 * Live source-path references: membership comes from SOURCE_PATHS, and every
 * scope-glob dialect consumer expands that whole derived set. A future
 * `resolution = "configured"` registry entry enters these probes automatically.
 */

import { assertEquals } from "@std/assert";
import { buildStandardPlan } from "../src/engine/gate/standard_plan.ts";
import { planScopeGates } from "../src/engine/gate/plan.ts";
import { jobsInStage } from "../src/engine/gate/stages.ts";
import { scopesForPaths } from "../src/engine/scopes/scopes.ts";
import { parseConfigOrThrow } from "../src/shared/config_schema.ts";
import { resolveGeneratedGroups } from "../src/shared/generated_artifacts.ts";
import {
  SOURCE_PATH_NAMES,
  SOURCE_PATHS,
  type SourcePathName,
} from "../src/shared/paths_registry.ts";
import {
  expandSourcePathReferences,
  SOURCE_PATH_REFERENCES,
  type SourcePathReference,
  sourcePathReference,
} from "../src/shared/source_path_references.ts";
import { resolveSourcePaths } from "../src/shared/source_path_resolution.ts";

/** A unique configured value with the same file/directory shape as the default. */
function sentinelFor(name: SourcePathName): string {
  const entry = SOURCE_PATHS[name];
  const stem = `zz-reference-${name}`;
  if (entry.defaultPath.endsWith("/")) return `${stem}/`;
  if (entry.pathKind === "directory") return stem;
  const dot = entry.defaultPath.lastIndexOf(".");
  return dot === -1 ? stem : `${stem}${entry.defaultPath.slice(dot)}`;
}

/** The canonical scope-prefix spelling for one live reference. */
function scopePattern(member: SourcePathReference): string {
  const entry = SOURCE_PATHS[member.name];
  return entry.pathKind === "directory" && !entry.defaultPath.endsWith("/")
    ? `${member.reference}/`
    : member.reference;
}

const REFERENCE_SEQUENCE = SOURCE_PATH_REFERENCES.map((member) =>
  member.reference
).join("|");
const SCOPE_PATTERNS = SOURCE_PATH_REFERENCES.map(scopePattern);

const CONFIG = parseConfigOrThrow([
  ...SOURCE_PATH_REFERENCES.map(({ key, name }) =>
    `${key} = ${JSON.stringify(sentinelFor(name))}`
  ),
  "",
  "[jobs]",
  `format = ${JSON.stringify(`known ${REFERENCE_SEQUENCE}`)}`,
  "",
  "[jobs.custom]",
  'stage = "check"',
  `run = ${JSON.stringify(`custom ${REFERENCE_SEQUENCE}`)}`,
  "",
  "[scopes.references]",
  `paths = ${JSON.stringify(SCOPE_PATTERNS)}`,
  `gate = ${JSON.stringify(`scope ${REFERENCE_SEQUENCE}`)}`,
  "",
  "[generated.references]",
  `paths = ${JSON.stringify(SCOPE_PATTERNS)}`,
  `run = ${JSON.stringify(`generated ${REFERENCE_SEQUENCE}`)}`,
  "",
  "[standards.references]",
  'direction = "down"',
  "limit = 1",
  `run = ${JSON.stringify(`standard ${REFERENCE_SEQUENCE}`)}`,
  `inputs = ${JSON.stringify(SCOPE_PATTERNS)}`,
  `per = { files = ${JSON.stringify(SCOPE_PATTERNS)} }`,
  "",
].join("\n"));

const RESOLVED_BY_NAME = new Map(
  resolveSourcePaths(CONFIG).map(({ name, path }) => [name, path] as const),
);

/** The resolved value for one registered member, or a loud broken-test error. */
function resolvedPath(name: SourcePathName): string {
  const path = RESOLVED_BY_NAME.get(name);
  if (path === undefined) {
    throw new Error(`${name}: fixture path did not resolve`);
  }
  return path;
}

const EXPECTED_SEQUENCE = SOURCE_PATH_REFERENCES.map(({ name }) =>
  resolvedPath(name)
).join("|");
const EXPECTED_SCOPE_PATTERNS = SOURCE_PATH_REFERENCES.map((member) =>
  scopePattern(member).replace(member.reference, resolvedPath(member.name))
);

Deno.test("every configured SOURCE_PATHS member owns one live reference", () => {
  const configured = SOURCE_PATH_NAMES.filter((name) =>
    SOURCE_PATHS[name].resolution === "configured"
  );
  assertEquals(
    SOURCE_PATH_REFERENCES.map(({ name }) => name),
    configured,
  );
  for (const member of SOURCE_PATH_REFERENCES) {
    assertEquals(member.reference, `\${${member.key}}`);
    assertEquals(sourcePathReference(member.name), member.reference);
  }
  for (const name of SOURCE_PATH_NAMES) {
    if (!configured.includes(name)) {
      assertEquals(sourcePathReference(name), undefined);
    }
  }
});

Deno.test("reference expansion is registry-wide and leaves shell variables alone", () => {
  assertEquals(
    expandSourcePathReferences(
      `${REFERENCE_SEQUENCE}|\${PATH}|$HOME|\${UNREGISTERED}`,
      CONFIG,
    ),
    `${EXPECTED_SEQUENCE}|\${PATH}|$HOME|\${UNREGISTERED}`,
  );
});

Deno.test("every enrolled scope-glob dialect surface expands every live reference", () => {
  assertEquals(
    jobsInStage(CONFIG, "fix").find(({ label }) => label === "format")?.command,
    `known ${EXPECTED_SEQUENCE}`,
  );
  assertEquals(
    jobsInStage(CONFIG, "check").find(({ label }) => label === "custom")
      ?.command,
    `custom ${EXPECTED_SEQUENCE}`,
  );
  assertEquals(
    planScopeGates(CONFIG, ["references"])[0]?.command,
    `scope ${EXPECTED_SEQUENCE}`,
  );

  for (const member of SOURCE_PATH_REFERENCES) {
    const entry = SOURCE_PATHS[member.name];
    const path = resolvedPath(member.name);
    const probe = entry.pathKind === "directory"
      ? `${path.replace(/\/+$/, "")}/probe.md`
      : path;
    assertEquals(scopesForPaths([probe], CONFIG), ["references"]);
  }

  const generated = resolveGeneratedGroups(CONFIG)[0];
  assertEquals(generated?.paths, EXPECTED_SCOPE_PATTERNS);
  assertEquals(generated?.run, `generated ${EXPECTED_SEQUENCE}`);
  assertEquals(
    jobsInStage(CONFIG, "build")[0]?.command,
    `generated ${EXPECTED_SEQUENCE}`,
  );

  const standard = buildStandardPlan(CONFIG).standards[0];
  assertEquals(standard?.command, `standard ${EXPECTED_SEQUENCE}`);
  assertEquals(standard?.inputs, EXPECTED_SCOPE_PATTERNS);
  assertEquals(standard?.per, {
    kind: "extent",
    measure: "files",
    globs: EXPECTED_SCOPE_PATTERNS,
  });
});
