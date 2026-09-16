/** One rendered decision record, labeled as history rather than product documentation. */
import type { ReactElement } from "react";
import {
  type DecisionPage as DecisionRecord,
  decorateDocumentHtml,
  type DocsSite,
  type RenderedDoc,
} from "../../docs.tsx";
import { authoredHeadingNumberClass } from "../../document_toc.tsx";
import {
  DocumentLayout,
  renderDocumentPage,
} from "../layouts/DocumentLayout.tsx";
import { DocumentColophon } from "../components/DocumentColophon.tsx";
import { HtmlFragment } from "../components/HtmlFragment.tsx";
import { ProjectHistoryNotice } from "../components/ProjectHistoryNotice.tsx";

export interface DecisionPageProps {
  readonly site: DocsSite;
  readonly page: DecisionRecord;
  readonly rendered: RenderedDoc;
}

/** Records keep the manual's chrome and contents rail but never its navigation mark. */
export function DecisionPage(
  { site, page, rendered }: DecisionPageProps,
): ReactElement {
  return (
    <DocumentLayout
      site={site}
      current={null}
      breadcrumb={page}
      contents={rendered.toc}
    >
      <ProjectHistoryNotice superseded={page.superseded} />
      <HtmlFragment
        as="article"
        className={`doc-body docs-decision-record${
          authoredHeadingNumberClass(rendered.toc)
        }`}
        html={decorateDocumentHtml(rendered.html)}
      />
      <DocumentColophon page={page} />
    </DocumentLayout>
  );
}

/** The complete HTML document for one decision record. */
export function renderDecisionPage(
  site: DocsSite,
  page: DecisionRecord,
  rendered: RenderedDoc,
): string {
  return renderDocumentPage({
    title: `${page.entry.title} · discern.sh docs`,
    description: page.entry.description,
    children: <DecisionPage site={site} page={page} rendered={rendered} />,
  });
}
