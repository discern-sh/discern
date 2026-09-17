/** The on-page contents for one rendered document. */
import type { ReactElement } from "react";
import { TableOfContents } from "discern-design-system/react";
import { contentsItems, type TocItem } from "../../document_toc.ts";

/** The accessible name shared by the contents landmark and its visible title. */
const CONTENTS_LABEL = "On this page";

/**
 * The package numbers the entries; an authored procedure's own numbers pass
 * through `contentsItems` untouched. Page-owned script adds the scroll spy
 * to this markup.
 */
export function DocumentContents(
  { items }: { readonly items: readonly TocItem[] },
): ReactElement {
  return (
    <TableOfContents
      className="docs-toc"
      title={CONTENTS_LABEL}
      label={CONTENTS_LABEL}
      items={contentsItems(items)}
    />
  );
}
