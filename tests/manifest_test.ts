/**
 * The manifest: managed/seed classification, content hashing, and round-trip
 * serialization. The classification is the contract `upgrade` relies on to know
 * which files it may refresh; a wrong answer would either clobber a seed or
 * refuse to update an engine file.
 */

import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  buildManifest,
  DEFAULT_MANAGED_SPEC,
  isManaged,
  isManagedBy,
  loadManagedSpec,
  loadManifest,
  MANAGED_SPEC_FILE,
  MANIFEST_REL_PATH,
  mergeManagedSpecs,
  parseManagedSpec,
  parseManifest,
  recordedHash,
  serializeManifest,
  sha256Hex,
} from "../src/lib/manifest.ts";
import { withTempDir } from "./helpers.ts";

Deno.test("isManaged classifies the engine, skills tree, and agent as managed", () => {
  assertEquals(isManaged("agent"), true);
  assertEquals(isManaged(".icculus/engine/finish"), true);
  assertEquals(isManaged(".icculus/engine/lib/jobs.sh"), true);
  assertEquals(isManaged(".icculus/skills/write-adr/SKILL.md"), true);
});

Deno.test("isManaged classifies seeds (config, brief, docs, guidelines) as not managed", () => {
  assertEquals(isManaged(".icculus/config.toml"), false);
  assertEquals(isManaged(".icculus/brief.md"), false);
  assertEquals(isManaged(".icculus/manifest.json"), false);
  assertEquals(isManaged("docs/README.md"), false);
  assertEquals(isManaged(".icculus/guidelines/demo.md"), false);
  assertEquals(isManaged(".claude/settings.json"), false);
  assertEquals(isManaged(".gitignore"), false);
});

Deno.test("isManagedBy honours a declared spec, not the hardcoded default", () => {
  const spec = { exact: ["x/y"], prefixes: ["custom/"] };
  assertEquals(isManagedBy("custom/a/b", spec), true);
  assertEquals(isManagedBy("x/y", spec), true);
  // Default-managed paths are NOT managed under a spec that omits them.
  assertEquals(isManagedBy("agent", spec), false);
  assertEquals(isManagedBy(".icculus/engine/finish", spec), false);
});

Deno.test("parseManagedSpec reads exact + prefixes, tolerating missing arrays", () => {
  assertEquals(
    parseManagedSpec('{"exact":["agent"],"prefixes":[".x/"]}'),
    { exact: ["agent"], prefixes: [".x/"] },
  );
  assertEquals(parseManagedSpec("{}"), { exact: [], prefixes: [] });
});

Deno.test("mergeManagedSpecs unions and dedups (base + adapter)", () => {
  const merged = mergeManagedSpecs(DEFAULT_MANAGED_SPEC, {
    exact: ["native/build"],
    prefixes: [".icculus/skills/"], // already in the default — deduped
  });
  assertEquals(merged.exact, ["agent", "native/build"]);
  assertEquals(merged.prefixes, [".icculus/engine/", ".icculus/skills/"]);
});

Deno.test("sha256Hex is stable and content-sensitive", async () => {
  const a = await sha256Hex(new TextEncoder().encode("hello"));
  const aAgain = await sha256Hex(new TextEncoder().encode("hello"));
  const b = await sha256Hex(new TextEncoder().encode("hello!"));
  assertEquals(a, aAgain);
  assertNotEquals(a, b);
  // Known SHA-256 of "hello".
  assertEquals(
    a,
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

Deno.test("buildManifest sorts managed entries by path", () => {
  const manifest = buildManifest({
    kitVersion: "0.1.0",
    schemaVersion: 1,
    generatedAt: "2026-01-01T00:00:00.000Z",
    slug: "demo",
    agents: ["claude_code"],
    managed: [
      { path: "agent", sha256: "bbb" },
      { path: ".icculus/engine/finish", sha256: "aaa" },
    ],
  });
  assertEquals(manifest.managed.map((e) => e.path), [
    ".icculus/engine/finish",
    "agent",
  ]);
});

Deno.test("manifest serialize/parse round-trips and recordedHash looks entries up", () => {
  const manifest = buildManifest({
    kitVersion: "0.1.0",
    schemaVersion: 3,
    generatedAt: "2026-01-01T00:00:00.000Z",
    slug: "demo",
    agents: ["claude_code", "codex"],
    managed: [{ path: ".icculus/engine/finish", sha256: "deadbeef" }],
  });
  const parsed = parseManifest(serializeManifest(manifest));
  assertEquals(parsed.kit_version, "0.1.0");
  assertEquals(parsed.schema_version, 3);
  assertEquals(parsed.project.agents, ["claude_code", "codex"]);
  assertEquals(recordedHash(parsed, ".icculus/engine/finish"), "deadbeef");
  assertEquals(recordedHash(parsed, "agent"), undefined);
});

Deno.test("parseManifest reads a pre-schema-version manifest as schema 1", () => {
  // A 1.0 manifest predating ADR 0014 carries no schema_version field. It is a
  // schema-1 install by definition, so the field's absence must read as 1 (not
  // 0/NaN), or the migration runner would think it needs a 0→1 step.
  const legacy = JSON.stringify({
    kit_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    project: { slug: "demo", agents: ["claude_code"] },
    managed: [{ path: "agent", sha256: "abc" }],
  });
  assertEquals(parseManifest(legacy).schema_version, 1);
  // A malformed (non-integer) value is likewise normalised to 1.
  const bad = JSON.stringify({ kit_version: "1.0.0", schema_version: "two" });
  assertEquals(parseManifest(bad).schema_version, 1);
});

Deno.test("parseManagedSpec rejects a non-object (null, array, scalar)", () => {
  // A JSON null/array/scalar is structurally not a managed-set; each must throw
  // the same "must be a JSON object" error rather than silently degrade.
  for (const text of ["null", "[]", '["agent"]', "42", '"x"', "true"]) {
    assertThrows(
      () => parseManagedSpec(text),
      Error,
      `${MANAGED_SPEC_FILE} must be a JSON object`,
    );
  }
});

Deno.test("parseManagedSpec drops non-string entries inside the arrays", () => {
  // asStrings filters anything non-string out of exact/prefixes, and a non-array
  // for either key yields an empty list rather than throwing.
  assertEquals(
    parseManagedSpec('{"exact":["keep",1,null,{}],"prefixes":"nope"}'),
    { exact: ["keep"], prefixes: [] },
  );
});

Deno.test("loadManagedSpec parses managed.json when present", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, MANAGED_SPEC_FILE),
      '{"exact":["agent"],"prefixes":[".icculus/skills/"]}',
    );
    assertEquals(await loadManagedSpec(dir), {
      exact: ["agent"],
      prefixes: [".icculus/skills/"],
    });
  });
});

Deno.test("loadManagedSpec returns undefined when managed.json is absent", async () => {
  await withTempDir(async (dir) => {
    // The temp dir has no managed.json, so a NotFound is swallowed → undefined.
    assertEquals(await loadManagedSpec(dir), undefined);
  });
});

Deno.test("loadManagedSpec rethrows a non-NotFound read error", async () => {
  await withTempDir(async (dir) => {
    // Pointing at a directory entry named managed.json makes the read fail with
    // something other than NotFound, which must propagate (not be swallowed).
    await Deno.mkdir(join(dir, MANAGED_SPEC_FILE));
    await assertRejects(
      () => loadManagedSpec(dir),
      Error,
    );
  });
});

Deno.test("loadManagedSpec propagates a malformed managed.json", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(join(dir, MANAGED_SPEC_FILE), "[]");
    await assertRejects(
      () => loadManagedSpec(dir),
      Error,
      `${MANAGED_SPEC_FILE} must be a JSON object`,
    );
  });
});

Deno.test("parseManifest rejects a non-object document", () => {
  // A JSON null or scalar has no kit_version to anchor on; reject before reading.
  for (const text of ["null", "42", '"x"', "true"]) {
    assertThrows(
      () => parseManifest(text),
      Error,
      "manifest.json is not a JSON object",
    );
  }
});

Deno.test("parseManifest rejects a manifest missing a string kit_version", () => {
  // kit_version is the one strictly-required field; a missing or non-string one
  // is a clear error, distinct from the tolerant treatment of the other fields.
  assertThrows(
    () => parseManifest("{}"),
    Error,
    "manifest.json is missing a string kit_version",
  );
  assertThrows(
    () => parseManifest('{"kit_version":123}'),
    Error,
    "manifest.json is missing a string kit_version",
  );
});

Deno.test("parseManifest tolerates a malformed project and managed entries", () => {
  // A non-object project, and managed entries missing path/sha256 or not objects,
  // are normalised away rather than throwing — only kit_version is mandatory.
  const parsed = parseManifest(JSON.stringify({
    kit_version: "1.0.0",
    project: "not-an-object",
    managed: [
      { path: "agent", sha256: "abc" },
      { path: "no-hash" },
      { sha256: "no-path" },
      "not-an-object",
      null,
    ],
  }));
  assertEquals(parsed.project, { slug: "", agents: [] });
  assertEquals(parsed.generated_at, "");
  assertEquals(parsed.managed, [{ path: "agent", sha256: "abc" }]);
});

Deno.test("loadManifest reads a manifest from a destination root", async () => {
  await withTempDir(async (dir) => {
    const manifest = buildManifest({
      kitVersion: "0.1.0",
      schemaVersion: 2,
      generatedAt: "2026-01-01T00:00:00.000Z",
      slug: "demo",
      agents: ["claude_code"],
      managed: [{ path: "agent", sha256: "abc" }],
    });
    await Deno.mkdir(join(dir, ".icculus"), { recursive: true });
    await Deno.writeTextFile(
      join(dir, MANIFEST_REL_PATH),
      serializeManifest(manifest),
    );
    const load = await loadManifest(dir);
    assertEquals(load.warning, undefined);
    assertEquals(load.manifest?.kit_version, "0.1.0");
    assertEquals(load.manifest?.schema_version, 2);
  });
});

Deno.test("loadManifest warns (not throws) when the manifest is absent", async () => {
  await withTempDir(async (dir) => {
    // No .icculus/manifest.json → NotFound is turned into a warning so the
    // caller's safe ".new" path applies; manifest is undefined.
    const load = await loadManifest(dir);
    assertEquals(load.manifest, undefined);
    assertStringIncludes(load.warning ?? "", `no ${MANIFEST_REL_PATH} found`);
  });
});

Deno.test("loadManifest warns (not throws) when the manifest cannot be parsed", async () => {
  await withTempDir(async (dir) => {
    await Deno.mkdir(join(dir, ".icculus"), { recursive: true });
    // A present-but-unparseable manifest (no kit_version) becomes a warning that
    // names the reason, again falling back to "treat as yours".
    await Deno.writeTextFile(join(dir, MANIFEST_REL_PATH), "{}");
    const load = await loadManifest(dir);
    assertEquals(load.manifest, undefined);
    assertStringIncludes(
      load.warning ?? "",
      `could not parse ${MANIFEST_REL_PATH}`,
    );
    assertStringIncludes(load.warning ?? "", "missing a string kit_version");
  });
});

Deno.test("loadManifest rethrows a non-NotFound read error", async () => {
  await withTempDir(async (dir) => {
    // Making manifest.json a directory makes the read fail with something other
    // than NotFound, which must propagate rather than degrade to a warning.
    await Deno.mkdir(join(dir, MANIFEST_REL_PATH), { recursive: true });
    await assertRejects(() => loadManifest(dir), Error);
  });
});
