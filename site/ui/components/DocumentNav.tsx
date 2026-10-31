/** The rooted corpus navigation: every published section, README first. */
import type { ReactElement } from "react";
import {
  DocsNav,
  type DocsNavSection,
  Logo,
} from "discern-design-system/react";
import { DISCERN_MARK } from "../../brand.ts";
import type { DocsPage, DocsSection, DocumentLink } from "../../docs.tsx";

/** The layout's navigation column, which the header's drawer toggle controls. */
export const DOCUMENT_NAVIGATION_ID = "docs-nav";

/** The dialog name the package drawer gives the open navigation. */
export const DOCUMENT_NAVIGATION_LABEL = "Manual navigation";

export interface DocumentNavProps {
  readonly sections: readonly DocsSection[];
  /** The page marked current; null on the cover and decisions. */
  readonly current: DocsPage | null;
  /** Durable destinations shown beneath the navigation. */
  readonly footLinks: readonly DocumentLink[];
}

/**
 * Each section name follows a decorative brand mark that sets it apart from
 * its pages. Section landings read as "Overview"; the section name stays in
 * the accessible name.
 */
function navigationSections(
  sections: readonly DocsSection[],
  current: DocsPage | null,
): readonly DocsNavSection[] {
  return sections.map((section) => ({
    title: (
      <span className="docs-nav-section-heading">
        <Logo className="docs-nav-section-mark" size="sm">
          {DISCERN_MARK}
        </Logo>
        <span className="docs-nav-chapter-title">{section.title}</span>
      </span>
    ),
    items: section.pages.map((page) => ({
      href: page.route,
      current: page.route === current?.route,
      label: page.isIndex
        ? (
          <>
            <span className="discern-visually-hidden">
              {`${section.title} `}
            </span>
            <span className="docs-nav-page-title">Overview</span>
          </>
        )
        : <span className="docs-nav-page-title">{page.entry.title}</span>,
    })),
  }));
}

/** The contents of the layout's navigation column: the package nav, then the reference foot. */
export function DocumentNav(
  { sections, current, footLinks }: DocumentNavProps,
): ReactElement {
  return (
    <>
      <DocsNav
        label="Manual"
        sections={navigationSections(sections, current)}
      />
      <div className="docs-nav-foot discern-mono">
        {footLinks.map(({ label, href }) => (
          <a key={href} href={href}>{label}</a>
        ))}
      </div>
    </>
  );
}
