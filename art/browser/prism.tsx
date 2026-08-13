/** Reusable prism artwork: one beam enters a triangular body and leaves it
 *  decomposed. Entry and exit are solved by Snell's law, not drawn. */

import type { ReactElement } from "react";

export interface PrismArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

interface Vector {
  readonly x: number;
  readonly y: number;
}

/** One dispersed component, from its exit point to the plate boundary. */
export interface PrismRay {
  readonly d: string;
  /** Refractive index this component was solved for. */
  readonly index: number;
  /** The component's own colour: a spectrum is multi-hued by definition. */
  readonly stroke: string;
  readonly offset: number;
}

/** The single proportion authority for the whole plate. */
export const PRISM_GEOMETRY = Object.freeze({
  centroid: Object.freeze({ x: 470, y: 230 }),
  circumradius: 132,
  /** Where the incident beam originates, off to the left of the plate. */
  source: Object.freeze({ x: 48, y: 302 }),
  /** Fraction along the left face at which the beam enters. */
  entryFraction: 0.5,
  /** The five indices the fan is solved for, violet through cyan. */
  indices: Object.freeze([1.435, 1.487, 1.539, 1.591, 1.643] as const),
  /** Each component's authored colour, in index order. */
  spectrum: Object.freeze(
    [
      "var(--fig-spectrum-violet)",
      "var(--fig-spectrum-indigo)",
      "var(--fig-spectrum-blue)",
      "var(--fig-spectrum-azure)",
      "var(--fig-spectrum-cyan)",
    ] as const,
  ),
  /** The plate boundary each exit ray is run to. */
  bounds: Object.freeze({ right: 938, top: 12, bottom: 408 }),
  /** How far the undeviated guide continues past the entry point. */
  undeviatedReach: 470,
  /** The fan opens from this offset, this far apart. */
  fanning: Object.freeze({ start: 8, step: 0.84 }),
});

const { centroid, circumradius, source, entryFraction, indices, bounds } =
  PRISM_GEOMETRY;

const APEX: Vector = Object.freeze({
  x: centroid.x,
  y: centroid.y - circumradius,
});
const BASE_LEFT: Vector = Object.freeze({
  x: centroid.x - circumradius * Math.sin(Math.PI / 3),
  y: centroid.y + circumradius / 2,
});
const BASE_RIGHT: Vector = Object.freeze({
  x: centroid.x + circumradius * Math.sin(Math.PI / 3),
  y: centroid.y + circumradius / 2,
});

const sub = (a: Vector, b: Vector): Vector => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vector, b: Vector): Vector => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Vector, k: number): Vector => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vector, b: Vector): number => a.x * b.x + a.y * b.y;
const unit = (a: Vector): Vector => {
  const l = Math.hypot(a.x, a.y);
  return { x: a.x / l, y: a.y / l };
};

/** A face's normal, taken away from the centroid. */
function faceNormal(a: Vector, b: Vector): Vector {
  const d = unit(sub(b, a));
  const n = { x: -d.y, y: d.x };
  const mid = mul(add(a, b), 0.5);
  return dot(n, sub(mid, centroid)) < 0 ? mul(n, -1) : n;
}

const NORMAL_LEFT = faceNormal(APEX, BASE_LEFT);
const NORMAL_RIGHT = faceNormal(APEX, BASE_RIGHT);

/** Vector form of Snell's law; null on total internal reflection. */
function refract(i: Vector, n: Vector, eta: number): Vector | null {
  let normal = n;
  let cosine = -dot(i, normal);
  if (cosine < 0) {
    normal = mul(normal, -1);
    cosine = -dot(i, normal);
  }
  const k = 1 - eta * eta * (1 - cosine * cosine);
  if (k < 0) return null;
  return unit(add(mul(i, eta), mul(normal, eta * cosine - Math.sqrt(k))));
}

/** Where a ray meets a face, or null when it misses the segment. */
function intersect(p: Vector, d: Vector, a: Vector, b: Vector): Vector | null {
  const f = sub(b, a);
  const denominator = d.x * -f.y - d.y * -f.x;
  if (Math.abs(denominator) < 1e-9) return null;
  const rx = a.x - p.x;
  const ry = a.y - p.y;
  const t = (rx * -f.y - ry * -f.x) / denominator;
  const s = (d.x * ry - d.y * rx) / denominator;
  if (t <= 0 || s < 0 || s > 1) return null;
  return add(p, mul(d, t));
}

const ENTRY: Vector = Object.freeze(
  add(APEX, mul(sub(BASE_LEFT, APEX), entryFraction)),
);
const INCIDENT = unit(sub(ENTRY, source));

/** Format one vector for an SVG path command. */
function f2(p: Vector): string {
  return `${Math.round(p.x * 100) / 100} ${Math.round(p.y * 100) / 100}`;
}

interface Solved {
  readonly rays: readonly PrismRay[];
  readonly exit: Vector;
  readonly internal: Vector;
}

const SOLVED: Solved = Object.freeze((() => {
  const { spectrum, fanning } = PRISM_GEOMETRY;
  const rays: PrismRay[] = [];
  let exit: Vector | null = null;
  let internal: Vector | null = null;

  for (const [i, index] of indices.entries()) {
    const inside = refract(INCIDENT, NORMAL_LEFT, 1 / index);
    if (!inside) {
      throw new Error(`prism: component ${i} does not enter the body`);
    }
    const meets = intersect(ENTRY, inside, APEX, BASE_RIGHT);
    if (!meets) {
      throw new Error(`prism: component ${i} does not meet the exit face`);
    }
    const out = refract(inside, NORMAL_RIGHT, index);
    if (!out) {
      throw new Error(`prism: component ${i} does not leave the body`);
    }
    const stroke = spectrum[i];
    if (stroke === undefined) {
      throw new Error(`prism: component ${i} has no spectrum colour`);
    }
    let length = 1e4;
    if (out.x > 0) length = Math.min(length, (bounds.right - meets.x) / out.x);
    if (out.y > 0) length = Math.min(length, (bounds.bottom - meets.y) / out.y);
    if (out.y < 0) length = Math.min(length, (bounds.top - meets.y) / out.y);
    rays.push(Object.freeze({
      d: `M${f2(meets)}L${f2(add(meets, mul(out, length)))}`,
      index,
      stroke,
      offset: fanning.start + i * fanning.step,
    }));
    if (i === 2) {
      exit = meets;
      internal = inside;
    }
  }

  if (!exit || !internal) {
    throw new Error("prism: the mean component does not exit");
  }
  return Object.freeze({ rays: Object.freeze(rays), exit, internal });
})());

/** The five dispersed components, in index order. */
export const PRISM_RAYS = SOLVED.rays;

/** The body, its split half, and the two solved beam segments. */
export const PRISM_PATHS = Object.freeze({
  body: [APEX, BASE_RIGHT, BASE_LEFT]
    .map((p) => `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`)
    .join(" "),
  half: [APEX, BASE_RIGHT, { x: APEX.x, y: BASE_RIGHT.y }]
    .map((p) => `${Math.round(p.x * 100) / 100},${Math.round(p.y * 100) / 100}`)
    .join(" "),
  incident: `M${f2(source)}L${f2(ENTRY)}`,
  internal: `M${f2(ENTRY)}L${f2(SOLVED.exit)}`,
  /** The path the beam would have taken unrefracted: the deviation guide. */
  undeviated: `M${f2(ENTRY)}L${
    f2(add(ENTRY, mul(INCIDENT, PRISM_GEOMETRY.undeviatedReach)))
  }`,
});

export const PRISM_ENTRY = ENTRY;
export const PRISM_EXIT = SOLVED.exit;
export const PRISM_SPLIT = Object.freeze({
  x: APEX.x,
  top: APEX.y,
  bottom: BASE_RIGHT.y,
});

/**
 * Fig. X — the prism. One beam enters a triangular body at an angle and leaves
 * it decomposed, each component deviating by its own amount. The right half of
 * the body fills at the pace of the internal beam, and the fan lights as a
 * spectrum. The authored SVG is the complete resolved diagram; the stylesheet
 * supplies only the passage.
 */
export function PrismArtwork({ id }: PrismArtworkProps): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const wipeClipId = `${id}-wipe`;

  return (
    <figure className="fig fig-prism">
      <svg
        className="fig__art fig-prism__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          One beam entering a triangular body and leaving it decomposed
        </title>
        <desc id={descriptionId}>
          A single beam travels in from the left and refracts into an upward
          triangular body, whose right half carries a faint tint. It crosses the
          body and refracts again at the far face, leaving as a fan of five
          components that spread apart. A dashed guide continues the beam's
          original direction to show how far it was deviated, and the right half
          of the body fills with tint at the pace of the internal beam.
        </desc>
        <g aria-hidden="true" transform="translate(20 112.5) scale(0.75)">
          <defs>
            <clipPath id={wipeClipId} clipPathUnits="userSpaceOnUse">
              <rect
                className="fig-prism__wipe"
                x={469}
                y={90}
                width={118}
                height={210}
              />
            </clipPath>
          </defs>

          <polygon className="fig-prism__body-half" points={PRISM_PATHS.half} />
          <g className="fig-prism__tint" clipPath={`url(#${wipeClipId})`}>
            <polygon
              className="fig-prism__tint-half"
              points={PRISM_PATHS.half}
            />
          </g>

          <path
            className="fig-prism__guide"
            d={PRISM_PATHS.undeviated}
            pathLength={1}
            vectorEffect="non-scaling-stroke"
          />

          {/* The resting diagram, which recedes while the passage re-runs. */}
          <g className="fig-prism__rest">
            <path
              className="fig-prism__beam"
              d={PRISM_PATHS.incident}
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="fig-prism__beam"
              d={PRISM_PATHS.internal}
              vectorEffect="non-scaling-stroke"
            />
            {PRISM_RAYS.map((ray, index) => (
              <path
                key={index}
                className="fig-prism__ray"
                d={ray.d}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <g className="fig-prism__passage">
            <path
              className="fig-prism__ink fig-prism__ink--beam"
              d={PRISM_PATHS.incident}
              pathLength={1}
              vectorEffect="non-scaling-stroke"
              style={{ animationDelay: "2.3s" }}
            />
            <path
              className="fig-prism__ink fig-prism__ink--beam"
              d={PRISM_PATHS.internal}
              pathLength={1}
              vectorEffect="non-scaling-stroke"
              style={{ animationDelay: "5.7s" }}
            />
            {PRISM_RAYS.map((ray, index) => (
              <path
                key={index}
                className="fig-prism__ink fig-prism__ink--ray"
                d={ray.d}
                pathLength={1}
                vectorEffect="non-scaling-stroke"
                style={{
                  animationDelay: `${Math.round(ray.offset * 100) / 100}s`,
                }}
              />
            ))}
          </g>

          <polygon
            className="fig-prism__frame"
            points={PRISM_PATHS.body}
            vectorEffect="non-scaling-stroke"
          />
          <line
            className="fig-prism__split"
            x1={PRISM_SPLIT.x}
            y1={Math.round(PRISM_SPLIT.top * 100) / 100}
            x2={PRISM_SPLIT.x}
            y2={Math.round(PRISM_SPLIT.bottom * 100) / 100}
            vectorEffect="non-scaling-stroke"
          />

          <g className="fig-prism__spectrum">
            {PRISM_RAYS.map((ray, index) => (
              <path
                key={index}
                d={ray.d}
                stroke={ray.stroke}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>

          <g className="fig-prism__nodes">
            <circle
              cx={Math.round(PRISM_ENTRY.x * 100) / 100}
              cy={Math.round(PRISM_ENTRY.y * 100) / 100}
              r={2.4}
            />
            <circle
              cx={Math.round(PRISM_EXIT.x * 100) / 100}
              cy={Math.round(PRISM_EXIT.y * 100) / 100}
              r={2.4}
            />
          </g>
        </g>
      </svg>
    </figure>
  );
}
