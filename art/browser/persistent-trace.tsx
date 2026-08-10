/** Reusable abstract artwork for the "Knowledge that compounds" benefit. */

import type { ReactNode } from "react";

interface PersistentTraceArtworkProps {
  /** Stable suffix keeps accessible SVG identifiers unique in a paired preview. */
  readonly id: string;
}

/** One authored point in the persistent-trace artboard. */
export interface PersistentTracePoint {
  readonly x: number;
  readonly y: number;
}

/** The geometric authority shared by the SVG and its structural tests. */
export const PERSISTENT_TRACE_ARTBOARD = Object.freeze({
  width: 960,
  height: 640,
  center: Object.freeze({ x: 480, y: 320 }),
  outerRadius: Object.freeze({ x: 300, y: 230 }),
});

const ANGULAR_STEPS_PER_TURN = 12;
const INWARD_STEPS = 48;
const INNER_SCALE = 0.04;

/** Round generated geometry so the static markup stays stable and reviewable. */
function roundCoordinate(value: number): number {
  return Number(value.toFixed(2));
}

/** Plot one point on the artboard's centered elliptical angular envelope. */
function pointAt(step: number, scale: number): PersistentTracePoint {
  const degrees = -90 + (step * 360) / ANGULAR_STEPS_PER_TURN;
  const radians = degrees * Math.PI / 180;
  return Object.freeze({
    x: roundCoordinate(
      PERSISTENT_TRACE_ARTBOARD.center.x +
        Math.cos(radians) * PERSISTENT_TRACE_ARTBOARD.outerRadius.x * scale,
    ),
    y: roundCoordinate(
      PERSISTENT_TRACE_ARTBOARD.center.y +
        Math.sin(radians) * PERSISTENT_TRACE_ARTBOARD.outerRadius.y * scale,
    ),
  });
}

const OUTER_ENVELOPE: readonly PersistentTracePoint[] = Object.freeze(
  Array.from(
    { length: ANGULAR_STEPS_PER_TURN + 1 },
    (_, step) => pointAt(step, 1),
  ),
);

const INWARD_SPIRAL: readonly PersistentTracePoint[] = Object.freeze(
  Array.from({ length: INWARD_STEPS }, (_, index) => {
    const step = index + 1;
    const progress = step / INWARD_STEPS;
    const scale = 1 - progress * (1 - INNER_SCALE);
    return pointAt(step, scale);
  }),
);

/**
 * A complete outer orbit establishes balanced bounds before the same pen line
 * winds inward and terminates at the mathematical centre.
 */
export const PERSISTENT_TRACE_POINTS: readonly PersistentTracePoint[] = Object
  .freeze([
    ...OUTER_ENVELOPE,
    ...INWARD_SPIRAL,
    PERSISTENT_TRACE_ARTBOARD.center,
  ]);

const SEGMENT_BOUNDS = [
  [0, 12],
  [12, 22],
  [22, 32],
  [32, 42],
  [42, 52],
  [52, 61],
] as const;

/** Contiguous retained passes that together form the single spiral route. */
export const PERSISTENT_TRACE_SEGMENTS:
  readonly (readonly PersistentTracePoint[])[] = Object.freeze(
    SEGMENT_BOUNDS.map(([start, end]) =>
      Object.freeze(PERSISTENT_TRACE_POINTS.slice(start, end + 1))
    ),
  );

/** Convert a non-empty point sequence to one reviewable SVG polyline path. */
function pathFromPoints(points: readonly PersistentTracePoint[]): string {
  const first = points[0];
  if (first === undefined) return "";
  return [`M ${first.x} ${first.y}`]
    .concat(points.slice(1).map((point) => `L ${point.x} ${point.y}`))
    .join(" ");
}

/** One continuous route used by the retained ink, wake, and moving point. */
export const PERSISTENT_TRACE_ROUTE = pathFromPoints(PERSISTENT_TRACE_POINTS);

const CONSTRUCTION_PATHS = [0.72, 0.42].map((scale) =>
  pathFromPoints(
    Array.from(
      { length: ANGULAR_STEPS_PER_TURN + 1 },
      (_, step) => pointAt(step, scale),
    ),
  )
);

const CORE_HALF_WIDTH = 12;
const CORE_TOP = -14;
const CORE_BASE = 7;

/** Triangle vertices relative to a centroid at the artboard centre. */
export const PERSISTENT_TRACE_CORE_POINTS: readonly PersistentTracePoint[] =
  Object.freeze([
    Object.freeze({ x: 0, y: CORE_TOP }),
    Object.freeze({ x: -CORE_HALF_WIDTH, y: CORE_BASE }),
    Object.freeze({ x: CORE_HALF_WIDTH, y: CORE_BASE }),
  ]);

/**
 * A restrained wake and point follow the same balanced route. The resting SVG
 * already contains the full accumulated composition, so motion carries no
 * essential information.
 */
export function PersistentTraceArtwork(
  { id }: PersistentTraceArtworkProps,
): ReactNode {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const { center, height, width } = PERSISTENT_TRACE_ARTBOARD;

  return (
    <figure className="persistent-trace">
      <svg
        className="persistent-trace__drawing"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        data-center-x={center.x}
        data-center-y={center.y}
      >
        <title id={titleId}>Knowledge retained as an inward trace</title>
        <desc id={descriptionId}>
          A balanced angular spiral winds from a broad outer contour to a
          half-filled triangle at the exact centre. A small blue point follows
          the line inward.
        </desc>

        <g className="persistent-trace__construction" aria-hidden="true">
          {CONSTRUCTION_PATHS.map((path, index) => (
            <path d={path} data-radial-guide={index + 1} key={path} />
          ))}
        </g>

        <g className="persistent-trace__durable" aria-hidden="true">
          {PERSISTENT_TRACE_SEGMENTS.map((points, index) => (
            <path
              d={pathFromPoints(points)}
              data-persistent-layer={index + 1}
              key={index}
              pathLength={1}
            />
          ))}
        </g>

        <path
          className="persistent-trace__activation"
          d={PERSISTENT_TRACE_ROUTE}
          data-persistent-route
          pathLength={1}
          aria-hidden="true"
        />

        <circle
          className="persistent-trace__bloom"
          cx={center.x}
          cy={center.y}
          r="34"
          aria-hidden="true"
        />

        <g className="persistent-trace__traveler" aria-hidden="true">
          <circle className="persistent-trace__traveler-halo" r="10" />
          <circle className="persistent-trace__traveler-point" r="3.5" />
          <animateMotion
            dur="11s"
            repeatCount="indefinite"
            path={PERSISTENT_TRACE_ROUTE}
            keyPoints="0;1;1"
            keyTimes="0;0.84;1"
            calcMode="linear"
          />
        </g>

        <g
          className="persistent-trace__core"
          data-persistent-core
          data-center-x={center.x}
          data-center-y={center.y}
          aria-hidden="true"
          transform={`translate(${center.x} ${center.y})`}
        >
          <path
            d={`M 0 ${CORE_TOP} L ${-CORE_HALF_WIDTH} ${CORE_BASE} L ${CORE_HALF_WIDTH} ${CORE_BASE} Z`}
          />
          <path
            d={`M 0 ${CORE_TOP} L ${CORE_HALF_WIDTH} ${CORE_BASE} L 0 ${CORE_BASE} Z`}
          />
        </g>
      </svg>
    </figure>
  );
}
