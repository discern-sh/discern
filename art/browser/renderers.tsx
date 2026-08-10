/** Exhaustive browser renderers derived from the pure artwork registry. */

import type { ReactNode } from "react";
import { BenefitAlignmentArtwork } from "./alignment.tsx";
import { BifurcationArtwork } from "./bifurcation.tsx";
import { QualityContourArtwork } from "./contour.tsx";
import { FreedomOfMovementArt } from "./invariant-core.tsx";
import { PersistentTraceArtwork } from "./persistent-trace.tsx";
import {
  BROWSER_ARTWORKS,
  type BrowserArtworkMetadata,
  type BrowserArtworkSlug,
} from "./registry.ts";

export type BrowserArtworkRenderer = (idPrefix: string) => ReactNode;

/** Rendering is exhaustive over the membership authority, without owning it. */
export const BROWSER_ARTWORK_RENDERERS: Readonly<
  Record<BrowserArtworkSlug, BrowserArtworkRenderer>
> = {
  alignment: (idPrefix) => <BenefitAlignmentArtwork id={idPrefix} />,
  bifurcation: (idPrefix) => <BifurcationArtwork idPrefix={idPrefix} />,
  contour: (idPrefix) => <QualityContourArtwork idPrefix={idPrefix} />,
  "persistent-trace": (idPrefix) => <PersistentTraceArtwork id={idPrefix} />,
  "invariant-core": (idPrefix) => (
    <div className="freedom-invariant__artboard">
      <FreedomOfMovementArt idPrefix={idPrefix} />
    </div>
  ),
};

/** Render-ready projection used by the development gallery. */
export interface BrowserArtworkEntry extends BrowserArtworkMetadata {
  readonly render: BrowserArtworkRenderer;
}

export const BROWSER_ARTWORK_ENTRIES: readonly BrowserArtworkEntry[] =
  BROWSER_ARTWORKS.map((artwork) => ({
    ...artwork,
    render: BROWSER_ARTWORK_RENDERERS[artwork.slug],
  }));
