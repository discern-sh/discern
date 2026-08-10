/** Contracts for the development-only quality-retention artwork study. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
import { QUALITY_CONTOUR_RINGS } from "../site/page-src/benefit-quality-contour.tsx";
import { renderQualityContourPreview } from "../site/page-src/benefit-quality-contour-preview.tsx";
import {
  QUALITY_CONTOUR_STYLESHEET_PATH,
  specimenHandler,
} from "../site/specimens.ts";

const CANON_CAPTION =
  "Quality numbers and disciplines only tighten: regression fails the Gate before it reaches review.";
const QUALITY_CONTOUR_CSS = new URL(
  "../site/page-src/benefit-quality-contour.css",
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

/** Extract a responsive two-dimensional translation from a keyframe. */
function percentageTranslation(
  declarations: string,
): readonly [number, number] {
  const match = declarations.match(
    /transform:\s*translate\((-?[\d.]+)%,\s*(-?[\d.]+)%\)/,
  );
  assert(match, "the motion frame must declare a responsive translation");
  return [Number(match[1]), Number(match[2])];
}

Deno.test("the one-way contour study renders accessibly in both fixed themes", () => {
  const dom = new JSDOM(renderQualityContourPreview());
  const document = dom.window.document;

  assertEquals(
    readableText(document.querySelector("h1")?.textContent ?? null),
    "Quality that only improves",
  );
  assertEquals(
    readableText(
      document.querySelector(".quality-study__caption")?.textContent ?? null,
    ),
    CANON_CAPTION,
  );
  assertEquals(document.querySelectorAll(".quality-study__theme").length, 2);
  assertEquals(
    document.querySelectorAll(
      '.quality-study__theme[data-discern-theme="light"]',
    ).length,
    1,
  );
  assertEquals(
    document.querySelectorAll(
      '.quality-study__theme[data-discern-theme="dark"]',
    ).length,
    1,
  );

  const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map(
    (element) => element.id,
  );
  assertEquals(ids.length, new Set(ids).size, "rendered ids must be unique");

  const artworks = document.querySelectorAll<SVGSVGElement>(
    '.quality-contour svg[role="img"]',
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
      artwork.querySelectorAll(".quality-contour__line").length,
      QUALITY_CONTOUR_RINGS.length,
    );
    assertEquals(
      artwork.querySelectorAll(".quality-contour__line--latest").length,
      1,
    );
    assertEquals(
      artwork.querySelectorAll(".quality-contour__attractor-fill").length,
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

Deno.test("the contour motion has a reduced-motion culmination", async () => {
  const dom = new JSDOM(renderQualityContourPreview());
  const document = dom.window.document;
  const css = await Deno.readTextFile(QUALITY_CONTOUR_CSS);

  for (const artwork of document.querySelectorAll(".quality-contour")) {
    const renderedRings = artwork.querySelectorAll(
      ".quality-contour__line[data-contour-ring]",
    );
    assertEquals(renderedRings.length, QUALITY_CONTOUR_RINGS.length);
    assertEquals(
      [...renderedRings].map((ring) => ring.getAttribute("d")),
      QUALITY_CONTOUR_RINGS.map((ring) => ring.path),
      "the registry must enroll every retained ring",
    );
    assertEquals(
      [...renderedRings].map((ring) => [
        ring.getAttribute("style")?.includes(
          "--quality-contour-opacity:",
        ),
        ring.getAttribute("style")?.includes(
          "--quality-contour-opacity-dark:",
        ),
      ]),
      QUALITY_CONTOUR_RINGS.map(() => [true, true]),
      "future rings must carry intentional contrast in both themes",
    );

    for (const ring of renderedRings) {
      const path = ring.getAttribute("d") ?? "";
      assertStringIncludes(path, " L ");
      assertStringIncludes(path, " Q ");
      assert(!path.includes(" C "), "rings must stay softly faceted");
    }

    const latest = artwork.querySelector<SVGPathElement>(
      ".quality-contour__line--latest",
    );
    const advance = artwork.querySelector<SVGPathElement>(
      ".quality-contour__advance",
    );
    assert(latest);
    assert(advance);
    assertEquals(advance.getAttribute("d"), latest.getAttribute("d"));

    assertEquals(advance.getAttribute("pathLength"), "1");
  }

  const latestRule = cssBlock(css, ".quality-contour__line--latest");
  const advanceRule = cssBlock(css, ".quality-contour__advance {");
  assertStringIncludes(latestRule, "stroke: var(--discern-color-ink)");
  assert(!latestRule.includes("accent"));
  assertStringIncludes(
    advanceRule,
    "stroke: var(--discern-color-accent-500)",
  );
  assertStringIncludes(
    advanceRule,
    "animation: quality-contour-advance 10s ease-in-out infinite",
  );

  const motion = cssBlock(css, "@keyframes quality-contour-advance");
  const start = cssBlock(motion, "0%");
  const settle = cssBlock(motion, "62%");
  const rest = cssBlock(motion, "84%");
  const reset = cssBlock(motion, "100%");
  const [startX, startY] = percentageTranslation(start);
  const [settleX, settleY] = percentageTranslation(settle);
  assert(
    Math.hypot(settleX - startX, settleY - startY) >= 3,
    "the advancing boundary must move far enough to remain legible",
  );
  assertStringIncludes(start, "stroke-dasharray: 0 1");
  assertStringIncludes(settle, "stroke-dasharray: 1 0");
  assertStringIncludes(rest, "stroke-dasharray: 1 0");
  assertStringIncludes(rest, "opacity: 1");
  assertStringIncludes(reset, "opacity: 0");

  const reduced = cssBlock(css, "@media (prefers-reduced-motion: reduce)");
  assertStringIncludes(
    cssBlock(reduced, ".quality-contour__advance,"),
    "animation: none",
  );
  assertStringIncludes(
    cssBlock(reduced, ".quality-contour__advance {"),
    "display: none",
  );
  assertStringIncludes(
    cssBlock(reduced, ".quality-contour__line--latest"),
    "stroke: var(--discern-color-accent-600)",
  );
  dom.window.close();
});

Deno.test("the focused development handler serves the contour stylesheet", async () => {
  const root = await specimenHandler(new Request("http://localhost/"));
  const html = await root.text();
  assertStringIncludes(html, QUALITY_CONTOUR_STYLESHEET_PATH);

  const stylesheet = await specimenHandler(
    new Request(`http://localhost${QUALITY_CONTOUR_STYLESHEET_PATH}`),
  );
  assertEquals(stylesheet.status, 200);
  assertEquals(stylesheet.headers.get("cache-control"), "no-store");
  assertStringIncludes(
    stylesheet.headers.get("content-type") ?? "",
    "text/css",
  );
  assertStringIncludes(await stylesheet.text(), ".quality-contour__line");
});
