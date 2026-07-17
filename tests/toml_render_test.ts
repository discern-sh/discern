/**
 * Unit tests for the small `discern.toml` fragment renderer and the
 * parse-and-validate used by `doctor`.
 *
 * `renderTomlStringList` turns answers into the quoted, comma-joined array items
 * the template literal expects (with `\` and `"` escaped, and control characters
 * rejected). `parseDiscernToml` surfaces a minimally-typed view of `[project]`:
 * present string/array fields are kept, wrong-typed or missing fields collapse to
 * `undefined`, and invalid TOML throws a message that says so. Both sides of each
 * branch are exercised.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import {
  parseDiscernToml,
  renderTomlStringList,
} from "../src/lib/toml_render.ts";

Deno.test("renderTomlStringList quotes and comma-joins items", () => {
  assertEquals(renderTomlStringList(["a", "b", "c"]), '"a", "b", "c"');
});

Deno.test("renderTomlStringList renders a single item without a separator", () => {
  assertEquals(renderTomlStringList(["only"]), '"only"');
});

Deno.test("renderTomlStringList yields an empty string for an empty list", () => {
  assertEquals(renderTomlStringList([]), "");
});

Deno.test("renderTomlStringList escapes embedded double-quotes", () => {
  assertEquals(renderTomlStringList(['say "hi"']), '"say \\"hi\\""');
});

Deno.test("renderTomlStringList round-trips adversarial single-line strings", () => {
  const items = [
    "src\\win\\**",
    "trailing\\",
    'say "hi"',
    "unicode/é/**",
  ];

  const rendered = `items = [${renderTomlStringList(items)}]`;
  const parsed = parseToml(rendered) as { items?: unknown };

  assertEquals(parsed.items, items);
});

Deno.test("renderTomlStringList rejects values that cannot be rendered on one TOML line", () => {
  for (const item of ["line\nbreak", "carriage\rreturn", "nul\u0000byte"]) {
    assertThrows(
      () => renderTomlStringList([item]),
      Error,
      "control character",
    );
  }
});

Deno.test("parseDiscernToml reads populated project and repository blocks", () => {
  const text = `
[project]
slug = "demo-app"
agents = ["claude_code", "codex"]
gotchas_doc = "docs/gotchas.md"

[repository]
trunk = "stable"
branch_prefix = "agent/"
ensure = ["install"]
`;
  const parsed = parseDiscernToml(text);
  assertEquals(parsed.project.slug, "demo-app");
  assertEquals(parsed.project.agents, ["claude_code", "codex"]);
  assertEquals(parsed.project.gotchas_doc, "docs/gotchas.md");
  assertEquals(parsed.repository, {
    trunk: "stable",
    branch_prefix: "agent/",
    ensure: ["install"],
  });
  // `raw` carries the whole document through for callers that need more.
  assert("project" in parsed.raw);
});

Deno.test("parseDiscernToml tolerates a missing [project] block", () => {
  const parsed = parseDiscernToml(`title = "no project here"`);
  assertEquals(parsed.project, {
    slug: undefined,
    agents: undefined,
    gotchas_doc: undefined,
  });
  assertEquals(parsed.repository, {
    trunk: undefined,
    branch_prefix: undefined,
    ensure: undefined,
  });
  assertEquals(parsed.raw.title, "no project here");
});

Deno.test("parseDiscernToml drops EVERY wrong-typed [project] string field to undefined", () => {
  // Discover the extracted [project] string fields from a fully-populated parse —
  // the SSOT is the returned shape itself, so a new string field auto-enrols here
  // rather than shipping with an untested coercion. `agents` is the sole array
  // field (its wrong-typed case is a separate test below).
  const populated = parseDiscernToml(
    `[project]\nslug = "s"\ngotchas_doc = "g"\nagents = ["claude_code"]`,
  ).project;
  const stringFields = (Object.keys(populated) as Array<keyof typeof populated>)
    .filter((f) => f !== "agents");
  assert(
    stringFields.length >= 2,
    `expected the [project] string fields (slug/gotchas_doc), got: ${
      stringFields.join(", ")
    }`,
  );

  // A document assigning a NUMBER to every string field: each must coerce away
  // rather than surface as the wrong type.
  const parsed = parseDiscernToml(
    `[project]\n${stringFields.map((f) => `${f} = 123`).join("\n")}`,
  ).project;
  for (const f of stringFields) {
    assertEquals(
      parsed[f],
      undefined,
      `wrong-typed [project].${f} must coerce to undefined`,
    );
  }

  // A non-array `agents` is likewise dropped entirely.
  assertEquals(
    parseDiscernToml(`[project]\nagents = "claude_code"`).project.agents,
    undefined,
  );
});

Deno.test("parseDiscernToml drops wrong-typed repository fields", () => {
  const parsed = parseDiscernToml(
    '[repository]\ntrunk = 1\nbranch_prefix = false\nensure = ["ok", 2]',
  );
  assertEquals(parsed.repository, {
    trunk: undefined,
    branch_prefix: undefined,
    ensure: ["ok"],
  });
});

Deno.test("parseDiscernToml filters non-string entries out of the agents array", () => {
  const parsed = parseDiscernToml(`
[project]
agents = ["claude_code", 7, "codex", true]
`);
  assertEquals(parsed.project.agents, ["claude_code", "codex"]);
});

Deno.test("parseDiscernToml treats a top-level array document as no project", () => {
  // Valid TOML, but the root parses to a record without a `project` table.
  const parsed = parseDiscernToml(`points = [1, 2, 3]`);
  assertEquals(parsed.project.slug, undefined);
  assertEquals(parsed.raw.points, [1, 2, 3]);
});

Deno.test("parseDiscernToml throws a clear, line-numbered error on invalid TOML", () => {
  const err = assertThrows(
    () => parseDiscernToml("this is = = not valid"),
    Error,
  );
  // Leads with a friendly, line-numbered hint naming the file.
  assert(
    err.message.includes("syntax error near line 1 in discern.toml"),
    `unexpected message: ${err.message}`,
  );
});

Deno.test("parseDiscernToml surfaces the underlying parser message", () => {
  // An unterminated string is a parse error on line 2; the wrapped message must
  // name the line AND carry the raw parser detail (in parens).
  const err = assertThrows(
    () => parseDiscernToml('[project]\nslug = "unterminated'),
    Error,
  );
  assert(err.message.includes("syntax error near line 2 in discern.toml"));
  assert(
    err.message.includes("(Parse error on line"),
    `raw parser detail missing: ${err.message}`,
  );
});
