/** Reusable quorum artwork: independent verdicts, one composite mark. */

import type { ReactElement } from "react";

export interface QuorumArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One witness: its outline, its verdict half, its probe and its tally tick. */
export interface QuorumSeat {
  readonly centre: number;
  readonly outline: string;
  readonly half: string;
  readonly probe: string;
  readonly tick: Readonly<{ from: number; to: number }>;
  readonly probeOffset: number;
  readonly verdictOffset: number;
  readonly tickOffset: number;
}

/** The single proportion authority for the whole plate. */
export const QUORUM_GEOMETRY = Object.freeze({
  /** The five witness positions across the plate. */
  seats: Object.freeze([140, 260, 380, 500, 620] as const),
  witness: Object.freeze({ top: 88, base: 168, halfWidth: 46 }),
  /** The tally rule and the quorum rule beneath the witnesses. */
  tally: Object.freeze({ y: 196, halfWidth: 11 }),
  quorum: Object.freeze({ y: 218, from: 118, to: 642, offset: 11.8 }),
  /** The composite mark the plate resolves onto. */
  composite: Object.freeze({
    apex: Object.freeze([380, 252] as const),
    baseLeft: Object.freeze([258, 463] as const),
    baseRight: Object.freeze([502, 463] as const),
  }),
  /**
   * When each verdict lands. The fourth witness hesitates and reports after
   * the fifth: a quorum that always arrives in order is not a quorum.
   */
  verdicts: Object.freeze([5.8, 6.8, 7.8, 10.8, 8.8] as const),
  probing: Object.freeze({ start: 3.8, step: 0.32 }),
  /** How long after a verdict its tally tick follows. */
  tickLag: 0.32,
});

const { witness, tally, composite } = QUORUM_GEOMETRY;

/** Format planar points for an SVG points attribute. */
function points(pts: readonly (readonly [number, number])[]): string {
  return pts.map(([x, y]) =>
    `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
  ).join(" ");
}

/** The five witnesses, each with its own schedule. */
export const QUORUM_SEATS: readonly QuorumSeat[] = Object.freeze(
  QUORUM_GEOMETRY.seats.map((centre, i) => {
    const { top, base, halfWidth } = witness;
    const waist = (top + base) / 2;
    const verdictOffset = QUORUM_GEOMETRY.verdicts[i];
    if (verdictOffset === undefined) {
      throw new Error("quorum: witness has no verdict schedule");
    }
    return Object.freeze({
      centre,
      outline: points([[centre, top], [centre + halfWidth, base], [
        centre - halfWidth,
        base,
      ]]),
      half: points([[centre, top], [centre + halfWidth, base], [centre, base]]),
      /** The internal test: the witness's own medial cell. */
      probe: points([
        [centre - halfWidth / 2, waist],
        [centre + halfWidth / 2, waist],
        [centre, base],
      ]),
      tick: Object.freeze({
        from: centre - tally.halfWidth,
        to: centre + tally.halfWidth,
      }),
      probeOffset: QUORUM_GEOMETRY.probing.start +
        i * QUORUM_GEOMETRY.probing.step,
      verdictOffset,
      tickOffset: verdictOffset + QUORUM_GEOMETRY.tickLag,
    });
  }),
);

const COMPOSITE_POINTS = points([
  composite.apex,
  composite.baseRight,
  composite.baseLeft,
]);
const COMPOSITE_HALF_POINTS = points([
  composite.apex,
  composite.baseRight,
  [composite.apex[0], composite.baseRight[1]],
]);

/** Format a phrase offset as a compact CSS time. */
function seconds(value: number): string {
  return `${Math.round(value * 100) / 100}s`;
}

/**
 * Fig. XII — the quorum. Five witnesses test the same figure independently and
 * return their verdicts one at a time, the fourth hesitating. Only once the
 * quorum rule closes across all five does the composite mark take ink. The
 * authored SVG is the complete resolved plate; the stylesheet supplies only
 * the re-testing.
 */
export function QuorumArtwork({ id }: QuorumArtworkProps): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const { quorum } = QUORUM_GEOMETRY;

  return (
    <figure className="fig fig-quorum">
      <svg
        className="fig__art fig-quorum__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          Five independent verdicts and one composite mark
        </title>
        <desc id={descriptionId}>
          Five small upward triangles stand in a row, each with its right half
          inked as a verdict and a tally tick beneath it. A rule runs beneath
          all five. Below them stands one large upward triangle. The verdicts
          are re-tested one at a time, the fourth arriving after the fifth, and
          only once the rule has closed across all five does the large triangle
          take accent ink across its right half.
        </desc>
        <g aria-hidden="true">
          <g className="fig-quorum__rest">
            <g className="fig-quorum__verdicts">
              {QUORUM_SEATS.map((seat, index) => (
                <polygon key={index} points={seat.half} />
              ))}
            </g>
            <g className="fig-quorum__tally">
              {QUORUM_SEATS.map((seat, index) => (
                <line
                  key={index}
                  x1={seat.tick.from}
                  y1={tally.y}
                  x2={seat.tick.to}
                  y2={tally.y}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
            <line
              className="fig-quorum__rule"
              x1={quorum.from}
              y1={quorum.y}
              x2={quorum.to}
              y2={quorum.y}
              vectorEffect="non-scaling-stroke"
            />
            <polygon
              className="fig-quorum__composite-half"
              points={COMPOSITE_HALF_POINTS}
            />
          </g>

          <g className="fig-quorum__construction">
            {QUORUM_SEATS.map((seat, index) => (
              <line
                key={index}
                x1={seat.centre}
                y1={witness.top}
                x2={seat.centre}
                y2={witness.base}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <g className="fig-quorum__probes">
            {QUORUM_SEATS.map((seat, index) => (
              <polygon
                key={index}
                points={seat.probe}
                pathLength={1}
                style={{ animationDelay: seconds(seat.probeOffset) }}
              />
            ))}
          </g>

          <g className="fig-quorum__returns">
            {QUORUM_SEATS.map((seat, index) => (
              <polygon
                key={index}
                points={seat.half}
                style={{ animationDelay: seconds(seat.verdictOffset) }}
              />
            ))}
          </g>

          <g className="fig-quorum__marks">
            {QUORUM_SEATS.map((seat, index) => (
              <line
                key={index}
                x1={seat.tick.from}
                y1={tally.y}
                x2={seat.tick.to}
                y2={tally.y}
                vectorEffect="non-scaling-stroke"
                style={{ animationDelay: seconds(seat.tickOffset) }}
              />
            ))}
          </g>

          <line
            className="fig-quorum__rule-ink"
            x1={quorum.from}
            y1={quorum.y}
            x2={quorum.to}
            y2={quorum.y}
            pathLength={1}
            style={{ animationDelay: seconds(quorum.offset) }}
          />

          <g className="fig-quorum__outlines">
            {QUORUM_SEATS.map((seat, index) => (
              <polygon
                key={index}
                points={seat.outline}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <polygon
            className="fig-quorum__composite"
            points={COMPOSITE_POINTS}
            vectorEffect="non-scaling-stroke"
          />
          <line
            className="fig-quorum__composite-median"
            x1={composite.apex[0]}
            y1={composite.apex[1]}
            x2={composite.apex[0]}
            y2={composite.baseRight[1]}
            vectorEffect="non-scaling-stroke"
          />

          <g className="fig-quorum__seal">
            <polygon
              className="fig-quorum__seal-half"
              points={COMPOSITE_HALF_POINTS}
            />
            <line
              className="fig-quorum__seal-median"
              x1={composite.apex[0]}
              y1={composite.apex[1]}
              x2={composite.apex[0]}
              y2={composite.baseRight[1]}
              vectorEffect="non-scaling-stroke"
            />
          </g>
          <polygon
            className="fig-quorum__seal-edge"
            points={COMPOSITE_POINTS}
            pathLength={1}
          />
        </g>
      </svg>
    </figure>
  );
}
