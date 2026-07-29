/**
 * Unit tests for the depth indenter behind the `discern.toml` convention.
 * Indentation is purely visual in TOML, so every fixture is held to the two
 * invariants that make the pass safe to run on every user's config: the
 * document parses identically before and after, and re-running the pass
 * changes nothing. The exact-output cases pin the convention itself.
 */

import { assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { indentToml } from "../src/lib/toml_indent.ts";

const FIXTURES: Record<string, string> = {
  "flat sections and entries": `[project]
name = "x"

[jobs]

[jobs.fix]
run = "deno lint --fix"

[jobs.fix.deep]
nested = true
`,
  "comments attach to the next structural line": `# preamble documenting the file
# stays at the root level

[project]
name = "x"

# documents the nested section below
[jobs.fix]
run = "deno fmt"
# trailing note inside the body
`,
  "multi-line arrays nest by bracket depth": `[jobs]
format = [
  "deno fmt",
  [
    "inner",
  ],
]
check = "deno lint"
`,
  "multi-line string interiors are content": `[worktree]
setup = """
  keep my
    exact indentation
"""
literal = '''
[not.a.header]
key = "not an entry"
'''
after = "still an entry"
`,
  "root keys before any header": `version = 1
name = "env"

[section]
key = "value"
`,
  "quoted key segments and inline values": `["a.b".c]
inline = { x = 1, y = [2, 3] }
hash = "# not a comment"
bracket = "] not a closer"
`,
};

const EXPECTED: Record<string, string> = {
  "flat sections and entries": `[project]
  name = "x"

[jobs]

  [jobs.fix]
    run = "deno lint --fix"

    [jobs.fix.deep]
      nested = true
`,
  "comments attach to the next structural line": `# preamble documenting the file
# stays at the root level

[project]
  name = "x"

  # documents the nested section below
  [jobs.fix]
    run = "deno fmt"
    # trailing note inside the body
`,
  "multi-line arrays nest by bracket depth": `[jobs]
  format = [
    "deno fmt",
    [
      "inner",
    ],
  ]
  check = "deno lint"
`,
  "multi-line string interiors are content": `[worktree]
  setup = """
  keep my
    exact indentation
"""
  literal = '''
[not.a.header]
key = "not an entry"
'''
  after = "still an entry"
`,
  "root keys before any header": `version = 1
name = "env"

[section]
  key = "value"
`,
  "quoted key segments and inline values": `  ["a.b".c]
    inline = { x = 1, y = [2, 3] }
    hash = "# not a comment"
    bracket = "] not a closer"
`,
};

for (const [name, input] of Object.entries(FIXTURES)) {
  Deno.test(`indentToml: ${name}`, () => {
    const output = indentToml(input);
    assertEquals(output, EXPECTED[name]);
    assertEquals(
      parseToml(output),
      parseToml(input),
      "indentation must never change what the document says",
    );
    assertEquals(indentToml(output), output, "the pass must be idempotent");
  });
}

Deno.test("indentToml: array-of-tables headers indent like table headers", () => {
  const input = `[[fruit]]
name = "apple"

[[fruit.variety]]
name = "gala"
`;
  assertEquals(
    indentToml(input),
    `[[fruit]]
  name = "apple"

  [[fruit.variety]]
    name = "gala"
`,
  );
});

Deno.test("indentToml: a trailing comment with nothing after it keeps the body level", () => {
  const input = `[jobs.fix]
run = "deno fmt"
# last words
`;
  assertEquals(
    indentToml(input),
    `  [jobs.fix]
    run = "deno fmt"
    # last words
`,
  );
});
