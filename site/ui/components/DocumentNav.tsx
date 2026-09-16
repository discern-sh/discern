/** The rooted corpus navigation: every published section, README first. */
import type { ReactElement } from "react";
import { DocsNav, type DocsNavSection } from "discern-design-system/react";
import {
  type DocsSection,
  type DocumentCorpus,
  type DocumentLink,
  type NavigablePage,
  type PublicMapSection,
  sectionIndexOf,
} from "../../docs.tsx";

/** The drawer control names this element; page-owned script toggles it. */
export const DOCUMENT_NAVIGATION_ID = "docs-nav";

export interface DocumentNavProps {
  readonly corpus: DocumentCorpus;
  readonly sections: readonly (DocsSection | PublicMapSection)[];
  /** The page marked current; null on a corpus root. */
  readonly current: NavigablePage | null;
  /** List only each section's landing page, for a cover's deliberately small rail. */
  readonly compact?: boolean;
  /** Durable destinations shown beneath the navigation. */
  readonly footLinks: readonly DocumentLink[];
}

/** Section landings read as "Overview"; the section name stays in the accessible name. */
function navigationSections(
  sections: readonly (DocsSection | PublicMapSection)[],
  current: NavigablePage | null,
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
            <span className="docs-visually-hidden">{`${section.title} `}</span>
            <span className="docs-nav-page-title">Overview</span>
          </>
        )
        : <span className="docs-nav-page-title">{page.entry.title}</span>,
    })),
  }));
}

/**
 * Below the drawer breakpoint, page-owned script turns the `aside` into a
 * modal dialog; without script it stays in flow above the document.
 */
export function DocumentNav(
  { corpus, sections, current, compact = false, footLinks }: DocumentNavProps,
): ReactElement {
  return (
    <aside className="docs-nav" id={DOCUMENT_NAVIGATION_ID}>
      <DocsNav
        className="docs-nav-scroll"
        label={corpus === "map" ? "Live Map" : "Manual"}
        sections={navigationSections(sections, current, compact)}
      />
      <div className="docs-nav-foot discern-mono">
        {footLinks.map(({ label, href }) => (
          <a key={href} href={href}>{label}</a>
        ))}
      </div>
    </aside>
  );
}
