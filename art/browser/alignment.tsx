/** Reusable alignment artwork. */

import type { ReactElement } from "react";

export interface AlignmentArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/**
 * Three geometric planes register into the discern triangle before a compact
 * authority mark settles nearby. The authored SVG is the complete final
 * composition; CSS only supplies the optional journey into that state.
 */
export function AlignmentArtwork(
  { id }: AlignmentArtworkProps,
): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <figure className="alignment-art">
      <svg
        className="alignment-art__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>Planes resolving into exact alignment</title>
        <desc id={descriptionId}>
          Three translucent geometric planes settle into one precise,
          half-filled triangle. A short blue registration mark settles nearby as
          a separate condition. The complete final form remains visible without
          motion.
        </desc>

        <g aria-hidden="true">
          <g className="alignment-art__construction">
            <line x1="380" y1="66" x2="380" y2="98" />
            <line x1="380" y1="456" x2="380" y2="478" />
            <line x1="90" y1="430" x2="166" y2="430" />
            <line x1="594" y1="430" x2="670" y2="430" />
          </g>

          <ellipse
            className="alignment-art__bloom"
            cx="380"
            cy="278"
            rx="62"
            ry="166"
          />

          <polygon
            className="alignment-art__plane alignment-art__plane--outline"
            data-alignment-plane="outline"
            points="380,124 198,430 562,430"
          />
          <polygon
            className="alignment-art__plane alignment-art__plane--ghost"
            data-alignment-plane="ghost"
            points="380,124 198,430 380,430"
          />
          <polygon
            className="alignment-art__plane alignment-art__plane--filled"
            data-alignment-plane="filled"
            points="380,124 562,430 380,430"
          />

          <line
            className="alignment-art__authority"
            data-alignment-authority
            x1="578"
            y1="340"
            x2="592"
            y2="364"
          />
        </g>
      </svg>
    </figure>
  );
}
