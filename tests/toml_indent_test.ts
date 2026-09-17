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
  "comments attach to the next structural line":
    `# preamble documenting the file
# stays at the root level

[project]
name = "x"

# documents the named-table entry below
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
  "comments attach to the next structural line":
    `# preamble documenting the file
# stays at the root level

[project]
  name = "x"

# documents the named-table entry below
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
    `[jobs.fix]
  run = "deno fmt"
  # last words
`,
  );
});

Deno.test("indentToml: a ruled banner keeps its visual width when an implicit level collapses", () => {
  const input = `  # ─────
  # [regions.<name>]
  # ─────

  [regions.docs]
    paths = ["docs/**"]
`;
  assertEquals(
    indentToml(input),
    `# ───────
# [regions.<name>]
# ───────

[regions.docs]
  paths = ["docs/**"]
`,
  );
});

// ── commented-out examples ─────────────────────────────────────────────────────
// A `# [a.b]` header or `# key = …` entry is an example the reader uncomments,
// so it indents as the live line would; documentation between `# ───` rules
// never does, however much it resembles TOML.

const EXAMPLE_FIXTURES: Record<string, { input: string; expected: string }> = {
  "a commented header nests its commented entries": {
    input: `[standards]

# Coverage: keep line coverage at or above a rising floor.
# [standards.coverage]
# direction = "up"
# limit     = 80

[gate]
timeout = 600
`,
    expected: `[standards]

  # Coverage: keep line coverage at or above a rising floor.
  # [standards.coverage]
    # direction = "up"
    # limit     = 80

[gate]
  timeout = 600
`,
  },
  "a commented entry sits with the live entries of its table": {
    input: `[jobs]
format = "discern tidy"
# build = "npm run build"
# test  = "npm test"
`,
    expected: `[jobs]
  format = "discern tidy"
  # build = "npm run build"
  # test  = "npm test"
`,
  },
  "a live entry after a commented sub-table returns to the live body": {
    input: `[worktree]
root = ""
# [worktree.resources.db]
# create = "createdb @db@"
export_port = false
# inherit_env = []
`,
    expected: `[worktree]
  root = ""
  # [worktree.resources.db]
    # create = "createdb @db@"
  export_port = false
  # inherit_env = []
`,
  },
  "a commented multi-line value keeps its continuation lines": {
    input: `[checkpoints]

# [checkpoints.sensitive-paths]
# paths = [
#   "src/auth/**",
# ]
# question = """
# What could break if this is wrong?
# """
`,
    expected: `[checkpoints]

  # [checkpoints.sensitive-paths]
    # paths = [
      #   "src/auth/**",
    # ]
    # question = """
    # What could break if this is wrong?
    # """
`,
  },
  "documentation inside a ruled banner is never an example": {
    input: `# ───
# [scopes.<name>]
# Params: paths, neutral
#   neutral = true   changes here need no gate
# [scopes.assets] is one such region
# ───

[scopes.map]
neutral = true
`,
    expected: `# ───
# [scopes.<name>]
# Params: paths, neutral
#   neutral = true   changes here need no gate
# [scopes.assets] is one such region
# ───

[scopes.map]
  neutral = true
`,
  },
  "implicit family segments do not invent visual parents": {
    input: `# ───
# [regions.<name>]
# Params: paths
# ───

[regions.docs]
paths = ["docs/**"]

[workspace]
root = ""
# A named output under an implicit family.
# [workspace.outputs.bundle]
# path = "dist/**"
`,
    expected: `# ───
# [regions.<name>]
# Params: paths
# ───

[regions.docs]
  paths = ["docs/**"]

[workspace]
  root = ""
  # A named output under an implicit family.
  # [workspace.outputs.bundle]
    # path = "dist/**"
`,
  },
  "a placeholder header and prose with an equals sign stay documentation": {
    input: `[gate]
# The [gate.<name>] form does not exist; read on.
# Set fail_fast = false to see every failure at once.
fail_fast = true
`,
    expected: `[gate]
  # The [gate.<name>] form does not exist; read on.
  # Set fail_fast = false to see every failure at once.
  fail_fast = true
`,
  },
};

for (const [name, { input, expected }] of Object.entries(EXAMPLE_FIXTURES)) {
  Deno.test(`indentToml: ${name}`, () => {
    const output = indentToml(input);
    assertEquals(output, expected);
    assertEquals(
      parseToml(output),
      parseToml(input),
      "indentation must never change what the document says",
    );
    assertEquals(indentToml(output), output, "the pass must be idempotent");
  });
}
