/** Development-only dual-theme preview for the bifurcation benefit artwork. */

import { renderToStaticMarkup } from "react-dom/server";
import { Badge, Brand, SkipLink } from "discern-design-system/react";
import { DISCERN_MARK } from "../brand.ts";
import { BifurcationArtwork } from "./benefit-art-bifurcation.tsx";
import { pageDocument } from "./document.ts";

const PREVIEW_THEMES = ["light", "dark"] as const;

/** The reserved monospaced treatment for the product name. */
function DiscernName() {
  return <span className="benefit-art-preview__brand">discern</span>;
}

/** Hold one fixed token theme around the same reusable artwork. */
function ThemeStudy({ theme }: { readonly theme: "light" | "dark" }) {
  return (
    <article
      className="benefit-art-preview__theme"
      data-discern-root
      data-discern-theme={theme}
      aria-label={`Bifurcation study, ${theme} theme`}
    >
      <header className="benefit-art-preview__theme-label" aria-hidden="true">
        <span>{theme}</span>
        <i />
      </header>
      <BifurcationArtwork idPrefix={`bifurcation-${theme}`} />
    </article>
  );
}

/** Focused gallery page for judging the study at production-like breakpoints. */
function BifurcationSpecimenPreview() {
  return (
    <>
      <SkipLink href="#bifurcation-study">Skip to the artwork</SkipLink>
      <header className="benefit-art-preview__masthead">
        <Brand
          mark={DISCERN_MARK}
          name={<DiscernName />}
          size="lg"
          typeface="mono"
        />
        <div className="benefit-art-preview__meta">
          <Badge tone="neutral">Development only</Badge>
          <span>Benefit art · 1B</span>
        </div>
      </header>

      <main id="bifurcation-study" className="benefit-art-preview">
        <header className="benefit-art-preview__introduction">
          <p className="benefit-art-preview__eyebrow">
            Bifurcation study · one of seven
          </p>
          <h1>Multiply your output.</h1>
          <p>
            Isolation, delegation shapes, and fleet coordination raise how much
            work can be in flight at once.
          </p>
        </header>

        <section
          className="benefit-art-preview__gallery"
          aria-label="Bifurcation artwork in fixed light and dark themes"
        >
          {PREVIEW_THEMES.map((theme) => (
            <ThemeStudy theme={theme} key={theme} />
          ))}
        </section>
      </main>

      <footer className="benefit-art-preview__footer">
        <span>Native SVG and CSS · 10.8 second loop</span>
        <span>Static culmination preserved when motion is reduced</span>
      </footer>
    </>
  );
}

/** Render the development-only study with the shared static document shell. */
export function renderBifurcationSpecimen(): string {
  return pageDocument({
    source: "benefit-art-bifurcation-preview.tsx",
    title: "Multiply your output · bifurcation study · discern",
    description:
      "Development-only dual-theme bifurcation study for Multiply your output.",
    styles: [
      "fonts.css",
      "discern.css",
      "grain.css",
      "benefit-art-bifurcation.css",
    ],
    scripts: [],
    body: renderToStaticMarkup(<BifurcationSpecimenPreview />),
  });
}
