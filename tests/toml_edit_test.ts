/**
 * Unit tests for the comment-preserving TOML editor (ADR 0005). The whole point
 * of `TomlEditor` over a parse→stringify round-trip is that it keeps comments and
 * layout, so these tests assert exactly that, plus the replace / insert / create
 * behaviours and the value renderers.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { parse as parseToml } from "@std/toml";
import {
  tomlBool,
  TomlEditor,
  tomlNumber,
  tomlString,
  tomlStringArray,
} from "../src/lib/toml_edit.ts";
import { scanManagedBanners } from "../src/lib/config_template.ts";
import { RECORD_ENTRY_SCHEMAS } from "../src/shared/config_schema.ts";
import * as tomlEditModule from "../src/lib/toml_edit.ts";

const SAMPLE = `# top comment
[project]
slug = "demo"   # the slug

[slots.test]
phase = "test"
run   = ":"   # e.g. "vitest run"

[scopes.side_gates]
# native = "make -C native check"
`;

/** Parse the edited document and read the semantic project slug rather than matching text. */
function parsedProjectSlug(text: string): unknown {
  const parsed = parseToml(text) as { project?: { slug?: unknown } };
  return parsed.project?.slug;
}

/** Count concrete slug assignments to catch duplicate-key edits. */
function countProjectSlugAssignments(text: string): number {
  return text.split(/\r?\n/).filter((line) => /^\s*slug\s*=/.test(line)).length;
}

/** Require every newline to use the fixture's original LF or CRLF convention. */
function assertOnlyLineEnding(text: string, lineEnding: "\n" | "\r\n"): void {
  if (lineEnding === "\r\n") {
    assert(
      !/(^|[^\r])\n/.test(text),
      `expected CRLF-only newlines, got ${JSON.stringify(text)}`,
    );
    return;
  }
  assert(
    !text.includes("\r\n"),
    `expected LF-only newlines, got ${JSON.stringify(text)}`,
  );
}

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

Deno.test("editor replaces keys on LF and CRLF files without duplicate keys", async (t) => {
  const cases = [
    { name: "LF", lineEnding: "\n" as const },
    { name: "CRLF", lineEnding: "\r\n" as const },
  ];

  for (const testCase of cases) {
    await t.step(testCase.name, () => {
      const input =
        `[project]${testCase.lineEnding}slug = "demo"${testCase.lineEnding}`;
      const out = new TomlEditor(input).setString("project.slug", "new")
        .toString();

      assertEquals(countProjectSlugAssignments(out), 1);
      assertEquals(parsedProjectSlug(out), "new");
      assertOnlyLineEnding(out, testCase.lineEnding);
      assertEquals(
        out,
        `[project]${testCase.lineEnding}slug = "new"${testCase.lineEnding}`,
      );
    });
  }
});

Deno.test("editor inserts and deletes keys on CRLF files while preserving CRLF", () => {
  const input = `[project]\r\nslug = "demo"\r\nkeep = "yes"\r\n`;
  const editor = new TomlEditor(input);

  editor.setString("project.slug", "new");
  editor.setString("project.gotchas_doc", "gotchas.md");
  assert(editor.deleteKey("project.keep"));

  const out = editor.toString();
  assertOnlyLineEnding(out, "\r\n");
  assertEquals(countProjectSlugAssignments(out), 1);
  assertEquals(parsedProjectSlug(out), "new");
  assertEquals(
    out,
    `[project]\r\ngotchas_doc = "gotchas.md"\r\nslug = "new"\r\n`,
  );
});

Deno.test("editor inserts a missing key into an existing section", () => {
  const out = new TomlEditor(SAMPLE).setString(
    "project.gotchas_doc",
    "gotchas.md",
  )
    .toString();
  assertStringIncludes(out, 'gotchas_doc = "gotchas.md"');
  // Inserted under [project], not elsewhere.
  const lines = out.split("\n");
  const projectIdx = lines.indexOf("[project]");
  const keyIdx = lines.findIndex((l) => l.startsWith("gotchas_doc ="));
  assert(projectIdx >= 0 && keyIdx === projectIdx + 1);
});

Deno.test("editor appends a brand-new section at EOF", () => {
  const out = new TomlEditor(SAMPLE).setString("scripts.dir", ".tools")
    .toString();
  assertStringIncludes(out, "[scripts]");
  assertStringIncludes(out, 'dir = ".tools"');
  // The new section comes after the original content.
  assert(out.indexOf("[scripts]") > out.indexOf("[scopes.side_gates]"));
});

Deno.test("editor conservatively appends a first record member when its managed banner is missing", () => {
  const input = `[project]\nslug = "demo"\n\n[gate]\nstream_output = false\n`;
  const out = new TomlEditor(input)
    .setString("standards.bundle.metric", "bundle_bytes")
    .toString();

  assert(out.indexOf("[standards.bundle]") > out.indexOf("[gate]"));
  assertStringIncludes(out, 'metric = "bundle_bytes"');
});

const FAMILY_SAMPLE = `[project]
slug = "demo"

[scopes.map]
paths   = ["docs/"]
neutral = true

[gate]
stream_output = false
`;

Deno.test("editor inserts a brand-new section beside its existing dotted-family siblings, not at EOF", () => {
  // [scopes.assets] doesn't exist yet, but [scopes.map] does — the new
  // section must land next to it, not scattered after unrelated [gate].
  const out = new TomlEditor(FAMILY_SAMPLE)
    .setStringArray("scopes.assets.paths", ["assets/**"])
    .toString();
  const lines = out.split("\n");
  const mapIdx = lines.indexOf("[scopes.map]");
  const assetsIdx = lines.indexOf("[scopes.assets]");
  const gateIdx = lines.indexOf("[gate]");
  assert(
    mapIdx >= 0 && mapIdx < assetsIdx && assetsIdx < gateIdx,
    `expected [scopes.assets] between [scopes.map] and [gate], got order: ${
      JSON.stringify({ mapIdx, assetsIdx, gateIdx })
    }`,
  );
  // A single blank-line gap, matching this file's established section spacing
  // (not the double-blank gap insertSectionBlockAfter uses for documented
  // blocks).
  assertStringIncludes(
    out,
    'neutral = true\n\n[scopes.assets]\npaths = ["assets/**"]',
  );
});

Deno.test("editor anchors a new section on the LAST matching sibling when several exist", () => {
  const sample = `[scopes.map]
paths = ["docs/"]

[scopes.native]
paths = ["native/**"]

[gate]
stream_output = false
`;
  const out = new TomlEditor(sample)
    .setStringArray("scopes.assets.paths", ["assets/**"])
    .toString();
  const lines = out.split("\n");
  assert(
    lines.indexOf("[scopes.native]") < lines.indexOf("[scopes.assets]") &&
      lines.indexOf("[scopes.assets]") < lines.indexOf("[gate]"),
    "a new sibling should land after the LAST existing family member",
  );
});

Deno.test("every first record-family member lands inside its managed config region", async (t) => {
  const template = await Deno.readTextFile(
    new URL("../templates/discern.toml.tmpl", import.meta.url),
  );
  const families = Object.keys(RECORD_ENTRY_SCHEMAS);
  const banners = scanManagedBanners(template, families);

  for (const [family, schema] of Object.entries(RECORD_ENTRY_SCHEMAS)) {
    await t.step(family, () => {
      const banner = banners.find((candidate) => candidate.family === family);
      assert(banner !== undefined, `expected a managed [${family}] banner`);
      const key = Object.keys(schema.shape)[0];
      assert(
        key !== undefined,
        `[${family}.<name>] must accept at least one key`,
      );

      // Remove every live member of this family while retaining the real
      // template's banners, examples, and surrounding section order. This makes
      // fresh_probe an adversarial FIRST member regardless of which families a
      // future template happens to seed by default.
      const input = template.split("\n").map((line) => {
        const section = line.match(/^\[([^\]]+)\]$/)?.[1];
        return section !== undefined && section.startsWith(`${family}.`)
          ? `# ${line}`
          : line;
      }).join("\n");
      const inputLines = input.split("\n");
      const boundary = inputLines.findIndex((line, index) => {
        if (index <= banner.end) return false;
        const section = line.match(/^\[([^\]]+)\]$/)?.[1];
        return section !== undefined &&
          section !== family && !section.startsWith(`${family}.`);
      });
      assert(boundary !== -1, `[${family}] needs a following section anchor`);

      const section = `${family}.fresh_probe`;
      const output = new TomlEditor(input)
        .setLiteral(`${section}.${key}`, '"probe"')
        .toString();
      const outputLines = output.split("\n");
      const bannerLine = outputLines.findIndex((line) =>
        line.includes(`# [${family}]`) || line.includes(`# [${family}.<name>]`)
      );
      const targetLine = outputLines.indexOf(`[${section}]`);
      const boundaryHeader = inputLines[boundary];
      assert(boundaryHeader !== undefined);
      const boundaryLine = outputLines.indexOf(boundaryHeader);

      assert(
        bannerLine < targetLine && targetLine < boundaryLine,
        `[${section}] must land after its banner and before ${boundaryHeader}`,
      );
    });
  }
});

Deno.test("every record-family entry inserts absent keys in schema order", async (t) => {
  for (const [family, schema] of Object.entries(RECORD_ENTRY_SCHEMAS)) {
    await t.step(family, () => {
      const keys = Object.keys(schema.shape);
      assert(keys.length > 1, `[${family}.<name>] needs multiple ordered keys`);
      const section = `${family}.fresh_probe`;
      const editor = new TomlEditor(`[${section}]\n`);
      for (const key of keys) {
        editor.setLiteral(`${section}.${key}`, '"probe"');
      }
      const written = editor.toString().split("\n").flatMap((line) => {
        const key = line.match(/^([A-Za-z0-9_-]+)\s*=/)?.[1];
        return key === undefined ? [] : [key];
      });

      assertEquals(written, keys);
    });
  }
});

Deno.test("hasSection reports presence of a section header", () => {
  const e = new TomlEditor(SAMPLE);
  assert(e.hasSection("project"));
  assert(e.hasSection("scopes.side_gates"));
  assert(!e.hasSection("features"));
});

Deno.test("hasKey reports a real assignment only — not a commented hint, section, or bare name", () => {
  const e = new TomlEditor(SAMPLE);
  assert(e.hasKey("project.slug"));
  assert(e.hasKey("slots.test.run"));
  // A commented-out `# native = …` hint is not a value.
  assert(!e.hasKey("scopes.side_gates.native"));
  // Absent key, absent section, and a bare (non-dotted) name are all false.
  assert(!e.hasKey("project.name"));
  assert(!e.hasKey("features.flag"));
  assert(!e.hasKey("slug"));
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

Deno.test("insertSectionBlockAfter never separates the next ruled banner from its section", () => {
  const input = [
    "[project]",
    'slug = "demo"',
    "",
    "# ─────",
    "# [map] — docs",
    "# ─────",
    "",
    "[map]",
    'dir = "map/"',
    "",
  ].join("\n");
  const inserted = new TomlEditor(input).insertSectionBlockAfter(
    "project",
    '# repository docs\n[repository]\ntrunk = "main"',
  ).toString();
  assert(
    inserted.indexOf("[repository]") < inserted.indexOf("# [map] — docs"),
    inserted,
  );
  assertStringIncludes(
    inserted,
    "# [map] — docs\n# ─────\n\n[map]",
  );
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
    .setNumber("standards.coverage.limit", "80")
    .setBool("worktree.export_port", false)
    .toString();
  assertStringIncludes(out, 'native = ["native/**", "native/lib/**"]');
  assertStringIncludes(out, "limit = 80");
  assertStringIncludes(out, "export_port = false");
});

Deno.test("editor replaces and deletes multiline array values as one value span", () => {
  const input = `[scopes.map]
paths = [
  "docs/**",
  "literal ] inside the value",
]
neutral = true

[gate]
stream_output = false
`;

  const replaced = new TomlEditor(input)
    .setStringArray("scopes.map.paths", ["src/**", "unicode/é/**"])
    .toString();
  assertEquals(
    replaced,
    `[scopes.map]
paths = ["src/**", "unicode/é/**"]
neutral = true

[gate]
stream_output = false
`,
  );

  const editor = new TomlEditor(input);
  assert(editor.deleteKey("scopes.map.paths"));
  assertEquals(
    editor.toString(),
    `[scopes.map]
neutral = true

[gate]
stream_output = false
`,
  );
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

Deno.test("every value renderer emits a literal @std/toml parses back as its type", () => {
  // The corrupt-literal class guard: whatever a `toml*` renderer RETURNS must be
  // a literal the same parser that later reads discern.toml accepts, and it must
  // parse back as the renderer's intended type — the only other legal outcome is
  // a throw. (JS `Number()` accepts forms the TOML grammar forbids — ".5", "5.",
  // "007", "1.e3" — and one such literal written into discern.toml bricks every
  // subsequent command, doctor included.) Renderers enrol from the module's
  // exports, so a new `toml*` renderer fails here until it gets a corpus.
  const expectations: Record<
    string,
    { inputs: unknown[]; isExpected: (v: unknown) => boolean }
  > = {
    tomlString: {
      inputs: [
        "plain",
        'a "b" \\c',
        "hash # not a comment",
        "single 'quotes'",
        "emoji ✨",
        "",
        "tab\there",
        "new\nline",
        "carriage\rreturn",
      ],
      isExpected: (v) => typeof v === "string",
    },
    tomlNumber: {
      inputs: [
        // JS-numeric forms the TOML grammar forbids — must be normalized or
        // rejected, never emitted verbatim.
        ".5",
        "5.",
        "007",
        "1.e3",
        "+.5",
        "-.5",
        "01.5",
        // Valid TOML written forms.
        "0.0",
        "500000",
        "1e5",
        "0x1F",
        "1_000",
        "+1",
        "-0.5",
        " 42 ",
        // Non-numbers and TOML-structural payloads.
        "",
        " ",
        "lots",
        "1 # comment",
        "5\nq = 1",
        "1979-05-27",
        "true",
        "[1]",
        "'5'",
        "inf",
        "nan",
        "Infinity",
        "NaN",
        // Plain JS numbers.
        0.5,
        500000,
        1e21,
        5e-324,
        -0,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ],
      isExpected: (v) => typeof v === "number" && Number.isFinite(v),
    },
    tomlBool: {
      inputs: [true, false],
      isExpected: (v) => typeof v === "boolean",
    },
    tomlStringArray: {
      inputs: [
        [],
        ["a", "b"],
        ['say "hi"', "back\\slash"],
        ["line\nbreak"],
      ],
      isExpected: (v) =>
        Array.isArray(v) && v.every((item) => typeof item === "string"),
    },
  };

  const renderers = Object.entries(tomlEditModule)
    .filter(([name, fn]) => /^toml[A-Z]/.test(name) && typeof fn === "function")
    .map(([name]) => name);
  assertEquals(
    Object.keys(expectations).sort(),
    renderers.sort(),
    "every exported toml* renderer needs a corpus in this guard",
  );

  for (const [name, { inputs, isExpected }] of Object.entries(expectations)) {
    const render = tomlEditModule[
      name as keyof typeof tomlEditModule
    ] as (input: unknown) => string;
    for (const input of inputs) {
      let literal: string;
      try {
        literal = render(input);
      } catch {
        continue; // rejecting an input is always legal
      }
      let parsed: { v?: unknown };
      try {
        parsed = parseToml(`v = ${literal}`) as { v?: unknown };
      } catch {
        throw new Error(
          `${name}(${JSON.stringify(input)}) returned ${
            JSON.stringify(literal)
          }, which @std/toml cannot parse — this literal would corrupt discern.toml`,
        );
      }
      assert(
        isExpected(parsed.v),
        `${name}(${JSON.stringify(input)}) returned ${
          JSON.stringify(literal)
        }, which parses back as ${
          JSON.stringify(parsed.v)
        } — not the renderer's type`,
      );
    }
  }
});

Deno.test("tomlNumber normalizes JS-numeric forms the TOML grammar forbids", () => {
  assertEquals(tomlNumber(".5"), "0.5");
  assertEquals(tomlNumber("5."), "5");
  assertEquals(tomlNumber("007"), "7");
  assertEquals(tomlNumber("1.e3"), "1000");
  assertEquals(tomlNumber("+.5"), "0.5");
  assertEquals(tomlNumber("-.5"), "-0.5");
});

Deno.test("tomlNumber preserves written forms that are already valid TOML", () => {
  assertEquals(tomlNumber("0.0"), "0.0");
  assertEquals(tomlNumber("500000"), "500000");
  assertEquals(tomlNumber("1e5"), "1e5");
  assertEquals(tomlNumber("1_000"), "1_000");
  assertEquals(tomlNumber("0x1F"), "0x1F");
});

Deno.test("value renderers reject bad input", () => {
  assertThrows(
    () => tomlNumber("not-a-number"),
    Error,
    "not a number",
  );
  assertThrows(
    () => tomlString("has\nnewline"),
    Error,
    "control character",
  );
  assertThrows(
    () => tomlString("has\rcarriage-return"),
    Error,
    "control character",
  );
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

Deno.test("insertKeyBlock places a documented key in canonical order", () => {
  const input = [
    "[gate]",
    "# Cancel siblings.",
    "fail_fast = true",
    "",
    "[coupling]",
    "report_in_gate = false",
    "",
  ].join("\n");
  const editor = new TomlEditor(input);

  assert(
    editor.insertKeyBlock(
      "gate",
      "stream_output",
      "# Stream output live.\nstream_output = false",
      ["stream_output", "fail_fast"],
    ),
  );
  assert(
    !editor.insertKeyBlock(
      "gate",
      "stream_output",
      "# Stream output live.\nstream_output = false",
      ["stream_output", "fail_fast"],
    ),
  );

  assertEquals(
    editor.toString(),
    [
      "[gate]",
      "# Stream output live.",
      "stream_output = false",
      "# Cancel siblings.",
      "fail_fast = true",
      "",
      "[coupling]",
      "report_in_gate = false",
      "",
    ].join("\n"),
  );
});

Deno.test("deleteSection removes an entire section and preserves CRLF style", () => {
  const input =
    `[project]\r\nslug = "demo"\r\n\r\n[features]\r\nworktrees = true\r\nstandards = false\r\n\r\n[gate]\r\nstream_output = false\r\n`;
  const editor = new TomlEditor(input);

  assert(editor.deleteSection("features"));
  const out = editor.toString();

  assertOnlyLineEnding(out, "\r\n");
  assertEquals(
    out,
    `[project]\r\nslug = "demo"\r\n\r\n[gate]\r\nstream_output = false\r\n`,
  );
  assertEquals(parsedProjectSlug(out), "demo");
  assert(!editor.deleteSection("features"));
});
