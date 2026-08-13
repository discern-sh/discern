/** Reusable packing artwork: a triangle fills itself to exhaustion. */

import type { CSSProperties, ReactElement } from "react";

export interface PackingArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One placed cell, with the rest and peak opacities of its generation. */
export interface PackingCell {
  readonly points: string;
  readonly generation: number;
  readonly rest: number;
  readonly peak: number;
  readonly offset: number;
}

/** The single proportion authority for the whole plate. */
export const PACKING_GEOMETRY = Object.freeze({
  apex: Object.freeze({ x: 270, y: 58 }),
  baseLeft: Object.freeze({ x: 58, y: 425 }),
  baseRight: Object.freeze({ x: 482, y: 425 }),
  /** Generations of medial subdivision: 1 + 3 + 9 + 27 cells. */
  generations: 4,
  /** Resting opacity per generation, finest last. */
  rest: Object.freeze([0.155, 0.125, 0.098, 0.072] as const),
  /** Peak opacity as the scan passes, per generation. */
  peak: Object.freeze([0.46, 0.4, 0.34, 0.28] as const),
  /** When each generation's scan begins, in seconds. */
  start: Object.freeze([1.2, 2.3, 3.9, 6.5] as const),
  /** Interval between cells within a generation, in seconds. */
  step: Object.freeze([0, 0.44, 0.26, 0.17] as const),
  /** The measure at the right of the plate. */
  gauge: Object.freeze({ x: 506, top: 58, bottom: 425 }),
});

const { apex, baseLeft, baseRight, generations } = PACKING_GEOMETRY;

type Point = readonly [number, number];
type Triangle = readonly [Point, Point, Point];

/** Return the midpoint shared by two triangle vertices. */
function midpoint(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/**
 * Each upward cell yields its medial inverted cell and three upward corner
 * cells. The inverted cells are what the plate places; the corners are what
 * remains to be filled.
 */
const GENERATIONS: ReadonlyArray<ReadonlyArray<Triangle>> = Object.freeze(
  (() => {
    const out: Triangle[][] = Array.from({ length: generations }, () => []);
    const divide = (a: Point, b: Point, c: Point, depth: number): void => {
      if (depth >= generations) return;
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      const generation = out[depth];
      if (generation === undefined) {
        throw new Error("packing: subdivision left the generation set");
      }
      generation.push([ab, bc, ca]);
      divide(a, ab, ca, depth + 1);
      divide(ab, b, bc, depth + 1);
      divide(ca, bc, c, depth + 1);
    };
    divide(
      [apex.x, apex.y],
      [baseLeft.x, baseLeft.y],
      [baseRight.x, baseRight.y],
      0,
    );
    return out.map((generation) => Object.freeze(generation));
  })(),
);

/** Format one triangle for an SVG points attribute. */
function points(t: readonly Point[]): string {
  return t.map(([x, y]) =>
    `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
  ).join(" ");
}

/** Every cell, ordered largest first: the order exhaustion proceeds in. */
export const PACKING_CELLS: readonly PackingCell[] = Object.freeze((() => {
  const { rest, peak, start, step } = PACKING_GEOMETRY;
  const out: PackingCell[] = [];
  GENERATIONS.forEach((generation, g) => {
    const centroidY = ([a, b, c]: Triangle) => (a[1] + b[1] + c[1]) / 3;
    const centroidX = ([a, b, c]: Triangle) => (a[0] + b[0] + c[0]) / 3;
    const restingOpacity = rest[g];
    const peakOpacity = peak[g];
    const startOffset = start[g];
    const stepOffset = step[g];
    if (
      restingOpacity === undefined || peakOpacity === undefined ||
      startOffset === undefined || stepOffset === undefined
    ) {
      throw new Error("packing: generation has no timing or opacity values");
    }
    generation
      .slice()
      .sort((a, b) =>
        centroidY(a) - centroidY(b) || centroidX(a) - centroidX(b)
      )
      .forEach((t, i) => {
        out.push(Object.freeze({
          points: points(t),
          generation: g,
          rest: restingOpacity,
          peak: peakOpacity,
          offset: startOffset + i * stepOffset,
        }));
      });
  });
  return out;
})());

/**
 * Covered area after each generation is 1 − (3/4)^g: a quarter, then seven
 * sixteenths, then more slowly, and never all of it.
 */
export const PACKING_LEVELS: readonly number[] = Object.freeze(
  Array.from({ length: generations }, (_, i) => 1 - Math.pow(0.75, i + 1)),
);

const FRAME_POINTS = [
  [apex.x, apex.y],
  [baseRight.x, baseRight.y],
  [baseLeft.x, baseLeft.y],
].map(([x, y]) => `${x},${y}`).join(" ");

const FRAME_HALF_POINTS = [
  [apex.x, apex.y],
  [baseRight.x, baseRight.y],
  [apex.x, baseRight.y],
].map(([x, y]) => `${x},${y}`).join(" ");

/**
 * Fig. XI — the packing. One triangle fills itself with self-similar cells in
 * order of size, forty of them across four generations, while a measure at the
 * right records the area reached. The authored SVG is the complete resolved
 * packing; the stylesheet supplies only the scan and the measure.
 */
export function PackingArtwork({ id }: PackingArtworkProps): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const { gauge } = PACKING_GEOMETRY;
  const span = gauge.bottom - gauge.top;

  return (
    <figure className="fig fig-packing">
      <svg
        className="fig__art fig-packing__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          A triangle filling itself with self-similar cells
        </title>
        <desc id={descriptionId}>
          One large upward triangle holds forty smaller inverted cells across
          four generations, each generation finer and fainter than the last. A
          scan brightens the cells in order of size, and a measure at the right
          of the plate rises through four graduations to record the area
          reached, stopping short of the whole. The frame then takes accent ink
          across its right half.
        </desc>
        <g aria-hidden="true" transform="translate(110 0)">
          <polygon className="fig-packing__residue" points={FRAME_POINTS} />

          <g className="fig-packing__cells">
            {PACKING_CELLS.map((c, index) => (
              <polygon
                key={index}
                className="fig-packing__cell"
                points={c.points}
                data-packing-generation={c.generation}
                vectorEffect="non-scaling-stroke"
                style={{
                  "--fig-packing-rest": c.rest,
                  "--fig-packing-peak": c.peak,
                  animationDelay: `${Math.round(c.offset * 1000) / 1000}s`,
                } as CSSProperties}
              />
            ))}
          </g>

          <polygon
            className="fig-packing__frame"
            points={FRAME_POINTS}
            vectorEffect="non-scaling-stroke"
          />

          <g className="fig-packing__graduations">
            <line
              x1={gauge.x}
              y1={gauge.top}
              x2={gauge.x}
              y2={gauge.bottom}
              vectorEffect="non-scaling-stroke"
            />
            {PACKING_LEVELS.map((level, index) => (
              <line
                key={index}
                x1={index === PACKING_LEVELS.length - 1 ? 490 : 496}
                y1={Math.round((gauge.bottom - level * span) * 10) / 10}
                x2={gauge.x}
                y2={Math.round((gauge.bottom - level * span) * 10) / 10}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <line
            className="fig-packing__measure"
            x1={gauge.x}
            y1={gauge.bottom}
            x2={gauge.x}
            y2={gauge.top}
            pathLength={1}
          />

          <g className="fig-packing__mark">
            <polygon
              className="fig-packing__mark-half"
              points={FRAME_HALF_POINTS}
            />
            <polygon
              className="fig-packing__mark-edge"
              points={FRAME_POINTS}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="fig-packing__mark-median"
              x1={apex.x}
              y1={apex.y}
              x2={apex.x}
              y2={baseRight.y}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
