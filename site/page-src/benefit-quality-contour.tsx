/** Reusable one-way contour artwork for the quality-retention benefit. */

import type { CSSProperties, ReactNode } from "react";

export interface QualityContourArtworkProps {
  /** Unique prefix for the accessible SVG title and description. */
  readonly idPrefix: string;
}

type ContourPoint = readonly [x: number, y: number];

interface QualityContourLineStyle extends CSSProperties {
  readonly "--quality-contour-opacity": number;
  readonly "--quality-contour-opacity-dark": number;
}

/** Format generated coordinates compactly while preserving soft irregularity. */
function coordinate(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * Join polygon vertices with short quadratic corners.
 * The straight reaches retain the triangle's grammar without becoming rigid.
 */
function roundedPolygonPath(
  points: readonly ContourPoint[],
  rounding: number,
): string {
  if (points.length < 3) {
    throw new Error("A retained contour needs at least three vertices.");
  }

  const corners = points.map((current, index) => {
    const previous = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    if (previous === undefined || next === undefined) {
      throw new Error("A retained contour must form a closed polygon.");
    }
    const before: ContourPoint = [
      current[0] + (previous[0] - current[0]) * rounding,
      current[1] + (previous[1] - current[1]) * rounding,
    ];
    const after: ContourPoint = [
      current[0] + (next[0] - current[0]) * rounding,
      current[1] + (next[1] - current[1]) * rounding,
    ];
    return { current, before, after };
  });

  const first = corners[0];
  if (first === undefined) {
    throw new Error("A retained contour must have a first corner.");
  }
  const segments = [
    `M ${coordinate(first.before[0])} ${coordinate(first.before[1])}`,
    `Q ${coordinate(first.current[0])} ${coordinate(first.current[1])} ${
      coordinate(first.after[0])
    } ${coordinate(first.after[1])}`,
  ];
  for (const corner of corners.slice(1)) {
    segments.push(
      `L ${coordinate(corner.before[0])} ${coordinate(corner.before[1])}`,
      `Q ${coordinate(corner.current[0])} ${coordinate(corner.current[1])} ${
        coordinate(corner.after[0])
      } ${coordinate(corner.after[1])}`,
    );
  }
  segments.push(
    `L ${coordinate(first.before[0])} ${coordinate(first.before[1])} Z`,
  );
  return segments.join(" ");
}

/**
 * The geometry authority for every retained boundary.
 * New rings added here automatically render and enter the structural guard.
 */
export const QUALITY_CONTOUR_RINGS = [
  {
    id: "01",
    opacity: { light: 0.12, dark: 0.18 },
    path: roundedPolygonPath([
      [100, 388],
      [82, 286],
      [124, 184],
      [220, 108],
      [354, 70],
      [492, 89],
      [606, 151],
      [665, 249],
      [652, 356],
      [583, 435],
      [454, 477],
      [310, 470],
      [184, 432],
    ], 0.18),
  },
  {
    id: "02",
    opacity: { light: 0.18, dark: 0.24 },
    path: roundedPolygonPath([
      [157, 365],
      [141, 288],
      [170, 208],
      [248, 145],
      [355, 112],
      [470, 126],
      [558, 174],
      [606, 250],
      [594, 329],
      [541, 389],
      [443, 420],
      [332, 414],
      [233, 386],
    ], 0.18),
  },
  {
    id: "03",
    opacity: { light: 0.24, dark: 0.31 },
    path: roundedPolygonPath([
      [219, 337],
      [210, 278],
      [234, 221],
      [292, 176],
      [374, 154],
      [459, 163],
      [524, 199],
      [557, 254],
      [546, 309],
      [507, 351],
      [437, 370],
      [356, 364],
      [282, 346],
    ], 0.17),
  },
  {
    id: "04",
    opacity: { light: 0.31, dark: 0.39 },
    path: roundedPolygonPath([
      [285, 309],
      [283, 266],
      [299, 229],
      [339, 198],
      [397, 183],
      [454, 190],
      [497, 214],
      [519, 250],
      [511, 288],
      [484, 316],
      [436, 328],
      [382, 323],
      [333, 312],
    ], 0.16),
  },
  {
    id: "05",
    opacity: { light: 0.4, dark: 0.48 },
    path: roundedPolygonPath([
      [352, 279],
      [351, 250],
      [364, 224],
      [390, 205],
      [427, 198],
      [463, 204],
      [489, 219],
      [502, 244],
      [497, 268],
      [478, 285],
      [447, 292],
      [414, 288],
      [383, 280],
    ], 0.16),
  },
  {
    id: "latest",
    opacity: { light: 0.52, dark: 0.61 },
    path: roundedPolygonPath([
      [408, 252],
      [410, 232],
      [421, 215],
      [442, 204],
      [466, 203],
      [487, 214],
      [497, 231],
      [495, 249],
      [482, 264],
      [461, 270],
      [438, 266],
      [420, 259],
    ], 0.15),
  },
] as const;

/**
 * Retained boundaries converge on discern's half-filled triangle.
 * The active boundary advances once; accumulated geometry never disappears.
 */
export function QualityContourArtwork(
  { idPrefix }: QualityContourArtworkProps,
): ReactNode {
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;
  const latestContour = QUALITY_CONTOUR_RINGS.at(-1);
  if (latestContour === undefined) {
    throw new Error("The quality contour artwork needs a latest boundary.");
  }

  return (
    <figure className="quality-contour">
      <svg
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>One-way contour of retained quality</title>
        <desc id={descriptionId}>
          {QUALITY_CONTOUR_RINGS.length}{" "}
          softly faceted retained boundaries narrow toward a half-filled
          triangle. Earlier boundaries remain visible while the newest boundary
          settles in blue.
        </desc>

        <g aria-hidden="true">
          <circle
            className="quality-contour__bloom"
            cx="467"
            cy="229"
            r="72"
          />

          <g className="quality-contour__retained">
            {QUALITY_CONTOUR_RINGS.map((ring, index) => {
              const latest = index === QUALITY_CONTOUR_RINGS.length - 1;
              return (
                <path
                  className={`quality-contour__line quality-contour__line--${
                    latest ? "latest" : ring.id
                  }`}
                  data-contour-ring={ring.id}
                  d={ring.path}
                  key={ring.id}
                  style={{
                    "--quality-contour-opacity": ring.opacity.light,
                    "--quality-contour-opacity-dark": ring.opacity.dark,
                  } as QualityContourLineStyle}
                />
              );
            })}
          </g>

          <path
            className="quality-contour__advance"
            d={latestContour.path}
            pathLength={1}
          />

          <g className="quality-contour__attractor">
            <path
              className="quality-contour__attractor-fill"
              d="M 467 210 L 467 248 L 488 248 Z"
            />
            <path
              className="quality-contour__attractor-outline"
              d="M 467 210 L 446 248 L 488 248 Z"
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
