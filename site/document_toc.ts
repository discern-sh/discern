/** On-page contents facts for documentation routes, derived from rendered headings. */

/** One rendered heading in a document's on-page contents rail. */
export interface TocItem {
  depth: 2 | 3;
  id: string;
  text: string;
}

/**
 * One contents entry in the shape the package Table of contents accepts: a
 * string `number` renders verbatim, `false` keeps an unnumbered slot, and an
 * absent number takes the next sequential one.
 */
export interface ContentsItem {
  readonly label: string;
  readonly href: string;
  readonly nested?: true;
  readonly number?: string | false;
}

/** An authored procedure number leading a heading, such as "3. Verify". */
const AUTHORED_NUMBER = /^(\d+)[.)]\s+(.+)$/;

/** Whether a document's own procedure numbers govern its H2 sequence. */
function usesAuthoredHeadingNumbers(toc: readonly TocItem[]): boolean {
  return toc.some((item) =>
    item.depth === 2 && AUTHORED_NUMBER.test(item.text)
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

/**
 * Project the headings into contents entries. When an authored procedure
 * numbers its headings, those numbers stay authoritative and its unnumbered
 * framing sections keep an empty slot; otherwise the package numbers the
 * top-level entries in reading order.
 */
export function contentsItems(
  toc: readonly TocItem[],
): readonly ContentsItem[] {
  const authoredNumbers = usesAuthoredHeadingNumbers(toc);
  return toc.map((item) => {
    const href = `#${item.id}`;
    if (item.depth > 2) return { label: item.text, href, nested: true };
    if (!authoredNumbers) return { label: item.text, href };
    const [, number, label] = AUTHORED_NUMBER.exec(item.text) ?? [];
    return number === undefined || label === undefined
      ? { label: item.text, href, number: false }
      : { label, href, number: number.padStart(2, "0") };
  });
}
