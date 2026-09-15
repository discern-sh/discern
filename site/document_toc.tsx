/** Server-rendered on-page navigation for documentation routes. */

import { escapeHtml } from "../src/lib/markdown.ts";

/** One rendered heading in a document's on-page contents rail. */
export interface TocItem {
  depth: 2 | 3;
  id: string;
  text: string;
}

/** Whether a document's own procedure numbers govern its H2 sequence. */
function usesAuthoredHeadingNumbers(toc: readonly TocItem[]): boolean {
  return toc.some((item) =>
    item.depth === 2 && /^(\d+)[.)]\s+/.test(item.text)
  );
}

/** Mark prose whose own H2 numbers replace the presentation counter. */
export function authoredHeadingNumberClass(
  toc: readonly TocItem[],
): string {
  return usesAuthoredHeadingNumbers(toc)
    ? " docs-authored-heading-numbers"
    : "";
}

/** Render authored H2 numbering when present, or a generated sequence. */
export function tableOfContentsHtml(toc: readonly TocItem[]): string {
  if (toc.length === 0) return "";
  const authoredNumbers = new Map(
    toc.filter((item) => item.depth === 2).map((item) => [
      item.id,
      /^(\d+)[.)]\s+(.+)$/.exec(item.text),
    ]),
  );
  const usesAuthoredNumbers = usesAuthoredHeadingNumbers(toc);
  let sectionNumber = 0;
  const items = toc.map((item) => {
    const nested = item.depth > 2;
    const itemClass = nested
      ? ' class="discern-table-of-contents__item--nested"'
      : "";
    const authored = authoredNumbers.get(item.id);
    const label = !nested && usesAuthoredNumbers && authored !== null
      ? authored?.[2] ?? item.text
      : item.text;
    const number = nested
      ? ""
      : `<span>${
        usesAuthoredNumbers
          ? authored?.[1]?.padStart(2, "0") ?? ""
          : String(++sectionNumber).padStart(2, "0")
      }</span>`;
    return `<li${itemClass}><a href="#${escapeHtml(item.id)}">${number}${
      escapeHtml(label)
    }</a></li>`;
  }).join("");
  return `<nav class="discern-table-of-contents docs-toc" aria-label="On this page"><strong class="discern-table-of-contents__title">On this page</strong><ol>${items}</ol></nav>`;
}
