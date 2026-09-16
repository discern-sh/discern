/**
 * Browser-only structural controls applied to rendered document HTML.
 *
 * The shared Markdown renderer stays neutral. The site decorates its output on
 * the server so tables and heading permalinks are present before first paint;
 * the client script only adds interaction to this stable structure.
 */

import { escapeHtml, unescapeHtml } from "../src/lib/markdown.ts";

/** Decorate every rendered heading and table before the response is emitted. */
export function decorateDocumentHtml(html: string): string {
  const tables = html
    .replace(
      /<table(?:\s[^>]*)?>/g,
      (table) =>
        '<div class="discern-table docs-table" role="group" aria-label="Scrollable table viewport" tabindex="0">' +
        table,
    )
    .replaceAll("</table>", "</table></div>");
  return tables.replace(
    /<h([2-4])([^>]*)>([\s\S]*?)<\/h\1>/g,
    (
      match: string,
      depth: string,
      attributes: string,
      content: string,
    ): string => {
      const id = /\sid="([^"]+)"/.exec(attributes)?.[1];
      if (id === undefined) return match;
      const label = unescapeHtml(content.replace(/<[^>]+>/g, ""))
        .replace(/\s+/g, " ")
        .trim();
      return `<div class="discern-anchor-heading docs-heading-row"><h${depth}${attributes}>${content}</h${depth}><a class="discern-anchor-heading__anchor docs-anchor" href="#${id}" aria-label="Link to “${
        escapeHtml(label)
      }”">§</a></div>`;
    },
  );
}
