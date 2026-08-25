import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  ConfigParseError,
  RawConfig,
  tomlSyntaxHint,
} from "../src/shared/config_read.ts";

// `RawConfig` is the narrow, UNTYPED reader behind `discern config get` (the
// project script passthrough) and the standard cross-branch baseline. It applies no schema
// and no defaults — it returns exactly what is on disk. The typed engine reader is
// exercised by config_schema_test.ts.

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
  const err = assertThrows(() => new RawConfig("oops = [[["), ConfigParseError);
  assert((err as Error).message.includes("syntax error near line 1"));
  assert(err.cause instanceof Error);
});

const SAMPLE = `
[project]
slug = "demo-app"
agents = ["claude_code", "codex"]

[repository]
trunk = "main"

[jobs]
format = "deno fmt"
lint = ["eslint .", "stylelint ."]

[jobs.selfcheck]
stage = "check"
run = "deno task selfcheck"

[scopes.map]
paths = ["docs/", ".discern/"]
neutral = true

[worktree.db]
clone = "createdb -T t_template @db@ # hash-inside-a-quoted-string"

[standards.coverage]
direction = "up"
limit = 80
`;

Deno.test("get reads scalars and stringifies non-strings", () => {
  const c = new RawConfig(SAMPLE);
  assertEquals(c.get("project.slug"), "demo-app");
  // A '#' inside a quoted string is part of the value (full parser, like the old
  // awk decomment) — not an inline comment.
  assertEquals(
    c.get("worktree.db.clone"),
    "createdb -T t_template @db@ # hash-inside-a-quoted-string",
  );
  assertEquals(c.get("standards.coverage.limit"), "80");
  assertEquals(c.get("missing.key", "fallback"), "fallback");
  assertEquals(c.get("missing.key"), "");
});

Deno.test("array: array yields items, scalar yields one, absent yields []", () => {
  const c = new RawConfig(SAMPLE);
  assertEquals(c.array("jobs.lint"), ["eslint .", "stylelint ."]);
  assertEquals(c.array("jobs.format"), ["deno fmt"]);
  assertEquals(c.array("project.agents"), ["claude_code", "codex"]);
  assertEquals(c.array("missing"), []);
});

Deno.test("subsections returns child table names only", () => {
  const c = new RawConfig(SAMPLE);
  assertEquals(c.subsections("jobs"), ["selfcheck"]);
  assertEquals(c.subsections("scopes"), ["map"]);
  assertEquals(c.subsections("standards"), ["coverage"]);
  assertEquals(c.subsections("missing"), []);
});

Deno.test("keys returns flat keys, excluding nested tables", () => {
  const c = new RawConfig(SAMPLE);
  assertEquals(c.keys("jobs").sort(), ["format", "lint"]);
  assertEquals(c.keys("project").sort(), ["agents", "slug"]);
  assertEquals(c.keys("repository"), ["trunk"]);
});

Deno.test("has covers scalars, arrays, and table headers", () => {
  const c = new RawConfig(SAMPLE);
  assertEquals(c.has("project.slug"), true);
  assertEquals(c.has("project.agents"), true);
  assertEquals(c.has("worktree.db"), true); // a table header
  assertEquals(c.has("nope"), false);
});

Deno.test("getNumber coerces numeric scalars", () => {
  const c = new RawConfig(SAMPLE);
  assertEquals(c.getNumber("standards.coverage.limit"), 80);
  assertEquals(c.getNumber("project.slug"), undefined);
});
