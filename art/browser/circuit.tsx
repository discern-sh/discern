/** Reusable circuit artwork: one pulse relays around a ruled triangle. */

import type { CSSProperties, ReactElement } from "react";

export interface CircuitArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One planar point in the figure's 760 by 540 viewBox space. */
export interface CircuitPoint {
  readonly x: number;
  readonly y: number;
}

/** One straight run between two resolved points. */
export interface CircuitSegment {
  readonly from: CircuitPoint;
  readonly to: CircuitPoint;
}

/** The triangle's sides, named in the pulse's travel order. */
export type CircuitEdgeId = "base" | "right" | "left";

/** One side: its vertices, drawn run, and hairline extensions. */
export interface CircuitEdge {
  readonly id: CircuitEdgeId;
  readonly fromVertex: CircuitPoint;
  readonly toVertex: CircuitPoint;
  readonly drawn: CircuitSegment;
  readonly extensions: readonly [CircuitSegment, CircuitSegment];
}

/** One leg of the pulse's journey with its motion path. */
export interface CircuitLeg extends CircuitSegment {
  readonly id: CircuitEdgeId;
  readonly path: string;
}

/** The split mark at the apex as SVG points attributes. */
export interface CircuitApexMark {
  readonly outline: string;
  readonly fill: string;
  readonly echo: string;
}

/** The single proportion authority for the whole plate. */
export const CIRCUIT_GEOMETRY = Object.freeze({
  centroid: Object.freeze({ x: 380, y: 272 }),
  circumradius: 184,
  /** Edges stop, and extensions resume, this far from each vertex. */
  vertexGap: 26,
  /** Extensions end this far beyond each vertex. */
  extensionReach: 56,
  /** Pulse legs start and end this far from each vertex. */
  pulseMargin: 14,
  /** Radius of the filled disc and of the open circle. */
  stationRadius: 8,
  /** Half-length of the registration tick at the centroid. */
  centreTick: 5,
  apexMark: Object.freeze({
    ascent: 16,
    descent: 10,
    halfWidth: 14,
    /** The echo outsets the filled half about its own centroid. */
    echoSpread: 1.3,
  }),
});

/** Unit direction from one point toward another. */
function unitToward(from: CircuitPoint, to: CircuitPoint): CircuitPoint {
  const run = Math.hypot(to.x - from.x, to.y - from.y);
  return { x: (to.x - from.x) / run, y: (to.y - from.y) / run };
}

/** Advance a point by a distance along a direction. */
function along(
  origin: CircuitPoint,
  direction: CircuitPoint,
  distance: number,
): CircuitPoint {
  return Object.freeze({
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
  });
}

/** Format a coordinate compactly at two decimal places. */
function compact(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Serialize points into an SVG points attribute. */
function pointsAttribute(points: readonly CircuitPoint[]): string {
  return points
    .map((point) => `${compact(point.x)},${compact(point.y)}`)
    .join(" ");
}

const BASE_HALF_SPAN = CIRCUIT_GEOMETRY.circumradius * Math.sin(Math.PI / 3);

/** The three stationed vertices of the equilateral triangle. */
export const CIRCUIT_VERTICES = Object.freeze({
  apex: Object.freeze({
    x: CIRCUIT_GEOMETRY.centroid.x,
    y: CIRCUIT_GEOMETRY.centroid.y - CIRCUIT_GEOMETRY.circumradius,
  }),
  baseLeft: Object.freeze({
    x: CIRCUIT_GEOMETRY.centroid.x - BASE_HALF_SPAN,
    y: CIRCUIT_GEOMETRY.centroid.y + CIRCUIT_GEOMETRY.circumradius / 2,
  }),
  baseRight: Object.freeze({
    x: CIRCUIT_GEOMETRY.centroid.x + BASE_HALF_SPAN,
    y: CIRCUIT_GEOMETRY.centroid.y + CIRCUIT_GEOMETRY.circumradius / 2,
  }),
});

/** Derive one side's drawn run and its two vertex extensions. */
function edgeBetween(
  id: CircuitEdgeId,
  fromVertex: CircuitPoint,
  toVertex: CircuitPoint,
): CircuitEdge {
  const forward = unitToward(fromVertex, toVertex);
  const backward: CircuitPoint = { x: -forward.x, y: -forward.y };
  const { extensionReach, vertexGap } = CIRCUIT_GEOMETRY;
  return Object.freeze({
    id,
    fromVertex,
    toVertex,
    drawn: Object.freeze({
      from: along(fromVertex, forward, vertexGap),
      to: along(toVertex, backward, vertexGap),
    }),
    extensions: Object.freeze(
      [
        Object.freeze({
          from: along(fromVertex, backward, vertexGap),
          to: along(fromVertex, backward, extensionReach),
        }),
        Object.freeze({
          from: along(toVertex, forward, vertexGap),
          to: along(toVertex, forward, extensionReach),
        }),
      ] as const,
    ),
  });
}

/** The three sides in travel order: base, then right, then left. */
export const CIRCUIT_EDGES: readonly CircuitEdge[] = Object.freeze([
  edgeBetween("base", CIRCUIT_VERTICES.baseLeft, CIRCUIT_VERTICES.baseRight),
  edgeBetween("right", CIRCUIT_VERTICES.baseRight, CIRCUIT_VERTICES.apex),
  edgeBetween("left", CIRCUIT_VERTICES.apex, CIRCUIT_VERTICES.baseLeft),
]);

/** The pulse's three legs, derived directly from the sides. */
export const CIRCUIT_LEGS: readonly CircuitLeg[] = Object.freeze(
  CIRCUIT_EDGES.map((edge) => {
    const forward = unitToward(edge.fromVertex, edge.toVertex);
    const backward: CircuitPoint = { x: -forward.x, y: -forward.y };
    const from = along(edge.fromVertex, forward, CIRCUIT_GEOMETRY.pulseMargin);
    const to = along(edge.toVertex, backward, CIRCUIT_GEOMETRY.pulseMargin);
    return Object.freeze({
      id: edge.id,
      from,
      to,
      path: `M ${compact(from.x)} ${compact(from.y)} L ${compact(to.x)} ${
        compact(to.y)
      }`,
    });
  }),
);

/** Derive the apex split mark: full outline, filled right half, echo. */
function splitMark(): CircuitApexMark {
  const { apexMark } = CIRCUIT_GEOMETRY;
  const vertex = CIRCUIT_VERTICES.apex;
  const top: CircuitPoint = { x: vertex.x, y: vertex.y - apexMark.ascent };
  const left: CircuitPoint = {
    x: vertex.x - apexMark.halfWidth,
    y: vertex.y + apexMark.descent,
  };
  const right: CircuitPoint = {
    x: vertex.x + apexMark.halfWidth,
    y: vertex.y + apexMark.descent,
  };
  const seam: CircuitPoint = { x: vertex.x, y: vertex.y + apexMark.descent };
  const half: readonly CircuitPoint[] = [top, right, seam];
  const centre: CircuitPoint = {
    x: (top.x + right.x + seam.x) / 3,
    y: (top.y + right.y + seam.y) / 3,
  };
  const echo = half.map((point) => ({
    x: centre.x + (point.x - centre.x) * apexMark.echoSpread,
    y: centre.y + (point.y - centre.y) * apexMark.echoSpread,
  }));
  return Object.freeze({
    outline: pointsAttribute([top, left, right]),
    fill: pointsAttribute(half),
    echo: pointsAttribute(echo),
  });
}

/** The apex split mark's resolved points attributes. */
export const CIRCUIT_APEX_MARK: CircuitApexMark = splitMark();

interface CircuitLegStyle extends CSSProperties {
  readonly "--fig-circuit-leg-path": string;
}

/** Hand each leg its own motion path without duplicating geometry. */
function legStyle(leg: CircuitLeg): CircuitLegStyle {
  return { "--fig-circuit-leg-path": `path("${leg.path}")` };
}

/** Render a leg's cargo: one dash, doubling only on the rising side. */
function legDashes(leg: CircuitLeg): ReactElement {
  if (leg.id === "right") {
    return (
      <>
        <line
          className="fig-circuit__dash fig-circuit__dash--fine"
          x1="-9"
          y1="0"
          x2="-2"
          y2="0"
          vectorEffect="non-scaling-stroke"
        />
        <line
          className="fig-circuit__dash fig-circuit__dash--fine"
          x1="2"
          y1="0"
          x2="9"
          y2="0"
          vectorEffect="non-scaling-stroke"
        />
      </>
    );
  }
  const accent = leg.id === "left" ? " fig-circuit__dash--accent" : "";
  return (
    <line
      className={`fig-circuit__dash${accent}`}
      x1="-4.5"
      y1="0"
      x2="4.5"
      y2="0"
      vectorEffect="non-scaling-stroke"
    />
  );
}

/**
 * A triangular relay among three stationed marks. The authored SVG is the
 * complete resolved plate; the stylesheet stages the one travelling pulse.
 */
export function CircuitArtwork(
  { id }: CircuitArtworkProps,
): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const { centreTick, centroid, circumradius, stationRadius } =
    CIRCUIT_GEOMETRY;
  const { baseLeft, baseRight } = CIRCUIT_VERTICES;

  return (
    <figure className="fig fig-circuit">
      <svg
        className="fig__art fig-circuit__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>One pulse travels a ruled triangular circuit</title>
        <desc id={descriptionId}>
          A hairline circle passes through the three vertices of a centred
          triangle whose edges pause short of each corner. A filled disc, an
          open circle, and a half-filled triangular mark occupy the vertex gaps,
          and a short dash circuits the triangle edge by edge before it is
          absorbed where it began.
        </desc>
        <g aria-hidden="true">
          <g className="fig-circuit__construction">
            <circle
              className="fig-circuit__circumference"
              cx={compact(centroid.x)}
              cy={compact(centroid.y)}
              r={compact(circumradius)}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="fig-circuit__tick"
              x1={compact(centroid.x - centreTick)}
              y1={compact(centroid.y)}
              x2={compact(centroid.x + centreTick)}
              y2={compact(centroid.y)}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="fig-circuit__tick"
              x1={compact(centroid.x)}
              y1={compact(centroid.y - centreTick)}
              x2={compact(centroid.x)}
              y2={compact(centroid.y + centreTick)}
              vectorEffect="non-scaling-stroke"
            />
            {CIRCUIT_EDGES.map((edge) =>
              edge.extensions.map((extension, index) => (
                <line
                  className="fig-circuit__extension"
                  data-circuit-extension={`${edge.id}-${index}`}
                  key={`${edge.id}-${index}`}
                  x1={compact(extension.from.x)}
                  y1={compact(extension.from.y)}
                  x2={compact(extension.to.x)}
                  y2={compact(extension.to.y)}
                  vectorEffect="non-scaling-stroke"
                />
              ))
            )}
          </g>
          <g className="fig-circuit__edges">
            {CIRCUIT_EDGES.map((edge) => (
              <line
                className="fig-circuit__edge"
                data-circuit-edge={edge.id}
                key={edge.id}
                x1={compact(edge.drawn.from.x)}
                y1={compact(edge.drawn.from.y)}
                x2={compact(edge.drawn.to.x)}
                y2={compact(edge.drawn.to.y)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <circle
            className="fig-circuit__disc"
            data-circuit-station="disc"
            cx={compact(baseLeft.x)}
            cy={compact(baseLeft.y)}
            r={compact(stationRadius)}
          />
          <circle
            className="fig-circuit__ring"
            data-circuit-station="ring"
            cx={compact(baseRight.x)}
            cy={compact(baseRight.y)}
            r={compact(stationRadius)}
            vectorEffect="non-scaling-stroke"
          />
          <g className="fig-circuit__apex" data-circuit-station="apex">
            <polygon
              className="fig-circuit__apex-echo"
              points={CIRCUIT_APEX_MARK.echo}
            />
            <polygon
              className="fig-circuit__apex-outline"
              points={CIRCUIT_APEX_MARK.outline}
              vectorEffect="non-scaling-stroke"
            />
            <polygon
              className="fig-circuit__apex-fill"
              points={CIRCUIT_APEX_MARK.fill}
            />
          </g>
          {CIRCUIT_LEGS.map((leg) => (
            <g
              className={`fig-circuit__pulse fig-circuit__pulse--${leg.id}`}
              data-circuit-leg={leg.id}
              key={leg.id}
              style={legStyle(leg)}
            >
              {legDashes(leg)}
            </g>
          ))}
        </g>
      </svg>
    </figure>
  );
}
