/** A directory of the project's working map, linking each entry to its source. */
import type { ReactElement } from "react";
import { Card, Heading, Kicker, Paragraph } from "discern-design-system/react";
import { PUBLIC_MAP_ROUTE, type PublicMapSite } from "../../docs.tsx";
import { renderDocument } from "../Document.tsx";
import { MarketingLayout } from "../layouts/MarketingLayout.tsx";

/** The directory has no document rails; the repository hosts individual entries. */
export function MapPage(
  { map }: { readonly map: PublicMapSite },
): ReactElement {
  return (
    <MarketingLayout
      currentPath={PUBLIC_MAP_ROUTE}
      mainClassName="map-overview"
    >
      <header className="map-overview-intro">
        <Kicker>Inside the project</Kicker>
        <Heading level={1}>{map.landing.entry.title}</Heading>
        <Paragraph>
          Explore the account of the codebase that discern's coding agents
          maintain for project work and human review. Each entry opens its
          Markdown file in the source repository.
        </Paragraph>
      </header>
      <aside className="map-overview-notice" aria-label="Live project exhibit">
        <Card padding="lg">
          <Kicker>Live project exhibit</Kicker>
          <Paragraph>
            discern is developed under its own practice. This map is working
            evidence from internal use; its authors remain responsible for its
            accuracy.{" "}
            <a href="/docs">Use the manual to learn and work with discern.</a>
          </Paragraph>
        </Card>
      </aside>
      <div className="map-overview-sections">
        {map.sections.map((section) => (
          <section
            key={section.dir}
            className="map-overview-section"
            aria-labelledby={`map-${section.slug}`}
          >
            <div className="map-overview-section-heading">
              <Heading level={2} id={`map-${section.slug}`}>
                <a data-map-entry href={section.index.route}>{section.title}</a>
              </Heading>
              <Paragraph>{section.description}</Paragraph>
            </div>
            <ul>
              {section.pages.filter((page) => !page.isIndex).map((page) => (
                <li key={page.sourcePath}>
                  <a data-map-entry href={page.route}>{page.entry.title}</a>
                  <Paragraph>{page.entry.description}</Paragraph>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </MarketingLayout>
  );
}

/** Use the same document and site navigation as the other public React pages. */
export function renderMapPage(map: PublicMapSite): string {
  return renderDocument({
    title: `${map.landing.entry.title} · discern.sh Map`,
    description: map.landing.entry.description,
    styles: ["fonts.css", "discern.css", "campaign.css", "map.css"],
    scripts: ["discern.js"],
    children: <MapPage map={map} />,
  });
}
