/**
 * The wall's glyph system holds together: every drawing stays inside the
 * grammar and the grid, an unknown name always draws the same seeded glyph,
 * the markup is stable enough to hydrate, and the triangle stays a rare accent.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Project, SyntaxKind } from "ts-morph";
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
const LONGEST_SHIFT = 4;

/** The heaviest stroke the tuning panel can set, in grid units. */
function heaviestStroke(): number {
  const knob = WALL_KNOBS.find((candidate) =>
    candidate.name === "glyph-weight"
  );
  assert(knob !== undefined, "the glyph-weight knob sets the glyph stroke");
  return knob.max;
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
  assertEquals(
    sheet.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab|lab|lch)a?\(/gi) ??
      [],
    [],
    "a glyph takes its color from currentColor",
  );
  assert(sheet.includes("currentColor"));
});
