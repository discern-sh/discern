/** Reusable phase artwork: a field inverts cell by cell as a front crosses. */

import type { ReactElement } from "react";

export interface PhaseArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One lattice cell, resolved to its points and its place in the sweep. */
export interface PhaseCell {
  readonly points: string;
  /** Position along the slanted front, normalised to 0 at the leading edge. */
  readonly order: number;
  readonly up: boolean;
}

/** The single proportion authority for the whole plate. */
export const PHASE_GEOMETRY = Object.freeze({
  origin: Object.freeze({ x: 60, y: 78 }),
  /** One cell's base width and height; the lattice tiles on half-widths. */
  cell: Object.freeze({ width: 96, height: 83 }),
  rows: 5,
  /** Cells per row, alternating upward and downward. */
  columns: 17,
  /** How far the front leans: dx per dy along a line of equal phase. */
  slant: 0.32,
  /** Seconds between the first cell turning and the last. */
  spread: 7,
  /** Where the plate looks for the cell that carries the mark. */
  centre: Object.freeze({ x: 480, y: 270 }),
  /** Overshoot of the front line past the field, top and bottom. */
  frontOvershoot: 16,
});

const { origin, cell, rows, columns, slant } = PHASE_GEOMETRY;
const FIELD_MID_Y = origin.y + (rows * cell.height) / 2;

interface RawCell {
  readonly points: readonly (readonly [number, number])[];
  readonly cx: number;
  readonly cy: number;
  readonly top: number;
  readonly left: number;
  readonly up: boolean;
  readonly support: number;
}

/** The tiling: even columns point up, odd columns point down. */
const RAW_CELLS: readonly RawCell[] = Object.freeze((() => {
  const out: RawCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    const top = origin.y + row * cell.height;
    for (let i = 0; i < columns; i += 1) {
      const left = origin.x + (i * cell.width) / 2;
      const up = i % 2 === 0;
      const points = up
        ? ([[left, top + cell.height], [left + cell.width, top + cell.height], [
          left + cell.width / 2,
          top,
        ]] as const)
        : ([[left, top], [left + cell.width, top], [
          left + cell.width / 2,
          top + cell.height,
        ]] as const);
      const cx = left + cell.width / 2;
      const cy = top + cell.height / 2;
      out.push(Object.freeze({
        points,
        cx,
        cy,
        top,
        left,
        up,
        support: cx + slant * (cy - FIELD_MID_Y),
      }));
    }
  }
  return out;
})());

const SUPPORT_MIN = Math.min(...RAW_CELLS.map((c) => c.support));
const SUPPORT_MAX = Math.max(...RAW_CELLS.map((c) => c.support));

/** Format planar points for an SVG points attribute. */
function points(pts: readonly (readonly [number, number])[]): string {
  return pts.map(([x, y]) =>
    `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
  ).join(" ");
}

/** Every cell, carrying the offset at which the front reaches it. */
export const PHASE_CELLS: readonly PhaseCell[] = Object.freeze(
  RAW_CELLS.map((c) =>
    Object.freeze({
      points: points(c.points),
      order: (c.support - SUPPORT_MIN) / (SUPPORT_MAX - SUPPORT_MIN),
      up: c.up,
    })
  ),
);

/** The upward cell nearest the centre: the one that carries the mark. */
const MARK_INDEX = (() => {
  let index = 0;
  let nearest = Infinity;
  RAW_CELLS.forEach((c, i) => {
    if (!c.up) return;
    const d = Math.hypot(
      c.cx - PHASE_GEOMETRY.centre.x,
      c.cy - PHASE_GEOMETRY.centre.y,
    );
    if (d < nearest) {
      nearest = d;
      index = i;
    }
  });
  return index;
})();

const MARK_CELL = RAW_CELLS[MARK_INDEX];
if (MARK_CELL === undefined) {
  throw new Error("phase: the lattice does not contain a mark cell");
}

/** The marked cell, and the split half that registers the logomark on it. */
export const PHASE_MARK = Object.freeze({
  points: points(MARK_CELL.points),
  half: points([
    [MARK_CELL.cx, MARK_CELL.top],
    [MARK_CELL.left + cell.width, MARK_CELL.top + cell.height],
    [MARK_CELL.cx, MARK_CELL.top + cell.height],
  ]),
  order: (MARK_CELL.support - SUPPORT_MIN) / (SUPPORT_MAX - SUPPORT_MIN),
});

/** The row rules the lattice sits on. */
export const PHASE_RULES: readonly number[] = Object.freeze(
  Array.from({ length: rows + 1 }, (_, r) => origin.y + r * cell.height),
);

/** Convert a cell's normalised order into its CSS phase delay. */
function seconds(order: number): string {
  return `${Math.round(order * PHASE_GEOMETRY.spread * 1000) / 1000}s`;
}

/**
 * Fig. IX — the phase. A field of eighty-five cells inverts one at a time as
 * a slanted front crosses it, holds inverted, and inverts back as the next
 * front follows. One cell near the centre carries the mark as it turns. The
 * authored SVG is the complete resolved field; the stylesheet supplies only
 * the front and the turning.
 */
export function PhaseArtwork({ id }: PhaseArtworkProps): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const reach = rows * cell.height + PHASE_GEOMETRY.frontOvershoot * 2;
  const lean = slant * reach / 2;

  return (
    <figure className="fig fig-phase">
      <svg
        className="fig__art fig-phase__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          A field of triangles inverting as a wavefront crosses it
        </title>
        <desc id={descriptionId}>
          Five rows of small triangles tile a wide band, alternating upward and
          downward. A faint slanted front travels from left to right and each
          cell inverts as the front reaches it. The field holds inverted, then a
          second front follows and returns every cell to its original
          orientation. One cell near the centre carries an accent split triangle
          as it turns.
        </desc>
        <g aria-hidden="true" transform="translate(20 67.5) scale(0.75)">
          <g className="fig-phase__rules">
            {PHASE_RULES.map((y, index) => (
              <line
                key={index}
                x1={40}
                y1={y}
                x2={944}
                y2={y}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <g className="fig-phase__field">
            {PHASE_CELLS.map((c, index) => (
              <polygon
                key={index}
                className="fig-phase__cell"
                points={c.points}
                vectorEffect="non-scaling-stroke"
                style={{ animationDelay: seconds(c.order) }}
              />
            ))}
          </g>

          <g className="fig-phase__mark">
            <g
              className="fig-phase__mark-cell"
              style={{ animationDelay: seconds(PHASE_MARK.order) }}
            >
              <polygon
                className="fig-phase__mark-half"
                points={PHASE_MARK.half}
              />
              <polygon
                className="fig-phase__mark-edge"
                points={PHASE_MARK.points}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          </g>

          <line
            className="fig-phase__front"
            x1={lean}
            y1={origin.y - PHASE_GEOMETRY.frontOvershoot}
            x2={-lean}
            y2={origin.y + rows * cell.height + PHASE_GEOMETRY.frontOvershoot}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </svg>
    </figure>
  );
}
