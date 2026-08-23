/** Source-preserving Markdown link rebasing across instruction file locations. */

import { assertEquals } from "@std/assert";
import { rebaseMarkdownLinks } from "../src/lib/markdown_links.ts";

Deno.test("rebaseMarkdownLinks: a nested provider output preserves syntax around destination bytes", () => {
  const source = [
    "# Policy",
    "",
    'Inline [guide](../guide.md "A title") and ![map](./map.svg).',
    "Reference [guide][ref].",
    "",
    "[ref]: <../guide folder.md?view=wide#part> 'Reference title'",
    "",
    "`[code](../literal.md)`",
    "",
    "```md",
    "[fenced](../literal.md)",
    "```",
    "",
  ].join("\n");

  assertEquals(
    rebaseMarkdownLinks(
      source,
      "discern/policy/instructions.md",
      "config/agents/AGENTS.md",
    ),
    [
      "# Policy",
      "",
      'Inline [guide](../../discern/guide.md "A title") and ![map](../../discern/policy/map.svg).',
      "Reference [guide][ref].",
      "",
      "[ref]: <../../discern/guide folder.md?view=wide#part> 'Reference title'",
      "",
      "`[code](../literal.md)`",
      "",
      "```md",
      "[fenced](../literal.md)",
      "```",
      "",
    ].join("\n"),
  );
});

Deno.test("rebaseMarkdownLinks: equal source and output bases preserve every byte", () => {
  const source = '[guide](<a folder/guide.md>  "title")  \n';
  assertEquals(
    rebaseMarkdownLinks(source, "policy/source.md", "policy/AGENTS.md"),
    source,
  );
});
