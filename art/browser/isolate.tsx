/** Reusable isolate artwork: three sealed chambers, then one composed trunk. */

import type { ReactElement } from "react";

export interface IsolateArtworkProps {
  /** Stable prefix for the SVG clip-path identifiers. */
  readonly id: string;
}

/** One hairline of a chamber's hatching. */
export interface IsolateLine {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** One chamber: its boundary, its working angle, and its hatching. */
export interface IsolateChamber {
  readonly polygon: string;
  readonly angle: number;
  readonly lines: readonly IsolateLine[];
  /** When this chamber begins re-working, in seconds. */
  readonly offset: number;
}

/** The single proportion authority for the whole plate. */
export const ISOLATE_GEOMETRY = Object.freeze({
  apex: Object.freeze([450, 70] as const),
  baseLeft: Object.freeze([150, 450] as const),
  baseRight: Object.freeze([750, 450] as const),
  /** Perpendicular spacing of a chamber's hatching, and of the trunk's. */
  spacing: Object.freeze({ chamber: 15, trunk: 17 }),
  /** Each chamber's own working angle, and when it begins. */
  chambers: Object.freeze([
    Object.freeze({ angle: 60, offset: 3.8 }),
    Object.freeze({ angle: 0, offset: 6.6 }),
    Object.freeze({ angle: 120, offset: 9.4 }),
  ]),
  /** How long one chamber takes to re-work, in seconds. */
  span: 2.1,
  /** Overshoot of each hairline past the chamber's support. */
  overshoot: 8,
});

const { apex, baseLeft, baseRight, spacing, chambers, overshoot } =
  ISOLATE_GEOMETRY;

type Point = readonly [number, number];

const midpoint = (
  a: Point,
  b: Point,
): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

const MID_AB = midpoint(apex, baseLeft);
const MID_BC = midpoint(baseLeft, baseRight);
const MID_CA = midpoint(baseRight, apex);

/** The three corner chambers and the trunk they compose into. */
const REGIONS: readonly (readonly Point[])[] = Object.freeze([
  [apex, MID_AB, MID_CA],
  [MID_AB, baseLeft, MID_BC],
  [MID_CA, MID_BC, baseRight],
]);
const TRUNK: readonly Point[] = Object.freeze([MID_AB, MID_BC, MID_CA]);

/** Parallel hairlines at one angle, spanning a region's support. */
function hatch(
  region: readonly Point[],
  angleDegrees: number,
  step: number,
): IsolateLine[] {
  const radians = (angleDegrees * Math.PI) / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  const normal = { x: -direction.y, y: direction.x };
  const cx = region.reduce((s, p) => s + p[0], 0) / region.length;
  const cy = region.reduce((s, p) => s + p[1], 0) / region.length;
  const support = region.map((p) =>
    (p[0] - cx) * normal.x + (p[1] - cy) * normal.y
  );
  const along = region.map((p) =>
    (p[0] - cx) * direction.x + (p[1] - cy) * direction.y
  );
  const half = Math.max(...along.map(Math.abs)) + overshoot;
  const out: IsolateLine[] = [];
  const from = Math.ceil(Math.min(...support) / step);
  const to = Math.floor(Math.max(...support) / step);
  for (let k = from; k <= to; k += 1) {
    const px = cx + normal.x * k * step;
    const py = cy + normal.y * k * step;
    out.push(Object.freeze({
      x1: Math.round((px - direction.x * half) * 10) / 10,
      y1: Math.round((py - direction.y * half) * 10) / 10,
      x2: Math.round((px + direction.x * half) * 10) / 10,
      y2: Math.round((py + direction.y * half) * 10) / 10,
    }));
  }
  return out;
}

/** Format one bounded region for an SVG polygon. */
function polygon(region: readonly Point[]): string {
  return region.map(([x, y]) =>
    `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
  ).join(" ");
}

/** The three chambers, each working strictly inside its own walls. */
export const ISOLATE_CHAMBERS: readonly IsolateChamber[] = Object.freeze(
  chambers.map((spec, i) => {
    const region = REGIONS[i];
    if (region === undefined) {
      throw new Error("isolate: chamber has no bounded region");
    }
    return Object.freeze({
      polygon: polygon(region),
      angle: spec.angle,
      lines: Object.freeze(hatch(region, spec.angle, spacing.chamber)),
      offset: spec.offset,
    });
  }),
);

/** The trunk carries all three angles at once: the composed result. */
export const ISOLATE_TRUNK = Object.freeze({
  polygon: polygon(TRUNK),
  lines: Object.freeze(
    chambers.flatMap((spec) => hatch(TRUNK, spec.angle, spacing.trunk)),
  ),
});

const FRAME_POINTS = polygon([apex, baseRight, baseLeft]);
const FRAME_HALF_POINTS = polygon([apex, baseRight, [apex[0], baseRight[1]]]);

/**
 * Fig. XIII — the isolate. One triangle divides into three sealed chambers,
 * each working at its own angle and never crossing into another. When the
 * walls give way, the trunk is found to carry all three angles at once. The
 * clip stays on a static wrapper per chamber: named on a moving layer it
 * would travel with it.
 */
export function IsolateArtwork({ id }: IsolateArtworkProps): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const clipId = (key: string) => `${id}-${key}`;

  return (
    <figure className="fig fig-isolate">
      <svg
        className="fig__art fig-isolate__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          Three sealed chambers working separately, then composing
        </title>
        <desc id={descriptionId}>
          One large upward triangle is divided by its midlines into three corner
          chambers and a central inverted trunk. Each chamber is filled with
          fine parallel hairlines at its own angle, and no hairline ever crosses
          into a neighbouring chamber. The chambers re-work one after another,
          the walls brighten and then give way, and the trunk fills with all
          three angles at once before the frame takes accent ink across its
          right half.
        </desc>
        <g aria-hidden="true" transform="translate(20 62) scale(0.8)">
          <defs>
            {ISOLATE_CHAMBERS.map((chamber, index) => (
              <clipPath
                key={index}
                id={clipId(String(index))}
                clipPathUnits="userSpaceOnUse"
              >
                <polygon points={chamber.polygon} />
              </clipPath>
            ))}
            <clipPath id={clipId("trunk")} clipPathUnits="userSpaceOnUse">
              <polygon points={ISOLATE_TRUNK.polygon} />
            </clipPath>
          </defs>

          <g className="fig-isolate__rest">
            {ISOLATE_CHAMBERS.map((chamber, index) => (
              <g
                key={index}
                clipPath={`url(#${clipId(String(index))})`}
                data-isolate-angle={chamber.angle}
              >
                {chamber.lines.map((line, k) => (
                  <line
                    key={k}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </g>
            ))}
            <g clipPath={`url(#${clipId("trunk")})`}>
              {ISOLATE_TRUNK.lines.map((line, k) => (
                <line
                  key={k}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          </g>

          {ISOLATE_CHAMBERS.map((chamber, index) => (
            <g
              key={index}
              className="fig-isolate__work"
              clipPath={`url(#${clipId(String(index))})`}
              data-isolate-angle={chamber.angle}
            >
              {chamber.lines.map((line, k) => (
                <line
                  key={k}
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                  pathLength={1}
                  vectorEffect="non-scaling-stroke"
                  style={{
                    animationDelay: `${
                      Math.round(
                        (chamber.offset +
                          (k / Math.max(1, chamber.lines.length - 1)) *
                            ISOLATE_GEOMETRY.span) * 1000,
                      ) / 1000
                    }s`,
                  }}
                />
              ))}
            </g>
          ))}

          <g
            className="fig-isolate__weave"
            clipPath={`url(#${clipId("trunk")})`}
          >
            {ISOLATE_TRUNK.lines.map((line, k) => (
              <line
                key={k}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                pathLength={1}
                vectorEffect="non-scaling-stroke"
                style={{
                  animationDelay: `${
                    Math.round((k % 9) * 0.18 * 1000) / 1000
                  }s`,
                }}
              />
            ))}
          </g>

          <polygon
            className="fig-isolate__walls"
            points={ISOLATE_TRUNK.polygon}
            vectorEffect="non-scaling-stroke"
          />
          <polygon
            className="fig-isolate__frame"
            points={FRAME_POINTS}
            vectorEffect="non-scaling-stroke"
          />
          <line
            className="fig-isolate__split"
            x1={apex[0]}
            y1={apex[1]}
            x2={apex[0]}
            y2={baseRight[1]}
            vectorEffect="non-scaling-stroke"
          />

          <g className="fig-isolate__seal">
            <polygon
              className="fig-isolate__seal-half"
              points={FRAME_HALF_POINTS}
            />
            <polygon
              className="fig-isolate__seal-edge"
              points={FRAME_POINTS}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="fig-isolate__seal-median"
              x1={apex[0]}
              y1={apex[1]}
              x2={apex[0]}
              y2={baseRight[1]}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
