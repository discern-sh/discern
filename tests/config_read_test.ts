import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  Config,
  ConfigParseError,
  tomlSyntaxHint,
} from "../src/shared/config_read.ts";

Deno.test("tomlSyntaxHint leads with the line number when the parser gives one", () => {
  const hint = tomlSyntaxHint(
    new Error("key length is not a positive number, Parse error on line 3"),
  );
  assert(hint.includes("syntax error near line 3 in discern.toml"));
  // the raw parser detail is carried through in parens.
  assert(hint.includes("(key length is not a positive number"));
});

Deno.test("tomlSyntaxHint falls back to a plain message with no line number", () => {
  const hint = tomlSyntaxHint(new Error("totally opaque failure"));
  assertEquals(hint, "discern.toml is not valid TOML: totally opaque failure");
});

Deno.test("a malformed config throws a catchable ConfigParseError with the hint", () => {
  const err = assertThrows(() => new Config("oops = [[["), ConfigParseError);
  assert((err as Error).message.includes("syntax error near line 1"));
});

const SAMPLE = `
[project]
slug = "demo-app"
main_branch = "main"
agents = ["claude_code", "codex"]

[capabilities]
format = "deno fmt"
lint = ["eslint .", "stylelint ."]

[checks.selfcheck]
stage = "check"
run = "deno task selfcheck"

[scopes.docs]
paths = ["docs/", ".discern/"]
neutral = true

[worktree]
enabled = true
port = true

[worktree.db]
clone = "createdb -T t_template @db@ # hash-inside-a-quoted-string"

[gate]
fail_fast = true
stream = false

[ratchets.coverage]
direction = "up"
limit = 80
`;

Deno.test("get reads scalars and stringifies non-strings", () => {
  const c = new Config(SAMPLE);
  assertEquals(c.get("project.slug"), "demo-app");
  // A '#' inside a quoted string is part of the value (full parser, like the old
  // awk decomment) — not an inline comment.
  assertEquals(
    c.get("worktree.db.clone"),
    "createdb -T t_template @db@ # hash-inside-a-quoted-string",
  );
  assertEquals(c.get("ratchets.coverage.limit"), "80");
  assertEquals(c.get("missing.key", "fallback"), "fallback");
  assertEquals(c.get("missing.key"), "");
});

Deno.test("bool is true only for boolean true", () => {
  const c = new Config(SAMPLE);
  assertEquals(c.bool("worktree.enabled"), true);
  assertEquals(c.bool("gate.fail_fast"), true);
  assertEquals(c.bool("gate.stream"), false);
  assertEquals(c.bool("missing"), false);
});

Deno.test("array: array yields items, scalar yields one, absent yields []", () => {
  const c = new Config(SAMPLE);
  assertEquals(c.array("capabilities.lint"), ["eslint .", "stylelint ."]);
  assertEquals(c.array("capabilities.format"), ["deno fmt"]);
  assertEquals(c.array("project.agents"), ["claude_code", "codex"]);
  assertEquals(c.array("missing"), []);
});

Deno.test("subsections returns child table names only", () => {
  const c = new Config(SAMPLE);
  assertEquals(c.subsections("checks"), ["selfcheck"]);
  assertEquals(c.subsections("scopes"), ["docs"]);
  assertEquals(c.subsections("ratchets"), ["coverage"]);
  assertEquals(c.subsections("missing"), []);
});

Deno.test("keys returns flat keys, excluding nested tables", () => {
  const c = new Config(SAMPLE);
  assertEquals(c.keys("capabilities").sort(), ["format", "lint"]);
  // worktree has scalar keys (enabled, port) AND a nested [worktree.db] table.
  assertEquals(c.keys("worktree").sort(), ["enabled", "port"]);
});

Deno.test("has covers scalars, arrays, and table headers", () => {
  const c = new Config(SAMPLE);
  assertEquals(c.has("project.slug"), true);
  assertEquals(c.has("project.agents"), true);
  assertEquals(c.has("worktree.db"), true); // a table header
  assertEquals(c.has("nope"), false);
});

Deno.test("getNumber coerces numeric scalars", () => {
  const c = new Config(SAMPLE);
  assertEquals(c.getNumber("ratchets.coverage.limit"), 80);
  assertEquals(c.getNumber("project.slug"), undefined);
});
