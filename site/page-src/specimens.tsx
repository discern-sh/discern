/** Development-only benefit artwork specimen, rendered to static HTML. */

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge, Brand, SkipLink } from "discern-design-system/react";
import { DISCERN_MARK } from "../brand.ts";
import { BenefitAlignmentArtwork } from "./benefit_alignment.tsx";
import { pageDocument } from "./document.ts";

const PREVIEW_THEMES = ["light", "dark"] as const;
type PreviewTheme = (typeof PREVIEW_THEMES)[number];

/** The product name uses the visual system's one permitted mono treatment. */
function DiscernName(): ReactElement {
  return <span className="specimen-brand-name">discern</span>;
}

/** Render the alignment study inside one fixed design-token theme. */
function AlignmentTheme(
  { theme }: { readonly theme: PreviewTheme },
): ReactElement {
  return (
    <article
      className="specimen-theme"
      data-discern-root
      data-discern-theme={theme}
      aria-label={`Delegate with confidence alignment study, ${theme} theme`}
    >
      <header className="specimen-theme__label" aria-hidden="true">
        <span>{theme}</span>
        <i />
        <small>fixed theme</small>
      </header>
      <BenefitAlignmentArtwork id={`delegate-alignment-${theme}`} />
    </article>
  );
}

/** Focused development sheet for the first benefit artwork study. */
function SpecimenPreview(): ReactElement {
  return (
    <>
      <SkipLink href="#alignment-study">Skip to artwork</SkipLink>
      <header className="specimen-masthead">
        <Brand
          mark={DISCERN_MARK}
          name={<DiscernName />}
          size="lg"
          typeface="mono"
        />
        <div className="specimen-masthead__meta">
          <Badge tone="neutral">Development only</Badge>
          <span>Alignment study · 1A</span>
        </div>
      </header>

      <main id="alignment-study">
        <section
          className="specimen-study"
          aria-labelledby="alignment-study-title"
        >
          <header className="specimen-introduction">
            <p className="specimen-introduction__eyebrow">
              Benefit artwork · 01 / 07
            </p>
            <h1 id="alignment-study-title">Delegate with confidence.</h1>
            <p className="specimen-introduction__caption">
              Correctness, permission, and blast radius are held by separate
              mechanisms, so delegated work is verified rather than taken on
              trust.
            </p>
          </header>

          <div className="specimen-theme-pair">
            {PREVIEW_THEMES.map((theme) => (
              <AlignmentTheme theme={theme} key={theme} />
            ))}
          </div>
        </section>
      </main>

      <footer className="specimen-footer">
        <span>
          <DiscernName /> · benefit artwork study 1A
        </span>
        <span>Static SVG · fixed light and dark token roots</span>
      </footer>
    </>
  );
}

/** Render the development-only study with the shared document shell. */
export function renderSpecimens(): string {
  return pageDocument({
    source: "specimens.tsx",
    title: "Delegate with confidence · alignment study · discern",
    description:
      "Development-only dual-theme alignment artwork for Delegate with confidence.",
    styles: [
      "fonts.css",
      "discern.css",
      "grain.css",
      "specimens.css",
      "benefit_alignment.css",
    ],
    scripts: [],
    body: renderToStaticMarkup(<SpecimenPreview />),
  });
}
