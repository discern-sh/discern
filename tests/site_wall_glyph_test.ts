/**
 * The wall's glyph system holds together: every drawing stays inside the
 * grammar and the grid, an unknown name always draws the same seeded glyph,
 * the markup is stable enough to hydrate, and the triangle stays a rare accent.
 *
 * The set also has to read as one family at the size it is shown. Each glyph
 * is measured as the ink it lays on the grid, so that none is faint, none is
 * cramped into a corner of its grid, no two share a silhouette, and no single
 * device is leaned on by several glyphs. Every authored glyph belongs to a
 * card on the wall.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Project, SyntaxKind } from "ts-morph";
import { cardGlyph } from "../site/wall/Card.tsx";
import { WALL_DECK } from "../site/wall/deck.ts";
import { Glyph } from "../site/wall/Glyph.tsx";
import {
  arc,
  bar,
  dashed,
  drawPrimitive,
  GLYPH_GRID,
  GLYPH_PAINTS,
  GLYPH_PRIMITIVE_KINDS,
  type GlyphDrawing,
  type GlyphExtent,
  type GlyphPoint,
  type GlyphPrimitive,
  type GlyphShape,
  primitiveExtent,
  ring,
  sector,
  seededGlyph,
  split,
} from "../site/wall/glyph_grammar.ts";
import { glyphDrawing, GLYPHS } from "../site/wall/glyphs.ts";
import { WALL_KNOBS } from "../site/wall/tuning/knobs.ts";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";

const ROOT = fromFileUrl(new URL("../", import.meta.url));

const AUTHORED = Object.entries(GLYPHS);

/** Names no glyph is authored for, including ones every object answers to. */
const UNKNOWN_NAMES = [
  "",
  "constructor",
  "toString",
  "hasOwnProperty",
  "__proto__",
  ...Array.from({ length: 240 }, (_, index) => `unknown-card-${index}`),
];

/** Most a hovered primitive may travel, in grid units. */
const LONGEST_SHIFT = 3;

/** One of the two knobs the glyph stylesheet reads. */
function glyphKnob(
  name: "glyph-weight" | "glyph-tint",
): (typeof WALL_KNOBS)[number] {
  const knob = WALL_KNOBS.find((candidate) => candidate.name === name);
  assert(knob !== undefined, `the ${name} knob styles the glyphs`);
  return knob;
}

/** The heaviest stroke the tuning panel can set, in grid units. */
function heaviestStroke(): number {
  return glyphKnob("glyph-weight").max;
}

/** Render one glyph the way the server does. */
function markup(name: string, className?: string): string {
  return renderToStaticMarkup(
    createElement(
      Glyph,
      className === undefined ? { name } : {
        name,
        className,
      },
    ),
  );
}

/** A primitive's shapes, or none when the renderer does not know its kind. */
function shapesOf(primitive: GlyphPrimitive): readonly GlyphShape[] {
  const shapes: readonly GlyphShape[] | undefined = drawPrimitive(primitive);
  return shapes ?? [];
}

/** Whether any of a primitive's shapes is drawn as a stroke. */
function stroked(primitive: GlyphPrimitive): boolean {
  return shapesOf(primitive).some((shape) =>
    shape.paint === "outline" || shape.paint === "faint"
  );
}

/** How many different points a list holds. */
function distinctPoints(points: readonly GlyphPoint[]): number {
  return new Set(points.map((point) => point.join(","))).size;
}

/** Whether a primitive draws a triangle: the split mark or any three-cornered shape. */
function drawsTriangle(primitive: GlyphPrimitive): boolean {
  switch (primitive.kind) {
    case "split":
      return true;
    case "poly":
      return distinctPoints(primitive.points) === 3;
    case "trail": {
      const first = primitive.points[0];
      const last = primitive.points.at(-1);
      return first !== undefined && last !== undefined &&
        first.join(",") === last.join(",") &&
        distinctPoints(primitive.points) === 3;
    }
    default:
      return false;
  }
}

/** Why a primitive's own measurements cannot be drawn, if they cannot. */
function malformed(primitive: GlyphPrimitive): string | undefined {
  switch (primitive.kind) {
    case "dot":
    case "ring":
      return primitive.r > 0 ? undefined : "its radius is not positive";
    case "bar":
      return primitive.w > 0 && primitive.h > 0
        ? undefined
        : "it has no width or no height";
    case "frame":
      if (primitive.w <= 0 || primitive.h <= 0) {
        return "it has no width or no height";
      }
      return primitive.corner >= 0 &&
          primitive.corner <= Math.min(primitive.w, primitive.h) / 2
        ? undefined
        : "its corner is larger than half its shorter side";
    case "trail":
      return distinctPoints(primitive.points) >= 2
        ? undefined
        : "it needs two different points";
    case "poly":
      return distinctPoints(primitive.points) >= 3
        ? undefined
        : "it needs three different points";
    case "arc":
    case "sector":
      if (primitive.r <= 0) return "its radius is not positive";
      return primitive.sweep !== 0 && Math.abs(primitive.sweep) < 360
        ? undefined
        : "its sweep must be part of a turn";
    case "band":
      if (primitive.width <= 0 || primitive.width >= 2 * primitive.r) {
        return "its width must be positive and narrower than its circle";
      }
      return primitive.sweep !== 0 && Math.abs(primitive.sweep) <= 360
        ? undefined
        : "its sweep must be at most one turn";
    case "split":
      return primitive.w > 0 && primitive.h > 0
        ? undefined
        : "it has no width or no height";
  }
}

/**
 * Everything wrong with one drawing as the grammar sees it: an unknown
 * primitive, measurements that cannot be drawn, or a shape that leaves the
 * grid at rest or at the end of its hover move.
 */
function drawingProblems(name: string, drawing: GlyphDrawing): string[] {
  const problems: string[] = [];
  const kinds: readonly string[] = GLYPH_PRIMITIVE_KINDS;
  const paints: readonly string[] = GLYPH_PAINTS;
  drawing.forEach((primitive, index) => {
    const where = `${name}[${index}] ${primitive.kind}`;
    const shapes = shapesOf(primitive);
    if (!kinds.includes(primitive.kind) || shapes.length === 0) {
      problems.push(`${where}: not a primitive the grammar draws`);
      return;
    }
    for (const shape of shapes) {
      if (!paints.includes(shape.paint)) {
        problems.push(`${where}: paint "${shape.paint}" is not a glyph paint`);
      }
    }
    const flaw = malformed(primitive);
    if (flaw !== undefined) {
      problems.push(`${where}: ${flaw}`);
      return;
    }
    const extent = primitiveExtent(primitive);
    const margin = stroked(primitive) ? heaviestStroke() / 2 : 0;
    const [dx, dy] = primitive.shift ?? [0, 0];
    const reach = {
      left: extent.minX - margin + Math.min(0, dx),
      top: extent.minY - margin + Math.min(0, dy),
      right: extent.maxX + margin + Math.max(0, dx),
      bottom: extent.maxY + margin + Math.max(0, dy),
    };
    for (const [edge, value] of Object.entries(reach)) {
      if (!Number.isFinite(value) || value < 0 || value > GLYPH_GRID) {
        problems.push(
          `${where}: its ${edge} edge reaches ${value}, outside the ` +
            `${GLYPH_GRID}-unit grid`,
        );
      }
    }
  });
  return problems;
}

Deno.test("every authored glyph is drawn from known primitives inside the grid", () => {
  assert(AUTHORED.length > 0);
  assertEquals(
    AUTHORED.flatMap(([name, drawing]) => drawingProblems(name, drawing)),
    [],
  );
});

Deno.test("authored glyphs are few bold forms, no two alike, and use the whole vocabulary", () => {
  const sizes = AUTHORED.filter(([, drawing]) =>
    drawing.length < 2 || drawing.length > 9
  ).map(([name, drawing]) => `${name} has ${drawing.length} primitives`);
  assertEquals(sizes, [], "a glyph is two to nine primitives");

  const seen = new Map<string, string>();
  const twins: string[] = [];
  for (const [name, drawing] of AUTHORED) {
    const key = JSON.stringify(drawing);
    const twin = seen.get(key);
    if (twin !== undefined) twins.push(`${name} repeats ${twin}`);
    seen.set(key, name);
  }
  assertEquals(twins, []);

  const used = new Set(
    AUTHORED.flatMap(([, drawing]) =>
      drawing.map((primitive) => primitive.kind)
    ),
  );
  assertEquals(
    GLYPH_PRIMITIVE_KINDS.filter((kind) => !used.has(kind)),
    [],
    "every primitive in the vocabulary earns its place in some glyph",
  );
});

Deno.test("the triangle stays a rare accent: at most one glyph in eight draws one", () => {
  const triangles = AUTHORED.map(([name, drawing]) => ({
    name,
    count: drawing.filter(drawsTriangle).length,
  })).filter(({ count }) => count > 0);
  assert(
    triangles.length * 8 <= AUTHORED.length,
    `${triangles.length} of ${AUTHORED.length} glyphs draw a triangle: ${
      triangles.map(({ name }) => name).join(", ")
    }`,
  );
  // One triangle is the mark. Several in one glyph approach the recursive
  // form the brand reserves.
  assertEquals(
    triangles.filter(({ count }) => count > 1).map(({ name }) => name),
    [],
  );
});

Deno.test("at most one primitive of a glyph moves on hover, by a few units", () => {
  const problems: string[] = [];
  for (const [name, drawing] of AUTHORED) {
    const moving = drawing.filter((primitive) => primitive.shift !== undefined);
    if (moving.length > 1) {
      problems.push(`${name} moves ${moving.length} primitives`);
    }
    for (const primitive of moving) {
      const [dx, dy] = primitive.shift ?? [0, 0];
      const longest = Math.max(Math.abs(dx), Math.abs(dy));
      if (longest === 0 || longest > LONGEST_SHIFT) {
        problems.push(`${name} moves a ${primitive.kind} by ${dx}, ${dy}`);
      }
    }
  }
  assertEquals(problems, []);
});

Deno.test("an unknown name always draws the same seeded glyph, never a blank and never a triangle", () => {
  const problems: string[] = [];
  const drawings = new Set<string>();
  for (const name of UNKNOWN_NAMES) {
    assert(!Object.hasOwn(GLYPHS, name));
    const drawing = seededGlyph(name);
    assertEquals(seededGlyph(name), drawing);
    assertEquals(glyphDrawing(name), drawing);
    drawings.add(JSON.stringify(drawing));
    if (drawing.length < 2) problems.push(`"${name}" is nearly blank`);
    if (drawing.some(drawsTriangle)) problems.push(`"${name}" has a triangle`);
    problems.push(...drawingProblems(`seeded "${name}"`, drawing));
  }
  assertEquals(problems, []);
  assert(
    drawings.size > UNKNOWN_NAMES.length / 8,
    `only ${drawings.size} different seeded glyphs for ${UNKNOWN_NAMES.length} names`,
  );
});

Deno.test("a known name draws its authored glyph", () => {
  for (const [name, drawing] of AUTHORED) {
    assertStrictEquals(glyphDrawing(name), drawing);
  }
});

Deno.test("every authored glyph is drawn by a card on the wall", () => {
  const drawn = new Set(
    WALL_DECK.map(cardGlyph).filter((name) => name !== undefined),
  );
  assert(drawn.size > 0, "the wall's benefit cards draw glyphs");
  assertEquals(
    AUTHORED.map(([name]) => name).filter((name) => !drawn.has(name)),
    [],
    "a glyph no card draws ships in the page's script for nothing: remove " +
      "it, or key the card that should draw it",
  );
});

Deno.test("rendering is stable, decorative, and carries only rounded numbers", () => {
  const names = [...AUTHORED.map(([name]) => name), ...UNKNOWN_NAMES];
  const problems: string[] = [];
  for (const name of names) {
    const rendered = markup(name);
    assertEquals(markup(name), rendered, `"${name}" renders the same twice`);
    const opening = `<svg class="wall-glyph" viewBox="0 0 ${GLYPH_GRID} ` +
      `${GLYPH_GRID}" width="${GLYPH_GRID}" height="${GLYPH_GRID}" ` +
      `aria-hidden="true" focusable="false"`;
    if (!rendered.startsWith(opening)) {
      problems.push(`"${name}" does not open as a decorative svg`);
    }
    if (/tabindex|<title|<a[\s>]|href=/.test(rendered)) {
      problems.push(`"${name}" carries something focusable or announced`);
    }
    if ((rendered.match(/<(?:circle|rect|path)\b/g) ?? []).length < 2) {
      problems.push(`"${name}" is nearly blank`);
    }
    const unrounded = rendered.match(
      /\d\.\d{3,}|\d[eE][-+]?\d|NaN|Infinity|undefined/,
    );
    if (unrounded !== null) {
      problems.push(`"${name}" carries the unrounded value ${unrounded[0]}`);
    }
  }
  assertEquals(problems, []);
  assert(
    markup("context-for-the-task", "wall-card-glyph").startsWith(
      '<svg class="wall-glyph wall-card-glyph" ',
    ),
    "a caller's class joins the glyph's own",
  );
});

Deno.test("the grammar serializes primitives exactly", () => {
  assertEquals(drawPrimitive(arc(24, 24, 10, 0, 90)), [{
    el: "path",
    d: "M24 14 A10 10 0 0 1 34 24",
    paint: "outline",
  }]);
  assertEquals(drawPrimitive(sector(24, 24, 20, 180, 180, "tint")), [{
    el: "path",
    d: "M24 24 L24 44 A20 20 0 0 1 24 4 Z",
    paint: "tint",
  }]);
  assertEquals(drawPrimitive(dashed(ring(24, 24, 7))), [{
    el: "circle",
    cx: 24,
    cy: 24,
    r: 7,
    paint: "outline",
    dash: "1.5 4",
  }]);
  assertEquals(drawPrimitive(bar(10, 20, 20, 6, "tint", 45)), [{
    el: "rect",
    x: 10,
    y: 20,
    width: 20,
    height: 6,
    rx: 2.5,
    paint: "tint",
    turn: [45, 20, 23],
  }]);
  // The mark's right half is the solid one.
  assertEquals(drawPrimitive(split(24, 24, 20, 16)), [
    { el: "path", d: "M14 32 L24 32 L24 16 Z", paint: "tint" },
    { el: "path", d: "M24 32 L34 32 L24 16 Z", paint: "solid" },
    { el: "path", d: "M14 32 L34 32 L24 16 Z", paint: "outline" },
  ]);
});

Deno.test("the grammar's own trigonometry agrees with the engine's at every degree", () => {
  const radius = 40;
  const drift: string[] = [];
  for (let degrees = -360; degrees <= 720; degrees++) {
    const [shape] = drawPrimitive(arc(0, 0, radius, degrees, 1));
    assert(shape !== undefined && shape.el === "path");
    const start = /^M(-?[\d.]+) (-?[\d.]+) /.exec(shape.d);
    assert(start !== null, shape.d);
    const radians = degrees * Math.PI / 180;
    const x = radius * Math.sin(radians);
    const y = -radius * Math.cos(radians);
    if (
      Math.abs(Number(start[1]) - x) > 0.0051 ||
      Math.abs(Number(start[2]) - y) > 0.0051
    ) {
      drift.push(`${degrees} degrees: ${start[1]}, ${start[2]}`);
    }
  }
  assertEquals(drift, []);
});

/** The `Math` members whose results the language specifies exactly. */
const EXACT_MATH = new Set([
  "abs",
  "ceil",
  "floor",
  "imul",
  "max",
  "min",
  "round",
]);

Deno.test("glyph modules compute with exact arithmetic and nothing that varies between renders", async () => {
  const sources = await readScopedSources(
    ROOT,
    await structuralGuardScope({
      guard: "tests/site_wall_glyph_test.ts#exact-arithmetic",
      universe: "authored-ts",
      narrow: {
        reason:
          "Only the glyph modules compute numbers that reach hydrated glyph markup.",
        include: (path) => /^site\/wall\/glyph/i.test(path),
      },
    }),
  );
  assert(
    sources.some(({ path }) => path === "site/wall/Glyph.tsx") &&
      sources.some(({ path }) => path === "site/wall/glyph_grammar.ts") &&
      sources.some(({ path }) => path === "site/wall/glyphs.ts"),
    "the renderer, the grammar, and the glyphs are all in scope",
  );
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { noLib: true },
    skipAddingFilesFromTsConfig: true,
  });
  const violations: string[] = [];
  for (const { path, source } of sources) {
    const file = project.createSourceFile(path, source);
    for (
      const access of file.getDescendantsOfKind(
        SyntaxKind.PropertyAccessExpression,
      )
    ) {
      if (
        access.getExpression().getText() === "Math" &&
        !EXACT_MATH.has(access.getName())
      ) {
        violations.push(
          `${path}:${access.getStartLineNumber()}: Math.${access.getName()} ` +
            `may differ between the server and a browser`,
        );
      }
    }
    for (
      const binary of file.getDescendantsOfKind(SyntaxKind.BinaryExpression)
    ) {
      if (
        binary.getOperatorToken().getKind() ===
          SyntaxKind.AsteriskAsteriskToken
      ) {
        violations.push(
          `${path}:${binary.getStartLineNumber()}: ** may differ between ` +
            `the server and a browser; multiply instead`,
        );
      }
    }
    for (const name of file.getDescendantsOfKind(SyntaxKind.Identifier)) {
      if (/^(?:Date|crypto|performance)$/.test(name.getText())) {
        violations.push(
          `${path}:${name.getStartLineNumber()}: ${name.getText()} changes ` +
            `from one render to the next`,
        );
      }
    }
  }
  assertEquals(violations, []);
});

/**
 * A stylesheet with one block cut out: everything before the block's opening
 * line and after its closing brace. Undefined when the sheet has no such block.
 */
function outsideBlock(sheet: string, opening: string): string | undefined {
  const start = sheet.indexOf(opening);
  const open = start < 0 ? -1 : sheet.indexOf("{", start);
  if (open < 0) return undefined;
  let depth = 0;
  for (let index = open; index < sheet.length; index++) {
    if (sheet[index] === "{") depth++;
    if (sheet[index] === "}") depth--;
    if (depth === 0) return sheet.slice(0, start) + sheet.slice(index + 1);
  }
  return undefined;
}

Deno.test("the glyph stylesheet styles everything the renderer emits, in currentColor alone", async () => {
  const sheet = await Deno.readTextFile(
    join(ROOT, "site/page-src/wall-glyph.css"),
  );
  const rendered = [
    ...AUTHORED.map(([name]) => name),
    ...UNKNOWN_NAMES,
  ].map((name) => markup(name)).join("\n");

  const classes = new Set(
    [...rendered.matchAll(/class="([^"]+)"/g)].flatMap((match) =>
      (match[1] ?? "").split(/\s+/)
    ),
  );
  assert(classes.has("wall-glyph") && classes.has("wall-glyph-move"));
  const selectors: readonly string[] = GLYPH_PAINTS.map((paint) =>
    `wall-glyph-${paint}`
  );
  assertEquals(
    [...new Set([...classes, ...selectors])].filter((name) =>
      !new RegExp(`\\.${name}(?![\\w-])`).test(sheet)
    ),
    [],
    "every class a glyph carries has a rule",
  );

  const written = new Set(
    [...rendered.matchAll(/(--wall-glyph-[a-z-]+):/g)].map((match) => match[1]),
  );
  assert(written.size > 0);
  const read = new Set(
    [...sheet.matchAll(/var\((--wall-glyph-[a-z-]+)\)/g)].map((match) =>
      match[1]
    ),
  );
  assertEquals(
    [...written].filter((property) => !read.has(property)),
    [],
    "the stylesheet reads each property a moving primitive carries",
  );
  for (const property of ["--wall-glyph-weight", "--wall-glyph-tint"]) {
    assert(read.has(property), `${property} sets the glyph's ${property}`);
  }

  for (const state of ["hover", "focus-within"]) {
    assert(
      sheet.includes(`.wall-card:${state} .wall-glyph-move`),
      `a glyph moves while its own card matches :${state}`,
    );
  }
  const still = outsideBlock(
    sheet,
    "@media (prefers-reduced-motion: no-preference)",
  );
  assert(
    still !== undefined,
    "the sheet scopes motion to readers who allow it",
  );
  assertEquals(
    still.match(/\b(?:transform|transition|animation)[a-z-]*\s*:/g) ?? [],
    [],
    "a glyph moves only for a reader who has not asked for reduced motion",
  );
  assertEquals(
    sheet.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab|lab|lch)a?\(/gi) ??
      [],
    [],
    "a glyph takes its color from currentColor",
  );
  assert(sheet.includes("currentColor"));
});

/** How the glyph stylesheet paints a glyph at the shipped knob values. */
interface GlyphOptics {
  /** The stroke's width, in grid units. */
  readonly weight: number;
  /** The opacity of a tinted fill. */
  readonly tint: number;
  /** The opacity of a tinted stroke. */
  readonly faint: number;
}

/**
 * The optics the wall ships with: the two knob defaults, and the step the
 * stylesheet takes from a tinted fill to a tinted stroke.
 */
async function shippedOptics(): Promise<GlyphOptics> {
  const sheet = await Deno.readTextFile(
    join(ROOT, "site/page-src/wall-glyph.css"),
  );
  const step =
    /stroke-opacity:\s*calc\(\s*var\(--wall-glyph-tint\)\s*\*\s*([\d.]+)\s*\)/
      .exec(sheet);
  assert(
    step !== null,
    "the stylesheet sets a tinted stroke as a multiple of the tint",
  );
  const tint = glyphKnob("glyph-tint").default;
  return {
    weight: glyphKnob("glyph-weight").default,
    tint,
    faint: Math.min(1, tint * Number(step[1])),
  };
}

/** Points measured along each side of the grid: two to a grid unit. */
const SAMPLES = GLYPH_GRID * 2;

/** The share of its ink a dashed stroke lays down, gaps counted. */
const DASHED_SHARE = 0.5;

/** The least opacity that counts as ink when a glyph's extent is measured. */
const FIRM_INK = 0.15;

/** The opacity of a filled area in one tone. */
function fillInk(tone: "solid" | "tint", optics: GlyphOptics): number {
  return tone === "solid" ? 1 : optics.tint;
}

/** The opacity of a stroke in one tone, whole or dashed. */
function strokeInk(
  tone: "outline" | "tint",
  dashed: boolean,
  optics: GlyphOptics,
): number {
  return (tone === "tint" ? optics.faint : 1) * (dashed ? DASHED_SHARE : 1);
}

/** A point's bearing from a center, in degrees clockwise from twelve o'clock. */
function bearing(x: number, y: number, cx: number, cy: number): number {
  return (Math.atan2(x - cx, cy - y) * 180 / Math.PI + 360) % 360;
}

/** Whether a bearing falls inside a sweep that starts at `from`. */
function inSweep(angle: number, from: number, sweep: number): boolean {
  const start = sweep >= 0 ? from : from + sweep;
  return (((angle - start) % 360) + 360) % 360 <= Math.abs(sweep);
}

/** The point on a circle at a bearing. */
function onRim(
  cx: number,
  cy: number,
  r: number,
  degrees: number,
): GlyphPoint {
  const radians = degrees * Math.PI / 180;
  return [cx + r * Math.sin(radians), cy - r * Math.cos(radians)];
}

/** A point turned back through a rotation about a center. */
function unturned(
  x: number,
  y: number,
  degrees: number,
  cx: number,
  cy: number,
): GlyphPoint {
  const radians = -degrees * Math.PI / 180;
  const dx = x - cx;
  const dy = y - cy;
  return [
    cx + dx * Math.cos(radians) - dy * Math.sin(radians),
    cy + dx * Math.sin(radians) + dy * Math.cos(radians),
  ];
}

/** The distance from a point to the segment between two points. */
function toSegment(
  x: number,
  y: number,
  from: GlyphPoint,
  to: GlyphPoint,
): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = dx * dx + dy * dy;
  const along = length === 0 ? 0 : Math.max(
    0,
    Math.min(1, ((x - from[0]) * dx + (y - from[1]) * dy) / length),
  );
  return Math.hypot(x - from[0] - along * dx, y - from[1] - along * dy);
}

/** The distance from a point to a line through each point in turn. */
function toLine(
  x: number,
  y: number,
  points: readonly GlyphPoint[],
  closed: boolean,
): number {
  let nearest = Infinity;
  points.forEach((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    if (previous === undefined || (index === 0 && !closed)) return;
    nearest = Math.min(nearest, toSegment(x, y, previous, point));
  });
  return nearest;
}

/** Whether a point lies inside a closed shape. */
function insideShape(
  x: number,
  y: number,
  points: readonly GlyphPoint[],
): boolean {
  let inside = false;
  points.forEach((point, index) => {
    const previous = points[(index + points.length - 1) % points.length];
    if (previous === undefined) return;
    const crosses = (point[1] > y) !== (previous[1] > y) &&
      x <
        (previous[0] - point[0]) * (y - point[1]) / (previous[1] - point[1]) +
          point[0];
    if (crosses) inside = !inside;
  });
  return inside;
}

/** The distance from a point to part of a circle's rim. */
function toArc(
  x: number,
  y: number,
  arc: {
    readonly cx: number;
    readonly cy: number;
    readonly r: number;
    readonly from: number;
    readonly sweep: number;
  },
): number {
  const { cx, cy, r, from, sweep } = arc;
  if (Math.abs(sweep) >= 360 || inSweep(bearing(x, y, cx, cy), from, sweep)) {
    return Math.abs(Math.hypot(x - cx, y - cy) - r);
  }
  return Math.min(
    ...[from, from + sweep].map((end) => {
      const [ex, ey] = onRim(cx, cy, r, end);
      return Math.hypot(x - ex, y - ey);
    }),
  );
}

/**
 * How far a point is outside a box with rounded corners; negative inside it.
 * The box is the one the grammar draws for a bar or a frame, turn undone.
 */
function outsideBox(
  x: number,
  y: number,
  primitive: Extract<GlyphPrimitive, { kind: "bar" | "frame" }>,
): number {
  const [shape] = shapesOf(primitive);
  assert(shape !== undefined && shape.el === "rect");
  const cx = primitive.x + primitive.w / 2;
  const cy = primitive.y + primitive.h / 2;
  const [px, py] = unturned(x, y, primitive.turn, cx, cy);
  const farX = Math.abs(px - cx) - (primitive.w / 2 - shape.rx);
  const farY = Math.abs(py - cy) - (primitive.h / 2 - shape.rx);
  return Math.hypot(Math.max(farX, 0), Math.max(farY, 0)) +
    Math.min(Math.max(farX, farY), 0) - shape.rx;
}

/**
 * The opacity one primitive lays on a point of the grid. It is measured from
 * the primitive's own geometry, the way the stylesheet paints it at rest.
 */
function primitiveInk(
  primitive: GlyphPrimitive,
  x: number,
  y: number,
  optics: GlyphOptics,
): number {
  const half = optics.weight / 2;
  switch (primitive.kind) {
    case "dot":
      return Math.hypot(x - primitive.cx, y - primitive.cy) <= primitive.r
        ? fillInk(primitive.tone, optics)
        : 0;
    case "ring":
      return toArc(x, y, { ...primitive, from: 0, sweep: 360 }) <= half
        ? strokeInk("outline", primitive.dashed === true, optics)
        : 0;
    case "bar":
      return outsideBox(x, y, primitive) <= 0
        ? fillInk(primitive.tone, optics)
        : 0;
    case "frame":
      return Math.abs(outsideBox(x, y, primitive)) <= half
        ? strokeInk("outline", primitive.dashed === true, optics)
        : 0;
    case "trail":
      return toLine(x, y, primitive.points, false) <= half
        ? strokeInk(primitive.tone, primitive.dashed === true, optics)
        : 0;
    case "arc":
      return toArc(x, y, primitive) <= half
        ? strokeInk(primitive.tone, primitive.dashed === true, optics)
        : 0;
    case "band":
      return toArc(x, y, primitive) <= primitive.width / 2
        ? fillInk(primitive.tone, optics)
        : 0;
    case "sector": {
      const { cx, cy, r, from, sweep } = primitive;
      if (primitive.tone !== "outline") {
        return Math.hypot(x - cx, y - cy) <= r &&
            inSweep(bearing(x, y, cx, cy), from, sweep)
          ? fillInk(primitive.tone, optics)
          : 0;
      }
      const edge = Math.min(
        toArc(x, y, primitive),
        toSegment(x, y, [cx, cy], onRim(cx, cy, r, from)),
        toSegment(x, y, [cx, cy], onRim(cx, cy, r, from + sweep)),
      );
      return edge <= half ? 1 : 0;
    }
    case "poly":
      if (primitive.tone === "outline") {
        return toLine(x, y, primitive.points, true) <= half ? 1 : 0;
      }
      return insideShape(x, y, primitive.points)
        ? fillInk(primitive.tone, optics)
        : 0;
    case "split": {
      const { cx, cy, w, h } = primitive;
      const [px, py] = unturned(x, y, primitive.turn, cx, cy);
      const corners: readonly GlyphPoint[] = [
        [cx - w / 2, cy + h / 2],
        [cx + w / 2, cy + h / 2],
        [cx, cy - h / 2],
      ];
      if (toLine(px, py, corners, true) <= half) return 1;
      if (!insideShape(px, py, corners)) return 0;
      return fillInk(px >= cx ? "solid" : "tint", optics);
    }
  }
}

/**
 * A glyph's ink at rest: the opacity it lays on each of `SAMPLES` by
 * `SAMPLES` points across the grid, row by row, later primitives painted over
 * earlier ones.
 */
function inkMap(drawing: GlyphDrawing, optics: GlyphOptics): Float64Array {
  const map = new Float64Array(SAMPLES * SAMPLES);
  const step = GLYPH_GRID / SAMPLES;
  for (let row = 0; row < SAMPLES; row++) {
    for (let column = 0; column < SAMPLES; column++) {
      const x = (column + 0.5) * step;
      const y = (row + 0.5) * step;
      let bare = 1;
      for (const primitive of drawing) {
        bare *= 1 - primitiveInk(primitive, x, y, optics);
      }
      map[row * SAMPLES + column] = 1 - bare;
    }
  }
  return map;
}

/** The share of the grid a glyph inks, a tinted area counted by its opacity. */
function inkShare(map: Float64Array): number {
  return map.reduce((sum, ink) => sum + ink, 0) / map.length;
}

/** The box around everything a glyph inks firmly, in grid units, if it inks anything. */
function inkBox(map: Float64Array): GlyphExtent | undefined {
  const step = GLYPH_GRID / SAMPLES;
  let box: GlyphExtent | undefined;
  map.forEach((ink, index) => {
    if (ink <= FIRM_INK) return;
    const column = index % SAMPLES;
    const row = (index - column) / SAMPLES;
    box = {
      minX: Math.min(box?.minX ?? Infinity, column * step),
      minY: Math.min(box?.minY ?? Infinity, row * step),
      maxX: Math.max(box?.maxX ?? -Infinity, (column + 1) * step),
      maxY: Math.max(box?.maxY ?? -Infinity, (row + 1) * step),
    };
  });
  return box;
}

/** Cells along each side of the coarse picture two glyphs are compared by. */
const SILHOUETTE_CELLS = 8;

/** A glyph's ink as a coarse picture: the mean opacity of each cell, row by row. */
function silhouette(map: Float64Array): number[] {
  const side = SAMPLES / SILHOUETTE_CELLS;
  const cells = new Array<number>(SILHOUETTE_CELLS * SILHOUETTE_CELLS).fill(0);
  map.forEach((ink, index) => {
    const column = index % SAMPLES;
    const row = (index - column) / SAMPLES;
    const cell = Math.floor(row / side) * SILHOUETTE_CELLS +
      Math.floor(column / side);
    cells[cell] = (cells[cell] ?? 0) + ink / (side * side);
  });
  return cells;
}

/** The share of two silhouettes' ink that falls in the same cells, from 0 to 1. */
function likeness(one: readonly number[], other: readonly number[]): number {
  let shared = 0;
  let either = 0;
  one.forEach((ink, index) => {
    const against = other[index] ?? 0;
    shared += Math.min(ink, against);
    either += Math.max(ink, against);
  });
  return either === 0 ? 1 : shared / either;
}

/**
 * The separate bands a glyph's ink falls into along one axis, as each band's
 * length in grid units. Bands are separate when a clear line runs between them.
 */
function inkBands(map: Float64Array, axis: "rows" | "columns"): number[] {
  const bands: number[] = [];
  let run = 0;
  for (let line = 0; line < SAMPLES; line++) {
    let ink = 0;
    for (let across = 0; across < SAMPLES; across++) {
      ink += map[
        axis === "rows" ? line * SAMPLES + across : across * SAMPLES + line
      ] ?? 0;
    }
    if (ink / SAMPLES > 0.03) {
      run++;
      continue;
    }
    if (run > 0) bands.push(run * GLYPH_GRID / SAMPLES);
    run = 0;
  }
  if (run > 0) bands.push(run * GLYPH_GRID / SAMPLES);
  return bands;
}

/**
 * How far a turned box's rounded corners stop short of the box the grammar
 * reserves for it, which is measured to the corners before they are rounded.
 */
function roundedAway(primitive: GlyphPrimitive): number {
  if (primitive.kind !== "bar" && primitive.kind !== "frame") return 0;
  const [shape] = shapesOf(primitive);
  assert(shape !== undefined && shape.el === "rect");
  const radians = primitive.turn * Math.PI / 180;
  return shape.rx *
    (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)) - 1);
}

/** A number as a measurement reads in a failure message. */
function shown(value: number): string {
  return value.toFixed(2);
}

Deno.test("the ink measure sees each primitive where the grammar draws it", async () => {
  const optics = await shippedOptics();
  const drawings = [
    ...AUTHORED,
    ...UNKNOWN_NAMES.slice(0, 40).map((name) =>
      [`seeded "${name}"`, seededGlyph(name)] as const
    ),
  ];
  const kinds = new Set<string>();
  const strays: string[] = [];
  for (const [name, drawing] of drawings) {
    drawing.forEach((primitive, index) => {
      kinds.add(primitive.kind);
      const box = inkBox(inkMap([primitive], optics));
      const extent = primitiveExtent(primitive);
      const margin = stroked(primitive) ? optics.weight / 2 : 0;
      const slack = 1 + roundedAway(primitive);
      const edges: readonly (readonly [string, number, number])[] = [
        ["left", box?.minX ?? NaN, extent.minX - margin],
        ["top", box?.minY ?? NaN, extent.minY - margin],
        ["right", box?.maxX ?? NaN, extent.maxX + margin],
        ["bottom", box?.maxY ?? NaN, extent.maxY + margin],
      ];
      for (const [edge, measured, drawn] of edges) {
        if (!(Math.abs(measured - drawn) <= slack)) {
          strays.push(
            `${name}[${index}] ${primitive.kind}: its ${edge} edge measures ` +
              `${shown(measured)}, and the grammar draws it at ${shown(drawn)}`,
          );
        }
      }
    });
  }
  assertEquals(strays, []);
  assertEquals(
    GLYPH_PRIMITIVE_KINDS.filter((kind) => !kinds.has(kind)),
    [],
    "the measure is checked against every kind of primitive",
  );
});

/**
 * The share of the grid a glyph may ink. Below the range a glyph looks faint
 * beside its neighbors on the wall; above it, heavy.
 */
const INK_SHARE = { least: 0.16, most: 0.42 } as const;

/** The least a glyph's firm ink may span: one way, then the other. */
const INK_SPAN = { longer: 38, shorter: 24 } as const;

Deno.test("every glyph carries a like weight of ink and fills its grid", async () => {
  const optics = await shippedOptics();
  const drawings = [
    ...AUTHORED,
    ...UNKNOWN_NAMES.map((name) =>
      [`seeded "${name}"`, seededGlyph(name)] as const
    ),
  ];
  const problems: string[] = [];
  for (const [name, drawing] of drawings) {
    const map = inkMap(drawing, optics);
    const share = inkShare(map);
    if (share < INK_SHARE.least) {
      problems.push(
        `${name} inks ${shown(share)} of the grid, under ` +
          `${INK_SHARE.least}: give it mass with a larger form, a solid in ` +
          `place of a tint, or a fill under an outline`,
      );
    }
    if (share > INK_SHARE.most) {
      problems.push(
        `${name} inks ${shown(share)} of the grid, over ${INK_SHARE.most}: ` +
          `shrink a form or turn a solid into a tint`,
      );
    }
    const box = inkBox(map);
    const wide = box === undefined ? 0 : box.maxX - box.minX;
    const tall = box === undefined ? 0 : box.maxY - box.minY;
    if (
      Math.max(wide, tall) < INK_SPAN.longer ||
      Math.min(wide, tall) < INK_SPAN.shorter
    ) {
      problems.push(
        `${name} spans ${shown(wide)} by ${shown(tall)} of the ` +
          `${GLYPH_GRID}-unit grid: a glyph spans at least ` +
          `${INK_SPAN.longer} one way and ${INK_SPAN.shorter} the other`,
      );
    }
  }
  assertEquals(problems, []);
});

/** The most of their ink two authored glyphs may lay in the same places. */
const MOST_ALIKE = 0.72;

Deno.test("no two authored glyphs share a silhouette", async () => {
  const optics = await shippedOptics();
  const pictures = AUTHORED.map(([name, drawing]) =>
    [name, silhouette(inkMap(drawing, optics))] as const
  );
  const twins: string[] = [];
  pictures.forEach(([name, picture], index) => {
    for (const [other, against] of pictures.slice(index + 1)) {
      const alike = likeness(picture, against);
      if (alike > MOST_ALIKE) {
        twins.push(
          `${name} and ${other} lay ${shown(alike)} of their ink in the ` +
            `same places, over ${MOST_ALIKE}: at card size they read as ` +
            `one glyph`,
        );
      }
    }
  });
  assertEquals(twins, []);
});

/** How much of the grid a frame spans, each way, to enclose the whole glyph. */
const ENCLOSING_FRAME = GLYPH_GRID * 3 / 4;

/** Whether a glyph sits inside one frame drawn around the whole grid. */
function enclosed(drawing: GlyphDrawing): boolean {
  return drawing.some((primitive) =>
    primitive.kind === "frame" && primitive.w >= ENCLOSING_FRAME &&
    primitive.h >= ENCLOSING_FRAME
  );
}

/** Whether a glyph's ink is three or more rows with clear lines between them, and not a grid. */
function stackedRows(map: Float64Array): boolean {
  return inkBands(map, "rows").length >= 3 &&
    inkBands(map, "columns").length < 3;
}

/** The most authored glyphs that may be a stack of three or more rows. */
const MOST_ROW_STACKS = 3;

Deno.test("no one device carries a family of authored glyphs", async () => {
  const optics = await shippedOptics();
  const problems: string[] = [];
  const framed = AUTHORED.filter(([, drawing]) => enclosed(drawing)).map((
    [name],
  ) => name);
  if (framed.length > 1) {
    problems.push(
      `${framed.length} glyphs sit inside a frame around the whole grid, ` +
        `and at card size the frame is all that is seen of them: ` +
        framed.join(", "),
    );
  }
  const rows = AUTHORED.filter(([, drawing]) =>
    stackedRows(inkMap(drawing, optics))
  ).map(([name]) => name);
  if (rows.length > MOST_ROW_STACKS) {
    problems.push(
      `${rows.length} glyphs are a stack of three or more rows, over ` +
        `${MOST_ROW_STACKS}; they read as one list glyph repeated: ` +
        rows.join(", "),
    );
  }
  assertEquals(problems, []);
});
