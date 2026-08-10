/** Reusable invariant-core artwork for the Freedom of movement benefit. */

import type { ReactNode } from "react";

interface FreedomOfMovementArtProps {
  /** Prefix keeps the SVG accessibility IDs unique when themes sit together. */
  readonly idPrefix: string;
}

/**
 * Draw three changing coordinate systems around one fixed split triangle.
 * The core is intentionally outside the transforming apparatus group.
 */
export function FreedomOfMovementArt(
  { idPrefix }: FreedomOfMovementArtProps,
): ReactNode {
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;

  return (
    <svg
      className="freedom-invariant__art"
      viewBox="0 0 720 560"
      role="img"
      aria-labelledby={`${titleId} ${descriptionId}`}
    >
      <title id={titleId}>Freedom of movement: invariant core</title>
      <desc id={descriptionId}>
        Cartesian, oblique, and radial hairline frames change around a small
        split triangle that remains fixed at their shared center. The complete
        meaning is visible without motion.
      </desc>

      <g
        className="freedom-invariant__apparatus"
        data-transforming-apparatus
        aria-hidden="true"
      >
        <g
          className="freedom-invariant__frame freedom-invariant__frame--cartesian"
          data-coordinate-frame="cartesian"
        >
          <rect x="134" y="54" width="452" height="452" />
          <line x1="112" y1="280" x2="608" y2="280" />
          <line x1="360" y1="32" x2="360" y2="528" />
          <path d="M 134 68 V 54 H 148 M 572 54 H 586 V 68 M 586 492 V 506 H 572 M 148 506 H 134 V 492" />
        </g>

        <g
          className="freedom-invariant__frame freedom-invariant__frame--oblique"
          data-coordinate-frame="oblique"
        >
          <path d="M 360 82 L 552 280 L 360 478 L 168 280 Z" />
          <line x1="196" y1="172" x2="524" y2="388" />
          <line x1="196" y1="388" x2="524" y2="172" />
          <path d="M 349 93 L 360 82 L 371 93 M 541 269 L 552 280 L 541 291 M 371 467 L 360 478 L 349 467 M 179 291 L 168 280 L 179 269" />
        </g>

        <g
          className="freedom-invariant__frame freedom-invariant__frame--radial"
          data-coordinate-frame="radial"
        >
          <circle cx="360" cy="280" r="156" />
          <circle cx="360" cy="280" r="92" />
          <path d="M 360 104 V 128 M 360 432 V 456 M 184 280 H 208 M 512 280 H 536 M 235.5 155.5 L 252.5 172.5 M 467.5 387.5 L 484.5 404.5 M 484.5 155.5 L 467.5 172.5 M 252.5 387.5 L 235.5 404.5" />
        </g>
      </g>

      <circle
        className="freedom-invariant__bloom"
        cx="360"
        cy="280"
        r="45"
        aria-hidden="true"
      />

      <g
        className="freedom-invariant__core"
        data-invariant-core
        aria-hidden="true"
      >
        <path
          className="freedom-invariant__core-ground"
          d="M 360 253 L 384 296 H 336 Z"
        />
        <path
          className="freedom-invariant__core-fill"
          d="M 360 253 L 384 296 H 360 Z"
        />
        <path
          className="freedom-invariant__core-outline"
          d="M 360 253 L 384 296 H 336 Z"
        />
        <line
          className="freedom-invariant__core-split"
          x1="360"
          y1="253"
          x2="360"
          y2="296"
        />
      </g>
    </svg>
  );
}
