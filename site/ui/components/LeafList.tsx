/** A run of published pages, each named and described from the model. */
import type { ReactElement } from "react";
import type { NavigablePage } from "../../docs.tsx";

export interface LeafListProps {
  readonly pages: readonly NavigablePage[];
  /** Number the run when its order is the reading order. */
  readonly ordered?: boolean;
  readonly className?: string;
}

/** Titles and descriptions come from each page's validated frontmatter. */
export function LeafList(
  { pages, ordered = false, className }: LeafListProps,
): ReactElement {
  const List = ordered ? "ol" : "ul";
  return (
    <List className={className}>
      {pages.map((page) => (
        <li key={page.route}>
          <a href={page.route}>{page.entry.title}</a>
          <span className="docs-leaf-desc">{page.entry.description}</span>
        </li>
      ))}
    </List>
  );
}
