/** Reusable seal artwork: hairline fragments registering into a sealed triangle. */

import type { CSSProperties, ReactElement } from "react";

export interface SealArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One coordinate on the plate. */
export interface SealPoint {
  readonly x: number;
  readonly y: number;
}

/** One straight hairline run between two plate coordinates. */
export interface SealSegment {
  readonly from: SealPoint;
  readonly to: SealPoint;
}

/** The displacement one fragment takes while the seal is released. */
export interface SealScatter {
  readonly dx: number;
  readonly dy: number;
  readonly rotation: number;
}

/** The staging family a fragment loosens and returns with. */
export type SealScatterGroup = "traitor" | "early" | "middle" | "late";

/** One authored outline fragment with its scattered pose. */
export interface SealFragment extends SealSegment {
  readonly id: string;
  readonly group: SealScatterGroup;
  readonly scatter: SealScatter;
}

/** The registered triangle every fragment answers to. */
export const SEAL_TRIANGLE = Object.freeze({
  apex: Object.freeze({ x: 380, y: 120 }),
  baseLeft: Object.freeze({ x: 200, y: 432 }),
  baseMid: Object.freeze({ x: 380, y: 432 }),
  baseRight: Object.freeze({ x: 560, y: 432 }),
});

/** The scatter envelope: every displacement and rotation stays inside it. */
export const SEAL_SCATTER_LIMITS = Object.freeze({
  translation: 30,
  rotation: 8,
});

/** Round a derived coordinate to one decimal so authored joins stay exact. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The plate coordinate a fraction of the way along one edge. */
function pointAlong(from: SealPoint, to: SealPoint, t: number): SealPoint {
  return Object.freeze({
    x: round1(from.x + (to.x - from.x) * t),
    y: round1(from.y + (to.y - from.y) * t),
  });
}

interface SealFragmentSeed {
  readonly group: SealScatterGroup;
  readonly scatter: SealScatter;
}

interface SealEdgeDefinition {
  readonly edge: string;
  readonly from: SealPoint;
  readonly to: SealPoint;
  readonly stops: readonly number[];
  readonly seeds: readonly SealFragmentSeed[];
}

/**
 * The authored outline walk: apex down the left edge, across the base
 * through its midpoint, and up the right edge home. Stops break each edge
 * irregularly so the tiling feels found; scatters lean outward so the
 * loosened cloud still remembers the triangle.
 */
const SEAL_EDGES: readonly SealEdgeDefinition[] = [
  {
    edge: "left",
    from: SEAL_TRIANGLE.apex,
    to: SEAL_TRIANGLE.baseLeft,
    stops: [0, 0.13, 0.34, 0.52, 0.78, 1],
    seeds: [
      { group: "middle", scatter: { dx: -14, dy: -9, rotation: -5 } },
      { group: "middle", scatter: { dx: -24, dy: 6, rotation: 4 } },
      { group: "late", scatter: { dx: -11, dy: 14, rotation: -3 } },
      { group: "late", scatter: { dx: -26, dy: -4, rotation: 6 } },
      { group: "late", scatter: { dx: -13, dy: 18, rotation: -2 } },
    ],
  },
  {
    edge: "base",
    from: SEAL_TRIANGLE.baseLeft,
    to: SEAL_TRIANGLE.baseRight,
    stops: [0, 0.28, 0.5, 0.71, 1],
    seeds: [
      { group: "late", scatter: { dx: -8, dy: 22, rotation: 3 } },
      { group: "middle", scatter: { dx: 6, dy: 26, rotation: -4 } },
      { group: "middle", scatter: { dx: -4, dy: 19, rotation: 2 } },
      { group: "early", scatter: { dx: 16, dy: 24, rotation: 5 } },
    ],
  },
  {
    edge: "right",
    from: SEAL_TRIANGLE.baseRight,
    to: SEAL_TRIANGLE.apex,
    stops: [0, 0.19, 0.42, 0.6, 0.83, 1],
    seeds: [
      { group: "middle", scatter: { dx: 22, dy: 10, rotation: -6 } },
      { group: "early", scatter: { dx: 27, dy: -3, rotation: 3 } },
      { group: "traitor", scatter: { dx: 24, dy: -16, rotation: 7 } },
      { group: "early", scatter: { dx: 12, dy: -22, rotation: -4 } },
      { group: "early", scatter: { dx: 18, dy: -12, rotation: 5 } },
    ],
  },
];

/** Expand one edge's stops into contiguous, individually addressable fragments. */
function edgeFragments(
  definition: SealEdgeDefinition,
): readonly SealFragment[] {
  const { edge, from, to, stops, seeds } = definition;
  if (stops.length !== seeds.length + 1) {
    throw new Error("An edge needs exactly one more stop than seeds.");
  }
  if (stops[0] !== 0 || stops[stops.length - 1] !== 1) {
    throw new Error("An edge's stops must span the whole edge.");
  }
  return seeds.map((seed, index) => {
    const begin = stops[index];
    const finish = stops[index + 1];
    if (begin === undefined || finish === undefined || finish <= begin) {
      throw new Error("An edge's stops must strictly increase.");
    }
    if (
      Math.hypot(seed.scatter.dx, seed.scatter.dy) >
        SEAL_SCATTER_LIMITS.translation ||
      Math.abs(seed.scatter.rotation) > SEAL_SCATTER_LIMITS.rotation
    ) {
      throw new Error("A fragment's scatter must stay inside the envelope.");
    }
    return Object.freeze({
      id: `${edge}-${index + 1}`,
      from: pointAlong(from, to, begin),
      to: pointAlong(from, to, finish),
      group: seed.group,
      scatter: seed.scatter,
    });
  });
}

/** Every outline fragment, ordered as one continuous walk around the triangle. */
export const SEAL_FRAGMENTS: readonly SealFragment[] = Object.freeze(
  SEAL_EDGES.flatMap((definition) => edgeFragments(definition)),
);

const TICK_CLEARANCE = 6;
const TICK_LENGTH = 12;

/** A short registration tick continuing one edge just past its vertex. */
function cornerTick(vertex: SealPoint, opposite: SealPoint): SealSegment {
  const run = Math.hypot(vertex.x - opposite.x, vertex.y - opposite.y);
  if (run === 0) {
    throw new Error("A corner tick needs two distinct vertices.");
  }
  const ux = (vertex.x - opposite.x) / run;
  const uy = (vertex.y - opposite.y) / run;
  const at = (distance: number): SealPoint =>
    Object.freeze({
      x: round1(vertex.x + ux * distance),
      y: round1(vertex.y + uy * distance),
    });
  return Object.freeze({
    from: at(TICK_CLEARANCE),
    to: at(TICK_CLEARANCE + TICK_LENGTH),
  });
}

/** Six vertex ticks: the true registration the fragments answer to. */
export const SEAL_CORNER_TICKS: readonly SealSegment[] = Object.freeze([
  cornerTick(SEAL_TRIANGLE.apex, SEAL_TRIANGLE.baseLeft),
  cornerTick(SEAL_TRIANGLE.apex, SEAL_TRIANGLE.baseRight),
  cornerTick(SEAL_TRIANGLE.baseLeft, SEAL_TRIANGLE.apex),
  cornerTick(SEAL_TRIANGLE.baseLeft, SEAL_TRIANGLE.baseRight),
  cornerTick(SEAL_TRIANGLE.baseRight, SEAL_TRIANGLE.apex),
  cornerTick(SEAL_TRIANGLE.baseRight, SEAL_TRIANGLE.baseLeft),
]);

interface SealFragmentStyle extends CSSProperties {
  readonly "--fig-seal-scatter": string;
}

/** The custom property carrying this fragment's scattered pose to the CSS. */
function scatterStyle(scatter: SealScatter): SealFragmentStyle {
  return {
    "--fig-seal-scatter":
      `translate(${scatter.dx}px, ${scatter.dy}px) rotate(${scatter.rotation}deg)`,
  };
}

/**
 * Fig. II — the seal, at its sealed instant. Fourteen hairline fragments
 * hold one registered triangle whose right half carries ink. The
 * stylesheet alone supplies the release, scatter, re-registration, and
 * confirming accent sweep that surround this authored state.
 */
export function SealArtwork(
  { id }: SealArtworkProps,
): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const floodClipId = `${id}-flood`;
  const frameClipId = `${id}-frame`;
  const { apex, baseLeft, baseMid, baseRight } = SEAL_TRIANGLE;

  return (
    <figure className="fig fig-seal">
      <svg
        className="fig__art fig-seal__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>Fragments registering into a sealed triangle</title>
        <desc id={descriptionId}>
          Hairline fragments hold the outline of one centred, apex-up triangle
          whose right half carries solid ink. One fragment drifts, the ink
          releases, the fragments loosen and re-register, and a passing tinted
          line restores the sealed form. The complete sealed form remains
          visible without motion.
        </desc>
        <g aria-hidden="true">
          <defs>
            <clipPath id={floodClipId}>
              <polygon
                points={`${apex.x},${apex.y} ${baseMid.x},${baseMid.y} ${baseRight.x},${baseRight.y}`}
              />
            </clipPath>
            <clipPath id={frameClipId}>
              <polygon
                points={`${apex.x},${apex.y} ${baseLeft.x},${baseLeft.y} ${baseRight.x},${baseRight.y}`}
              />
            </clipPath>
          </defs>

          <g className="fig-seal__construction">
            <line
              x1={apex.x}
              y1={96}
              x2={apex.x}
              y2={466}
              vectorEffect="non-scaling-stroke"
            />
            {SEAL_CORNER_TICKS.map((tick, index) => (
              <line
                key={`tick-${index}`}
                x1={tick.from.x}
                y1={tick.from.y}
                x2={tick.to.x}
                y2={tick.to.y}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          {
            /* The clip stays on a static wrapper: a clip named on the moving
              rect itself would travel with its transform. */
          }
          <g clipPath={`url(#${floodClipId})`}>
            <rect
              className="fig-seal__ink"
              x={372}
              y={112}
              width={200}
              height={332}
            />
          </g>

          {SEAL_FRAGMENTS.map((fragment) => (
            <line
              key={fragment.id}
              className={`fig-seal__fragment fig-seal__fragment--${fragment.group}`}
              data-seal-fragment={fragment.id}
              data-seal-group={fragment.group}
              style={scatterStyle(fragment.scatter)}
              x1={fragment.from.x}
              y1={fragment.from.y}
              x2={fragment.to.x}
              y2={fragment.to.y}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <g className="fig-seal__sweep" clipPath={`url(#${frameClipId})`}>
            <line
              className="fig-seal__sweep-line"
              x1={190}
              y1={apex.y}
              x2={570}
              y2={apex.y}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
