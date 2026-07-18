/**
 * The strict frontmatter schema — the gate's view of the block the doc model
 * reads leniently. Every shape mistake an author can make must surface as a
 * validation issue here (and so at the gate), never as a silently-ignored
 * override: unknown and duplicate keys, out-of-shape values, out-of-bounds
 * lengths, and a fence that looks like frontmatter but does not parse.
 */

import { assert, assertEquals } from "@std/assert";
import {
  DESCRIPTION_MAX_LENGTH,
  DESCRIPTION_MIN_LENGTH,
  DOC_META_KEYS,
  parseFrontmatter,
  TITLE_MAX_LENGTH,
  validateFrontmatter,
} from "../src/lib/frontmatter.ts";

/** Wrap block lines in the fences over a minimal body. */
function doc(...blockLines: string[]): string {
  return ["---", ...blockLines, "---", "# Title", "", "Body."].join("\n");
}

Deno.test("a clean block and an absent block both validate clean", () => {
  assertEquals(validateFrontmatter("# No block at all\n\nBody.\n"), []);
  assertEquals(
    validateFrontmatter(doc(
      "title: Artifact ownership",
      "description: Which files discern owns, generates, or never touches.",
      "order: 30",
      "publish: false",
      "redirect_from:",
      "  - /docs/installer/what-discern-writes",
      "aliases:",
      "  - files",
      "  - ownership",
    )),
    [],
  );
});

Deno.test("a typo'd key fails validation, naming the allowed schema", () => {
  const issues = validateFrontmatter(doc("titel: Oops"));
  assertEquals(issues.length, 1);
  assert(issues[0]?.startsWith("titel: unknown key"), issues[0]);
  assert(
    issues[0]?.includes(DOC_META_KEYS.join(", ")),
    "the issue names the allowed keys",
  );
  // The lenient reader ignores the same key rather than failing the read.
  assertEquals(parseFrontmatter(doc("titel: Oops")).meta, {});
});

Deno.test("duplicate keys fail validation", () => {
  const issues = validateFrontmatter(doc("order: 1", "order: 2"));
  // The restricted grammar flags the duplicate, and the YAML oracle refuses
  // the block outright — real parsers reject duplicated mapping keys too.
  assertEquals(issues.length, 2);
  assertEquals(issues[0], "order: duplicate key");
  assert(issues[1]?.includes("not valid YAML"), issues[1]);
});

Deno.test("title is bounded to the short-label ceiling", () => {
  const long = "A".repeat(TITLE_MAX_LENGTH + 1);
  const issues = validateFrontmatter(doc(`title: ${long}`));
  assertEquals(issues.length, 1);
  assert(issues[0]?.includes(`${TITLE_MAX_LENGTH} characters`), issues[0]);
  assertEquals(
    validateFrontmatter(doc(`title: ${"A".repeat(TITLE_MAX_LENGTH)}`)),
    [],
  );
});

Deno.test("description must sit inside its listing/snippet bounds", () => {
  const short = "Too short.";
  assert(short.length < DESCRIPTION_MIN_LENGTH);
  assertEquals(validateFrontmatter(doc(`description: ${short}`)).length, 1);
  const long = "x".repeat(DESCRIPTION_MAX_LENGTH + 1);
  assertEquals(validateFrontmatter(doc(`description: ${long}`)).length, 1);
  const fits = "y".repeat(DESCRIPTION_MIN_LENGTH);
  assertEquals(validateFrontmatter(doc(`description: ${fits}`)), []);
});

Deno.test("order must be a non-negative integer; publish exactly a boolean", () => {
  for (const bad of ["order: 1.5", "order: -1", "order: soon"]) {
    assertEquals(validateFrontmatter(doc(bad)), [
      "order: must be a non-negative integer",
    ]);
  }
  for (const bad of ["publish: no", "publish: True", "publish: 0"]) {
    assertEquals(validateFrontmatter(doc(bad)), [
      "publish: must be exactly true or false",
    ]);
  }
  assertEquals(validateFrontmatter(doc("order: 0", "publish: true")), []);
});

Deno.test("redirect_from routes must be absolute, canonical, and unique", () => {
  const relative = validateFrontmatter(doc(
    "redirect_from:",
    "  - docs/not-absolute",
  ));
  assertEquals(relative.length, 1);
  assert(relative[0]?.includes("must be absolute"), relative[0]);

  const trailing = validateFrontmatter(doc(
    "redirect_from:",
    "  - /docs/old/",
  ));
  assert(trailing[0]?.includes("must not end with a slash"), trailing[0]);

  const fragment = validateFrontmatter(doc(
    "redirect_from:",
    "  - /docs/old#anchor",
  ));
  assert(fragment[0]?.includes("fragment or query"), fragment[0]);

  const doubled = validateFrontmatter(doc(
    "redirect_from:",
    "  - /docs/old",
    "  - /docs/old",
  ));
  assertEquals(doubled, ["redirect_from: lists a route twice"]);

  assertEquals(
    validateFrontmatter(doc("redirect_from: /docs/scalar-not-list")),
    ["redirect_from: must be a `- item` list of absolute routes"],
  );
  assertEquals(validateFrontmatter(doc("redirect_from:")), [
    "redirect_from: must not be an empty list",
  ]);
});

Deno.test("aliases must be a non-empty list of unique, non-empty synonyms", () => {
  assertEquals(validateFrontmatter(doc("aliases: files")), [
    "aliases: must be a `- item` list of search synonyms",
  ]);
  assertEquals(validateFrontmatter(doc("aliases:")), [
    "aliases: must not be an empty list",
  ]);
  assertEquals(
    validateFrontmatter(doc("aliases:", "  - files", "  - files")),
    ["aliases: lists an alias twice"],
  );
  assertEquals(
    validateFrontmatter(doc("aliases:", '  - ""')),
    ["aliases: must not contain an empty alias"],
  );
});

Deno.test("a scalar where a list belongs is caught, and vice versa", () => {
  assertEquals(validateFrontmatter(doc("title:", "  - a list")), [
    "title: must be a single line",
  ]);
});

Deno.test("the YAML oracle rejects a block a real parser cannot read", () => {
  // An unquoted value containing `: ` passes the restricted grammar (it is one
  // flat `key: value` line) but is invalid YAML — the exact shape that ships
  // past a lax check and then breaks in an external consumer's parser.
  const colon = validateFrontmatter(
    doc("description: covers everything in scope: files, routes, and links."),
  );
  assertEquals(colon.length, 1);
  assert(colon[0]?.includes("not valid YAML"), colon[0]);

  const bracket = validateFrontmatter(doc("title: [oops"));
  assertEquals(bracket.length, 1);
  assert(bracket[0]?.includes("not valid YAML"), bracket[0]);
});

Deno.test("the YAML oracle rejects a value the two parsers read differently", () => {
  // A bare number: the restricted grammar reads the string "2026", a real YAML
  // parser reads the number 2026 — divergence, so external consumers would see
  // a different document than discern does.
  const numeric = validateFrontmatter(doc("title: 2026"));
  assertEquals(numeric.length, 1);
  assert(numeric[0]?.startsWith("title: a real YAML parser"), numeric[0]);

  // Double-quote escapes: the restricted grammar keeps the backslashes, YAML
  // interprets them.
  const escaped = validateFrontmatter(doc('title: "a \\"quote\\""'));
  assertEquals(escaped.length, 1);
  assert(escaped[0]?.startsWith("title: a real YAML parser"), escaped[0]);

  // Quoting a value that needs it satisfies BOTH parsers identically.
  assertEquals(
    validateFrontmatter(doc(
      'title: "Scope: files and routes"',
      'description: "A value with a colon: quoted, both parsers agree on it."',
    )),
    [],
  );
});

Deno.test("an unterminated or unparseable block fails loudly, not silently", () => {
  const unterminated = validateFrontmatter("---\ntitle: Broken\n\n# Doc\n");
  assertEquals(unterminated.length, 1);
  assert(unterminated[0]?.includes("never closes"), unterminated[0]);

  // A nested map is doubly wrong: its member line is unrecognised, and the
  // key that opened it is not in the schema.
  const nested = validateFrontmatter(doc("metadata:", "  author: someone"));
  assertEquals(nested.length, 2);
  assert(nested[0]?.startsWith("unrecognised line"), nested[0]);
  assert(nested[1]?.startsWith("metadata: unknown key"), nested[1]);
});
