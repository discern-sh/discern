/** Reusable ledger artwork: entries keyed to their predecessor, and one refusal. */

import type { ReactElement } from "react";

export interface LedgerArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One seated entry, with the split half of its key. */
export interface LedgerEntry {
  readonly d: string;
  readonly bottom: number;
  readonly half: string;
  /** When this entry re-seats, in seconds. */
  readonly offset: number;
}

/** The single proportion authority for the whole plate. */
export const LEDGER_GEOMETRY = Object.freeze({
  column: Object.freeze({ left: 150, right: 410, centre: 280 }),
  /** One entry's height, and the height of the key that joins two. */
  entry: Object.freeze({ height: 52, key: 20 }),
  /** Where the chain rests, and how many entries stand in it. */
  floor: 492,
  count: 7,
  /** Half-width of a well-formed key, and of the key that will not seat. */
  keyHalfWidth: Object.freeze({ valid: 26, refused: 40 }),
  /** Interval between one entry re-seating and the next, in seconds. */
  step: 0.84,
  /** Offset of the first re-seating, in seconds. */
  start: 2.4,
  /** Where the mismatch is marked: the shoulders that overhang the notch. */
  shoulders: Object.freeze([-33, 33] as const),
});

const { column, entry, floor, count, keyHalfWidth } = LEDGER_GEOMETRY;

/**
 * One entry: a key above, the matching notch below. An entry can only seat on
 * a predecessor cut to the same key, which is the whole of the mechanism.
 */
function band(bottom: number, half: number): string {
  const top = bottom - entry.height;
  const { left, right, centre } = column;
  return [
    `M${left} ${bottom}`,
    `L${centre - half} ${bottom}`,
    `L${centre} ${bottom - entry.key}`,
    `L${centre + half} ${bottom}`,
    `L${right} ${bottom}`,
    `L${right} ${top}`,
    `L${centre + half} ${top}`,
    `L${centre} ${top - entry.key}`,
    `L${centre - half} ${top}`,
    `L${left} ${top}`,
    "Z",
  ].join("");
}

/** The seated chain, bottom entry first. */
export const LEDGER_ENTRIES: readonly LedgerEntry[] = Object.freeze(
  Array.from({ length: count }, (_, i) => {
    const bottom = floor - i * entry.height;
    const top = bottom - entry.height;
    return Object.freeze({
      d: band(bottom, keyHalfWidth.valid),
      bottom,
      half: [
        `${column.centre},${top - entry.key}`,
        `${column.centre + keyHalfWidth.valid},${top}`,
        `${column.centre},${top}`,
      ].join(" "),
      offset: LEDGER_GEOMETRY.start + i * LEDGER_GEOMETRY.step,
    });
  }),
);

/** The entry cut to a wider key, whose shoulders overhang the notch. */
export const LEDGER_REFUSED: string = band(
  floor - count * entry.height,
  keyHalfWidth.refused,
);

/** The keyline that runs the length of the chain, through every key. */
export const LEDGER_KEYLINE = Object.freeze({
  x: column.centre,
  from: floor,
  to: floor - count * entry.height - entry.key,
});

/**
 * Fig. XIV — the ledger. Entries seat upward, each keyed to the one below, and
 * a keyline runs the length of the chain. A later entry cut to a wider key
 * descends onto the notch, overhangs it, recoils, and withdraws. The authored
 * SVG is the complete resolved chain; the stylesheet supplies only the
 * re-seating and the refusal.
 */
export function LedgerArtwork({ id }: LedgerArtworkProps): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const shoulderTop = floor - count * entry.height - 8;

  return (
    <figure className="fig fig-ledger">
      <svg
        className="fig__art fig-ledger__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          An append-only chain of keyed entries, and one that will not key
        </title>
        <desc id={descriptionId}>
          Seven entries stack upward in a column, each cut with a triangular key
          on top that seats into the matching notch of the entry above it. A
          keyline runs the length of the chain. An eighth entry, cut to a wider
          key, descends from above onto the top of the chain, overhangs the
          notch on both shoulders, recoils, and withdraws. The chain then takes
          accent ink across the right half of every key.
        </desc>
        <g aria-hidden="true" transform="translate(128 18) scale(0.9)">
          <g className="fig-ledger__construction">
            {LEDGER_ENTRIES.map((item, index) => (
              <line
                key={index}
                x1={118}
                y1={item.bottom}
                x2={140}
                y2={item.bottom}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <g className="fig-ledger__rest">
            <g className="fig-ledger__chain">
              {LEDGER_ENTRIES.map((item, index) => (
                <path
                  key={index}
                  d={item.d}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
            <g className="fig-ledger__keys">
              {LEDGER_ENTRIES.map((item, index) => (
                <polygon key={index} points={item.half} />
              ))}
            </g>
            <line
              className="fig-ledger__keyline"
              x1={LEDGER_KEYLINE.x}
              y1={LEDGER_KEYLINE.from}
              x2={LEDGER_KEYLINE.x}
              y2={LEDGER_KEYLINE.to}
              vectorEffect="non-scaling-stroke"
            />
          </g>

          <g className="fig-ledger__seating">
            {LEDGER_ENTRIES.map((item, index) => (
              <path
                key={index}
                d={item.d}
                vectorEffect="non-scaling-stroke"
                style={{
                  animationDelay: `${Math.round(item.offset * 100) / 100}s`,
                }}
              />
            ))}
          </g>

          <line
            className="fig-ledger__keyline-ink"
            x1={LEDGER_KEYLINE.x}
            y1={LEDGER_KEYLINE.from}
            x2={LEDGER_KEYLINE.x}
            y2={LEDGER_KEYLINE.to}
            pathLength={1}
            vectorEffect="non-scaling-stroke"
          />

          <g className="fig-ledger__refused">
            <path d={LEDGER_REFUSED} vectorEffect="non-scaling-stroke" />
          </g>

          <g className="fig-ledger__mismatch">
            {LEDGER_GEOMETRY.shoulders.map((dx, index) => (
              <line
                key={index}
                x1={column.centre + dx}
                y1={shoulderTop}
                x2={column.centre + dx}
                y2={shoulderTop + 16}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <g className="fig-ledger__seal">
            <g className="fig-ledger__seal-keys">
              {LEDGER_ENTRIES.map((item, index) => (
                <polygon key={index} points={item.half} />
              ))}
            </g>
            <line
              className="fig-ledger__seal-keyline"
              x1={LEDGER_KEYLINE.x}
              y1={LEDGER_KEYLINE.from}
              x2={LEDGER_KEYLINE.x}
              y2={LEDGER_KEYLINE.to}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
