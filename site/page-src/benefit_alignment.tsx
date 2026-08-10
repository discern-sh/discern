/** Reusable abstract artwork for the "Delegate with confidence" benefit. */

import type { ReactElement } from "react";

export interface BenefitAlignmentArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/**
 * Three geometric planes register into the discern triangle before a narrow
 * aperture settles independently. The authored SVG is the complete final
 * composition; CSS only supplies the optional journey into that state.
 */
export function BenefitAlignmentArtwork(
  { id }: BenefitAlignmentArtworkProps,
): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <figure className="benefit-alignment">
      <svg
        className="benefit-alignment__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>Planes resolving into exact alignment</title>
        <desc id={descriptionId}>
          Three translucent geometric planes settle into one precise,
          half-filled triangle. A narrow central aperture settles afterward as a
          separate condition. The complete final form remains visible without
          motion.
        </desc>

        <g aria-hidden="true">
          <g className="benefit-alignment__construction">
            <path d="M 90 430 H 670" />
            <path d="M 380 66 V 478" />
            <path d="M 188 430 H 208 M 198 420 V 440" />
            <path d="M 552 430 H 572 M 562 420 V 440" />
            <path d="M 370 124 H 390 M 380 114 V 134" />
          </g>

          <ellipse
            className="benefit-alignment__bloom"
            cx="380"
            cy="278"
            rx="62"
            ry="166"
          />

          <path
            className="benefit-alignment__plane benefit-alignment__plane--outline"
            data-alignment-plane="outline"
            d="M 380 124 L 198 430 L 562 430 Z"
          />
          <path
            className="benefit-alignment__plane benefit-alignment__plane--empty"
            data-alignment-plane="empty"
            d="M 380 124 L 198 430 L 380 430 Z"
          />
          <path
            className="benefit-alignment__plane benefit-alignment__plane--filled"
            data-alignment-plane="filled"
            d="M 380 124 L 562 430 L 380 430 Z"
          />

          <g
            className="benefit-alignment__aperture"
            data-alignment-aperture
          >
            <path
              className="benefit-alignment__aperture-clear"
              d="M 376.5 124 H 383.5 V 430 H 376.5 Z"
            />
            <path
              className="benefit-alignment__aperture-edge"
              d="M 380 124 V 430"
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
