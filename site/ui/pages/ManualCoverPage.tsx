/** The manual's front door: its authored root plus the model-derived directory. */
import type { ReactElement } from "react";
import {
  decorateDocumentHtml,
  type DocsSection,
  type DocsSite,
  manualLandingParts,
  type RenderedDoc,
  sectionIndexOf,
} from "../../docs.tsx";
import { authoredHeadingNumberClass } from "../../document_toc.tsx";
import {
  DocumentLayout,
  renderDocumentPage,
} from "../layouts/DocumentLayout.tsx";
import { DocumentColophon } from "../components/DocumentColophon.tsx";
import { HtmlFragment } from "../components/HtmlFragment.tsx";
import { LeafList } from "../components/LeafList.tsx";

/** The scarce journeys the authored root promotes; the site never copies the set. */
function FrontDoors({ site }: { readonly site: DocsSite }): ReactElement {
  return (
    <section className="docs-front-doors" aria-label="Start here">
      <h2>Start here</h2>
      <LeafList className="docs-chapter-leaves" pages={site.frontDoors} />
    </section>
  );
}

/** One published section with every leaf beneath its landing. */
function Chapter({ section }: { readonly section: DocsSection }): ReactElement {
  return (
    <section className="docs-chapter">
      <span className="docs-chapter-index" aria-hidden="true">
        {sectionIndexOf(section.dir)}
      </span>
      <div className="docs-chapter-body">
        <h2>
          <a href={section.index.route}>{section.title}</a>
        </h2>
        <p className="docs-chapter-desc">{section.description}</p>
        <LeafList
          className="docs-chapter-leaves"
          pages={section.pages.filter((page) => !page.isIndex)}
        />
      </div>
    </section>
  );
}

/** The complete published tree, in the registry's reading order. */
function CompleteBrowse({ site }: { readonly site: DocsSite }): ReactElement {
  return (
    <section
      className="docs-complete-browse docs-complete-browse--expanded"
      aria-label="Complete manual"
    >
      <div className="docs-chapters">
        {site.sections.map((section) => (
          <Chapter key={section.dir} section={section} />
        ))}
      </div>
    </section>
  );
}

/**
 * The authored introduction leads; the promoted journeys follow it; the
 * remaining authored orientation and the complete directory close. The rail
 * lists only section landings, keeping the cover's wayfinding small.
 */
export function ManualCoverPage(
  { site, rendered }: {
    readonly site: DocsSite;
    readonly rendered: RenderedDoc;
  },
): ReactElement {
  const [introduction, details] = manualLandingParts(rendered.html);
  return (
    <DocumentLayout
      site={site}
      current={null}
      compactNavigation
      breadcrumb={null}
    >
      <article
        className={`doc-body docs-cover docs-manual-index${
          authoredHeadingNumberClass(rendered.toc)
        }`}
      >
        <HtmlFragment html={decorateDocumentHtml(introduction)} />
        <FrontDoors site={site} />
        <HtmlFragment
          className="docs-manual-details"
          html={decorateDocumentHtml(details)}
        />
        <CompleteBrowse site={site} />
      </article>
      <DocumentColophon page={null} />
    </DocumentLayout>
  );
}

/** The complete HTML document for the manual cover. */
export function renderManualCoverPage(
  site: DocsSite,
  rendered: RenderedDoc,
): string {
  return renderDocumentPage({
    title: `${site.landing.entry.title} · discern.sh docs`,
    description: site.landing.entry.description,
    children: <ManualCoverPage site={site} rendered={rendered} />,
  });
}
