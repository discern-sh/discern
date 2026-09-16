/** Previous/next movement through a corpus's global reading order. */
import type { ReactElement } from "react";
import { Pager } from "discern-design-system/react";
import {
  adjacentPages,
  type DocsPage,
  type DocsSite,
  pageKindLabel,
} from "../../docs.tsx";

/** Each direction names the neighbour's editorial kind beside its title. */
export function DocumentPager(
  { site, page }: { readonly site: DocsSite; readonly page: DocsPage },
): ReactElement | null {
  const { previous, next } = adjacentPages(site, page);
  if (previous === undefined && next === undefined) return null;
  return (
    <Pager
      className="docs-pager"
      {...(previous === undefined ? {} : {
        previous: { href: previous.route, label: previous.entry.title },
        previousLabel: `Previous · ${pageKindLabel(previous)}`,
      })}
      {...(next === undefined ? {} : {
        next: { href: next.route, label: next.entry.title },
        nextLabel: `Next · ${pageKindLabel(next)}`,
      })}
    />
  );
}
