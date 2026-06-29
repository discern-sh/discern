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

Deno.test("value replacement preserves its own inline comment", async (t) => {
  const cases = [
    {
      name: "section key",
      input: '[project]\nslug = "old # value"   # keep this annotation\n',
      replace: (editor: TomlEditor) =>
        editor.setString("project.slug", "new value"),
      expected: 'slug = "new value"   # keep this annotation',
    },
    {
      name: "root key",
      input: 'name = "old # value"   # keep this annotation\n[project]\n',
      replace: (editor: TomlEditor) =>
        editor.setRootString("name", "new value"),
      expected: 'name = "new value"   # keep this annotation',
    },
  ];

  for (const testCase of cases) {
    await t.step(testCase.name, () => {
      const out = testCase.replace(new TomlEditor(testCase.input)).toString();
      assertStringIncludes(out, testCase.expected);
    });
  }
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

Deno.test("hasSection reports presence of a section header", () => {
  const e = new TomlEditor(SAMPLE);
  assert(e.hasSection("project"));
  assert(e.hasSection("scopes.side_gates"));
  assert(!e.hasSection("features"));
});

Deno.test("insertSectionBlockAfter places a documented block after an anchor section", () => {
  const block = "# docs for features\n[features]\nworktrees = true";
  const out = new TomlEditor(SAMPLE).insertSectionBlockAfter("project", block)
    .toString();
  const lines = out.split("\n");
  const projectIdx = lines.indexOf("[project]");
  const featuresIdx = lines.indexOf("[features]");
  const slotsIdx = lines.indexOf("[slots.test]");
  // The block lands after [project] but before the originally-following section.
  assert(projectIdx < featuresIdx && featuresIdx < slotsIdx);
  // The doc comment came with it; the anchor's own content is intact.
  assertStringIncludes(out, "# docs for features\n[features]");
  assertStringIncludes(out, 'slug = "demo"   # the slug');
  // Separated by a blank-line gap, not jammed against the anchor's last line.
  assert(out.includes('slug = "demo"   # the slug\n\n\n# docs for features'));
});

Deno.test("insertSectionBlockAfter falls back to an EOF append when the anchor is absent", () => {
  const block = "# docs\n[brandnew]\nk = 1";
  const out = new TomlEditor(SAMPLE).insertSectionBlockAfter("ghost", block)
    .toString();
  assert(out.indexOf("[brandnew]") > out.indexOf("[scopes.side_gates]"));
  assertStringIncludes(out, "# docs\n[brandnew]\nk = 1");
});

Deno.test("insertSectionBlockAtTop places a block after the preamble, before the first section", () => {
  const block = "[meta]\n# managed\nschema_version = 6";
  const out = new TomlEditor(SAMPLE).insertSectionBlockAtTop(block).toString();
  const lines = out.split("\n");
  // The leading comment preamble stays on top; [meta] precedes the first section.
  assertEquals(lines[0], "# top comment");
  assert(lines.indexOf("[meta]") < lines.indexOf("[project]"));
  assert(lines.indexOf("# top comment") < lines.indexOf("[meta]"));
});

Deno.test("insertSectionBlockAtTop on a header-only file (no preamble) puts the block first", () => {
  const out = new TomlEditor('[project]\nslug = "x"\n')
    .insertSectionBlockAtTop("[meta]\nschema_version = 6").toString();
  assert(out.startsWith("[meta]\nschema_version = 6\n"));
  assertStringIncludes(out, "[meta]\nschema_version = 6\n\n\n[project]");
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

Deno.test("root keys: setRoot* insert before the first section, then replace in place", () => {
  // A foreign file (Codex's environment.toml) carries root-level keys before any
  // section header — the discern.toml subset never does, but the editor handles them.
  const editor = new TomlEditor("");
  assert(!editor.hasRootKey("version"), "an empty file has no root key");
  editor.setRootNumber("version", 1);
  editor.setRootString("name", "Discern");
  editor.setString("setup.script", "run");
  assertEquals(
    editor.toString(),
    'version = 1\nname = "Discern"\n\n[setup]\nscript = "run"',
  );
  // Both root keys are now present…
  const e2 = new TomlEditor(editor.toString());
  assert(e2.hasRootKey("version") && e2.hasRootKey("name"));
  // …and re-setting one replaces it in place (no duplicate line).
  e2.setRootString("name", "Other");
  assertStringIncludes(e2.toString(), 'name = "Other"');
  assertEquals(e2.toString().match(/^name =/gm)?.length, 1);
});

Deno.test("root keys are scoped to the pre-section region (a same-named section key is not a root key)", () => {
  // `name` lives inside [project], not at the root — hasRootKey must not see it.
  const editor = new TomlEditor('[project]\nname = "x"\n');
  assert(
    !editor.hasRootKey("name"),
    "a key inside a section is not a root key",
  );
  // Setting it as a root key inserts a NEW root line before the section.
  editor.setRootString("name", "root");
  assertStringIncludes(editor.toString(), 'name = "root"\n[project]');
});

Deno.test("setRootLiteral rejects a dotted key", () => {
  let threw = false;
  try {
    new TomlEditor("").setRootLiteral("a.b", "1");
  } catch {
    threw = true;
  }
  assert(threw, "a dotted key is not a root key");
});

Deno.test("tomlNumber rejects a non-finite number", () => {
  let threw = false;
  try {
    tomlNumber(NaN);
  } catch {
    threw = true;
  }
  assert(threw, "tomlNumber should reject NaN");

  threw = false;
  try {
    tomlNumber(Infinity);
  } catch {
    threw = true;
  }
  assert(threw, "tomlNumber should reject Infinity");
});

Deno.test("deleteKey removes a key line, leaving the header and comments intact", () => {
  const editor = new TomlEditor(SAMPLE);
  const removed = editor.deleteKey("slots.test.run");
  assert(removed, "deleteKey should report a removal");
  // The exact remaining text: only the `run` line is gone — header, the other
  // key, its comment, and every unrelated line survive untouched.
  assertEquals(
    editor.toString(),
    `# top comment
[project]
slug = "demo"   # the slug

[slots.test]
phase = "test"

[scopes.side_gates]
# native = "make -C native check"
`,
  );
});

Deno.test("deleteKey returns false for a non-section key (no dot)", () => {
  const editor = new TomlEditor(SAMPLE);
  assert(
    !editor.deleteKey("toplevel"),
    "a key with no section is not removable",
  );
  // The text is untouched.
  assertEquals(editor.toString(), SAMPLE);
});

Deno.test("deleteKey returns false when the section is absent", () => {
  const editor = new TomlEditor(SAMPLE);
  assert(
    !editor.deleteKey("nope.missing"),
    "a key in a missing section is not removable",
  );
  assertEquals(editor.toString(), SAMPLE);
});

Deno.test("deleteKey returns false when the key is absent from an existing section", () => {
  const editor = new TomlEditor(SAMPLE);
  assert(
    !editor.deleteKey("project.missing"),
    "an absent key in a present section is not removable",
  );
  assertEquals(editor.toString(), SAMPLE);
});

Deno.test("deleteKey does not remove a commented-out key", () => {
  // `# native = …` is a comment, not a key, so deleting `native` finds nothing.
  const editor = new TomlEditor(SAMPLE);
  assert(
    !editor.deleteKey("scopes.side_gates.native"),
    "a commented-out hint is not a real key",
  );
  assertStringIncludes(editor.toString(), '# native = "make -C native check"');
});
