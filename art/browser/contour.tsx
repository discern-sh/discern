/** Reusable one-way contour artwork. */

import type { CSSProperties, ReactNode } from "react";

export interface ContourArtworkProps {
  /** Unique prefix for the accessible SVG title and description. */
  readonly idPrefix: string;
}

export type ContourPoint = readonly [x: number, y: number];

export interface ContourBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
}

export interface ContourRing {
  readonly id: string;
  readonly opacity: {
    readonly light: number;
    readonly dark: number;
  };
  readonly path: string;
  readonly bounds: ContourBounds;
  readonly motion: {
    readonly startTransform: string;
    readonly settledTransform: string;
  };
}

export interface ContourRingDefinition {
  readonly id: string;
  readonly opacity: {
    readonly light: number;
    readonly dark: number;
  };
  readonly points: readonly ContourPoint[];
  readonly rounding: number;
}

export interface ContourLineStyle extends CSSProperties {
  readonly "--contour-art-opacity": number;
  readonly "--contour-art-opacity-dark": number;
  readonly "--contour-art-start-transform": string;
  readonly "--contour-art-settled-transform": string;
}

export interface ContourLineAttributes {
  readonly className: string;
  readonly "data-contour-ring": string;
  readonly "data-contour-motion": "expand";
  readonly d: string;
  readonly style: ContourLineStyle;
}

/** One compact origin and one exact resting transform for every ring. */
export const CONTOUR_EXPANSION = Object.freeze(
  {
    anchor: Object.freeze({ x: 467, y: 235 }),
    startSpan: 54,
    settledTransform: "matrix(1, 0, 0, 1, 0, 0)",
    durationMs: 10_000,
  } as const,
);

/** Format generated values compactly at a deliberate precision. */
function compactNumber(value: number, precision: number): string {
  const factor = 10 ** precision;
  return String(Math.round(value * factor) / factor);
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
  if (!Number.isFinite(rounding) || rounding <= 0 || rounding >= 0.5) {
    throw new Error("A retained contour needs rounding between zero and 0.5.");
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
    `M ${compactNumber(first.before[0], 1)} ${
      compactNumber(first.before[1], 1)
    }`,
    `Q ${compactNumber(first.current[0], 1)} ${
      compactNumber(first.current[1], 1)
    } ${compactNumber(first.after[0], 1)} ${compactNumber(first.after[1], 1)}`,
  ];
  for (const corner of corners.slice(1)) {
    segments.push(
      `L ${compactNumber(corner.before[0], 1)} ${
        compactNumber(corner.before[1], 1)
      }`,
      `Q ${compactNumber(corner.current[0], 1)} ${
        compactNumber(corner.current[1], 1)
      } ${compactNumber(corner.after[0], 1)} ${
        compactNumber(corner.after[1], 1)
      }`,
    );
  }
  segments.push(
    `L ${compactNumber(first.before[0], 1)} ${
      compactNumber(first.before[1], 1)
    } Z`,
  );
  return segments.join(" ");
}

/** Measure authored vertices before deriving their shared opening transform. */
function contourBounds(points: readonly ContourPoint[]): ContourBounds {
  if (points.length < 3) {
    throw new Error("A retained contour needs at least three vertices.");
  }
  const x = points.map((point) => point[0]);
  const y = points.map((point) => point[1]);
  if (![...x, ...y].every(Number.isFinite)) {
    throw new Error("A retained contour needs finite coordinates.");
  }
  const minX = Math.min(...x);
  const maxX = Math.max(...x);
  const minY = Math.min(...y);
  const maxY = Math.max(...y);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) {
    throw new Error("A retained contour needs two-dimensional bounds.");
  }
  return Object.freeze({
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width,
    height,
  });
}

/**
 * Define a ring and derive the matrix that maps its authored bounds onto the
 * shared compact footprint. New registry members cannot omit this contract.
 */
export function defineContourRing(
  definition: ContourRingDefinition,
): ContourRing {
  if (definition.id.trim() === "") {
    throw new Error("A retained contour needs an identifier.");
  }
  if (
    !Number.isFinite(definition.opacity.light) ||
    !Number.isFinite(definition.opacity.dark) ||
    definition.opacity.light < 0 || definition.opacity.light > 1 ||
    definition.opacity.dark < 0 || definition.opacity.dark > 1
  ) {
    throw new Error(
      "A retained contour needs theme opacities from zero to one.",
    );
  }

  const bounds = contourBounds(definition.points);
  const scale = CONTOUR_EXPANSION.startSpan /
    Math.max(bounds.width, bounds.height);
  const translateX = CONTOUR_EXPANSION.anchor.x -
    (scale * bounds.centerX);
  const translateY = CONTOUR_EXPANSION.anchor.y -
    (scale * bounds.centerY);
  const scaleTerm = compactNumber(scale, 5);
  const startTransform = `matrix(${scaleTerm}, 0, 0, ${scaleTerm}, ${
    compactNumber(translateX, 3)
  }, ${compactNumber(translateY, 3)})`;

  return Object.freeze({
    id: definition.id,
    opacity: Object.freeze({ ...definition.opacity }),
    path: roundedPolygonPath(definition.points, definition.rounding),
    bounds,
    motion: Object.freeze({
      startTransform,
      settledTransform: CONTOUR_EXPANSION.settledTransform,
    }),
  });
}

/**
 * The geometry authority for every retained boundary.
 * New rings added here automatically render and enter the motion guard.
 */
export const CONTOUR_RINGS: readonly ContourRing[] = Object
  .freeze([
    defineContourRing({
      id: "01",
      opacity: { light: 0.12, dark: 0.18 },
      points: [
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
      ],
      rounding: 0.18,
    }),
    defineContourRing({
      id: "02",
      opacity: { light: 0.18, dark: 0.24 },
      points: [
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
      ],
      rounding: 0.18,
    }),
    defineContourRing({
      id: "03",
      opacity: { light: 0.24, dark: 0.31 },
      points: [
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
      ],
      rounding: 0.17,
    }),
    defineContourRing({
      id: "04",
      opacity: { light: 0.31, dark: 0.39 },
      points: [
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
      ],
      rounding: 0.16,
    }),
    defineContourRing({
      id: "05",
      opacity: { light: 0.4, dark: 0.48 },
      points: [
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
      ],
      rounding: 0.16,
    }),
    defineContourRing({
      id: "latest",
      opacity: { light: 0.52, dark: 0.61 },
      points: [
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
      ],
      rounding: 0.15,
    }),
  ]);

/** Build the attributes that make each registry member motion-complete. */
export function contourLineAttributes(
  ring: ContourRing,
  latest: boolean,
): ContourLineAttributes {
  return {
    className: `contour-art__line contour-art__line--${
      latest ? "latest" : ring.id
    }`,
    "data-contour-ring": ring.id,
    "data-contour-motion": "expand",
    d: ring.path,
    style: {
      "--contour-art-opacity": ring.opacity.light,
      "--contour-art-opacity-dark": ring.opacity.dark,
      "--contour-art-start-transform": ring.motion.startTransform,
      "--contour-art-settled-transform": ring.motion.settledTransform,
    },
  };
}

/**
 * Retained boundaries converge on discern's half-filled triangle.
 * They expand from one shared footprint; the authored resting art is permanent.
 */
export function ContourArtwork(
  { idPrefix }: ContourArtworkProps,
): ReactNode {
  const titleId = `${idPrefix}-title`;
  const descriptionId = `${idPrefix}-description`;

  return (
    <figure className="contour-art">
      <svg
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
      >
        <title id={titleId}>Contours</title>
        <desc id={descriptionId}>
          {CONTOUR_RINGS.length}{" "}
          softly faceted retained boundaries expand from a shared center around
          a half-filled triangle into their complete nested composition.
        </desc>

        <g aria-hidden="true">
          <circle
            className="contour-art__bloom"
            cx={CONTOUR_EXPANSION.anchor.x}
            cy={CONTOUR_EXPANSION.anchor.y}
            r="72"
          />

          <g className="contour-art__retained">
            {CONTOUR_RINGS.map((ring, index) => {
              const latest = index === CONTOUR_RINGS.length - 1;
              return (
                <path
                  {...contourLineAttributes(ring, latest)}
                  key={ring.id}
                />
              );
            })}
          </g>

          <g className="contour-art__attractor">
            <path
              className="contour-art__attractor-fill"
              d="M 467 210 L 467 248 L 488 248 Z"
            />
            <path
              className="contour-art__attractor-outline"
              d="M 467 210 L 446 248 L 488 248 Z"
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
