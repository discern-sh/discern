/** Reusable circuit artwork. */

import type { ReactElement } from "react";

export interface CircuitArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/**
 * Placeholder composition for the circuit figure. The authored SVG is the
 * complete resolved state; the stylesheet supplies the journey into it.
 */
export function CircuitArtwork(
  { id }: CircuitArtworkProps,
): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <figure className="fig fig-circuit">
      <svg
        className="fig__art fig-circuit__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>A study awaiting its composition</title>
        <desc id={descriptionId}>
          A single half-filled triangle rests at the centre of an empty plate
          while the finished composition is prepared.
        </desc>
        <g aria-hidden="true">
          <polygon
            className="fig-circuit__placeholder"
            points="380,214 330,326 430,326"
          />
          <polygon
            className="fig-circuit__placeholder-fill"
            points="380,214 430,326 380,326"
          />
        </g>
      </svg>
    </figure>
  );
}
