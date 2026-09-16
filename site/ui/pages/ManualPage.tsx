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
  sectionLeaves,
} from "../../docs.tsx";
import { authoredHeadingNumberClass } from "../../document_toc.tsx";
import {
  DocumentLayout,
  renderDocumentPage,
} from "../layouts/DocumentLayout.tsx";
import { DocumentColophon } from "../components/DocumentColophon.tsx";
import { DocumentPager } from "../components/DocumentPager.tsx";
import { HtmlFragment } from "../components/HtmlFragment.tsx";
import { LeafList } from "../components/LeafList.tsx";

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

/** A section landing's canonical leaf list, derived from the model. */
function SectionIndex(
  { site, page }: { readonly site: DocsSite; readonly page: DocsPage },
): ReactElement | null {
  const leaves = sectionLeaves(site, page);
  if (leaves.length === 0) return null;
  return (
    <section className="docs-section-index" aria-label="In this section">
      <h2>In this section</h2>
      <LeafList pages={leaves} ordered />
    </section>
  );
}

/**
 * The article is the body renderer's HTML — Workflow projections, glossary
 * terms, and structural decoration included — followed by a section
 * landing's model-derived leaf list.
 */
export function ManualPage(
  { site, page, rendered }: ManualPageProps,
): ReactElement {
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
      <article
        className={`doc-body${authoredHeadingNumberClass(rendered.toc)}`}
      >
        <HtmlFragment html={decorateDocumentHtml(rendered.html)} />
        <SectionIndex site={site} page={page} />
      </article>
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
