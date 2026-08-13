/** Reusable mesh artwork: scattered sites resolve to one triangulation. */

import type { ReactElement } from "react";

export interface MeshArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One planar point in the figure's 760 by 540 viewBox space. */
export interface MeshPoint {
  readonly x: number;
  readonly y: number;
}

/** One undirected edge of the triangulation, with the length that orders it. */
export interface MeshEdge {
  readonly from: MeshPoint;
  readonly to: MeshPoint;
  readonly length: number;
}

/** One empty-circle test, resolved to its circumcircle. */
export interface MeshProbe {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** The split triangle the plate resolves onto, and its median. */
export interface MeshMark {
  readonly apex: MeshPoint;
  readonly baseLeft: MeshPoint;
  readonly baseRight: MeshPoint;
  /** Midpoint of the base: the median divides the figure in exact halves. */
  readonly foot: MeshPoint;
}

/** The single proportion authority for the whole plate. */
export const MESH_GEOMETRY = Object.freeze({
  /** Where the plate looks for the cell that carries the mark. */
  centre: Object.freeze({ x: 380, y: 262 }),
  /** A cell must exceed this area to be eligible to carry the mark. */
  minimumMarkArea: 7000,
  /** A mark cell's apex must clear each base vertex by this much in x. */
  markApexClearance: 12,
  /** Half-length of one arm of a site's registration cross. */
  siteTick: 9,
  /** How many empty-circle tests the phrase performs. */
  probeCount: 3,
  /** Edge re-inking runs from this offset, across this span, shortest first. */
  inking: Object.freeze({ start: 4.8, span: 6.6 }),
  /** The probes strike at this offset, this far apart. */
  probing: Object.freeze({ start: 2.2, step: 1.32 }),
  /** Sites settle in reading order at this interval. */
  settleStep: 0.11,
});

/** The scattered sites. Every other feature of the plate derives from these. */
export const MESH_SITES: readonly MeshPoint[] = Object.freeze(
  ([
    [108, 118],
    [262, 84],
    [416, 126],
    [566, 92],
    [668, 196],
    [92, 268],
    [238, 232],
    [392, 288],
    [534, 240],
    [664, 352],
    [128, 412],
    [276, 462],
    [430, 424],
    [572, 470],
  ] as const).map(([x, y]) => Object.freeze({ x, y })),
);

interface MeshTriangle {
  readonly v: readonly [MeshPoint, MeshPoint, MeshPoint];
  readonly circle: MeshProbe;
  readonly area: number;
}

/** The circumcircle of three points, or null when they are collinear. */
function circumcircle(
  a: MeshPoint,
  b: MeshPoint,
  c: MeshPoint,
): MeshProbe | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return Object.freeze({ x, y, r: Math.hypot(a.x - x, a.y - y) });
}

/**
 * Every triple whose circumcircle holds no other site: the empty-circle
 * property, which is what makes the triangulation the only one there is.
 */
const MESH_TRIANGLES: readonly MeshTriangle[] = Object.freeze((() => {
  const sites = MESH_SITES;
  const out: MeshTriangle[] = [];
  for (let i = 0; i < sites.length; i += 1) {
    for (let j = i + 1; j < sites.length; j += 1) {
      for (let k = j + 1; k < sites.length; k += 1) {
        const a = sites[i];
        const b = sites[j];
        const c = sites[k];
        if (a === undefined || b === undefined || c === undefined) {
          throw new Error("mesh: site iteration left the source set");
        }
        const circle = circumcircle(a, b, c);
        if (!circle) continue;
        let empty = true;
        for (let m = 0; m < sites.length && empty; m += 1) {
          if (m === i || m === j || m === k) continue;
          const candidate = sites[m];
          if (candidate === undefined) {
            throw new Error("mesh: candidate iteration left the source set");
          }
          if (
            Math.hypot(candidate.x - circle.x, candidate.y - circle.y) <
              circle.r - 1e-6
          ) {
            empty = false;
          }
        }
        if (!empty) continue;
        const area = Math.abs(
          (b.x - a.x) * (c.y - a.y) -
            (c.x - a.x) * (b.y - a.y),
        ) / 2;
        out.push(Object.freeze({ v: [a, b, c] as const, circle, area }));
      }
    }
  }
  return out;
})());

/** Every unique edge, ordered shortest first: the order the plate re-inks. */
export const MESH_EDGES: readonly MeshEdge[] = Object.freeze((() => {
  const seen = new Set<string>();
  const out: MeshEdge[] = [];
  for (const t of MESH_TRIANGLES) {
    const pairs: ReadonlyArray<readonly [MeshPoint, MeshPoint]> = [
      [t.v[0], t.v[1]],
      [t.v[1], t.v[2]],
      [t.v[2], t.v[0]],
    ];
    for (const [from, to] of pairs) {
      const key = [from, to].map((p) => `${p.x},${p.y}`).sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(Object.freeze({
        from,
        to,
        length: Math.hypot(to.x - from.x, to.y - from.y),
      }));
    }
  }
  return out.sort((a, b) => a.length - b.length);
})());

/** The tightest circumcircles: contained tests, not sprawling construction. */
export const MESH_PROBES: readonly MeshProbe[] = Object.freeze(
  MESH_TRIANGLES.slice()
    .sort((a, b) => a.circle.r - b.circle.r)
    .slice(0, MESH_GEOMETRY.probeCount)
    .map((t) => t.circle),
);

/** The one central, apex-up, substantial cell that carries the mark. */
export const MESH_MARK: MeshMark = Object.freeze((() => {
  const { centre, minimumMarkArea, markApexClearance } = MESH_GEOMETRY;
  let best: MeshMark | null = null;
  let nearest = Infinity;
  for (const t of MESH_TRIANGLES) {
    if (t.area < minimumMarkArea) continue;
    const byY: [MeshPoint, MeshPoint, MeshPoint] = [...t.v];
    byY.sort((a, b) => a.y - b.y);
    const [apex, firstBase, secondBase] = byY;
    const bases: [MeshPoint, MeshPoint] = [firstBase, secondBase];
    bases.sort((a, b) => a.x - b.x);
    const [baseLeft, baseRight] = bases;
    if (apex.x <= baseLeft.x + markApexClearance) continue;
    if (apex.x >= baseRight.x - markApexClearance) continue;
    const gx = (t.v[0].x + t.v[1].x + t.v[2].x) / 3;
    const gy = (t.v[0].y + t.v[1].y + t.v[2].y) / 3;
    const distance = Math.hypot(gx - centre.x, gy - centre.y);
    if (distance >= nearest) continue;
    nearest = distance;
    best = Object.freeze({
      apex,
      baseLeft,
      baseRight,
      foot: Object.freeze({
        x: (baseLeft.x + baseRight.x) / 2,
        y: (baseLeft.y + baseRight.y) / 2,
      }),
    });
  }
  if (!best) throw new Error("mesh: no cell satisfies the mark criteria");
  return best;
})());

/** The convex hull, by monotone chain: the boundary the phrase emphasises. */
export const MESH_HULL: readonly MeshPoint[] = Object.freeze((() => {
  const sorted = MESH_SITES.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: MeshPoint, a: MeshPoint, b: MeshPoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: MeshPoint[] = [];
  for (const p of sorted) {
    while (lower.length > 1) {
      const before = lower.at(-2);
      const last = lower.at(-1);
      if (before === undefined || last === undefined) break;
      if (cross(before, last, p) > 0) break;
      lower.pop();
    }
    lower.push(p);
  }
  const upper: MeshPoint[] = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const p = sorted[i];
    if (p === undefined) {
      throw new Error("mesh: hull iteration left the source set");
    }
    while (upper.length > 1) {
      const before = upper.at(-2);
      const last = upper.at(-1);
      if (before === undefined || last === undefined) break;
      if (cross(before, last, p) > 0) break;
      upper.pop();
    }
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
})());

/** Format one point pair for a polygon's points attribute. */
function pair(p: MeshPoint): string {
  return `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`;
}

const MESH_HULL_POINTS = MESH_HULL.map(pair).join(" ");
const MESH_MARK_POINTS = [
  MESH_MARK.apex,
  MESH_MARK.baseRight,
  MESH_MARK.baseLeft,
]
  .map(pair).join(" ");
const MESH_MARK_HALF_POINTS = [
  MESH_MARK.apex,
  MESH_MARK.baseRight,
  MESH_MARK.foot,
]
  .map(pair).join(" ");

/** Seconds, to three places, as a CSS time. */
function seconds(value: number): string {
  return `${Math.round(value * 1000) / 1000}s`;
}

/**
 * Fig. VIII — the mesh. Fourteen scattered sites admit exactly one
 * triangulation. Empty-circle tests re-derive it, the edges re-ink shortest
 * first, and the plate's one central apex-up cell takes the mark before the
 * figure settles. The authored SVG is the complete resolved plate; the
 * stylesheet supplies only the re-derivation.
 */
export function MeshArtwork({ id }: MeshArtworkProps): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const { inking, probing, settleStep, siteTick } = MESH_GEOMETRY;
  const lastEdge = Math.max(1, MESH_EDGES.length - 1);

  return (
    <figure className="fig fig-mesh">
      <svg
        className="fig__art fig-mesh__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          Scattered points resolving into one triangulation
        </title>
        <desc id={descriptionId}>
          Fourteen points, each marked with a small registration cross, are
          joined into a single triangulation. Circumcircle tests sweep to
          confirm it, the edges re-ink from shortest to longest, the boundary is
          emphasised, and one central upward triangle takes accent ink across
          its right half before the figure settles.
        </desc>
        <g aria-hidden="true">
          <g className="fig-mesh__construction">
            {MESH_SITES.map((site, index) => (
              <path
                key={index}
                d={`M${site.x - siteTick} ${site.y}h${siteTick * 2}M${site.x} ${
                  site.y - siteTick
                }v${siteTick * 2}`}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <g className="fig-mesh__probes">
            {MESH_PROBES.map((probe, index) => (
              <circle
                key={index}
                className="fig-mesh__probe"
                cx={Math.round(probe.x * 100) / 100}
                cy={Math.round(probe.y * 100) / 100}
                r={Math.round(probe.r * 100) / 100}
                pathLength={1}
                style={{
                  animationDelay: seconds(probing.start + index * probing.step),
                }}
              />
            ))}
          </g>

          {/* The resting mesh, which recedes while the ink layer re-derives it. */}
          <g className="fig-mesh__rest">
            {MESH_EDGES.map((edge, index) => (
              <line
                key={index}
                x1={edge.from.x}
                y1={edge.from.y}
                x2={edge.to.x}
                y2={edge.to.y}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <g className="fig-mesh__inking">
            {MESH_EDGES.map((edge, index) => (
              <line
                key={index}
                className="fig-mesh__ink"
                x1={edge.from.x}
                y1={edge.from.y}
                x2={edge.to.x}
                y2={edge.to.y}
                pathLength={1}
                style={{
                  animationDelay: seconds(
                    inking.start + (index / lastEdge) * inking.span,
                  ),
                }}
              />
            ))}
          </g>

          <polygon
            className="fig-mesh__hull"
            points={MESH_HULL_POINTS}
            pathLength={1}
          />

          <g className="fig-mesh__mark">
            <polygon
              className="fig-mesh__mark-half"
              points={MESH_MARK_HALF_POINTS}
            />
            <line
              className="fig-mesh__mark-median"
              x1={MESH_MARK.apex.x}
              y1={MESH_MARK.apex.y}
              x2={Math.round(MESH_MARK.foot.x * 100) / 100}
              y2={Math.round(MESH_MARK.foot.y * 100) / 100}
              vectorEffect="non-scaling-stroke"
            />
          </g>
          <polygon
            className="fig-mesh__mark-edge"
            points={MESH_MARK_POINTS}
            pathLength={1}
          />

          <g className="fig-mesh__sites">
            {MESH_SITES.map((site, index) => (
              <circle
                key={index}
                className="fig-mesh__site"
                cx={site.x}
                cy={site.y}
                r={2.6}
                style={{ animationDelay: seconds(index * settleStep) }}
              />
            ))}
          </g>
        </g>
      </svg>
    </figure>
  );
}
