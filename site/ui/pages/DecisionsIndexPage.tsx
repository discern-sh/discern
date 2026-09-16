/** The project-history index, deliberately outside the product-documentation nav. */
import type { ReactElement } from "react";
import type { DecisionPage, DocsSite } from "../../docs.tsx";
import {
  DocumentLayout,
  renderDocumentPage,
} from "../layouts/DocumentLayout.tsx";
import { DocumentColophon } from "../components/DocumentColophon.tsx";
import { ProjectHistoryNotice } from "../components/ProjectHistoryNotice.tsx";

/** Linked decision titles with visible superseded status. */
function DecisionList(
  { pages }: { readonly pages: readonly DecisionPage[] },
): ReactElement {
  return (
    <ol className="docs-decision-list">
      {pages.map((page) => (
        <li key={page.route}>
          <a href={page.route}>{page.entry.title}</a>
          {page.superseded && (
            <span className="docs-decision-status">Superseded</span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Current records first; superseded ones remain because the path matters. */
export function DecisionsIndexPage(
  { site }: { readonly site: DocsSite },
): ReactElement {
  const active = site.decisions.pages.filter((page) => !page.superseded);
  const superseded = site.decisions.pages.filter((page) => page.superseded);
  return (
    <DocumentLayout site={site} current={null} breadcrumb="decisions">
      <ProjectHistoryNotice superseded={false} />
      <article className="doc-body docs-decisions-index">
        <h1>Project decisions</h1>
        <p>
          The numbered records preserve the context and trade-offs behind
          discern's architecture.
        </p>
        <h2>Current records</h2>
        <DecisionList pages={active} />
        <h2>Superseded records</h2>
        <p>
          These records remain available because the path to today's design is
          part of the history.
        </p>
        <DecisionList pages={superseded} />
      </article>
      <DocumentColophon page={null} index="decisions" />
    </DocumentLayout>
  );
}

/** The complete HTML document for the decisions index. */
export function renderDecisionsIndexPage(site: DocsSite): string {
  return renderDocumentPage({
    title: "Project decisions · discern.sh docs",
    description:
      "Project-history records explaining the decisions behind discern.",
    children: <DecisionsIndexPage site={site} />,
  });
}
