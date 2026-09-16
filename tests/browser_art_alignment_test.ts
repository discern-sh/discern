/** Structural guards for the approved Alignment browser artwork. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderArtGallery } from "../site/ui/pages/ArtGalleryPage.tsx";

const ALIGNMENT_CSS = new URL("../art/browser/alignment.css", import.meta.url);
const GALLERY_CSS = new URL(
  "../site/page-src/art-gallery.css",
  import.meta.url,
);

/** Collapse rendered prose whitespace without changing punctuation. */
function readableText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Return the declarations from one flat, concept-scoped CSS rule. */
function cssRule(css: string, selector: string): string {
  const marker = `${selector} {`;
  const start = css.indexOf(marker);
  if (start < 0) throw new TypeError(`Missing CSS rule: ${selector}`);
  const declarationsStart = start + marker.length;
  const end = css.indexOf("}", declarationsStart);
  if (end < 0) throw new TypeError(`Unclosed CSS rule: ${selector}`);
  return css.slice(declarationsStart, end);
}

/** Read one numeric custom property from a CSS declaration block. */
function cssCustomNumber(declarations: string, property: string): number {
  const match = declarations.match(
    new RegExp(`${property}:\\s*(-?\\d+(?:\\.\\d+)?)`),
  );
  const value = Number(match?.[1]);
  if (!Number.isFinite(value)) {
    throw new TypeError(`Missing numeric CSS property: ${property}`);
  }
  return value;
}

interface SvgBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

const ALIGNMENT_CENTER_X = 380;
const ALIGNMENT_TOP_Y = 124;
const ALIGNMENT_BOTTOM_Y = 430;
const HARD_EDGE_GEOMETRY = "path, line, rect, polygon, polyline";

/** Read one required finite SVG number from an element attribute. */
function svgNumber(element: Element, attribute: string): number {
  const value = Number(element.getAttribute(attribute));
  if (!Number.isFinite(value)) {
    throw new TypeError(
      `${element.tagName.toLowerCase()} requires finite ${attribute}`,
    );
  }
  return value;
}

/** Reduce a non-empty list of SVG points into its axis-aligned bounds. */
function pointBounds(points: readonly [number, number][]): SvgBounds {
  if (points.length === 0) throw new TypeError("SVG geometry has no points");
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** Parse the artwork's deliberately simple absolute M/L/H/V path grammar. */
function simplePathBounds(element: Element): SvgBounds {
  const path = element.getAttribute("d") ?? "";
  const tokens = path.match(/[MLHVZ]|-?\d+(?:\.\d+)?/g) ?? [];
  const points: [number, number][] = [];
  let cursorX = 0;
  let cursorY = 0;
  let command = "";
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) break;
    if (/^[MLHVZ]$/.test(token)) {
      command = token;
      index += 1;
      if (command === "Z") continue;
    }
    if (command === "M" || command === "L") {
      const x = Number(tokens[index]);
      const y = Number(tokens[index + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new TypeError(`Unsupported SVG path: ${path}`);
      }
      cursorX = x;
      cursorY = y;
      points.push([cursorX, cursorY]);
      index += 2;
      continue;
    }
    if (command === "H") {
      cursorX = Number(tokens[index]);
      if (!Number.isFinite(cursorX)) {
        throw new TypeError(`Unsupported SVG path: ${path}`);
      }
      points.push([cursorX, cursorY]);
      index += 1;
      continue;
    }
    if (command === "V") {
      cursorY = Number(tokens[index]);
      if (!Number.isFinite(cursorY)) {
        throw new TypeError(`Unsupported SVG path: ${path}`);
      }
      points.push([cursorX, cursorY]);
      index += 1;
      continue;
    }
    throw new TypeError(`Unsupported SVG path command in: ${path}`);
  }
  return pointBounds(points);
}

/** Read hard-edged primitive bounds; unfamiliar geometry fails closed. */
function geometryBounds(element: Element): SvgBounds {
  const tag = element.tagName.toLowerCase();
  if (tag === "path") return simplePathBounds(element);
  if (tag === "line") {
    return pointBounds([
      [svgNumber(element, "x1"), svgNumber(element, "y1")],
      [svgNumber(element, "x2"), svgNumber(element, "y2")],
    ]);
  }
  if (tag === "rect") {
    const x = svgNumber(element, "x");
    const y = svgNumber(element, "y");
    return pointBounds([
      [x, y],
      [x + svgNumber(element, "width"), y + svgNumber(element, "height")],
    ]);
  }
  if (tag === "polygon" || tag === "polyline") {
    const values = (element.getAttribute("points") ?? "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      values.length % 2 !== 0 || values.some((value) => !Number.isFinite(value))
    ) {
      throw new TypeError(`${tag} requires complete finite point pairs`);
    }
    const points: [number, number][] = [];
    for (let index = 0; index < values.length; index += 2) {
      const x = values[index];
      const y = values[index + 1];
      if (x === undefined || y === undefined) {
        throw new TypeError(`${tag} requires complete finite point pairs`);
      }
      points.push([x, y]);
    }
    return pointBounds(points);
  }
  throw new TypeError(`Unsupported hard-edged SVG geometry: ${tag}`);
}

/** Find non-primary hard edges that can bisect the resolved triangle. */
function centerSpanningHardEdges(artwork: Element): string[] {
  return [...artwork.querySelectorAll(HARD_EDGE_GEOMETRY)].flatMap(
    (element) => {
      if (element.hasAttribute("data-alignment-plane")) return [];
      const bounds = geometryBounds(element);
      const spansCenter = bounds.minX <= ALIGNMENT_CENTER_X &&
        bounds.maxX >= ALIGNMENT_CENTER_X;
      const spansHeight = bounds.minY <= ALIGNMENT_TOP_Y &&
        bounds.maxY >= ALIGNMENT_BOTTOM_Y;
      if (!spansCenter || !spansHeight) return [];
      const owner = element.getAttribute("class") ??
        element.parentElement?.getAttribute("class") ?? "unclassified";
      return [`${element.tagName.toLowerCase()}.${owner}`];
    },
  );
}

Deno.test("the focused alignment study renders once in each fixed theme", () => {
  const html = renderArtGallery();
  const dom = new JSDOM(html);
  const document = dom.window.document;
  const study = document.querySelector('[data-browser-artwork="alignment"]');
  assert(study !== null);

  assertEquals(
    readableText(study.querySelector("h3")?.textContent ?? null),
    "Alignment",
  );
  assertEquals(study.querySelectorAll(".art-gallery__theme").length, 2);
  assertEquals(
    study.querySelectorAll('.art-gallery__theme[data-discern-theme="light"]')
      .length,
    1,
  );
  assertEquals(
    study.querySelectorAll('.art-gallery__theme[data-discern-theme="dark"]')
      .length,
    1,
  );
  assertEquals(study.querySelectorAll(".alignment-art").length, 2);

  const ids = [...document.querySelectorAll("[id]")].map((element) =>
    element.id
  );
  assertEquals(ids.length, new Set(ids).size, "rendered ids must be unique");

  assertStringIncludes(readableText(study.textContent), "Alignment");
  assertEquals(
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
      (script) => script.getAttribute("src"),
    ),
    [],
    "the static preview must not ship a browser framework runtime",
  );
  dom.window.close();
});

Deno.test("alignment artwork names its final state and motion alternative", async () => {
  const dom = new JSDOM(renderArtGallery());
  const document = dom.window.document;
  const artworks = document.querySelectorAll<SVGElement>(
    ".alignment-art__art",
  );
  assertEquals(artworks.length, 2);

  for (const artwork of artworks) {
    assertEquals(artwork.getAttribute("role"), "img");
    const labelledBy = artwork.getAttribute("aria-labelledby")?.split(/\s+/) ??
      [];
    assertEquals(labelledBy.length, 2);
    const [titleId, descriptionId] = labelledBy;
    assert(titleId !== undefined);
    assert(descriptionId !== undefined);
    assertEquals(
      readableText(document.getElementById(titleId)?.textContent ?? null),
      "Planes resolving into exact alignment",
    );
    const description = readableText(
      document.getElementById(descriptionId)?.textContent ?? null,
    );
    assertStringIncludes(description, "a separate condition");
    assertStringIncludes(description, "remains visible without motion");
    assertEquals(artwork.querySelectorAll("[data-alignment-plane]").length, 3);
    assertEquals(
      artwork.querySelectorAll("[data-alignment-authority]").length,
      1,
    );
    assertEquals(artwork.querySelectorAll("rect, mask, clipPath").length, 0);
    assertEquals(
      artwork.querySelectorAll("[data-alignment-aperture]").length,
      0,
    );
  }
  dom.window.close();

  const css = await Deno.readTextFile(ALIGNMENT_CSS);
  assertStringIncludes(css, "@media (prefers-reduced-motion: reduce)");
  assertStringIncludes(css, ".alignment-art__plane,");
  assertStringIncludes(css, ".alignment-art__authority,");
  assertStringIncludes(css, ".alignment-art__bloom {");
  assertStringIncludes(css, "animation: none;");
  assertStringIncludes(css, "12s");
  assertEquals(css.includes("99.5%"), false);
  assertStringIncludes(css, "0%,\n    14%,\n    100%");
  assertStringIncludes(css, "0%,\n    52%,\n    100%");
  assertStringIncludes(css, "0%,\n    46%,\n    100%");

  const artworkRule = cssRule(css, ".alignment-art");
  assertEquals(/(?:background|border)[^:]*:/.test(artworkRule), false);
});

Deno.test("alignment resolves to exact canonical geometry", async () => {
  const dom = new JSDOM(renderArtGallery());
  const expectedPlanes = [
    ["outline", "380,124 198,430 562,430"],
    ["ghost", "380,124 198,430 380,430"],
    ["filled", "380,124 562,430 380,430"],
  ];

  for (
    const artwork of dom.window.document.querySelectorAll(
      ".alignment-art__art",
    )
  ) {
    const planes = [...artwork.querySelectorAll("[data-alignment-plane]")];
    assertEquals(
      planes.map((plane) => [
        plane.getAttribute("data-alignment-plane"),
        plane.getAttribute("points"),
      ]),
      expectedPlanes,
    );
    assert(planes.every((plane) => plane.tagName.toLowerCase() === "polygon"));

    const authority = artwork.querySelector("[data-alignment-authority]");
    assert(authority !== null);
    assertEquals(authority.tagName.toLowerCase(), "line");
    const bounds = geometryBounds(authority);
    assert(
      bounds.minX > 562,
      "the secondary mark must remain outside the form",
    );
    assert(bounds.maxX - bounds.minX <= 24, "the secondary mark stays compact");
    assert(bounds.maxY - bounds.minY <= 32, "the secondary mark stays compact");
  }
  dom.window.close();

  const css = await Deno.readTextFile(ALIGNMENT_CSS);
  assertStringIncludes(
    cssRule(css, ".alignment-art__plane--ghost"),
    "--alignment-rest-opacity: 0;",
  );
  for (
    const selector of [
      ".alignment-art__plane--outline",
      ".alignment-art__plane--filled",
    ]
  ) {
    assertStringIncludes(
      cssRule(css, selector),
      "--alignment-rest-opacity: 1;",
    );
  }
  assertStringIncludes(
    cssRule(css, ".alignment-art__plane--filled"),
    "stroke: none;",
  );
  assertEquals(css.includes("aperture"), false);
});

Deno.test("alignment preserves its composition at compact widths", async () => {
  const dom = new JSDOM(renderArtGallery());
  for (
    const artwork of dom.window.document.querySelectorAll(
      ".alignment-art__art",
    )
  ) {
    assertEquals(artwork.getAttribute("viewBox"), "0 0 760 540");
  }
  dom.window.close();

  const alignmentCss = await Deno.readTextFile(ALIGNMENT_CSS);
  const figureRule = cssRule(alignmentCss, ".alignment-art");
  assertStringIncludes(figureRule, "min-width: 0;");
  assertStringIncludes(figureRule, "overflow: hidden;");
  const svgRule = cssRule(alignmentCss, ".alignment-art__art");
  assertStringIncludes(svgRule, "width: 100%;");
  assertStringIncludes(svgRule, "height: auto;");

  const galleryCss = await Deno.readTextFile(GALLERY_CSS);
  assertStringIncludes(galleryCss, "@media (max-width: 28rem)");
  assertStringIncludes(
    cssRule(galleryCss, ".art-gallery__theme"),
    "min-width: 0;",
  );
});

Deno.test("opening plane registration is deliberate and distinct", async () => {
  const css = await Deno.readTextFile(ALIGNMENT_CSS);
  const openingTransforms = [
    ".alignment-art__plane--outline",
    ".alignment-art__plane--ghost",
    ".alignment-art__plane--filled",
  ].map((selector) => {
    const declarations = cssRule(css, selector);
    const x = cssCustomNumber(declarations, "--alignment-open-x");
    const y = cssCustomNumber(declarations, "--alignment-open-y");
    const angle = cssCustomNumber(declarations, "--alignment-open-angle");
    assert(
      Math.hypot(x, y) >= 32,
      `${selector} must open with an unmistakable translation`,
    );
    assert(
      Math.abs(angle) >= 5,
      `${selector} must open with an unmistakable rotation`,
    );
    return `${x}:${y}:${angle}`;
  });
  assertEquals(new Set(openingTransforms).size, openingTransforms.length);
});

Deno.test("non-primary hard edges cannot bisect the resolved triangle", () => {
  const dom = new JSDOM(renderArtGallery());
  for (
    const artwork of dom.window.document.querySelectorAll(
      ".alignment-art__art",
    )
  ) {
    assertEquals(centerSpanningHardEdges(artwork), []);
  }
  dom.window.close();

  const futureSibling = new JSDOM(`
    <svg>
      <rect class="future-slab" x="377" y="120" width="6" height="320" />
      <line class="renamed-rail" x1="380" y1="100" x2="380" y2="450" />
    </svg>
  `);
  const futureSvg = futureSibling.window.document.querySelector("svg");
  assert(futureSvg !== null);
  assertEquals(
    centerSpanningHardEdges(futureSvg),
    ["rect.future-slab", "line.renamed-rail"],
    "new center-spanning geometry must fail regardless of its name or primitive",
  );
  futureSibling.window.close();
});
