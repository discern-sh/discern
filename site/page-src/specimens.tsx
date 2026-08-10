/** Development-only dual-theme preview for the persistent-trace benefit art. */

import { renderToStaticMarkup } from "react-dom/server";
import { Badge, Brand, SkipLink } from "discern-design-system/react";
import { DISCERN_MARK } from "../brand.ts";
import { PersistentTraceArtwork } from "./benefit-persistent-trace.tsx";
import { pageDocument } from "./document.ts";

const PREVIEW_THEMES = ["light", "dark"] as const;

/** The product name keeps the visual system's reserved mono treatment. */
function DiscernName() {
  return <span className="persistent-trace-demo__brand-name">discern</span>;
}

/** One focused study shown in deterministic light and dark token roots. */
function PersistentTracePreview() {
  return (
    <>
      <SkipLink href="#persistent-trace-study">Skip to the artwork</SkipLink>
      <header className="persistent-trace-demo__masthead">
        <Brand
          mark={DISCERN_MARK}
          name={<DiscernName />}
          size="lg"
          typeface="mono"
        />
        <div className="persistent-trace-demo__meta">
          <Badge tone="neutral">Development only</Badge>
          <span>Benefit art · 04 / 07</span>
        </div>
      </header>

      <main
        className="persistent-trace-demo"
        id="persistent-trace-study"
      >
        <header className="persistent-trace-demo__introduction">
          <p className="persistent-trace-demo__eyebrow">
            Persistent trace study
          </p>
          <h1>Knowledge that compounds</h1>
          <p>
            What one session learns, every later session and every configured
            agent inherits.
          </p>
        </header>

        <section
          className="persistent-trace-demo__themes"
          aria-label="Persistent trace in fixed light and dark themes"
        >
          {PREVIEW_THEMES.map((theme) => (
            <article
              className="persistent-trace-demo__theme"
              data-discern-root
              data-discern-theme={theme}
              aria-label={`${theme} theme study`}
              key={theme}
            >
              <header className="persistent-trace-demo__theme-label">
                <span>{theme}</span>
                <i aria-hidden="true" />
              </header>
              <PersistentTraceArtwork id={`persistent-trace-${theme}`} />
            </article>
          ))}
        </section>
      </main>

      <footer className="persistent-trace-demo__footer">
        <span>
          <DiscernName /> · benefit artwork prototype
        </span>
        <span>Static HTML and SVG · outside the public route registry</span>
      </footer>
    </>
  );
}

/** Render the focused development sheet with the shared document shell. */
export function renderSpecimens(): string {
  return pageDocument({
    source: "specimens.tsx",
    title: "Knowledge that compounds · benefit art study · discern",
    description:
      "Development-only dual-theme persistent-trace benefit artwork.",
    styles: [
      "fonts.css",
      "discern.css",
      "grain.css",
      "specimens.css",
      "benefit-persistent-trace.css",
    ],
    scripts: [],
    body: renderToStaticMarkup(<PersistentTracePreview />),
  });
}
