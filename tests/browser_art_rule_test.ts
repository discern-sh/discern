/** Structural guards for the rule artwork's three-generation ritual. */

import { assert, assertEquals } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  RULE_ACCENT_CELL,
  RULE_BISECTION_ARCS,
  RULE_CENTROID,
  RULE_CHORD_GENERATIONS,
  RULE_MIDPOINT_TICKS,
  RULE_SMALLEST_CELLS,
  RULE_TRIANGLE,
  type RulePoint,
  type RuleTriangle,
} from "../art/browser/rule.tsx";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";

const ARTWORK_CSS = new URL("../art/browser/rule.css", import.meta.url);

/** A triangle's centre of gravity, recomputed independently of the artwork. */
function centroidOf(triangle: RuleTriangle): RulePoint {
  const [a, b, c] = triangle;
  return { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
}

/** Euclidean distance between two plate points. */
function distance(a: RulePoint, b: RulePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Signed twice-area of the triangle a→b→p, for containment checks. */
function orientation(a: RulePoint, b: RulePoint, p: RulePoint): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** Whether a point lies inside or on the outer triangle, with tolerance. */
function insideOuterTriangle(point: RulePoint): boolean {
  const [a, b, c] = RULE_TRIANGLE;
  const signs = [
    orientation(a, b, point),
    orientation(b, c, point),
    orientation(c, a, point),
  ];
  return signs.every((sign) => sign >= -0.01) ||
    signs.every((sign) => sign <= 0.01);
}

Deno.test("the rule subdivision is capped at three generations of 3, 9, 27", () => {
  assertEquals(RULE_CHORD_GENERATIONS.length, 3);
  assertEquals(
    RULE_CHORD_GENERATIONS.map((generation) => generation.length),
    [3, 9, 27],
  );

  const [a, b, c] = RULE_TRIANGLE;
  const outerMidpoints = [
    { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 },
    { x: (c.x + a.x) / 2, y: (c.y + a.y) / 2 },
  ];
  const generationOne = RULE_CHORD_GENERATIONS[0];
  assert(generationOne !== undefined);
  for (const midpoint of outerMidpoints) {
    const touching = generationOne.filter((chord) =>
      distance(chord.from, midpoint) < 0.01 ||
      distance(chord.to, midpoint) < 0.01
    );
    assertEquals(touching.length, 2, "each midpoint joins exactly two chords");
  }

  for (const generation of RULE_CHORD_GENERATIONS) {
    for (const chord of generation) {
      assert(insideOuterTriangle(chord.from), "chords stay within the plate");
      assert(insideOuterTriangle(chord.to), "chords stay within the plate");
    }
  }

  assertEquals(
    RULE_BISECTION_ARCS.length,
    6,
    "only the two outward compass strikes remain on each side",
  );
  for (let side = 0; side < 3; side += 1) {
    const arcs = RULE_BISECTION_ARCS.filter((arc) => arc.side === side);
    assertEquals(
      arcs.length,
      2,
      "one external crossing pair bisects each side",
    );
    assertEquals(arcs.filter((arc) => arc.anchor === 0).length, 1);
    assertEquals(arcs.filter((arc) => arc.anchor === 1).length, 1);
  }
  assertEquals(RULE_MIDPOINT_TICKS.length, 3);
});

Deno.test("the accent traces one smallest cell nearest the plate's centre", () => {
  assertEquals(RULE_SMALLEST_CELLS.length, 27);
  assert(RULE_SMALLEST_CELLS.includes(RULE_ACCENT_CELL));

  const accentDistance = distance(centroidOf(RULE_ACCENT_CELL), RULE_CENTROID);
  for (const cell of RULE_SMALLEST_CELLS) {
    assert(
      accentDistance <= distance(centroidOf(cell), RULE_CENTROID) + 0.000001,
      "no smallest cell sits nearer the centre than the accent cell",
    );
  }
});

Deno.test("the gallery renders the plate twice with its full ritual cast", () => {
  const dom = new JSDOM(renderArtGallery());
  const figures = dom.window.document.querySelectorAll<HTMLElement>(
    ".fig-rule",
  );
  assertEquals(figures.length, 2);

  for (const figure of figures) {
    const svg = figure.querySelector<SVGElement>(
      'svg.fig-rule__art[role="img"]',
    );
    assert(svg !== null);

    assertEquals(svg.querySelectorAll(".fig-rule__arc").length, 6);
    assertEquals(svg.querySelectorAll(".fig-rule__arc-ink-path").length, 6);
    assertEquals(svg.querySelectorAll(".fig-rule__tick").length, 3);
    assertEquals(svg.querySelectorAll(".fig-rule__frame").length, 1);

    assertEquals(
      svg.querySelectorAll(".fig-rule__g1 .fig-rule__chord").length,
      3,
    );
    assertEquals(
      svg.querySelectorAll(".fig-rule__g2 .fig-rule__chord").length,
      9,
    );
    assertEquals(
      svg.querySelectorAll(".fig-rule__g3 .fig-rule__chord").length,
      27,
    );
    assertEquals(
      svg.querySelectorAll(".fig-rule__g1-ink .fig-rule__ink-chord").length,
      3,
    );
    assertEquals(
      svg.querySelectorAll(".fig-rule__g2-ink .fig-rule__ink-chord").length,
      9,
    );
    assertEquals(
      svg.querySelectorAll(".fig-rule__g3-ink .fig-rule__ink-chord").length,
      27,
    );
    for (let corner = 1; corner <= 9; corner += 1) {
      assertEquals(
        svg.querySelectorAll(`.fig-rule__g3-ink--c${corner}`).length,
        3,
        `ripple corner ${corner} re-inks its three chords`,
      );
    }

    const accents = svg.querySelectorAll(".fig-rule__accent");
    assertEquals(accents.length, 1);
    assertEquals(accents[0]?.getAttribute("pathLength"), "1");
    assertEquals(svg.querySelectorAll(".fig-rule__accent-gate").length, 1);

    assertEquals(svg.querySelectorAll("text").length, 0);
  }

  dom.window.close();
});

/** Split one keyframes body into its selector lists. */
function keyframeSelectors(body: string): readonly (readonly string[])[] {
  return [...body.matchAll(/(^|\})\s*([\d.,%\s]+?)\s*\{/g)].map((match) => {
    const selector = match[2];
    assert(selector !== undefined);
    return selector.split(",").map((token) => token.trim());
  });
}

Deno.test("the rule stylesheet closes every loop and stays monochrome", async () => {
  const css = await Deno.readTextFile(ARTWORK_CSS);

  assert(css.includes("@layer discern.page"));
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(css), "no raw hex colors");
  assert(!/\b(?:rgb|hsl)a?\(/.test(css), "no raw rgb/hsl colors");
  assert(!/\boklch\(/.test(css), "no raw oklch colors");

  const names = [...css.matchAll(/@keyframes\s+([A-Za-z0-9-]+)\s*\{/g)];
  assert(names.length >= 20, "the ritual stages many phrase-locked keyframes");
  const bodies = css.split(/@keyframes\s+[A-Za-z0-9-]+\s*\{/).slice(1);
  assertEquals(bodies.length, names.length);

  for (const [index, match] of names.entries()) {
    const name = match[1];
    assert(name !== undefined);
    assert(
      name.startsWith("fig-rule-"),
      `keyframes ${name} must carry the piece namespace`,
    );

    const body = bodies[index];
    assert(body !== undefined);
    let depth = 1;
    let end = 0;
    for (const character of body) {
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      end += 1;
      if (depth === 0) break;
    }
    const selectors = keyframeSelectors(body.slice(0, end - 1));
    assert(selectors.length > 0, `keyframes ${name} declares stages`);
    for (const tokens of selectors) {
      assertEquals(
        tokens.includes("0%"),
        tokens.includes("100%"),
        `keyframes ${name} must declare 0% and 100% as one identical state`,
      );
    }
    assert(
      selectors.some((tokens) => tokens.includes("0%")),
      `keyframes ${name} must declare its rest state`,
    );
  }

  const accentUses = css.match(/var\(--fig-accent\)/g) ?? [];
  assertEquals(accentUses.length, 1, "the accent appears exactly once");
});
