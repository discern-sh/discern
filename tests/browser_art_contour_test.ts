/** Contracts for the development-only one-way contour study. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import {
  CONTOUR_EXPANSION,
  CONTOUR_RINGS,
  contourLineAttributes,
  type ContourRing,
  defineContourRing,
} from "../art/browser/contour.tsx";
import { browserArtworkStylesheetName } from "../art/browser/registry.ts";
import { renderArtGallery } from "../site/page-src/art-gallery.tsx";
import {
  ART_GALLERY_PATH,
  ART_STYLESHEET_PATHS,
  specimenHandler,
} from "../site/specimens.ts";

const CONTOUR_CSS = new URL(
  "../art/browser/contour.css",
  import.meta.url,
);

/** Collapse prose whitespace without changing its punctuation. */
function readableText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Read one balanced CSS block beginning at a selector or at-rule marker. */
function cssBlock(source: string, marker: string): string {
  const markerIndex = source.indexOf(marker);
  assert(markerIndex >= 0, `${marker} must exist`);
  const openingBrace = source.indexOf("{", markerIndex);
  assert(openingBrace >= 0, `${marker} must open a block`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{") depth += 1;
    if (character !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  throw new Error(`${marker} must close its block`);
}

/** List the property names used by one CSS declaration block. */
function cssProperties(declarations: string): string[] {
  return [...declarations.matchAll(/([a-z-]+)\s*:/g)]
    .map((match) => match[1] ?? "")
    .filter((property) => property !== "")
    .filter((property, index, properties) =>
      properties.indexOf(property) === index
    )
    .sort();
}

interface CssChildBlock {
  readonly selector: string;
  readonly declarations: string;
}

/** Enumerate every direct child block so an added keyframe joins the guard. */
function cssChildBlocks(source: string): CssChildBlock[] {
  const blocks: CssChildBlock[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const openingBrace = source.indexOf("{", cursor);
    if (openingBrace < 0) break;
    const selector = source.slice(cursor, openingBrace).trim();
    assert(selector !== "", "each CSS child block needs a selector");

    let depth = 1;
    let closingBrace = openingBrace + 1;
    for (; closingBrace < source.length; closingBrace += 1) {
      const character = source[closingBrace];
      if (character === "{") depth += 1;
      if (character === "}") depth -= 1;
      if (depth === 0) break;
    }
    assert(depth === 0, `${selector} must close its block`);
    blocks.push({
      selector,
      declarations: source.slice(openingBrace + 1, closingBrace),
    });
    cursor = closingBrace + 1;
  }
  assert(
    source.slice(cursor).trim() === "",
    "CSS child blocks must not leave unguarded declarations",
  );
  return blocks;
}

interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** Read the six numeric terms of a CSS two-dimensional matrix. */
function matrix(transform: string): Matrix {
  const match = transform.match(/^matrix\(([^)]+)\)$/);
  assert(match, `${transform} must be a CSS matrix`);
  const terms = match[1]?.split(",").map((term) => Number(term.trim())) ?? [];
  assertEquals(terms.length, 6);
  assert(
    terms.every(Number.isFinite),
    `${transform} must contain finite terms`,
  );
  const [a, b, c, d, e, f] = terms;
  assert(
    a !== undefined && b !== undefined && c !== undefined &&
      d !== undefined && e !== undefined && f !== undefined,
  );
  return { a, b, c, d, e, f };
}

/** Transform authored bounds through one matrix and return their new bounds. */
function transformedBounds(
  ring: ContourRing,
  transform: Matrix,
): {
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
} {
  const corners = [
    [ring.bounds.minX, ring.bounds.minY],
    [ring.bounds.maxX, ring.bounds.minY],
    [ring.bounds.maxX, ring.bounds.maxY],
    [ring.bounds.minX, ring.bounds.maxY],
  ] as const;
  const transformed = corners.map(([x, y]) => ({
    x: (transform.a * x) + (transform.c * y) + transform.e,
    y: (transform.b * x) + (transform.d * y) + transform.f,
  }));
  const x = transformed.map((point) => point.x);
  const y = transformed.map((point) => point.y);
  const minX = Math.min(...x);
  const maxX = Math.max(...x);
  const minY = Math.min(...y);
  const maxY = Math.max(...y);
  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/** Assert the geometry-derived motion contract shared by every contour. */
function assertExpansionContract(ring: ContourRing): void {
  const start = matrix(ring.motion.startTransform);
  const settled = matrix(ring.motion.settledTransform);
  assertEquals(settled, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  assert(start.a > 0 && start.a < 1, `${ring.id} must expand outward`);
  assertEquals(start.b, 0);
  assertEquals(start.c, 0);
  assertEquals(start.d, start.a);

  const footprint = transformedBounds(ring, start);
  assert(
    Math.abs(footprint.centerX - CONTOUR_EXPANSION.anchor.x) <= 0.1,
    `${ring.id} must share the expansion anchor on x`,
  );
  assert(
    Math.abs(footprint.centerY - CONTOUR_EXPANSION.anchor.y) <= 0.1,
    `${ring.id} must share the expansion anchor on y`,
  );
  assert(
    Math.abs(
      Math.max(footprint.width, footprint.height) -
        CONTOUR_EXPANSION.startSpan,
    ) <= 0.1,
    `${ring.id} must share the compact starting span`,
  );
}

const PROSPECTIVE_SEVENTH_RING = defineContourRing({
  id: "prospective-boundary",
  opacity: { light: 0.46, dark: 0.54 },
  points: [
    [368, 302],
    [356, 252],
    [383, 207],
    [438, 183],
    [500, 194],
    [536, 231],
    [530, 279],
    [488, 314],
    [424, 319],
  ],
  rounding: 0.16,
});

Deno.test("the one-way contour study renders accessibly in both fixed themes", () => {
  const dom = new JSDOM(renderArtGallery());
  const document = dom.window.document;
  const study = document.querySelector('[data-browser-artwork="contour"]');
  assert(study !== null);

  assertEquals(
    readableText(study.querySelector("h3")?.textContent ?? null),
    "Contours",
  );
  assertEquals(study.querySelectorAll(".art-gallery__theme").length, 2);
  assertEquals(
    study.querySelectorAll(
      '.art-gallery__theme[data-discern-theme="light"]',
    ).length,
    1,
  );
  assertEquals(
    study.querySelectorAll(
      '.art-gallery__theme[data-discern-theme="dark"]',
    ).length,
    1,
  );

  const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map(
    (element) => element.id,
  );
  assertEquals(ids.length, new Set(ids).size, "rendered ids must be unique");

  const artworks = study.querySelectorAll<SVGSVGElement>(
    '.contour-art svg[role="img"]',
  );
  assertEquals(artworks.length, 2);
  for (const artwork of artworks) {
    const labelledBy = artwork.getAttribute("aria-labelledby")?.split(/\s+/) ??
      [];
    assertEquals(labelledBy.length, 2);
    for (const id of labelledBy) {
      assert(artwork.querySelector(`#${id}`), `${id} must belong to its SVG`);
    }
    assert(readableText(artwork.querySelector("title")?.textContent ?? null));
    assert(readableText(artwork.querySelector("desc")?.textContent ?? null));
    assertEquals(artwork.querySelectorAll("text").length, 0);
    assertEquals(
      artwork.querySelectorAll(".contour-art__line").length,
      CONTOUR_RINGS.length,
    );
    assertEquals(
      artwork.querySelectorAll(".contour-art__line--latest").length,
      1,
    );
    assertEquals(
      artwork.querySelectorAll(".contour-art__attractor-fill").length,
      1,
    );
  }

  assertEquals(
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
      (script) => script.getAttribute("src"),
    ),
    ["/assets/theme.js"],
    "the static preview must not ship an artwork runtime",
  );
  dom.window.close();
});

Deno.test("every contour expands from one compact footprint to its authored geometry", async () => {
  const dom = new JSDOM(renderArtGallery());
  const document = dom.window.document;
  const css = await Deno.readTextFile(CONTOUR_CSS);
  const enrolledWithFuture = [
    ...CONTOUR_RINGS,
    PROSPECTIVE_SEVENTH_RING,
  ];
  assertEquals(
    enrolledWithFuture.length,
    CONTOUR_RINGS.length + 1,
    "the prospective contour must exercise one future registry member",
  );

  const startingFootprints = enrolledWithFuture.map((ring) => {
    assertExpansionContract(ring);
    return transformedBounds(ring, matrix(ring.motion.startTransform));
  });
  const startingWidths = startingFootprints.map((footprint) => footprint.width);
  const startingHeights = startingFootprints.map((footprint) =>
    footprint.height
  );
  assert(
    Math.max(...startingWidths) - Math.min(...startingWidths) <= 0.2,
    "the compact family must share one width",
  );
  assert(
    Math.max(...startingHeights) - Math.min(...startingHeights) <= 9,
    "authored proportions may vary only slightly in the compact family",
  );

  const futureAttributes = contourLineAttributes(
    PROSPECTIVE_SEVENTH_RING,
    false,
  );
  assertStringIncludes(futureAttributes.className, "contour-art__line");
  assertEquals(futureAttributes["data-contour-motion"], "expand");
  assertEquals(
    futureAttributes.style["--contour-art-start-transform"],
    PROSPECTIVE_SEVENTH_RING.motion.startTransform,
  );
  assertEquals(
    futureAttributes.style["--contour-art-settled-transform"],
    CONTOUR_EXPANSION.settledTransform,
  );

  for (const artwork of document.querySelectorAll(".contour-art")) {
    const renderedRings = artwork.querySelectorAll(
      '.contour-art__line[data-contour-ring][data-contour-motion="expand"]',
    );
    assertEquals(renderedRings.length, CONTOUR_RINGS.length);
    assertEquals(
      [...renderedRings].map((ring) => ring.getAttribute("d")),
      CONTOUR_RINGS.map((ring) => ring.path),
      "the registry must enroll every retained ring",
    );
    assertEquals(
      [...renderedRings].map((ring) => [
        ring.getAttribute("style")?.includes(
          "--contour-art-opacity:",
        ),
        ring.getAttribute("style")?.includes(
          "--contour-art-opacity-dark:",
        ),
        ring.getAttribute("style")?.includes(
          "--contour-art-start-transform:",
        ),
        ring.getAttribute("style")?.includes(
          "--contour-art-settled-transform:",
        ),
      ]),
      CONTOUR_RINGS.map(() => [true, true, true, true]),
      "future rings must carry theme contrast and expansion geometry",
    );

    for (const ring of renderedRings) {
      const path = ring.getAttribute("d") ?? "";
      assertStringIncludes(path, " L ");
      assertStringIncludes(path, " Q ");
      assert(!path.includes(" C "), "rings must stay softly faceted");
    }

    assertEquals(
      artwork.querySelectorAll(".contour-art__advance").length,
      0,
    );
    assertEquals(
      artwork.querySelectorAll("animate, animateTransform").length,
      0,
    );
  }

  assert(!css.includes("contour-art__advance"));
  assert(!css.includes("stroke-dasharray"));
  assert(!/[\s{;]d\s*:/.test(css), "motion must not morph authored paths");
  const lineRule = cssBlock(css, ".contour-art__line {");
  assertStringIncludes(
    lineRule,
    `animation: contour-art-expansion ${
      CONTOUR_EXPANSION.durationMs / 1_000
    }s ease-in-out infinite`,
  );
  assertStringIncludes(
    lineRule,
    "transform: var(--contour-art-settled-transform)",
  );

  const motion = cssBlock(css, "@keyframes contour-art-expansion");
  const motionFrames = cssChildBlocks(motion);
  const expectedSelectors = ["0%", "6%", "12%", "58%", "84%", "92%", "100%"];
  assertEquals(
    motionFrames.map((frame) => frame.selector),
    expectedSelectors,
    "every contour keyframe must be enrolled in the motion guard",
  );
  for (const frame of motionFrames) {
    assertEquals(
      cssProperties(frame.declarations),
      ["opacity", "transform"],
      "contours may move only through scale, position, and opacity",
    );
  }
  const frameBySelector = new Map(
    motionFrames.map((frame) => [frame.selector, frame.declarations]),
  );
  const declarationsAt = (selector: string): string => {
    const declarations = frameBySelector.get(selector);
    assert(declarations !== undefined, `${selector} must join the timeline`);
    return declarations;
  };
  const start = declarationsAt("0%");
  const opening = declarationsAt("6%");
  const launch = declarationsAt("12%");
  const settle = declarationsAt("58%");
  const rest = declarationsAt("84%");
  const fade = declarationsAt("92%");
  const reset = declarationsAt("100%");
  assertStringIncludes(
    start,
    "transform: var(--contour-art-start-transform)",
  );
  assertStringIncludes(start, "opacity: 0");
  assertStringIncludes(
    opening,
    "transform: var(--contour-art-start-transform)",
  );
  assertStringIncludes(
    opening,
    "opacity: var(--contour-art-visible-opacity)",
  );
  assertStringIncludes(
    launch,
    "transform: var(--contour-art-start-transform)",
  );
  assertStringIncludes(
    settle,
    "transform: var(--contour-art-settled-transform)",
  );
  assertStringIncludes(
    rest,
    "transform: var(--contour-art-settled-transform)",
  );
  assertStringIncludes(rest, "opacity: var(--contour-art-visible-opacity)");
  assertStringIncludes(
    fade,
    "transform: var(--contour-art-settled-transform)",
  );
  assertStringIncludes(fade, "opacity: 0");
  assertStringIncludes(
    reset,
    "transform: var(--contour-art-start-transform)",
  );
  assertStringIncludes(reset, "opacity: 0");

  const reduced = cssBlock(css, "@media (prefers-reduced-motion: reduce)");
  assertStringIncludes(
    cssBlock(reduced, ".contour-art__line,"),
    "animation: none",
  );
  assertStringIncludes(
    cssBlock(reduced, ".contour-art__line {"),
    "transform: var(--contour-art-settled-transform)",
  );
  assertStringIncludes(
    cssBlock(css, ".contour-art__attractor-fill"),
    "fill: var(--discern-color-accent-600)",
  );
  dom.window.close();
});

Deno.test("the focused development handler serves the contour stylesheet", async () => {
  const root = await specimenHandler(
    new Request(`http://localhost${ART_GALLERY_PATH}`),
  );
  const html = await root.text();
  const stylesheetName = browserArtworkStylesheetName("contour");
  const stylesheetPath = ART_STYLESHEET_PATHS.find((path) =>
    path.endsWith(`/${stylesheetName}`)
  );
  assert(stylesheetPath !== undefined);
  assertStringIncludes(html, stylesheetPath);

  const stylesheet = await specimenHandler(
    new Request(`http://localhost${stylesheetPath}`),
  );
  assertEquals(stylesheet.status, 200);
  assertEquals(stylesheet.headers.get("cache-control"), "no-store");
  assertStringIncludes(
    stylesheet.headers.get("content-type") ?? "",
    "text/css",
  );
  assertStringIncludes(await stylesheet.text(), ".contour-art__line");
});
