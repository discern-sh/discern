/** Contracts for the development-only quality-retention artwork study. */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
// @ts-types="@types/jsdom"
import { JSDOM } from "jsdom";
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
      6,
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
  const css = await Deno.readTextFile(QUALITY_CONTOUR_CSS);

  assertStringIncludes(
    css,
    "animation: quality-contour-retention-pass 10s linear infinite;",
  );
  assertStringIncludes(css, "@media (prefers-reduced-motion: reduce)");
  assertStringIncludes(
    css,
    ".quality-contour__trace,\n    .quality-contour__bloom {\n      animation: none;",
  );
  assertStringIncludes(
    css,
    ".quality-contour__trace {\n      opacity: 0;",
  );
  assertStringIncludes(
    css,
    ".quality-contour__line--latest {\n    stroke: var(--discern-color-accent-600);",
  );
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
