/**
 * One inverse for HTML escaping. Serializers spell the same character
 * differently — React writes an apostrophe as `&#x27;`, the docs renderer as
 * `&#39;` — and a decoder that lists spellings by hand silently misses the
 * next one, double-escaping whatever passes through it. The shared decoder
 * handles every numeric reference, and the structural guard keeps a second
 * hand-rolled decoder from appearing beside it.
 */

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { escapeHtml, unescapeHtml } from "../src/lib/markdown.ts";
import { REPO_ROOT } from "./repo_authored_paths.ts";
import { structuralGuardScope } from "./structural_guard_scope.ts";

/** Every character the escapers touch, plus one already-escaped sequence. */
const HOSTILE_TEXT = `Tom & Jerry's <"quoted"> &lt;literal&gt; café ✓`;

Deno.test("unescapeHtml inverts the repository's escaper and React's serializer", () => {
  assertEquals(unescapeHtml(escapeHtml(HOSTILE_TEXT)), HOSTILE_TEXT);
  const reactText = renderToStaticMarkup(
    createElement("title", null, HOSTILE_TEXT),
  ).replace(/^<title>|<\/title>$/g, "");
  assert(reactText.includes("&#x27;"), "React spells the apostrophe in hex");
  assertEquals(unescapeHtml(reactText), HOSTILE_TEXT);
  const reactAttribute = renderToStaticMarkup(
    createElement("meta", { name: "description", content: HOSTILE_TEXT }),
  );
  const content = /content="([^"]*)"/.exec(reactAttribute)?.[1] ?? "";
  assertEquals(unescapeHtml(content), HOSTILE_TEXT);
});

Deno.test("unescapeHtml decodes decimal and hexadecimal references in one pass", () => {
  assertEquals(unescapeHtml("&#39;&#x27;&#X27;&#8212;&#x2014;"), "'''——");
  assertEquals(
    unescapeHtml("&amp;lt;&amp;#39;"),
    "&lt;&#39;",
    "an escaped ampersand never re-enters the decoder",
  );
  assertEquals(unescapeHtml("&unknown; &#; plain"), "&unknown; &#; plain");
});

/** A decode chain names an entity as the text being replaced. */
const HAND_ROLLED_DECODER =
  /\.replace(?:All)?\(\s*["'`]&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);["'`]/i;

Deno.test("HTML entity decoding has one authority", async () => {
  const paths = await structuralGuardScope({
    guard: "tests/html_entities_test.ts#one-decoder",
    universe: "authored-ts",
  });
  const offenders: string[] = [];
  for (const path of paths) {
    if (path === "src/lib/markdown.ts") continue;
    const text = await Deno.readTextFile(join(REPO_ROOT, path));
    if (HAND_ROLLED_DECODER.test(text)) {
      offenders.push(`${path}: decode entities with unescapeHtml`);
    }
  }
  assertEquals(offenders, []);
});
