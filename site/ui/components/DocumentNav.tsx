/** The rooted corpus navigation: every published section, README first. */
import type { ReactElement } from "react";
import { DocsNav, type DocsNavSection } from "discern-design-system/react";
import {
  type DocsPage,
  type DocsSection,
  type DocumentLink,
  sectionIndexOf,
} from "../../docs.tsx";

/** The layout's navigation column, which the header's drawer toggle controls. */
export const DOCUMENT_NAVIGATION_ID = "docs-nav";

/** The dialog name the package drawer gives the open navigation. */
export const DOCUMENT_NAVIGATION_LABEL = "Manual navigation";

export interface DocumentNavProps {
  readonly sections: readonly DocsSection[];
  /** The page marked current; null on the cover and decisions. */
  readonly current: DocsPage | null;
  /** List only each section's landing page, for a cover's deliberately small rail. */
  readonly compact?: boolean;
  /** Durable destinations shown beneath the navigation. */
  readonly footLinks: readonly DocumentLink[];
}

/** Section landings read as "Overview"; the section name stays in the accessible name. */
function navigationSections(
  sections: readonly DocsSection[],
  current: DocsPage | null,
  compact: boolean,
): readonly DocsNavSection[] {
  return sections.map((section) => ({
    title: (
      <span className="docs-nav-chapter-title">
        <span className="docs-nav-section-index">
          {sectionIndexOf(section.dir)}
        </span>
        {section.title}
      </span>
    ),
    items: (compact ? [section.index] : section.pages).map((page) => ({
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
  { sections, current, compact = false, footLinks }: DocumentNavProps,
): ReactElement {
  return (
    <>
      <DocsNav
        label="Manual"
        sections={navigationSections(sections, current, compact)}
      />
      <div className="docs-nav-foot discern-mono">
        {footLinks.map(({ label, href }) => (
          <a key={href} href={href}>{label}</a>
        ))}
      </div>
    </>
  );
}
