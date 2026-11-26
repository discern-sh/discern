/** Glyph data, poses, deterministic rendering, decorative accessibility, and reduced motion. */
import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Project, SyntaxKind } from "ts-morph";
import { cardGlyph } from "../site/wall/Card.tsx";
import { WALL_DECK } from "../site/wall/deck.ts";
import {
  DrawnGlyph,
  Glyph,
  GLYPH_LANDING_PACE,
  GLYPH_POSE_PROPERTIES,
} from "../site/wall/Glyph.tsx";
import {
  arc,
  band,
  bar,
  dashed,
  dot,
  drawPrimitive,
  GLYPH_MOVING_MAX,
  GLYPH_PAINTS,
  GLYPH_PRIMITIVE_KINDS,
  GLYPH_SLIDE_MAX,
  GLYPH_TRAVEL_MIN,
  GLYPH_TURN_MAX,
  type GlyphDrawing,
  glyphLayers,
  type GlyphPoint,
  type GlyphPrimitive,
  type GlyphShape,
  lands,
  pivot,
  poseTravel,
  ring,
  sector,
  seededGlyph,
  shift,
  split,
} from "../site/wall/glyph_grammar.ts";
import { glyphDrawing, GLYPHS } from "../site/wall/glyphs.ts";
import { WALL_KNOBS } from "../site/wall/tuning/knobs.ts";
import {
  readScopedSources,
  structuralGuardScope,
} from "./structural_guard_scope.ts";
import {
  declared,
  MOTION_PROPERTY,
  movesByChoice,
  readWallSheet,
  splitOutside,
  type StyleRule,
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

/** Why the pose a primitive is marked with cannot be held, if it cannot. */
function unposable(primitive: GlyphPrimitive): string | undefined {
  const { shift: slide, pivot: turn } = primitive;
  if (slide === undefined && turn === undefined) {
    return primitive.lands === true
      ? "it lands, and no move carries it there: mark it with shift() or " +
        "pivot(), or take lands() off"
      : undefined;
  }
  if (
    slide !== undefined && Math.hypot(slide[0], slide[1]) > GLYPH_SLIDE_MAX
  ) {
    return `it slides farther than ${GLYPH_SLIDE_MAX} units`;
  }
  if (turn !== undefined && Math.abs(turn[0]) > GLYPH_TURN_MAX) {
    return `it turns farther than ${GLYPH_TURN_MAX} degrees`;
  }
  const travel = poseTravel(primitive);
  if (travel === 0) {
    return "its pose shows nothing: no telling point of it moves";
  }
  return travel >= GLYPH_TRAVEL_MIN
    ? undefined
    : `its pose travels ${travel} units, under the ${GLYPH_TRAVEL_MIN} a ` +
      `card can show: slide it farther, or turn it about a point farther away`;
}

/**
 * Unknown primitives, unusable dimensions, non-finite drawing data, or a pose
 * the renderer and the stylesheet do not hold.
 */
function drawingProblems(name: string, drawing: GlyphDrawing): string[] {
  const problems: string[] = [];
  const kinds: readonly string[] = GLYPH_PRIMITIVE_KINDS;
  const paints: readonly string[] = GLYPH_PAINTS;
  if (drawing.length === 0) problems.push(`${name}: no drawing`);
  const moving =
    glyphLayers(drawing).filter((layer) => layer.pose !== undefined).length;
  if (moving > GLYPH_MOVING_MAX) {
    problems.push(
      `${name}: ${moving} moving drawings, where a glyph has at most ` +
        `${GLYPH_MOVING_MAX}: give neighbors in the list the same pose, and ` +
        `they move as one drawing`,
    );
  }
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
    const flaw = malformed(primitive) ?? unposable(primitive);
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

Deno.test("every authored glyph makes a move while its card is lit", () => {
  assertEquals(
    AUTHORED.filter(([, drawing]) =>
      glyphLayers(drawing).every((layer) => layer.pose === undefined)
    ).map(([name]) => name),
    [],
    "a lit card's glyph makes one gesture: mark a primitive with shift() or " +
      "pivot() so the drawing enacts its card",
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

Deno.test("a drawing's layers keep its paint order, and neighbors that share a pose share a drawing", () => {
  const still = dot(24, 24, 4);
  const slid = shift(dot(10, 10, 4), 6, 0);
  const alike = shift(bar(4, 30, 10, 6), 6, 0);
  const swung = pivot(bar(22, 4, 4, 20), 90, 24, 24);
  const both = shift(pivot(dot(24, 8, 4), 90, 24, 24), 0, 6);

  assertEquals(glyphLayers([still]), [{ primitives: [still] }]);
  // A drawing that opens on a moving primitive still opens on a still layer.
  assertEquals(glyphLayers([slid, alike, still, swung, both, still]), [
    { primitives: [] },
    { primitives: [slid, alike], pose: { slide: [12.5, 0] } },
    { primitives: [still] },
    { primitives: [swung], pose: { turn: [90, 50, 50] } },
    {
      primitives: [both],
      pose: { slide: [0, 12.5], turn: [90, 50, 50] },
    },
    { primitives: [still] },
  ]);
  // Two primitives posed alike with a still one between them do not merge:
  // the still one paints between them.
  assertEquals(glyphLayers([slid, still, alike]).length, 4);
  // A move that lands is paced apart from one that swings free, so the two
  // are two drawings even when they go the same way.
  const landed = lands(shift(dot(10, 30, 4), 6, 0));
  assertEquals(glyphLayers([slid, landed]), [
    { primitives: [] },
    { primitives: [slid], pose: { slide: [12.5, 0] } },
    { primitives: [landed], pose: { slide: [12.5, 0], lands: true } },
  ]);

  for (const [name, drawing] of AUTHORED) {
    const layers = glyphLayers(drawing);
    assertEquals(
      layers.flatMap((layer) => layer.primitives),
      [...drawing],
      `${name}: the layers hold the drawing in its own order`,
    );
    assert(layers[0]?.pose === undefined, `${name}: the first layer is still`);
  }
});

Deno.test("a pose's travel is the longest way a telling point of the primitive goes", () => {
  assertEquals(poseTravel(dot(24, 24, 4)), 0, "an unmarked primitive");
  assertEquals(poseTravel(shift(dot(24, 24, 4), 3, 4)), 5);
  assertEquals(poseTravel(shift(bar(4, 4, 30, 8, "solid", 30), 0, -7)), 7);
  // A quarter turn carries a point 16 units from the pivot along a chord.
  assertEquals(poseTravel(pivot(dot(24, 8, 4), 90, 24, 24)), 22.63);
  assertEquals(poseTravel(pivot(dot(24, 8, 4), -90, 24, 24)), 22.63);
  // Half a turn carries an arc's end to the far side of its circle.
  assertEquals(poseTravel(pivot(band(24, 24, 16, 8, 0, 90), 180, 24, 24)), 32);
  // The turn comes first, and the slide carries what it turned.
  assertEquals(
    poseTravel(shift(pivot(dot(24, 8, 4), 180, 24, 24), 0, -8)),
    24,
  );
  // A circle turned about its own center shows nothing.
  assertEquals(poseTravel(pivot(ring(24, 24, 10), 90, 24, 24)), 0);
  assertEquals(
    poseTravel(pivot(band(24, 24, 16, 6, 0, 360), 120, 24, 24)),
    0,
  );
  assert(GLYPH_TRAVEL_MIN > 0 && GLYPH_TRAVEL_MIN < GLYPH_SLIDE_MAX);
});

Deno.test("a pose the stylesheet cannot hold, or too small to read on a card, is a drawing problem", () => {
  const far = GLYPH_SLIDE_MAX + 1;
  const flaws: readonly (readonly [GlyphDrawing, RegExp])[] = [
    [[shift(dot(24, 24, 4), far, 0)], /slides farther/],
    [[shift(dot(24, 24, 4), 0, 0)], /shows nothing/],
    [[shift(dot(24, 24, 4), GLYPH_TRAVEL_MIN - 1, 0)], /under the/],
    [[pivot(dot(24, 22, 4), 30, 24, 24)], /under the/],
    [[pivot(dot(24, 8, 4), GLYPH_TURN_MAX + 1, 24, 24)], /turns farther/],
    [[pivot(ring(24, 24, 10), 90, 24, 24)], /shows nothing/],
    [[lands(dot(24, 24, 4))], /no move carries it/],
    [
      Array.from(
        { length: GLYPH_MOVING_MAX + 1 },
        (_, index) => shift(dot(24, 24, 4), 5 + index, 0),
      ),
      /moving drawings/,
    ],
  ];
  for (const [drawing, flaw] of flaws) {
    const problems = drawingProblems("flawed", drawing);
    assertEquals(problems.length, 1, problems.join("; "));
    assert(flaw.test(problems[0] ?? ""), problems[0]);
  }
  assertEquals(
    drawingProblems("sound", [
      shift(dot(24, 24, 4), GLYPH_SLIDE_MAX, 0),
      pivot(bar(22, 4, 4, 20), -GLYPH_TURN_MAX, 24, 24),
      shift(pivot(dot(24, 8, 4), 90, 24, 24), 0, GLYPH_TRAVEL_MIN),
      lands(shift(dot(24, 24, 4), 0, GLYPH_TRAVEL_MIN)),
    ]),
    [],
  );
});

Deno.test("the renderer lays a glyph's layers over each other in paint order, each moving one with its pose", () => {
  const drawing: GlyphDrawing = [
    dot(24, 24, 20, "tint"),
    pivot(bar(22, 6, 4, 18), 90, 24, 24),
    shift(dot(10, 10, 4), 6, -3),
    shift(pivot(dot(24, 8, 4), -45, 12, 36), 0, 6),
    lands(shift(dot(36, 10, 4), 0, 6)),
    dot(24, 24, 4),
  ];
  const svg = renderToStaticMarkup(
    createElement(DrawnGlyph, { name: "posed", drawing }),
  );
  const dom = new JSDOM(svg);
  try {
    const layers = [...dom.window.document.querySelectorAll("svg")];
    assertEquals(
      layers.map((layer) => [
        layer.getAttribute("class"),
        layer.getAttribute("style"),
      ]),
      [
        ["wall-glyph-art", null],
        [
          "wall-glyph-move",
          "--wall-glyph-da:90deg;--wall-glyph-px:50%;--wall-glyph-py:50%",
        ],
        ["wall-glyph-move", "--wall-glyph-dx:12.5%;--wall-glyph-dy:-6.25%"],
        [
          "wall-glyph-move",
          "--wall-glyph-dx:0%;--wall-glyph-dy:12.5%;--wall-glyph-da:-45deg;" +
          "--wall-glyph-px:25%;--wall-glyph-py:75%",
        ],
        [
          "wall-glyph-move",
          `--wall-glyph-dx:0%;--wall-glyph-dy:12.5%;--wall-glyph-ease:var(${GLYPH_LANDING_PACE})`,
        ],
        ["wall-glyph-art wall-glyph-over", null],
      ],
    );
    // Read in order, the layers are the drawing a still renderer draws.
    assertEquals(
      layers.map((layer) => layer.children.length),
      drawing.map((primitive) => drawPrimitive(primitive).length),
    );
  } finally {
    dom.window.close();
  }
});

/** Every rule of the glyph sheet. */
const GLYPH_RULES = styleRules(GLYPH_SHEET);

/** The glyph sheet's rules that style a moving drawing, where motion is allowed. */
const MOVE_RULES = GLYPH_RULES.filter((rule) =>
  movesByChoice(rule) &&
  rule.selectors.every((selector) => selector.endsWith(".wall-glyph-move"))
);

/** The rule a moving drawing takes at rest: the one that names it alone. */
function restRule(): StyleRule {
  const rest = MOVE_RULES.filter((rule) =>
    rule.selectors.length === 1 && rule.selectors[0] === ".wall-glyph-move"
  );
  assertEquals(rest.length, 1, "one rule styles a moving drawing at rest");
  const [rule] = rest;
  assert(rule !== undefined);
  return rule;
}

/** The custom properties the glyph sheet registers, and whether each inherits. */
function registered(): Map<string, string | undefined> {
  return new Map(
    GLYPH_RULES.flatMap((rule) => {
      const name = /^@property\s+(--[\w-]+)$/.exec(rule.prelude)?.[1];
      return name === undefined
        ? []
        : [[name, declared(rule, "inherits")] as const];
    }),
  );
}

/** Every custom property a value reads. */
function reads(value: string): string[] {
  return [...value.matchAll(/var\(\s*(--[\w-]+)/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]]
  );
}

/** A CSS time in seconds. */
function seconds(time: string): number {
  const match = /^(\d*\.?\d+)(ms|s)$/.exec(time);
  assert(match !== null, `"${time}" is a time`);
  return Number(match[1]) / (match[2] === "ms" ? 1000 : 1);
}

Deno.test("the stylesheet reads exactly the pose the renderer writes", () => {
  const knobs = new Set(WALL_KNOBS.map((knob) => `--wall-${knob.name}`));
  const eased = registered();
  const handed = new Set(
    GLYPH_RULES.flatMap((rule) =>
      rule.declarations.flatMap(([, value]) => reads(value))
    ).filter((name) => !knobs.has(name) && !eased.has(name)),
  );
  assertEquals([...handed].sort(), [...GLYPH_POSE_PROPERTIES].sort());
});

Deno.test("a moving drawing always carries its move, and only registered values are eased", () => {
  const eased = registered();
  assert(eased.size > 0, "the sheet registers the values it eases");
  for (const [name, inherits] of eased) {
    assertEquals(
      inherits,
      "false",
      `${name} stays on the drawing: an inherited value restyles every ` +
        `shape inside it on each frame`,
    );
  }

  // At rest the drawing already slides and turns, by nothing, so lighting
  // its card changes no box's layout.
  const rest = restRule();
  for (const move of ["translate", "rotate"]) {
    const value = declared(rest, move);
    assert(value !== undefined, `a moving drawing has a ${move} at rest`);
    assertEquals(
      reads(value).filter((name) => !eased.has(name)),
      [],
      `${move} reads registered values alone`,
    );
    assert(reads(value).length > 0, `${move} reads the value that is eased`);
  }
  assertEquals(
    splitOutside(declared(rest, "transition-property") ?? "", ",").sort(),
    [...eased.keys()].sort(),
    "the ease names each registered value, and never a move itself: a " +
      "transition on translate, rotate, or transform makes the box a layer",
  );

  // A lit rule sets where the registered values go and how the way there is
  // paced. It leaves the moves, and what is eased, to the resting rule.
  const lit = MOVE_RULES.filter((rule) => rule !== rest);
  assert(lit.length > 0, "a lit card poses its glyph");
  const pace = new Set(["transition-duration", "transition-timing-function"]);
  for (const rule of lit) {
    assertEquals(
      rule.declarations.map(([property]) => property).filter((property) =>
        !eased.has(property) && !pace.has(property)
      ),
      [],
      rule.selectors.join(", "),
    );
    assertEquals(
      [...eased.keys()].filter((name) => declared(rule, name) === undefined),
      [],
      `${rule.selectors.join(", ")} takes every eased value to its pose`,
    );
  }

  // Nothing else in the sheet moves a box or eases anything.
  assertEquals(
    GLYPH_RULES.filter((rule) => !MOVE_RULES.includes(rule))
      .flatMap((rule) =>
        rule.declarations.filter(([property]) => MOTION_PROPERTY.test(property))
          .map(([property]) => `${rule.prelude} { ${property} }`)
      ),
    [],
  );
});

/** The two heights that shape a cubic-bezier pace, or none when a value names no such pace. */
function paceHeights(
  value: string,
): readonly [number, number] | undefined {
  const match =
    /cubic-bezier\(\s*[\d.]+\s*,\s*(-?[\d.]+)\s*,\s*[\d.]+\s*,\s*(-?[\d.]+)\s*\)/
      .exec(value);
  return match === null ? undefined : [Number(match[1]), Number(match[2])];
}

/** Whether a pace stays between its start and its end the whole way. */
function staysWithin(heights: readonly [number, number]): boolean {
  return heights.every((height) => height >= 0 && height <= 1);
}

Deno.test("a move that lands stops at its pose, and a free move goes past it first", () => {
  const boxes = GLYPH_RULES.filter((rule) =>
    rule.selectors.length === 1 && rule.selectors[0] === ".wall-glyph"
  );
  assertEquals(boxes.length, 1, "one rule styles a glyph's box");
  const [box] = boxes;
  assert(box !== undefined);
  const landing = paceHeights(declared(box, GLYPH_LANDING_PACE) ?? "");
  assert(
    landing !== undefined,
    `the glyph's box declares ${GLYPH_LANDING_PACE}, the pace a drawing ` +
      `that lands asks for`,
  );
  assert(
    staysWithin(landing),
    `${GLYPH_LANDING_PACE} carries a piece past the thing it lands ` +
      `against: keep both of its heights between 0 and 1`,
  );

  const rest = restRule();
  assertEquals(
    reads(declared(rest, "transition-timing-function") ?? ""),
    [],
    "the way back has one pace for every move",
  );
  for (const rule of MOVE_RULES.filter((rule) => rule !== rest)) {
    const pace = declared(rule, "transition-timing-function") ?? "";
    assertEquals(
      reads(pace),
      ["--wall-glyph-ease"],
      `${rule.selectors.join(", ")} takes the pace its drawing hands over`,
    );
    const free = paceHeights(pace);
    assert(
      free !== undefined && !staysWithin(free),
      `${rule.selectors.join(", ")}: a free move settles from a little ` +
        `past its pose`,
    );
  }
});

Deno.test("a glyph's way back to rest ends before its card's face steps down", async () => {
  const back = Math.max(
    ...splitOutside(declared(restRule(), "transition-duration") ?? "", ",")
      .map(seconds),
  );
  assert(back > 0, "the way back is eased");

  const faces = styleRules(await readWallSheet("wall-card.css")).filter((
    rule,
  ) =>
    movesByChoice(rule) && rule.selectors.length === 1 &&
    rule.selectors[0] === ".wall-card-face"
  );
  assertEquals(faces.length, 1, "one rule eases a card's face to rest");
  const [face] = faces;
  assert(face !== undefined);
  const step = splitOutside(declared(face, "transition") ?? "", ",").find((
    part,
  ) => part.startsWith("z-index "));
  assert(step !== undefined, "the face steps down in the stack after a hold");
  const [, , hold] = step.split(" ");
  assert(hold !== undefined, "the step down waits");
  assert(
    back < seconds(hold),
    `the glyph eases back for ${back}s and the face is held for ${hold}: ` +
      `shorten the way back in wall-glyph.css, or lengthen the hold in ` +
      `wall-card.css`,
  );
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
