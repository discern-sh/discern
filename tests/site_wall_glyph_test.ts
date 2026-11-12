/**
 * The wall's glyph system holds together: every drawing stays inside the
 * grammar and the grid, an unknown name always draws the same seeded glyph,
 * the markup is stable enough to hydrate, and the triangle stays a rare accent.
 *
 * The set also has to read as one family at the size it is shown. Each glyph
 * is measured as the ink it lays on the grid, so that none is faint, none
 * leaves a side of its grid empty, no two share a silhouette, and no single
 * device is leaned on by several glyphs. A dashed stroke carries enough ink to
 * be seen. Every authored glyph belongs to a card on the wall.
 *
 * A glyph's one move belongs to its card's light: the glyph is posed exactly
 * where the card stylesheet lights the card, and wherever else a lit card's
 * glyph is drawn. The primitive that moves is drawn in a box of its own, laid
 * over the rest, and the stylesheet moves that box: it rests on a move of
 * nothing, it is done before the card's face steps back down among the other
 * cards, and nothing drawn after it in its glyph crosses its path.
 */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
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
  gridShare,
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
import {
  MOTION_PROPERTY,
  movesByChoice,
  readWallSheet,
  styleRules,
} from "./wall_stylesheets.ts";

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

/** One of the two knobs the glyph stylesheet reads. */
function glyphKnob(
  name: "glyph-weight" | "glyph-tint",
): (typeof WALL_KNOBS)[number] {
  const knob = WALL_KNOBS.find((candidate) => candidate.name === name);
  assert(knob !== undefined, `the ${name} knob styles the glyphs`);
  return knob;
}

/** The glyph stylesheet, as the wall ships it. */
const GLYPH_SHEET = await readWallSheet("wall-glyph.css");

/**
 * The number the glyph stylesheet multiplies a knob by where it sets a
 * property: a declaration of the form `calc(var(--wall-glyph-<knob>) * n)`.
 */
function sheetFactor(property: string, knob: string): number {
  const found = new RegExp(
    `${property}:\\s*calc\\(\\s*var\\(--wall-glyph-${knob}\\)\\s*\\*\\s*([\\d.]+)\\s*\\)`,
  ).exec(GLYPH_SHEET);
  assert(
    found !== null,
    `the stylesheet sets ${property} as a multiple of the ${knob} knob`,
  );
  return Number(found[1]);
}

/** How much heavier than a whole stroke the stylesheet draws a dashed one. */
function dashedWeight(): number {
  return sheetFactor("stroke-width", "weight");
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

/** A dashed primitive's pattern as the grammar writes it: a dash, then a gap. */
function dashPattern(
  primitive: GlyphPrimitive,
): readonly [drawn: number, gap: number] | undefined {
  const dash = shapesOf(primitive).find((shape) => shape.dash !== undefined)
    ?.dash;
  if (dash === undefined) return undefined;
  const [drawn = NaN, gap = NaN] = dash.split(" ").map(Number);
  return [drawn, gap];
}

/**
 * How a primitive's stroke is laid when a whole stroke is `weight` wide: its
 * own width, and the share of its length that carries ink. A dash's round
 * caps extend it by the stroke's width.
 */
function strokeOf(
  primitive: GlyphPrimitive,
  weight: number,
): { readonly width: number; readonly share: number } {
  const pattern = dashPattern(primitive);
  if (pattern === undefined) return { width: weight, share: 1 };
  const width = weight * dashedWeight();
  const [drawn, gap] = pattern;
  return { width, share: Math.min(1, (drawn + width) / (drawn + gap)) };
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
 * The box a primitive's ink stays inside: its geometry, half its stroke at the
 * heaviest weight, and the whole of its hover move when it has one.
 */
function reach(primitive: GlyphPrimitive): GlyphExtent {
  const extent = primitiveExtent(primitive);
  const margin = stroked(primitive)
    ? strokeOf(primitive, glyphKnob("glyph-weight").max).width / 2
    : 0;
  const [dx, dy] = primitive.shift ?? [0, 0];
  return {
    minX: extent.minX - margin + Math.min(0, dx),
    minY: extent.minY - margin + Math.min(0, dy),
    maxX: extent.maxX + margin + Math.max(0, dx),
    maxY: extent.maxY + margin + Math.max(0, dy),
  };
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
    const box = reach(primitive);
    const edges = {
      left: box.minX,
      top: box.minY,
      right: box.maxX,
      bottom: box.maxY,
    };
    for (const [edge, value] of Object.entries(edges)) {
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

/** An element's tag and classes, as `tag.class.class`. */
function shape(element: Element): string {
  return [element.tagName.toLowerCase(), ...element.classList].join(".");
}

/** How many shapes an element draws. */
function shapeCount(element: Element): number {
  return element.querySelectorAll("circle, rect, path").length;
}

/** Every name a glyph is rendered for here: the authored ones, and unknown ones. */
const RENDERED_NAMES = [...AUTHORED.map(([name]) => name), ...UNKNOWN_NAMES];

/**
 * Render every glyph the way the server does, into one document, and hand
 * `check` each glyph's root element beside its name and its drawing.
 */
function eachRendered(
  check: (root: Element, name: string, drawing: GlyphDrawing) => void,
): void {
  const dom = new JSDOM(
    `<main>${RENDERED_NAMES.map((name) => markup(name)).join("")}</main>`,
  );
  try {
    const roots = [...dom.window.document.querySelectorAll("main > *")];
    assertEquals(
      roots.length,
      RENDERED_NAMES.length,
      "a glyph renders one element",
    );
    RENDERED_NAMES.forEach((name, index) => {
      const root = roots[index];
      assert(root !== undefined);
      check(root, name, glyphDrawing(name));
    });
  } finally {
    dom.window.close();
  }
}

Deno.test("rendering is stable, decorative, and carries only rounded numbers", () => {
  const problems: string[] = [];
  for (const name of RENDERED_NAMES) {
    const rendered = markup(name);
    assertEquals(markup(name), rendered, `"${name}" renders the same twice`);
    if (/tabindex|<title|<a[\s>]|href=/.test(rendered)) {
      problems.push(`"${name}" carries something focusable or announced`);
    }
    const unrounded = rendered.match(
      /\d\.\d{3,}|\d[eE][-+]?\d|NaN|Infinity|undefined/,
    );
    if (unrounded !== null) {
      problems.push(`"${name}" carries the unrounded value ${unrounded[0]}`);
    }
  }
  const side = String(GLYPH_GRID);
  eachRendered((root, name) => {
    if (
      shape(root) !== "span.wall-glyph" ||
      root.getAttribute("aria-hidden") !== "true" ||
      root.getAttribute("data-glyph") !== name
    ) {
      problems.push(`"${name}" is not one decorative box named for its glyph`);
    }
    for (const drawing of root.children) {
      if (
        drawing.tagName.toLowerCase() !== "svg" ||
        drawing.getAttribute("viewBox") !== `0 0 ${side} ${side}` ||
        drawing.getAttribute("width") !== side ||
        drawing.getAttribute("height") !== side ||
        drawing.getAttribute("focusable") !== "false"
      ) {
        problems.push(`"${name}" holds something other than a whole drawing`);
      }
    }
    if (shapeCount(root) < 2) problems.push(`"${name}" is nearly blank`);
  });
  assertEquals(problems, []);
  assert(
    markup("context-for-the-task", "wall-card-glyph").startsWith(
      '<span class="wall-glyph wall-card-glyph" ',
    ),
    "a caller's class joins the glyph's own",
  );
});

Deno.test("still primitives share one drawing, and a travelling one has a drawing of its own over it", () => {
  const problems: string[] = [];
  let travelling = 0;
  eachRendered((root, name, drawing) => {
    const still = drawing.filter((primitive) => primitive.shift === undefined);
    const moving = drawing.filter((primitive) => primitive.shift !== undefined);
    travelling += moving.length;
    const [art, ...over] = root.children;
    assertEquals(
      [...root.children].map(shape),
      ["svg.wall-glyph-art", ...moving.map(() => "svg.wall-glyph-move")],
      `"${name}" draws its still primitives first, then each travelling one`,
    );
    assert(art !== undefined);
    if (shapeCount(art) !== still.flatMap(shapesOf).length) {
      problems.push(`"${name}" does not draw every still primitive once`);
    }
    if (art.hasAttribute("style")) {
      problems.push(`"${name}" gives its still drawing a distance to travel`);
    }
    moving.forEach((primitive, index) => {
      const drawn = over[index];
      const [dx, dy] = primitive.shift ?? [NaN, NaN];
      if (
        drawn === undefined ||
        shapeCount(drawn) !== shapesOf(primitive).length
      ) {
        problems.push(
          `"${name}" does not draw its travelling ${primitive.kind}`,
        );
      }
      // The distance is a share of the drawing's own side, so the stylesheet
      // moves a glyph of any size by the same number of grid units.
      if (
        drawn?.getAttribute("style") !==
          `--wall-glyph-dx:${gridShare(dx)}%;--wall-glyph-dy:${gridShare(dy)}%`
      ) {
        problems.push(
          `"${name}" does not hand the stylesheet its ${primitive.kind}'s ` +
            `travel: ${drawn?.getAttribute("style")}`,
        );
      }
      for (const units of [dx, dy]) {
        const back = gridShare(units) * GLYPH_GRID / 100;
        if (!(Math.abs(back - units) <= 0.003)) {
          problems.push(
            `"${name}" travels ${shown(back)} grid units where its drawing ` +
              `says ${units}`,
          );
        }
      }
    });
  });
  assert(travelling > 0, "some glyph has a primitive that travels");
  assertEquals(problems, []);
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
    dash: "2.2 6.6",
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
 * Each place a stylesheet moves something for every reader, whether or not
 * that reader asked for reduced motion.
 */
function movesUnasked(sheet: string): string[] {
  return styleRules(sheet).filter((rule) => !movesByChoice(rule)).flatMap((
    rule,
  ) =>
    rule.declarations.filter(([property]) => MOTION_PROPERTY.test(property))
      .map(([property]) => `${rule.selectors.join(", ")} { ${property} }`)
  );
}

Deno.test("a glyph moves only for a reader who has not asked for reduced motion", () => {
  assert(
    styleRules(GLYPH_SHEET).some(movesByChoice),
    "the sheet scopes motion to readers who allow it",
  );
  assertEquals(movesUnasked(GLYPH_SHEET), []);

  // The check sees every way a stylesheet can move a box, and passes each
  // one where the reader allows it.
  const ways = [
    "transform",
    "translate",
    "rotate",
    "scale",
    "offset-path",
    "offset-distance",
    "will-change",
    "transition",
    "transition-duration",
    "animation",
    "animation-name",
  ];
  for (const property of ways) {
    const rule = `.moved { ${property}: initial; }`;
    assertEquals(
      movesUnasked(rule),
      [`.moved { ${property} }`],
      `${property} outside the reader's choice is seen`,
    );
    assertEquals(
      movesUnasked(
        `@media (prefers-reduced-motion: no-preference) { ${rule} }`,
      ),
      [],
      `${property} inside the reader's choice is allowed`,
    );
  }
  assertEquals(
    movesUnasked(".still { inset: 0; opacity: 1; transform-origin: center; }"),
    [],
    "a property that moves nothing is left alone",
  );
});

Deno.test("the glyph stylesheet styles everything the renderer emits, in currentColor alone", () => {
  const sheet = GLYPH_SHEET;
  const rendered = [
    ...AUTHORED.map(([name]) => name),
    ...UNKNOWN_NAMES,
  ].map((name) => markup(name)).join("\n");

  const classes = new Set(
    [...rendered.matchAll(/class="([^"]+)"/g)].flatMap((match) =>
      (match[1] ?? "").split(/\s+/)
    ),
  );
  assert(
    ["wall-glyph", "wall-glyph-art", "wall-glyph-move", "wall-glyph-dashed"]
      .every((name) => classes.has(name)),
    "the set draws a moving primitive and a dashed one",
  );
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

  assertEquals(
    sheet.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl|oklch|oklab|lab|lch)a?\(/gi) ??
      [],
    [],
    "a glyph takes its color from currentColor",
  );
  assert(sheet.includes("currentColor"));
});

/** A number as a measurement reads in a failure message. */
function shown(value: number): string {
  return value.toFixed(2);
}
