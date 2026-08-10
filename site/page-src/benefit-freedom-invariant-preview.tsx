/** Focused development-only preview for the Freedom of movement study. */

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Badge, Brand, SkipLink } from "discern-design-system/react";
import { DISCERN_MARK } from "../brand.ts";
import { pageDocument } from "./document.ts";
import { FreedomOfMovementArt } from "./benefit-freedom-invariant.tsx";

const PREVIEW_THEMES = ["light", "dark"] as const;

interface FreedomInvariantPreviewProps {
  readonly reducedMotion: boolean;
}

interface FreedomInvariantPreviewOptions {
  readonly reducedMotion?: boolean;
}

/** Reserve monospace for the product name, as required by the brand canon. */
function DiscernName(): ReactNode {
  return <span className="freedom-invariant__brand-name">discern</span>;
}

/** Render the same artwork under a fixed design-token theme. */
function ThemeStudy(
  { theme }: { readonly theme: typeof PREVIEW_THEMES[number] },
): ReactNode {
  return (
    <article
      className="freedom-invariant__theme"
      data-discern-root
      data-discern-theme={theme}
      aria-label={`Freedom of movement, ${theme} theme`}
    >
      <header className="freedom-invariant__theme-label" aria-hidden="true">
        <span>{theme}</span>
        <i />
      </header>
      <div className="freedom-invariant__artboard">
        <FreedomOfMovementArt idPrefix={`freedom-invariant-${theme}`} />
      </div>
    </article>
  );
}

/** The focused dual-theme study page used only by the specimen server. */
function FreedomInvariantPreview(
  { reducedMotion }: FreedomInvariantPreviewProps,
): ReactNode {
  return (
    <div
      className="freedom-invariant__page"
      data-motion={reducedMotion ? "reduce" : undefined}
    >
      <SkipLink href="#freedom-invariant-study">Skip to the study</SkipLink>
      <header className="freedom-invariant__masthead">
        <Brand
          mark={DISCERN_MARK}
          name={<DiscernName />}
          size="lg"
          typeface="mono"
        />
        <div className="freedom-invariant__masthead-meta">
          <Badge tone="neutral">Development only</Badge>
          <span>Benefit study · 1E</span>
        </div>
      </header>

      <main
        className="freedom-invariant__main"
        id="freedom-invariant-study"
      >
        <header className="freedom-invariant__introduction">
          <span className="freedom-invariant__index" aria-hidden="true">
            05 / 07
          </span>
          <div>
            <p className="freedom-invariant__eyebrow">
              Benefit study · invariant core
            </p>
            <h1>Freedom of movement</h1>
            <p className="freedom-invariant__caption">
              Nothing about the practice binds the project to one agent vendor,
              one stack, or to discern itself.
            </p>
          </div>
        </header>

        <section
          className="freedom-invariant__theme-pair"
          aria-label="Fixed light and dark theme comparison"
        >
          {PREVIEW_THEMES.map((theme) => (
            <ThemeStudy theme={theme} key={theme} />
          ))}
        </section>
      </main>

      <footer className="freedom-invariant__footer">
        <span>Native SVG and CSS</span>
        <span>Motion optional · meaning remains visible</span>
      </footer>
    </div>
  );
}

/** Render the focused study with the shared static document shell. */
export function renderFreedomInvariantPreview(
  options: FreedomInvariantPreviewOptions = {},
): string {
  return pageDocument({
    source: "benefit-freedom-invariant-preview.tsx",
    title: "Freedom of movement study · discern",
    description:
      "A development-only dual-theme study for the Freedom of movement benefit.",
    styles: [
      "fonts.css",
      "discern.css",
      "grain.css",
      "benefit-freedom-invariant.css",
    ],
    scripts: [],
    body: renderToStaticMarkup(
      <FreedomInvariantPreview
        reducedMotion={options.reducedMotion ?? false}
      />,
    ),
  });
}
