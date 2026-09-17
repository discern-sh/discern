/** A model-derived heading with the same permalink anatomy as a Markdown heading's. */
import type { ReactElement, ReactNode } from "react";
import { AnchorHeading } from "discern-design-system/react";
import { HEADING_ROW_CLASS, headingAnchorLabel } from "../../document_html.tsx";

export interface DocumentHeadingProps {
  /** The fragment a section's `aria-labelledby` and the permalink name. */
  readonly id: string;
  /** The heading's visible text, which names its permalink. */
  readonly text: string;
  /** Richer heading content; defaults to the text. */
  readonly children?: ReactNode;
}

/** The package row: heading first, permalink beside it, never inside its name. */
export function DocumentHeading(
  { id, text, children }: DocumentHeadingProps,
): ReactElement {
  return (
    <AnchorHeading
      id={id}
      className={HEADING_ROW_CLASS}
      anchorLabel={headingAnchorLabel(text)}
    >
      {children ?? text}
    </AnchorHeading>
  );
}
