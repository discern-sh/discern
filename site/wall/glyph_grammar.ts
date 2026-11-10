/**
 * The wall's glyph grammar: a small vocabulary of primitives on a 48-unit grid.
 *
 * A glyph is a list of primitives. Each one is painted in one of three tones,
 * and one renderer draws them all, so every glyph shares a grid, a stroke, and
 * a weight. This module is the vocabulary: the primitive constructors, the
 * plain shapes each primitive is drawn as, the space it occupies, and the
 * seeded glyph an unknown name receives.
 *
 * Angles are in degrees, clockwise from twelve o'clock.
 *
 * The page is hydrated, so the server and every browser must serialize a glyph
 * to the same markup. `Math.sin`, `Math.cos`, and `Math.sqrt` may differ in
 * their last bit between engines, so angles and lengths go through arithmetic
 * the language specifies exactly, and every coordinate is rounded before it
 * leaves this module.
 */

/** The side of the square grid every glyph is drawn on. */
export const GLYPH_GRID = 48;

/** The three tones a primitive is painted in. */
export const GLYPH_TONES = ["solid", "tint", "outline"] as const;
export type GlyphTone = (typeof GLYPH_TONES)[number];
/** A filled area is solid or tinted. */
export type GlyphFillTone = Exclude<GlyphTone, "outline">;
/** A stroke has no area to fill: it is a full outline or a tinted one. */
export type GlyphStrokeTone = Exclude<GlyphTone, "solid">;

export type GlyphPoint = readonly [x: number, y: number];

interface Movable {
  /** How far the primitive travels while its card is lit, in grid units. */
  readonly shift?: GlyphPoint;
}

interface Dashable {
  readonly dashed?: true;
}

export interface DotPrimitive extends Movable {
  readonly kind: "dot";
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly tone: GlyphFillTone;
}

export interface RingPrimitive extends Movable, Dashable {
  readonly kind: "ring";
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export interface BarPrimitive extends Movable {
  readonly kind: "bar";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly tone: GlyphFillTone;
  /** Rotation about the bar's own center. */
  readonly turn: number;
}

export interface FramePrimitive extends Movable, Dashable {
  readonly kind: "frame";
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly corner: number;
  /** Rotation about the frame's own center. */
  readonly turn: number;
}

export interface TrailPrimitive extends Movable, Dashable {
  readonly kind: "trail";
  readonly points: readonly GlyphPoint[];
  readonly tone: GlyphStrokeTone;
}

export interface ArcPrimitive extends Movable, Dashable {
  readonly kind: "arc";
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly from: number;
  readonly sweep: number;
  readonly tone: GlyphStrokeTone;
}

export interface BandPrimitive extends Movable {
  readonly kind: "band";
  readonly cx: number;
  readonly cy: number;
  /** Radius of the band's center line. */
  readonly r: number;
  readonly width: number;
  readonly from: number;
  readonly sweep: number;
  readonly tone: GlyphFillTone;
}

export interface SectorPrimitive extends Movable {
  readonly kind: "sector";
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly from: number;
  readonly sweep: number;
  readonly tone: GlyphTone;
}

export interface PolyPrimitive extends Movable {
  readonly kind: "poly";
  readonly points: readonly GlyphPoint[];
  readonly tone: GlyphTone;
}

export interface SplitPrimitive extends Movable {
  readonly kind: "split";
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
  /** Rotation about the triangle's own center. */
  readonly turn: number;
}

export type GlyphPrimitive =
  | DotPrimitive
  | RingPrimitive
  | BarPrimitive
  | FramePrimitive
  | TrailPrimitive
  | ArcPrimitive
  | BandPrimitive
  | SectorPrimitive
  | PolyPrimitive
  | SplitPrimitive;

export type GlyphPrimitiveKind = GlyphPrimitive["kind"];

/** The whole vocabulary, by kind. */
export const GLYPH_PRIMITIVE_KINDS = [
  "dot",
  "ring",
  "bar",
  "frame",
  "trail",
  "arc",
  "band",
  "sector",
  "poly",
  "split",
] as const satisfies readonly GlyphPrimitiveKind[];

/** A glyph: primitives in paint order, the last on top. */
export type GlyphDrawing = readonly GlyphPrimitive[];

/** A filled circle. */
export function dot(
  cx: number,
  cy: number,
  r: number,
  tone: GlyphFillTone = "solid",
): DotPrimitive {
  return { kind: "dot", cx, cy, r, tone };
}

/** An outlined circle. */
export function ring(cx: number, cy: number, r: number): RingPrimitive {
  return { kind: "ring", cx, cy, r };
}

/** A filled rectangle with softened corners, optionally turned about its center. */
export function bar(
  x: number,
  y: number,
  w: number,
  h: number,
  tone: GlyphFillTone = "solid",
  turn = 0,
): BarPrimitive {
  return { kind: "bar", x, y, w, h, tone, turn };
}

/** An outlined rectangle, optionally turned about its center. */
export function frame(
  x: number,
  y: number,
  w: number,
  h: number,
  corner: number,
  turn = 0,
): FramePrimitive {
  return { kind: "frame", x, y, w, h, corner, turn };
}

/** A straight stroke between two points. */
export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  tone: GlyphStrokeTone = "outline",
): TrailPrimitive {
  return { kind: "trail", points: [[x1, y1], [x2, y2]], tone };
}

/** A stroke along part of a circle: `sweep` degrees clockwise from `from`. */
export function arc(
  cx: number,
  cy: number,
  r: number,
  from: number,
  sweep: number,
  tone: GlyphStrokeTone = "outline",
): ArcPrimitive {
  return { kind: "arc", cx, cy, r, from, sweep, tone };
}

/**
 * A thick arc with round ends, filled like a bar bent around a circle. A sweep
 * of 360 closes it into a thick ring.
 */
export function band(
  cx: number,
  cy: number,
  r: number,
  width: number,
  from: number,
  sweep: number,
  tone: GlyphFillTone = "solid",
): BandPrimitive {
  return { kind: "band", cx, cy, r, width, from, sweep, tone };
}

/** A slice of a disc: a quarter disc is a sweep of 90, a half disc 180. */
export function sector(
  cx: number,
  cy: number,
  r: number,
  from: number,
  sweep: number,
  tone: GlyphTone = "solid",
): SectorPrimitive {
  return { kind: "sector", cx, cy, r, from, sweep, tone };
}

/** A closed shape through each point in turn. */
export function poly(
  points: readonly GlyphPoint[],
  tone: GlyphTone = "solid",
): PolyPrimitive {
  return { kind: "poly", points, tone };
}

/**
 * A solid bracket around a corner: its elbow at `x`, `y`, one arm reaching
 * `dx` across and the other `dy` down, each `thick` wide. A negative reach
 * turns that arm the other way.
 */
export function bracket(
  x: number,
  y: number,
  dx: number,
  dy: number,
  thick: number,
): PolyPrimitive {
  const tx = dx < 0 ? -thick : thick;
  const ty = dy < 0 ? -thick : thick;
  return poly([
    [x, y],
    [x + dx, y],
    [x + dx, y + ty],
    [x + tx, y + ty],
    [x + tx, y + dy],
    [x, y + dy],
  ]);
}

/**
 * The split triangle of the discern mark: an upright triangle `w` wide and `h`
 * tall, its right half solid and its left half tinted. A rare accent.
 */
export function split(
  cx: number,
  cy: number,
  w: number,
  h: number,
  turn = 0,
): SplitPrimitive {
  return { kind: "split", cx, cy, w, h, turn };
}

/** The same primitive, drawn as a dashed stroke. */
export function dashed<
  Primitive extends
    | RingPrimitive
    | FramePrimitive
    | TrailPrimitive
    | ArcPrimitive,
>(primitive: Primitive): Primitive {
  return { ...primitive, dashed: true };
}

/** The same primitive, travelling `dx`, `dy` grid units while its card is lit. */
export function shift<Primitive extends GlyphPrimitive>(
  primitive: Primitive,
  dx: number,
  dy: number,
): Primitive {
  return { ...primitive, shift: [dx, dy] };
}

/** How a drawn shape is painted: one of the tones, or `faint`, a tinted stroke. */
export const GLYPH_PAINTS = [...GLYPH_TONES, "faint"] as const;
export type GlyphPaint = (typeof GLYPH_PAINTS)[number];

interface ShapeBase {
  readonly paint: GlyphPaint;
  /** A `stroke-dasharray` value, when the stroke is dashed. */
  readonly dash?: string;
  /** A rotation in degrees about a point. */
  readonly turn?: readonly [degrees: number, cx: number, cy: number];
}

export interface CircleShape extends ShapeBase {
  readonly el: "circle";
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

export interface RectShape extends ShapeBase {
  readonly el: "rect";
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rx: number;
}

export interface PathShape extends ShapeBase {
  readonly el: "path";
  readonly d: string;
}

/** One element the renderer draws. */
export type GlyphShape = CircleShape | RectShape | PathShape;

const PI = 3.141592653589793;

/** Round to the hundredth of a grid unit that markup carries. */
function round(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/**
 * A distance in grid units as a percentage of the grid's side. A box that
 * draws the grid at any size moves its drawing that many units when it moves
 * by this share of its own side.
 */
export function gridShare(units: number): number {
  return round(units / GLYPH_GRID * 100);
}

/**
 * Sine and cosine of an angle in degrees, from addition, multiplication, and
 * division alone, so every engine computes the same bits.
 */
function sinCos(degrees: number): readonly [sin: number, cos: number] {
  const wrapped = ((degrees % 360) + 360) % 360;
  const quadrant = Math.floor(wrapped / 90);
  const x = (wrapped - quadrant * 90) * (PI / 180);
  const square = x * x;
  let sin = x;
  let cos = 1;
  let sinTerm = x;
  let cosTerm = 1;
  for (let n = 1; n <= 10; n++) {
    cosTerm *= -square / ((2 * n - 1) * (2 * n));
    sinTerm *= -square / ((2 * n) * (2 * n + 1));
    cos += cosTerm;
    sin += sinTerm;
  }
  if (quadrant === 0) return [sin, cos];
  if (quadrant === 1) return [cos, -sin];
  if (quadrant === 2) return [-sin, -cos];
  return [-cos, sin];
}

/** A square root by Newton's method, exact in every engine for the same reason. */
function root(value: number): number {
  if (value <= 0) return 0;
  let estimate = Math.max(value, 1);
  for (let step = 0; step < 40; step++) {
    estimate = (estimate + value / estimate) / 2;
  }
  return estimate;
}

/** The distance between two points. */
function distance(from: GlyphPoint, to: GlyphPoint): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return root(dx * dx + dy * dy);
}

/** The point `r` units from a center at an angle clockwise from twelve o'clock. */
function onCircle(
  cx: number,
  cy: number,
  r: number,
  degrees: number,
): GlyphPoint {
  const [sin, cos] = sinCos(degrees);
  return [cx + r * sin, cy - r * cos];
}

/** A point after a clockwise rotation about a center. */
function turned(
  point: GlyphPoint,
  degrees: number,
  cx: number,
  cy: number,
): GlyphPoint {
  const [sin, cos] = sinCos(degrees);
  const dx = point[0] - cx;
  const dy = point[1] - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** A point as it is written in path data. */
function at(point: GlyphPoint): string {
  return `${round(point[0])} ${round(point[1])}`;
}

/** A path through each point in turn, closed when asked. */
function through(points: readonly GlyphPoint[], closed: boolean): string {
  const steps = points.map((point, index) =>
    `${index === 0 ? "M" : "L"}${at(point)}`
  );
  return `${steps.join(" ")}${closed ? " Z" : ""}`;
}

/** How far a closed shape's corner is cut back along each edge before it is rounded. */
const POLY_CORNER = 2.4;

/** The point `reach` units from `from` toward `to`, at most halfway. */
function toward(
  from: GlyphPoint,
  to: GlyphPoint,
  reach: number,
): GlyphPoint {
  const length = distance(from, to);
  if (length === 0) return from;
  const part = Math.min(reach, length / 2) / length;
  return [
    from[0] + (to[0] - from[0]) * part,
    from[1] + (to[1] - from[1]) * part,
  ];
}

/** A closed path through each point in turn, every corner rounded like a bar's. */
function softened(points: readonly GlyphPoint[]): string {
  const steps = points.map((corner, index) => {
    const before = points[(index + points.length - 1) % points.length] ??
      corner;
    const after = points[(index + 1) % points.length] ?? corner;
    const enter = at(toward(corner, before, POLY_CORNER));
    const leave = at(toward(corner, after, POLY_CORNER));
    return `${index === 0 ? "M" : "L"}${enter} Q${at(corner)} ${leave}`;
  });
  return `${steps.join(" ")} Z`;
}

/** One arc command to `to`, around a circle of radius `r`. */
function arcTo(
  r: number,
  sweep: number,
  clockwise: boolean,
  to: GlyphPoint,
): string {
  const radius = round(r);
  const large = Math.abs(sweep) > 180 ? 1 : 0;
  return `A${radius} ${radius} 0 ${large} ${clockwise ? 1 : 0} ${at(to)}`;
}

/**
 * A whole circle as a closed path. Two circles drawn in opposite directions
 * fill as the ring between them.
 */
function circle(
  cx: number,
  cy: number,
  r: number,
  clockwise: boolean,
): string {
  const top: GlyphPoint = [cx, cy - r];
  const bottom: GlyphPoint = [cx, cy + r];
  return `M${at(top)} ${arcTo(r, 180, clockwise, bottom)} ${
    arcTo(r, 180, clockwise, top)
  } Z`;
}

/**
 * How softly a filled bar's corners are rounded: nearly a pill when it is
 * thin, a soft square when it is not.
 */
function barCorner(w: number, h: number): number {
  return Math.min(Math.min(w, h) / 2.4, Math.max(w, h) / 5, 4.5);
}

/**
 * The least length a dash and the gap after it share along a stroke. The
 * stylesheet draws a dashed stroke heavier than a whole one, because the gaps
 * take ink away, and a dash's round caps extend it by that weight. The period
 * leaves a clear gap between two dashes at the heaviest setting of the weight
 * knob.
 */
const DASH_PERIOD = 7.4;
/** The drawn length of a dash before the stroke's round caps extend it. */
const DASH_LENGTH = 2.2;

/**
 * A dash pattern that divides a stroke evenly: a closed stroke meets itself
 * without a seam, and an open one begins and ends on a whole dash. A stroke
 * takes as many dashes as fit at the period, so the gaps only ever widen.
 */
function dashes(length: number, closed: boolean): string {
  if (closed) {
    const count = Math.max(2, Math.floor(length / DASH_PERIOD));
    return `${DASH_LENGTH} ${round(length / count - DASH_LENGTH)}`;
  }
  const count = Math.max(
    2,
    Math.floor((length + DASH_PERIOD - DASH_LENGTH) / DASH_PERIOD),
  );
  const gap = (length - count * DASH_LENGTH) / (count - 1);
  return `${DASH_LENGTH} ${round(gap)}`;
}

/** The length of an open stroke through each point in turn. */
function trailLength(points: readonly GlyphPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    if (from === undefined || to === undefined) continue;
    length += distance(from, to);
  }
  return length;
}

/** The paint a stroke's tone asks for. */
function strokePaint(tone: GlyphStrokeTone): GlyphPaint {
  return tone === "tint" ? "faint" : "outline";
}

/** The point a bar or frame turns about. */
function center(
  primitive: BarPrimitive | FramePrimitive,
): GlyphPoint {
  return [primitive.x + primitive.w / 2, primitive.y + primitive.h / 2];
}

/** The rotation a turned bar or frame is drawn with, or none when it is upright. */
function rectTurn(
  primitive: BarPrimitive | FramePrimitive,
): Pick<ShapeBase, "turn"> {
  if (primitive.turn === 0) return {};
  const [cx, cy] = center(primitive);
  return { turn: [primitive.turn, round(cx), round(cy)] };
}

/** The three corners of a split triangle before it is turned: left, right, apex. */
function splitCorners(
  primitive: SplitPrimitive,
): readonly [GlyphPoint, GlyphPoint, GlyphPoint] {
  const { cx, cy, w, h } = primitive;
  return [
    [cx - w / 2, cy + h / 2],
    [cx + w / 2, cy + h / 2],
    [cx, cy - h / 2],
  ];
}

/** The shapes one primitive is drawn as, in paint order. */
export function drawPrimitive(
  primitive: GlyphPrimitive,
): readonly GlyphShape[] {
  switch (primitive.kind) {
    case "dot":
      return [{
        el: "circle",
        cx: round(primitive.cx),
        cy: round(primitive.cy),
        r: round(primitive.r),
        paint: primitive.tone,
      }];
    case "ring":
      return [{
        el: "circle",
        cx: round(primitive.cx),
        cy: round(primitive.cy),
        r: round(primitive.r),
        paint: "outline",
        ...(primitive.dashed
          ? { dash: dashes(2 * PI * primitive.r, true) }
          : {}),
      }];
    case "bar":
      return [{
        el: "rect",
        x: round(primitive.x),
        y: round(primitive.y),
        width: round(primitive.w),
        height: round(primitive.h),
        rx: round(barCorner(primitive.w, primitive.h)),
        paint: primitive.tone,
        ...rectTurn(primitive),
      }];
    case "frame": {
      const { w, h, corner } = primitive;
      return [{
        el: "rect",
        x: round(primitive.x),
        y: round(primitive.y),
        width: round(w),
        height: round(h),
        rx: round(corner),
        paint: "outline",
        ...(primitive.dashed
          ? {
            dash: dashes(2 * (w + h) - 8 * corner + 2 * PI * corner, true),
          }
          : {}),
        ...rectTurn(primitive),
      }];
    }
    case "trail":
      return [{
        el: "path",
        d: through(primitive.points, false),
        paint: strokePaint(primitive.tone),
        ...(primitive.dashed
          ? { dash: dashes(trailLength(primitive.points), false) }
          : {}),
      }];
    case "arc": {
      const { cx, cy, r, from, sweep } = primitive;
      const start = onCircle(cx, cy, r, from);
      const end = onCircle(cx, cy, r, from + sweep);
      return [{
        el: "path",
        d: `M${at(start)} ${arcTo(r, sweep, sweep > 0, end)}`,
        paint: strokePaint(primitive.tone),
        ...(primitive.dashed
          ? { dash: dashes(r * Math.abs(sweep) * (PI / 180), false) }
          : {}),
      }];
    }
    case "band": {
      const { cx, cy, r, width, from, sweep } = primitive;
      const clockwise = sweep > 0;
      const outer = r + width / 2;
      const inner = r - width / 2;
      if (Math.abs(sweep) >= 360) {
        return [{
          el: "path",
          d: `${circle(cx, cy, outer, true)} ${circle(cx, cy, inner, false)}`,
          paint: primitive.tone,
        }];
      }
      const outerStart = onCircle(cx, cy, outer, from);
      const outerEnd = onCircle(cx, cy, outer, from + sweep);
      const innerEnd = onCircle(cx, cy, inner, from + sweep);
      const innerStart = onCircle(cx, cy, inner, from);
      return [{
        el: "path",
        d: [
          `M${at(outerStart)}`,
          arcTo(outer, sweep, clockwise, outerEnd),
          arcTo(width / 2, 0, clockwise, innerEnd),
          arcTo(inner, sweep, !clockwise, innerStart),
          arcTo(width / 2, 0, clockwise, outerStart),
          "Z",
        ].join(" "),
        paint: primitive.tone,
      }];
    }
    case "sector": {
      const { cx, cy, r, from, sweep } = primitive;
      const start = onCircle(cx, cy, r, from);
      const end = onCircle(cx, cy, r, from + sweep);
      return [{
        el: "path",
        d: `M${at([cx, cy])} L${at(start)} ${
          arcTo(r, sweep, sweep > 0, end)
        } Z`,
        paint: primitive.tone,
      }];
    }
    case "poly":
      return [{
        el: "path",
        d: softened(primitive.points),
        paint: primitive.tone,
      }];
    case "split": {
      const [left, right, apex] = splitCorners(primitive);
      const foot: GlyphPoint = [primitive.cx, left[1]];
      const turn = primitive.turn === 0 ? {} : {
        turn: [
          primitive.turn,
          round(primitive.cx),
          round(primitive.cy),
        ] as const,
      };
      return [
        {
          el: "path",
          d: through([left, foot, apex], true),
          paint: "tint",
          ...turn,
        },
        {
          el: "path",
          d: through([foot, right, apex], true),
          paint: "solid",
          ...turn,
        },
        {
          el: "path",
          d: through([left, right, apex], true),
          paint: "outline",
          ...turn,
        },
      ];
    }
  }
}

/** The box a primitive's geometry occupies, before its stroke adds any width. */
export interface GlyphExtent {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The smallest box around a set of points. */
function around(points: readonly GlyphPoint[]): GlyphExtent {
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** The points that bound an arc: its two ends and each quarter point it passes. */
function arcBounds(
  cx: number,
  cy: number,
  r: number,
  from: number,
  sweep: number,
): GlyphPoint[] {
  const low = Math.min(from, from + sweep);
  const high = Math.max(from, from + sweep);
  const points = [onCircle(cx, cy, r, low), onCircle(cx, cy, r, high)];
  for (
    let quarter = Math.ceil(low / 90) * 90;
    quarter <= high;
    quarter += 90
  ) {
    points.push(onCircle(cx, cy, r, quarter));
  }
  return points;
}

/** The four corners of a bar or frame after its turn. */
function rectCorners(
  primitive: BarPrimitive | FramePrimitive,
): GlyphPoint[] {
  const { x, y, w, h, turn } = primitive;
  const [cx, cy] = center(primitive);
  const corners: GlyphPoint[] = [[x, y], [x + w, y], [x + w, y + h], [
    x,
    y + h,
  ]];
  return corners.map((corner) => turned(corner, turn, cx, cy));
}

/** The box one primitive's geometry occupies on the grid. */
export function primitiveExtent(primitive: GlyphPrimitive): GlyphExtent {
  switch (primitive.kind) {
    case "dot":
    case "ring": {
      const { cx, cy, r } = primitive;
      return { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r };
    }
    case "bar":
    case "frame":
      return around(rectCorners(primitive));
    case "trail":
    case "poly":
      return around(primitive.points);
    case "arc": {
      const { cx, cy, r, from, sweep } = primitive;
      return around(arcBounds(cx, cy, r, from, sweep));
    }
    case "band": {
      const { cx, cy, r, width, from, sweep } = primitive;
      const core = around(arcBounds(cx, cy, r, from, sweep));
      return {
        minX: core.minX - width / 2,
        minY: core.minY - width / 2,
        maxX: core.maxX + width / 2,
        maxY: core.maxY + width / 2,
      };
    }
    case "sector": {
      const { cx, cy, r, from, sweep } = primitive;
      return around([[cx, cy], ...arcBounds(cx, cy, r, from, sweep)]);
    }
    case "split": {
      const { cx, cy, turn } = primitive;
      return around(
        splitCorners(primitive).map((corner) => turned(corner, turn, cx, cy)),
      );
    }
  }
}

/** A 32-bit FNV-1a hash of a name, as an unsigned integer. */
function hashName(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A repeatable stream of whole numbers below a bound, from one seed. */
function seededPicks(seed: number): (bound: number) => number {
  let state = seed;
  return (bound) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) % bound;
  };
}

/**
 * The glyph a name with no authored drawing receives. The name alone decides
 * it, so the same name draws the same glyph on every render, and it is
 * composed from the ordinary primitives so it sits with the authored set.
 */
export function seededGlyph(name: string): GlyphDrawing {
  const pick = seededPicks(hashName(name));
  const quarter = pick(4) * 90;
  switch (pick(6)) {
    case 0: {
      const [x, y] = onCircle(24, 24, 18, 45 + quarter);
      return [
        band(24, 24, 18, 5, 0, 360, "tint"),
        dot(24, 24, 7 + pick(3)),
        dot(round(x), round(y), 5),
      ];
    }
    case 1: {
      const lit = pick(3);
      return [0, 1, 2].map((column) => {
        const height = 34 + pick(3) * 4;
        return bar(
          3 + column * 15.5,
          45 - height,
          11,
          height,
          column === lit ? "solid" : "tint",
        );
      });
    }
    case 2: {
      const side = 12 + pick(3) * 3;
      const [x, y] = onCircle(24, 24, 7, 45 + quarter);
      return [
        dot(24, 24, 21, "tint"),
        bar(round(x - side / 2), round(y - side / 2), side, side),
      ];
    }
    case 3: {
      const lit = pick(2) === 0;
      const [x, y] = onCircle(24, 24, 12, quarter + 180);
      return [
        sector(24, 24, 20, quarter - 90, 180, lit ? "solid" : "tint"),
        dot(round(x), round(y), 8, lit ? "tint" : "solid"),
      ];
    }
    case 4: {
      const sweep = 150 + pick(3) * 45;
      return [
        band(24, 24, 16.5, 8, quarter, sweep, "tint"),
        band(24, 24, 16.5, 8, quarter + sweep + 40, 280 - sweep),
        dot(24, 24, 6),
      ];
    }
    default: {
      const lit = pick(3);
      return [0, 1, 2].map((row) =>
        bar(
          3,
          4 + row * 15.5,
          34 + pick(3) * 4,
          9,
          row === lit ? "solid" : "tint",
        )
      );
    }
  }
}
