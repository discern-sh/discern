/** Source-line-preserving Markdown prose for canonical vocabulary checks. */

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { parseFrontmatter } from "../src/lib/frontmatter.ts";

interface MarkdownProseNode {
  readonly type: string;
  readonly position?: {
    readonly start: { readonly offset?: number | undefined };
    readonly end: { readonly offset?: number | undefined };
  } | undefined;
  readonly children?: readonly MarkdownProseNode[] | undefined;
}

/**
 * Running prose at its authored lines. The Markdown parser owns code, headings,
 * and link boundaries; emphasis joins its surrounding prose, while each link
 * label is checked independently from the words introducing its title.
 */
export function runningMarkdownProse(text: string): string {
  const { body } = parseFrontmatter(text);
  const precedingLines = text.split("\n").length - body.split("\n").length;
  const source = "\n".repeat(precedingLines) + body;
  const prose: string[] = source.split("").map((char) =>
    char === "\n" ? char : "\0"
  );
  const boundaries = new Set<number>();
  const tree: MarkdownProseNode = fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const inline = (node: MarkdownProseNode): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === "text") {
      for (let at = start; at < end; at += 1) prose[at] = source[at] ?? "";
      return;
    }
    if (node.type === "link" || node.type === "linkReference") {
      boundaries.add(start);
      boundaries.add(end);
      // Autolinks are addresses, not authored titles or running prose.
      if (source[start] !== "[") return;
    } else if (
      node.type === "inlineCode" || node.type === "html" ||
      node.type === "image" || node.type === "imageReference"
    ) {
      boundaries.add(start);
      boundaries.add(end);
      return;
    }
    for (const child of node.children ?? []) inline(child);
  };

  const visit = (node: MarkdownProseNode): void => {
    if (node.type === "heading") return;
    if (node.type === "paragraph" || node.type === "tableCell") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      boundaries.add(start);
      boundaries.add(end);
      for (let at = start; at < end; at += 1) {
        prose[at] = source[at] === "\n" ? "\n" : " ";
      }
      for (const child of node.children ?? []) inline(child);
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return prose.map((char, at) => `${boundaries.has(at) ? "\0" : ""}${char}`)
    .join("");
}
