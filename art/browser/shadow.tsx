/** Reusable shadow artwork: one solid from three vantages, one footprint. */

import type { ReactElement } from "react";

export interface ShadowArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One vantage on the solid, registered against the shared footprint. */
export interface ShadowView {
  /** The animation this view's edges and apex are driven by. */
  readonly key: "a" | "b" | "c";
  readonly apex: readonly [number, number];
  readonly edges: readonly string[];
  /** The plumb from the apex to the foot of the centre axis. */
  readonly plumb: string;
}

/** The single proportion authority for the whole plate. */
export const SHADOW_GEOMETRY = Object.freeze({
  /**
   * The one footprint every view is registered against. Each vantage may move
   * the apex; none may move this.
   */
  footprint: Object.freeze(
    [
      Object.freeze([380, 240] as const),
      Object.freeze([190, 470] as const),
      Object.freeze([570, 470] as const),
    ] as const,
  ),
  /** Where the plumb lands: the foot of the centre axis, on the base. */
  foot: Object.freeze([380, 470] as const),
  /** The three vantages, as the screen position each puts the apex at. */
  apexes: Object.freeze({
    a: Object.freeze([380, 112] as const),
    b: Object.freeze([548, 168] as const),
    c: Object.freeze([250, 206] as const),
  }),
  /** Interval between an apex edge drawing and the next, in seconds. */
  edgeStep: 0.32,
  /** The ground rules the footprint sits on. */
  ground: Object.freeze({ near: 470, far: 502 }),
});

const { footprint, foot, apexes } = SHADOW_GEOMETRY;

/** Format one point for an SVG path command. */
function f2(p: readonly [number, number]): string {
  return `${p[0]} ${p[1]}`;
}

/** The three vantages. Only the apex differs; the footprint is shared. */
export const SHADOW_VIEWS: readonly ShadowView[] = Object.freeze(
  (["a", "b", "c"] as const).map((key) =>
    Object.freeze({
      key,
      apex: apexes[key],
      edges: Object.freeze(
        footprint.map((v) => `M${f2(apexes[key])}L${f2(v)}`),
      ),
      plumb: `M${f2(apexes[key])}L${f2(foot)}`,
    })
  ),
);

const FOOTPRINT_POINTS = footprint.map((p) => p.join(",")).join(" ");
const FOOTPRINT_HALF_POINTS = [footprint[0], footprint[2], foot]
  .map((p) => p.join(",")).join(" ");

/**
 * Fig. XVI — the shadow. The same solid drawn from three vantages. Every
 * wireframe differs and every plumb falls somewhere new, but the footprint
 * each one casts is the identical split triangle. The footprint is fixed by
 * construction rather than projected, which is what makes the three views
 * comparable at all.
 */
export function ShadowArtwork({ id }: ShadowArtworkProps): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const { edgeStep, ground } = SHADOW_GEOMETRY;

  return (
    <figure className="fig fig-shadow">
      <svg
        className="fig__art fig-shadow__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          One solid drawn from three vantages over one unchanging footprint
        </title>
        <desc id={descriptionId}>
          A split triangle rests on a ground line as the footprint of a solid.
          Three wireframes are drawn over it in turn, each placing the solid's
          apex somewhere different and each dropping a plumb line to the foot of
          the footprint's centre axis. The wireframes replace one another and
          the plumbs move, but the footprint never changes, and it takes accent
          ink once before the first view returns.
        </desc>
        <g aria-hidden="true">
          <g className="fig-shadow__ground">
            <line
              x1={80}
              y1={ground.near}
              x2={680}
              y2={ground.near}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="fig-shadow__ground-far"
              x1={150}
              y1={ground.far}
              x2={610}
              y2={ground.far}
              vectorEffect="non-scaling-stroke"
            />
          </g>

          <polygon
            className="fig-shadow__footprint-half"
            points={FOOTPRINT_HALF_POINTS}
          />
          <g className="fig-shadow__footprint">
            <polygon
              points={FOOTPRINT_POINTS}
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={foot[0]}
              y1={footprint[0][1]}
              x2={foot[0]}
              y2={foot[1]}
              vectorEffect="non-scaling-stroke"
            />
          </g>

          {SHADOW_VIEWS.map((view) => (
            <g
              key={view.key}
              className="fig-shadow__view"
              data-shadow-view={view.key}
            >
              <g className="fig-shadow__edges">
                {view.edges.map((d, index) => (
                  <path
                    key={index}
                    d={d}
                    pathLength={1}
                    vectorEffect="non-scaling-stroke"
                    style={{
                      animationDelay: `${
                        Math.round(index * edgeStep * 100) / 100
                      }s`,
                    }}
                  />
                ))}
              </g>
              <path
                className="fig-shadow__plumb"
                d={view.plumb}
                pathLength={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                className="fig-shadow__apex"
                cx={view.apex[0]}
                cy={view.apex[1]}
                r={2.8}
              />
            </g>
          ))}

          <g className="fig-shadow__feet">
            {footprint.map((p, index) => (
              <circle key={index} cx={p[0]} cy={p[1]} r={2.4} />
            ))}
          </g>

          <g className="fig-shadow__mark">
            <polygon
              className="fig-shadow__mark-half"
              points={FOOTPRINT_HALF_POINTS}
            />
            <polygon
              className="fig-shadow__mark-edge"
              points={FOOTPRINT_POINTS}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="fig-shadow__mark-median"
              x1={foot[0]}
              y1={footprint[0][1]}
              x2={foot[0]}
              y2={foot[1]}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
