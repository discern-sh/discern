/**
 * Unit tests for the Markdown → terminal renderer (`src/lib/markdown.ts`).
 *
 * Most assertions render with `color: false`, because plain output is stable and
 * exact (no ANSI to match against). A handful exercise `color: true` to confirm
 * styling is applied at all. The wrapping/styling split means both modes share
 * the same line breaks, so testing structure in plain mode covers both.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  inlineToPlain,
  renderMarkdown,
  renderMarkdownHtml,
} from "../src/lib/markdown.ts";

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

Deno.test("explicit colour is independent of inherited NO_COLOR", async () => {
  const module = new URL("../src/lib/markdown.ts", import.meta.url).href;
  const probe = [
    `import { renderMarkdown } from ${JSON.stringify(module)};`,
    `console.log(renderMarkdown("# Title", { color: true, width: 40 }));`,
  ].join("");
  const result = await new Deno.Command(Deno.execPath(), {
    args: ["eval", probe],
    env: { NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stderr = new TextDecoder().decode(result.stderr);
  assertEquals(result.code, 0, stderr);
  assertStringIncludes(new TextDecoder().decode(result.stdout), "\x1b[");
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

Deno.test("backslash escapes take the next punctuation char literally", () => {
  // The markers are consumed, leaving the text unstyled and un-emphasised.
  assertEquals(plain("a \\*not bold\\* b"), "a *not bold* b");
  assertEquals(plain("\\# not a heading"), "# not a heading");
  // A backslash before a non-escapable char is left as-is.
  assertEquals(plain("a\\b"), "a\\b");
});

Deno.test("inline code strips one surrounding space on each side", () => {
  // CommonMark: a single leading/trailing space is dropped when both present.
  assertEquals(plain("`  x  `"), "`x`");
  assertEquals(plain("` x `"), "`x`");
});

Deno.test("images render their alt text only", () => {
  assertEquals(plain("![alt text](http://e/img.png)"), "alt text");
  // The alt text is itself parsed inline, so emphasis inside collapses.
  assertEquals(plain("![*alt*](http://e/img.png)"), "alt");
});

Deno.test("strikethrough markers are removed in plain output", () => {
  assertEquals(plain("~~gone~~"), "gone");
  assertEquals(inlineToPlain("~~gone~~"), "gone");
});

Deno.test("strikethrough emits an ANSI strike code in colour mode", () => {
  const out = renderMarkdown("~~gone~~", { color: true });
  assertStringIncludes(out, "\x1b[9m"); // strikethrough on
  assertStringIncludes(out, "gone");
});

Deno.test("bracket text that is not a link is left verbatim", () => {
  // No "(" after the "]" — not a link, so the brackets stay.
  assertEquals(plain("see [foo] here"), "see [foo] here");
  // A "(" but no closing ")" — also not a link.
  assertEquals(plain("see [foo](http://e here"), "see [foo](http://e here");
});

Deno.test("a link title after the URL is dropped", () => {
  assertEquals(
    plain('[text](http://e "a title")'),
    "text (http://e)",
  );
});

Deno.test("emphasis with a space just inside the marker is not emphasis", () => {
  // Opener followed by whitespace fails the flanking rule: markers survive.
  assertEquals(plain("a * text * b"), "a * text * b");
  // An unclosed emphasis marker is left literal.
  assertEquals(plain("a *unclosed b"), "a *unclosed b");
});

Deno.test("inline code is yellow in colour mode", () => {
  const out = renderMarkdown("`code`", { color: true });
  assertStringIncludes(out, "\x1b[33m"); // yellow
  assertStringIncludes(out, "code");
});

Deno.test("bold and italic emit their ANSI codes in colour mode", () => {
  assertStringIncludes(renderMarkdown("**b**", { color: true }), "\x1b[1m");
  assertStringIncludes(renderMarkdown("*i*", { color: true }), "\x1b[3m");
});

Deno.test("empty and whitespace-only input render to an empty string", () => {
  assertEquals(plain(""), "");
  assertEquals(plain("   \n   \n"), "");
});

Deno.test("table cells honour escaped pipes", () => {
  const out = plain("| A | B |\n|---|---|\n| x \\| y | z |");
  // The escaped pipe becomes a literal "|" inside the cell, not a column break.
  assertStringIncludes(out, "x | y");
});

Deno.test("a horizontal rule renders as a full-width line", () => {
  const out = plain("above\n\n---\n\nbelow", 20);
  assertStringIncludes(out, "─".repeat(20));
  assertStringIncludes(out, "above");
  assertStringIncludes(out, "below");
  // Other rule markers also produce a rule.
  assertStringIncludes(plain("***", 20), "─".repeat(20));
  assertStringIncludes(plain("___", 20), "─".repeat(20));
});

Deno.test("a horizontal rule is dimmed in colour mode", () => {
  const out = renderMarkdown("a\n\n---\n\nb", { color: true, width: 20 });
  assertStringIncludes(out, "\x1b[90m"); // brightBlack
  assertStringIncludes(out, "─".repeat(20));
});

Deno.test("list continuation lines fold into the preceding item", () => {
  const out = plain("- first line\n  continued here\n- second");
  assertStringIncludes(out, "• first line continued here");
  assertStringIncludes(out, "• second");
});

Deno.test("a list ends at a non-item, non-continuation line", () => {
  // No blank line between the list and the paragraph that follows it: the list
  // collection loop must stop at the unindented prose.
  const out = plain("- item\nplain text after");
  assertStringIncludes(out, "• item");
  assertStringIncludes(out, "plain text after");
});

Deno.test("a list item with only whitespace content renders an empty body", () => {
  // The item's text is blank, so the wrapped block is a single empty line after
  // the bullet — exercising the empty-stream path of the wrapper.
  assertEquals(plain("-   "), "• ");
});

Deno.test("a paragraph gathers consecutive lines and wraps them", () => {
  // Soft line breaks join with a space into one wrapped paragraph.
  assertEquals(
    plain("line one\nline two\nline three"),
    "line one line two line three",
  );
});

Deno.test("headings above level 1 are styled by level in colour mode", () => {
  const h2 = renderMarkdown("## Heading two", { color: true });
  assertStringIncludes(h2, "\x1b[36m"); // cyan for H2
  assertStringIncludes(h2, "Heading two");

  const h3 = renderMarkdown("### Heading three", { color: true });
  assertStringIncludes(h3, "\x1b[1m"); // bold (no extra colour) for H3
  assertStringIncludes(h3, "Heading three");

  const h4 = renderMarkdown("#### Heading four", { color: true });
  assertStringIncludes(h4, "\x1b[90m"); // brightBlack for H4+
  assertStringIncludes(h4, "Heading four");
});

Deno.test("fenced code blocks render a bordered box in colour mode", () => {
  const withLang = renderMarkdown("```sh\necho hi\n```", { color: true });
  assertStringIncludes(withLang, "┌─"); // top border
  assertStringIncludes(withLang, "│ "); // body bar glyph
  assertStringIncludes(withLang, "echo hi"); // code content
  assertStringIncludes(withLang, "└─"); // bottom border
  assertStringIncludes(withLang, "\x1b[2m"); // dim language label
  assertStringIncludes(withLang, "sh");

  // Without a language the box has no label but still has borders.
  const noLang = renderMarkdown("```\nplain\n```", { color: true });
  assertStringIncludes(noLang, "┌─");
  assertStringIncludes(noLang, "│ ");
  assertStringIncludes(noLang, "plain");
  assertStringIncludes(noLang, "└─");
});

Deno.test("HTML heading ids match GitHub's anchor algorithm", () => {
  // Authors write `#fragment` links against GitHub's de-facto slugs, and the
  // same tree is browsed on GitHub and through this renderer — the two must
  // mint identical anchors or one surface's links die. Punctuation drops
  // (underscores and hyphens survive), and every whitespace character becomes
  // its own dash: dropped punctuation between words leaves a double dash.
  const { headings } = renderMarkdownHtml(
    [
      "# Your files / Yours",
      "## Bookkeeping & integration",
      "## public_doc_leaf_density",
      "## Repeat",
      "## Repeat",
    ].join("\n"),
  );
  assertEquals(headings.map((h) => h.id), [
    "your-files--yours",
    "bookkeeping--integration",
    "public_doc_leaf_density",
    "repeat",
    "repeat-1",
  ]);
});
