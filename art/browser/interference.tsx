/** Reusable interference artwork: two near-aligned lattices bloom inside a triangle. */

import type { ReactElement } from "react";

export interface InterferenceArtworkProps {
  /** Stable prefix for the SVG title, description, and clip identifiers. */
  readonly id: string;
}

/** One planar point in the figure's 760 by 540 viewBox space. */
export interface InterferencePoint {
  readonly x: number;
  readonly y: number;
}

/** One lattice hairline, resolved to its endpoints in plate space. */
export interface InterferenceLatticeLine {
  /** The family direction this line belongs to, in degrees. */
  readonly angle: number;
  readonly from: InterferencePoint;
  readonly to: InterferencePoint;
}

/** One faint guide segment continuing a frame edge past its vertex. */
export interface InterferenceExtension {
  readonly from: InterferencePoint;
  readonly to: InterferencePoint;
}

/** The single proportion authority for the whole plate. */
export const INTERFERENCE_GEOMETRY = Object.freeze({
  /** The frame triangle's centroid — the one pivot both grids share. */
  centroid: Object.freeze({ x: 380, y: 288 }),
  /** Distance from the centroid to each frame vertex. */
  circumradius: 206,
  /** The three lattice family directions, in degrees from horizontal. */
  familyAngles: Object.freeze([0, 60, 120] as const),
  /** Perpendicular spacing between neighbouring lines of one family. */
  spacing: 15,
  /** Line half-length as a factor of the circumradius: the overfill. */
  overshoot: 1.15,
  /** Extra perpendicular coverage so drift never exposes a lattice edge. */
  driftMargin: 22,
  /** Grid B's authored static counter-rotation, in degrees. */
  counterRotation: 2.5,
  /** Peak animated drift for each grid; the phrase returns both to rest. */
  drift: Object.freeze({
    a: Object.freeze({ rotate: 1.6, dx: 3.2, dy: -1.8 }),
    b: Object.freeze({ rotate: -0.9, dx: -2.6, dy: 1.5 }),
  }),
  /** Rotational drift stays under this angle: interference, not rotation. */
  driftLimit: 3,
  /** The hard ceiling on lattice line elements across both grids. */
  lineBudget: 170,
  /** Edge-extension guides run between these distances past each vertex. */
  extension: Object.freeze({ clearance: 8, reach: 34 }),
  /** Half-length of one registration tick at the shared pivot. */
  centreTick: 5,
});

const HALF_SPAN = INTERFERENCE_GEOMETRY.circumradius * Math.sin(Math.PI / 3);

/** The three frame vertices of the apex-up equilateral triangle. */
export const INTERFERENCE_VERTICES = Object.freeze({
  apex: Object.freeze({
    x: INTERFERENCE_GEOMETRY.centroid.x,
    y: INTERFERENCE_GEOMETRY.centroid.y - INTERFERENCE_GEOMETRY.circumradius,
  }),
  baseLeft: Object.freeze({
    x: INTERFERENCE_GEOMETRY.centroid.x - HALF_SPAN,
    y: INTERFERENCE_GEOMETRY.centroid.y +
      INTERFERENCE_GEOMETRY.circumradius / 2,
  }),
  baseRight: Object.freeze({
    x: INTERFERENCE_GEOMETRY.centroid.x + HALF_SPAN,
    y: INTERFERENCE_GEOMETRY.centroid.y +
      INTERFERENCE_GEOMETRY.circumradius / 2,
  }),
});

/** Format a coordinate compactly at two decimal places. */
function compact(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** One family of parallel lines spanning the frame's support with margin. */
function familyLines(angle: number): InterferenceLatticeLine[] {
  const { centroid, circumradius, driftMargin, overshoot, spacing } =
    INTERFERENCE_GEOMETRY;
  const radians = (angle * Math.PI) / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  const normal = { x: -direction.y, y: direction.x };
  const supports = Object.values(INTERFERENCE_VERTICES).map((vertex) =>
    (vertex.x - centroid.x) * normal.x + (vertex.y - centroid.y) * normal.y
  );
  const nearest = Math.ceil((Math.min(...supports) - driftMargin) / spacing);
  const farthest = Math.floor((Math.max(...supports) + driftMargin) / spacing);
  const half = circumradius * overshoot;
  const lines: InterferenceLatticeLine[] = [];
  for (let step = nearest; step <= farthest; step += 1) {
    const centre = {
      x: centroid.x + normal.x * step * spacing,
      y: centroid.y + normal.y * step * spacing,
    };
    lines.push(Object.freeze({
      angle,
      from: Object.freeze({
        x: centre.x - direction.x * half,
        y: centre.y - direction.y * half,
      }),
      to: Object.freeze({
        x: centre.x + direction.x * half,
        y: centre.y + direction.y * half,
      }),
    }));
  }
  return lines;
}

/** One grid's complete lattice, authored once and rendered for both grids. */
export const INTERFERENCE_LATTICE: readonly InterferenceLatticeLine[] = Object
  .freeze(
    INTERFERENCE_GEOMETRY.familyAngles.flatMap((angle) => familyLines(angle)),
  );

/** Continue an edge past a vertex as one faint guide segment. */
function extensionBeyond(
  fromVertex: InterferencePoint,
  toVertex: InterferencePoint,
): InterferenceExtension {
  const run = Math.hypot(toVertex.x - fromVertex.x, toVertex.y - fromVertex.y);
  const direction = {
    x: (toVertex.x - fromVertex.x) / run,
    y: (toVertex.y - fromVertex.y) / run,
  };
  const { clearance, reach } = INTERFERENCE_GEOMETRY.extension;
  return Object.freeze({
    from: Object.freeze({
      x: toVertex.x + direction.x * clearance,
      y: toVertex.y + direction.y * clearance,
    }),
    to: Object.freeze({
      x: toVertex.x + direction.x * reach,
      y: toVertex.y + direction.y * reach,
    }),
  });
}

const FRAME_EDGES: ReadonlyArray<
  readonly [InterferencePoint, InterferencePoint]
> = Object.freeze(
  [
    [INTERFERENCE_VERTICES.apex, INTERFERENCE_VERTICES.baseLeft],
    [INTERFERENCE_VERTICES.baseLeft, INTERFERENCE_VERTICES.baseRight],
    [INTERFERENCE_VERTICES.baseRight, INTERFERENCE_VERTICES.apex],
  ] as const,
);

/** The six guide extensions, one past each end of every frame edge. */
export const INTERFERENCE_EXTENSIONS: readonly InterferenceExtension[] = Object
  .freeze(
    FRAME_EDGES.flatMap(([from, to]) => [
      extensionBeyond(from, to),
      extensionBeyond(to, from),
    ]),
  );

/** The frame polygon's resolved points attribute. */
export const INTERFERENCE_FRAME_POINTS: string = [
  INTERFERENCE_VERTICES.apex,
  INTERFERENCE_VERTICES.baseLeft,
  INTERFERENCE_VERTICES.baseRight,
]
  .map((vertex) => `${compact(vertex.x)},${compact(vertex.y)}`)
  .join(" ");

/** Render the shared lattice once for one grid layer. */
function latticeLines(): ReactElement[] {
  return INTERFERENCE_LATTICE.map((line, index) => (
    <line
      key={index}
      className="fig-interference__line"
      data-interference-family={line.angle}
      x1={compact(line.from.x)}
      y1={compact(line.from.y)}
      x2={compact(line.to.x)}
      y2={compact(line.to.y)}
      vectorEffect="non-scaling-stroke"
    />
  ));
}

/**
 * Fig. VII — the interference. One ruled triangle bounds two fine
 * triangular lattices set a fraction of a degree apart, so a broad moiré
 * bloom rests centred on their shared pivot. The authored SVG is the
 * complete resolved plate; the stylesheet supplies only the counter-drift
 * that lets the bloom swell, travel, and settle exactly home.
 */
export function InterferenceArtwork(
  { id }: InterferenceArtworkProps,
): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const fieldClipId = `${id}-field`;
  const { centroid, centreTick, counterRotation } = INTERFERENCE_GEOMETRY;

  return (
    <figure className="fig fig-interference">
      <svg
        className="fig__art fig-interference__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          Two overlaid lattices interfering inside one ruled triangle
        </title>
        <desc id={descriptionId}>
          One large apex-up triangle rules the plate, its edges continued by
          faint guides and its centre marked with a small registration cross.
          Inside it, two fine triangular lattices of hairlines lie a fraction of
          a degree apart, and a broad interference bloom rests centred on the
          mark. The lattices drift minutely against each other, letting the
          bloom swell, wander, and settle exactly home.
        </desc>
        <g aria-hidden="true">
          <defs>
            <clipPath id={fieldClipId}>
              <polygon points={INTERFERENCE_FRAME_POINTS} />
            </clipPath>
          </defs>

          <g className="fig-interference__construction">
            {INTERFERENCE_EXTENSIONS.map((extension, index) => (
              <line
                key={index}
                x1={compact(extension.from.x)}
                y1={compact(extension.from.y)}
                x2={compact(extension.to.x)}
                y2={compact(extension.to.y)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line
              x1={compact(centroid.x - centreTick)}
              y1={compact(centroid.y)}
              x2={compact(centroid.x + centreTick)}
              y2={compact(centroid.y)}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={compact(centroid.x)}
              y1={compact(centroid.y - centreTick)}
              x2={compact(centroid.x)}
              y2={compact(centroid.y + centreTick)}
              vectorEffect="non-scaling-stroke"
            />
          </g>

          {
            /* The clip stays on this static wrapper: named on either moving
              grid it would travel with that grid's transform. */
          }
          <g
            className="fig-interference__field"
            data-interference-field="true"
            clipPath={`url(#${fieldClipId})`}
          >
            <g
              className="fig-interference__grid fig-interference__grid--a"
              data-interference-grid="a"
            >
              {latticeLines()}
            </g>
            <g
              className="fig-interference__grid fig-interference__grid--b"
              data-interference-grid="b"
              transform={`rotate(${counterRotation} ${centroid.x} ${centroid.y})`}
            >
              {latticeLines()}
            </g>
          </g>

          <polygon
            className="fig-interference__frame"
            points={INTERFERENCE_FRAME_POINTS}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
    </figure>
  );
}
