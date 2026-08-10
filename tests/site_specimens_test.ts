/** Contracts for the development-only benefit artwork specimen. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { renderSpecimens } from "../site/page-src/specimens.tsx";
import {
  ALIGNMENT_STYLESHEET_PATH,
  SPECIMEN_STYLESHEET_PATH,
  specimenHandler,
} from "../site/specimens.ts";
import { handler, PAGES } from "../site/serve.ts";

const SPECIMEN_CSS = new URL(
  "../site/page-src/specimens.css",
  import.meta.url,
);
const ALIGNMENT_CSS = new URL(
  "../site/page-src/benefit_alignment.css",
  import.meta.url,
);

/** Collapse rendered prose whitespace without changing punctuation. */
function readableText(value: string | null): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Return selectors whose declarations opt into the monospace token. */
function monoSelectors(css: string): string[] {
  const selectors: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1];
    const declarations = match[2];
    if (
      selector === undefined || declarations === undefined ||
      !declarations.includes("var(--discern-font-mono)")
    ) continue;
    selectors.push(selector.trim().replace(/\s+/g, " "));
  }
  return selectors;
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

Deno.test("the benefit specimen remains outside the public route registry", async () => {
  assertEquals(Object.hasOwn(PAGES, "/specimens"), false);
  const publicResponse = await handler(
    new Request("https://discern.sh/specimens"),
  );
  assertEquals(publicResponse.status, 404);
  await publicResponse.body?.cancel();

  const config = JSON.parse(
    await Deno.readTextFile(new URL("../deno.json", import.meta.url)),
  ) as { tasks?: Record<string, string> };
  assertEquals(
    config.tasks?.["site:specimens"],
    "deno run --allow-read --allow-run --allow-net=127.0.0.1 --allow-env=NODE_ENV,PORT,DISCERN_PROJECT_SLUG,DISCERN_WORKTREE_BRANCH_PREFIX,DISCERN_WORKTREE_ID,GIT_BIN site/specimens.ts",
  );
});

Deno.test("the development handler serves the study and both live stylesheets", async () => {
  const root = await specimenHandler(new Request("http://localhost/"));
  assertEquals(root.status, 200);
  assertStringIncludes(root.headers.get("content-type") ?? "", "text/html");
  assertEquals(root.headers.get("cache-control"), "no-store");
  assertEquals(root.headers.get("x-robots-tag"), "noindex, nofollow");
  assertStringIncludes(await root.text(), "Delegate with confidence.");

  for (
    const [path, selector] of [
      [SPECIMEN_STYLESHEET_PATH, ".specimen-theme"],
      [ALIGNMENT_STYLESHEET_PATH, ".benefit-alignment"],
    ] as const
  ) {
    const stylesheet = await specimenHandler(
      new Request(`http://localhost${path}`),
    );
    assertEquals(stylesheet.status, 200, path);
    assertStringIncludes(
      stylesheet.headers.get("content-type") ?? "",
      "text/css",
    );
    assertEquals(stylesheet.headers.get("cache-control"), "no-store");
    assertStringIncludes(await stylesheet.text(), selector);
  }

  for (
    const path of [
      "/",
      SPECIMEN_STYLESHEET_PATH,
      ALIGNMENT_STYLESHEET_PATH,
    ]
  ) {
    const rejected = await specimenHandler(
      new Request(`http://localhost${path}`, { method: "POST" }),
    );
    assertEquals(rejected.status, 405, path);
    assertEquals(rejected.headers.get("allow"), "GET, HEAD", path);
    await rejected.body?.cancel();
  }
});

Deno.test("the focused alignment study renders once in each fixed theme", () => {
  const html = renderSpecimens();
  const dom = new JSDOM(html);
  const document = dom.window.document;

  assertEquals(document.querySelectorAll("h1").length, 1);
  assertEquals(
    readableText(document.querySelector("h1")?.textContent ?? null),
    "Delegate with confidence.",
  );
  assertEquals(document.querySelectorAll(".specimen-theme").length, 2);
  assertEquals(
    document.querySelectorAll('.specimen-theme[data-discern-theme="light"]')
      .length,
    1,
  );
  assertEquals(
    document.querySelectorAll('.specimen-theme[data-discern-theme="dark"]')
      .length,
    1,
  );
  assertEquals(document.querySelectorAll(".benefit-alignment").length, 2);

  const ids = [...document.querySelectorAll("[id]")].map((element) =>
    element.id
  );
  assertEquals(ids.length, new Set(ids).size, "rendered ids must be unique");

  assertStringIncludes(
    readableText(document.body.textContent),
    "Correctness, permission, and blast radius are held by separate mechanisms, so delegated work is verified rather than taken on trust.",
  );
  assertEquals(
    [...document.querySelectorAll<HTMLScriptElement>("script[src]")].map(
      (script) => script.getAttribute("src"),
    ),
    ["/assets/theme.js"],
    "the static preview must not ship a browser framework runtime",
  );
  dom.window.close();
});

Deno.test("alignment artwork names its final state and motion alternative", async () => {
  const dom = new JSDOM(renderSpecimens());
  const document = dom.window.document;
  const artworks = document.querySelectorAll<SVGElement>(
    ".benefit-alignment__art",
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
  assertStringIncludes(css, ".benefit-alignment__plane,");
  assertStringIncludes(css, ".benefit-alignment__authority,");
  assertStringIncludes(css, ".benefit-alignment__bloom {");
  assertStringIncludes(css, "animation: none;");
  assertStringIncludes(css, "12s");
  assertEquals(css.includes("99.5%"), false);
  assertStringIncludes(css, "0%,\n    14%,\n    100%");
  assertStringIncludes(css, "0%,\n    52%,\n    100%");
  assertStringIncludes(css, "0%,\n    46%,\n    100%");

  const artworkRule = cssRule(css, ".benefit-alignment");
  assertEquals(/(?:background|border)[^:]*:/.test(artworkRule), false);
});

Deno.test("alignment resolves to exact canonical geometry", async () => {
  const dom = new JSDOM(renderSpecimens());
  const expectedPlanes = [
    ["outline", "380,124 198,430 562,430"],
    ["ghost", "380,124 198,430 380,430"],
    ["filled", "380,124 562,430 380,430"],
  ];

  for (
    const artwork of dom.window.document.querySelectorAll(
      ".benefit-alignment__art",
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
    cssRule(css, ".benefit-alignment__plane--ghost"),
    "--alignment-rest-opacity: 0;",
  );
  for (
    const selector of [
      ".benefit-alignment__plane--outline",
      ".benefit-alignment__plane--filled",
    ]
  ) {
    assertStringIncludes(
      cssRule(css, selector),
      "--alignment-rest-opacity: 1;",
    );
  }
  assertStringIncludes(
    cssRule(css, ".benefit-alignment__plane--filled"),
    "stroke: none;",
  );
  assertEquals(css.includes("aperture"), false);
});

Deno.test("alignment preserves its composition at compact widths", async () => {
  const dom = new JSDOM(renderSpecimens());
  for (
    const artwork of dom.window.document.querySelectorAll(
      ".benefit-alignment__art",
    )
  ) {
    assertEquals(artwork.getAttribute("viewBox"), "0 0 760 540");
  }
  dom.window.close();

  const alignmentCss = await Deno.readTextFile(ALIGNMENT_CSS);
  const figureRule = cssRule(alignmentCss, ".benefit-alignment");
  assertStringIncludes(figureRule, "min-width: 0;");
  assertStringIncludes(figureRule, "overflow: hidden;");
  const svgRule = cssRule(alignmentCss, ".benefit-alignment__art");
  assertStringIncludes(svgRule, "width: 100%;");
  assertStringIncludes(svgRule, "height: auto;");

  const specimenCss = await Deno.readTextFile(SPECIMEN_CSS);
  assertStringIncludes(specimenCss, "@media (max-width: 480px)");
  assertStringIncludes(
    cssRule(specimenCss, ".specimen-theme"),
    "min-width: 0;",
  );
});

Deno.test("opening plane registration is deliberate and distinct", async () => {
  const css = await Deno.readTextFile(ALIGNMENT_CSS);
  const openingTransforms = [
    ".benefit-alignment__plane--outline",
    ".benefit-alignment__plane--ghost",
    ".benefit-alignment__plane--filled",
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
  const dom = new JSDOM(renderSpecimens());
  for (
    const artwork of dom.window.document.querySelectorAll(
      ".benefit-alignment__art",
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

Deno.test("specimen typography reserves monospace for the product name", async () => {
  const specimenCss = await Deno.readTextFile(SPECIMEN_CSS);
  const alignmentCss = await Deno.readTextFile(ALIGNMENT_CSS);
  assertEquals(monoSelectors(`${specimenCss}\n${alignmentCss}`), [
    ".specimen-brand-name",
  ]);
});
