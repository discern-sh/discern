/** Fig. VI — the survey: measured study fits one exact triangle to a found figure. */

import type { ReactElement } from "react";

export interface SurveyArtworkProps {
  /** Stable prefix for the SVG title and description identifiers. */
  readonly id: string;
}

/** One planar point in the plate's 760 by 540 viewBox space. */
export interface SurveyPoint {
  readonly x: number;
  readonly y: number;
}

/** One straight mark between two resolved points. */
export interface SurveySegment {
  readonly from: SurveyPoint;
  readonly to: SurveyPoint;
}

/** One triangle contact: a fraction along one polygon edge. */
export interface SurveyContact {
  readonly edge: number;
  readonly t: number;
}

/** One compass arc ghost: a vertex the fit depends on and its swing radius. */
export interface SurveyArc {
  readonly vertex: number;
  readonly radius: number;
}

/** The single proportion authority for the whole plate. */
export const SURVEY_GEOMETRY = Object.freeze({
  /** The found figure: an irregular convex pentagon, clockwise from the top. */
  polygon: Object.freeze([
    Object.freeze({ x: 318, y: 96 }),
    Object.freeze({ x: 548, y: 150 }),
    Object.freeze({ x: 598, y: 350 }),
    Object.freeze({ x: 338, y: 452 }),
    Object.freeze({ x: 156, y: 250 }),
  ]),
  /** The inscribed triangle's contacts, each resting on its own edge. */
  contacts: Object.freeze([
    Object.freeze({ edge: 0, t: 0.34 }),
    Object.freeze({ edge: 2, t: 0.16 }),
    Object.freeze({ edge: 3, t: 0.66 }),
  ]),
  /** The triangle path normalizes to this length; each side spans a third. */
  trianglePathLength: 300,
  /** Extension hairlines continue each contact edge outward past its ends. */
  extension: Object.freeze({ gap: 7, reach: 40, pathLength: 33 }),
  /** Dimension runs rest outside the polygon edges the triangle never meets. */
  run: Object.freeze({
    offset: 30,
    pathLength: 100,
    tickFractions: Object.freeze([0.41, 0.59]),
    tickHalf: 6.5,
  }),
  /** Compass arc ghosts swing at the vertices bounding the fitted contacts. */
  arcs: Object.freeze([
    Object.freeze({ vertex: 0, radius: 30 }),
    Object.freeze({ vertex: 1, radius: 26 }),
    Object.freeze({ vertex: 3, radius: 36 }),
  ]),
  /** Every arc path normalizes to this length for one shared draw metric. */
  arcPathLength: 60,
  /** The accent registration pair at the contact the whole fit turned on. */
  register: Object.freeze({ contact: 0, spacing: 7, half: 6, pathLength: 12 }),
});

/** Unit direction from one point toward another. */
function unitToward(from: SurveyPoint, to: SurveyPoint): SurveyPoint {
  const run = Math.hypot(to.x - from.x, to.y - from.y);
  return { x: (to.x - from.x) / run, y: (to.y - from.y) / run };
}

/** Advance a point by a distance along a direction. */
function along(
  origin: SurveyPoint,
  direction: SurveyPoint,
  distance: number,
): SurveyPoint {
  return {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
  };
}

/** The outward normal of an edge direction, for the clockwise winding. */
function outward(direction: SurveyPoint): SurveyPoint {
  return { x: direction.y, y: -direction.x };
}

/** Format a coordinate compactly at two decimal places. */
function compact(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Resolve one polygon edge into its two bounding vertices. */
function polygonEdge(index: number): SurveySegment {
  const points = SURVEY_GEOMETRY.polygon;
  const from = points[index];
  const to = points[(index + 1) % points.length];
  if (from === undefined || to === undefined) {
    throw new Error("A contact names an edge the polygon does not have.");
  }
  return { from, to };
}

/** Resolve a contact into its exact point on the polygon boundary. */
export function surveyContactPoint(contact: SurveyContact): SurveyPoint {
  const { from, to } = polygonEdge(contact.edge);
  return {
    x: from.x + (to.x - from.x) * contact.t,
    y: from.y + (to.y - from.y) * contact.t,
  };
}

/** The inscribed triangle's vertices, one resting on each contact edge. */
export const SURVEY_TRIANGLE: readonly SurveyPoint[] = Object.freeze(
  SURVEY_GEOMETRY.contacts.map(surveyContactPoint),
);

/** The polygon edges the triangle never touches, in index order. */
export const SURVEY_RUN_EDGES: readonly number[] = Object.freeze(
  SURVEY_GEOMETRY.polygon
    .map((_, index) => index)
    .filter((index) =>
      SURVEY_GEOMETRY.contacts.every((contact) => contact.edge !== index)
    ),
);

const STAGGER_KEYS: readonly string[] = Object.freeze(["a", "b", "c"]);

/** The stagger slot for one enumerated survey gesture. */
function staggerKey(index: number): string {
  const key = STAGGER_KEYS[index];
  if (key === undefined) {
    throw new Error("A survey gesture has no stagger slot.");
  }
  return key;
}

/** Both outward continuations of one contact edge. */
function edgeExtensions(edge: number): readonly SurveySegment[] {
  const { from, to } = polygonEdge(edge);
  const forward = unitToward(from, to);
  const backward: SurveyPoint = { x: -forward.x, y: -forward.y };
  const { gap, reach } = SURVEY_GEOMETRY.extension;
  return [
    { from: along(to, forward, gap), to: along(to, forward, reach) },
    { from: along(from, backward, gap), to: along(from, backward, reach) },
  ];
}

/** One dimension run resting outside an unmeasured span. */
function dimensionRun(edge: number): SurveySegment {
  const { from, to } = polygonEdge(edge);
  const normal = outward(unitToward(from, to));
  const { offset } = SURVEY_GEOMETRY.run;
  return { from: along(from, normal, offset), to: along(to, normal, offset) };
}

/** The perpendicular tick pair registered along one dimension run. */
function runTicks(edge: number): readonly SurveySegment[] {
  const run = dimensionRun(edge);
  const { from, to } = polygonEdge(edge);
  const normal = outward(unitToward(from, to));
  const { tickFractions, tickHalf } = SURVEY_GEOMETRY.run;
  return tickFractions.map((fraction) => {
    const centre: SurveyPoint = {
      x: run.from.x + (run.to.x - run.from.x) * fraction,
      y: run.from.y + (run.to.y - run.from.y) * fraction,
    };
    return {
      from: along(centre, normal, -tickHalf),
      to: along(centre, normal, tickHalf),
    };
  });
}

/** One compass arc ghost swung about a vertex, through its interior angle. */
function arcPath(arc: SurveyArc): string {
  const points = SURVEY_GEOMETRY.polygon;
  const count = points.length;
  const vertex = points[arc.vertex];
  const previous = points[(arc.vertex + count - 1) % count];
  const next = points[(arc.vertex + 1) % count];
  if (vertex === undefined || previous === undefined || next === undefined) {
    throw new Error("An arc names a vertex the polygon does not have.");
  }
  const toPrevious = unitToward(vertex, previous);
  const toNext = unitToward(vertex, next);
  const start = along(vertex, toPrevious, arc.radius);
  const end = along(vertex, toNext, arc.radius);
  let sweep = Math.atan2(toNext.y, toNext.x) -
    Math.atan2(toPrevious.y, toPrevious.x);
  if (sweep <= -Math.PI) sweep += Math.PI * 2;
  if (sweep > Math.PI) sweep -= Math.PI * 2;
  return `M ${compact(start.x)} ${compact(start.y)} ` +
    `A ${arc.radius} ${arc.radius} 0 0 ${sweep > 0 ? 1 : 0} ` +
    `${compact(end.x)} ${compact(end.y)}`;
}

/** The accent registration pair flanking the load-bearing contact. */
function registerTicks(): readonly SurveySegment[] {
  const { contact, spacing, half } = SURVEY_GEOMETRY.register;
  const spec = SURVEY_GEOMETRY.contacts[contact];
  if (spec === undefined) {
    throw new Error("The register names a contact the fit does not have.");
  }
  const { from, to } = polygonEdge(spec.edge);
  const forward = unitToward(from, to);
  const normal = outward(forward);
  const centre = surveyContactPoint(spec);
  return [-spacing, spacing].map((shift) => {
    const anchor = along(centre, forward, shift);
    return {
      from: along(anchor, normal, -half),
      to: along(anchor, normal, half),
    };
  });
}

/** Serialize the polygon into an SVG points attribute. */
function polygonPoints(): string {
  return SURVEY_GEOMETRY.polygon
    .map((vertex) => `${compact(vertex.x)},${compact(vertex.y)}`)
    .join(" ");
}

/** The triangle's closed path, opening at the load-bearing apex contact. */
function trianglePath(): string {
  const moves = SURVEY_TRIANGLE
    .map((vertex, index) =>
      `${index === 0 ? "M" : "L"} ${compact(vertex.x)} ${compact(vertex.y)}`
    )
    .join(" ");
  return `${moves} Z`;
}

/** Spread one segment into SVG line coordinates. */
function segmentAttributes(segment: SurveySegment): {
  readonly x1: string;
  readonly y1: string;
  readonly x2: string;
  readonly y2: string;
} {
  return {
    x1: compact(segment.from.x),
    y1: compact(segment.from.y),
    x2: compact(segment.to.x),
    y2: compact(segment.to.y),
  };
}

interface SurveyStaggeredSegment {
  readonly key: string;
  readonly stagger: string;
  readonly segment: SurveySegment;
}

const EXTENSION_MARKS: readonly SurveyStaggeredSegment[] = Object.freeze(
  SURVEY_GEOMETRY.contacts.flatMap((contact, index) =>
    edgeExtensions(contact.edge).map((segment, side) => ({
      key: `extension-${contact.edge}-${side}`,
      stagger: staggerKey(index),
      segment,
    }))
  ),
);

const RUN_MARKS: readonly SurveyStaggeredSegment[] = Object.freeze(
  SURVEY_RUN_EDGES.map((edge, index) => ({
    key: `run-${edge}`,
    stagger: staggerKey(index),
    segment: dimensionRun(edge),
  })),
);

const RUN_TICK_MARKS: readonly SurveyStaggeredSegment[] = Object.freeze(
  SURVEY_RUN_EDGES.flatMap((edge, index) =>
    runTicks(edge).map((segment, position) => ({
      key: `run-tick-${edge}-${position}`,
      stagger: staggerKey(index),
      segment,
    }))
  ),
);

const ARC_MARKS: readonly {
  readonly key: string;
  readonly stagger: string;
  readonly d: string;
}[] = Object.freeze(
  SURVEY_GEOMETRY.arcs.map((arc, index) => ({
    key: `arc-${arc.vertex}`,
    stagger: staggerKey(index),
    d: arcPath(arc),
  })),
);

const REGISTER_MARKS: readonly SurveySegment[] = Object.freeze(registerTicks());

/**
 * Fig. VI, "The survey". Measuring marks rest around an irregular found
 * pentagon: extension hairlines continuing its measured edges, offset
 * dimension runs with perpendicular tick pairs along its unmeasured spans,
 * and small compass arc ghosts at its load-bearing corners. Within the
 * figure one exact triangle stands inscribed, each vertex resting on its
 * own edge, with a small accent registration pair at the topmost contact.
 * The authored SVG is the complete fitted plate; the stylesheet only
 * supplies the journey into it.
 */
export function SurveyArtwork(
  { id }: SurveyArtworkProps,
): ReactElement {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <figure className="fig fig-survey">
      <svg
        className="fig__art fig-survey__art"
        viewBox="0 0 760 540"
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        focusable="false"
      >
        <title id={titleId}>
          An exact triangle fitted inside a surveyed five-sided figure
        </title>
        <desc id={descriptionId}>
          Fine measuring marks, among them edge extensions, offset dimension
          runs with paired ticks, and small compass arcs, rest around an
          irregular five-sided outline. Within it one exact triangle stands
          inscribed, each corner resting on a different side of the figure, and
          a small pair of registration ticks marks its topmost contact.
        </desc>
        <g aria-hidden="true">
          <g className="fig-survey__marks">
            {EXTENSION_MARKS.map((mark) => (
              <line
                key={mark.key}
                className={`fig-survey__extension fig-survey__extension--${mark.stagger}`}
                data-survey-extension={mark.key}
                {...segmentAttributes(mark.segment)}
                pathLength={SURVEY_GEOMETRY.extension.pathLength}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {RUN_MARKS.map((mark) => (
              <line
                key={mark.key}
                className={`fig-survey__run fig-survey__run--${mark.stagger}`}
                data-survey-run={mark.key}
                {...segmentAttributes(mark.segment)}
                pathLength={SURVEY_GEOMETRY.run.pathLength}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {RUN_TICK_MARKS.map((mark) => (
              <line
                key={mark.key}
                className={`fig-survey__run-tick fig-survey__run-tick--${mark.stagger}`}
                data-survey-run-tick={mark.key}
                {...segmentAttributes(mark.segment)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {ARC_MARKS.map((mark) => (
              <path
                key={mark.key}
                className={`fig-survey__arc fig-survey__arc--${mark.stagger}`}
                data-survey-arc={mark.key}
                d={mark.d}
                pathLength={SURVEY_GEOMETRY.arcPathLength}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <polygon
            className="fig-survey__found"
            data-survey-found="true"
            points={polygonPoints()}
            vectorEffect="non-scaling-stroke"
          />
          <path
            className="fig-survey__triangle"
            data-survey-triangle="true"
            d={trianglePath()}
            pathLength={SURVEY_GEOMETRY.trianglePathLength}
            vectorEffect="non-scaling-stroke"
          />
          {REGISTER_MARKS.map((segment, index) => (
            <line
              key={`register-${index}`}
              className="fig-survey__register"
              data-survey-register={String(index)}
              {...segmentAttributes(segment)}
              pathLength={SURVEY_GEOMETRY.register.pathLength}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
      </svg>
    </figure>
  );
}
