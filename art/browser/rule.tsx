/** Reusable rule artwork. */

import type { ReactElement } from "react";

export interface RuleArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/**
 * Placeholder composition for the rule figure. The authored SVG is the
 * complete resolved state; the stylesheet supplies the journey into it.
 */
export function RuleArtwork(
  { id }: RuleArtworkProps,
): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <figure className="fig fig-rule">
      <svg
        className="fig__art fig-rule__art"
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
            className="fig-rule__placeholder"
            points="380,214 330,326 430,326"
          />
          <polygon
            className="fig-rule__placeholder-fill"
            points="380,214 430,326 380,326"
          />
        </g>
      </svg>
    </figure>
  );
}
