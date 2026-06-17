/**
 * The manifest: managed/seed classification, content hashing, and round-trip
 * serialization. The classification is the contract `upgrade` relies on to know
 * which files it may refresh; a wrong answer would either clobber a seed or
 * refuse to update an engine file.
 */

import { assertEquals, assertNotEquals } from "@std/assert";
import {
  buildManifest,
  DEFAULT_MANAGED_SPEC,
  isManaged,
  isManagedBy,
  mergeManagedSpecs,
  parseManagedSpec,
  parseManifest,
  recordedHash,
  serializeManifest,
  sha256Hex,
} from "../src/lib/manifest.ts";

Deno.test("isManaged classifies the engine, skills tree, and bin/agent as managed", () => {
  assertEquals(isManaged("bin/agent"), true);
  assertEquals(isManaged(".icculus/engine/finish"), true);
  assertEquals(isManaged(".icculus/engine/lib/jobs.sh"), true);
  assertEquals(isManaged(".ai/skills/coding-principles/SKILL.md"), true);
});

Deno.test("isManaged classifies seeds (config, brief, docs, guidelines) as not managed", () => {
  assertEquals(isManaged("icculus.toml"), false);
  assertEquals(isManaged(".icculus/brief.md"), false);
  assertEquals(isManaged(".icculus/manifest.json"), false);
  assertEquals(isManaged("docs/README.md"), false);
  assertEquals(isManaged(".ai/guidelines/demo.md"), false);
  assertEquals(isManaged(".claude/settings.json"), false);
  assertEquals(isManaged(".gitignore"), false);
});

Deno.test("isManagedBy honours a declared spec, not the hardcoded default", () => {
  const spec = { exact: ["x/y"], prefixes: ["custom/"] };
  assertEquals(isManagedBy("custom/a/b", spec), true);
  assertEquals(isManagedBy("x/y", spec), true);
  // Default-managed paths are NOT managed under a spec that omits them.
  assertEquals(isManagedBy("bin/agent", spec), false);
  assertEquals(isManagedBy(".icculus/engine/finish", spec), false);
});

Deno.test("parseManagedSpec reads exact + prefixes, tolerating missing arrays", () => {
  assertEquals(
    parseManagedSpec('{"exact":["bin/agent"],"prefixes":[".x/"]}'),
    { exact: ["bin/agent"], prefixes: [".x/"] },
  );
  assertEquals(parseManagedSpec("{}"), { exact: [], prefixes: [] });
});

Deno.test("mergeManagedSpecs unions and dedups (base + adapter)", () => {
  const merged = mergeManagedSpecs(DEFAULT_MANAGED_SPEC, {
    exact: ["native/build"],
    prefixes: [".ai/skills/"], // already in the default — deduped
  });
  assertEquals(merged.exact, ["bin/agent", "native/build"]);
  assertEquals(merged.prefixes, [".icculus/engine/", ".ai/skills/"]);
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
      { path: "bin/agent", sha256: "bbb" },
      { path: ".icculus/engine/finish", sha256: "aaa" },
    ],
  });
  assertEquals(manifest.managed.map((e) => e.path), [
    ".icculus/engine/finish",
    "bin/agent",
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
  assertEquals(recordedHash(parsed, "bin/agent"), undefined);
});

Deno.test("parseManifest reads a pre-schema-version manifest as schema 1", () => {
  // A 1.0 manifest predating ADR 0014 carries no schema_version field. It is a
  // schema-1 install by definition, so the field's absence must read as 1 (not
  // 0/NaN), or the migration runner would think it needs a 0→1 step.
  const legacy = JSON.stringify({
    kit_version: "1.0.0",
    generated_at: "2026-01-01T00:00:00.000Z",
    project: { slug: "demo", agents: ["claude_code"] },
    managed: [{ path: "bin/agent", sha256: "abc" }],
  });
  assertEquals(parseManifest(legacy).schema_version, 1);
  // A malformed (non-integer) value is likewise normalised to 1.
  const bad = JSON.stringify({ kit_version: "1.0.0", schema_version: "two" });
  assertEquals(parseManifest(bad).schema_version, 1);
});
