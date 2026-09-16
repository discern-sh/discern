/** The right-hand contents rail for one rendered document. */
import type { ReactElement } from "react";
import { tableOfContentsHtml, type TocItem } from "../../document_toc.tsx";
import { HtmlFragment } from "./HtmlFragment.tsx";

/**
 * Authored procedures number their own H2s and leave framing sections
 * unnumbered; the package Table of contents numbers every top-level item
 * itself and offers no per-item override, so the site's renderer still
 * emits this rail until the package accepts authored numbers.
 */
export function DocumentContents(
  { items }: { readonly items: readonly TocItem[] },
): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <HtmlFragment className="docs-rail" html={tableOfContentsHtml(items)} />
  );
}
