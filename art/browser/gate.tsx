/** Reusable gate artwork: a stream measured against one aperture. */

import type { ReactElement } from "react";

export interface GateArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** The single proportion authority for the whole plate. */
export const GATE_GEOMETRY = Object.freeze({
  rail: Object.freeze({ y: 170, from: 18, to: 942 }),
  /** Where every figure is authored before the stylesheet carries it across. */
  origin: 60,
  /** The aperture: two posts, and the clear width between them. */
  aperture: Object.freeze({
    left: 498,
    right: 542,
    top: 104,
    gauge: 92,
    crest: 132,
  }),
  /** A figure that clears the aperture, and one that cannot. */
  figures: Object.freeze({
    passing: Object.freeze({ halfWidth: 18, height: 26 }),
    oversize: Object.freeze({ halfWidth: 29, height: 40 }),
  }),
  /** How many figures are in the stream, and the interval between them. */
  stream: Object.freeze({ count: 8, interval: 3 }),
  /** Rail graduations. */
  graduations: Object.freeze({ count: 15, from: 40, step: 62 }),
});

const { rail, origin, aperture, figures } = GATE_GEOMETRY;

/** One figure standing on the rail at the authored origin. */
function figure(halfWidth: number, height: number): string {
  return [
    [origin, rail.y - height],
    [origin + halfWidth, rail.y],
    [origin - halfWidth, rail.y],
  ].map(([x, y]) => `${x},${y}`).join(" ");
}

export const GATE_PASSING = figure(
  figures.passing.halfWidth,
  figures.passing.height,
);
export const GATE_OVERSIZE = figure(
  figures.oversize.halfWidth,
  figures.oversize.height,
);

/** The aperture read as the mark: the opening between the posts. */
export const GATE_APERTURE = Object.freeze({
  outline: [[520, aperture.crest], [aperture.right, rail.y], [
    aperture.left,
    rail.y,
  ]]
    .map((p) => p.join(",")).join(" "),
  half: [[520, aperture.crest], [aperture.right, rail.y], [520, rail.y]]
    .map((p) => p.join(",")).join(" "),
});

/**
 * Negative delays keep the stream in phase from the first frame: a positive
 * delay would leave the rail empty until the first figure arrived.
 */
export const GATE_STREAM: readonly number[] = Object.freeze(
  Array.from(
    { length: GATE_GEOMETRY.stream.count },
    (_, i) => -i * GATE_GEOMETRY.stream.interval,
  ),
);

/**
 * Fig. XV — the gate. A stream of figures is measured against one fixed
 * aperture. Those that clear it carry on without ceremony; one cut too wide
 * meets the posts, recoils, and returns the way it came. The authored SVG is
 * the complete resolved plate; the stylesheet carries the stream.
 */
export function GateArtwork({ id }: GateArtworkProps): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const { graduations } = GATE_GEOMETRY;

  return (
    <figure className="fig fig-gate">
      <svg
        className="fig__art fig-gate__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          A stream of figures tested for fit at one aperture
        </title>
        <desc id={descriptionId}>
          Small upward triangles travel from left to right along a graduated
          rail toward two posts that leave a narrow gap. Each triangle is
          narrower than the gap and passes through without pausing. One
          triangle, cut wider than the gap, reaches the posts, stops short,
          recoils, and travels back the way it came, and the mark inscribed in
          the aperture takes accent ink as it does.
        </desc>
        <g aria-hidden="true" transform="translate(20 176.25) scale(0.75)">
          <g className="fig-gate__graduations">
            {Array.from({ length: graduations.count }, (_, i) => (
              <line
                key={i}
                x1={graduations.from + i * graduations.step}
                y1={rail.y + 2}
                x2={graduations.from + i * graduations.step}
                y2={rail.y + 12}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <g className="fig-gate__gauge">
            <line
              x1={aperture.left}
              y1={aperture.gauge}
              x2={aperture.right}
              y2={aperture.gauge}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={aperture.left}
              y1={aperture.gauge - 8}
              x2={aperture.left}
              y2={aperture.gauge + 8}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={aperture.right}
              y1={aperture.gauge - 8}
              x2={aperture.right}
              y2={aperture.gauge + 8}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="fig-gate__gauge-drop"
              x1={aperture.left}
              y1={aperture.gauge + 8}
              x2={aperture.left}
              y2={rail.y}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="fig-gate__gauge-drop"
              x1={aperture.right}
              y1={aperture.gauge + 8}
              x2={aperture.right}
              y2={rail.y}
              vectorEffect="non-scaling-stroke"
            />
          </g>

          {GATE_STREAM.map((delay, index) => (
            <g
              key={index}
              className="fig-gate__travelling"
              style={{ animationDelay: `${delay}s` }}
            >
              <polygon
                points={GATE_PASSING}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          ))}

          <g className="fig-gate__turned-back">
            <polygon points={GATE_OVERSIZE} vectorEffect="non-scaling-stroke" />
            <line
              x1={origin - figures.oversize.halfWidth}
              y1={rail.y}
              x2={origin + figures.oversize.halfWidth}
              y2={rail.y}
              vectorEffect="non-scaling-stroke"
            />
          </g>

          <g className="fig-gate__posts">
            <line
              x1={aperture.left}
              y1={rail.y}
              x2={aperture.left}
              y2={aperture.top}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={aperture.right}
              y1={rail.y}
              x2={aperture.right}
              y2={aperture.top}
              vectorEffect="non-scaling-stroke"
            />
          </g>

          <line
            className="fig-gate__rail"
            x1={rail.from}
            y1={rail.y}
            x2={rail.to}
            y2={rail.y}
            vectorEffect="non-scaling-stroke"
          />

          <polygon
            className="fig-gate__aperture-half"
            points={GATE_APERTURE.half}
          />
          <polygon
            className="fig-gate__aperture"
            points={GATE_APERTURE.outline}
            vectorEffect="non-scaling-stroke"
          />

          <g className="fig-gate__seal">
            <polygon
              className="fig-gate__seal-half"
              points={GATE_APERTURE.half}
            />
            <polygon
              className="fig-gate__seal-edge"
              points={GATE_APERTURE.outline}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="fig-gate__seal-median"
              x1={520}
              y1={aperture.crest}
              x2={520}
              y2={rail.y}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
