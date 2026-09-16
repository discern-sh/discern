/** The colophon under every document: the plain-text edition, source, and history. */
import type { ReactElement } from "react";
import {
  colophonFacts,
  type ColophonIndex,
  type DecisionPage,
  type DocsPage,
} from "../../docs.tsx";

export interface DocumentColophonProps {
  readonly page: DocsPage | DecisionPage | null;
  /** The index described when the colophon stands under no single page. */
  readonly index?: ColophonIndex;
}

/** Text readers reach the same bytes by URL suffix or by the terminal reader. */
export function DocumentColophon(
  { page, index = "docs" }: DocumentColophonProps,
): ReactElement {
  const facts = colophonFacts(page, index);
  return (
    <footer className="docs-colophon">
      <span>
        Plain text for agents:{" "}
        <a className="discern-mono" href={`${facts.route}.md`}>
          curl&nbsp;discern.sh{facts.route}.md
        </a>{" "}
        or <code>discern docs {facts.target} --raw</code>
      </span>
      <span className="docs-colophon-links">
        {facts.related.map(({ label, href }) => (
          <a key={href} href={href}>{label}</a>
        ))}
        <a href={facts.source}>View source&nbsp;↗</a>
      </span>
    </footer>
  );
}
