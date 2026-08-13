/** Reusable rule artwork: one triangle re-deriving its three-generation subdivision. */

import type { ReactElement } from "react";

export interface RuleArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One point on the plate, in artboard units. */
export interface RulePoint {
  readonly x: number;
  readonly y: number;
}

/** One straightedge chord drawn between two derived midpoints. */
export interface RuleChord {
  readonly from: RulePoint;
  readonly to: RulePoint;
}

/** One triangle, its vertices listed in drawing order. */
export type RuleTriangle = readonly [RulePoint, RulePoint, RulePoint];

/** One short compass arc from the Euclidean bisection of an outer side. */
export interface RuleBisectionArc {
  /** Zero-based index of the outer side this arc helps bisect. */
  readonly side: number;
  /** Which endpoint of that side anchors the compass. */
  readonly anchor: 0 | 1;
  readonly d: string;
}

const SIDE = 360;
const APEX_X = 380;
const APEX_Y = 112;
const TRIANGLE_HEIGHT = (SIDE * Math.sqrt(3)) / 2;
/** Compass radius for bisecting the outer sides, as a share of the side. */
const BISECTION_RADIUS = SIDE * 0.56;
/** Half the angular window of each short bisection arc, in radians. */
const ARC_HALF_ANGLE = 0.09;
/** Half the length of each midpoint tick, in artboard units. */
const TICK_REACH = 8;

/** The outer triangle: the plate's given premise, apex up and centred. */
export const RULE_TRIANGLE: RuleTriangle = [
  { x: APEX_X, y: APEX_Y },
  { x: APEX_X - SIDE / 2, y: APEX_Y + TRIANGLE_HEIGHT },
  { x: APEX_X + SIDE / 2, y: APEX_Y + TRIANGLE_HEIGHT },
];

/** Format a coordinate to two deliberate decimal places. */
function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** The midpoint the compass-and-straightedge bisection finds. */
function midpoint(a: RulePoint, b: RulePoint): RulePoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** A triangle's centre of gravity. */
function centroid(triangle: RuleTriangle): RulePoint {
  const [a, b, c] = triangle;
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

/** A straight point-to-point path for one chord. */
function chordPath(chord: RuleChord): string {
  return `M ${fmt(chord.from.x)} ${fmt(chord.from.y)} L ${fmt(chord.to.x)} ${
    fmt(chord.to.y)
  }`;
}

/** A closed path around one triangle's perimeter. */
function trianglePath(triangle: RuleTriangle): string {
  const [a, b, c] = triangle;
  return `M ${fmt(a.x)} ${fmt(a.y)} L ${fmt(b.x)} ${fmt(b.y)} L ${fmt(c.x)} ${
    fmt(c.y)
  } Z`;
}

interface RuleSubdivision {
  readonly chords: readonly RuleChord[];
  readonly corners: readonly RuleTriangle[];
}

/**
 * Bisect a triangle's sides and join the midpoints: three chords forming the
 * inverted central triangle, and the three corner triangles that recurse.
 * The chords run tip-to-tail so a staggered draw circulates the centre.
 */
function subdivide(triangle: RuleTriangle): RuleSubdivision {
  const [a, b, c] = triangle;
  const ab = midpoint(a, b);
  const bc = midpoint(b, c);
  const ca = midpoint(c, a);
  return {
    chords: [
      { from: ab, to: bc },
      { from: bc, to: ca },
      { from: ca, to: ab },
    ],
    corners: [
      [a, ab, ca],
      [ab, b, bc],
      [ca, bc, c],
    ],
  };
}

/** Apply the midpoint subdivision to every corner triangle of a generation. */
function subdivideGeneration(
  triangles: readonly RuleTriangle[],
): RuleSubdivision {
  const chords: RuleChord[] = [];
  const corners: RuleTriangle[] = [];
  for (const triangle of triangles) {
    const division = subdivide(triangle);
    chords.push(...division.chords);
    corners.push(...division.corners);
  }
  return { chords, corners };
}

const GENERATION_ONE = subdivide(RULE_TRIANGLE);
const GENERATION_TWO = subdivideGeneration(GENERATION_ONE.corners);
const GENERATION_THREE = subdivideGeneration(GENERATION_TWO.corners);

/** Chords per generation — exactly three generations of 3, 9, and 27. */
export const RULE_CHORD_GENERATIONS: readonly (readonly RuleChord[])[] = [
  GENERATION_ONE.chords,
  GENERATION_TWO.chords,
  GENERATION_THREE.chords,
];

/** The plate's centre of gravity, shared by every generation. */
export const RULE_CENTROID: RulePoint = centroid(RULE_TRIANGLE);

/** The twenty-seven smallest corner cells produced by generation three. */
export const RULE_SMALLEST_CELLS: readonly RuleTriangle[] =
  GENERATION_THREE.corners;

/** Choose the smallest cell whose centroid sits nearest the plate's centre. */
function selectAccentCell(
  cells: readonly RuleTriangle[],
  focus: RulePoint,
): RuleTriangle {
  let best: RuleTriangle | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    const at = centroid(cell);
    const distance = Math.hypot(at.x - focus.x, at.y - focus.y);
    if (distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  if (best === undefined) {
    throw new Error("The accent needs at least one cell to trace.");
  }
  return best;
}

/** The one smallest cell whose perimeter the accent pulse traces. */
export const RULE_ACCENT_CELL: RuleTriangle = selectAccentCell(
  RULE_SMALLEST_CELLS,
  RULE_CENTROID,
);

interface RuleSideFrame {
  readonly ends: readonly [RulePoint, RulePoint];
  readonly mid: RulePoint;
  /** Unit normal of the side, pointing away from the triangle's interior. */
  readonly normal: RulePoint;
  readonly length: number;
}

/** Measure each outer side: its ends, midpoint, outward normal, and length. */
function outerSideFrames(): readonly RuleSideFrame[] {
  const [a, b, c] = RULE_TRIANGLE;
  const sides: readonly (readonly [RulePoint, RulePoint])[] = [
    [a, b],
    [b, c],
    [c, a],
  ];
  return sides.map(([from, to]) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    return {
      ends: [from, to],
      mid: midpoint(from, to),
      normal: { x: (from.y - to.y) / length, y: (to.x - from.x) / length },
      length,
    };
  });
}

/** The point of a compass circle at a given angle. */
function pointOnCircle(
  centre: RulePoint,
  radius: number,
  angle: number,
): RulePoint {
  return {
    x: centre.x + radius * Math.cos(angle),
    y: centre.y + radius * Math.sin(angle),
  };
}

/** A short arc of the compass circle centred at `centre`, through `through`. */
function arcPath(
  centre: RulePoint,
  radius: number,
  through: RulePoint,
): string {
  const angle = Math.atan2(through.y - centre.y, through.x - centre.x);
  const start = pointOnCircle(centre, radius, angle - ARC_HALF_ANGLE);
  const end = pointOnCircle(centre, radius, angle + ARC_HALF_ANGLE);
  return `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(radius)} ${
    fmt(radius)
  } 0 0 1 ${fmt(end.x)} ${fmt(end.y)}`;
}

/**
 * The external Euclidean bisection ghosts: for each outer side, equal compass
 * arcs anchored at both endpoints cross outside the triangle. The matching
 * inward crossings are omitted so the central subdivided triangle stays clear.
 */
function buildBisectionArcs(): readonly RuleBisectionArc[] {
  const arcs: RuleBisectionArc[] = [];
  outerSideFrames().forEach((frame, side) => {
    const reach = Math.sqrt(
      BISECTION_RADIUS ** 2 - (frame.length / 2) ** 2,
    );
    const crossing = {
      x: frame.mid.x + frame.normal.x * reach,
      y: frame.mid.y + frame.normal.y * reach,
    };
    frame.ends.forEach((anchorPoint, anchor) => {
      arcs.push({
        side,
        anchor: anchor === 0 ? 0 : 1,
        d: arcPath(anchorPoint, BISECTION_RADIUS, crossing),
      });
    });
  });
  return arcs;
}

/** The six short compass arcs — one external crossing pair per outer side. */
export const RULE_BISECTION_ARCS: readonly RuleBisectionArc[] =
  buildBisectionArcs();

/** Tiny affirmation ticks crossing each outer side at its found midpoint. */
export const RULE_MIDPOINT_TICKS: readonly RuleChord[] = outerSideFrames().map(
  (frame) => ({
    from: {
      x: frame.mid.x - frame.normal.x * TICK_REACH,
      y: frame.mid.y - frame.normal.y * TICK_REACH,
    },
    to: {
      x: frame.mid.x + frame.normal.x * TICK_REACH,
      y: frame.mid.y + frame.normal.y * TICK_REACH,
    },
  }),
);

/** Generation-three chord trios in reading order: top-down, then left-right. */
function orderRipples(
  parents: readonly RuleTriangle[],
  chords: readonly RuleChord[],
): readonly (readonly RuleChord[])[] {
  const indexed = parents.map((parent, index) => ({
    at: centroid(parent),
    trio: chords.slice(index * 3, index * 3 + 3),
  }));
  return [...indexed]
    .sort((a, b) =>
      Math.abs(a.at.y - b.at.y) > 0.5 ? a.at.y - b.at.y : a.at.x - b.at.x
    )
    .map(({ trio }) => trio);
}

const GENERATION_THREE_RIPPLES: readonly (readonly RuleChord[])[] =
  orderRipples(GENERATION_TWO.corners, GENERATION_THREE.chords);

/**
 * Fig. V — the rule. One triangle subdivided by compass and straightedge
 * through three quiet generations. The authored SVG is the finished plate;
 * the stylesheet alone performs the re-derivation and returns it here.
 */
export function RuleArtwork(
  { id }: RuleArtworkProps,
): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <figure className="fig fig-rule">
      <svg
        className="fig__art fig-rule__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          One triangle subdivided through three generations
        </title>
        <desc id={descriptionId}>
          A large triangle stands over faint compass arcs and midpoint ticks.
          Chords join the midpoints of its sides, and of the smaller corner
          triangles within, dividing the figure through three generations. The
          construction quietly redraws itself in sequence, and a small pulse
          once traces the perimeter of one smallest triangle near the centre.
        </desc>
        <g aria-hidden="true">
          <g className="fig-rule__construction">
            {RULE_BISECTION_ARCS.map((arc, index) => (
              <path
                key={`arc-${index}`}
                className="fig-rule__arc"
                d={arc.d}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {RULE_MIDPOINT_TICKS.map((tick, index) => (
              <line
                key={`tick-${index}`}
                className={`fig-rule__tick fig-rule__tick--${index + 1}`}
                x1={fmt(tick.from.x)}
                y1={fmt(tick.from.y)}
                x2={fmt(tick.to.x)}
                y2={fmt(tick.to.y)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g className="fig-rule__arc-ink">
            {RULE_BISECTION_ARCS.map((arc, index) => (
              <path
                key={`arc-ink-${index}`}
                className={`fig-rule__arc-ink-path fig-rule__arc-ink--s${
                  arc.side + 1
                }${arc.anchor === 0 ? "a" : "b"}`}
                d={arc.d}
                pathLength={1}
              />
            ))}
          </g>
          <path
            className="fig-rule__frame"
            d={trianglePath(RULE_TRIANGLE)}
            vectorEffect="non-scaling-stroke"
          />
          <g className="fig-rule__g1">
            {GENERATION_ONE.chords.map((chord, index) => (
              <path
                key={`g1-${index}`}
                className="fig-rule__chord"
                d={chordPath(chord)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g className="fig-rule__g2">
            {GENERATION_TWO.chords.map((chord, index) => (
              <path
                key={`g2-${index}`}
                className="fig-rule__chord"
                d={chordPath(chord)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g className="fig-rule__g3">
            {GENERATION_THREE.chords.map((chord, index) => (
              <path
                key={`g3-${index}`}
                className="fig-rule__chord"
                d={chordPath(chord)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g className="fig-rule__g1-ink">
            {GENERATION_ONE.chords.map((chord, index) => (
              <path
                key={`g1-ink-${index}`}
                className={`fig-rule__ink-chord fig-rule__g1-ink--${index + 1}`}
                d={chordPath(chord)}
                pathLength={1}
              />
            ))}
          </g>
          <g className="fig-rule__g2-ink">
            {GENERATION_TWO.chords.map((chord, index) => (
              <path
                key={`g2-ink-${index}`}
                className={`fig-rule__ink-chord fig-rule__g2-ink--c${
                  Math.floor(index / 3) + 1
                }`}
                d={chordPath(chord)}
                pathLength={1}
              />
            ))}
          </g>
          <g className="fig-rule__g3-ink">
            {GENERATION_THREE_RIPPLES.map((trio, corner) =>
              trio.map((chord, index) => (
                <path
                  key={`g3-ink-${corner}-${index}`}
                  className={`fig-rule__ink-chord fig-rule__g3-ink--c${
                    corner + 1
                  }`}
                  d={chordPath(chord)}
                  pathLength={1}
                />
              ))
            )}
          </g>
          <g className="fig-rule__accent-gate">
            <path
              className="fig-rule__accent"
              d={trianglePath(RULE_ACCENT_CELL)}
              pathLength={1}
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
