/** Development-only browser and terminal art gallery, rendered to static HTML. */

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Brand, SkipLink } from "discern-design-system/react";
import {
  BROWSER_ARTWORK_ENTRIES,
  type BrowserArtworkEntry,
} from "../../art/browser/renderers.tsx";
import {
  BROWSER_ART_FOUNDATION_STYLESHEET,
  browserArtworkStylesheetNames,
} from "../../art/browser/registry.ts";
import {
  artGalleryEntries,
  type ArtGalleryEntry,
} from "../../art/terminal/gallery.ts";
import { DISCERN_MARK } from "../brand.ts";
import { SITE_APPEARANCE } from "../appearance.ts";
import { pageDocument } from "./document.ts";

const PREVIEW_THEMES = ["light", "dark"] as const;

/** The product name uses the visual system's one permitted mono treatment. */
function DiscernName(): ReactNode {
  return <span className="art-gallery__brand-name">discern</span>;
}

/** Render one approved motion study in fixed light and dark token roots. */
function BrowserArtwork(
  { artwork, index }: {
    readonly artwork: BrowserArtworkEntry;
    readonly index: number;
  },
): ReactNode {
  const artworkId = `art-${artwork.slug}`;
  const headingId = `art-${artwork.slug}-title`;
  return (
    <article
      className="art-gallery__study"
      id={artworkId}
      aria-labelledby={headingId}
      data-browser-artwork={artwork.slug}
    >
      <header className="art-gallery__study-header">
        <span>{String(index + 1).padStart(2, "0")}</span>
        <div>
          <h3 id={headingId}>
            <a className="art-gallery__permalink" href={`#${artworkId}`}>
              {artwork.title}
            </a>
          </h3>
          <p>{artwork.description}</p>
        </div>
      </header>
      <div className="art-gallery__theme-pair">
        {PREVIEW_THEMES.map((theme) => (
          <section
            className="art-gallery__theme"
            {...SITE_APPEARANCE.rootAttributes}
            data-discern-theme={theme}
            aria-label={`${artwork.title}, ${theme} theme`}
            key={theme}
          >
            <div className="art-gallery__theme-label" aria-hidden="true">
              <span>{theme}</span>
              <i />
            </div>
            <div className="art-gallery__artwork">
              {artwork.render(`${artwork.slug}-${theme}`)}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

/** Render the existing CLI registry into restrained static terminal mockups. */
function TerminalArtwork(
  { artworks }: { readonly artworks: readonly ArtGalleryEntry[] },
): ReactNode {
  return (
    <div className="art-gallery__terminal-grid">
      {artworks.map(({ name, variant }) => (
        <article className="art-gallery__terminal" key={name}>
          <header>
            <span>{name}</span>
            <small>{variant.charset}</small>
          </header>
          <pre aria-label={`${name} terminal artwork`}>
            <code>{variant.render()}</code>
          </pre>
        </article>
      ))}
    </div>
  );
}

/** Compose every internal art authority into one review surface. */
function ArtGallery(
  { browserArtworks, terminalArtworks }: {
    readonly browserArtworks: readonly BrowserArtworkEntry[];
    readonly terminalArtworks: readonly ArtGalleryEntry[];
  },
): ReactNode {
  return (
    <>
      <SkipLink href="#art-gallery">Skip to the art gallery</SkipLink>
      <header className="art-gallery__masthead">
        <Brand
          mark={DISCERN_MARK}
          name={<DiscernName />}
          size="lg"
          typeface="mono"
        />
        <div className="art-gallery__masthead-meta">
          <span>Browser and terminal studies</span>
        </div>
      </header>
      <main className="art-gallery" id="art-gallery">
        <header className="art-gallery__introduction">
          <p className="art-gallery__eyebrow">Internal visual archive</p>
          <h1>Art studies.</h1>
          <p>
            Approved browser motion pieces and the terminal experiments that
            preceded them, kept together as working references. The browser
            studies render in fixed light and dark themes; terminal pieces are
            projected directly from their CLI registries.
          </p>
          <nav aria-label="Art families on this page">
            <a href="#browser-art">Browser motion studies</a>
            <a href="#terminal-art">Terminal studies</a>
          </nav>
        </header>

        <section className="art-gallery__family" id="browser-art">
          <header className="art-gallery__family-header">
            <div>
              <p>01 · Browser</p>
              <h2>Geometric motion studies</h2>
            </div>
            <p>
              Scalable, token-driven SVG compositions. Motion is decorative;
              each retains its meaning when animation is reduced.
            </p>
          </header>
          {browserArtworks.map((artwork, index) => (
            <BrowserArtwork
              artwork={artwork}
              index={index}
              key={artwork.slug}
            />
          ))}
        </section>

        <section className="art-gallery__family" id="terminal-art">
          <header className="art-gallery__family-header">
            <div>
              <p>02 · Terminal</p>
              <h2>CLI reference studies</h2>
            </div>
            <p>
              Static browser mockups of the same registry members printed by
              {" "}
              <code>deno task art</code>. Their semantic timelines remain
              available through{"  "}<code>--animate</code>{" "}
              in a capable terminal.
            </p>
          </header>
          <TerminalArtwork artworks={terminalArtworks} />
        </section>
      </main>
      <footer className="art-gallery__footer">
        <span>
          <DiscernName /> · internal art archive
        </span>
        <span>Static HTML and CSS · outside the public route registry</span>
      </footer>
    </>
  );
}

/** Render the development-only gallery with every registry-owned stylesheet. */
export function renderArtGallery(
  browserArtworks: readonly BrowserArtworkEntry[] = BROWSER_ARTWORK_ENTRIES,
  terminalArtworks: readonly ArtGalleryEntry[] = artGalleryEntries(),
): string {
  return pageDocument({
    source: "art-gallery.tsx",
    title: "Art studies · discern",
    description:
      "Development-only browser motion and terminal artwork references.",
    styles: [
      "fonts.css",
      "discern.css",
      "grain.css",
      "art-gallery.css",
      BROWSER_ART_FOUNDATION_STYLESHEET,
      ...browserArtworkStylesheetNames(browserArtworks),
    ],
    scripts: [],
    body: renderToStaticMarkup(
      <ArtGallery
        browserArtworks={browserArtworks}
        terminalArtworks={terminalArtworks}
      />,
    ),
  });
}
