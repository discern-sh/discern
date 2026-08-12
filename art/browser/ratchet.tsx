/** Fig. IV — the ratchet: stepped limits close a corridor on a live measure. */

import type { ReactElement } from "react";

export interface RatchetArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One irreversible inward step of a limit line. */
export interface RatchetStep {
  /** Horizontal position where the vertical step lands. */
  readonly x: number;
  /** The level the limit held before this step. */
  readonly from: number;
  /** The level the limit holds after this step. */
  readonly to: number;
}

/** A permanent tick marking a stand the limit abandoned. */
export interface RatchetNotch {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** -1 extends the tick upward (an abandoned upper stand); 1 downward. */
  readonly outward: -1 | 1;
}

/** Where the corridor closes and the measure comes to rest. */
export const RATCHET_APEX = Object.freeze({ x: 620, y: 270 } as const);

/** The left margin where both limits and the measure begin. */
export const RATCHET_PLATE_LEFT = 76;

/** Each staircase draws exactly this length; the stylesheet's dash metric. */
export const RATCHET_LIMIT_DASH = 664;

/** The upper limit's five diminishing, irreversible steps. */
export const RATCHET_UPPER_STEPS: readonly RatchetStep[] = Object.freeze([
  { x: 148, from: 150, to: 186 },
  { x: 252, from: 186, to: 216 },
  { x: 340, from: 216, to: 240 },
  { x: 436, from: 240, to: 258 },
  { x: 564, from: 258, to: 270 },
]);

/** The lower limit's four steps; the last one closes the corridor at the apex. */
export const RATCHET_LOWER_STEPS: readonly RatchetStep[] = Object.freeze([
  { x: 196, from: 390, to: 348 },
  { x: 308, from: 348, to: 312 },
  { x: 384, from: 312, to: 282 },
  { x: 620, from: 282, to: 270 },
]);

/** Every abandoned corner, in the order the steps land across the plate. */
export const RATCHET_NOTCHES: readonly RatchetNotch[] = Object.freeze(
  [
    ...RATCHET_UPPER_STEPS.map((step) => ({
      x: step.x,
      y: step.from,
      outward: -1 as const,
    })),
    ...RATCHET_LOWER_STEPS.map((step) => ({
      x: step.x,
      y: step.from,
      outward: 1 as const,
    })),
  ]
    .sort((a, b) => a.x - b.x)
    .map((notch, position) => Object.freeze({ ...notch, index: position + 1 })),
);

/**
 * The measure's authored oscillation: an irregular instrument hand whose
 * amplitude narrows with the corridor and dies exactly on the apex.
 */
export const RATCHET_MEASURE_POINTS: readonly (readonly [number, number])[] =
  Object.freeze([
    [76, 270],
    [90, 226],
    [104, 314],
    [118, 258],
    [132, 330],
    [146, 236],
    [162, 302],
    [178, 224],
    [192, 316],
    [208, 254],
    [222, 324],
    [236, 232],
    [250, 286],
    [266, 236],
    [280, 308],
    [296, 252],
    [310, 296],
    [324, 242],
    [338, 288],
    [352, 254],
    [366, 292],
    [380, 258],
    [394, 274],
    [408, 252],
    [422, 272],
    [436, 264],
    [450, 274],
    [464, 265],
    [478, 276],
    [492, 266],
    [506, 275],
    [520, 267],
    [534, 274],
    [548, 268],
    [562, 273],
    [576, 272],
    [590, 277],
    [602, 273],
    [612, 275],
    [620, 270],
  ]);

/** The compact split mark the corridor closes into, just past the apex. */
export const RATCHET_MARK = Object.freeze(
  {
    leftX: 630,
    splitX: 644,
    rightX: 658,
    topY: 254,
    baseY: 281,
  } as const,
);

const RULE_TOP = 118;
const RULE_BOTTOM = 422;
const CENTRE_LEFT = 64;
const CENTRE_RIGHT = 696;
const NOTCH_OUTWARD_REACH = 7;
const NOTCH_INWARD_REACH = 3;

const MARK_LEFT_HALF = `${RATCHET_MARK.splitX},${RATCHET_MARK.topY} ` +
  `${RATCHET_MARK.leftX},${RATCHET_MARK.baseY} ` +
  `${RATCHET_MARK.splitX},${RATCHET_MARK.baseY}`;
const MARK_RIGHT_HALF = `${RATCHET_MARK.splitX},${RATCHET_MARK.topY} ` +
  `${RATCHET_MARK.rightX},${RATCHET_MARK.baseY} ` +
  `${RATCHET_MARK.splitX},${RATCHET_MARK.baseY}`;

/** Trace one staircase from the plate's left margin to the apex. */
function limitPath(steps: readonly RatchetStep[]): string {
  const first = steps[0];
  const last = steps[steps.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error("A limit line needs at least one step.");
  }
  const segments = [`M ${RATCHET_PLATE_LEFT} ${first.from}`];
  for (const step of steps) {
    segments.push(`H ${step.x}`, `V ${step.to}`);
  }
  if (last.x !== RATCHET_APEX.x) {
    segments.push(`H ${RATCHET_APEX.x}`);
  }
  return segments.join(" ");
}

/** Join the measure's authored oscillation into one fine polyline path. */
function measurePath(
  points: readonly (readonly [number, number])[],
): string {
  return points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
}

/**
 * Fig. IV, "The ratchet". Two stepped limit lines converge from the left edge
 * to a single apex; every step leaves a permanent tick at the corner it
 * abandoned, and a fine measure narrows between them until the corridor
 * closes beside a compact split mark. The authored SVG is the complete
 * resolved plate; the stylesheet only supplies the journey into it.
 */
export function RatchetArtwork(
  { id }: RatchetArtworkProps,
): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <figure className="fig fig-ratchet">
      <svg
        className="fig__art fig-ratchet__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          Two stepped limits closing on a wavering line
        </title>
        <desc id={descriptionId}>
          Two stepped horizontal limits converge from the left edge toward a
          single apex, each inward step leaving a small tick at the corner it
          abandoned, while a fine wavering line narrows between them and comes
          to rest beside a compact half-filled triangle.
        </desc>
        <g aria-hidden="true">
          <g className="fig-ratchet__construction">
            <line
              className="fig-ratchet__centre"
              x1={CENTRE_LEFT}
              y1={RATCHET_APEX.y}
              x2={CENTRE_RIGHT}
              y2={RATCHET_APEX.y}
              vectorEffect="non-scaling-stroke"
            />
            {RATCHET_NOTCHES.map((notch) => (
              <line
                key={`rule-${notch.x}`}
                className="fig-ratchet__rule"
                x1={notch.x}
                y1={RULE_TOP}
                x2={notch.x}
                y2={RULE_BOTTOM}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <path
            className="fig-ratchet__measure"
            data-ratchet-measure="true"
            d={measurePath(RATCHET_MEASURE_POINTS)}
            pathLength={1000}
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="fig-ratchet__limit fig-ratchet__limit--upper"
            data-ratchet-limit="upper"
            d={limitPath(RATCHET_UPPER_STEPS)}
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="fig-ratchet__limit fig-ratchet__limit--lower"
            data-ratchet-limit="lower"
            d={limitPath(RATCHET_LOWER_STEPS)}
            vectorEffect="non-scaling-stroke"
          />
          <g className="fig-ratchet__notches">
            {RATCHET_NOTCHES.map((notch) => (
              <line
                key={`notch-${notch.x}`}
                className={`fig-ratchet__notch fig-ratchet__notch--n${notch.index}`}
                data-ratchet-notch={String(notch.index)}
                x1={notch.x}
                y1={notch.y + notch.outward * NOTCH_OUTWARD_REACH}
                x2={notch.x}
                y2={notch.y - notch.outward * NOTCH_INWARD_REACH}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g className="fig-ratchet__mark" data-ratchet-mark="true">
            <polygon
              className="fig-ratchet__mark-outline"
              points={MARK_LEFT_HALF}
              vectorEffect="non-scaling-stroke"
            />
            <polygon
              className="fig-ratchet__mark-fill"
              points={MARK_RIGHT_HALF}
            />
            <polygon
              className="fig-ratchet__mark-accent"
              points={MARK_RIGHT_HALF}
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
