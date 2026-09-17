/** The reading chrome every manual and decision page shares. */
import type { ReactElement, ReactNode } from "react";
import { Breadcrumbs, DocsLayout, SkipLink } from "discern-design-system/react";
import {
  type BreadcrumbTarget,
  breadcrumbTrail,
  type DocsPage,
  type DocsSite,
  NAVIGATION_FOOT_LINKS,
} from "../../docs.tsx";
import { DOCUMENT_SEARCH_ROUTES } from "../../routes.ts";
import type { TocItem } from "../../document_toc.ts";
import { renderDocument } from "../Document.tsx";
import { DocumentContents } from "../components/DocumentContents.tsx";
import { DocumentHeader } from "../components/DocumentHeader.tsx";
import {
  DOCUMENT_NAVIGATION_ID,
  DOCUMENT_NAVIGATION_LABEL,
  DocumentNav,
} from "../components/DocumentNav.tsx";
import { DocumentSearch } from "../components/DocumentSearch.tsx";
import { HtmlFragment } from "../components/HtmlFragment.tsx";

/** The skip link's destination: the layout's main landmark. */
const MAIN_ID = "doc";

/**
 * Marks the root before the first stylesheet resolves. The package drawer
 * reads its own marker so the navigation can start off-canvas without a
 * layout shift; the site class hides its script-only search control.
 */
const ENHANCEMENT_BOOTSTRAP =
  'document.documentElement.classList.add("docs-js");' +
  'document.documentElement.setAttribute("data-discern-docs-drawer-enhanced","");';

export interface DocumentLayoutProps {
  readonly site: DocsSite;
  /** The page the navigation highlights; null on the manual cover and decisions. */
  readonly current: DocsPage | null;
  /** List only section landings, for the cover's deliberately small rail. */
  readonly compactNavigation?: boolean;
  /** The page family represented in the breadcrumb trail. */
  readonly breadcrumb: BreadcrumbTarget;
  /** The contents rail; empty when the page has no headings. */
  readonly contents?: readonly TocItem[];
  /** Everything inside `<main>`, breadcrumbs excluded. */
  readonly children: ReactNode;
}

/**
 * Top bar, then the package Docs layout: chapter navigation, one `<main>`,
 * and the contents rail, with the package's drawer behavior activating the
 * header's toggle at a narrow allocation. Page-owned script adds search,
 * copy, and scroll-spy behaviors; without it every destination stays in flow.
 */
export function DocumentLayout(
  {
    site,
    current,
    compactNavigation = false,
    breadcrumb,
    contents = [],
    children,
  }: DocumentLayoutProps,
): ReactElement {
  const trail = breadcrumbTrail(site, breadcrumb);
  return (
    <>
      <SkipLink className="docs-skip" href={`#${MAIN_ID}`}>
        Skip to content
      </SkipLink>
      <DocumentHeader
        rootRoute="/docs"
        contextLabel="/docs"
        searchLabel="the manual"
        navigationId={DOCUMENT_NAVIGATION_ID}
      />
      <DocsLayout
        className="docs-layout"
        mainId={MAIN_ID}
        navigationId={DOCUMENT_NAVIGATION_ID}
        navigationLabel={DOCUMENT_NAVIGATION_LABEL}
        navigation={
          <DocumentNav
            sections={site.sections}
            current={current}
            compact={compactNavigation}
            footLinks={NAVIGATION_FOOT_LINKS}
          />
        }
        railLabel="Contents"
        rail={contents.length > 0
          ? <DocumentContents items={contents} />
          : undefined}
      >
        <Breadcrumbs
          className="docs-crumbs"
          items={trail.ancestors}
          current={trail.current}
        />
        {children}
      </DocsLayout>
      <DocumentSearch
        searchLabel="the manual"
        endpoint={DOCUMENT_SEARCH_ROUTES.manual}
      />
    </>
  );
}

export interface DocumentPageProps {
  /** Contents of the `<title>` element. */
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}

/** Serialize one document page with the Docs bundle and the page-owned assets. */
export function renderDocumentPage(
  { title, description, children }: DocumentPageProps,
): string {
  return renderDocument({
    title,
    description,
    bundle: "docs",
    styles: ["fonts.css", "discern.css"],
    siteStyles: ["/assets/docs.css"],
    scripts: ["discern.js"],
    siteModules: ["/assets/docs.js"],
    head: <HtmlFragment as="script" html={ENHANCEMENT_BOOTSTRAP} />,
    children,
  });
}
