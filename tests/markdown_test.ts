/**
 * Consumer guards for discern's Markdown presentation boundaries.
 *
 * The design system owns terminal parsing and presentation. These tests prove
 * discern delegates byte-for-byte instead of growing a second grammar, then
 * cover the separate React-free HTML hooks the docs website still owns.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  measureText,
  renderMarkdownCli,
  stripAnsi,
} from "discern-design-system/cli";
import { DISCERN_TRIANGLE_GLYPHS } from "../art/terminal/triangle.ts";
import {
  inlineToPlain,
  renderMarkdown,
  renderMarkdownHtml,
  renderMarkdownInlineHtml,
} from "../src/lib/markdown.ts";
import {
  terminalContextWithColor,
  terminalPresentationContext,
} from "../src/lib/terminal.ts";
import { unexpectedTerminalControls } from "./helpers.ts";

const DIALECT_FIXTURE = `# A complete document

Setext heading
--------------

Use **strong**, *emphasis*, ~~removed~~, \`code\`, and [a link](https://example.test).

> [!IMPORTANT]
> Alerts retain nested content.
>
> - [x] Reviewed
> - [ ] Ready

3. Ordered from three
   - Nested item

| Surface | Alignment |
| :------ | --------: |
| CLI | Deterministic |

\`\`\`ts
const complete = true;
\`\`\`

A note[^proof].

[^proof]: The definition remains linked.`;

Deno.test("terminal Markdown is byte-for-byte the package Markdown Component", () => {
  const base = terminalPresentationContext(true);
  for (
    const { color, width } of [
      { color: true, width: 72 },
      { color: false, width: 48 },
      // Discern's public compatibility wrapper retains its 20-cell floor.
      { color: false, width: 12 },
    ]
  ) {
    const terminal = terminalContextWithColor(base, color);
    const effectiveWidth = Math.max(20, width);
    assertEquals(
      renderMarkdown(DIALECT_FIXTURE, { color, width, terminal: base }),
      terminal.presenter.present(renderMarkdownCli, {
        source: DIALECT_FIXTURE,
        maxWidth: effectiveWidth,
      }),
    );
  }
});

Deno.test("package Markdown keeps rich documents complete and width-bounded", () => {
  const width = 42;
  const rendered = renderMarkdown(DIALECT_FIXTURE, { color: false, width });
  for (
    const fact of [
      "A complete document",
      "Alerts retain nested content.",
      "Ordered from three",
      "const complete = true;",
      "The definition remains linked.",
    ]
  ) {
    assertStringIncludes(rendered, fact);
  }
  for (const line of rendered.split("\n")) {
    assert(
      measureText(line) <= width,
      `Markdown overflowed ${width} columns: ${JSON.stringify(line)}`,
    );
  }
});

Deno.test("terminal Markdown makes hostile controls visible and inert", () => {
  const rendered = renderMarkdown(
    "# café 👩‍💻\x1b\u0085\u202E\n\n[unsafe](javascript:alert(1))",
    { color: false, width: 48 },
  );

  assertEquals(unexpectedTerminalControls(rendered), []);
  assert(!/[\p{Cc}\p{Cf}]/u.test(rendered.replaceAll("\n", "")));
  for (const visible of ["\\u{200D}", "\\u{1B}", "\\u{85}", "\\u{202E}"]) {
    assertStringIncludes(rendered, visible);
  }
  assertStringIncludes(rendered, "unsafe");
  assertStringIncludes(rendered, "javascript:alert(1)");
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

Deno.test("ASCII Markdown uses only the package motif's ASCII repertoire", () => {
  const base = terminalPresentationContext(false);
  const terminal = {
    ...base,
    capabilities: {
      ...base.capabilities,
      columns: 32,
      unicode: false,
    },
    size: { columns: 32, rows: 24 },
  };
  const rendered = renderMarkdown("# Heading\n\n---\n\n> quote\n\n- item", {
    width: 32,
    color: false,
    terminal,
  });
  for (const glyph of Object.values(DISCERN_TRIANGLE_GLYPHS)) {
    assert(!rendered.includes(glyph), `Unicode triangle leaked: ${glyph}`);
  }
  assertStringIncludes(rendered, "| quote");
  assertStringIncludes(rendered, "* item");
});

Deno.test("coloured Markdown contains only package-owned terminal styling", () => {
  const rendered = renderMarkdown(DIALECT_FIXTURE, {
    color: true,
    width: 60,
  });
  assertStringIncludes(rendered, "\x1b[");
  assertStringIncludes(stripAnsi(rendered), "A complete document");
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

Deno.test("inline HTML stays escaped while retaining Markdown semantics", () => {
  assertEquals(
    renderMarkdownInlineHtml("Use `<unsafe>` with [the docs](/docs)."),
    'Use <code>&lt;unsafe&gt;</code> with <a href="/docs">the docs</a>.',
  );
});

Deno.test("inlineToPlain remains the metadata projection authority", () => {
  assertEquals(
    inlineToPlain("a **b** and `c` and [d](http://e) and ~~gone~~"),
    "a b and c and d and gone",
  );
});

Deno.test("HTML heading ids match GitHub's anchor algorithm", () => {
  const { headings } = renderMarkdownHtml(
    [
      "# Your files / Yours",
      "## Bookkeeping & integration",
      "## public_doc_leaf_density",
      "## Repeat",
      "## Repeat",
    ].join("\n"),
  );
  assertEquals(headings.map((heading) => heading.id), [
    "your-files--yours",
    "bookkeeping--integration",
    "public_doc_leaf_density",
    "repeat",
    "repeat-1",
  ]);
});
