/** One published manual page: a guide, tutorial, explanation, reference, or section landing. */
import type { ReactElement } from "react";
import { Kicker } from "discern-design-system/react";
import {
  decorateDocumentHtml,
  type DocsPage,
  type DocsSite,
  pageKindLabel,
  relatedDecisions,
  type RenderedDoc,
  sectionLeafIndexHtml,
} from "../../docs.tsx";
import { authoredHeadingNumberClass } from "../../document_toc.tsx";
import {
  DocumentLayout,
  renderDocumentPage,
} from "../layouts/DocumentLayout.tsx";
import { DocumentColophon } from "../components/DocumentColophon.tsx";
import { DocumentPager } from "../components/DocumentPager.tsx";
import { HtmlFragment } from "../components/HtmlFragment.tsx";

export interface ManualPageProps {
  readonly site: DocsSite;
  readonly page: DocsPage;
  readonly rendered: RenderedDoc;
}

/** The decisions a page cites, linked to their on-site records. */
function RelatedDecisions(
  { site, page }: { readonly site: DocsSite; readonly page: DocsPage },
): ReactElement | null {
  const decisions = relatedDecisions(site, page);
  if (decisions.length === 0) return null;
  return (
    <aside
      className="docs-related-decisions"
      aria-labelledby="related-decisions"
    >
      <h2 id="related-decisions">Related decisions</h2>
      <ul>
        {decisions.map(({ reference, detail, href }) => (
          <li key={href}>
            <a className="docs-related-decision" href={href}>{reference}</a>
            <span className="docs-related-decision-detail">: {detail}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * The article is the body renderer's HTML — Workflow projections, glossary
 * terms, and structural decoration included — with a section landing's
 * model-derived leaf list appended before decoration.
 */
export function ManualPage(
  { site, page, rendered }: ManualPageProps,
): ReactElement {
  const article = decorateDocumentHtml(
    `${rendered.html}\n${sectionLeafIndexHtml(site, page)}`,
  );
  return (
    <DocumentLayout
      site={site}
      current={page}
      breadcrumb={page}
      contents={rendered.toc}
    >
      <p className="docs-page-kind">
        <Kicker>{pageKindLabel(page)}</Kicker>
      </p>
      <HtmlFragment
        as="article"
        className={`doc-body${authoredHeadingNumberClass(rendered.toc)}`}
        html={article}
      />
      <RelatedDecisions site={site} page={page} />
      <DocumentPager site={site} page={page} />
      <DocumentColophon page={page} />
    </DocumentLayout>
  );
}

/** The complete HTML document for one manual page. */
export function renderManualPage(
  site: DocsSite,
  page: DocsPage,
  rendered: RenderedDoc,
): string {
  return renderDocumentPage({
    title: `${page.entry.title} · discern.sh docs`,
    description: page.entry.description,
    children: <ManualPage site={site} page={page} rendered={rendered} />,
  });
}
