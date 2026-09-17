/**
 * Browser-only structural controls applied to rendered document HTML.
 *
 * The shared Markdown renderer stays neutral. The site decorates its output on
 * the server so tables and heading permalinks are present before first paint;
 * the client script only adds interaction to this stable structure.
 *
 * Headings take the package Anchor heading's exact anatomy — the row, the
 * heading with its fragment focus target, then the sibling permalink — so
 * Markdown headings and the React-rendered derived headings match;
 * `site_docs_test.ts` holds the two byte for byte.
 */

import { escapeHtml, unescapeHtml } from "../src/lib/markdown.ts";

/** The row class the site adds beside the package's, for print. */
export const HEADING_ROW_CLASS = "docs-heading-row";

/** The permalink's accessible name for a heading's visible text. */
export function headingAnchorLabel(text: string): string {
  return `Link to “${text}”`;
}

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
      const authoredClass = /\sclass="([^"]*)"/.exec(attributes)?.[1];
      const headingClass = authoredClass === undefined
        ? "discern-heading"
        : `discern-heading ${authoredClass}`;
      return `<div class="discern-anchor-heading ${HEADING_ROW_CLASS}"><h${depth} class="${headingClass}" id="${id}" tabindex="-1">${content}</h${depth}><a class="discern-anchor-heading__anchor" href="#${
        encodeURIComponent(id)
      }" aria-label="${escapeHtml(headingAnchorLabel(label))}">§</a></div>`;
    },
  );
}
