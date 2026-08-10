/** Reusable invariant-core artwork for the Freedom of movement benefit. */

import type { ReactNode } from "react";

interface FreedomOfMovementArtProps {
  /** Prefix keeps the SVG accessibility IDs unique when themes sit together. */
  readonly idPrefix: string;
}

const ART_CENTER = { x: 360, y: 280 } as const;

/** Eight short marks constrained to the outer ring's circumference annulus. */
const RADIAL_TICKS = [
  { x1: 360, y1: 126, x2: 360, y2: 112 },
  { x1: 468.9, y1: 171.1, x2: 478.8, y2: 161.2 },
  { x1: 514, y1: 280, x2: 528, y2: 280 },
  { x1: 468.9, y1: 388.9, x2: 478.8, y2: 398.8 },
  { x1: 360, y1: 434, x2: 360, y2: 448 },
  { x1: 251.1, y1: 388.9, x2: 241.2, y2: 398.8 },
  { x1: 206, y1: 280, x2: 192, y2: 280 },
  { x1: 251.1, y1: 171.1, x2: 241.2, y2: 161.2 },
] as const;

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
      data-art-center-x={ART_CENTER.x}
      data-art-center-y={ART_CENTER.y}
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
          <circle
            className="freedom-invariant__radial-ring freedom-invariant__radial-ring--outer"
            data-radial-ring
            cx={ART_CENTER.x}
            cy={ART_CENTER.y}
            r="162"
          />
          <circle
            className="freedom-invariant__radial-ring freedom-invariant__radial-ring--inner"
            data-radial-ring
            cx={ART_CENTER.x}
            cy={ART_CENTER.y}
            r="106"
          />
          {RADIAL_TICKS.map((tick, index) => (
            <line
              className="freedom-invariant__radial-tick"
              data-radial-tick
              x1={tick.x1}
              y1={tick.y1}
              x2={tick.x2}
              y2={tick.y2}
              key={index}
            />
          ))}
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
        transform={`translate(${ART_CENTER.x} ${ART_CENTER.y})`}
        aria-hidden="true"
      >
        <path
          className="freedom-invariant__core-ground"
          d="M 0 -27 L 27 21 H -27 Z"
        />
        <path
          className="freedom-invariant__core-fill"
          d="M 0 -27 L 27 21 H 0 Z"
        />
        <path
          className="freedom-invariant__core-outline"
          d="M 0 -27 L 27 21 H -27 Z"
        />
        <line
          className="freedom-invariant__core-split"
          x1="0"
          y1="-27"
          x2="0"
          y2="21"
        />
      </g>
    </svg>
  );
}
