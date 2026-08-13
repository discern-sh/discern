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
  DISCERN_TRIANGLE_GLYPHS,
  measureText,
  renderCodeListingCli,
  renderDividerCli,
  renderHeadingCli,
  renderTableCli,
  stripAnsi,
} from "discern-design-system/cli";
import {
  inlineToPlain,
  renderMarkdown,
  renderMarkdownHtml,
  renderMarkdownInlineHtml,
} from "../src/lib/markdown.ts";
import { terminalPresentationContext } from "../src/lib/terminal.ts";

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

Deno.test("HTML nested lists keep every child list inside its parent item", () => {
  const rendered = renderMarkdownHtml(
    "- alpha\n  - fresh sibling\n  1. ordered sibling\n- omega",
  );
  assertEquals(
    rendered.html,
    "<ul>\n<li>alpha\n<ul>\n<li>fresh sibling</li>\n</ul>\n" +
      "<ol>\n<li>ordered sibling</li>\n</ol>\n</li>\n" +
      "<li>omega</li>\n</ul>",
  );
});

Deno.test("HTML prose hooks cannot replace existing inline semantics or headings", () => {
  const rendered = renderMarkdownHtml(
    [
      "# Heading",
      "",
      "plain **bold** [linked](/target) `coded`",
      "",
      "> quoted",
      "",
      "- listed",
      "",
      "| Column |",
      "| --- |",
      "| cell |",
    ].join("\n"),
    { renderProseText: (text) => `<mark>${text}</mark>` },
  );

  assertStringIncludes(rendered.html, '<h1 id="heading">Heading</h1>');
  assertStringIncludes(rendered.html, "<mark>plain </mark>");
  assertStringIncludes(rendered.html, "<strong>bold</strong>");
  assertStringIncludes(rendered.html, '<a href="/target">linked</a>');
  assertStringIncludes(rendered.html, "<code>coded</code>");
  assertStringIncludes(rendered.html, "<blockquote><p><mark>quoted</mark></p>");
  assertStringIncludes(rendered.html, "<li><mark>listed</mark></li>");
  assertStringIncludes(rendered.html, "<th><mark>Column</mark></th>");
  assertStringIncludes(rendered.html, "<td><mark>cell</mark></td>");
  assert(!rendered.html.includes('<h1 id="heading"><mark>'));
  assert(!rendered.html.includes("<strong><mark>"));
  assert(!rendered.html.includes('<a href="/target"><mark>'));
  assert(!rendered.html.includes("<code><mark>"));
});

Deno.test("inline HTML rendering escapes source text and preserves Markdown semantics", () => {
  assertEquals(
    renderMarkdownInlineHtml("Use `<unsafe>` with [the docs](/docs)."),
    'Use <code>&lt;unsafe&gt;</code> with <a href="/docs">the docs</a>.',
  );
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
  assertEquals(
    out,
    renderHeadingCli(
      { text: "Title", level: 1, maxWidth: 40 },
      { colorDepth: "ansi16", columns: 40, unicode: true },
    ),
  );
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

Deno.test("inline code uses a package Token colour in colour mode", () => {
  const out = renderMarkdown("`code`", { color: true });
  assertStringIncludes(out, "\x1b[");
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

Deno.test("a horizontal rule is the package Divider component in colour mode", () => {
  const out = renderMarkdown("a\n\n---\n\nb", { color: true, width: 20 });
  const divider = renderDividerCli(
    { treatment: "rule", width: 20 },
    { colorDepth: "ansi16", columns: 20, unicode: true },
  );
  assertStringIncludes(out, divider);
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
  for (
    const [level, text] of [[2, "Heading two"], [3, "Heading three"], [
      4,
      "Heading four",
    ]] as const
  ) {
    assertEquals(
      renderMarkdown(`${"#".repeat(level)} ${text}`, { color: true }),
      renderHeadingCli(
        { text, level, maxWidth: 80 },
        { colorDepth: "ansi16", columns: 80, unicode: true },
      ),
    );
  }
});

Deno.test("fenced code blocks render a bordered box in colour mode", () => {
  const withLang = renderMarkdown("```sh\necho hi\n```", { color: true });
  assertEquals(
    withLang,
    renderCodeListingCli(
      { code: "echo hi", language: "sh", maxWidth: 80 },
      { colorDepth: "ansi16", columns: 80, unicode: true },
    ),
  );

  // Without a language the box has no label but still has borders.
  const noLang = renderMarkdown("```\nplain\n```", { color: true });
  assertEquals(
    noLang,
    renderCodeListingCli(
      { code: "plain", maxWidth: 80 },
      { colorDepth: "ansi16", columns: 80, unicode: true },
    ),
  );
});

Deno.test("Markdown tables are byte-for-byte the public Table component", () => {
  const markdown = "| Name | State |\n|---|---|\n| café 🙂 | ready |";
  for (
    const capabilities of [
      { colorDepth: "none" as const, columns: 40, unicode: true },
      { colorDepth: "ansi16" as const, columns: 40, unicode: true },
      { colorDepth: "none" as const, columns: 40, unicode: false },
    ]
  ) {
    const rendered = renderMarkdown(markdown, {
      width: 40,
      color: capabilities.colorDepth !== "none",
      terminal: {
        // Resolve the renderer through its public compatibility context while
        // overriding only the package facts under test.
        ...terminalPresentationContext(capabilities.colorDepth !== "none"),
        capabilities,
        size: { columns: 40, rows: 24 },
      },
    });
    const expected = renderTableCli(
      {
        columns: [{ header: "Name" }, { header: "State" }],
        rows: [["café 🙂", "ready"]],
        striped: true,
        width: 40,
      },
      capabilities,
    );
    assertEquals(rendered, expected);
    for (const line of stripAnsi(rendered).split("\n")) {
      assertEquals(measureText(line), 40);
    }
  }
});

Deno.test("ASCII Markdown presentation contains no Unicode-only motif glyphs", () => {
  const terminal = terminalPresentationContext(false);
  const out = renderMarkdown("# Heading\n\n---\n\n> quote\n\n- item", {
    width: 32,
    color: false,
    terminal: {
      ...terminal,
      capabilities: {
        ...terminal.capabilities,
        columns: 32,
        unicode: false,
      },
      size: { columns: 32, rows: 24 },
    },
  });
  for (const glyph of Object.values(DISCERN_TRIANGLE_GLYPHS)) {
    assert(!out.includes(glyph), `Unicode triangle leaked: ${glyph}`);
  }
  assertStringIncludes(out, "| quote");
  assertStringIncludes(out, "- item");
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
