/** Structural contracts for the development-only invariant-core study. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";

const STUDY_CSS = new URL(
  "../art/browser/invariant-core.css",
  import.meta.url,
);
const ART_CENTER = { x: 360, y: 280 } as const;
const RADIAL_CLEAR_RADIUS = 96;
const TICK_INNER_RADIUS_MIN = 153.5;
const TICK_OUTER_RADIUS_MAX = 168.5;
const TICK_LENGTH_MAX = 14.5;

/** Collapse rendered prose whitespace without changing punctuation. */
function readableText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Read one required numeric SVG attribute. */
function numericAttribute(element: Element, name: string): number {
  const value = element.getAttribute(name);
  assert(value !== null, `${name} must be present`);
  const number = Number(value);
  assert(Number.isFinite(number), `${name} must be numeric`);
  return number;
}

/** Measure one SVG point from the artwork's invariant center. */
function radiusFromCenter(x: number, y: number): number {
  return Math.hypot(x - ART_CENTER.x, y - ART_CENTER.y);
}

/** Return one named keyframes body with balanced-brace scanning. */
function keyframesBody(css: string, name: string): string {
  const marker = `@keyframes ${name}`;
  const markerIndex = css.indexOf(marker);
  assert(markerIndex >= 0, `${name} keyframes must exist`);
  const opening = css.indexOf("{", markerIndex + marker.length);
  assert(opening >= 0, `${name} keyframes must open`);
  let depth = 0;
  for (let index = opening; index < css.length; index += 1) {
    const character = css[index];
    if (character === "{") depth += 1;
    if (character !== "}") continue;
    depth -= 1;
    if (depth === 0) return css.slice(opening + 1, index);
  }
  throw new Error(`${name} keyframes must close`);
}

/** Normalize the declarations applied at one keyframe percentage. */
function declarationsAt(body: string, percentage: number): string {
  for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((value) => value.trim());
    if (!selectors.includes(`${percentage}%`)) continue;
    return (match[2] ?? "").replace(/\s+/g, " ").trim();
  }
  throw new Error(`${percentage}% keyframe must exist`);
}

Deno.test("the invariant-core study renders one fixed center in each theme", () => {
  const dom = new JSDOM(renderArtGallery());
  const document = dom.window.document;
  const study = document.querySelector(
    '[data-browser-artwork="invariant-core"]',
  );
  assert(study !== null);

  assertEquals(
    readableText(study.querySelector("h3")?.textContent ?? null),
    "Navigator",
  );

  const themes = [...study.querySelectorAll(".art-gallery__theme")];
  assertEquals(themes.length, 2);
  assertEquals(
    themes.map((theme) => theme.getAttribute("data-discern-theme")),
    ["light", "dark"],
  );

  const renderedIds = [...document.querySelectorAll("[id]")].map((element) =>
    element.id
  );
  assertEquals(
    renderedIds.length,
    new Set(renderedIds).size,
    "the paired SVG accessibility IDs must remain unique",
  );

  for (const theme of themes) {
    const svg = theme.querySelector("svg[role='img']");
    assert(svg !== null);
    const title = svg.querySelector("title");
    const description = svg.querySelector("desc");
    assert(title?.id);
    assert(description?.id);
    assertEquals(
      svg.getAttribute("aria-labelledby"),
      `${title.id} ${description.id}`,
    );
    assertStringIncludes(readableText(title.textContent), "Navigator");
    assertStringIncludes(
      readableText(description.textContent),
      "remains fixed",
    );

    const apparatus = svg.querySelector("[data-transforming-apparatus]");
    const core = svg.querySelector("[data-invariant-core]");
    assert(apparatus !== null);
    assert(core !== null);
    assertEquals(numericAttribute(svg, "data-art-center-x"), ART_CENTER.x);
    assertEquals(numericAttribute(svg, "data-art-center-y"), ART_CENTER.y);
    assertEquals(
      core.getAttribute("transform"),
      `translate(${ART_CENTER.x} ${ART_CENTER.y})`,
    );
    assertEquals(apparatus.querySelector("[data-invariant-core]"), null);
    assertEquals(
      [...apparatus.querySelectorAll("[data-coordinate-frame]")].map(
        (frame) => frame.getAttribute("data-coordinate-frame"),
      ),
      ["cartesian", "oblique", "radial"],
    );

    const radial = apparatus.querySelector(
      '[data-coordinate-frame="radial"]',
    );
    assert(radial !== null);
    const rings = [...radial.querySelectorAll("[data-radial-ring]")];
    assertEquals(rings.length, 2);
    for (const ring of rings) {
      assertEquals(numericAttribute(ring, "cx"), ART_CENTER.x);
      assertEquals(numericAttribute(ring, "cy"), ART_CENTER.y);
      assert(
        numericAttribute(ring, "r") >= RADIAL_CLEAR_RADIUS,
        "every radial ring must preserve the core's negative space",
      );
    }

    const ticks = [...radial.querySelectorAll("[data-radial-tick]")];
    assertEquals(ticks.length, 8);
    assertEquals(radial.querySelectorAll("line").length, ticks.length);
    for (const tick of ticks) {
      const x1 = numericAttribute(tick, "x1");
      const y1 = numericAttribute(tick, "y1");
      const x2 = numericAttribute(tick, "x2");
      const y2 = numericAttribute(tick, "y2");
      const endpointRadii = [
        radiusFromCenter(x1, y1),
        radiusFromCenter(x2, y2),
      ];
      assert(
        Math.min(...endpointRadii) >= TICK_INNER_RADIUS_MIN,
        "every radial tick must begin inside the bounded circumference annulus",
      );
      assert(
        Math.max(...endpointRadii) <= TICK_OUTER_RADIUS_MAX,
        "every radial tick must end inside the bounded circumference annulus",
      );
      assert(
        Math.hypot(x2 - x1, y2 - y1) <= TICK_LENGTH_MAX,
        "every radial tick must remain short",
      );
    }
    assertEquals(svg.querySelectorAll("text").length, 0);
  }

  assertEquals(
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
      (script) => script.getAttribute("src"),
    ),
    ["/assets/theme.js"],
    "the static study must not ship a browser framework runtime",
  );
  dom.window.close();
});

Deno.test("the coordinate transformation closes on its balanced resting state", async () => {
  const css = await Deno.readTextFile(STUDY_CSS);
  for (
    const keyframes of [
      "invariant-core-art-cartesian",
      "invariant-core-art-oblique",
      "invariant-core-art-radial",
      "invariant-core-art-bloom",
    ]
  ) {
    assertStringIncludes(css, `animation: ${keyframes} 12s`);
    const body = keyframesBody(css, keyframes);
    const opening = declarationsAt(body, 0);
    const closing = declarationsAt(body, 100);
    assertEquals(
      closing,
      opening,
      `${keyframes} must cross the loop boundary without a jump`,
    );
    if (keyframes !== "invariant-core-art-bloom") {
      assertStringIncludes(opening, "transform: none;");
    }
  }

  const reducedMotionStart = css.indexOf(
    "@media (prefers-reduced-motion: reduce)",
  );
  assert(reducedMotionStart >= 0);
  const reducedMotion = css.slice(reducedMotionStart);
  assertStringIncludes(reducedMotion, ".invariant-core-art__frame--cartesian");
  assertStringIncludes(reducedMotion, ".invariant-core-art__frame--oblique");
  assertStringIncludes(reducedMotion, ".invariant-core-art__frame--radial");
  assertStringIncludes(reducedMotion, ".invariant-core-art__bloom");
  assertStringIncludes(reducedMotion, "animation: none;");
});
