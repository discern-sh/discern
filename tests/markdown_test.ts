/**
 * Unit tests for the Markdown → terminal renderer (`src/lib/markdown.ts`).
 *
 * Most assertions render with `color: false`, because plain output is stable and
 * exact (no ANSI to match against). A handful exercise `color: true` to confirm
 * styling is applied at all. The wrapping/styling split means both modes share
 * the same line breaks, so testing structure in plain mode covers both.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { inlineToPlain, renderMarkdown } from "../src/lib/markdown.ts";

const plain = (md: string, width = 80) =>
  renderMarkdown(md, { width, color: false });

Deno.test("headings keep their # markers in plain mode", () => {
  assertEquals(plain("# Title"), "# Title");
  assertEquals(plain("### Sub"), "### Sub");
});

Deno.test("paragraphs wrap to the given width", () => {
  const para = "word ".repeat(40).trim();
  for (const line of plain(para, 30).split("\n")) {
    assert(line.length <= 30, `line too long (${line.length}): ${line}`);
  }
});

Deno.test("emphasis is parsed but snake_case identifiers are left alone", () => {
  // A space-flanked _word_ is emphasis (markers removed)…
  assertStringIncludes(plain("a _word_ b"), "a word b");
  // …but an intra-word underscore must not be treated as emphasis.
  assertStringIncludes(plain("the main_branch field"), "main_branch");
  assertStringIncludes(plain("schema_version stays whole"), "schema_version");
});

Deno.test("bold flattens and inline code keeps its backticks (plain)", () => {
  assertEquals(plain("**bold**"), "bold");
  assertEquals(plain("`code`"), "`code`");
  // Code spans are not reparsed: an underscore inside survives.
  assertEquals(plain("`a_b`"), "`a_b`");
});

Deno.test("links show their URL once in plain mode", () => {
  assertEquals(
    plain("[text](https://example.com)"),
    "text (https://example.com)",
  );
  // A bare autolink already shows the URL; it is not echoed twice.
  assertEquals(plain("<https://example.com>"), "https://example.com");
});

Deno.test("unordered, ordered, and task lists render their markers", () => {
  assertStringIncludes(plain("- one\n- two"), "• one");
  assertStringIncludes(plain("1. first\n2. second"), "1. first");
  assertStringIncludes(plain("- [ ] todo"), "☐ todo");
  assertStringIncludes(plain("- [x] done"), "☑ done");
});

Deno.test("nested list items are indented under their parent", () => {
  const out = plain("- parent\n  - child");
  assertStringIncludes(out, "• parent");
  assertStringIncludes(out, "  • child");
});

Deno.test("fenced code blocks keep their fences in plain mode", () => {
  assertEquals(plain("```sh\necho hi\n```"), "```sh\necho hi\n```");
});

Deno.test("blockquotes are prefixed with a bar", () => {
  assertStringIncludes(plain("> quoted"), "│ quoted");
});

Deno.test("a GFM table renders as a bordered box", () => {
  const out = plain("| A | B |\n|---|---|\n| 1 | 2 |");
  assertStringIncludes(out, "│");
  assertStringIncludes(out, "A");
  assertStringIncludes(out, "1");
});

Deno.test("HTML comments are stripped from the output", () => {
  const out = plain("before\n\n<!-- a secret note -->\n\nafter");
  assert(!out.includes("secret"), "comment content must not render");
  assertStringIncludes(out, "before");
  assertStringIncludes(out, "after");
});

Deno.test("colour mode emits ANSI and a heading underline rule", () => {
  const out = renderMarkdown("# Title", { color: true, width: 40 });
  assertStringIncludes(out, "\x1b["); // some styling was applied
  assertStringIncludes(out, "Title");
  assertStringIncludes(out, "─────"); // the H1 underline row
});

Deno.test("colour mode makes links clickable via OSC-8", () => {
  const out = renderMarkdown("[t](https://example.com)", { color: true });
  assertStringIncludes(out, "\x1b]8;;https://example.com");
});

Deno.test("inlineToPlain strips inline markup to bare text", () => {
  assertEquals(
    inlineToPlain("a **b** and `c` and [d](http://e)"),
    "a b and c and d",
  );
});
