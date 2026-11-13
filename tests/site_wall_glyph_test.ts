/** Glyph data, deterministic rendering, decorative accessibility, and reduced motion. */
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
  GLYPH_PAINTS,
  GLYPH_PRIMITIVE_KINDS,
  type GlyphDrawing,
  type GlyphPoint,
  type GlyphPrimitive,
  type GlyphShape,
  ring,
  sector,
  seededGlyph,
  split,
} from "../site/wall/glyph_grammar.ts";
import { glyphDrawing, GLYPHS } from "../site/wall/glyphs.ts";
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
  "unknown-card-one",
  "unknown-card-two",
  "unknown-card-three",
];

/** The glyph stylesheet, as the wall ships it. */
const GLYPH_SHEET = await readWallSheet("wall-glyph.css");

/** Render one glyph the way the server does. */
function markup(name: string): string {
  return renderToStaticMarkup(createElement(Glyph, { name }));
}

/** A primitive's shapes, or none when the renderer does not know its kind. */
function shapesOf(primitive: GlyphPrimitive): readonly GlyphShape[] {
  const shapes: readonly GlyphShape[] | undefined = drawPrimitive(primitive);
  return shapes ?? [];
}

/** How many different points a list holds. */
function distinctPoints(points: readonly GlyphPoint[]): number {
  return new Set(points.map((point) => point.join(","))).size;
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
      return primitive.corner >= 0 ? undefined : "its corner is negative";
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

/** Every numeric input to a drawing must be finite. */
function finite(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finite);
  if (value !== null && typeof value === "object") {
    return Object.values(value).every(finite);
  }
  return true;
}

/** Unknown primitives, unusable dimensions, or non-finite drawing data. */
function drawingProblems(name: string, drawing: GlyphDrawing): string[] {
  const problems: string[] = [];
  const kinds: readonly string[] = GLYPH_PRIMITIVE_KINDS;
  const paints: readonly string[] = GLYPH_PAINTS;
  if (drawing.length === 0) problems.push(`${name}: no drawing`);
  drawing.forEach((primitive, index) => {
    const where = `${name}[${index}] ${primitive.kind}`;
    const shapes = shapesOf(primitive);
    if (!kinds.includes(primitive.kind) || shapes.length === 0) {
      problems.push(`${where}: not a primitive the grammar draws`);
      return;
    }
    if (!finite(primitive) || !finite(shapes)) {
      problems.push(`${where}: a drawing value is not finite`);
    }
    if (shapes.some((shape) => !paints.includes(shape.paint))) {
      problems.push(`${where}: an unknown glyph paint`);
    }
    const flaw = malformed(primitive);
    if (flaw !== undefined) problems.push(`${where}: ${flaw}`);
  });
  return problems;
}

Deno.test("every authored glyph has valid drawing data", () => {
  assert(AUTHORED.length > 0);
  assertEquals(
    AUTHORED.flatMap(([name, drawing]) => drawingProblems(name, drawing)),
    [],
  );
});

Deno.test("an unknown name returns a stable nonempty seeded glyph", () => {
  for (const name of UNKNOWN_NAMES) {
    assert(!Object.hasOwn(GLYPHS, name));
    const drawing = seededGlyph(name);
    assertEquals(seededGlyph(name), drawing);
    assertEquals(glyphDrawing(name), drawing);
    assertEquals(drawingProblems(`seeded "${name}"`, drawing), []);
  }
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

/** Every authored drawing and representative fallback names render decoratively. */
Deno.test("glyph rendering is stable, nonempty, finite, and hidden from assistive technology", () => {
  const names = [...AUTHORED.map(([name]) => name), ...UNKNOWN_NAMES];
  const rendered = names.map((name) => {
    const svg = markup(name);
    assertEquals(markup(name), svg, `${name}: stable server markup`);
    assert(!/NaN|Infinity|undefined/.test(svg), `${name}: finite output`);
    return `<article>${svg}</article>`;
  });
  const dom = new JSDOM(rendered.join(""));
  try {
    for (const article of dom.window.document.querySelectorAll("article")) {
      const root = article.firstElementChild;
      assert(root !== null, "the glyph has rendered output");
      assertEquals(root.getAttribute("aria-hidden"), "true");
      assert(
        root.querySelector("circle, rect, path") !== null,
        "the glyph draws something",
      );
      assertEquals(
        root.querySelectorAll(
          'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [focusable="true"]',
        ).length,
        0,
        "decoration has no interactive descendants",
      );
    }
  } finally {
    dom.window.close();
  }
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
