/**
 * Unit tests for the small `.icculus/config.toml` fragment renderer and the
 * parse-and-validate used by `doctor`.
 *
 * `renderTomlStringList` turns answers into the quoted, comma-joined array items
 * the template literal expects (with `"` escaped). `parseIcculusToml` surfaces a
 * minimally-typed view of `[project]`: present string/array fields are kept,
 * wrong-typed or missing fields collapse to `undefined`, and invalid TOML throws
 * a message that says so. Both sides of each branch are exercised.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  parseIcculusToml,
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

Deno.test("parseIcculusToml reads a fully-populated [project] block", () => {
  const text = `
[project]
slug = "demo-app"
branch_prefix = "agent/"
agents = ["claude_code", "codex"]
gotchas_doc = "docs/gotchas.md"
`;
  const parsed = parseIcculusToml(text);
  assertEquals(parsed.project.slug, "demo-app");
  assertEquals(parsed.project.branch_prefix, "agent/");
  assertEquals(parsed.project.agents, ["claude_code", "codex"]);
  assertEquals(parsed.project.gotchas_doc, "docs/gotchas.md");
  // `raw` carries the whole document through for callers that need more.
  assert("project" in parsed.raw);
});

Deno.test("parseIcculusToml tolerates a missing [project] block", () => {
  const parsed = parseIcculusToml(`title = "no project here"`);
  assertEquals(parsed.project, {
    slug: undefined,
    branch_prefix: undefined,
    agents: undefined,
    gotchas_doc: undefined,
  });
  assertEquals(parsed.raw.title, "no project here");
});

Deno.test("parseIcculusToml drops wrong-typed fields to undefined", () => {
  // Numbers where strings are expected, and a non-table `project` value are all
  // coerced away rather than surfaced as the wrong type.
  const text = `
[project]
slug = 123
branch_prefix = true
gotchas_doc = 4.5
agents = "claude_code"
`;
  const parsed = parseIcculusToml(text);
  assertEquals(parsed.project.slug, undefined);
  assertEquals(parsed.project.branch_prefix, undefined);
  assertEquals(parsed.project.gotchas_doc, undefined);
  // A non-array `agents` is dropped entirely.
  assertEquals(parsed.project.agents, undefined);
});

Deno.test("parseIcculusToml filters non-string entries out of the agents array", () => {
  const parsed = parseIcculusToml(`
[project]
agents = ["claude_code", 7, "codex", true]
`);
  assertEquals(parsed.project.agents, ["claude_code", "codex"]);
});

Deno.test("parseIcculusToml treats a top-level array document as no project", () => {
  // Valid TOML, but the root parses to a record without a `project` table.
  const parsed = parseIcculusToml(`points = [1, 2, 3]`);
  assertEquals(parsed.project.slug, undefined);
  assertEquals(parsed.raw.points, [1, 2, 3]);
});

Deno.test("parseIcculusToml throws a clear error on invalid TOML", () => {
  const err = assertThrows(
    () => parseIcculusToml("this is = = not valid"),
    Error,
  );
  assert(
    err.message.startsWith(".icculus/config.toml is not valid TOML:"),
    `unexpected message: ${err.message}`,
  );
});

Deno.test("parseIcculusToml surfaces the underlying parser message", () => {
  // An unterminated string is a parse error; the wrapped message must mention it.
  const err = assertThrows(
    () => parseIcculusToml('[project]\nslug = "unterminated'),
    Error,
  );
  assert(err.message.includes(".icculus/config.toml is not valid TOML:"));
  // Something beyond the bare prefix is carried through from the parser.
  assert(
    err.message.length > ".icculus/config.toml is not valid TOML: ".length,
  );
});
