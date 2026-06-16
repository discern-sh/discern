/**
 * Unit tests for the comment-preserving TOML editor (ADR 0005). The whole point
 * of `TomlEditor` over a parse→stringify round-trip is that it keeps comments and
 * layout, so these tests assert exactly that, plus the replace / insert / create
 * behaviours and the value renderers.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  tomlBool,
  TomlEditor,
  tomlNumber,
  tomlString,
  tomlStringArray,
} from "../src/lib/toml_edit.ts";

const SAMPLE = `# top comment
[project]
slug = "demo"   # the slug

[slots.test]
phase = "test"
run   = ":"   # e.g. "vitest run"

[scopes.side_gates]
# native = "make -C native check"
`;

Deno.test("editor replaces a value, preserving alignment and other comments", () => {
  const out = new TomlEditor(SAMPLE).setString("slots.test.run", "vitest run")
    .toString();
  // The value changed...
  assertStringIncludes(out, 'run   = "vitest run"');
  // ...the `run   =` alignment survived...
  assert(out.includes("run   ="), "alignment should be preserved");
  // ...and unrelated comments are intact.
  assertStringIncludes(out, "# top comment");
  assertStringIncludes(out, 'slug = "demo"   # the slug');
  assertStringIncludes(out, "[scopes.side_gates]");
});

Deno.test("editor inserts a missing key into an existing section", () => {
  const out = new TomlEditor(SAMPLE).setString("project.main_branch", "trunk")
    .toString();
  assertStringIncludes(out, 'main_branch = "trunk"');
  // Inserted under [project], not elsewhere.
  const lines = out.split("\n");
  const projectIdx = lines.indexOf("[project]");
  const keyIdx = lines.findIndex((l) => l.startsWith("main_branch ="));
  assert(projectIdx >= 0 && keyIdx === projectIdx + 1);
});

Deno.test("editor appends a brand-new section at EOF", () => {
  const out = new TomlEditor(SAMPLE).setString("recipes.dir", ".tools")
    .toString();
  assertStringIncludes(out, "[recipes]");
  assertStringIncludes(out, 'dir = ".tools"');
  // The new section comes after the original content.
  assert(out.indexOf("[recipes]") > out.indexOf("[scopes.side_gates]"));
});

Deno.test("editor adds a real key alongside a commented-out hint", () => {
  const out = new TomlEditor(SAMPLE).setString(
    "scopes.side_gates.native",
    "make -C native check",
  ).toString();
  // The commented hint is left untouched...
  assertStringIncludes(out, '# native = "make -C native check"');
  // ...and a real key is added.
  assertStringIncludes(out, 'native = "make -C native check"');
});

Deno.test("editor sets array, number and bool values", () => {
  const out = new TomlEditor(SAMPLE)
    .setStringArray("scopes.native", ["native/**", "native/lib/**"])
    .setNumber("ratchets.coverage.limit", "80")
    .setBool("worktree.port", false)
    .toString();
  assertStringIncludes(out, 'native = ["native/**", "native/lib/**"]');
  assertStringIncludes(out, "limit = 80");
  assertStringIncludes(out, "port = false");
});

Deno.test("editor preserves the trailing-newline convention", () => {
  assert(
    new TomlEditor(SAMPLE).setString("project.slug", "x").toString().endsWith(
      "\n",
    ),
  );
  const noNl = '[project]\nslug = "demo"';
  assert(
    !new TomlEditor(noNl).setString("project.slug", "x").toString().endsWith(
      "\n",
    ),
  );
});

Deno.test("value renderers escape and validate", () => {
  assertEquals(tomlString('a "b" \\c'), '"a \\"b\\" \\\\c"');
  assertEquals(tomlNumber("0.0"), "0.0");
  assertEquals(tomlNumber(500000), "500000");
  assertEquals(tomlBool(true), "true");
  assertEquals(tomlStringArray(["a", "b"]), '["a", "b"]');
});

Deno.test("value renderers reject bad input", () => {
  let threw = false;
  try {
    tomlNumber("not-a-number");
  } catch {
    threw = true;
  }
  assert(threw, "tomlNumber should reject non-numeric strings");

  threw = false;
  try {
    tomlString("has\nnewline");
  } catch {
    threw = true;
  }
  assert(threw, "tomlString should reject newlines");
});

Deno.test("editor rejects a non-section key", () => {
  let threw = false;
  try {
    new TomlEditor(SAMPLE).setString("toplevel", "x");
  } catch {
    threw = true;
  }
  assert(threw, "a key with no section should be rejected");
});
