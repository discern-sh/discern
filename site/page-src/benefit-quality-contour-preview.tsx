/** Development-only dual-theme preview for benefit artwork study 1C. */

import { renderToStaticMarkup } from "react-dom/server";
import { Brand, SkipLink } from "discern-design-system/react";
import { DISCERN_MARK } from "../brand.ts";
import { QualityContourArtwork } from "./benefit-quality-contour.tsx";
import { pageDocument } from "./document.ts";

const PREVIEW_THEMES = ["light", "dark"] as const;

/** The product name uses the visual system's reserved mono treatment. */
function DiscernName() {
  return <span className="quality-study__brand-name">discern</span>;
}

/** One fixed-theme gallery frame for direct comparison. */
function ThemeStudy({ theme }: { readonly theme: "light" | "dark" }) {
  return (
    <article
      className="quality-study__theme"
      data-discern-root
      data-discern-theme={theme}
      aria-label={`One-way contour, ${theme} theme`}
    >
      <header className="quality-study__theme-label" aria-hidden="true">
        <span>{theme}</span>
        <i />
      </header>
      <QualityContourArtwork idPrefix={`quality-contour-${theme}`} />
    </article>
  );
}

/** Focused development sheet for the quality-retention benefit artwork. */
function QualityContourPreview() {
  return (
    <>
      <SkipLink href="#quality-study">Skip to the contour study</SkipLink>
      <header className="quality-study__masthead">
        <Brand
          mark={DISCERN_MARK}
          name={<DiscernName />}
          size="lg"
          typeface="mono"
        />
        <div className="quality-study__masthead-meta">
          <span>Development only</span>
          <i aria-hidden="true" />
          <span>Benefit artwork · 1C</span>
        </div>
      </header>

      <main id="quality-study" className="quality-study">
        <header className="quality-study__introduction">
          <p className="quality-study__eyebrow">
            One-way contour · visual study 1C
          </p>
          <h1>Quality that only improves</h1>
          <p className="quality-study__caption">
            Quality numbers and disciplines only tighten: regression fails the
            Gate before it reaches review.
          </p>
        </header>

        <section
          className="quality-study__comparison"
          aria-labelledby="quality-study-comparison-title"
        >
          <header className="quality-study__comparison-heading">
            <h2 id="quality-study-comparison-title">Theme study</h2>
            <p>Fixed light and dark renderings</p>
          </header>
          <div className="quality-study__theme-pair">
            {PREVIEW_THEMES.map((theme) => (
              <ThemeStudy theme={theme} key={theme} />
            ))}
          </div>
        </section>
      </main>

      <footer className="quality-study__footer">
        <span>Native SVG and CSS · outside the public route registry</span>
        <span>Motion is decorative; the retained contours remain complete</span>
      </footer>
    </>
  );
}

/** Render the focused development study with the shared document shell. */
export function renderQualityContourPreview(): string {
  return pageDocument({
    source: "benefit-quality-contour-preview.tsx",
    title: "Quality that only improves · discern",
    description: "Development-only dual-theme one-way contour benefit artwork.",
    styles: [
      "fonts.css",
      "discern.css",
      "grain.css",
      "benefit-quality-contour.css",
    ],
    scripts: [],
    body: renderToStaticMarkup(<QualityContourPreview />),
  });
}
